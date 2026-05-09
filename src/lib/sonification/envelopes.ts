import type { Voice } from "./types";

/**
 * Apply an ADSR envelope to a GainNode, starting at time `start`.
 * Returns the time at which the release completes (voice is safe to dispose).
 */
export function applyADSR(
  gain: GainNode,
  ctx: AudioContext,
  voice: Voice,
  velocity = 1,
  start?: number
): number {
  const now = start ?? ctx.currentTime;
  const peak = Math.max(0, Math.min(1, voice.peak * velocity));
  const attack = Math.max(0.001, voice.attack);
  const decay = Math.max(0.001, voice.decay);
  const sustain = Math.max(0, Math.min(peak, voice.sustain * peak));
  const release = Math.max(0.01, voice.release);

  const g = gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.0001, now);
  // Exponential ramps can't hit 0, use tiny non-zero targets.
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + attack);
  g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), now + attack + decay);

  const releaseStart = now + attack + decay;
  g.setValueAtTime(Math.max(0.0001, sustain), releaseStart);
  g.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  return releaseStart + release;
}

/**
 * Quick linear fade-out to silence over `duration` seconds, starting now.
 */
export function fadeOut(gain: GainNode, ctx: AudioContext, duration = 0.01) {
  const now = ctx.currentTime;
  const current = gain.gain.value;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(current, now);
  gain.gain.linearRampToValueAtTime(0, now + duration);
}
