/**
 * Skin retint — ported 1:1 from the vanilla mascot (Personal Website
 * mascot-assistant.js `retintSkin`, lines 719-751).
 *
 * The GLB's baseColor texture bakes a generic skin tone. The source recolours
 * warm skin-tone pixels toward a target sampled from the owner's profile photo
 * (forehead #dfa47f, cheek #cf9672, nose #d29a7c → avg ~#d59d7a), blending 60%
 * toward target while preserving each pixel's relative luminance so shading
 * survives. Non-skin pixels (greys, darks, the olive suit, hair) are left
 * untouched by the detection guards.
 *
 * `retintImageData` is the pure pixel pass (unit-tested). `retintSkinTexture`
 * is the thin canvas/DOM wrapper that runs it against a THREE.Texture's image.
 */

import type * as THREE from "three";

/** Target skin RGB (sampled from the profile photo — see file header). */
export const TARGET_R = 213;
export const TARGET_G = 157;
export const TARGET_B = 122;

/** Blend strength toward the target tone (source: `t = 0.6`). */
const BLEND = 0.6;

/**
 * In-place recolour of an RGBA pixel buffer. Mutates `data`. Mirrors the
 * source's per-pixel loop exactly:
 *  - skip non-warm / too-dark / too-grey / too-bright pixels,
 *  - otherwise blend toward (TARGET_* * lum) by BLEND, where lum normalises
 *    brightness around mid-skin (÷140) so highlights/shadows are preserved.
 */
export function retintImageData(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Detect skin: warm tones where R > G > B, not too dark, not grey.
    if (r < 60 || r < g) continue;
    const diff = r - b;
    if (diff < 20) continue; // not warm enough
    if (r - g < 5) continue; // too grey / green
    const brightness = (r + g + b) / 3;
    if (brightness < 50 || brightness > 230) continue; // skip very dark / light
    const saturation = diff / r;
    if (saturation < 0.15) continue; // too grey

    // Blend toward target while preserving relative luminance.
    const lum = brightness / 140; // normalise around mid-skin brightness
    data[i] = Math.min(255, Math.max(0, Math.round(r + (TARGET_R * lum - r) * BLEND)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(g + (TARGET_G * lum - g) * BLEND)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(b + (TARGET_B * lum - b) * BLEND)));
    // alpha (data[i+3]) untouched
  }
}

/**
 * Run the retint against a loaded THREE.Texture's image (browser-only — needs a
 * 2D canvas). No-op when the texture has no decoded image yet. Replaces the
 * texture's image with the recoloured canvas and flags it for re-upload.
 */
export function retintSkinTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture || !texture.image) return;
  const img = texture.image as CanvasImageSource & { width: number; height: number };
  if (!img.width || !img.height) return;

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  retintImageData(id.data);
  ctx.putImageData(id, 0, 0);

  texture.image = canvas;
  texture.needsUpdate = true;
}
