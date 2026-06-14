/**
 * Mascot ambient drone — oscillator teardown. setEnabled(false) used to only
 * ramp gain toward 0, leaving the OscillatorNode running on the shared
 * AudioContext for the whole session (only dispose() stopped it). It now stops
 * the node (deferred, so the fade isn't clicked; cancelled on quick re-enable).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const param = () => ({ value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() });
  const osc = {
    type: "sine",
    frequency: param(),
    detune: param(),
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
  const filter = {
    type: "lowpass",
    frequency: param(),
    Q: param(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    createOscillator: () => osc,
    createGain: () => gain,
    createBiquadFilter: () => filter,
  };
  return { osc, ctx, bus: {} };
});

vi.mock("@/lib/sonification/engine", () => ({
  getEngine: () => ({ context: h.ctx, sharedBus: h.bus }),
}));

import { createMascotDrone } from "@/components/agent/mascot/engine/audio/mascot-drone";

describe("createMascotDrone teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the oscillator after setEnabled(false) (deferred, not on unmount)", () => {
    const drone = createMascotDrone();
    drone.setMood({ freq: 110, type: "sine", vol: 0.004, filter: 250 });
    drone.setEnabled(true);
    expect(h.osc.start).toHaveBeenCalledTimes(1);

    drone.setEnabled(false);
    expect(h.osc.stop).not.toHaveBeenCalled(); // fade first

    vi.advanceTimersByTime(600);
    expect(h.osc.stop).toHaveBeenCalledTimes(1);
  });

  it("does NOT stop the oscillator if re-enabled within the teardown window", () => {
    const drone = createMascotDrone();
    drone.setMood({ freq: 110, type: "sine", vol: 0.004, filter: 250 });
    drone.setEnabled(true);
    drone.setEnabled(false);
    vi.advanceTimersByTime(300);
    drone.setEnabled(true); // cancels the pending teardown
    vi.advanceTimersByTime(600);
    expect(h.osc.stop).not.toHaveBeenCalled();
  });
});
