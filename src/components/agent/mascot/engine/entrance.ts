/**
 * GSAP entrance — ported from the vanilla mascot's createEntranceTimeline
 * (Personal Website mascot-assistant.js 1403-1448). The model pops in with an
 * elastic scale-up, the accent light fades in, and an emission pulse flashes.
 *
 * The source's cloud-spiral / ring-expand tweens are intentionally omitted —
 * the ultra particles are disabled at source (counts 0), so they animate
 * nothing. The 'open' sound hook is added in Phase 11 (audio).
 */

import { gsap } from "gsap";
import type * as THREE from "three";
import type { HoloUniforms } from "./holo-shader";

export interface EntranceOpts {
  model: THREE.Object3D;
  baseScale: number;
  uniforms: HoloUniforms;
  accent: THREE.PointLight;
  /** Reduced-motion master gate — skip straight to the final state. */
  reducedMotion: boolean;
}

/**
 * Play the entrance. Returns the timeline so the caller can kill it on unmount,
 * or null when reduced-motion short-circuits to the final state.
 */
export function playEntrance(opts: EntranceOpts): gsap.core.Timeline | null {
  const { model, baseScale, uniforms, accent, reducedMotion } = opts;

  if (reducedMotion) {
    model.scale.setScalar(baseScale);
    return null;
  }

  model.scale.set(0.01, 0.01, 0.01);
  const origAccent = accent.intensity;
  accent.intensity = 0;

  const tl = gsap.timeline();
  tl.to(
    model.scale,
    { x: baseScale, y: baseScale, z: baseScale, duration: 0.6, ease: "elastic.out(1,0.5)" },
    0
  );
  tl.to(accent, { intensity: origAccent, duration: 0.5 }, 0.3);
  tl.to(uniforms.uEmissionPulse, { value: 0.6, duration: 0.3 }, 0.5);
  tl.to(uniforms.uEmissionPulse, { value: 0, duration: 0.8 }, 0.8);
  return tl;
}
