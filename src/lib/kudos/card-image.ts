/**
 * A kudos card as an image, on white like the printed cards, for a visitor
 * to download or hand to their phone's share sheet. Browser only.
 */

import { toBlob } from "html-to-image";

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

/** The card element as a PNG on white paper. */
export async function cardImage(card: HTMLElement): Promise<Blob> {
  const blob = await toBlob(card, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });
  if (!blob) throw new Error("Couldn't make the card image.");
  return blob;
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
