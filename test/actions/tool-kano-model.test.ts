/**
 * tool.kano_model.* action coverage.
 *
 * Mirrors the squad-13 canonical classifier test pattern from
 * tool-eisenhower.test.ts, adapted for Kano's two-path classifier
 * (direct category OR functional/dysfunctional survey pair). Asserts:
 *   1. all 4 actions registered with the right category split
 *   2. classify is pure on the direct-category path
 *   3. classify derives the right category from the canonical Kano
 *      5×5 evaluation table for representative survey pairs
 *   4. list_items filters by framework='kano' AND buckets by category
 *   5. classify_and_persist roundtrips through the workspace store for
 *      both classification paths
 *   6. persist_to_prioritization handles a mixed batch (some direct-
 *      category items, some survey-driven items) in one call
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
import "@/lib/actions/tools/kano-model";

const EXPECTED_ACTIONS = [
  "tool.kano_model.classify",
  "tool.kano_model.list_items",
  "tool.kano_model.classify_and_persist",
  "tool.kano_model.persist_to_prioritization",
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

describe("tool.kano_model — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("classify + list are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.kano_model.classify")?.category).toBe("read");
    expect(registry.get("tool.kano_model.list_items")?.category).toBe("read");
    expect(registry.get("tool.kano_model.classify_and_persist")?.category).toBe("write");
    expect(registry.get("tool.kano_model.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.kano_model.classify_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.kano_model.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
    // list_items also has one because it reads workspace state.
    expect(registry.get("tool.kano_model.list_items")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.kano_model.classify — direct category path", () => {
  // Each row: direct category → expected (echoed category, sort score).
  // The mapping mirrors the brief once basic↔must-be and
  // excitement↔attractive synonyms are applied (the client uses the
  // modern PM vocabulary; the brief uses Kano's textbook names).
  const cases: Array<[string, number]> = [
    ["attractive", 5], // textbook: "excitement"
    ["performance", 4],
    ["must-be", 3], // textbook: "basic"
    ["indifferent", 2],
    ["reverse", 1],
  ];

  for (const [category, score] of cases) {
    it(`classifies direct category "${category}" → score ${score}`, async () => {
      const action = registry.get("tool.kano_model.classify");
      const result = (await action!.handler({ category }, ctx())) as {
        category: string;
        score: number;
        explanation: string;
      };
      expect(result.category).toBe(category);
      expect(result.score).toBe(score);
      expect(result.explanation).toMatch(/[A-Za-z]/); // non-empty explanation
    });
  }
});

describe("tool.kano_model.classify — functional × dysfunctional survey path", () => {
  // Spot-check the canonical Kano evaluation table. Each row asserts a
  // representative cell of the 5×5 mapping (Sauerwein et al. 1996).
  // Naming: (functional, dysfunctional) — i.e. (how you feel if PRESENT,
  // how you feel if ABSENT).
  const cases: Array<[string, string, string]> = [
    // The "I like it / I dislike its absence" diagonal is performance —
    // satisfaction is linear with feature delivery.
    ["like", "dislike", "performance"],
    // "I like it / I'd be neutral if it were absent" — classic attractive
    // (delighter you wouldn't miss).
    ["like", "neutral", "attractive"],
    ["like", "live_with", "attractive"],
    ["like", "must", "attractive"],
    // "I expect it / I'd dislike it absent" — must-be (baseline expectation).
    ["neutral", "dislike", "must-be"],
    ["must", "dislike", "must-be"],
    ["live_with", "dislike", "must-be"],
    // "I'd dislike its presence" — reverse (anti-feature for this segment).
    ["dislike", "neutral", "reverse"],
    ["dislike", "like", "reverse"],
    ["must", "like", "reverse"],
    // No-signal cells → indifferent (we collapse the Kano "Q" code into
    // indifferent for the 5-bucket surface).
    ["like", "like", "indifferent"], // Q
    ["dislike", "dislike", "indifferent"], // Q
    ["neutral", "neutral", "indifferent"],
    ["must", "neutral", "indifferent"],
  ];

  for (const [functional, dysfunctional, expected] of cases) {
    it(`(functional=${functional}, dysfunctional=${dysfunctional}) → ${expected}`, async () => {
      const action = registry.get("tool.kano_model.classify");
      const result = (await action!.handler({ functional, dysfunctional }, ctx())) as {
        category: string;
        score: number;
      };
      expect(result.category).toBe(expected);
    });
  }

  it("rejects input with neither category nor a complete survey pair", async () => {
    const action = registry.get("tool.kano_model.classify");
    // Schema is validated upstream by the registry's tool-use surface,
    // but the zod refine is on the schema we expose, so a direct parse
    // is the cleanest place to assert this contract.
    const schema = action!.paramsSchema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ functional: "like" }).success).toBe(false); // only one half
    expect(schema.safeParse({ dysfunctional: "dislike" }).success).toBe(false);
    expect(schema.safeParse({ category: "performance" }).success).toBe(true);
    expect(schema.safeParse({ functional: "like", dysfunctional: "dislike" }).success).toBe(true);
  });
});

describe("tool.kano_model.list_items — framework filter + bucketing", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns five empty buckets and total=0 when the workspace is empty", async () => {
    const action = registry.get("tool.kano_model.list_items");
    const result = (await action!.handler({}, ctx())) as {
      "must-be": unknown[];
      performance: unknown[];
      attractive: unknown[];
      indifferent: unknown[];
      reverse: unknown[];
      total: number;
    };
    expect(result.total).toBe(0);
    expect(result["must-be"]).toEqual([]);
    expect(result.performance).toEqual([]);
    expect(result.attractive).toEqual([]);
    expect(result.indifferent).toEqual([]);
    expect(result.reverse).toEqual([]);
  });

  it("filters out non-kano framework items and buckets by category", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "kano",
        title: "Password reset works",
        score: 3,
        fields: { category: "must-be" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "kano",
        title: "Sub-second page load",
        score: 4,
        fields: { category: "performance" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p3",
        framework: "kano",
        title: "Cool new animation",
        score: 5,
        fields: { category: "attractive" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p4",
        framework: "kano",
        title: "Detail nobody asked for",
        score: 2,
        fields: { category: "indifferent" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p5",
        framework: "kano",
        title: "Aggressive popup",
        score: 1,
        fields: { category: "reverse" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p6",
        framework: "wsjf",
        title: "WSJF noise",
        score: 99,
        fields: {},
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPrioritization(s);

    const action = registry.get("tool.kano_model.list_items");
    const result = (await action!.handler({}, ctx())) as {
      "must-be": PrioritizationItem[];
      performance: PrioritizationItem[];
      attractive: PrioritizationItem[];
      indifferent: PrioritizationItem[];
      reverse: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(5); // wsjf item excluded
    expect(result["must-be"].map((x) => x.id)).toEqual(["p1"]);
    expect(result.performance.map((x) => x.id)).toEqual(["p2"]);
    expect(result.attractive.map((x) => x.id)).toEqual(["p3"]);
    expect(result.indifferent.map((x) => x.id)).toEqual(["p4"]);
    expect(result.reverse.map((x) => x.id)).toEqual(["p5"]);
  });

  it("falls back unknown / missing categories to 'performance' (matches client behaviour)", async () => {
    // Stale persisted category value — the client coerces it to
    // "performance" at kano-model-client.tsx:107 to avoid
    // `m[unknown].push` crashes, and so should the agent surface.
    useWorkspaceStore.getState().upsertPrioritization({
      id: "stale",
      framework: "kano",
      title: "stale row",
      score: 4,
      fields: { category: "WEIRD_VALUE" }, // not in known categories
      status: "scored",
      updatedAt: new Date().toISOString(),
    });

    const action = registry.get("tool.kano_model.list_items");
    const result = (await action!.handler({}, ctx())) as {
      performance: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.performance.map((x) => x.id)).toEqual(["stale"]);
  });
});

describe("tool.kano_model.classify_and_persist — classify + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("classifies a direct-category 'attractive' input and stores it with framework='kano'", async () => {
    const action = registry.get("tool.kano_model.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Surprise birthday animation",
        fields: { category: "attractive" },
      },
      ctx()
    )) as { id: string; category: string; score: number; explanation: string };

    expect(result.category).toBe("attractive");
    expect(result.score).toBe(5);

    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    const row = stored![0];
    expect(row.framework).toBe("kano");
    expect(row.title).toBe("Surprise birthday animation");
    expect(row.score).toBe(5);
    expect(row.fields?.category).toBe("attractive");
    expect(row.status).toBe("scored");
  });

  it("derives 'performance' from (like, dislike) survey answers and persists the survey row", async () => {
    const action = registry.get("tool.kano_model.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Faster checkout",
        fields: { functional: "like", dysfunctional: "dislike" },
      },
      ctx()
    )) as { id: string; category: string; score: number };

    expect(result.category).toBe("performance");
    expect(result.score).toBe(4);

    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    const row = stored![0];
    expect(row.fields?.category).toBe("performance");
    // Survey answers persisted alongside the derived category for audit
    // / re-derivation later.
    expect(row.fields?.functional).toBe("like");
    expect(row.fields?.dysfunctional).toBe("dislike");
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.kano_model.classify_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { category: "reverse" },
      },
      ctx()
    )) as { id: string; category: string };
    expect(result.id).toBe("explicit-id");
    expect(result.category).toBe("reverse");
  });
});

describe("tool.kano_model.persist_to_prioritization — bulk write (mixed paths)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes a mixed batch (direct-category + survey-driven) in one call", async () => {
    const action = registry.get("tool.kano_model.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Login works",
            fields: { category: "must-be" },
          },
          {
            // Survey-driven — derives to "performance" via the Kano table.
            title: "Faster page load (auto-id)",
            fields: { functional: "like", dysfunctional: "dislike" },
          },
          {
            // Survey-driven — derives to "attractive".
            title: "Easter egg",
            fields: { functional: "like", dysfunctional: "neutral" },
          },
        ],
      },
      ctx()
    )) as {
      written: Array<{ id: string; category: string; score: number }>;
      count: number;
    };

    expect(result.count).toBe(3);
    expect(result.written[0]).toMatchObject({ id: "i1", category: "must-be", score: 3 });
    expect(result.written[1].category).toBe("performance");
    expect(result.written[1].score).toBe(4);
    expect(result.written[1].id).toMatch(/^prio_/);
    expect(result.written[2]).toMatchObject({ category: "attractive", score: 5 });
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(3);
  });

  it("survey-derived rows persist BOTH the survey answers and the derived category", async () => {
    const action = registry.get("tool.kano_model.persist_to_prioritization");
    await action!.handler(
      {
        items: [
          {
            id: "audit",
            title: "audit row",
            fields: { functional: "must", dysfunctional: "dislike" },
          },
        ],
      },
      ctx()
    );
    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    expect(stored![0].fields?.category).toBe("must-be");
    expect(stored![0].fields?.functional).toBe("must");
    expect(stored![0].fields?.dysfunctional).toBe("dislike");
    expect(stored![0].score).toBe(3);
  });
});
