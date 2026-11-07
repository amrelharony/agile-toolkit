/**
 * The card image: drawn on white at twice the size once the card's pictures
 * have loaded, from the pixels on screen (so no panel is fetched again, and
 * nothing is cache-busted), with a blank where a panel can't be fetched or
 * decoded, and twice on Safari, whose first capture often paints pictures
 * blank.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toBlob: vi.fn() }));
vi.mock("html-to-image", () => ({ toBlob: h.toBlob }));

import { cardImage, cardImageName } from "@/lib/kudos/card-image";

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

describe("cardImage draws a loaded panel from what is on screen", () => {
  const SMALL = `${PANEL}.360.webp`;
  const LARGE = `${PANEL}.720.webp`;
  const SHOWN = "data:image/png;base64,U0hPV04=";

  /** A full card's panel that has loaded (the 360 px file, on a 1x screen). */
  function loadedPanel(): { el: HTMLElement; img: HTMLImageElement } {
    const el = document.createElement("div");
    const img = document.createElement("img");
    img.setAttribute("srcset", `${SMALL} 360w, ${LARGE} 720w`);
    img.setAttribute("src", LARGE);
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 360 });
    Object.defineProperty(img, "naturalHeight", { value: 360 });
    Object.defineProperty(img, "decode", { value: () => Promise.resolve() });
    el.appendChild(img);
    document.body.appendChild(el);
    return { el, img };
  }

  /** A canvas that reads pictures; `null` for none (jsdom has none of its own). */
  function canvas(readable: boolean) {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      (readable ? { drawImage } : null) as never
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(SHOWN);
    return drawImage;
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

  it("so html-to-image fetches nothing: no 720 px file, no cached blank", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel();
    const drawImage = canvas(true);
    const seen = recordCaptures(img);

    await cardImage(el);
    expect(drawImage).toHaveBeenCalledWith(img, 0, 0);
    // A data URL, which html-to-image leaves as it is, and no srcset to pick a URL from.
    expect(seen).toEqual([{ src: SHOWN, srcset: null }]);
    // The card on screen gets its own picture back.
    expect(img.getAttribute("src")).toBe(LARGE);
    expect(img.getAttribute("srcset")).toBe(`${SMALL} 360w, ${LARGE} 720w`);
  });

  it("for both of Safari's captures", async () => {
    userAgent(SAFARI);
    const { el, img } = loadedPanel();
    canvas(true);
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([
      { src: SHOWN, srcset: null },
      { src: SHOWN, srcset: null },
    ]);
    expect(img.getAttribute("src")).toBe(LARGE);
  });

  it("and puts the picture back when the capture fails", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel();
    canvas(true);
    h.toBlob.mockRejectedValueOnce(new Error("boom"));
    await expect(cardImage(el)).rejects.toThrow("boom");
    expect(img.getAttribute("src")).toBe(LARGE);
    expect(img.getAttribute("srcset")).toBe(`${SMALL} 360w, ${LARGE} 720w`);
  });

  it("but leaves a picture React redrew meanwhile as React set it", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel();
    canvas(true);
    h.toBlob.mockImplementation(async () => {
      img.setAttribute("src", `${PANEL}-other.720.webp`);
      return new Blob(["png"], { type: "image/png" });
    });
    await cardImage(el);
    expect(img.getAttribute("src")).toBe(`${PANEL}-other.720.webp`);
  });

  it("and leaves a picture it can't read for html-to-image to fetch", async () => {
    userAgent(CHROME);
    const { el, img } = loadedPanel();
    canvas(false);
    const seen = recordCaptures(img);
    await cardImage(el);
    expect(seen).toEqual([{ src: LARGE, srcset: `${SMALL} 360w, ${LARGE} 720w` }]);
  });
});

describe("cardImageName", () => {
  it("names the file after who it's for", () => {
    expect(cardImageName("Sara O'Neil")).toBe("kudos-to-sara-o-neil.png");
    expect(cardImageName("😀")).toBe("kudos-to-recipient.png");
  });
});
