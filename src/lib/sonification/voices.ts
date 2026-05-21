import type { FilterPreset, Voice, VoiceId } from "./types";

export const voices: Record<VoiceId, Voice> = {
  pluck: {
    id: "pluck",
    wave: "triangle",
    attack: 0.005,
    decay: 0.08,
    sustain: 0.25,
    release: 0.18,
    peak: 0.35,
    toneHz: 4500,
  },
  blip: {
    id: "blip",
    wave: "sine",
    attack: 0.002,
    decay: 0.03,
    sustain: 0.0,
    release: 0.04,
    peak: 0.28,
  },
  chord: {
    id: "chord",
    wave: "triangle",
    attack: 0.01,
    decay: 0.12,
    sustain: 0.45,
    release: 0.6,
    peak: 0.22,
    toneHz: 6000,
    detuneCents: 4,
  },
  pad: {
    id: "pad",
    wave: "sawtooth",
    attack: 0.6,
    decay: 0.3,
    sustain: 0.5,
    release: 1.2,
    peak: 0.18,
    toneHz: 1800,
    detuneCents: 8,
  },
  drone: {
    id: "drone",
    wave: "sine",
    attack: 1.5,
    decay: 0.0,
    sustain: 0.5,
    release: 2.0,
    peak: 0.12,
    toneHz: 900,
  },
  dissonant: {
    id: "dissonant",
    wave: "square",
    attack: 0.005,
    decay: 0.05,
    sustain: 0.1,
    release: 0.14,
    peak: 0.18,
    toneHz: 3000,
  },
  click: {
    id: "click",
    wave: "square",
    attack: 0.001,
    decay: 0.02,
    sustain: 0.0,
    release: 0.03,
    peak: 0.16,
    toneHz: 2200,
  },
  // "breath" — the deliberately-near-imperceptible voice for navigation
  // chrome that should sound like background ambience, not a confirmation.
  //
  // Design tenets, in order of importance:
  //  1. **Sine wave** — zero harmonics, no buzziness or grit. Every other
  //     voice has either harmonic content (triangle/sawtooth) or noise
  //     character (square) that contributes to a "harsh" perceptual
  //     quality. Sine is the only purely smooth waveform.
  //  2. **Ramped attack (25ms)** — no transient click. Most UI voices
  //     have a 1–5ms attack so they read as "snappy". For nav chrome we
  //     want zero perceptual onset; 25ms is the threshold around which
  //     the ear stops hearing a discrete attack edge and just hears
  //     "the note is there".
  //  3. **Quiet peak (0.10)** — half the amplitude of `blip` or `click`
  //     at full velocity. Combined with low palette velocity, the
  //     effective amplitude is ~0.05, which sits well below the main
  //     content sounds of any tool.
  //  4. **No voice-local lowpass** (no toneHz). The sine wave produces
  //     no harmonics to filter, so a lowpass would only add envelope
  //     coloration without benefit. The palette can still apply a
  //     filter preset per-event if needed.
  breath: {
    id: "breath",
    wave: "sine",
    attack: 0.025,
    decay: 0.05,
    sustain: 0.0,
    release: 0.12,
    peak: 0.10,
  },
};

export const filterPresets: Record<FilterPreset, number> = {
  bright: 12000,
  open: 7000,
  warm: 3000,
  muffled: 900,
};
