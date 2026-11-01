import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { evaluateRow } from "@/lib/prioritization/methods";
import { backlogRice, backlogWsjf, frameworkScores } from "@/lib/prioritization/scores";
import { riceScore, wsjfScore } from "@/lib/analytics/scoring-rubric";
import { priorityScore } from "@/app/(tools)/sprint-planning/view";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";

import "@/lib/actions/tools/prioritizer";
import "@/lib/actions/tools/rice-scoring";
import "@/lib/actions/tools/wsjf";
import "@/lib/actions/tools/value-effort-matrix";

/**
 * The divergences the old copies of each formula had, now one number: the
 * same item scores the same in the method tool (a linked row read
 * through), the hub (scores.ts), the agent (MCP list verbs) and Sprint
 * Planning, at the values where the copies used to disagree.
 */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: unknown = {}) =>
  (await registry.get(id)!.handler(params as never, ctx())) as T;

const STAMP = "2026-10-26T09:00:00.000Z";
const linked = (
  id: string,
  framework: PrioritizationItem["framework"],
  backlogItemId: string,
  fields: PrioritizationItem["fields"] = {}
): PrioritizationItem => ({ id, framework, title: id, fields, backlogItemId, updatedAt: STAMP });

beforeEach(() => useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] }));

describe("one score per item, everywhere", () => {
  it("WSJF: job size 0.5 floors at 1 in the tool, the hub, the agent and Sprint Planning", async () => {
    // Before: 0.5 divided by 0.5 in the tool, by 1 in the hub, unfloored in Sprint Planning.
    const item: BacklogItem = {
      id: "b1",
      name: "Fix",
      businessValue: 13,
      timeCriticality: 20,
      riskReduction: 2,
      jobSize: 0.5,
      updatedAt: STAMP,
    };
    const row = linked("w1", "wsjf", "b1", {
      businessValue: 1,
      timeCriticality: 1,
      rrOe: 1,
      jobSize: 1,
    });
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [row] });

    const tool = evaluateRow(row, item).score;
    const hub = frameworkScores(item, [row]).wsjf;
    const agent = await run<{ items: { id: string; score: number | null }[] }>(
      "tool.wsjf.list_scored"
    );
    const state = await run<{ items: { id: string; wsjf: number | null }[] }>(
      "tool.prioritizer.list_state"
    );
    expect(tool).toBe(35);
    expect(hub).toBe(35);
    expect(backlogWsjf(item)).toBe(35);
    expect(agent.items[0].score).toBe(35);
    expect(state.items[0].wsjf).toBe(35);
    expect(priorityScore(item)).toBe(35);
    expect(wsjfScore(13, 20, 2, 0.5)).toBe(35);
  });

  it("WSJF: 13 and 20 are kept (no clamp to 10)", () => {
    const item: BacklogItem = {
      id: "b",
      name: "B",
      businessValue: 20,
      timeCriticality: 13,
      riskReduction: 1,
      jobSize: 2,
      updatedAt: STAMP,
    };
    expect(backlogWsjf(item)).toBe(17);
    expect(priorityScore(item)).toBe(17);
  });

  it("RICE: an effort of 0.25 counts as 0.5 everywhere, and the reach period counts", async () => {
    // Before: ÷ 0.5 in the tool, ÷ 0.25 (floor 0.1) in the hub and the prompts.
    const item: BacklogItem = {
      id: "b1",
      name: "Search",
      reach: 1000,
      reachPeriod: "month",
      impact: 1.5,
      confidence: 80,
      effort: 0.25,
      updatedAt: STAMP,
    };
    const row = linked("r1", "rice", "b1", { reach: 1, impact: 1, confidence: 100, effort: 1 });
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [row] });
    const expected = (1000 * 3 * 1.5 * 0.8) / 0.5;

    expect(evaluateRow(row, item).score).toBe(expected);
    expect(backlogRice(item)).toBe(expected);
    const agent = await run<{ items: { score: number | null; warnings: string[] }[] }>(
      "tool.rice_scoring.list_scored"
    );
    expect(agent.items[0].score).toBe(expected);
    expect(agent.items[0].warnings[0]).toMatch(/0.5 minimum/);
    const state = await run<{ items: { rice: number | null }[] }>("tool.prioritizer.list_state");
    expect(state.items[0].rice).toBe(expected);
    // The compatibility wrapper (per quarter) and the prompt's table agree too.
    expect(riceScore(3000, 1.5, 80, 0.25)).toBe(expected);
    const [prompt] = generatePrioritizerPrompts({ items: [item], rows: [row] });
    expect(prompt.prompt).toContain("| 7,200 |");
  });

  it("Value/Effort: one quadrant rule and one value field for the tool, the hub and the agent", async () => {
    // (value 5, effort 5) was Big Bets in the tool and Fill-ins in the hub; (6, 5)
    // Big Bets in the tool and Quick Wins in the hub. Now value is Fibonacci and
    // 8+ is high, effort 6+ is high.
    const items: BacklogItem[] = [
      { id: "a", name: "A", businessValue: 5, matrixEffort: 5, updatedAt: STAMP },
      { id: "b", name: "B", businessValue: 8, matrixEffort: 5, updatedAt: STAMP },
      { id: "c", name: "C", value: 7, matrixEffort: 6, updatedAt: STAMP }, // legacy value → 8
    ];
    const rows = items.map((i) =>
      linked(`ve-${i.id}`, "value-effort", i.id, { value: 1, effort: 1 })
    );
    useWorkspaceStore.setState({ backlogItems: items, prioritizations: rows });

    const hub = items.map((i) => frameworkScores(i, rows).valueEffort?.quadrant);
    const tool = rows.map((r, i) => evaluateRow(r, items[i]).bucket);
    const agent = await run<{ groups: Record<string, { id: string }[]> }>(
      "tool.value_effort_matrix.list_items"
    );
    const agentOf = (id: string) =>
      Object.entries(agent.groups).find(([, list]) => list.some((r) => r.id === id))?.[0];
    expect(hub).toEqual(["fill_ins", "quick_wins", "big_bets"]);
    expect(tool).toEqual(hub);
    expect(rows.map((r) => agentOf(r.id))).toEqual(hub);
  });

  it("Kano and Cost of Delay: the hub reads the derived category and CD3, not a cached score", () => {
    const item: BacklogItem = { id: "b1", name: "SSO", updatedAt: STAMP };
    const rows: PrioritizationItem[] = [
      // An old agent row: category derived from the pair (like, like) is Questionable now.
      {
        ...linked("k1", "kano", "b1", {
          functional: "neutral",
          dysfunctional: "dislike",
          category: "attractive",
        }),
        score: 5,
      },
      // An old page row: score was the total $, now CD3 needs a duration.
      {
        ...linked("c1", "cost-of-delay", "b1", { perWeekUsd: 2000, weeksDelayed: 6 }),
        score: 12000,
      },
    ];
    const s = frameworkScores(item, rows);
    expect(s.kano).toBe("must-be");
    expect(s.cd3).toBeNull();
    expect(s.costOfDelay).toBe(12000);
    const later = {
      ...rows[1],
      fields: { ...rows[1].fields, durationWeeks: 4, urgency: "standard" },
      updatedAt: "2026-10-27T00:00:00.000Z",
    };
    expect(frameworkScores(item, [rows[0], later])).toMatchObject({
      cd3: 500,
      urgency: "standard",
    });
  });
});
