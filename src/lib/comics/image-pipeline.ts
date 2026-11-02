/**
 * Turning the owner's picture into what the site serves, in the browser. The
 * original never leaves the device: only the 768 and 1536 px versions go up,
 * each with the credit drawn into it.
 *
 * Phones run out of canvas memory long before they run out of anything else, so
 * this handles one image at a time, releases the decoded bitmap as soon as it's
 * done, and shrinks each canvas to nothing, which is what actually gives the
 * memory back on iOS.
 *
 * Images go straight to Storage on a signed URL, since Vercel caps a request
 * body at about 4.5 MB.
 */

import { COPYRIGHT_NOTICE } from "./rights";
import type { CreditCorner } from "./story-input";

export const SMALL_WIDTH = 768;
export const FULL_WIDTH = 1536;
export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;
export const WEBP_QUALITY = 0.78;
export const JPEG_QUALITY = 0.82;
/** A year. The Storage default of an hour would defeat the long cache on this art. */
export const CACHE_SECONDS = "31536000";
export const BUCKET = "comic-panels";

export const CREDIT_TEXT = `${COPYRIGHT_NOTICE} · agile.amrelharony.com/comics`;

export interface Size {
  width: number;
  height: number;
}

/** The size at `target` wide, keeping the shape. Never larger than the source. */
export function scaledSize(source: Size, target: number): Size {
  const width = Math.min(source.width, target);
  return { width, height: Math.max(1, Math.round((source.height * width) / source.width)) };
}

export function creditFontSize(canvasWidth: number): number {
  return Math.max(12, Math.round(canvasWidth * 0.02));
}

export interface CreditBox {
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  /** For textBaseline "middle". */
  textY: number;
}

/** Where the credit and its backing go, always wholly inside the image. */
export function creditBox(
  canvas: Size,
  textWidth: number,
  fontSize: number,
  corner: CreditCorner
): CreditBox {
  const margin = Math.round(fontSize * 0.5);
  const pad = Math.round(fontSize * 0.4);
  const width = Math.min(canvas.width - margin * 2, Math.ceil(textWidth) + pad * 2);
  const height = Math.round(fontSize * 1.5);
  const x = corner.endsWith("right") ? canvas.width - margin - width : margin;
  const y = corner.startsWith("bottom") ? canvas.height - margin - height : margin;
  return { x, y, width, height, textX: x + pad, textY: y + height / 2 };
}

/**
 * The source rectangle for the 1200 x 630 share image. Taken from nearer the
 * top than the bottom, since the comic's balloons sit high in the frame.
 */
export function shareCrop(source: Size): Size & { x: number; y: number } {
  const ratio = SHARE_WIDTH / SHARE_HEIGHT;
  if (source.width / source.height > ratio) {
    const width = Math.round(source.height * ratio);
    return { x: Math.round((source.width - width) / 2), y: 0, width, height: source.height };
  }
  const height = Math.round(source.width / ratio);
  return { x: 0, y: Math.round((source.height - height) * 0.25), width: source.width, height };
}

function drawCredit(ctx: CanvasRenderingContext2D, canvas: Size, corner: CreditCorner) {
  const fontSize = creditFontSize(canvas.width);
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const box = creditBox(canvas, ctx.measureText(CREDIT_TEXT).width, fontSize, corner);
  // Semi-opaque rather than solid, so it sits on the art instead of cutting a
  // hole in it, and dark on pale so it's readable whatever is underneath.
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillText(CREDIT_TEXT, box.textX, box.textY, box.width - (box.textX - box.x) * 2);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * WebP where the browser can really produce it. iOS Safari doesn't refuse: it
 * quietly hands back a PNG, many times the size and a type the bucket won't
 * take, so the blob's type gets checked rather than trusted.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", WEBP_QUALITY);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (jpeg?.type === "image/jpeg") return jpeg;
  throw new Error("This browser couldn't encode the image.");
}

async function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = await toBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (jpeg?.type === "image/jpeg") return jpeg;
  throw new Error("This browser couldn't encode the share image.");
}

type Source = ImageBitmap;

function renderTo(
  source: Source,
  size: Size,
  corner: CreditCorner,
  crop?: Size & { x: number; y: number }
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't open a canvas.");
  ctx.imageSmoothingQuality = "high";
  if (crop) {
    ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  } else {
    ctx.drawImage(source, 0, 0, size.width, size.height);
  }
  drawCredit(ctx, size, corner);
  return canvas;
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export interface ConvertedPanel {
  full: Blob;
  small: Blob;
  /** Only when asked for: a story has one, cropped from its first panel. */
  share: Blob | null;
  width: number;
  height: number;
}

/** Decode one picture and produce everything the site needs from it. */
export async function convertPanel(
  file: Blob,
  options: { corner: CreditCorner; withShare: boolean }
): Promise<ConvertedPanel> {
  const bitmap = await createImageBitmap(file);
  try {
    const source: Size = { width: bitmap.width, height: bitmap.height };
    const render = async (
      size: Size,
      encode: (c: HTMLCanvasElement) => Promise<Blob>,
      crop?: Size & { x: number; y: number }
    ) => {
      const canvas = renderTo(bitmap, size, options.corner, crop);
      try {
        return await encode(canvas);
      } finally {
        release(canvas);
      }
    };
    const fullSize = scaledSize(source, FULL_WIDTH);
    const full = await render(fullSize, encodeCanvas);
    const small = await render(scaledSize(source, SMALL_WIDTH), encodeCanvas);
    const share = options.withShare
      ? await render({ width: SHARE_WIDTH, height: SHARE_HEIGHT }, encodeJpeg, shareCrop(source))
      : null;
    return { full, small, share, width: fullSize.width, height: fullSize.height };
  } finally {
    bitmap.close();
  }
}

/** The two steps that need a network, passed in so they can be retried and tested. */
export interface ArtUploader {
  /** Ask the owner route for a signed URL. */
  signedUpload(contentType: string): Promise<{ path: string; token: string }>;
  /** Send one blob to Storage on that URL. */
  send(path: string, token: string, blob: Blob): Promise<void>;
}

/** What supabase-js needs for an upload. */
export interface SignedUploadStorage {
  from(bucket: string): {
    uploadToSignedUrl(
      path: string,
      token: string,
      body: Blob,
      options: { cacheControl: string; contentType: string; upsert: boolean }
    ): PromiseLike<{ error: { message: string } | null }>;
  };
}

export async function sendToStorage(
  storage: SignedUploadStorage,
  path: string,
  token: string,
  blob: Blob
): Promise<void> {
  const { error } = await storage.from(BUCKET).uploadToSignedUrl(path, token, blob, {
    cacheControl: CACHE_SECONDS,
    contentType: blob.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
}

async function uploadOne(uploader: ArtUploader, blob: Blob): Promise<string> {
  const { path, token } = await uploader.signedUpload(blob.type);
  await uploader.send(path, token, blob);
  return path;
}

export interface UploadedArt {
  pathFull: string;
  pathSmall: string;
  sharePath: string | null;
  width: number;
  height: number;
}

export type ArtStep = "converting" | "uploading";

/** One picture, start to finish. Throws on failure, and a retry starts it again. */
export async function processPanelImage(
  file: Blob,
  options: {
    corner: CreditCorner;
    withShare: boolean;
    uploader: ArtUploader;
    onStep?: (step: ArtStep) => void;
  }
): Promise<UploadedArt> {
  options.onStep?.("converting");
  const converted = await convertPanel(file, options);
  options.onStep?.("uploading");
  const pathFull = await uploadOne(options.uploader, converted.full);
  const pathSmall = await uploadOne(options.uploader, converted.small);
  const sharePath = converted.share ? await uploadOne(options.uploader, converted.share) : null;
  return { pathFull, pathSmall, sharePath, width: converted.width, height: converted.height };
}
