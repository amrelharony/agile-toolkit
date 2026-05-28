/**
 * tool.polarity_map.* action coverage.
 *
 * CRUD-backed (decision-frameworks) variant of the squad-13 test pattern.
 * Polarity is a single-entity record (no kind asymmetry); we cover:
 *
 *   1. all 5 actions registered with the right category split
 *   2. write actions all expose an mcpHandler (server-side path);
 *      suggest_questions (pure) does NOT — it would no-op on the
 *      server-side singleton.
 *   3. list_state returns zeroed completeness counts when the workspace
 *      is empty AND aggregates withGreaterPurpose / withDeeperFear
 *      correctly across mixed-fill seeds. Whitespace-only anchors
 *      DON'T count as filled (mirrors the client's
 *      `.trim() || undefined` pattern).
 *   4. create_polarity persists a row with all three fields, generates a
 *      `polarity_*` id, and returns it. Trims title / anchor whitespace.
 *      Optional anchors omitted on input become `undefined` on the
 *      stored row (not "" — that would break the summarize() trim check).
 *   5. set_greater_purpose / set_deeper_fear each update the named field
 *      AND preserve all other Polarity fields (no patch leak — title +
 *      the OTHER anchor must survive). Unknown id returns
 *      {updated: false} without throwing.
 *   6. suggest_questions is pure, deterministic, returns exactly 6
 *      questions, and SPLITS the polarity title on " ↔ " / " vs " etc.
 *      to embed the real pole labels in the questions. Falls back to
 *      "Pole A" / "Pole B" when no separator is recognised.
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Polarity } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/polarity-map";

const EXPECTED_ACTIONS = [
  "tool.polarity_map.list_state",
  "tool.polarity_map.create_polarity",
  "tool.polarity_map.set_greater_purpose",
  "tool.polarity_map.set_deeper_fear",
  "tool.polarity_map.suggest_questions",
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

/** Build a minimal Polarity for seeding the store. Required fields are
 *  just id + title; anchors are optional by entity contract. */
function seed(partial: Partial<Polarity> & Pick<Polarity, "id" | "title">): Polarity {
  return { ...partial };
}

describe("tool.polarity_map — registration", () => {
  it("registers all 5 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state + suggest_questions are read; mutations are write", () => {
    expect(registry.get("tool.polarity_map.list_state")?.category).toBe("read");
    expect(registry.get("tool.polarity_map.suggest_questions")?.category).toBe("read");
    expect(registry.get("tool.polarity_map.create_polarity")?.category).toBe("write");
    expect(registry.get("tool.polarity_map.set_greater_purpose")?.category).toBe("write");
    expect(registry.get("tool.polarity_map.set_deeper_fear")?.category).toBe("write");
  });

  it("write actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.polarity_map.create_polarity")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.polarity_map.set_greater_purpose")?.mcpHandler).toBeTypeOf(
      "function"
    );
    expect(registry.get("tool.polarity_map.set_deeper_fear")?.mcpHandler).toBeTypeOf("function");
  });

  it("suggest_questions is pure — NO mcpHandler (runs identically on both paths)", () => {
    expect(registry.get("tool.polarity_map.suggest_questions")?.mcpHandler).toBeUndefined();
  });

  it("list_state has an mcpHandler (reads server-store on the MCP path)", () => {
    // list_state is read-only but still needs the mcpHandler because
    // the browser Zustand store is empty on the server (the user's data
    // lives in Supabase and is reached via serverListEntities).
    expect(registry.get("tool.polarity_map.list_state")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.polarity_map.list_state — summary + roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ polarities: [] });
  });

  it("returns zeroed counts and empty items when the workspace is empty", async () => {
    const action = registry.get("tool.polarity_map.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      withGreaterPurpose: number;
      withDeeperFear: number;
      items: Polarity[];
    };
    expect(result.total).toBe(0);
    expect(result.withGreaterPurpose).toBe(0);
    expect(result.withDeeperFear).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("aggregates completeness counts across mixed-fill seeds", async () => {
    // Seed:
    //   p1 — both anchors filled
    //   p2 — only Greater Purpose
    //   p3 — only Deeper Fear
    //   p4 — neither anchor (title only)
    //   p5 — both anchors set to whitespace only (must NOT count as filled)
    const seeds: Polarity[] = [
      seed({
        id: "p1",
        title: "Autonomy ↔ Standardisation",
        greaterPurpose: "A high-performing engineering org",
        deeperFear: "An organisation we can't ship from",
      }),
      seed({
        id: "p2",
        title: "Stability ↔ Change",
        greaterPurpose: "A resilient, evolving product",
      }),
      seed({
        id: "p3",
        title: "Centralisation ↔ Distribution",
        deeperFear: "Chaotic, ungovernable systems",
      }),
      seed({ id: "p4", title: "Speed ↔ Quality" }),
      seed({
        id: "p5",
        title: "Plan ↔ Adapt",
        greaterPurpose: "   ",
        deeperFear: "   ",
      }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertPolarity(s);

    const action = registry.get("tool.polarity_map.list_state");
    const result = (await action!.handler({}, ctx())) as {
      total: number;
      withGreaterPurpose: number;
      withDeeperFear: number;
      items: Polarity[];
    };
    expect(result.total).toBe(5);
    // p1 + p2 have greater purpose set; p5 whitespace-only doesn't count.
    expect(result.withGreaterPurpose).toBe(2);
    // p1 + p3 have deeper fear set; p5 whitespace-only doesn't count.
    expect(result.withDeeperFear).toBe(2);
    expect(result.items).toHaveLength(5);
  });
});

describe("tool.polarity_map.create_polarity — convenience create", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ polarities: [] });
  });

  it("creates a row with all three fields, returns {id}, and uses a polarity_* id", async () => {
    const action = registry.get("tool.polarity_map.create_polarity");
    const result = (await action!.handler(
      {
        title: "Autonomy ↔ Standardisation",
        greaterPurpose: "A high-performing engineering org",
        deeperFear: "An organisation we can't ship from",
      },
      ctx()
    )) as { id: string };
    expect(result.id).toMatch(/^polarity_/);

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === result.id);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe("Autonomy ↔ Standardisation");
    expect(stored?.greaterPurpose).toBe("A high-performing engineering org");
    expect(stored?.deeperFear).toBe("An organisation we can't ship from");
  });

  it("trims whitespace on title and anchors", async () => {
    const action = registry.get("tool.polarity_map.create_polarity");
    const result = (await action!.handler(
      {
        title: "  Speed ↔ Quality  ",
        greaterPurpose: "  Delight users  ",
        deeperFear: "  Ship a broken product  ",
      },
      ctx()
    )) as { id: string };

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === result.id);
    expect(stored?.title).toBe("Speed ↔ Quality");
    expect(stored?.greaterPurpose).toBe("Delight users");
    expect(stored?.deeperFear).toBe("Ship a broken product");
  });

  it("stores anchors as undefined (not '') when omitted on input", async () => {
    // Critical for the summarize() count to be accurate — an empty
    // string would also fail the .trim() check, but undefined is the
    // canonical "field not set" representation the entity uses.
    const action = registry.get("tool.polarity_map.create_polarity");
    const result = (await action!.handler({ title: "Bare title" }, ctx())) as { id: string };

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === result.id);
    expect(stored?.greaterPurpose).toBeUndefined();
    expect(stored?.deeperFear).toBeUndefined();
  });

  it("treats whitespace-only anchors as undefined (consistent with the client)", async () => {
    const action = registry.get("tool.polarity_map.create_polarity");
    const result = (await action!.handler(
      { title: "Plan ↔ Adapt", greaterPurpose: "   ", deeperFear: "" },
      ctx()
    )) as { id: string };

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === result.id);
    expect(stored?.greaterPurpose).toBeUndefined();
    expect(stored?.deeperFear).toBeUndefined();
  });
});

describe("tool.polarity_map.set_greater_purpose — single-field update", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ polarities: [] });
  });

  it("sets the Greater Purpose on an existing polarity and returns {updated: true}", async () => {
    useWorkspaceStore
      .getState()
      .upsertPolarity(seed({ id: "p1", title: "Autonomy ↔ Standardisation" }));

    const action = registry.get("tool.polarity_map.set_greater_purpose");
    const result = (await action!.handler(
      { id: "p1", greaterPurpose: "A high-performing engineering org" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === "p1");
    expect(stored?.greaterPurpose).toBe("A high-performing engineering org");
  });

  it("preserves title AND the other anchor (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertPolarity(
      seed({
        id: "p1",
        title: "Centralisation ↔ Distribution",
        deeperFear: "Chaotic, ungovernable systems",
      })
    );

    const action = registry.get("tool.polarity_map.set_greater_purpose");
    await action!.handler({ id: "p1", greaterPurpose: "Coherent autonomy" }, ctx());

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === "p1");
    expect(stored?.title).toBe("Centralisation ↔ Distribution");
    expect(stored?.deeperFear).toBe("Chaotic, ungovernable systems");
    expect(stored?.greaterPurpose).toBe("Coherent autonomy");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.polarity_map.set_greater_purpose");
    const result = (await action!.handler(
      { id: "does-not-exist", greaterPurpose: "anything" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });
});

describe("tool.polarity_map.set_deeper_fear — single-field update", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ polarities: [] });
  });

  it("sets the Deeper Fear on an existing polarity and returns {updated: true}", async () => {
    useWorkspaceStore.getState().upsertPolarity(seed({ id: "p1", title: "Speed ↔ Quality" }));

    const action = registry.get("tool.polarity_map.set_deeper_fear");
    const result = (await action!.handler(
      { id: "p1", deeperFear: "Ship a broken product nobody trusts" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(true);

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === "p1");
    expect(stored?.deeperFear).toBe("Ship a broken product nobody trusts");
  });

  it("preserves title AND the other anchor (no patch leak)", async () => {
    useWorkspaceStore.getState().upsertPolarity(
      seed({
        id: "p1",
        title: "Plan ↔ Adapt",
        greaterPurpose: "Reliable, responsive delivery",
      })
    );

    const action = registry.get("tool.polarity_map.set_deeper_fear");
    await action!.handler({ id: "p1", deeperFear: "Rigid plans nobody follows" }, ctx());

    const stored = (useWorkspaceStore.getState().polarities ?? []).find((p) => p.id === "p1");
    expect(stored?.title).toBe("Plan ↔ Adapt");
    expect(stored?.greaterPurpose).toBe("Reliable, responsive delivery");
    expect(stored?.deeperFear).toBe("Rigid plans nobody follows");
  });

  it("returns {updated: false} for an unknown id (no throw)", async () => {
    const action = registry.get("tool.polarity_map.set_deeper_fear");
    const result = (await action!.handler(
      { id: "does-not-exist", deeperFear: "anything" },
      ctx()
    )) as { updated: boolean };
    expect(result.updated).toBe(false);
  });
});

describe("tool.polarity_map.suggest_questions — pure facilitation prompts", () => {
  it("returns exactly 6 questions", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const result = (await action!.handler({ title: "Autonomy ↔ Standardisation" }, ctx())) as {
      questions: string[];
    };
    expect(result.questions).toHaveLength(6);
    // The 5-7 range advertised in the description must include 6, so
    // anything in that span is acceptable to the agent. We pin to 6
    // here so an accidental refactor (e.g. dropping a quadrant) fails
    // loudly rather than silently shrinking the surface.
    for (const q of result.questions) {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(0);
    }
  });

  it("embeds the parsed pole labels when the title uses ' ↔ '", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const result = (await action!.handler({ title: "Autonomy ↔ Standardisation" }, ctx())) as {
      questions: string[];
    };

    // Every question that mentions a quadrant should reference one of
    // the actual labels — not the fallback "Pole A" / "Pole B".
    const blob = result.questions.join("\n");
    expect(blob).toContain("Autonomy");
    expect(blob).toContain("Standardisation");
    expect(blob).not.toContain("Pole A");
    expect(blob).not.toContain("Pole B");
  });

  it("recognises ' vs ' as a pole separator too", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const result = (await action!.handler({ title: "Speed vs Quality" }, ctx())) as {
      questions: string[];
    };

    const blob = result.questions.join("\n");
    expect(blob).toContain("Speed");
    expect(blob).toContain("Quality");
    expect(blob).not.toContain("Pole A");
  });

  it("recognises ' / ' as a pole separator", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const result = (await action!.handler({ title: "Push / Pull" }, ctx())) as {
      questions: string[];
    };
    const blob = result.questions.join("\n");
    expect(blob).toContain("Push");
    expect(blob).toContain("Pull");
  });

  it("falls back to 'Pole A' / 'Pole B' when no separator is recognised", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const result = (await action!.handler({ title: "Centralisation issue" }, ctx())) as {
      questions: string[];
    };

    const blob = result.questions.join("\n");
    expect(blob).toContain("Pole A");
    expect(blob).toContain("Pole B");
  });

  it("is deterministic — two calls with the same title produce identical output", async () => {
    const action = registry.get("tool.polarity_map.suggest_questions");
    const r1 = (await action!.handler({ title: "Autonomy ↔ Standardisation" }, ctx())) as {
      questions: string[];
    };
    const r2 = (await action!.handler({ title: "Autonomy ↔ Standardisation" }, ctx())) as {
      questions: string[];
    };
    expect(r1.questions).toEqual(r2.questions);
  });
});
