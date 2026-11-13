/**
 * The interrupt buffer's arithmetic (lib/sprints/interrupts.ts): the buffer
 * in points from points or a share, what the sprint's interrupts used, the
 * state the Cockpit tile reads (`interruptBufferStatus`), the history, the
 * keyword kinds the AI falls back to, and the two forms' checks.
 */

import { describe, expect, it } from "vitest";
import type { InterruptItem, Sprint } from "@/lib/stores/workspace-types";
import {
  BUFFER_PCT_MAX,
  EMERGENCY_STEPS,
  bufferDraftFor,
  bufferHistory,
  bufferLabel,
  bufferPoints,
  classifyInterrupt,
  cleanBuffer,
  interruptBufferStatus,
  sameBuffer,
  sprintInterrupts,
  suggestedBufferPoints,
  validateBufferDraft,
  validateInterruptDraft,
} from "@/lib/sprints/interrupts";

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  pointsPlanned: 30,
  status: "active",
  ...over,
});

const item = (over: Partial<InterruptItem> = {}): InterruptItem => ({
  id: "i1",
  sprintId: "s1",
  title: "Login is broken",
  kind: "bug",
  emergency: false,
  loggedAt: "2026-11-04T09:00:00.000Z",
  ...over,
});

describe("the buffer in points", () => {
  it("uses points when set, else a share of the planned points", () => {
    expect(bufferPoints(sprint({ interruptBuffer: { points: 6 } }))).toBe(6);
    expect(bufferPoints(sprint({ interruptBuffer: { pct: 20 } }))).toBe(6);
    expect(bufferPoints(sprint({ interruptBuffer: { pct: 15 } }))).toBe(4.5);
    // Points win when both are there (the fixture Sprint Planning writes).
    expect(bufferPoints(sprint({ interruptBuffer: { pct: 20, points: 5 } }))).toBe(5);
  });

  it("can't tell a share of a sprint with no planned points, and has none without a buffer", () => {
    expect(bufferPoints(sprint({ pointsPlanned: 0, interruptBuffer: { pct: 20 } }))).toBeNull();
    expect(bufferPoints(sprint())).toBeNull();
    expect(bufferPoints(sprint({ interruptBuffer: { pct: 120 } }))).toBeNull();
    expect(bufferPoints(sprint({ interruptBuffer: { points: -1 } }))).toBeNull();
    expect(bufferPoints(sprint({ interruptBuffer: { points: 0 } }))).toBe(0);
  });

  it("cleans what it reads and labels it", () => {
    // A share past the forms' 90% that another writer stored is read back, never dropped.
    expect(cleanBuffer({ pct: 95, points: 4 })).toEqual({ pct: 95, points: 4 });
    expect(cleanBuffer({ pct: 100 })).toEqual({ pct: 100 });
    expect(cleanBuffer({ pct: 100.5 })).toBeUndefined();
    expect(cleanBuffer({ pct: 0 })).toBeUndefined();
    expect(cleanBuffer(null)).toBeUndefined();
    expect(bufferLabel(sprint({ interruptBuffer: { pct: 20 } }))).toBe(
      "20% of the sprint (6 points)"
    );
    expect(bufferLabel(sprint({ pointsPlanned: 0, interruptBuffer: { pct: 20 } }))).toBe(
      "20% of the sprint"
    );
    expect(bufferLabel(sprint({ interruptBuffer: { points: 1 } }))).toBe("1 point");
    expect(bufferLabel(sprint({ interruptBuffer: { pct: 20, points: 6 } }))).toBe(
      "6 points (20% of the sprint)"
    );
    expect(bufferLabel(sprint())).toBe("No buffer set");
    expect(sameBuffer({ pct: 20 }, { pct: 20.0 })).toBe(true);
    expect(sameBuffer({ pct: 20 }, { points: 6 })).toBe(false);
    expect(sameBuffer(undefined, {})).toBe(true);
  });
});

describe("interruptBufferStatus", () => {
  const withBuffer = sprint({ interruptBuffer: { points: 8 } });

  it("weighs a stored share above the forms' limit, so the over-buffer warning still comes", () => {
    const st = interruptBufferStatus(sprint({ pointsPlanned: 30, interruptBuffer: { pct: 95 } }), [
      item({ id: "a", size: 40 }),
    ]);
    expect(st).toMatchObject({ set: true, bufferPoints: 28.5, state: "over", over: true });
    expect(bufferLabel(sprint({ pointsPlanned: 30, interruptBuffer: { pct: 95 } }))).toBe(
      "95% of the sprint (28.5 points)"
    );
  });

  it("adds up the sprint's interrupts, open or resolved, and only the sprint's", () => {
    const st = interruptBufferStatus(withBuffer, [
      item({ id: "a", size: 3 }),
      item({ id: "b", size: 2, resolvedAt: "2026-11-05T10:00:00.000Z", kind: "support" }),
      item({ id: "c", emergency: true, kind: "incident" }),
      item({ id: "d", sprintId: "other", size: 13 }),
      item({ id: "e", sprintId: undefined, size: 5 }),
    ]);
    expect(st).toMatchObject({
      sprintId: "s1",
      set: true,
      bufferPoints: 8,
      usedPoints: 5,
      leftPoints: 3,
      state: "ok",
      over: false,
      total: 3,
      open: 2,
      resolved: 1,
      emergencies: 1,
      unsized: 1,
    });
    expect(st.byKind).toEqual({ bug: 1, support: 1, request: 0, incident: 1, other: 0 });
    expect(st.usedShare).toBeCloseTo(0.625);
    expect(st.summary).toBe("5 of 8 points used, 3 points left. 1 has no size yet.");
  });

  it("watches from three quarters, says when it is used up, and is over past it", () => {
    expect(interruptBufferStatus(withBuffer, [item({ size: 6 })]).state).toBe("watch");
    const full = interruptBufferStatus(withBuffer, [item({ size: 8 })]);
    expect(full).toMatchObject({ state: "watch", leftPoints: 0, over: false });
    expect(full.summary).toBe("8 of 8 points used: the buffer is used up.");
    const over = interruptBufferStatus(withBuffer, [item({ size: 8 }), item({ id: "b", size: 3 })]);
    expect(over).toMatchObject({ state: "over", over: true, leftPoints: -3 });
    expect(over.summary).toBe("11 of 8 points used: 3 points over the buffer.");
  });

  it("is over at the first point of a 0-point buffer", () => {
    const zero = sprint({ interruptBuffer: { points: 0 } });
    expect(interruptBufferStatus(zero, []).state).toBe("ok");
    expect(interruptBufferStatus(zero, [item({ size: 1 })]).state).toBe("over");
  });

  it("has no state to weigh without a buffer in points, and still counts", () => {
    const none = interruptBufferStatus(sprint(), [item({ size: 2 })]);
    expect(none).toMatchObject({ set: false, bufferPoints: null, state: "none", total: 1 });
    expect(none.summary).toBe("No buffer set. 1 interrupt logged, 2 points.");
    const share = interruptBufferStatus(
      sprint({ pointsPlanned: 0, interruptBuffer: { pct: 20 } }),
      [item({ size: 2 })]
    );
    expect(share).toMatchObject({ set: true, bufferPoints: null, state: "none" });
    expect(share.summary).toMatch(/no planned points yet/);
    expect(interruptBufferStatus(withBuffer, []).summary).toBe(
      "Nothing logged yet: all 8 points of the buffer left."
    );
  });

  it("reads an unknown kind as other", () => {
    const st = interruptBufferStatus(withBuffer, [item({ kind: "weird" as never })]);
    expect(st.byKind.other).toBe(1);
  });
});

describe("history and a starting buffer", () => {
  it("lists sprints with a buffer or interrupts, newest first, cancelled ones out", () => {
    const sprints = [
      sprint({ id: "s0", name: "Sprint 0", startDate: "2026-10-19", status: "completed" }),
      sprint({ id: "s1", interruptBuffer: { points: 5 } }),
      sprint({
        id: "sx",
        startDate: "2026-10-05",
        status: "cancelled",
        interruptBuffer: { points: 5 },
      }),
      sprint({ id: "s9", startDate: "2026-09-01", status: "completed" }),
    ];
    const rows = bufferHistory(sprints, [item({ sprintId: "s0", size: 4 })]);
    expect(rows.map((r) => r.sprint.id)).toEqual(["s1", "s0"]);
    expect(rows[1].status.usedPoints).toBe(4);
  });

  it("suggests the average the last finished sprints used", () => {
    const sprints = [
      sprint({ id: "a", status: "completed", endDate: "2026-10-01" }),
      sprint({ id: "b", status: "completed", endDate: "2026-10-15" }),
      sprint({ id: "c", status: "active" }),
    ];
    const items = [
      item({ id: "1", sprintId: "a", size: 3 }),
      item({ id: "2", sprintId: "b", size: 6 }),
      item({ id: "3", sprintId: "c", size: 20 }),
    ];
    expect(suggestedBufferPoints(sprints, items)).toBe(4.5);
    expect(suggestedBufferPoints(sprints, [])).toBeNull();
  });

  it("orders a sprint's interrupts newest first", () => {
    const list = sprintInterrupts(
      [
        item({ id: "old", loggedAt: "2026-11-03T08:00:00.000Z" }),
        item({ id: "new", loggedAt: "2026-11-05T08:00:00.000Z" }),
        item({ id: "else", sprintId: "s2" }),
      ],
      "s1"
    );
    expect(list.map((i) => i.id)).toEqual(["new", "old"]);
  });
});

describe("the Emergency Procedure", () => {
  it("goes from stopping to the retro, re-planning with the Product Owner on the way", () => {
    expect(EMERGENCY_STEPS.map((s) => s.id)).toEqual([
      "stop",
      "inform",
      "change",
      "help",
      "replan",
      "retro",
    ]);
  });
});

describe("kinds from titles, without AI", () => {
  it("sorts by keywords and guesses a size when a word says", () => {
    expect(classifyInterrupt("Checkout is down for card payments")).toEqual({
      kind: "incident",
      size: 8,
    });
    expect(classifyInterrupt("Error 500 on the orders page")).toEqual({ kind: "bug" });
    expect(classifyInterrupt("Customer can't reset their password")).toEqual({
      kind: "support",
      size: 1,
    });
    expect(classifyInterrupt("Sales asks for a monthly export")).toEqual({ kind: "request" });
    expect(classifyInterrupt("Fix typo in the footer")).toEqual({ kind: "bug", size: 1 });
    expect(classifyInterrupt("Team lunch")).toEqual({ kind: "other" });
  });
});

describe("the forms' checks", () => {
  it("an interrupt needs a title; its size is optional, 0 to 100", () => {
    const blank = validateInterruptDraft({ title: "  ", kind: "bug", size: "", emergency: false });
    expect(blank.ok || blank.errors.title).toBe("Say what came in.");
    const bad = validateInterruptDraft({ title: "X", kind: "bug", size: "-1", emergency: false });
    expect(bad.ok || bad.errors.size).toBe("Use 0 or more points.");
    const big = validateInterruptDraft({ title: "X", kind: "bug", size: "101", emergency: false });
    expect(big.ok || big.errors.size).toMatch(/100 points or fewer/);
    expect(
      validateInterruptDraft({
        title: " Login  broken ",
        kind: "bug",
        size: "2.25",
        emergency: true,
      })
    ).toEqual({
      ok: true,
      values: { title: "Login broken", kind: "bug", size: 2.3, emergency: true },
    });
    expect(
      validateInterruptDraft({ title: "X", kind: "support", size: "", emergency: false })
    ).toEqual({ ok: true, values: { title: "X", kind: "support", emergency: false } });
  });

  it("a buffer is a share up to the cap or points; blank clears it", () => {
    expect(validateBufferDraft({ mode: "pct", value: "" })).toEqual({
      ok: true,
      values: undefined,
    });
    expect(validateBufferDraft({ mode: "pct", value: "20" })).toEqual({
      ok: true,
      values: { pct: 20 },
    });
    const tooMuch = validateBufferDraft({ mode: "pct", value: String(BUFFER_PCT_MAX + 1) });
    expect(tooMuch.ok || tooMuch.errors.value).toMatch(/from 1 to 90%/);
    expect(validateBufferDraft({ mode: "points", value: "0" })).toEqual({
      ok: true,
      values: { points: 0 },
    });
    const neg = validateBufferDraft({ mode: "points", value: "-2" });
    expect(neg.ok || neg.errors.value).toBe("Use 0 or more points.");
    expect(validateBufferDraft({ mode: "points", value: "abc" }).ok).toBe(false);
    expect(bufferDraftFor(sprint({ interruptBuffer: { pct: 20, points: 6 } }))).toEqual({
      mode: "points",
      value: "6",
    });
    expect(bufferDraftFor(sprint({ interruptBuffer: { pct: 20 } }))).toEqual({
      mode: "pct",
      value: "20",
    });
    expect(bufferDraftFor(sprint())).toEqual({ mode: "pct", value: "" });
  });
});
