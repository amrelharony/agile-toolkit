/**
 * Mascot ambient drone — the one piece of the source audio (MascotAmbience /
 * updateMascotAudio, 1822-1918) that the palette engine can't express: a single
 * continuous, mood-tuned oscillator whose volume breathes, filter opens with the
 * body lean, and pitch wobbles with the bob.
 *
 * Built off the sonification engine's existing AudioContext + sharedBus, so it
 * inherits the master volume + pan and is torn down with the engine. SAFETY: it
 * only ever *uses* an existing context (never calls ensureContext), so it stays
 * silent until the user has sound enabled AND has already triggered some audio
 * (which creates the context). The caller gates `setEnabled` on the user's
 * sonification + reduced-motion prefs.
 */

import { getEngine } from "@/lib/sonification/engine";

export interface DroneParams {
  freq: number;
  type: OscillatorType;
  /** Base gain — very quiet (≈0.004-0.006); it rides the engine master. */
  vol: number;
  /** Lowpass cutoff (Hz). */
  filter: number;
}

export interface DroneModulation {
  /** breathScale spring (≈0..0.025) — louder on inhale. */
  breath: number;
  /** bodyLean spring (≈±0.006) — brighter when leaning. */
  lean: number;
  /** bobY spring (≈±0.012) — subtle pitch wobble. */
  bob: number;
}

export interface MascotDrone {
  setMood(params: DroneParams | null): void;
  update(mod: DroneModulation): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

export function createMascotDrone(): MascotDrone {
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let enabled = false;
  let params: DroneParams | null = null;
  let teardownTimer: ReturnType<typeof setTimeout> | null = null;

  /** Build the oscillator chain off the engine's existing context (never forces one). */
  function ensureNodes(): boolean {
    if (osc) return true;
    const ctx = getEngine().context;
    const bus = getEngine().sharedBus;
    if (!ctx || !bus) return false;
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    gain.gain.value = 0; // start silent; applyParams ramps it
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    filter.Q.value = 0.7;
    osc.connect(gain);
    gain.connect(filter);
    filter.connect(bus);
    osc.start();
    return true;
  }

  function applyParams(): void {
    const ctx = getEngine().context;
    if (!osc || !gain || !filter || !ctx) return;
    const now = ctx.currentTime;
    if (enabled && params) {
      osc.type = params.type;
      osc.frequency.setTargetAtTime(params.freq, now, 0.15);
      filter.frequency.setTargetAtTime(params.filter, now, 0.15);
      gain.gain.setTargetAtTime(params.vol, now, 0.4);
    } else {
      gain.gain.setTargetAtTime(0, now, 0.4); // fade to silence
    }
  }

  function setMood(next: DroneParams | null): void {
    params = next;
    if (enabled && next) ensureNodes();
    applyParams();
  }

  function clearTeardown(): void {
    if (teardownTimer !== null) {
      clearTimeout(teardownTimer);
      teardownTimer = null;
    }
  }

  /** Stop + disconnect the oscillator chain so it isn't left running. */
  function teardownNodes(): void {
    try {
      osc?.stop();
    } catch {
      /* already stopped */
    }
    try {
      osc?.disconnect();
      gain?.disconnect();
      filter?.disconnect();
    } catch {
      /* already disconnected */
    }
    osc = null;
    gain = null;
    filter = null;
  }

  function setEnabled(on: boolean): void {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      // Re-enabled before a pending teardown fired → keep the live nodes.
      clearTeardown();
      if (params) ensureNodes();
      applyParams();
    } else {
      // Fade to silence, then actually STOP the oscillator. Previously
      // setEnabled(false) only ramped gain toward 0, leaving the oscillator
      // running on the shared AudioContext for the whole session (it was only
      // stopped in dispose()). Defer the stop so the gain fade isn't cut off
      // with a click; cancel it if the drone is re-enabled within the window.
      applyParams();
      clearTeardown();
      teardownTimer = setTimeout(() => {
        teardownTimer = null;
        if (!enabled) teardownNodes();
      }, 600);
    }
  }

  function update(mod: DroneModulation): void {
    if (!enabled || !params) return;
    const ctx = getEngine().context;
    if (!osc || !gain || !filter || !ctx) return;
    const now = ctx.currentTime;
    gain.gain.setTargetAtTime(params.vol * (1 + mod.breath * 20), now, 0.1);
    filter.frequency.setTargetAtTime(params.filter * (1 + Math.abs(mod.lean) * 30), now, 0.1);
    osc.detune.setTargetAtTime(mod.bob * 600, now, 0.05);
  }

  function dispose(): void {
    clearTeardown();
    teardownNodes();
  }

  return { setMood, update, setEnabled, dispose };
}
