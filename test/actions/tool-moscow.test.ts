/**
 * tool.moscow.* action coverage.
 *
 * Mirrors the squad-13 canonical CLASSIFIER pattern from
 * tool-eisenhower.test.ts. Asserts:
 *   1. all 4 actions registered with the right category split
 *   2. classify echoes the category back with its numeric priority +
 *      description
 *   3. list_items filters by framework='moscow' AND buckets by category
 *      using the `fields.bucket` key (matches moscow-client.tsx)
 *   4. classify_and_persist roundtrips through the workspace store
 *   5. persist_to_prioritization bulk-writes N items with priority
 *      scores
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
import "@/lib/actions/tools/moscow";

const EXPECTED_ACTIONS = [
  "tool.moscow.classify",
  "tool.moscow.list_items",
  "tool.moscow.classify_and_persist",
  "tool.moscow.persist_to_prioritization",
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

describe("tool.moscow — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("classify + list are category=read; persist actions are category=write", () => {
    expect(registry.get("tool.moscow.classify")?.category).toBe("read");
    expect(registry.get("tool.moscow.list_items")?.category).toBe("read");
    expect(registry.get("tool.moscow.classify_and_persist")?.category).toBe("write");
    expect(registry.get("tool.moscow.persist_to_prioritization")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.moscow.classify_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.moscow.persist_to_prioritization")?.mcpHandler).toBeTypeOf(
      "function"
    );
    // list_items also has one because it reads workspace state.
    expect(registry.get("tool.moscow.list_items")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.moscow.classify — pure echo + priority mapping", () => {
  // Each row: category → expected (priority, description-substring).
  const cases: Array<[string, number, string]> = [
    ["must", 4, "Must have"],
    ["should", 3, "Should have"],
    ["could", 2, "Could have"],
    ["wont", 1, "Won't have"],
  ];

  for (const [category, priority, descrFragment] of cases) {
    it(`classifies category='${category}' → priority ${priority}`, async () => {
      const action = registry.get("tool.moscow.classify");
      const result = (await action!.handler({ category }, ctx())) as {
        category: string;
        priority: number;
        description: string;
      };
      expect(result.category).toBe(category);
      expect(result.priority).toBe(priority);
      expect(result.description).toContain(descrFragment);
    });
  }
});

describe("tool.moscow.list_items — framework filter + bucketing", () => {
  beforeEach(() => {
    // Reset the prioritization slice so prior tests don't bleed in.
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("returns four empty buckets and total=0 when the workspace is empty", async () => {
    const action = registry.get("tool.moscow.list_items");
    const result = (await action!.handler({}, ctx())) as {
      must: unknown[];
      should: unknown[];
      could: unknown[];
      wont: unknown[];
      total: number;
    };
    expect(result.total).toBe(0);
    expect(result.must).toEqual([]);
    expect(result.should).toEqual([]);
    expect(result.could).toEqual([]);
    expect(result.wont).toEqual([]);
  });

  it("filters out non-moscow framework items and buckets by category", async () => {
    const seeds: PrioritizationItem[] = [
      {
        id: "p1",
        framework: "moscow",
        title: "Auth required",
        score: 4,
        fields: { bucket: "must" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p2",
        framework: "moscow",
        title: "SSO integration",
        score: 3,
        fields: { bucket: "should" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p3",
        framework: "moscow",
        title: "Dark mode polish",
        score: 2,
        fields: { bucket: "could" },
        status: "scored",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "p4",
        framework: "moscow",
        title: "Voice control",
        score: 1,
        fields: { bucket: "wont" },
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

    const action = registry.get("tool.moscow.list_items");
    const result = (await action!.handler({}, ctx())) as {
      must: PrioritizationItem[];
      should: PrioritizationItem[];
      could: PrioritizationItem[];
      wont: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(4); // wsjf item excluded
    expect(result.must.map((x) => x.id)).toEqual(["p1"]);
    expect(result.should.map((x) => x.id)).toEqual(["p2"]);
    expect(result.could.map((x) => x.id)).toEqual(["p3"]);
    expect(result.wont.map((x) => x.id)).toEqual(["p4"]);
  });

  it("falls back unknown / missing buckets to 'must' (matches client behaviour)", async () => {
    // Stale persisted bucket value — the client coerces it to "must"
    // at moscow-client.tsx:80 to avoid `m[unknown].push` crashes, and so
    // should the agent surface.
    useWorkspaceStore.getState().upsertPrioritization({
      id: "stale",
      framework: "moscow",
      title: "stale row",
      score: 4,
      fields: { bucket: "WEIRD_VALUE" }, // not in {must, should, could, wont}
      status: "scored",
      updatedAt: new Date().toISOString(),
    });

    const action = registry.get("tool.moscow.list_items");
    const result = (await action!.handler({}, ctx())) as {
      must: PrioritizationItem[];
      should: PrioritizationItem[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.must.map((x) => x.id)).toEqual(["stale"]);
  });
});

describe("tool.moscow.classify_and_persist — classify + write roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("stores a 'must' category with framework='moscow' and score=4", async () => {
    const action = registry.get("tool.moscow.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "User can log in",
        fields: { category: "must" },
      },
      ctx()
    )) as { id: string; category: string; priority: number };

    expect(result.category).toBe("must");
    expect(result.priority).toBe(4);

    const stored = useWorkspaceStore.getState().prioritizations;
    expect(stored).toHaveLength(1);
    const row = stored![0];
    expect(row.framework).toBe("moscow");
    expect(row.title).toBe("User can log in");
    expect(row.score).toBe(4);
    // Stored in `bucket` (the field key moscow-client.tsx reads from)
    // — NOT `category`. Round-trip with the UI depends on this key.
    expect(row.fields?.bucket).toBe("must");
    expect(row.status).toBe("scored");
  });

  it("stores a 'wont' category with score=1", async () => {
    const action = registry.get("tool.moscow.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Crypto payments",
        fields: { category: "wont" },
      },
      ctx()
    )) as { id: string; category: string; priority: number };

    expect(result.category).toBe("wont");
    expect(result.priority).toBe(1);
    expect(useWorkspaceStore.getState().prioritizations![0].score).toBe(1);
    expect(useWorkspaceStore.getState().prioritizations![0].fields?.bucket).toBe("wont");
  });

  it("uses the supplied id when provided", async () => {
    const action = registry.get("tool.moscow.classify_and_persist");
    const result = (await action!.handler(
      {
        id: "explicit-id",
        title: "X",
        fields: { category: "could" },
      },
      ctx()
    )) as { id: string; category: string };
    expect(result.id).toBe("explicit-id");
    expect(result.category).toBe("could");
  });
});

describe("tool.moscow.persist_to_prioritization — bulk write", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ prioritizations: [] });
  });

  it("writes N items in one call and returns per-item category + priority", async () => {
    const action = registry.get("tool.moscow.persist_to_prioritization");
    const result = (await action!.handler(
      {
        items: [
          {
            id: "i1",
            title: "Login flow",
            fields: { category: "must" },
          },
          {
            title: "Profile pictures (auto-id)",
            fields: { category: "should" },
          },
          {
            title: "Theme picker",
            fields: { category: "could" },
          },
          {
            title: "AR mode",
            fields: { category: "wont" },
          },
        ],
      },
      ctx()
    )) as {
      written: Array<{ id: string; category: string; priority: number }>;
      count: number;
    };

    expect(result.count).toBe(4);
    expect(result.written[0]).toMatchObject({ id: "i1", category: "must", priority: 4 });
    expect(result.written[1].category).toBe("should");
    expect(result.written[1].priority).toBe(3);
    expect(result.written[1].id).toMatch(/^prio_/);
    expect(result.written[2]).toMatchObject({ category: "could", priority: 2 });
    expect(result.written[3]).toMatchObject({ category: "wont", priority: 1 });
    expect(useWorkspaceStore.getState().prioritizations).toHaveLength(4);
  });

  it("persists each item's category to fields.bucket (UI round-trip)", async () => {
    const action = registry.get("tool.moscow.persist_to_prioritization");
    await action!.handler(
      {
        items: [
          { id: "a", title: "Critical path A", fields: { category: "must" } },
          { id: "b", title: "Polish B", fields: { category: "could" } },
        ],
      },
      ctx()
    );

    const stored = useWorkspaceStore.getState().prioritizations ?? [];
    const a = stored.find((x) => x.id === "a")!;
    const b = stored.find((x) => x.id === "b")!;
    expect(a.fields?.bucket).toBe("must");
    expect(a.score).toBe(4);
    expect(b.fields?.bucket).toBe("could");
    expect(b.score).toBe(2);
  });
});
