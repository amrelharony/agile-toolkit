// Major pentatonic: root, maj2, maj3, P5, maj6
export const PENTATONIC = [0, 2, 4, 7, 9] as const;

// MIDI number → frequency (Hz). A4 = 69 = 440 Hz.
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Resolve a pentatonic scale step (negatives + 5+ both supported by wrapping
 * octaves) into a MIDI number, given a root MIDI note.
 */
export function stepToMidi(step: number, rootMidi: number): number {
  const scaleLen = PENTATONIC.length;
  const octaveOffset = Math.floor(step / scaleLen);
  let idx = step % scaleLen;
  if (idx < 0) idx += scaleLen;
  return rootMidi + octaveOffset * 12 + PENTATONIC[idx];
}

export function stepToFreq(step: number, rootMidi: number): number {
  return midiToFreq(stepToMidi(step, rootMidi));
}

/**
 * Map a steps[] chord to frequencies given a root.
 */
export function chordFreqs(steps: number[], rootMidi: number): number[] {
  return steps.map((s) => stepToFreq(s, rootMidi));
}

/**
 * Slowly drift the root key based on a 0..1 progress value (e.g. scroll depth).
 * Uses a fixed ring of keys that always sound pleasant against each other.
 */
const DRIFT_KEYS = [
  // MIDI numbers: C3=48 rebased per octave.  We stay within one octave span.
  60, // C4
  62, // D4
  64, // E4
  67, // G4
  69, // A4
  65, // F4
  59, // B3 (minor feel)
];

export function driftRoot(progress01: number): number {
  if (!Number.isFinite(progress01)) return DRIFT_KEYS[0];
  const p = Math.max(0, Math.min(1, progress01));
  const idx = Math.min(DRIFT_KEYS.length - 1, Math.floor(p * DRIFT_KEYS.length));
  return DRIFT_KEYS[idx];
}

/**
 * Map a semitone offset relative to a root (for dissonant / chromatic events).
 */
export function semitoneFreq(semitoneOffset: number, rootMidi: number): number {
  return midiToFreq(rootMidi + semitoneOffset);
}

/**
 * Shift a frequency up/down N octaves.
 */
export function octaveShift(freq: number, octaves: number): number {
  return freq * Math.pow(2, octaves);
}
