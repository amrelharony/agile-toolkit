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

async function imagesSettled(card: HTMLElement): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(Array.from(card.querySelectorAll("img"), imageSettled)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, IMAGES_WAIT_MS);
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

/**
 * What a loaded picture shows, as a PNG data URL: the file the screen picked
 * from its srcset, already decoded. Null when it hasn't loaded or can't be
 * read (no canvas here, or a picture loaded without CORS).
 */
function shownPixels(img: HTMLImageElement): string | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function restoreAttribute(img: HTMLImageElement, name: string, value: string | null): void {
  if (value === null) img.removeAttribute(name);
  else img.setAttribute(name, value);
}

/**
 * Points each loaded picture at its own pixels for the capture, and returns
 * the undo. html-to-image leaves a data URL as it is, so it fetches no panel:
 * not the 720 px file a screen that showed the 360 px one never loaded (which
 * fails offline), and not a URL whose failed fetch it has already cached as
 * a blank for the rest of the tab.
 */
function embedShownPixels(card: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (const img of Array.from(card.querySelectorAll("img"))) {
    const pixels = shownPixels(img);
    if (!pixels) continue;
    const src = img.getAttribute("src");
    const srcset = img.getAttribute("srcset");
    img.removeAttribute("srcset");
    img.setAttribute("src", pixels);
    undo.push(() => {
      // React drew another card meanwhile: its picture stays as React set it.
      if (img.getAttribute("src") !== pixels) return;
      restoreAttribute(img, "srcset", srcset);
      restoreAttribute(img, "src", src);
    });
  }
  return () => undo.forEach((restore) => restore());
}

/**
 * The card element as a PNG on white paper, from the pictures as they are
 * on screen. A picture that hadn't loaded is fetched by html-to-image (no
 * cacheBust, so it can come from the browser's cache), and one it can't
 * fetch or read is left blank instead of failing the whole image.
 */
export async function cardImage(card: HTMLElement): Promise<Blob> {
  await imagesSettled(card);
  const options = {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    imagePlaceholder: BLANK_IMAGE,
    // An error page fetched as a panel fails to decode: draw on without it.
    onImageErrorHandler: () => undefined,
  };
  const restore = embedShownPixels(card);
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
