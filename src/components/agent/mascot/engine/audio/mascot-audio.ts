/**
 * Mascot audio adapter — routes the vanilla mascot's sound cues through the
 * toolkit's own sonification engine instead of porting sono.js.
 *
 * `emit("mascot", event)` inherits all the engine's gating for free: the user's
 * sonification on/off + mode pref, the reduced-motion guard, and the
 * gamification/haptics forwarding. Unknown events are a safe no-op (the palette
 * lookup returns undefined), so callers can pass any reaction name.
 *
 * PARITY NOTE: the source plays literal-Hz chimes/sweeps + a live, breath-
 * modulated ambient drone with per-sound stereo pan. The toolkit engine is
 * musical/pentatonic with a single global pan and no live-mutable drone, so this
 * is a best-effort approximation (see palette.ts `mascot` block). The continuous
 * ambient drone + per-sound pan are intentionally deferred — they would need a
 * parallel oscillator helper that re-implements the engine's pref gating.
 */

import { emit } from "@/lib/sonification/emit";

/**
 * Known mascot sound events (mirrors the `mascot` palette block): lifecycle
 * (open/close/send/answer/mood/error/click) + reactions (spin/wiggle/wave/nod/
 * excited/headShake/thinking/listening/talking). Reactions not in the palette
 * (dance/confused/surprised) no-op.
 */
export function playMascotSound(event: string): void {
  emit("mascot", event);
}
