/**
 * Emotion Engine — globally synchronized mood state that drives animation
 * curves, durations, and stagger scalars across the toolkit.
 *
 * The engine is deliberately multi-source: a webcam-based detector could plug
 * in here, but absent that we derive mood from live Cairo weather + time of
 * day so the UI breathes with the author's environment.
 */

export type Mood =
  | "Playful"
  | "Focused"
  | "Melancholy"
  | "Energetic"
  | "Calm"
  | "Neutral";

/** Where a mood signal came from — used for priority resolution and telemetry. */
export type MoodSource =
  | "user"        // explicit user override (highest priority)
  | "webcam"      // hypothetical facial-expression detector
  | "weather"     // Cairo weather fallback
  | "time"        // time-of-day signal
  | "activity"    // inferred from click/scroll/keyboard rhythm
  | "default";    // baseline when no signal has been received

export interface MoodProfile {
  /** Duration scalar — multiplies base animation durations. */
  ds: number;
  /** Stagger scalar — multiplies per-item stagger offsets. */
  ss: number;
  /** Primary GSAP ease string for action tweens. */
  ease: string;
  /** Ease used specifically for scroll-reveal enter animations. */
  reveal: string;
  /** Overshoot multiplier for `back.*` derived eases. 0 disables overshoot. */
  overshoot: number;
  /** Framer-motion–friendly alternates (spring-safe). */
  framer: { duration: number; ease: number[] };
  /** Drift velocity multiplier forwarded to tsparticles move.speed. */
  particleSpeed: number;
  /** Accent tint applied when the weather is the dominant source. */
  accentShift?: string;
}

export interface MoodSignal {
  mood: Mood;
  source: MoodSource;
  /** Confidence 0..1 — weather is ~0.6, explicit user is 1, webcam varies. */
  confidence: number;
  /** Age of signal in ms before it's considered stale. Default 30 minutes. */
  ttlMs?: number;
  /** Timestamp when the signal was recorded. */
  at: number;
}

export interface MoodResolution {
  active: Mood;
  source: MoodSource;
  profile: MoodProfile;
  signals: MoodSignal[];
}

export type MoodListener = (resolution: MoodResolution) => void;
