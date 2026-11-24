// @vitest-environment node
/**
 * lib/ebm/sources: one fixture per toolkit source, with the minimum rows
 * and null below them; cycle time from stories and Flow-board cards
 * together; a DORA sample's day; example rows left out everywhere.
 */

import { describe, expect, it } from "vitest";
import {
  KANBAN_BOARD_ID,
  type DoraScorecard,
  type KanbanBoard,
  type KanbanCard,
  type NpsResponse,
  type Story,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";
import { DORA_DOC_ID } from "@/lib/dora/samples";
import { METRIC_SOURCE_IDS } from "@/lib/stores/workspace-types";
import {
  SOURCE_INFO,
  cycleTimeMedian,
  doraChangeFail,
  doraDeploys,
  doraLeadTime,
  isSourceId,
  npsRecent,
  openTechDebt,
  readSource,
} from "@/lib/ebm/sources";

const TODAY = "2026-11-20";

const story = (id: string, start: string, done: string): Story =>
  ({
    id,
    title: id,
    points: 3,
    status: "done",
    startedAt: `${start}T09:00:00`,
    doneAt: `${done}T17:00:00`,
  }) as Story;
const card = (id: string, start: string, done: string): KanbanCard =>
  ({
    id,
    title: id,
    column: "done",
    class: "standard",
    createdAt: `${start}T08:00:00`,
    startedAt: `${start}T09:00:00`,
    completedAt: `${done}T17:00:00`,
  }) as KanbanCard;
const board = (cards: KanbanCard[]): KanbanBoard =>
  ({ id: KANBAN_BOARD_ID, cards }) as unknown as KanbanBoard;

describe("cycle-time-median", () => {
  it("reads stories and Flow-board cards finished in the last 90 days, from 5 items", () => {
    const stories = [
      story("s1", "2026-11-01", "2026-11-02"),
      story("s2", "2026-11-01", "2026-11-03"),
      story("s3", "2026-11-01", "2026-11-04"),
      story("old", "2026-01-01", "2026-01-10"),
      story("example-s", "2026-11-01", "2026-11-19"),
    ];
    expect(cycleTimeMedian({ stories }, TODAY)).toBeNull();
    const cards = [card("c1", "2026-11-10", "2026-11-14"), card("c2", "2026-11-10", "2026-11-15")];
    const r = cycleTimeMedian({ stories, boards: [board(cards)] }, TODAY);
    expect(r).toEqual({
      value: 4,
      date: TODAY,
      basis: "the median of 5 items finished in the last 90 days",
    });
  });
});

describe("the DORA sources", () => {
  const doc = (samples: DoraScorecard["samples"]): DoraScorecard[] => [
    { id: DORA_DOC_ID, samples },
  ];
  const sample = {
    id: "s1",
    quarter: "2026-Q2",
    deployFreqPerWeek: 4,
    leadTimeHours: 60,
    changeFailRate: 0.125,
    mttrHours: 3,
  };

  it("reads the latest quarter's sample, dated at its last day when that has passed", () => {
    const data = {
      dora: doc([{ ...sample, id: "s0", quarter: "2026-Q1", leadTimeHours: 100 }, sample]),
    };
    expect(doraLeadTime(data, TODAY)).toEqual({
      value: 2.5,
      date: "2026-06-30",
      basis: "the DORA Scorecard's 2026-Q2 sample",
    });
    expect(doraDeploys(data, TODAY)?.value).toBe(4);
    expect(doraChangeFail(data, TODAY)?.value).toBe(12.5);
  });

  it("dates this quarter's sample today, and leaves the example's out", () => {
    const now = { dora: doc([{ ...sample, quarter: "2026-Q4" }]) };
    expect(doraLeadTime(now, TODAY)?.date).toBe(TODAY);
    expect(doraLeadTime({ dora: doc([{ ...sample, id: "example-q" }]) }, TODAY)).toBeNull();
    expect(doraLeadTime({}, TODAY)).toBeNull();
  });
});

describe("nps-90d", () => {
  const answer = (i: number, score: number, date = "2026-11-01"): NpsResponse =>
    ({ id: `nps_${i}`, kind: "nps", date, score }) as NpsResponse;

  it("needs 10 answers in the last 90 days, the team's own", () => {
    const nine = Array.from({ length: 9 }, (_, i) => answer(i, 10));
    expect(npsRecent({ nps: [...nine, answer(99, 10, "2026-05-01")] }, TODAY)).toBeNull();
    expect(npsRecent({ nps: [...nine, { ...answer(98, 0), id: "example-x" }] }, TODAY)).toBeNull();
    const ten = [...nine, answer(9, 0)];
    expect(npsRecent({ nps: ten }, TODAY)).toEqual({
      value: 80,
      date: TODAY,
      basis: "NPS from 10 answers in the last 90 days",
    });
  });
});

describe("open-tech-debt", () => {
  const debt = (id: string, resolvedAt?: string): TechDebtItem =>
    ({ id, title: id, impact: 3, ...(resolvedAt ? { resolvedAt } : {}) }) as TechDebtItem;

  it("counts the open items, null with none logged", () => {
    expect(openTechDebt({ techDebt: [] }, TODAY)).toBeNull();
    expect(openTechDebt({ techDebt: [debt("example-d")] }, TODAY)).toBeNull();
    expect(
      openTechDebt({ techDebt: [debt("d1"), debt("d2", "2026-10-01"), debt("d3")] }, TODAY)
    ).toEqual({ value: 2, date: TODAY, basis: "2 open of 3 items in Tech Debt" });
  });
});

describe("the source list", () => {
  it("describes and reads every source id", () => {
    for (const id of METRIC_SOURCE_IDS) {
      expect(isSourceId(id)).toBe(true);
      expect(SOURCE_INFO[id].tool.length).toBeGreaterThan(0);
      expect(readSource(id, {}, TODAY)).toBeNull();
    }
    expect(isSourceId("csat-90d")).toBe(false);
  });
});
