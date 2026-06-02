/**
 * Mascot ambient drone — safety. With no AudioContext (the engine never had a
 * user gesture, as in tests/SSR), every method must be a no-op and never throw,
 * never force-create a context, and never produce sound.
 */

import { describe, it, expect } from "vitest";
import { createMascotDrone } from "@/components/agent/mascot/engine/audio/mascot-drone";
import { getEngine } from "@/lib/sonification/engine";

describe("createMascotDrone (no AudioContext)", () => {
  it("does not throw and does not force-create a context", () => {
    const drone = createMascotDrone();
    expect(() => {
      drone.setMood({ freq: 110, type: "sine", vol: 0.004, filter: 250 });
      drone.setEnabled(true);
      drone.update({ breath: 0.02, lean: 0.005, bob: 0.01 });
      drone.setEnabled(false);
      drone.setMood(null);
      drone.dispose();
    }).not.toThrow();
    // The drone must never call ensureContext() — no context should exist.
    expect(getEngine().context).toBeNull();
  });
});
