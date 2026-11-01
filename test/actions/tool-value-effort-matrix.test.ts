/**
 * tool.value_effort_matrix.* action coverage.
 *
 * Mirrors the tool-wsjf canonical test pattern, but adapted for a 2x2
 * quadrant tool (no continuous score — instead a 1..4 quadrant rank).
 *
 * Coverage:
 *  1. All 5 actions register with the right read/write category split
 *  2. Pure classifier matches the in-app client's >=5 cut at the
 *     midpoint of the 1-10 scale (and respects per-call overrides)
 *  3. compute_and_rank sorts Quick Wins → Time Wasters
 *  4. list_items filters out non-value-effort framework rows and
 *     re-derives quadrant for legacy/missing-quadrant rows
 *  5. classify_and_persist roundtrips through the workspace store
 *  6. persist_to_prioritization bulk-writes with auto-id fallback
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/value-effort-matrix";

const EXPECTED_ACTIONS = [
  "tool.value_effort_matrix.compute_quadrant",
  "tool.value_effort_matrix.compute_and_rank",
  "tool.value_effort_matrix.list_items",
  "tool.value_effort_matrix.classify_and_persist",
  "tool.value_effort_matrix.persist_to_prioritization",
] as const;

function ctx() {
  // Lightweight context for handler tests. Browser-path handlers don't
  // touch ctx.userId at all, but we supply a value so the type is happy.
  return {
    userId: "test-user",
    source: "agent" as const,
    squadProfileIds: [] as string[],
  };
}

describe("tool.value_effort_matrix — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("compute / list actions are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.value_effort_matrix.compute_quadrant")?.category).toBe("read");
    expect(registry.get("tool.value_effort_matrix.compute_and_rank")?.category).toBe("read");
    expect(registry.get("tool.value_effort_matrix.list_items")?.category).toBe("read");
    expect(registry.get("tool.value_effort_matrix.classify_and_persist")?.category).toBe("write");
    expect(registry.get("tool.value_effort_matrix.persist_to_prioritization")?.category).toBe(
      "write"
    );
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.value_effort_matrix.classify_and_persist")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(
      registry.get("tool.value_effort_matrix.persist_to_prioritization")?.mcpHandler
    ).toBeTypeOf("function");
  });
});

// Phase 7 decision: one rule everywhere. Value is the backlog's one value
// field on the Fibonacci scale (8 or more is high), effort 1–10 (6 or more
// is high); the old per-call thresholds are ignored. `score` is the sort
// score value ÷ effort, and the old 4..1 rank is `quadrantScore`.
describe("tool.value_effort_matrix.compute_quadrant — pure classifier", () => {
  it("classifies the four corners by the one rule", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_quadrant");
    const at = async (value: number, effort: number) =>
      (await action!.handler({ value, effort }, ctx())) as {
        quadrant: string;
        score: number;
        quadrantScore: number;
      };

    expect(await at(13, 2)).toMatchObject({ quadrant: "quick_wins", score: 6.5, quadrantScore: 4 });
    expect(await at(13, 8)).toMatchObject({ quadrant: "big_bets", quadrantScore: 3 });
    expect(await at(2, 2)).toMatchObject({ quadrant: "fill_ins", score: 1, quadrantScore: 2 });
    expect(await at(2, 8)).toMatchObject({
      quadrant: "time_wasters",
      score: 0.25,
      quadrantScore: 1,
    });
  });

  it("puts the boundaries at value 8 and effort 6", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_quadrant");
    const q = async (value: number, effort: number) =>
      ((await action!.handler({ value, effort }, ctx())) as { quadrant: string }).quadrant;
    expect(await q(8, 5)).toBe("quick_wins");
    expect(await q(5, 5)).toBe("fill_ins");
    expect(await q(8, 6)).toBe("big_bets");
    expect(await q(5, 6)).toBe("time_wasters");
  });

  it("ignores the old per-call thresholds", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_quadrant");
    const res = (await action!.handler(
      { value: 3, effort: 2, valueThreshold: 1, effortThreshold: 50 },
      ctx()
    )) as { quadrant: string };
    expect(res.quadrant).toBe("fill_ins");
  });

  it("does not place an effort of 0 (Not placed, never floored)", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_quadrant");
    const res = (await action!.handler({ value: 8, effort: 0 }, ctx())) as {
      quadrant: string | null;
      score: number | null;
    };
    expect(res.quadrant).toBeNull();
    expect(res.score).toBeNull();
  });

  it("echoes the rule's boundaries so the agent can confirm the cut point", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_quadrant");
    const res = (await action!.handler({ value: 5, effort: 5 }, ctx())) as {
      thresholds: { value: number; effort: number };
    };
    expect(res.thresholds).toEqual({ value: 8, effort: 6 });
  });
});

describe("tool.value_effort_matrix.compute_and_rank — batch + sort", () => {
  it("sorts Quick Wins → Big Bets → Fill-Ins → Time Wasters", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          { id: "tw", title: "Time Waster", fields: { value: 2, effort: 9 } },
          { id: "qw", title: "Quick Win", fields: { value: 13, effort: 2 } },
          { id: "fi", title: "Fill In", fields: { value: 2, effort: 2 } },
          { id: "bb", title: "Big Bet", fields: { value: 13, effort: 9 } },
        ],
      },
      ctx()
    )) as {
      ranked: Array<{ id: string; quadrant: string; score: number }>;
      count: number;
      thresholds: { value: number; effort: number };
    };

    expect(result.count).toBe(4);
    expect(result.ranked.map((r) => r.id)).toEqual(["qw", "bb", "fi", "tw"]);
    expect(result.ranked.map((r) => r.quadrant)).toEqual([
      "quick_wins",
      "big_bets",
      "fill_ins",
      "time_wasters",
    ]);
    expect(result.thresholds).toEqual({ value: 8, effort: 6 });
  });

  it("orders within a quadrant by value ÷ effort, ties in input order", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_and_rank");
    const result = (await action!.handler(
      {
        items: [
          { id: "qw1", title: "QW first", fields: { value: 8, effort: 1 } },
          { id: "qw2", title: "QW second", fields: { value: 8, effort: 2 } },
          { id: "qw3", title: "QW third", fields: { value: 8, effort: 2 } },
        ],
      },
      ctx()
    )) as { ranked: Array<{ id: string }> };
    expect(result.ranked.map((r) => r.id)).toEqual(["qw1", "qw2", "qw3"]);
  });

  it("attaches the computed quadrant to each item's fields", async () => {
    const action = registry.get("tool.value_effort_matrix.compute_and_rank");
    const result = (await action!.handler(
      { items: [{ title: "x", fields: { value: 13, effort: 2 } }] },
      ctx()
    )) as { ranked: Array<{ fields: { quadrant: string; value: number; effort: number } }> };
    expect(result.ranked[0].fields.quadrant).toBe("quick_wins");
    expect(result.ranked[0].fields.value).toBe(13);
    expect(result.ranked[0].fields.effort).toBe(2);
  });
});

describe("tool.value_effort_matrix.list_items — framework filter + grouping", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns empty groups when the workspace is empty", async () => {
    const action = registry.get("tool.value_effort_matrix.list_items");
    const result = (await action!.handler({}, ctx())) as {
      groups: Record<string, unknown[]>;
      count: number;
    };
    expect(result.count).toBe(0);
    expect(result.groups.quick_wins).toEqual([]);
    expect(result.groups.big_bets).toEqual([]);
    expect(result.groups.fill_ins).toEqual([]);
    expect(result.groups.time_wasters).toEqual([]);
  });

  it("filters out non-value-effort framework items", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "ve1",
        framework: "value-effort",
        title: "Quick win",
        score: 4,
        fields: { value: 9, effort: 2, quadrant: "quick_wins" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "w1",
        framework: "wsjf",
        title: "WSJF noise",
        score: 8,
        fields: {},
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.value_effort_matrix.list_items");
    const result = (await action!.handler({}, ctx())) as {
      groups: Record<string, PrioritizationItem[]>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.groups.quick_wins).toHaveLength(1);
    expect(result.groups.quick_wins[0].id).toBe("ve1");
  });

  it("re-classifies legacy items whose quadrant field is missing or display-cased", async () => {
    const seeds: PrioritizationItem[] = [
      // Legacy: display-cased "Quick Wins" from the in-app client
      {
        id: "legacy-display",
        framework: "value-effort",
        title: "Legacy display",
        score: 4,
        fields: { value: 9, effort: 2, quadrant: "Quick Wins" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      // No quadrant tag at all — must re-derive from value/effort
      {
        id: "no-quadrant",
        framework: "value-effort",
        title: "Untagged big bet",
        score: 3,
        fields: { value: 8, effort: 8 },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.value_effort_matrix.list_items");
    const result = (await action!.handler({}, ctx())) as {
      groups: Record<string, PrioritizationItem[]>;
      count: number;
    };
    expect(result.count).toBe(2);
    // Display-cased "Quick Wins" → normalised to quick_wins bucket
    expect(result.groups.quick_wins.map((i) => i.id)).toContain("legacy-display");
    // Untagged (8, 8) → re-derived as big_bets
    expect(result.groups.big_bets.map((i) => i.id)).toContain("no-quadrant");
  });
});

describe("tool.value_effort_matrix.classify_and_persist — classify + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("classifies and stores the item with framework='value-effort'", async () => {
    const action = registry.get("tool.value_effort_matrix.classify_and_persist");
    const result = (await action!.handler(
      { title: "Add SSO", fields: { value: 13, effort: 2 } },
      ctx()
    )) as { id: string; quadrant: string; score: number; quadrantScore: number };

    expect(result.quadrant).toBe("quick_wins");
    expect(result.score).toBe(6.5);
    expect(result.quadrantScore).toBe(4);

    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].framework).toBe("value-effort");
    expect(stored![0].title).toBe("Add SSO");
    expect(stored![0].score).toBe(6.5);
    // The quadrant is derived, never stored; the value is the one value field.
    expect(stored![0].fields).toEqual({ businessValue: 13, effort: 2 });
    expect(stored![0].status).toBe("scored");
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.value_effort_matrix.classify_and_persist");
    const result = (await action!.handler(
      { id: "explicit-id", title: "X", fields: { value: 1, effort: 1 } },
      ctx()
    )) as { id: string };
    expect(result.id).toBe("explicit-id");
  });

  it("refuses an effort off the 1–10 scale instead of flooring or rescaling it", async () => {
    const action = registry.get("tool.value_effort_matrix.classify_and_persist");
    await expect(
      action!.handler({ title: "Big-scale item", fields: { value: 8, effort: 20 } }, ctx())
    ).rejects.toThrow("Effort runs from 1 to 10.");
    await expect(
      action!.handler({ title: "Zero-effort fix", fields: { value: 8, effort: 0 } }, ctx())
    ).rejects.toThrow("Effort runs from 1 to 10.");
    expect(useWorkspaceStore.getState().prioritizations).toEqual([]);
  });
});

describe("tool.value_effort_matrix.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns their ids", async () => {
    const action = registry.get("tool.value_effort_matrix.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          { id: "i1", title: "Feature 1", fields: { value: 13, effort: 2 } },
          { title: "Feature 2 (auto-id)", fields: { value: 3, effort: 9 } },
        ],
      },
      ctx()
    )) as { written: string[]; count: number };

    expect(result.count).toBe(2);
    expect(result.written[0]).toBe("i1");
    expect(result.written[1]).toMatch(/^prio_/);

    const stored = useWorkspaceStore.getState().prioritizations!;
    expect(stored).toHaveLength(2);
    // The score is value ÷ effort; the quadrant is derived, never stored.
    const r = result as unknown as { placed: { id: string; quadrant: string; score: number }[] };
    expect(r.placed[0]).toMatchObject({ id: "i1", quadrant: "quick_wins", score: 6.5 });
    expect(r.placed[1]).toMatchObject({ quadrant: "time_wasters" });
    const byId = new Map(stored.map((s) => [s.id, s]));
    expect(byId.get("i1")!.fields?.quadrant).toBeUndefined();
    expect(byId.get("i1")!.score).toBe(6.5);
    const auto = stored.find((s) => s.id !== "i1")!;
    expect(auto.score).toBeCloseTo(1 / 3, 6);
  });

  it("every persisted item carries framework='value-effort'", async () => {
    const action = registry.get("tool.value_effort_matrix.persist_to_prioritization");
    await action!.handler({ items: [{ title: "a", fields: { value: 5, effort: 5 } }] }, ctx());
    const stored = useWorkspaceStore.getState().prioritizations!;
    expect(stored.every((s) => s.framework === "value-effort")).toBe(true);
  });
});
