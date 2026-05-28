/**
 * tool.cynefin.* action coverage.
 *
 * Hybrid CLASSIFIER + CRUD-BACKED test pattern. Asserts:
 *   1. all 4 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path)
 *   3. classify is pure — covers each domain's signal vocabulary AND
 *      the priority order when multiple signals match
 *   4. list_state returns initialised buckets even when empty AND
 *      bucketing handles malformed domains by falling back to "confused"
 *   5. classify_and_persist supports BOTH the (a) explicit-domain and
 *      (b) signals-only entry paths, with (c) the explicit `domain` winning
 *      when both are supplied, and (d) rejection when neither is supplied
 *   6. set_recommended_action overwrites the field AND returns
 *      {updated:false} for unknown ids (no throw), preserving other fields
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CynefinItem } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/cynefin";

const EXPECTED_ACTIONS = [
  "tool.cynefin.classify",
  "tool.cynefin.list_state",
  "tool.cynefin.classify_and_persist",
  "tool.cynefin.set_recommended_action",
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

/** Build a fully-formed CynefinItem for seeding the store. */
function seed(
  partial: Partial<CynefinItem> & Pick<CynefinItem, "id" | "title" | "domain">
): CynefinItem {
  return {
    loggedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.cynefin — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("classify + list_state are category=read; persist + set are category=write", () => {
    expect(registry.get("tool.cynefin.classify")?.category).toBe("read");
    expect(registry.get("tool.cynefin.list_state")?.category).toBe("read");
    expect(registry.get("tool.cynefin.classify_and_persist")?.category).toBe("write");
    expect(registry.get("tool.cynefin.set_recommended_action")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.cynefin.classify_and_persist")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.cynefin.set_recommended_action")?.mcpHandler).toBeTypeOf("function");
    // list_state also has one because it reads workspace state.
    expect(registry.get("tool.cynefin.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("classify has NO mcpHandler — pure compute, same on server and client", () => {
    expect(registry.get("tool.cynefin.classify")?.mcpHandler).toBeUndefined();
  });

  it("write actions are requiresConfirmation=false (additive ops, no destruction)", () => {
    expect(registry.get("tool.cynefin.classify_and_persist")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.cynefin.set_recommended_action")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.cynefin.classify — pure rule", () => {
  // Each row: signals → expected recommendedDomain.
  const cases: Array<[string[], string]> = [
    [["known-knowns"], "clear"],
    [["best practice"], "clear"],
    [["obvious", "routine"], "clear"],
    [["known-unknowns"], "complicated"],
    [["expert review needed"], "complicated"],
    [["analyse with specialists"], "complicated"],
    [["unknown-unknowns"], "complex"],
    [["emergent behaviour"], "complex"],
    [["experiment with prototypes"], "complex"],
    [["urgent"], "chaotic"],
    [["crisis on prod"], "chaotic"],
    [["act now, learn later"], "chaotic"],
    [["fire in the building"], "chaotic"],
    [["undecided"], "confused"],
    [["unclear, no agreement"], "confused"],
    [[], "confused"],
    [["totally unrelated text"], "confused"], // no recognised signal
  ];

  for (const [signals, expected] of cases) {
    it(`classifies signals=[${signals.join(", ")}] → ${expected}`, async () => {
      const action = registry.get("tool.cynefin.classify");
      const result = (await action!.handler({ title: "test", signals }, ctx())) as {
        recommendedDomain: string;
        rationale: string;
        recommendedAction: string;
      };
      expect(result.recommendedDomain).toBe(expected);
      expect(result.rationale).toBeTypeOf("string");
      expect(result.rationale.length).toBeGreaterThan(0);
      expect(result.recommendedAction).toBeTypeOf("string");
      expect(result.recommendedAction.length).toBeGreaterThan(0);
    });
  }

  it("is case-insensitive on signal matching", async () => {
    const action = registry.get("tool.cynefin.classify");
    const result = (await action!.handler(
      { title: "x", signals: ["URGENT", "Best Practice"] },
      ctx()
    )) as { recommendedDomain: string };
    // Chaotic wins by priority order regardless of casing.
    expect(result.recommendedDomain).toBe("chaotic");
  });

  it("returns each domain's canonical recipe text", async () => {
    const action = registry.get("tool.cynefin.classify");
    // Clear → "Sense → Categorise → Respond..." per cynefin-client.tsx:27.
    const clearResult = (await action!.handler(
      { title: "x", signals: ["best practice"] },
      ctx()
    )) as { recommendedAction: string };
    expect(clearResult.recommendedAction).toContain("Sense");
    expect(clearResult.recommendedAction).toContain("Categorise");

    // Complex → "Probe → Sense → Respond..."
    const complexResult = (await action!.handler(
      { title: "x", signals: ["unknown-unknowns"] },
      ctx()
    )) as { recommendedAction: string };
    expect(complexResult.recommendedAction).toContain("Probe");

    // Chaotic → "Act → Sense → Respond..."
    const chaoticResult = (await action!.handler({ title: "x", signals: ["urgent"] }, ctx())) as {
      recommendedAction: string;
    };
    expect(chaoticResult.recommendedAction).toContain("Act");
  });

  describe("priority resolution when multiple signals match", () => {
    // chaotic > complex > complicated > clear > confused
    it("chaotic beats everything else", async () => {
      const action = registry.get("tool.cynefin.classify");
      const result = (await action!.handler(
        {
          title: "x",
          signals: ["urgent", "unknown-unknowns", "best practice", "known-unknowns"],
        },
        ctx()
      )) as { recommendedDomain: string };
      expect(result.recommendedDomain).toBe("chaotic");
    });

    it("complex beats complicated + clear", async () => {
      const action = registry.get("tool.cynefin.classify");
      const result = (await action!.handler(
        { title: "x", signals: ["unknown-unknowns", "known-unknowns", "best practice"] },
        ctx()
      )) as { recommendedDomain: string };
      expect(result.recommendedDomain).toBe("complex");
    });

    it("complicated beats clear", async () => {
      const action = registry.get("tool.cynefin.classify");
      const result = (await action!.handler(
        { title: "x", signals: ["known-unknowns", "best practice"] },
        ctx()
      )) as { recommendedDomain: string };
      expect(result.recommendedDomain).toBe("complicated");
    });
  });
});

describe("tool.cynefin.list_state — grouping + summary", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ cynefinItems: [] });
  });

  it("returns five empty buckets and total=0 when the workspace is empty", async () => {
    const action = registry.get("tool.cynefin.list_state");
    const result = (await action!.handler({}, ctx())) as {
      clear: CynefinItem[];
      complicated: CynefinItem[];
      complex: CynefinItem[];
      chaotic: CynefinItem[];
      confused: CynefinItem[];
      total: number;
    };
    expect(result.total).toBe(0);
    // Every bucket initialised — agent can index .complex without an
    // existence check even on an empty workspace.
    expect(result.clear).toEqual([]);
    expect(result.complicated).toEqual([]);
    expect(result.complex).toEqual([]);
    expect(result.chaotic).toEqual([]);
    expect(result.confused).toEqual([]);
  });

  it("buckets items by their persisted domain", async () => {
    const seeds: CynefinItem[] = [
      seed({ id: "c1", title: "Onboarding flow", domain: "clear" }),
      seed({ id: "c2", title: "Logging pipeline", domain: "complicated" }),
      seed({ id: "c3", title: "Pricing strategy", domain: "complex" }),
      seed({ id: "c4", title: "Auth outage", domain: "chaotic" }),
      seed({ id: "c5", title: "Random ask", domain: "confused" }),
      seed({ id: "c6", title: "Another routine task", domain: "clear" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertCynefinItem(s);

    const action = registry.get("tool.cynefin.list_state");
    const result = (await action!.handler({}, ctx())) as {
      clear: CynefinItem[];
      complicated: CynefinItem[];
      complex: CynefinItem[];
      chaotic: CynefinItem[];
      confused: CynefinItem[];
      total: number;
    };
    expect(result.total).toBe(6);
    expect(result.clear.map((x) => x.id).sort()).toEqual(["c1", "c6"]);
    expect(result.complicated.map((x) => x.id)).toEqual(["c2"]);
    expect(result.complex.map((x) => x.id)).toEqual(["c3"]);
    expect(result.chaotic.map((x) => x.id)).toEqual(["c4"]);
    expect(result.confused.map((x) => x.id)).toEqual(["c5"]);
  });

  it("falls back unknown / legacy domains to 'confused' (matches client behaviour)", async () => {
    // Pre-2014 Cynefin called the bottom-right domain "simple" (now
    // "clear"). The client coerces unknown values to "confused" at
    // cynefin-client.tsx:116 — the agent surface should match so the
    // two views of a single workspace never disagree on what's there.
    useWorkspaceStore.getState().upsertCynefinItem({
      id: "legacy",
      title: "stale row from pre-2014 Cynefin",
      // Deliberately out-of-enum value. CynefinItem.domain is a
      // literal union so we cast through `as` to seed it.
      domain: "simple" as unknown as CynefinItem["domain"],
      loggedAt: new Date().toISOString(),
    });

    const action = registry.get("tool.cynefin.list_state");
    const result = (await action!.handler({}, ctx())) as {
      confused: CynefinItem[];
      clear: CynefinItem[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.clear).toEqual([]);
    expect(result.confused.map((x) => x.id)).toEqual(["legacy"]);
  });
});

describe("tool.cynefin.classify_and_persist — write + classify roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ cynefinItems: [] });
  });

  it("persists with an explicit domain (skips classification)", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Pricing tier overhaul",
        domain: "complex",
      },
      ctx()
    )) as { id: string; domain: string; recommendedAction: string };

    expect(result.domain).toBe("complex");
    expect(result.id).toMatch(/^cynefin_/);
    // recommendedAction defaults to the canonical recipe for the domain
    // when not overridden — see RECIPE_BY_DOMAIN in tools/cynefin.ts.
    expect(result.recommendedAction).toContain("Probe");

    const stored = useWorkspaceStore.getState().cynefinItems;
    expect(stored).toHaveLength(1);
    expect(stored![0].title).toBe("Pricing tier overhaul");
    expect(stored![0].domain).toBe("complex");
    expect(stored![0].loggedAt).toBeTypeOf("string");
  });

  it("classifies from signals when domain is omitted", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    const result = (await action!.handler(
      {
        title: "Production outage",
        signals: ["urgent", "crisis"],
      },
      ctx()
    )) as { id: string; domain: string; recommendedAction: string };

    // Both signals map to chaotic — and chaotic wins priority.
    expect(result.domain).toBe("chaotic");
    expect(result.recommendedAction).toContain("Act");
  });

  it("explicit domain wins when both domain AND signals are supplied", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    // Signals would classify as 'chaotic', but the explicit 'clear'
    // overrides — the caller has decided upstream.
    const result = (await action!.handler(
      {
        title: "Override case",
        domain: "clear",
        signals: ["urgent", "crisis", "act now"],
      },
      ctx()
    )) as { domain: string };
    expect(result.domain).toBe("clear");
  });

  it("rejects when neither domain nor signals is supplied", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    // Zod's refine() at the schema layer guards this — paramsSchema
    // throws before the handler runs, surfacing as a parse error.
    const parsed = action!.paramsSchema.safeParse({ title: "naked" });
    expect(parsed.success).toBe(false);
  });

  it("rejects when signals is an empty array AND domain is missing", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    const parsed = action!.paramsSchema.safeParse({ title: "naked", signals: [] });
    expect(parsed.success).toBe(false);
  });

  it("honours an explicit custom rationale and recommendedAction override", async () => {
    const action = registry.get("tool.cynefin.classify_and_persist");
    await action!.handler(
      {
        title: "Custom recipe project",
        domain: "complex",
        rationale: "specific to our quarterly experiment cadence",
        recommendedAction: "Probe by spiking the auth flow this sprint",
      },
      ctx()
    );
    const stored = useWorkspaceStore.getState().cynefinItems;
    expect(stored![0].rationale).toBe("specific to our quarterly experiment cadence");
    expect(stored![0].recommendedAction).toBe("Probe by spiking the auth flow this sprint");
  });
});

describe("tool.cynefin.set_recommended_action — single-field update", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ cynefinItems: [] });
  });

  it("overwrites the recommendedAction field and returns {updated: true}", async () => {
    useWorkspaceStore.getState().upsertCynefinItem(
      seed({
        id: "c1",
        title: "Pricing",
        domain: "complex",
        recommendedAction: "Probe → Sense → Respond. Run safe-to-fail experiments.",
      })
    );

    const action = registry.get("tool.cynefin.set_recommended_action");
    const result = (await action!.handler(
      { id: "c1", recommendedAction: "Run two pricing A/B tests in Q3" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = useWorkspaceStore.getState().cynefinItems!.find((c) => c.id === "c1");
    expect(stored?.recommendedAction).toBe("Run two pricing A/B tests in Q3");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.cynefin.set_recommended_action");
    const result = (await action!.handler(
      { id: "does-not-exist", recommendedAction: "..." },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });

  it("preserves all other fields when updating (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertCynefinItem(
      seed({
        id: "c2",
        title: "Vendor decision",
        domain: "complicated",
        rationale: "needs procurement specialist",
      })
    );

    const action = registry.get("tool.cynefin.set_recommended_action");
    await action!.handler({ id: "c2", recommendedAction: "Loop in legal by Tuesday" }, ctx());

    const updated = useWorkspaceStore.getState().cynefinItems!.find((c) => c.id === "c2");
    expect(updated?.title).toBe("Vendor decision");
    expect(updated?.domain).toBe("complicated");
    expect(updated?.rationale).toBe("needs procurement specialist");
    expect(updated?.recommendedAction).toBe("Loop in legal by Tuesday");
  });
});
