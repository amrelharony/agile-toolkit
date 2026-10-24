import { beforeEach, describe, expect, it } from "vitest";
import { claimDock, countdown, dockOwnedBy, useDockTimer } from "@/lib/timer/dock-timer";
import { currentStep, nextStep, runSeconds, startSteps, stepDock } from "@/lib/timer/step-timer";

/** Claiming the docked timer, and runs of timed steps on it. */

beforeEach(() => useDockTimer.setState({ timer: null }));

describe("dock helpers", () => {
  it("claims the dock only when no other page holds it", () => {
    const warmup = countdown("Two truths", "/icebreaker", 120);
    expect(warmup).toMatchObject({ totalSeconds: 120, endsAt: null, pausedRemaining: 120 });
    expect(claimDock(warmup)).toEqual({ ok: true });
    expect(dockOwnedBy("/icebreaker")?.label).toBe("Two truths");
    expect(dockOwnedBy("/standup")).toBeNull();

    const standup = countdown("Standup: Alice", "/standup", 90);
    const r = claimDock(standup);
    expect(r.ok).toBe(false);
    expect(useDockTimer.getState().timer?.href).toBe("/icebreaker");
    // The same page can replace its own timer.
    expect(claimDock(countdown("Again", "/icebreaker", 60))).toEqual({ ok: true });
  });

  it("runs timed steps one after another", () => {
    let run = startSteps("/liberating-structures", "1-2-4-All", [
      { id: "1", label: "Alone", seconds: 60 },
      { id: "2", label: "Pairs", seconds: 120 },
    ]);
    expect(runSeconds(run)).toBe(180);
    expect(currentStep(run)?.label).toBe("Alone");
    expect(stepDock(run, 1_000)).toMatchObject({
      label: "1-2-4-All · Alone",
      href: "/liberating-structures",
      endsAt: 61_000,
    });
    run = nextStep(run);
    expect(currentStep(run)?.label).toBe("Pairs");
    run = nextStep(run);
    expect(run.finished).toBe(true);
    expect(stepDock(run)).toBeNull();
    expect(nextStep(run)).toBe(run);
    expect(startSteps("/x", "Empty", []).finished).toBe(true);
  });
});
