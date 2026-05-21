import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a hex colour into {r,g,b,a}. Accepts:
 *   - "#RGB"      (4-bit per channel, alpha=1)
 *   - "#RGBA"     (4-bit per channel + alpha)
 *   - "#RRGGBB"   (8-bit, alpha=1)
 *   - "#RRGGBBAA" (8-bit + alpha)
 *
 * Returns `null` on malformed input so callers can distinguish "user typed
 * #000000" from "input was garbage". Previously the function silently
 * returned black for both, leaving colour-picker users staring at a
 * default that looked broken.
 */
export function parseHex(
  input: string
): { r: number; g: number; b: number; a: number } | null {
  const s = (input || "").trim();
  const hex = s.startsWith("#") ? s.slice(1) : s;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  let r: number, g: number, b: number, a = 1;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
    a = parseInt(hex[3] + hex[3], 16) / 255;
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    a = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    return null;
  }
  return { r, g, b, a };
}

/**
 * Back-compat wrapper for callers that expect {r,g,b} silently defaulting
 * to black. New code should use `parseHex` and handle `null` explicitly.
 */
export function parseHexOrBlack(input: string): { r: number; g: number; b: number } {
  const parsed = parseHex(input);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : { r: 0, g: 0, b: 0 };
}
