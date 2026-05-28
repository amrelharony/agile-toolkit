/**
 * tool.six_hats.* action coverage.
 *
 * Decision-CRUD variant of the squad-13 test pattern. Six Hats has no
 * formula to assert — it's a record-keeping entity (id, hat, text,
 * loggedAt). Coverage matrix:
 *
 *   1. all 4 actions registered with the right category split
 *      (list_state, summarize_by_hat → read; log_thought → write;
 *      export_session → read).
 *   2. write actions all expose an mcpHandler (server-side path);
 *      summarize_by_hat is pure and has none by design.
 *   3. list_state returns initialised per-hat buckets even when empty
 *      AND groups correctly across mixed-hat seeds.
 *   4. log_thought creates a new thought, stamps id + loggedAt, and
 *      defends against blank input via Zod (min(1)).
 *   5. summarize_by_hat is a pure function — no workspace read; returns
 *      correct counts, latestThought (most recent by ISO), and allThoughts.
 *   6. export_session renders chronological markdown with per-hat
 *      headings; empty workspace returns a friendly placeholder.
 *
 * The registry is a process-wide singleton; we import the side-effect
 * registration module once and don't unregister so the test mirrors
 * how production loads the module exactly once at boot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SixHatsThought } from "@/lib/stores/workspace-types";

// Side-effect import — registers the actions on the singleton.
import "@/lib/actions/tools/six-hats";

const EXPECTED_ACTIONS = [
  "tool.six_hats.list_state",
  "tool.six_hats.log_thought",
  "tool.six_hats.summarize_by_hat",
  "tool.six_hats.export_session",
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

/** Build a fully-formed SixHatsThought for seeding the store. All four
 *  fields are required on the entity, so partial gets only id + hat at
 *  minimum and we default the rest. */
function seed(
  partial: Partial<SixHatsThought> & Pick<SixHatsThought, "id" | "hat">
): SixHatsThought {
  return {
    text: "placeholder",
    loggedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("tool.six_hats — registration", () => {
  it("registers all 4 expected actions", () => {
    for (const id of EXPECTED_ACTIONS) {
      const a = registry.get(id);
      expect(a, `missing action: ${id}`).toBeDefined();
    }
  });

  it("list_state / summarize_by_hat / export_session are category=read; log_thought is category=write", () => {
    expect(registry.get("tool.six_hats.list_state")?.category).toBe("read");
    expect(registry.get("tool.six_hats.summarize_by_hat")?.category).toBe("read");
    expect(registry.get("tool.six_hats.export_session")?.category).toBe("read");
    expect(registry.get("tool.six_hats.log_thought")?.category).toBe("write");
  });

  it("workspace-reading actions all have an mcpHandler (server-side path)", () => {
    expect(registry.get("tool.six_hats.list_state")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.six_hats.log_thought")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.six_hats.export_session")?.mcpHandler).toBeTypeOf("function");
  });

  it("summarize_by_hat is pure — no mcpHandler (same handler in browser/agent/MCP)", () => {
    // Pure helpers don't need a server-side variant; documented design
    // intent for the action set. If a future change adds an mcpHandler
    // here, that's a meaningful divergence worth surfacing.
    expect(registry.get("tool.six_hats.summarize_by_hat")?.mcpHandler).toBeUndefined();
  });

  it("log_thought is requiresConfirmation=false (low-friction logging)", () => {
    // A "log a thought" verb that prompted for confirmation per call
    // would make agent-driven sessions unbearable. Lock the default.
    expect(registry.get("tool.six_hats.log_thought")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.six_hats.list_state — grouping + roundtrip", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sixHatsThoughts: [] });
  });

  it("returns initialised per-hat buckets and total=0 when the workspace is empty", async () => {
    const action = registry.get("tool.six_hats.list_state");
    const result = (await action!.handler({}, ctx())) as {
      white: SixHatsThought[];
      red: SixHatsThought[];
      black: SixHatsThought[];
      yellow: SixHatsThought[];
      green: SixHatsThought[];
      blue: SixHatsThought[];
      total: number;
    };
    expect(result.total).toBe(0);
    // Every bucket initialised — agent can read result.white without
    // an existence check even on an empty workspace.
    expect(result.white).toEqual([]);
    expect(result.red).toEqual([]);
    expect(result.black).toEqual([]);
    expect(result.yellow).toEqual([]);
    expect(result.green).toEqual([]);
    expect(result.blue).toEqual([]);
  });

  it("groups thoughts by hat correctly across mixed-hat seeds", async () => {
    const seeds: SixHatsThought[] = [
      seed({ id: "t1", hat: "white", text: "Q3 revenue is flat" }),
      seed({ id: "t2", hat: "white", text: "Headcount unchanged" }),
      seed({ id: "t3", hat: "red", text: "This feels stuck" }),
      seed({ id: "t4", hat: "black", text: "Customers may churn" }),
      seed({ id: "t5", hat: "yellow", text: "New segment is open" }),
      seed({ id: "t6", hat: "green", text: "What if we package the API?" }),
      seed({ id: "t7", hat: "blue", text: "Next: validate with 3 buyers" }),
    ];
    for (const s of seeds) useWorkspaceStore.getState().upsertSixHatsThought(s);

    const action = registry.get("tool.six_hats.list_state");
    const result = (await action!.handler({}, ctx())) as {
      white: SixHatsThought[];
      red: SixHatsThought[];
      black: SixHatsThought[];
      yellow: SixHatsThought[];
      green: SixHatsThought[];
      blue: SixHatsThought[];
      total: number;
    };
    expect(result.total).toBe(7);
    expect(result.white).toHaveLength(2);
    expect(result.red).toHaveLength(1);
    expect(result.black).toHaveLength(1);
    expect(result.yellow).toHaveLength(1);
    expect(result.green).toHaveLength(1);
    expect(result.blue).toHaveLength(1);
  });
});

describe("tool.six_hats.log_thought — convenience create", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sixHatsThoughts: [] });
  });

  it("creates a thought and returns {id}; stamps loggedAt", async () => {
    const action = registry.get("tool.six_hats.log_thought");
    const result = (await action!.handler(
      { hat: "white", text: "We shipped v2 last week" },
      ctx()
    )) as { id: string };
    expect(result.id).toBeTypeOf("string");
    expect(result.id.length).toBeGreaterThan(0);

    const stored = useWorkspaceStore.getState().sixHatsThoughts ?? [];
    expect(stored).toHaveLength(1);
    const created = stored[0];
    expect(created.id).toBe(result.id);
    expect(created.hat).toBe("white");
    expect(created.text).toBe("We shipped v2 last week");
    // loggedAt is an ISO string — parseable to a recent Date.
    expect(created.loggedAt).toBeTypeOf("string");
    expect(new Date(created.loggedAt).getTime()).toBeGreaterThan(0);
  });

  it("trims whitespace from the input text", async () => {
    const action = registry.get("tool.six_hats.log_thought");
    await action!.handler({ hat: "green", text: "  brainstorm idea  " }, ctx());
    const stored = useWorkspaceStore.getState().sixHatsThoughts ?? [];
    expect(stored[0]?.text).toBe("brainstorm idea");
  });

  it("Zod rejects empty text at the boundary (min(1))", async () => {
    const action = registry.get("tool.six_hats.log_thought");
    // paramsSchema.parse should throw on empty text before the handler
    // runs — pattern matches the calc-tool defense-in-depth checks.
    expect(() => action!.paramsSchema.parse({ hat: "white", text: "" })).toThrow();
  });

  it("Zod rejects an unknown hat at the boundary", async () => {
    const action = registry.get("tool.six_hats.log_thought");
    expect(() => action!.paramsSchema.parse({ hat: "purple", text: "not a real hat" })).toThrow();
  });
});

describe("tool.six_hats.summarize_by_hat — pure helper", () => {
  // No beforeEach store reset — this action is pure and never reads
  // the workspace. Whatever's in the store is irrelevant.

  it("returns zero-count buckets for every hat when items=[] (empty input)", async () => {
    const action = registry.get("tool.six_hats.summarize_by_hat");
    const result = (await action!.handler({ items: [] }, ctx())) as {
      byHat: Record<
        SixHatsThought["hat"],
        { count: number; latestThought?: string; allThoughts: string[] }
      >;
    };
    for (const hat of ["white", "red", "black", "yellow", "green", "blue"] as const) {
      expect(result.byHat[hat].count).toBe(0);
      expect(result.byHat[hat].latestThought).toBeUndefined();
      expect(result.byHat[hat].allThoughts).toEqual([]);
    }
  });

  it("aggregates counts, allThoughts, and picks latestThought by loggedAt", async () => {
    // Two white thoughts at different times; the later one should be
    // the latestThought regardless of array order.
    const items: SixHatsThought[] = [
      {
        id: "t1",
        hat: "white",
        text: "earliest fact",
        loggedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "t2",
        hat: "white",
        text: "latest fact",
        loggedAt: "2026-05-01T12:00:00.000Z",
      },
      {
        id: "t3",
        hat: "white",
        text: "middle fact",
        loggedAt: "2026-05-01T11:00:00.000Z",
      },
      {
        id: "t4",
        hat: "red",
        text: "one feeling",
        loggedAt: "2026-05-01T10:30:00.000Z",
      },
    ];
    const action = registry.get("tool.six_hats.summarize_by_hat");
    const result = (await action!.handler({ items }, ctx())) as {
      byHat: Record<
        SixHatsThought["hat"],
        { count: number; latestThought?: string; allThoughts: string[] }
      >;
    };
    expect(result.byHat.white.count).toBe(3);
    expect(result.byHat.white.latestThought).toBe("latest fact");
    expect(result.byHat.white.allThoughts).toEqual(["earliest fact", "latest fact", "middle fact"]);
    expect(result.byHat.red.count).toBe(1);
    expect(result.byHat.red.latestThought).toBe("one feeling");
    // Untouched hats stay zeroed.
    expect(result.byHat.green.count).toBe(0);
    expect(result.byHat.green.latestThought).toBeUndefined();
  });

  it("does not read the workspace — provided items are the only input", async () => {
    // Seed the store with a thought that should NOT appear in the
    // result; the helper is pure.
    useWorkspaceStore.setState({
      sixHatsThoughts: [seed({ id: "ws1", hat: "blue", text: "lives in the store" })],
    });
    const action = registry.get("tool.six_hats.summarize_by_hat");
    const result = (await action!.handler({ items: [] }, ctx())) as {
      byHat: Record<
        SixHatsThought["hat"],
        { count: number; latestThought?: string; allThoughts: string[] }
      >;
    };
    expect(result.byHat.blue.count).toBe(0);
    expect(result.byHat.blue.allThoughts).toEqual([]);
  });
});

describe("tool.six_hats.export_session — markdown writeup", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sixHatsThoughts: [] });
  });

  it("returns a placeholder when the workspace has no thoughts", async () => {
    const action = registry.get("tool.six_hats.export_session");
    const result = (await action!.handler({}, ctx())) as { markdown: string };
    expect(result.markdown).toContain("Six Thinking Hats");
    expect(result.markdown).toContain("No thoughts logged yet");
  });

  it("renders a heading per non-empty hat in canonical order", async () => {
    // Seed white + green only; the writeup should include those two
    // section headings and NOT the others (we skip empty hats).
    useWorkspaceStore.getState().upsertSixHatsThought(
      seed({
        id: "t1",
        hat: "white",
        text: "Conversion is 2.1%",
        loggedAt: "2026-05-01T10:00:00.000Z",
      })
    );
    useWorkspaceStore.getState().upsertSixHatsThought(
      seed({
        id: "t2",
        hat: "green",
        text: "Test a new CTA color",
        loggedAt: "2026-05-01T11:00:00.000Z",
      })
    );

    const action = registry.get("tool.six_hats.export_session");
    const result = (await action!.handler({}, ctx())) as { markdown: string };

    expect(result.markdown).toContain("## White (Facts)");
    expect(result.markdown).toContain("## Green (Creativity)");
    // Empty buckets are skipped.
    expect(result.markdown).not.toContain("## Red");
    expect(result.markdown).not.toContain("## Blue");
    // Items rendered as list bullets.
    expect(result.markdown).toContain("- Conversion is 2.1%");
    expect(result.markdown).toContain("- Test a new CTA color");
    // Canonical De Bono order: white appears before green in output.
    const whiteIdx = result.markdown.indexOf("White");
    const greenIdx = result.markdown.indexOf("Green");
    expect(whiteIdx).toBeGreaterThan(-1);
    expect(greenIdx).toBeGreaterThan(whiteIdx);
  });

  it("orders thoughts within a hat chronologically (oldest first)", async () => {
    // Seed out of order to prove the sort actually runs.
    useWorkspaceStore.getState().upsertSixHatsThought(
      seed({
        id: "t1",
        hat: "blue",
        text: "second",
        loggedAt: "2026-05-01T11:00:00.000Z",
      })
    );
    useWorkspaceStore.getState().upsertSixHatsThought(
      seed({
        id: "t2",
        hat: "blue",
        text: "first",
        loggedAt: "2026-05-01T10:00:00.000Z",
      })
    );
    useWorkspaceStore.getState().upsertSixHatsThought(
      seed({
        id: "t3",
        hat: "blue",
        text: "third",
        loggedAt: "2026-05-01T12:00:00.000Z",
      })
    );

    const action = registry.get("tool.six_hats.export_session");
    const result = (await action!.handler({}, ctx())) as { markdown: string };

    const firstIdx = result.markdown.indexOf("first");
    const secondIdx = result.markdown.indexOf("second");
    const thirdIdx = result.markdown.indexOf("third");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });
});
