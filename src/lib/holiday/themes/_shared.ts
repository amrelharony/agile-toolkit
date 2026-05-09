import type { ISourceOptions } from "@tsparticles/engine";

/**
 * Shared tsparticles config builder. Every holiday theme composes this base,
 * then overrides colors/shapes/movement to get its signature feel.
 */
export function baseParticleConfig(overrides: Partial<ISourceOptions> = {}): ISourceOptions {
  return {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    detectRetina: true,
    fpsLimit: 30,
    pauseOnOutsideViewport: true,
    pauseOnBlur: true,
    particles: {
      number: { value: 40, density: { enable: true } },
      color: { value: "#ffffff" },
      opacity: { value: { min: 0.3, max: 0.8 } },
      size: { value: { min: 2, max: 4 } },
      move: { enable: true, speed: 1, direction: "none", outModes: { default: "out" } },
      shape: { type: "circle" },
    },
    ...overrides,
  };
}

export function accentTokens(primary: string, secondary: string, glow: string) {
  return {
    "--holiday-accent": primary,
    "--holiday-accent-2": secondary,
    "--holiday-glow": glow,
  };
}
