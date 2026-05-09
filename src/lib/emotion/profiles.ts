import type { Mood, MoodProfile } from "./types";

/**
 * MOOD_PROFILES — the tuning table for every animation curve the engine owns.
 *
 * Per the spec:
 *  • Playful   → bouncy, elastic easing with long overshoot
 *  • Focused   → sharp, fast, power4.out
 *  • Melancholy→ gentle 1.4x durations with power2.inOut
 * Each profile also carries a framer-motion–friendly fallback and a particle
 * drift multiplier so the whole stack breathes in sync.
 */
export const MOOD_PROFILES: Record<Mood, MoodProfile> = {
  Playful: {
    ds: 1.0,
    ss: 1.2,
    ease: "elastic.out(1, 0.45)",
    reveal: "back.out(2)",
    overshoot: 1.7,
    framer: { duration: 0.55, ease: [0.34, 1.56, 0.64, 1] },
    particleSpeed: 1.3,
    accentShift: "#ff00aa",
  },
  Focused: {
    ds: 0.6,
    ss: 0.4,
    ease: "power4.out",
    reveal: "power4.out",
    overshoot: 0,
    framer: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
    particleSpeed: 0.6,
    accentShift: "#00e1ff",
  },
  Melancholy: {
    ds: 1.4,
    ss: 1.4,
    ease: "power2.inOut",
    reveal: "sine.inOut",
    overshoot: 0,
    framer: { duration: 0.75, ease: [0.45, 0, 0.55, 1] },
    particleSpeed: 0.35,
    accentShift: "#60a5fa",
  },
  Energetic: {
    ds: 0.75,
    ss: 0.6,
    ease: "expo.out",
    reveal: "power3.out",
    overshoot: 0.4,
    framer: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
    particleSpeed: 1.6,
    accentShift: "#fbbf24",
  },
  Calm: {
    ds: 1.2,
    ss: 1.1,
    ease: "sine.out",
    reveal: "sine.out",
    overshoot: 0,
    framer: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] },
    particleSpeed: 0.5,
    accentShift: "#10b981",
  },
  Neutral: {
    ds: 1.0,
    ss: 1.0,
    ease: "power2.out",
    reveal: "power2.out",
    overshoot: 0,
    framer: { duration: 0.35, ease: [0.4, 0, 0.2, 1] },
    particleSpeed: 1.0,
  },
};

export function getMoodProfile(mood: Mood): MoodProfile {
  return MOOD_PROFILES[mood] ?? MOOD_PROFILES.Neutral;
}

/** CSS variable payload applied at :root when this mood wins. */
export function moodCssVars(mood: Mood): Record<string, string> {
  const p = MOOD_PROFILES[mood];
  return {
    "--mood-duration-scalar": String(p.ds),
    "--mood-stagger-scalar": String(p.ss),
    "--mood-particle-speed": String(p.particleSpeed),
    ...(p.accentShift ? { "--mood-accent": p.accentShift } : {}),
  };
}
