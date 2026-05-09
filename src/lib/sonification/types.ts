export type Waveform = "sine" | "triangle" | "sawtooth" | "square";

export type FilterPreset = "bright" | "warm" | "muffled" | "open";

export type VoiceId =
  | "pluck"
  | "blip"
  | "chord"
  | "pad"
  | "drone"
  | "dissonant"
  | "click";

export interface Voice {
  id: VoiceId;
  wave: Waveform;
  /** Seconds. */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** 0..1 peak gain of the voice before master. */
  peak: number;
  /** Optional voice-local lowpass cutoff (Hz). */
  toneHz?: number;
  /** Optional detune in cents for doubled oscillators. */
  detuneCents?: number;
}

export interface PaletteEntry {
  /** Name of a Voice preset from voices.ts */
  voice: VoiceId;
  /** Single-note step within the pentatonic scale, or... */
  step?: number;
  /** ...a chord of scale steps, played simultaneously. */
  steps?: number[];
  /** Octave above the drifted root (default 5). */
  octave?: number;
  /** Override voice duration (release time override, seconds). */
  duration?: number;
  /** Optional filter flavor applied voice-locally. */
  filter?: FilterPreset;
  /** Small per-event detune for variety, cents. */
  jitterCents?: number;
  /** Optional fixed velocity scaling 0..1. */
  velocity?: number;
}

export type ToolPalette = Record<string, PaletteEntry>;

export type PaletteMap = Record<string, ToolPalette>;

export type SonificationMode = "full" | "minimal" | "ambient";

export interface SonificationPrefs {
  enabled: boolean;
  masterVolume: number;
  mode: SonificationMode;
  respectReducedMotion: boolean;
  lastAutoplayError?: string;
}
