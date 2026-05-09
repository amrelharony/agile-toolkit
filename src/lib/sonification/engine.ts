import { applyADSR, fadeOut } from "./envelopes";
import { filterPresets, voices } from "./voices";
import type { FilterPreset, Voice, VoiceId } from "./types";

const MAX_CONCURRENT_VOICES = 16;

interface ActiveVoice {
  osc: OscillatorNode;
  gain: GainNode;
  endsAt: number;
}

export interface PlayOptions {
  /** Seconds from now to start. Default 0. */
  when?: number;
  /** 0..1 velocity scaling. */
  velocity?: number;
  /** Override release (seconds). */
  duration?: number;
  /** Voice-local filter flavor. */
  filter?: FilterPreset;
  /** Extra detune for variety (cents). */
  jitterCents?: number;
}

export class SonificationEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private scrollFilter: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;
  private active: ActiveVoice[] = [];
  private masterVolume = 0.4;
  private suspendedFlag = false;
  private lastErrorMessage: string | undefined;

  /** Lazy init — must be called from a user gesture (click/keydown). */
  ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        this.lastErrorMessage = "Web Audio API unavailable in this browser.";
        return null;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.scrollFilter = this.ctx.createBiquadFilter();
      this.scrollFilter.type = "lowpass";
      this.scrollFilter.frequency.value = 8000;
      this.scrollFilter.Q.value = 0.7;
      this.panner = this.ctx.createStereoPanner();
      this.panner.pan.value = 0;

      // chain: [voice-out] -> scrollFilter -> panner -> master -> destination
      this.scrollFilter.connect(this.panner);
      this.panner.connect(this.master);
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch (err) {
      this.lastErrorMessage =
        err instanceof Error ? err.message : "Failed to create AudioContext";
      this.ctx = null;
      return null;
    }
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get sharedBus(): AudioNode | null {
    return this.scrollFilter;
  }

  get panNode(): StereoPannerNode | null {
    return this.panner;
  }

  get scrollFilterNode(): BiquadFilterNode | null {
    return this.scrollFilter;
  }

  get lastError(): string | undefined {
    return this.lastErrorMessage;
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.masterVolume, now + 0.06);
    }
  }

  setScrollFilter01(depth01: number) {
    if (!this.scrollFilter || !this.ctx) return;
    const clamped = Math.max(0, Math.min(1, depth01));
    // Log-scale from 500 Hz at top to 14kHz at bottom
    const hz = 500 * Math.pow(14000 / 500, clamped);
    const now = this.ctx.currentTime;
    this.scrollFilter.frequency.cancelScheduledValues(now);
    this.scrollFilter.frequency.setValueAtTime(
      this.scrollFilter.frequency.value,
      now
    );
    this.scrollFilter.frequency.linearRampToValueAtTime(hz, now + 0.2);
  }

  setPan(x01: number) {
    if (!this.panner || !this.ctx) return;
    const pan = Math.max(-1, Math.min(1, x01 * 2 - 1));
    const now = this.ctx.currentTime;
    this.panner.pan.cancelScheduledValues(now);
    this.panner.pan.setValueAtTime(this.panner.pan.value, now);
    this.panner.pan.linearRampToValueAtTime(pan, now + 0.12);
  }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
        this.suspendedFlag = false;
      } catch (err) {
        this.lastErrorMessage =
          err instanceof Error ? err.message : "Resume failed";
      }
    }
  }

  suspend() {
    if (!this.ctx) return;
    if (this.ctx.state === "running") {
      void this.ctx.suspend();
      this.suspendedFlag = true;
    }
  }

  destroy() {
    try {
      this.active.forEach(({ osc, gain }) => {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* fall through */
        }
      });
      this.active = [];
      if (this.ctx) void this.ctx.close().catch(() => undefined);
    } finally {
      this.ctx = null;
      this.master = null;
      this.scrollFilter = null;
      this.panner = null;
    }
  }

  private cullIfNeeded() {
    if (this.active.length < MAX_CONCURRENT_VOICES) return;
    const oldest = this.active.shift();
    if (oldest && this.ctx) {
      fadeOut(oldest.gain, this.ctx, 0.01);
      try {
        oldest.osc.stop(this.ctx.currentTime + 0.02);
      } catch {
        /* already stopped */
      }
    }
  }

  private playOscAt(
    freq: number,
    voice: Voice,
    opts: PlayOptions = {}
  ): ActiveVoice | null {
    // Auto-init on demand so the very first gesture produces sound even if the
    // provider's global unlocker hasn't fired yet (event ordering).
    if (!this.ctx) this.ensureContext();
    if (!this.ctx || !this.scrollFilter) return null;
    if (this.ctx.state === "suspended") {
      void this.resume();
    }
    try {
      this.cullIfNeeded();
      const now = this.ctx.currentTime + (opts.when ?? 0);
      const osc = this.ctx.createOscillator();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(freq, now);
      if (opts.jitterCents) osc.detune.value = opts.jitterCents;
      else if (voice.detuneCents) osc.detune.value = voice.detuneCents;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;

      // Optional voice-local lowpass
      let last: AudioNode = gain;
      let voiceFilter: BiquadFilterNode | null = null;
      const toneHz = opts.filter ? filterPresets[opts.filter] : voice.toneHz;
      if (toneHz !== undefined) {
        voiceFilter = this.ctx.createBiquadFilter();
        voiceFilter.type = "lowpass";
        voiceFilter.frequency.value = toneHz;
        voiceFilter.Q.value = 0.5;
        gain.connect(voiceFilter);
        last = voiceFilter;
      }
      osc.connect(gain);
      last.connect(this.scrollFilter);

      // Apply envelope (optionally override release via duration)
      const adaptedVoice: Voice = opts.duration
        ? { ...voice, release: opts.duration }
        : voice;
      const endsAt = applyADSR(
        gain,
        this.ctx,
        adaptedVoice,
        opts.velocity ?? 1,
        now
      );

      osc.start(now);
      osc.stop(endsAt + 0.1);
      const entry: ActiveVoice = { osc, gain, endsAt };
      this.active.push(entry);
      osc.onended = () => {
        try {
          gain.disconnect();
          osc.disconnect();
          if (voiceFilter) voiceFilter.disconnect();
        } catch {
          /* already disconnected */
        }
        const idx = this.active.indexOf(entry);
        if (idx !== -1) this.active.splice(idx, 1);
      };
      return entry;
    } catch (err) {
      this.lastErrorMessage =
        err instanceof Error ? err.message : "Voice play failed";
      return null;
    }
  }

  playVoice(voiceId: VoiceId, freq: number, opts: PlayOptions = {}) {
    const voice = voices[voiceId];
    if (!voice) return;
    this.playOscAt(freq, voice, opts);
  }

  playChord(voiceId: VoiceId, freqs: number[], opts: PlayOptions = {}) {
    const voice = voices[voiceId];
    if (!voice) return;
    freqs.forEach((f, i) => {
      // spread onset a hair for natural arpeggio feel
      this.playOscAt(f, voice, {
        ...opts,
        when: (opts.when ?? 0) + i * 0.012,
      });
    });
  }

  get isSuspended(): boolean {
    return this.suspendedFlag || this.ctx?.state === "suspended";
  }
}

let singleton: SonificationEngine | null = null;

export function getEngine(): SonificationEngine {
  if (!singleton) singleton = new SonificationEngine();
  return singleton;
}

export function destroyEngine() {
  if (singleton) {
    singleton.destroy();
    singleton = null;
  }
}
