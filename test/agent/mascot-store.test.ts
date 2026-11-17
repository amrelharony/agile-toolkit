import { afterEach, describe, expect, it } from "vitest";
import { useMascotStore } from "@/lib/agent/mascot/store";

/**
 * Where Amr is drawn, for the things beside him (his bubble, the moment chip)
 * to follow: the assistant publishes his side and edge after layout, and how
 * far he has stepped off his edge, through setPlacement. `corner` stays the
 * corner he was put in.
 */

afterEach(() => useMascotStore.getState().reset());

describe("useMascotStore – setPlacement", () => {
  it("starts at the bottom right, not lifted", () => {
    const s = useMascotStore.getState();
    expect(s.placed).toEqual({ side: "right", edge: "bottom" });
    expect(s.lift).toBe(0);
  });

  it("keeps where he is drawn and how far he has stepped up", () => {
    useMascotStore.getState().setPlacement({ side: "left", edge: "bottom" }, 96);
    const s = useMascotStore.getState();
    expect(s.placed).toEqual({ side: "left", edge: "bottom" });
    expect(s.lift).toBe(96);
    // His chosen corner is left alone: he stepped aside, he wasn't moved.
    expect(s.corner).toBe("bottomRight");
  });

  it("counts a lift that isn't a positive number as none", () => {
    const { setPlacement } = useMascotStore.getState();
    for (const lift of [-48, Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      setPlacement({ side: "right", edge: "top" }, 48);
      setPlacement({ side: "right", edge: "top" }, lift);
      expect(useMascotStore.getState().lift, String(lift)).toBe(0);
    }
  });

  it("changes nothing when he is drawn where he already was", () => {
    useMascotStore.getState().setPlacement({ side: "left", edge: "top" }, 48);
    const before = useMascotStore.getState();
    let calls = 0;
    const stop = useMascotStore.subscribe(() => calls++);
    useMascotStore.getState().setPlacement({ side: "left", edge: "top" }, 48);
    stop();
    expect(calls).toBe(0);
    expect(useMascotStore.getState().placed).toBe(before.placed);
  });

  it("is cleared by reset", () => {
    useMascotStore.getState().setPlacement({ side: "left", edge: "top" }, 144);
    useMascotStore.getState().reset();
    const s = useMascotStore.getState();
    expect(s.placed).toEqual({ side: "right", edge: "bottom" });
    expect(s.lift).toBe(0);
  });
});
