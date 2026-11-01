/**
 * Micro-expressions: a brief pose that plays one at a time and then ends.
 */

import { describe, it, expect, vi } from "vitest";
import { createReactionFx } from "@/components/agent/mascot/engine/reactions";

function fx() {
  return createReactionFx({ queueReaction: vi.fn(), setBreathTarget: vi.fn() });
}

describe("micro-expressions", () => {
  it("shows the expression's pose until its duration ends", () => {
    const f = fx();
    expect(f.activeMicroExpression(10)).toBeNull();
    f.triggerMicroExpression("smirk", 10);
    expect(f.activeMicroExpression(10.5)).toEqual({ pose: "review" });
    expect(f.activeMicroExpression(11.3)).toBeNull();
  });

  it("plays one at a time", () => {
    const f = fx();
    f.triggerMicroExpression("pout", 0);
    f.triggerMicroExpression("wideEyes", 0.1);
    expect(f.activeMicroExpression(0.2)).toEqual({ pose: "failed" });
  });
});

describe("idle quirks", () => {
  it("stay quiet while the panel is open, he's talking or a reaction plays", () => {
    const queueReaction = vi.fn();
    const f = createReactionFx({ queueReaction, setBreathTarget: vi.fn() });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    f.updateQuirks(100, { isOpen: true, isTalking: false, activeReaction: false });
    f.updateQuirks(100, { isOpen: false, isTalking: true, activeReaction: false });
    f.updateQuirks(100, { isOpen: false, isTalking: false, activeReaction: true });
    expect(f.activeMicroExpression(100)).toBeNull();
    expect(queueReaction).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
