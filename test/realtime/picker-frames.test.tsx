import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  PICKER_WHEEL_KIND,
  parseWheelFrame,
  wheelFrame,
  type WheelFrame,
} from "@/lib/realtime/show-room/frames/picker";
import {
  encodeShowPayload,
  parseShowPayload,
  showFrameKinds,
} from "@/lib/realtime/show-room/frames";
import { showRendererFor } from "@/lib/realtime/show-room/renderers";
import { LATE_FRAME_MS, WheelFrameView } from "@/lib/realtime/show-room/renderers/picker";
import { SPIN_MS, landingRotation, sliceAtPointer, wheelSlices } from "@/lib/picker/wheel";

/**
 * Picker's live room: the "wheel" frame. A participant draws only what its
 * parser rebuilt (a clean name list, weights, a winner that can come up),
 * and every phone works out the same landing, so the wheel stops on the
 * host's name; under reduced motion, or for a late joiner, it lands at once.
 */

const FRAME: WheelFrame = {
  title: "Who facilitates?",
  names: ["Amina", "Ben", "Chloé"],
  weights: [1, 2, 1],
  out: [0],
  winner: 2,
  turns: 5,
  offset: 0.5,
};

const setReducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

describe("the wheel frame's parser", () => {
  it("is a Picker kind, beside the text frame", () => {
    expect(showFrameKinds("picker")).toEqual(expect.arrayContaining(["wheel", "text"]));
    expect(showFrameKinds("team-mixer")).not.toContain("wheel");
  });

  it("accepts a clean frame, and the host's version travels unchanged", () => {
    expect(parseWheelFrame(FRAME)).toEqual(FRAME);
    const data = encodeShowPayload("picker", PICKER_WHEEL_KIND, { ...FRAME, extra: "dropped" });
    expect(data).not.toBeNull();
    expect(JSON.parse(data!)).not.toHaveProperty("extra");
    expect(parseShowPayload("picker", PICKER_WHEEL_KIND, data)).toEqual(FRAME);
  });

  it.each([
    ["no names", { names: [], weights: [] }],
    ["a repeated name", { names: ["Sam", "sam", "Jo"] }],
    ["hidden characters", { names: ["Sa‮m", "Ben", "Jo"] }],
    ["padded text", { names: [" Sam", "Ben", "Jo"] }],
    ["a name too long", { names: ["x".repeat(41), "Ben", "Jo"] }],
    ["weights out of step", { weights: [1, 2] }],
    ["a weight of 6", { weights: [1, 6, 1] }],
    ["a winner who already had a turn", { winner: 0 }],
    ["a winner off the wheel", { winner: 3 }],
    ["everyone out", { out: [0, 1, 2] }],
    ["too many turns", { turns: 11 }],
    ["an offset past the slice", { offset: 1.5 }],
    ["a title with a newline", { title: "Who\nfacilitates" }],
  ])("refuses %s", (_label, patch) => {
    expect(parseWheelFrame({ ...FRAME, ...patch })).toBeNull();
  });

  it("refuses more than forty names", () => {
    const names = Array.from({ length: 41 }, (_, i) => `N${i}`);
    expect(
      parseWheelFrame({ ...FRAME, names, weights: names.map(() => 1), out: [], winner: 0 })
    ).toBeNull();
  });

  it("builds the host's frame from its own text, cleaned instead of refused", () => {
    expect(
      wheelFrame({
        names: ["  Sam ", "Al‮ex"],
        weights: [1.4, 9],
        winner: 1,
        turns: 4.2,
        offset: 0.3,
      })
    ).toEqual({
      title: "",
      names: ["Sam", "Alex"],
      weights: [1, 5],
      out: [],
      winner: 1,
      turns: 4,
      offset: 0.3,
    });
    expect(
      wheelFrame({ names: ["Sam", "sam "], weights: [1, 1], winner: 0, turns: 4, offset: 0.5 })
    ).toBeNull();
  });
});

describe("the wheel on a phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const draw = (at = Date.now()) =>
    render(<WheelFrameView payload={FRAME} frame={{ n: 1, kind: "wheel", at }} surface="phone" />);
  const rotation = () =>
    Number(screen.getByTestId("picker-wheel-disc").getAttribute("data-rotation"));

  it("is registered for Picker's wheel frames", () => {
    expect(showRendererFor("picker", "wheel")).not.toBeNull();
  });

  it("spins for about 2.5 s, then stops on the host's name and says so", () => {
    draw();
    expect(screen.getByRole("status")).toHaveTextContent("Spinning…");
    expect(screen.getByText("Who facilitates?")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(40));
    const target = landingRotation(
      wheelSlices(FRAME.weights),
      FRAME.winner,
      FRAME.turns,
      FRAME.offset
    );
    expect(rotation()).toBeCloseTo(target, 1);
    expect(sliceAtPointer(wheelSlices(FRAME.weights), target)).toBe(FRAME.winner);
    // Still turning just before the end.
    act(() => vi.advanceTimersByTime(SPIN_MS - 100));
    expect(screen.getByRole("status")).toHaveTextContent("Spinning…");
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("status")).toHaveTextContent("Chloé");
  });

  it("lands at once under reduced motion", () => {
    setReducedMotion(true);
    draw();
    expect(screen.getByRole("status")).toHaveTextContent("Chloé");
  });

  it("lands at once for a frame that arrives long after it was shown", () => {
    draw(Date.now() - LATE_FRAME_MS - 1000);
    expect(screen.getByRole("status")).toHaveTextContent("Chloé");
  });

  it("has no live line on the host's preview, where the tool page says the result", () => {
    setReducedMotion(true);
    render(
      <WheelFrameView
        payload={FRAME}
        frame={{ n: 1, kind: "wheel", at: Date.now() }}
        surface="host"
      />
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Chloé", { selector: "p" })).toBeInTheDocument();
  });

  it("draws the wheel as one labelled image", () => {
    draw();
    expect(screen.getByRole("img", { name: "Wheel with 3 names" })).toBeInTheDocument();
  });
});
