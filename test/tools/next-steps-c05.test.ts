/**
 * Next steps for Hill Chart and Notes to Actions (tools plan, phase 2,
 * chain C05), through the lazy rules the page loads: each reads the
 * workspace, leaves the example's rows out and points at the chart or the
 * note it is about. Release Readiness's release-notes step is in
 * next-steps-delivery.test.ts, beside the rule's other steps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type HillChart,
  type MeetingNote,
  type Workspace,
} from "@/lib/stores/workspace-types";

const NOW = new Date("2026-11-23T12:00:00");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const steps = async (toolId: string, ws: Partial<Workspace>): Promise<NextStep[]> => {
  await loadNextStepRule(toolId);
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("hill-chart", () => {
  const chart = (over: Partial<HillChart> = {}): HillChart => ({
    id: "hill_a",
    title: "Refunds",
    scopes: [{ id: "s1", title: "Payment API", position: 30, movedAt: ago(9) }],
    checkIns: [{ id: "c1", at: ago(8), positions: [] }],
    createdAt: ago(30),
    updatedAt: ago(1),
    ...over,
  });

  it("asks about a stuck scope, then for a check-in after a week", async () => {
    const out = await steps("hill-chart", { hillCharts: [chart()] });
    expect(out.map((s) => s.id)).toEqual(["hill-chart-stuck", "hill-chart-check-in"]);
    expect(out[0]).toMatchObject({
      label: "Ask what is holding “Payment API” on the uphill side",
      href: "/hill-chart?chart=hill_a",
    });
    expect(out[1].label).toBe("Check in on “Refunds”");
  });

  it("stays quiet for a moving chart, an archived one and the example's", async () => {
    const moving = chart({
      scopes: [{ id: "s1", title: "Payment API", position: 60, movedAt: ago(1) }],
      checkIns: [{ id: "c1", at: ago(2), positions: [] }],
    });
    expect(await steps("hill-chart", { hillCharts: [moving] })).toEqual([]);
    expect(await steps("hill-chart", { hillCharts: [chart({ archived: true })] })).toEqual([]);
    expect(await steps("hill-chart", { hillCharts: [chart({ id: "example-hill" })] })).toEqual([]);
  });
});

describe("notes-to-actions", () => {
  const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
    id: "mnote_a",
    meeting: "Sprint Review",
    date: "2026-11-20",
    text: "",
    items: [
      { id: "i1", kind: "action", text: "Book the room", status: "open", keptAt: ago(2) },
      { id: "i2", kind: "bug", text: "CSV cuts names", status: "open", keptAt: ago(2) },
      { id: "i3", kind: "decision", text: "Drop the old export", status: "sent", keptAt: ago(2) },
    ],
    createdAt: ago(3),
    updatedAt: ago(2),
    ...over,
  });

  it("asks to send the items kept more than a day ago", async () => {
    const out = await steps("notes-to-actions", { meetingNotes: [note()] });
    expect(out).toEqual([
      {
        id: "notes-to-actions-send",
        label: "Send the 2 open items from Sprint Review notes",
        detail: "Kept items wait here until each is sent, answered or dropped.",
        href: "/notes-to-actions?note=mnote_a",
      },
    ]);
  });

  it("waits a day, and leaves the example's notes out", async () => {
    const fresh = note({
      items: [{ id: "i1", kind: "action", text: "Book", status: "open", keptAt: ago(0.5) }],
    });
    expect(await steps("notes-to-actions", { meetingNotes: [fresh] })).toEqual([]);
    expect(await steps("notes-to-actions", { meetingNotes: [note({ id: "example-n" })] })).toEqual(
      []
    );
  });
});
