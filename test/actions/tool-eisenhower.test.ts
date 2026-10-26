/**
 * tool.eisenhower.* action coverage.
 *
 * Mirrors the squad-13 canonical test pattern from tool-wsjf.test.ts,
 * adapted for the CLASSIFIER variant. Asserts:
 *   1. all 4 actions registered with the right category split
 *   2. classify is pure — same (urgent, important) → same quadrant + score
 *   3. list_items filters by framework='eisenhower' AND buckets by quadrant
 *   4. classify_and_persist roundtrips through the workspace store
 *   5. persist_to_prioritization handles both
 *      (a) raw {urgent, important} fields (re-classify) and
 *      (b) an explicit `quadrant` override
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/eisenhower";

const EXPECTED_ACTIONS = [
  "tool.eisenhower.classify",
  "tool.eisenhower.list_items",
  "tool.eisenhower.classify_and_persist",
  "tool.eisenhower.persist_to_prioritization",
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

describe("tool.eisenhower — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("classify + list are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.eisenhower.classify")?.category).toBe("read");
    expect(registry.get("tool.eisenhower.list_items")?.category).toBe("read");
    expect(registry.get("tool.eisenhower.classify_and_persist")?.category).toBe("write");
    expect(registry.get("tool.eisenhower.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.eisenhower.classify_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.eisenhower.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
    // list_items also has one because it reads workspace state.
    expect(registry.get("tool.eisenhower.list_items")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.eisenhower.classify — pure rule", () => {
  // Each row: (urgent, important) → expected (quadrant, score).
  const cases: Array<[boolean, boolean, string, number]> = [
    [true, true, "do", 4],
    [false, true, "schedule", 3],
    [true, false, "delegate", 2],
    [false, false, "delete", 1],
  ];

  for (const [urgent, important, quadrant, score] of cases) {
    it(`classifies (urgent=${urgent}, important=${important}) → ${quadrant} (score ${score})`, async () => {
      const action = registry.get("tool.eisenhower.classify");
      const result = (await action!.handler({ urgent, important }, ctx())) as {
        quadrant: string;
        score: number;
      };
      expect(result.quadrant).toBe(quadrant);
      expect(result.score).toBe(score);
    });
  }
});

describe("tool.eisenhower.list_items — framework filter + bucketing", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns four empty buckets and total=0 when the workspace is empty", async () => {
    const action = registry.get("tool.eisenhower.list_items");
    const result = (await action!.handler({}, ctx())) as {
      do: unknown[];
      schedule: unknown[];
      delegate: unknown[];
      delete: unknown[];
      total: number;
    };
    expect(result.total).toBe(0);
    expect(result.do).toEqual([]);
    expect(result.schedule).toEqual([]);
    expect(result.delegate).toEqual([]);
    expect(result.delete).toEqual([]);
  });

  it("filters out non-eisenhower framework items and buckets by quadrant", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "eisenhower",
        title: "Burning fire",
        score: 4,
        fields: { urgent: "true", important: "true", quadrant: "do" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "eisenhower",
        title: "Plan Q3 roadmap",
        score: 3,
        fields: { urgent: "false", important: "true", quadrant: "schedule" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p3",
        framework: "eisenhower",
        title: "Reply to ad-hoc email",
        score: 2,
        fields: { urgent: "true", important: "false", quadrant: "delegate" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p4",
        framework: "eisenhower",
        title: "Random scroll",
        score: 1,
        fields: { urgent: "false", important: "false", quadrant: "delete" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p5",
        framework: "wsjf",
        title: "WSJF noise",
        score: 99,
        fields: {},
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.eisenhower.list_items");
    const result = (await action!.handler({}, ctx())) as {
      do: PrioritizationItem[];
      schedule: PrioritizationItem[];
      delegate: PrioritizationItem[];
      delete: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(4); // wsjf item excluded
    expect(result.do.map((x) => x.id)).toEqual(["p1"]);
    expect(result.schedule.map((x) => x.id)).toEqual(["p2"]);
    expect(result.delegate.map((x) => x.id)).toEqual(["p3"]);
    expect(result.delete.map((x) => x.id)).toEqual(["p4"]);
  });

  // Phase 7 decision: no default quadrant. A row with no answers (and an
  // unknown legacy quadrant) is "Not sorted yet", never Do.
  it("lists unknown / missing quadrants under unsorted, never Do", async () => {
    useWorkspaceStore.getState().upsertPrioritization({
      id: "stale",
      framework: "eisenhower",
      title: "stale row",
      score: 4,
      fields: { quadrant: "WEIRD_VALUE" }, // not in {do, schedule, delegate, delete}
      status: "scored",
      updatedAt: new Date().toISOString(),
    });

    const action = registry.get("tool.eisenhower.list_items");
    const result = (await action!.handler({}, ctx())) as {
      do: PrioritizationItem[];
      unsorted: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.do).toEqual([]);
    expect(result.unsorted.map((x) => x.id)).toEqual(["stale"]);
  });
});

describe("tool.eisenhower.classify_and_persist — classify + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("classifies a (true, true) input as 'do' and stores it with framework='eisenhower'", async () => {
    const action = registry.get("tool.eisenhower.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Production outage triage",
        fields: { urgent: true, important: true },
      },
      ctx()
    )) as { id: string; quadrant: string; score: number };

    expect(result.quadrant).toBe("do");
    expect(result.score).toBe(4);

    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    const row = stored![0];
    expect(row.framework).toBe("eisenhower");
    expect(row.title).toBe("Production outage triage");
    expect(row.score).toBe(4);
    // The quadrant is derived from the answers, never stored (Phase 7).
    expect(row.fields?.quadrant).toBeUndefined();
    // Booleans coerced to strings — PrioritizationItem.fields can't
    // hold raw booleans (Record<string, number | string>).
    expect(row.fields?.urgent).toBe("true");
    expect(row.fields?.important).toBe("true");
    expect(row.status).toBe("scored");
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.eisenhower.classify_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { urgent: false, important: false },
      },
      ctx()
    )) as { id: string; quadrant: string };
    expect(result.id).toBe("explicit-id");
    expect(result.quadrant).toBe("delete");
  });
});

describe("tool.eisenhower.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns per-item quadrant + score", async () => {
    const action = registry.get("tool.eisenhower.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Fix prod bug",
            fields: { urgent: true, important: true },
          },
          {
            title: "Write strategy doc (auto-id)",
            fields: { urgent: false, important: true },
          },
          {
            title: "Approve PTO requests",
            fields: { urgent: true, important: false },
          },
        ],
      },
      ctx()
    )) as {
      written: Array<{ id: string; quadrant: string; score: number }>;
      count: number;
    };

    expect(result.count).toBe(3);
    expect(result.written[0]).toMatchObject({ id: "i1", quadrant: "do", score: 4 });
    expect(result.written[1].quadrant).toBe("schedule");
    expect(result.written[1].score).toBe(3);
    expect(result.written[1].id).toMatch(/^prio_/);
    expect(result.written[2]).toMatchObject({ quadrant: "delegate", score: 2 });
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(3);
  });

  // Phase 7 decision: the quadrant is derived. A quadrant given to a persist
  // is turned into the answers it stands for; one that contradicts the
  // answers given is refused (it used to be stored over them).
  it("turns an explicit quadrant into its answers, and refuses a contradiction", async () => {
    const action = registry.get("tool.eisenhower.persist_to_prioritization");
    const result = (await action!.handler(
      { items: [{ id: "q", title: "Manually pinned to delete", quadrant: "delete" }] },
      ctx()
    )) as { written: Array<{ id: string; quadrant: string; score: number }> };

    expect(result.written[0].quadrant).toBe("delete");
    expect(result.written[0].score).toBe(1);
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored![0].fields).toEqual({ urgent: "false", important: "false" });
    expect(stored![0].score).toBe(1);

    await expect(
      action!.handler(
        {
          items: [
            {
              id: "override",
              title: "Manually pinned to delete",
              fields: { urgent: true, important: true },
              quadrant: "delete",
            },
          ],
        },
        ctx()
      )
    ).rejects.toThrow(/contradicts/);
  });
});
