/**
 * Image import — drag-drop + paste-from-clipboard.
 *
 * Converts a File or Blob into a `WhiteboardImage` object positioned
 * at the supplied world point. Caps payloads at IMAGE_MAX_BYTES so a
 * user can't paste a 50 MB PNG and crash the workspace store / blow
 * past localStorage's 5 MB quota.
 */

import type { WhiteboardImage } from "@/lib/stores/workspace-types";

/** Binary cap. After base64 encoding (data URL), the string is ~1.37×
 * the binary size, so a 4 MB binary becomes ~5.5 MB string. A single
 * such image fills localStorage on its own. We cap binary at 2.5 MB so
 * the data URL string stays under ~3.4 MB and three images on one
 * board fit under the 5 MB localStorage quota. */
export const IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;
/** Hard cap on the encoded data URL string itself — defends against
 * misreporting of file.size. */
export const DATA_URL_MAX_LEN = 3.5 * 1024 * 1024;

/** Whitelisted MIME types. Everything else is rejected before we touch
 * the file. Prevents `image/svg+xml` (XSS via embedded scripts) and
 * `application/pdf` (different code path entirely). */
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export interface ImageImportResult {
  src: string;       // data URL
  w: number;
  h: number;
  alt: string;       // original filename
  bytes: number;
}

/** Read a single file → data URL + natural dimensions. Returns null on
 * unsupported MIME or oversized payload. Resolves with a useful error
 * via the `err` field so callers can show a toast. */
export async function fileToImage(file: File | Blob, name = "image"): Promise<{ ok: true; image: ImageImportResult } | { ok: false; err: string }> {
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, err: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(1)} MB.` };
  }
  // SECURITY: reject empty file.type. Previously the check was
  // `file.type && !ALLOWED_TYPES.has(...)` — an empty string short-
  // circuited the guard, letting renamed `evil.html` files with
  // file.type === "" sneak through as `application/octet-stream`
  // data URLs. We now REQUIRE a recognised MIME from the allowlist.
  if (!file.type || !ALLOWED_TYPES.has(file.type)) {
    return {
      ok: false,
      err: file.type
        ? `Unsupported image type "${file.type}". Allowed: PNG, JPEG, WEBP, GIF, AVIF.`
        : `Unable to identify image type. Please use a PNG, JPEG, WEBP, GIF, or AVIF file.`,
    };
  }
  // Read as data URL — survives localStorage round-trips and works
  // offline. (For very large boards we'd want a server-side URL, but
  // the toolkit is offline-first.)
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error ?? new Error("FileReader failed"));
    r.readAsDataURL(file);
  });
  // Hard cap on the encoded string — defends against misreported
  // file.size and against extreme base64 expansion (some image
  // formats encode worse than the typical 1.37× ratio).
  if (dataUrl.length > DATA_URL_MAX_LEN) {
    return { ok: false, err: `Encoded image too large (${(dataUrl.length / 1024 / 1024).toFixed(1)} MB). Try a smaller image.` };
  }
  // Measure natural dimensions so the canvas can place the image at
  // its real aspect ratio (clamped to 400 px max edge to keep the
  // initial drop reasonable).
  const { w, h } = await new Promise<{ w: number; h: number }>((res) => {
    const img = new Image();
    img.onload = () => {
      const maxEdge = 400;
      const ratio = img.naturalWidth / img.naturalHeight || 1;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxEdge || h > maxEdge) {
        if (ratio >= 1) { w = maxEdge; h = Math.round(maxEdge / ratio); }
        else { h = maxEdge; w = Math.round(maxEdge * ratio); }
      }
      res({ w: Math.max(20, w), h: Math.max(20, h) });
    };
    img.onerror = () => res({ w: 240, h: 160 });
    img.src = dataUrl;
  });
  return {
    ok: true,
    image: { src: dataUrl, w, h, alt: name, bytes: file.size },
  };
}

/** Build a placement-ready WhiteboardImage. Caller fills boardId/id/z. */
export function imageToObject(image: ImageImportResult, world: { x: number; y: number }): Omit<WhiteboardImage, "id" | "boardId" | "z"> {
  const now = new Date().toISOString();
  return {
    type: "image",
    x: world.x - image.w / 2,
    y: world.y - image.h / 2,
    w: image.w,
    h: image.h,
    src: image.src,
    alt: image.alt,
    fit: "contain",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Extract every image File from a DataTransfer / ClipboardData. */
export function extractImageFiles(items: DataTransferItemList | null, files: FileList | null): File[] {
  const out: File[] = [];
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  if (out.length === 0 && files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith("image/")) out.push(f);
    }
  }
  return out;
}
