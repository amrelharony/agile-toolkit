import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_SECONDS,
  CREDIT_TEXT,
  FULL_WIDTH,
  SHARE_HEIGHT,
  SHARE_WIDTH,
  SMALL_WIDTH,
  convertPanel,
  creditBox,
  creditFontSize,
  encodeCanvas,
  processPanelImage,
  scaledSize,
  sendToStorage,
  shareCrop,
} from "@/lib/comics/image-pipeline";
import { CREDIT_CORNERS } from "@/lib/comics/story-input";

function blobOf(type: string) {
  return new Blob(["x"], { type });
}

/**
 * Canvases in jsdom can't draw. This records what the pipeline asked of them,
 * and answers toBlob with whatever `returns` says, the way a browser might.
 */
function fakeCanvases(returns: (requested: string) => string | null) {
  const made: {
    canvas: HTMLCanvasElement;
    sizes: { width: number; height: number }[];
    requested: string[];
    texts: { text: string; x: number; y: number }[];
    rects: number[][];
    fills: string[];
  }[] = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return real(tag);
    const record: (typeof made)[number] = {
      canvas: null as unknown as HTMLCanvasElement,
      sizes: [],
      requested: [],
      texts: [],
      rects: [],
      fills: [],
    };
    let width = 0;
    let height = 0;
    const ctx = {
      imageSmoothingQuality: "low",
      font: "",
      textBaseline: "",
      textAlign: "",
      set fillStyle(value: string) {
        record.fills.push(value);
      },
      drawImage: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect: (...args: number[]) => record.rects.push(args),
      fillText: (text: string, x: number, y: number) => record.texts.push({ text, x, y }),
    };
    const canvas = {
      get width() {
        return width;
      },
      set width(value: number) {
        width = value;
        record.sizes.push({ width, height });
      },
      get height() {
        return height;
      },
      set height(value: number) {
        height = value;
        record.sizes.push({ width, height });
      },
      getContext: () => ctx,
      toBlob: (done: (blob: Blob | null) => void, type: string) => {
        record.requested.push(type);
        const answer = returns(type);
        done(answer === null ? null : blobOf(answer));
      },
    };
    record.canvas = canvas as unknown as HTMLCanvasElement;
    made.push(record);
    return canvas as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return made;
}

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  bitmap = { width: 2816, height: 2816, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sizes", () => {
  it("scales down, keeping the shape", () => {
    expect(scaledSize({ width: 1536, height: 1024 }, 768)).toEqual({ width: 768, height: 512 });
  });

  it("never upscales", () => {
    expect(scaledSize({ width: 500, height: 400 }, 768)).toEqual({ width: 500, height: 400 });
  });

  it("crops the share image to 1200 x 630, nearer the top on a tall panel", () => {
    const square = shareCrop({ width: 2816, height: 2816 });
    expect(square.width).toBe(2816);
    expect(square.width / square.height).toBeCloseTo(SHARE_WIDTH / SHARE_HEIGHT, 2);
    expect(square.y).toBeLessThan((2816 - square.height) / 2);
    expect(square.y + square.height).toBeLessThanOrEqual(2816);

    const wide = shareCrop({ width: 4000, height: 1000 });
    expect(wide.height).toBe(1000);
    expect(wide.y).toBe(0);
    expect(wide.x + wide.width).toBeLessThanOrEqual(4000);
  });
});

describe("the credit", () => {
  it("is the agreed wording", () => {
    expect(CREDIT_TEXT).toBe("© Amr Elharony · agile.amrelharony.com/comics");
  });

  it("is big enough to read at 768 px, and scales with the image", () => {
    expect(creditFontSize(768)).toBeGreaterThanOrEqual(14);
    expect(creditFontSize(1536)).toBeGreaterThanOrEqual(creditFontSize(768) * 2);
  });

  it.each(CREDIT_CORNERS)("stays wholly inside the image at %s", (corner) => {
    const canvas = { width: 768, height: 512 };
    const box = creditBox(canvas, 340, 15, corner);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(768);
    expect(box.y + box.height).toBeLessThanOrEqual(512);
    expect(box.x > 384).toBe(corner.endsWith("right"));
    expect(box.y > 256).toBe(corner.startsWith("bottom"));
  });

  it("can't overflow an image too narrow for it", () => {
    const box = creditBox({ width: 200, height: 200 }, 340, 12, "bottom-right");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(200);
  });
});

describe("encoding", () => {
  it("keeps WebP when the browser really makes it", async () => {
    fakeCanvases((type) => type);
    const canvas = document.createElement("canvas");
    const blob = await encodeCanvas(canvas);
    expect(blob.type).toBe("image/webp");
  });

  it("falls back to JPEG when toBlob quietly returns a PNG, as iOS Safari does", async () => {
    const made = fakeCanvases((type) => (type === "image/webp" ? "image/png" : type));
    const canvas = document.createElement("canvas");
    const blob = await encodeCanvas(canvas);
    expect(blob.type).toBe("image/jpeg");
    expect(made[0].requested).toEqual(["image/webp", "image/jpeg"]);
  });

  it("falls back to JPEG when toBlob returns nothing", async () => {
    fakeCanvases((type) => (type === "image/webp" ? null : type));
    expect((await encodeCanvas(document.createElement("canvas"))).type).toBe("image/jpeg");
  });

  it("fails rather than uploading a type the bucket would refuse", async () => {
    fakeCanvases(() => "image/png");
    await expect(encodeCanvas(document.createElement("canvas"))).rejects.toThrow();
  });
});

describe("converting one picture", () => {
  it("makes the two widths and writes the credit into each", async () => {
    const made = fakeCanvases((type) => type);
    const out = await convertPanel(blobOf("image/png"), {
      corner: "bottom-right",
      withShare: false,
    });
    expect(out.width).toBe(FULL_WIDTH);
    expect(out.height).toBe(FULL_WIDTH);
    expect(out.share).toBeNull();
    expect(made).toHaveLength(2);
    expect(made[0].texts[0].text).toBe(CREDIT_TEXT);
    expect(made[1].texts[0].text).toBe(CREDIT_TEXT);
    expect(made[0].sizes.at(-3)).toMatchObject({ width: FULL_WIDTH });
    expect(made[1].sizes.at(-3)).toMatchObject({ width: SMALL_WIDTH });
  });

  it("makes a credited JPEG share image only when asked", async () => {
    const made = fakeCanvases((type) => type);
    const out = await convertPanel(blobOf("image/png"), {
      corner: "top-left",
      withShare: true,
    });
    expect(out.share?.type).toBe("image/jpeg");
    expect(made).toHaveLength(3);
    expect(made[2].requested).toEqual(["image/jpeg"]);
    expect(made[2].texts[0].text).toBe(CREDIT_TEXT);
  });

  it("puts the share image's credit in its own corner when given one", async () => {
    const made = fakeCanvases((type) => type);
    await convertPanel(blobOf("image/png"), {
      corner: "top-left",
      withShare: true,
      shareCorner: "bottom-right",
    });
    // The panel's two widths keep the panel's corner.
    expect(made[0].texts[0].x).toBeLessThan(FULL_WIDTH / 2);
    expect(made[1].texts[0].x).toBeLessThan(SMALL_WIDTH / 2);
    expect(made[0].texts[0].y).toBeLessThan(FULL_WIDTH / 2);
    // The 1200 x 630 share image, its own.
    expect(made[2].texts[0].x).toBeGreaterThan(600);
    expect(made[2].texts[0].y).toBeGreaterThan(315);
  });

  it("puts the share image's credit in the panel's corner otherwise", async () => {
    const made = fakeCanvases((type) => type);
    await convertPanel(blobOf("image/png"), { corner: "top-left", withShare: true });
    expect(made[2].texts[0].x).toBeLessThan(600);
    expect(made[2].texts[0].y).toBeLessThan(315);
  });

  it("releases the bitmap and shrinks every canvas to nothing", async () => {
    const made = fakeCanvases((type) => type);
    await convertPanel(blobOf("image/png"), { corner: "bottom-right", withShare: true });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    for (const record of made) expect(record.sizes.at(-1)).toEqual({ width: 0, height: 0 });
  });

  it("still releases everything when encoding fails", async () => {
    const made = fakeCanvases(() => null);
    await expect(
      convertPanel(blobOf("image/png"), { corner: "bottom-right", withShare: false })
    ).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(made[0].sizes.at(-1)).toEqual({ width: 0, height: 0 });
  });
});

describe("uploading", () => {
  it("sets a year's cache: the default of an hour would defeat it", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const blob = blobOf("image/webp");
    const from = vi.fn(() => ({ uploadToSignedUrl: upload }));
    await sendToStorage({ from }, "a.webp", "tok", blob);
    expect(from).toHaveBeenCalledWith("comic-panels");
    expect(upload).toHaveBeenCalledWith("a.webp", "tok", blob, {
      cacheControl: CACHE_SECONDS,
      contentType: "image/webp",
      upsert: false,
    });
    expect(CACHE_SECONDS).toBe("31536000");
  });

  it("surfaces Storage's refusal instead of carrying on", async () => {
    const from = () => ({ uploadToSignedUrl: async () => ({ error: { message: "too big" } }) });
    await expect(sendToStorage({ from }, "a.webp", "tok", blobOf("image/webp"))).rejects.toThrow(
      "too big"
    );
  });

  it("sends the two versions and the share image, and never the original", async () => {
    fakeCanvases((type) => type);
    const original = new Blob(["original"], { type: "image/png" });
    const sent: Blob[] = [];
    let n = 0;
    const steps: string[] = [];
    const art = await processPanelImage(original, {
      corner: "bottom-right",
      withShare: true,
      onStep: (step) => steps.push(step),
      uploader: {
        signedUpload: async (type) => ({ path: `f${(n += 1)}.${type}`, token: "t" }),
        send: async (_path, _token, blob) => {
          sent.push(blob);
        },
      },
    });
    expect(sent).toHaveLength(3);
    expect(sent).not.toContain(original);
    expect(art.pathFull).toBe("f1.image/webp");
    expect(art.pathSmall).toBe("f2.image/webp");
    expect(art.sharePath).toBe("f3.image/jpeg");
    expect(steps).toEqual(["converting", "uploading"]);
  });

  it("reports a failed upload so that one picture can be retried", async () => {
    fakeCanvases((type) => type);
    await expect(
      processPanelImage(blobOf("image/png"), {
        corner: "bottom-right",
        withShare: false,
        uploader: {
          signedUpload: async () => ({ path: "p", token: "t" }),
          send: async () => {
            throw new Error("offline");
          },
        },
      })
    ).rejects.toThrow("offline");
  });
});
