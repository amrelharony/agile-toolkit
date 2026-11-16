/**
 * The facilitator's sounds, made in the browser with the Web Audio API:
 * no audio files to download or license.
 *
 *   - Soundboard: a drumroll, a gong, applause and a ding, each a short
 *     one-off on its own AudioContext (closed after), like the timers'
 *     chime (lib/celebrate/chime.ts).
 *   - Focus sounds: soft rain, a low hum or slow waves, from noise shaped by
 *     filters, looping until stopped. Off unless someone presses play.
 *
 * Browsers only play audio after a gesture, and every sound here starts
 * from a button press. Nothing here draws anything: sound only. Without
 * Web Audio (an old browser, a sandboxed frame) every call does nothing.
 */

export const SOUNDBOARD_SOUNDS = ["drumroll", "gong", "applause", "ding"] as const;
export type SoundboardSound = (typeof SOUNDBOARD_SOUNDS)[number];

export const SOUNDBOARD_LABEL: Record<SoundboardSound, string> = {
  drumroll: "Drumroll",
  gong: "Gong",
  applause: "Applause",
  ding: "Ding",
};

export const FOCUS_SOUNDS = ["rain", "hum", "waves"] as const;
export type FocusSound = (typeof FOCUS_SOUNDS)[number];

export const FOCUS_SOUND_LABEL: Record<FocusSound, string> = {
  rain: "Soft rain",
  hum: "Low hum",
  waves: "Slow waves",
};

export function isFocusSound(value: unknown): value is FocusSound {
  return FOCUS_SOUNDS.includes(value as FocusSound);
}

type Ctx = AudioContext;
type CtxClass = new () => AudioContext;

/** The browser's AudioContext class, or null. */
function contextClass(): CtxClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: CtxClass; webkitAudioContext?: CtxClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function canPlaySounds(): boolean {
  return contextClass() !== null;
}

/** How each kind of noise is coloured: white, pink (softer highs) or brown (deep). */
export type NoiseColour = "white" | "pink" | "brown";

/**
 * Fill `out` with noise of `colour`, from `random` (default Math.random).
 * Pink uses Paul Kellet's economy filter; brown is leaky integrated white.
 * Values stay within -1..1.
 */
export function fillNoise(
  out: Float32Array,
  colour: NoiseColour,
  random: () => number = Math.random
): Float32Array {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const white = random() * 2 - 1;
    let v = white;
    if (colour === "pink") {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      v = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    } else if (colour === "brown") {
      last = (last + 0.02 * white) / 1.02;
      v = last * 3.5;
    }
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

function noiseBuffer(ctx: Ctx, seconds: number, colour: NoiseColour): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  fillNoise(buffer.getChannelData(0), colour);
  return buffer;
}

/** A short envelope on `gain`: up to `peak` in `attack` s, down to silence over `decay` s. */
function envelope(gain: GainNode, at: number, peak: number, attack: number, decay: number): void {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

/** A sine (or other) tone through its own envelope. */
function tone(
  ctx: Ctx,
  out: AudioNode,
  {
    at,
    freq,
    peak,
    attack = 0.005,
    decay,
    type = "sine",
    glide,
  }: {
    at: number;
    freq: number;
    peak: number;
    attack?: number;
    decay: number;
    type?: OscillatorType;
    /** Frequency it falls to over the decay. */
    glide?: number;
  }
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + attack + decay);
  envelope(gain, at, peak, attack, decay);
  osc.connect(gain);
  gain.connect(out);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

/** A burst of noise through a band-pass filter: a clap, a snare hit. */
function burst(
  ctx: Ctx,
  out: AudioNode,
  noise: AudioBuffer,
  {
    at,
    peak,
    decay,
    freq,
    q = 1,
    type = "bandpass",
  }: {
    at: number;
    peak: number;
    decay: number;
    freq: number;
    q?: number;
    type?: BiquadFilterType;
  }
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, at);
  filter.Q.setValueAtTime(q, at);
  const gain = ctx.createGain();
  envelope(gain, at, peak, 0.002, decay);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  const offset = Math.random() * Math.max(0, noise.duration - decay - 0.1);
  src.start(at, offset, decay + 0.05);
}

/** Each sound's length in seconds, so its context can be closed after. */
export const SOUNDBOARD_SECONDS: Record<SoundboardSound, number> = {
  drumroll: 3.4,
  gong: 6,
  applause: 3.6,
  ding: 2,
};

function scheduleSound(ctx: Ctx, out: AudioNode, sound: SoundboardSound): void {
  const t0 = ctx.currentTime + 0.02;
  if (sound === "ding") {
    // A small bell: a bright fundamental, a softer octave and an inharmonic partial.
    tone(ctx, out, { at: t0, freq: 1318.5, peak: 0.35, decay: 1.6 });
    tone(ctx, out, { at: t0, freq: 2637, peak: 0.12, decay: 0.9 });
    tone(ctx, out, { at: t0, freq: 3626, peak: 0.05, decay: 0.5 });
    return;
  }
  if (sound === "gong") {
    // Inharmonic partials of a low strike, each fading at its own pace, plus the mallet's thud.
    const base = 98;
    const partials = [
      [1, 0.4, 5.5],
      [1.47, 0.22, 4.2],
      [2.09, 0.16, 3.4],
      [2.56, 0.1, 2.6],
      [3.12, 0.07, 2],
      [4.2, 0.04, 1.4],
    ] as const;
    for (const [ratio, peak, decay] of partials) {
      tone(ctx, out, {
        at: t0,
        freq: base * ratio,
        peak,
        attack: 0.02,
        decay,
        glide: base * ratio * 0.985,
      });
    }
    const noise = noiseBuffer(ctx, 0.6, "brown");
    burst(ctx, out, noise, { at: t0, peak: 0.25, decay: 0.35, freq: 220, type: "lowpass" });
    return;
  }
  const noise = noiseBuffer(ctx, 2, "white");
  if (sound === "drumroll") {
    // A snare roll that speeds up and swells for 2.4 s, then a hit and a cymbal.
    const rollEnd = 2.4;
    let t = 0;
    while (t < rollEnd) {
      const progress = t / rollEnd;
      burst(ctx, out, noise, {
        at: t0 + t,
        peak: 0.05 + 0.2 * progress,
        decay: 0.06,
        freq: 1900,
        q: 0.8,
      });
      t += 0.075 - 0.03 * progress;
    }
    const hit = t0 + rollEnd + 0.05;
    tone(ctx, out, { at: hit, freq: 110, peak: 0.45, decay: 0.5, glide: 55 });
    burst(ctx, out, noise, { at: hit, peak: 0.3, decay: 0.12, freq: 1800 });
    burst(ctx, out, noise, { at: hit, peak: 0.14, decay: 0.8, freq: 6000, type: "highpass" });
    return;
  }
  // Applause: many short claps at random moments, swelling then fading out.
  const length = 3.2;
  let t = 0;
  while (t < length) {
    const swell = t < 0.4 ? t / 0.4 : t > length - 1.2 ? (length - t) / 1.2 : 1;
    burst(ctx, out, noise, {
      at: t0 + t,
      peak: 0.04 + 0.12 * swell * Math.random(),
      decay: 0.02 + 0.02 * Math.random(),
      freq: 900 + 1600 * Math.random(),
      q: 1.2,
    });
    t += 0.008 + 0.03 * Math.random();
  }
}

/**
 * Play a soundboard sound once, at `volume` (0–1), on a fresh AudioContext
 * that closes once it has finished. Returns whether it could play.
 */
export function playSoundboard(sound: SoundboardSound, volume = 0.8): boolean {
  const Ctx = contextClass();
  if (!Ctx) return false;
  try {
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), ctx.currentTime);
    master.connect(ctx.destination);
    scheduleSound(ctx, master, sound);
    setTimeout(
      () => void ctx.close().catch(() => undefined),
      (SOUNDBOARD_SECONDS[sound] + 0.5) * 1000
    );
    return true;
  } catch {
    /* No audio here (sandboxed frame, blocked context): nothing to do. */
    return false;
  }
}

/** A focus sound that is playing: stop it, or change its volume. */
export interface FocusSoundHandle {
  sound: FocusSound;
  setVolume: (volume: number) => void;
  stop: () => void;
}

/** How loud each focus sound is at full volume: they are background, never loud. */
const FOCUS_LEVEL: Record<FocusSound, number> = { rain: 0.35, hum: 0.5, waves: 0.45 };

/**
 * Start a focus sound looping at `volume` (0–1), fading in over a second.
 * Null when there is no Web Audio here.
 */
export function startFocusSound(sound: FocusSound, volume: number): FocusSoundHandle | null {
  const Ctx = contextClass();
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const master = ctx.createGain();
    const level = (v: number) => Math.min(1, Math.max(0, v)) * FOCUS_LEVEL[sound];
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(level(volume), now + 1);
    master.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 6, sound === "rain" ? "pink" : "brown");
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.setValueAtTime(sound === "rain" ? 5200 : sound === "hum" ? 260 : 700, now);
    src.connect(low);
    let tail: AudioNode = low;
    if (sound === "rain") {
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.setValueAtTime(380, now);
      low.connect(high);
      tail = high;
    }
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(1, now);
    tail.connect(swell);
    swell.connect(master);
    let lfo: OscillatorNode | null = null;
    if (sound === "waves") {
      // A wave every ten seconds or so: the level rises and falls slowly.
      lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.09, now);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0.45, now);
      swell.gain.setValueAtTime(0.55, now);
      lfo.connect(depth);
      depth.connect(swell.gain);
      lfo.start(now);
    }
    src.start(now);

    let stopped = false;
    return {
      sound,
      setVolume: (v) => {
        if (stopped) return;
        master.gain.setTargetAtTime(level(v), ctx.currentTime, 0.1);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
        } catch {
          /* already closing */
        }
        setTimeout(() => {
          try {
            src.stop();
            lfo?.stop();
          } catch {
            /* already stopped */
          }
          void ctx.close().catch(() => undefined);
        }, 400);
      },
    };
  } catch {
    return null;
  }
}
