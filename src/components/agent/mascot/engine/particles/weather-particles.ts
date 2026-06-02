/**
 * Weather particles — ported 1:1 from the vanilla mascot (Personal Website
 * mascot-assistant.js 1570-1667). 8 additive points drift around the mascot;
 * their colour/opacity/motion follow the current weather type. The source reads
 * `localStorage['cairoWeather']`; the toolkit feeds the WMO code from
 * `useWeather()` instead (see `weatherCodeToType`).
 *
 * NB: the source's elaborate 4-layer "ultra particles" are intentionally NOT
 * ported — they are disabled at source (all counts 0, sparkle bursts early-
 * return), so the live site shows only these weather particles + the shader.
 */

import * as THREE from "three";

export type WeatherType = "clear" | "overcast" | "rain" | "snow" | "thunder";

const WEATHER_COUNT = 8;

/** Map a WMO weather code to the mascot's weather type (source 1606-1612). */
export function weatherCodeToType(code: number | null | undefined): WeatherType | null {
  if (code == null || Number.isNaN(code)) return null;
  if (code <= 1) return "clear";
  if (code <= 3) return "overcast";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 95) return "thunder";
  return "overcast";
}

/** Per-type point colour + base opacity (source refreshWeather 1617-1622). */
const STYLE: Record<WeatherType, { color: number; opacity: number }> = {
  clear: { color: 0xfbbf24, opacity: 0.35 },
  rain: { color: 0x60a5fa, opacity: 0.4 },
  snow: { color: 0xe2e8f0, opacity: 0.5 },
  thunder: { color: 0xa855f7, opacity: 0.4 },
  overcast: { color: 0x94a3b8, opacity: 0.2 },
};

interface WeatherPhase {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
}

export interface WeatherUpdateCtx {
  t: number;
  /** Mascot world-X (particles follow the mascot's drift). */
  offX: number;
  /** Mascot world-Y offset from its base position. */
  offY: number;
  /** Accent light, flashed on a thunder strike. */
  accent: THREE.PointLight | null;
  /** Reduced-motion master gate — skip updates when true. */
  reducedMotion: boolean;
}

export interface WeatherParticles {
  setType(type: WeatherType | null): void;
  update(ctx: WeatherUpdateCtx): void;
  dispose(): void;
}

/** Create the weather particle system and add it to the scene. */
export function createWeatherParticles(scene: THREE.Scene): WeatherParticles {
  const phases: WeatherPhase[] = Array.from({ length: WEATHER_COUNT }, () => ({
    x: (Math.random() - 0.5) * 2,
    y: Math.random() * 2,
    z: (Math.random() - 0.5) * 1,
    speed: 0.2 + Math.random() * 0.5,
    phase: Math.random() * 10,
  }));

  const positions = new Float32Array(WEATHER_COUNT * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfbbf24,
    size: 0.025,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 11;
  scene.add(points);

  let type: WeatherType | null = null;
  /** Pending thunder-flash restore — gates out overlapping strikes. */
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function setType(next: WeatherType | null): void {
    type = next;
    if (next) {
      mat.color.set(STYLE[next].color);
      mat.opacity = STYLE[next].opacity;
    } else {
      mat.opacity = 0;
    }
  }

  function update(ctx: WeatherUpdateCtx): void {
    if (!type || ctx.reducedMotion) return;
    const { t, offX, offY } = ctx;
    const pos = positions;
    for (let i = 0; i < WEATHER_COUNT; i++) {
      const wp = phases[i];
      switch (type) {
        case "clear":
          pos[i * 3] = wp.x + Math.sin(t * 0.3 + wp.phase) * 0.2 + offX;
          pos[i * 3 + 1] = ((t * wp.speed * 0.3 + wp.phase) % 2) - 0.5 + offY;
          pos[i * 3 + 2] = wp.z;
          break;
        case "rain":
          pos[i * 3] = wp.x + Math.sin(wp.phase) * 0.1 + offX;
          pos[i * 3 + 1] = 1.5 - ((t * wp.speed * 1.5 + wp.phase * 3) % 3) + offY;
          pos[i * 3 + 2] = wp.z;
          break;
        case "snow":
          pos[i * 3] = wp.x + Math.sin(t * 0.5 + wp.phase) * 0.3 + offX;
          pos[i * 3 + 1] = 1.5 - ((t * wp.speed * 0.2 + wp.phase * 3) % 3) + offY;
          pos[i * 3 + 2] = wp.z + Math.cos(t * 0.3 + wp.phase) * 0.15;
          break;
        case "thunder":
          pos[i * 3] = wp.x + offX;
          pos[i * 3 + 1] = 1.5 - ((t * wp.speed * 1.8 + wp.phase * 3) % 3) + offY;
          pos[i * 3 + 2] = wp.z;
          break;
        default:
          pos[i * 3] = wp.x + Math.sin(t * 0.2 + wp.phase) * 0.1 + offX;
          pos[i * 3 + 1] = wp.y + Math.sin(t * 0.15 + wp.phase) * 0.2 + offY;
          pos[i * 3 + 2] = wp.z;
      }
    }
    geo.attributes.position.needsUpdate = true;

    // Thunder: occasional accent-light flash. The flashTimer guard blocks a
    // second strike mid-flash — otherwise it would read the elevated 2.5 as the
    // "original" and leave the accent stuck bright.
    if (type === "thunder" && ctx.accent && flashTimer === null && Math.random() < 0.002) {
      const accent = ctx.accent;
      const orig = accent.intensity; // always the resting value (no overlap)
      accent.intensity = 2.5;
      flashTimer = setTimeout(() => {
        accent.intensity = orig;
        flashTimer = null;
      }, 100);
    }
  }

  function dispose(): void {
    if (flashTimer !== null) {
      clearTimeout(flashTimer); // don't fire a restore onto a disposed light
      flashTimer = null;
    }
    scene.remove(points);
    geo.dispose();
    mat.dispose();
  }

  return { setType, update, dispose };
}
