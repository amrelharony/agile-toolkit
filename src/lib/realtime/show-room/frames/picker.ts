/**
 * Picker's show-room frames (a spin result, the names on the wheel, …):
 * frame kind → parser. Empty in the room kit; the Picker builder adds its
 * kinds here, and their renderers in `../renderers/picker.tsx`, so no
 * shared file changes. Every tool also gets the generic "text" frame.
 *
 * A parser takes the payload as JSON gave it and returns exactly what may
 * be drawn, rebuilt field by field with every string run through
 * `cleanText` (and cut to a cap), or null. Keep payloads small: the whole
 * frame must fit `SHOW_LIMITS.maxPayloadChars` (8,000 characters).
 *
 * Pure and server-safe: no React, no browser globals.
 */

import type { ShowFrameParsers } from "../frames";

export const PICKER_FRAMES: ShowFrameParsers = {};
