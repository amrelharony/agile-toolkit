/**
 * The card image: drawn on white at twice the size once the card's pictures
 * have loaded, each panel from its sharpest file (the widest in its srcset,
 * fetched once by the card image itself, or else the pixels on screen), so
 * html-to-image fetches no panel and nothing is cache-busted; with a blank
 * where a panel can't be fetched or decoded, and twice on Safari, whose first
 * capture often paints pictures blank.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toBlob: vi.fn() }));
vi.mock("html-to-image", () => ({ toBlob: h.toBlob }));

import {
  cardImage,
  cardImageName,
  SHARE_IMAGE_OPTIONS,
  warmCardImage,
  widestSource,
} from "@/lib/kudos/card-image";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const PANEL = "https://ref.supabase.co/storage/v1/object/public/comic-panels/kudos-cards/ep-07";

const userAgent = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function card(withImage: boolean): HTMLElement {
  const el = document.createElement("div");
  if (withImage) {
    const img = document.createElement("img");
    img.src =
      "https://ref.supabase.co/storage/v1/object/public/comic-panels/kudos-cards/ep-07.webp";
    el.appendChild(img);
  }
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  h.toBlob.mockReset();
  h.toBlob.mockImplementation(async () => new Blob(["png"], { type: "image/png" }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("cardImage", () => {
  it("draws on white at twice the size, with a blank for a missing panel and no cache-busting", async () => {
    userAgent(CHROME);
    const el = card(false);
    const blob = await cardImage(el);
    expect(blob.type).toBe("image/png");
    expect(h.toBlob).toHaveBeenCalledTimes(1);
    const [node, options] = h.toBlob.mock.calls[0];
    expect(node).toBe(el);
    expect(options).toEqual({
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      imagePlaceholder: expect.stringMatching(/^data:image\/gif;base64,/),
      onImageErrorHandler: expect.any(Function),
    });
    expect(options).not.toHaveProperty("cacheBust");
    // A panel fetched as an error page fails to decode: the image is drawn on without it.
    expect(() => options.onImageErrorHandler(new Event("error"))).not.toThrow();
  });

  it("waits for the card's pictures to load before drawing", async () => {
    userAgent(CHROME);
    const el = card(true);
    const made = cardImage(el);
    await tick();
    await tick();
    expect(h.toBlob).not.toHaveBeenCalled();
    el.querySelector("img")!.dispatchEvent(new Event("load"));
    await made;
    expect(h.toBlob).toHaveBeenCalledTimes(1);
  });

  it("draws anyway when a picture fails to load", async () => {
    userAgent(CHROME);
    const el = card(true);
    const made = cardImage(el);
    await tick();
    expect(h.toBlob).not.toHaveBeenCalled();
    el.querySelector("img")!.dispatchEvent(new Event("error"));
    await expect(made).resolves.toBeInstanceOf(Blob);
  });

  it("waits 8 seconds for a picture still loading, or only as long as the share sheet allows", async () => {
    vi.useFakeTimers();
    userAgent(CHROME);
    const usual = cardImage(card(true));
    await vi.advanceTimersByTimeAsync(7_999);
    expect(h.toBlob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await usual;
    expect(h.toBlob).toHaveBeenCalledTimes(1);

    const shared = cardImage(card(true), SHARE_IMAGE_OPTIONS);
    await vi.advanceTimersByTimeAsync(SHARE_IMAGE_OPTIONS.imagesWaitMs - 1);
    expect(h.toBlob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await shared;
    expect(h.toBlob).toHaveBeenCalledTimes(2);
  });

  it("decodes a picture that has already loaded, drawing even if decoding fails", async () => {
    userAgent(CHROME);
    const el = card(true);
    const img = el.querySelector("img")!;
    const decode = vi.fn(() => Promise.reject(new Error("broken")));
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "decode", { value: decode });
    await expect(cardImage(el)).resolves.toBeInstanceOf(Blob);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(h.toBlob).toHaveBeenCalledTimes(1);
  });

  it("draws twice on Safari and keeps the second", async () => {
    userAgent(SAFARI);
    const second = new Blob(["second"], { type: "image/png" });
    h.toBlob
      .mockResolvedValueOnce(new Blob(["first"], { type: "image/png" }))
      .mockResolvedValueOnce(second);
    expect(await cardImage(card(false))).toBe(second);
    expect(h.toBlob).toHaveBeenCalledTimes(2);
  });

  it("fails when nothing was drawn", async () => {
    userAgent(CHROME);
    h.toBlob.mockResolvedValueOnce(null);
    await expect(cardImage(card(false))).rejects.toThrow("Couldn't make the card image.");
  });
});

describe("cardImage draws each panel from its sharpest file", () => {
  const SMALL = `${PANEL}.360.webp`;
  const LARGE = `${PANEL}.720.webp`;
  const SRCSET = `${SMALL} 360w, ${LARGE} 720w`;
  const PIXELS_360 = "data:image/png;base64,MzYw";
  const PIXELS_720 = "data:image/png;base64,NzIw";

  /**
   * A full card's panel that has loaded `shown`: the 360 px file on a 1x
   * screen, 720 on a 2x. Either way it reports the 260 px of its slot as its
   * natural size, as browsers do for a file picked from a srcset by width.
   */
  function loadedPanel(shown: string = SMALL): { el: HTMLElement; img: HTMLImageElement } {
    const el = document.createElement("div");
    const img = document.createElement("img");
    img.setAttribute("srcset", SRCSET);
    img.setAttribute("src", LARGE);
    Object.defineProperty(img, "currentSrc", { value: shown });
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 260 });
    Object.defineProperty(img, "naturalHeight", { value: 260 });
    Object.defineProperty(img, "decode", { value: () => Promise.resolve() });
    el.appendChild(img);
    document.body.appendChild(el);
    return { el, img };
  }

  /**
   * A canvas that reads pictures (`null` for none: jsdom has no canvas of its
   * own), giving each size's pixels; `unreadable` widths throw, like a
   * picture loaded without CORS.
   */
  function canvas(readable: boolean, unreadable: number[] = []) {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      (readable ? { drawImage } : null) as never
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      if (unreadable.includes(this.width)) throw new DOMException("tainted", "SecurityError");
      return this.width === 720 ? PIXELS_720 : PIXELS_360;
    });
    return drawImage;
  }

  /**
   * `new Image()` as the card image uses it, which jsdom never loads: each
   * one loads the 720 px file, fails, or never answers a moment after its
   * src is set. Returns what was asked for, and how.
   */
  function sharperFiles(outcome: "load" | "error" | "never", beforeAnswer?: () => void) {
    const asked: { src: string; crossOrigin: string | null }[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin: string | null = null;
      currentSrc = "";
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      // No decode(): Chrome holds it for a picture off the page while the tab is hidden.
      decode = () => new Promise<void>(() => {});
      getAttribute() {
        return null;
      }
      set src(url: string) {
        asked.push({ src: url, crossOrigin: this.crossOrigin });
        setTimeout(() => {
          beforeAnswer?.();
          if (outcome === "load") {
            this.currentSrc = url;
            this.complete = true;
            this.naturalWidth = 720;
            this.naturalHeight = 720;
            this.onload?.();
          } else if (outcome === "error") {
            this.onerror?.();
          }
        }, 0);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    return asked;
  }

  /** The panel's src and srcset at each capture. */
  function recordCaptures(img: HTMLImageElement) {
    const seen: { src: string | null; srcset: string | null }[] = [];
    h.toBlob.mockImplementation(async () => {
      seen.push({ src: img.getAttribute("src"), srcset: img.getAttribute("srcset") });
      return new Blob(["png"], { type: "image/png" });
    });
    return seen;
  }

  it("fetches the 720 px file once, CORS-mode, when the screen showed the 360 px one", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    const asked = sharperFiles("load");
    const seen = recordCaptures(img);

    await cardImage(el);
    expect(asked).toEqual([{ src: LARGE, crossOrigin: "anonymous" }]);
    // A data URL, which html-to-image leaves as it is, and no srcset to pick a URL from.
    expect(seen).toEqual([{ src: PIXELS_720, srcset: null }]);
    // The card on screen gets its own picture back.
    expect(img.getAttribute("src")).toBe(LARGE);
    expect(img.getAttribute("srcset")).toBe(SRCSET);
  });

  it("fetches nothing when the screen already shows the 720 px file, and copies all of it", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(LARGE);
    const drawImage = canvas(true);
    const asked = sharperFiles("load");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(asked).toEqual([]);
    // The file's own 720 px, not the 260 px its slot reports.
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0, 720, 720);
    expect(seen).toEqual([{ src: PIXELS_720, srcset: null }]);
  });

  it("draws the panel on screen, at its file's 360 px, when the 720 px file fails (offline)", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    const drawImage = canvas(true);
    sharperFiles("error");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(drawImage).toHaveBeenLastCalledWith(img, 0, 0, 360, 360);
    expect(seen).toEqual([{ src: PIXELS_360, srcset: null }]);
  });

  it("copies a picture without a srcset at its natural size", async () => {
    userAgent(CHROME);
    const el = document.createElement("div");
    const img = document.createElement("img");
    img.setAttribute("src", SMALL);
    Object.defineProperty(img, "currentSrc", { value: SMALL });
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 360 });
    Object.defineProperty(img, "naturalHeight", { value: 360 });
    Object.defineProperty(img, "decode", { value: () => Promise.resolve() });
    el.appendChild(img);
    document.body.appendChild(el);
    const drawImage = canvas(true);
    const asked = sharperFiles("load");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(asked).toEqual([]);
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0, 360, 360);
    expect(seen).toEqual([{ src: PIXELS_360, srcset: null }]);
  });

  it("draws the panel on screen when the 720 px file takes more than 4 seconds", async () => {
    vi.useFakeTimers();
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    sharperFiles("never");
    const seen = recordCaptures(img);
    const made = cardImage(el);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(h.toBlob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await made;
    expect(seen).toEqual([{ src: PIXELS_360, srcset: null }]);
  });

  it("draws the panel on screen when the 720 px file can't be read", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(true, [720]);
    sharperFiles("load");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([{ src: PIXELS_360, srcset: null }]);
  });

  it("leaves a panel React redrew while the 720 px file was fetched as React set it", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    const other = `${PANEL}-other.720.webp`;
    sharperFiles("load", () => img.setAttribute("src", other));
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([{ src: other, srcset: SRCSET }]);
    expect(img.getAttribute("src")).toBe(other);
  });

  it("for both of Safari's captures", async () => {
    userAgent(SAFARI);
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    sharperFiles("load");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([
      { src: PIXELS_720, srcset: null },
      { src: PIXELS_720, srcset: null },
    ]);
    expect(img.getAttribute("src")).toBe(LARGE);
  });

  it("and puts the picture back when the capture fails", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    sharperFiles("load");
    h.toBlob.mockRejectedValueOnce(new Error("boom"));
    await expect(cardImage(el)).rejects.toThrow("boom");
    expect(img.getAttribute("src")).toBe(LARGE);
    expect(img.getAttribute("srcset")).toBe(SRCSET);
  });

  it("but leaves a picture React redrew during the capture as React set it", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(LARGE);
    canvas(true);
    h.toBlob.mockImplementation(async () => {
      img.setAttribute("src", `${PANEL}-other.720.webp`);
      return new Blob(["png"], { type: "image/png" });
    });
    await cardImage(el);
    expect(img.getAttribute("src")).toBe(`${PANEL}-other.720.webp`);
  });

  it("and leaves a picture it can't read either way for html-to-image to fetch", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel(SMALL);
    canvas(false);
    sharperFiles("load");
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([{ src: LARGE, srcset: SRCSET }]);
  });

  it("waits only as long as it's asked to: the share sheet's second", async () => {
    vi.useFakeTimers();
    userAgent(CHROME);
    expect(SHARE_IMAGE_OPTIONS).toEqual({ imagesWaitMs: 2_000, sharperWaitMs: 1_000 });
    const { el, img } = loadedPanel(SMALL);
    canvas(true);
    sharperFiles("never");
    const seen = recordCaptures(img);
    const made = cardImage(el, SHARE_IMAGE_OPTIONS);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.toBlob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await made;
    expect(seen).toEqual([{ src: PIXELS_360, srcset: null }]);
  });

  describe("warmCardImage, before any click", () => {
    /** A panel the screen is still loading; `finish` picks `shown` and fires load. */
    function loadingPanel() {
      const el = document.createElement("div");
      const img = document.createElement("img");
      img.setAttribute("srcset", SRCSET);
      img.setAttribute("src", LARGE);
      let complete = false;
      let current = "";
      Object.defineProperty(img, "complete", { get: () => complete });
      Object.defineProperty(img, "currentSrc", { get: () => current });
      el.appendChild(img);
      document.body.appendChild(el);
      const finish = (shown: string) => {
        complete = true;
        current = shown;
        img.dispatchEvent(new Event("load"));
      };
      return { el, finish };
    }

    it("starts fetching the 720 px file, CORS-mode, when the screen shows the 360 px one", () => {
      const asked = sharperFiles("load");
      warmCardImage(loadedPanel(SMALL).el);
      expect(asked).toEqual([{ src: LARGE, crossOrigin: "anonymous" }]);
    });

    it("fetches nothing when the screen shows the 720 px file", () => {
      const asked = sharperFiles("load");
      warmCardImage(loadedPanel(LARGE).el);
      expect(asked).toEqual([]);
    });

    it("fetches nothing for a loaded picture without a srcset", () => {
      const asked = sharperFiles("load");
      const el = document.createElement("div");
      const img = document.createElement("img");
      img.setAttribute("src", SMALL);
      Object.defineProperty(img, "currentSrc", { value: SMALL });
      Object.defineProperty(img, "complete", { value: true });
      el.appendChild(img);
      warmCardImage(el);
      expect(asked).toEqual([]);
    });

    it("looks at a picture still loading once the screen has picked its file", () => {
      const asked = sharperFiles("load");
      const { el, finish } = loadingPanel();
      warmCardImage(el);
      expect(asked).toEqual([]);
      finish(SMALL);
      expect(asked).toEqual([{ src: LARGE, crossOrigin: "anonymous" }]);
    });

    it("and fetches nothing when the screen picked the 720 px file", () => {
      const asked = sharperFiles("load");
      const { el, finish } = loadingPanel();
      warmCardImage(el);
      finish(LARGE);
      expect(asked).toEqual([]);
    });

    it("and its undo stops that wait", () => {
      const asked = sharperFiles("load");
      const { el, finish } = loadingPanel();
      const stop = warmCardImage(el);
      stop();
      finish(SMALL);
      expect(asked).toEqual([]);
    });
  });
});

describe("widestSource", () => {
  it("picks the widest file, in any order and spacing", () => {
    expect(widestSource("a.360.webp 360w, b.720.webp 720w")).toBe("b.720.webp");
    expect(widestSource("b.720.webp 720w,a.360.webp 360w")).toBe("b.720.webp");
    expect(widestSource("  a.webp   360w ,  b.webp 720w  ")).toBe("b.webp");
  });

  it("has none without width descriptors", () => {
    expect(widestSource(null)).toBeNull();
    expect(widestSource("")).toBeNull();
    expect(widestSource("a.webp")).toBeNull();
    expect(widestSource("a.webp 1x, b.webp 2x")).toBeNull();
  });
});

describe("cardImageName", () => {
  it("names the file after who it's for", () => {
    expect(cardImageName("Sara O'Neil")).toBe("kudos-to-sara-o-neil.png");
    expect(cardImageName("😀")).toBe("kudos-to-recipient.png");
  });
});
