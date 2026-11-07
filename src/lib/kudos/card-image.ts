/**
 * A kudos card as an image, on white like the printed cards, for a visitor
 * to download or hand to their phone's share sheet. Browser only.
 */

import { toBlob } from "html-to-image";

/** A 1×1 transparent GIF, drawn in place of a panel that couldn't be fetched. */
const BLANK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Longest the image waits for the card's pictures before drawing what it has. */
const IMAGES_WAIT_MS = 8_000;

/** Longest it waits for a panel's sharper file before drawing the one on screen. */
const SHARPER_WAIT_MS = 4_000;

export interface CardImageOptions {
  /** Longest to wait for the card's pictures to load; IMAGES_WAIT_MS by default. */
  imagesWaitMs?: number;
  /** Longest to wait for a panel's sharper file; SHARPER_WAIT_MS by default. */
  sharperWaitMs?: number;
}

/**
 * The waits for the share sheet, which a browser opens only within about 5 s
 * of the click (its transient activation): both waits and the capture itself
 * have to fit. The card on screen has usually loaded, and warmCardImage
 * usually has the sharper file cached, long before the click.
 */
export const SHARE_IMAGE_OPTIONS: Required<CardImageOptions> = {
  imagesWaitMs: 2_000,
  sharperWaitMs: 1_000,
};

/** The image's file name: who it's for, kept to letters and digits. */
export function cardImageName(toName: string): string {
  const slug =
    toName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "recipient";
  return `kudos-to-${slug}.png`;
}

/** Each picture in the card loaded and decoded, or failed: never rejects. */
function imageSettled(img: HTMLImageElement): Promise<void> {
  if (img.complete) {
    return typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

async function imagesSettled(card: HTMLElement, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(Array.from(card.querySelectorAll("img"), imageSettled)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  clearTimeout(timer);
}

/** Safari and every iOS browser: the first capture there often paints pictures blank. */
function isWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}

interface SrcsetFile {
  url: string;
  width: number;
}

/** The files a srcset offers with their widths ("a.webp 360w"); files without one are skipped. */
function srcsetFiles(srcset: string | null): SrcsetFile[] {
  if (!srcset) return [];
  const files: SrcsetFile[] = [];
  for (const candidate of srcset.split(",")) {
    const [url, descriptor = ""] = candidate.trim().split(/\s+/);
    const width = /^\d+w$/.test(descriptor) ? Number.parseInt(descriptor, 10) : Number.NaN;
    if (url && Number.isFinite(width)) files.push({ url, width });
  }
  return files;
}

/** The widest file a srcset offers ("a.webp 360w, b.webp 720w" gives b.webp), or null. */
export function widestSource(srcset: string | null): string | null {
  let widest: SrcsetFile | null = null;
  for (const file of srcsetFiles(srcset)) {
    if (!widest || file.width > widest.width) widest = file;
  }
  return widest?.url ?? null;
}

/**
 * A loaded picture's size in the file's own pixels. For a file picked from a
 * srcset by width, naturalWidth is the width the layout gives it (the 360 px
 * file in a 260 px slot reports 260), so the file's own width comes from its
 * srcset entry instead.
 */
function filePixelSize(img: HTMLImageElement): { width: number; height: number } {
  const shown = srcsetFiles(img.getAttribute("srcset")).find(
    (file) => absoluteUrl(file.url) === img.currentSrc
  );
  if (!shown) return { width: img.naturalWidth, height: img.naturalHeight };
  return {
    width: shown.width,
    height: Math.round((shown.width * img.naturalHeight) / img.naturalWidth),
  };
}

/**
 * A decoded picture's pixels, at the file's own size, as a PNG data URL. Null
 * when it hasn't loaded or can't be read (no canvas here, or a picture loaded
 * without CORS).
 */
function pixelsOf(img: HTMLImageElement): string | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  try {
    const { width, height } = filePixelSize(img);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * `url` loaded CORS-mode, or null when it fails or takes too long. Not
 * decode()d: drawing it decodes it, and Chrome holds decode() for a picture
 * off the page until the tab is visible again.
 */
function loadPicture(url: string, waitMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const picture = new Image();
    const finish = (result: HTMLImageElement | null) => {
      clearTimeout(timer);
      picture.onload = null;
      picture.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    picture.onload = () => finish(picture);
    picture.onerror = () => finish(null);
    // Before src, like the panel on screen: CORS-mode, so the canvas can read it.
    picture.crossOrigin = "anonymous";
    picture.src = url;
  });
}

/**
 * The sharpest pixels to hand the capture for one picture. A screen below 2x
 * shows the 360 px panel, which the capture would stretch over 520 px, so the
 * widest file in its srcset is fetched once, here, unless it is the one on
 * screen already; when that fails or takes too long (offline, a slow line),
 * the picture as it is on screen. Null when neither can be read.
 */
async function sharpestPixels(img: HTMLImageElement, waitMs: number): Promise<string | null> {
  const widest = sharperSource(img);
  if (widest) {
    const sharper = await loadPicture(widest, waitMs);
    const pixels = sharper && pixelsOf(sharper);
    if (pixels) return pixels;
  }
  return pixelsOf(img);
}

/** The widest file in a picture's srcset, as an absolute URL, when it isn't the one on screen. */
function sharperSource(img: HTMLImageElement): string | null {
  const widest = absoluteUrl(widestSource(img.getAttribute("srcset")));
  return widest && widest !== img.currentSrc ? widest : null;
}

function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return null;
  }
}

/**
 * Starts fetching each panel's sharper file (see sharpestPixels) as soon as
 * the card is on screen, so a download or share made from it finds the file
 * in the browser's cache instead of waiting on the network after the click.
 * A picture still loading is looked at once it has: until then the screen
 * hasn't picked its file. Returns the undo for those.
 */
export function warmCardImage(card: HTMLElement): () => void {
  const pending: (() => void)[] = [];
  for (const img of Array.from(card.querySelectorAll("img"))) {
    const warm = () => {
      const widest = sharperSource(img);
      if (!widest) return;
      const picture = new Image();
      picture.crossOrigin = "anonymous";
      picture.src = widest;
    };
    if (img.complete) {
      warm();
    } else {
      img.addEventListener("load", warm, { once: true });
      pending.push(() => img.removeEventListener("load", warm));
    }
  }
  return () => pending.forEach((stop) => stop());
}

function restoreAttribute(img: HTMLImageElement, name: string, value: string | null): void {
  if (value === null) img.removeAttribute(name);
  else img.setAttribute(name, value);
}

/**
 * Points each picture at its own pixels for the capture, and returns the
 * undo. html-to-image leaves a data URL as it is, so it fetches no panel
 * itself: not one that fails offline, and not a URL whose failed fetch it has
 * already cached as a blank for the rest of the tab.
 */
async function embedPixels(card: HTMLElement, waitMs: number): Promise<() => void> {
  const pictures = Array.from(card.querySelectorAll("img"), (img) => ({
    img,
    src: img.getAttribute("src"),
    srcset: img.getAttribute("srcset"),
  }));
  const found = await Promise.all(pictures.map(({ img }) => sharpestPixels(img, waitMs)));
  const undo: (() => void)[] = [];
  pictures.forEach(({ img, src, srcset }, i) => {
    const pixels = found[i];
    // None, or React drew another picture there while these were fetched.
    if (!pixels || img.getAttribute("src") !== src || img.getAttribute("srcset") !== srcset) {
      return;
    }
    img.removeAttribute("srcset");
    img.setAttribute("src", pixels);
    undo.push(() => {
      // React drew another card meanwhile: its picture stays as React set it.
      if (img.getAttribute("src") !== pixels) return;
      restoreAttribute(img, "srcset", srcset);
      restoreAttribute(img, "src", src);
    });
  });
  return () => undo.forEach((restore) => restore());
}

/**
 * The card element as a PNG on white paper, each panel from its sharpest
 * file (see sharpestPixels). A picture neither way could read is fetched by
 * html-to-image (no cacheBust, so it can come from the browser's cache), and
 * one it can't fetch or read is left blank instead of failing the whole image.
 */
export async function cardImage(
  card: HTMLElement,
  { imagesWaitMs = IMAGES_WAIT_MS, sharperWaitMs = SHARPER_WAIT_MS }: CardImageOptions = {}
): Promise<Blob> {
  await imagesSettled(card, imagesWaitMs);
  const options = {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    imagePlaceholder: BLANK_IMAGE,
    // An error page fetched as a panel fails to decode: draw on without it.
    onImageErrorHandler: () => undefined,
  };
  const restore = await embedPixels(card, sharperWaitMs);
  try {
    if (isWebKit()) await toBlob(card, options);
    const blob = await toBlob(card, options);
    if (!blob) throw new Error("Couldn't make the card image.");
    return blob;
  } finally {
    restore();
  }
}

/** Save `blob` as `name` through a temporary link. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Whether this browser's share sheet takes an image file (phones, mostly). */
export function canShareImage(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Hand the card image and its link to the share sheet. Resolves false when the
 * person closed the sheet, and throws when sharing itself failed.
 */
export async function shareCardImage(blob: Blob, name: string, link: string): Promise<boolean> {
  const file = new File([blob], name, { type: "image/png" });
  try {
    // Some share targets drop `url` when files ride along, so the link goes in the text too.
    await navigator.share({ files: [file], title: "A kudos card for you", text: link });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return false;
    throw err;
  }
}
