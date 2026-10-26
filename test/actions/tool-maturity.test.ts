/**
 * tool.maturity.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; every write has an mcpHandler; reset
 *      asks for confirmation.
 *   2. unassessed: no doc and a draft alone give no level, no %, no roadmap.
 *   3. set_score edits the draft only (null clears); unknown dimensions refused.
 *   4. save_assessment refuses incomplete scores and future days, saves a
 *      dated entry, clears the draft and sets the workspace maturity level.
 *   5. remove_assessment and reset keep the level in step (unassessed: none).
 *   6. send_roadmap_step adds a linked retro action once.
 *   7. the server handlers patch the scalar blob, with null to clear.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaturityAssessment, RetroBoard } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blob = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[] }));
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverPatchWorkspaceBlob: vi.fn(async (_u: string, patch: Record<string, unknown>) => {
      blob.patches.push(patch);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import { MATURITY_ID, MATURITY_KIND } from "@/lib/maturity/assessment";
import { RETRO_CURRENT_ID, blankRetroBoard } from "@/lib/retro/board";
import { retroFormats } from "@/lib/constants/retro-formats";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/flow/days";

import "@/lib/actions/tools/maturity";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
// As the MCP and agent runtimes do: the params go through the schema first.
const run = <T>(
  verb: string,
  params: Record<string, unknown> = {},
  path: "handler" | "mcpHandler" = "handler"
) => {
  const action = registry.get(`tool.maturity.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const all = (level: number) => Object.fromEntries(MATURITY_DIMENSIONS.map((d) => [d.id, level]));

type State = {
  exists: boolean;
  assessed: boolean;
  draft: {
    scores: Record<string, number>;
    scored: number;
    missing: { id: string }[];
    legacy: boolean;
  };
  latest: null | {
    id: string;
    assessedAt: string;
    percentage: number;
    level: number;
    label: string;
  };
  assessments: { id: string; assessedAt: string; percentage: number }[];
  deltas: { dimensionId: string; from: number; to: number }[];
  scores: Record<string, number>;
  targetLevel: number;
  averageLevel: number | null;
  percentage: number | null;
  level: number | null;
  label: string | null;
  roadmap: {
    key: string;
    dimensionId: string;
    current: number;
    toLevel: number;
    sent: boolean;
    nextLevel: { level: number };
  }[];
  verdict: string;
};
const list = (path: "handler" | "mcpHandler" = "handler") => run<State>("list_state", {}, path);
const TODAY = todayLocalISO();

beforeEach(() => {
  rows.clear();
  blob.patches.length = 0;
  useWorkspaceStore.setState({
    maturityAssessments: [],
    maturityLevel: undefined,
    retroBoards: [],
  });
});

describe("tool.maturity — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.maturity.list_state")?.category).toBe("read");
    for (const verb of [
      "set_score",
      "set_target_level",
      "save_assessment",
      "remove_assessment",
      "send_roadmap_step",
      "reset",
    ]) {
      const action = registry.get(`tool.maturity.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(verb === "reset");
    }
  });
});

describe("tool.maturity lifecycle", () => {
  it("reports an unassessed team with no level, percentage or roadmap", async () => {
    const r = await list();
    expect(r).toMatchObject({
      exists: false,
      assessed: false,
      latest: null,
      averageLevel: null,
      percentage: null,
      level: null,
      roadmap: [],
      targetLevel: 4,
    });
    expect(r.draft.missing).toHaveLength(8);
    expect(r.verdict).toMatch(/^Not assessed yet\./);
  });

  it("scores the draft only, clears with null, and refuses an unknown dimension", async () => {
    expect(await run("set_score", { dimensionId: "scrum-practices", level: 5 })).toEqual({
      set: true,
      scored: 1,
    });
    expect(await run("set_score", { dimensionId: "ghost-dimension", level: 3 })).toEqual({
      set: false,
    });
    let r = await list();
    expect(r).toMatchObject({ exists: true, assessed: false, level: null, percentage: null });
    expect(r.draft.scores).toEqual({ "scrum-practices": 5 });
    expect(r.verdict).toBe("Not assessed yet: 1 of 8 dimensions scored in the draft.");
    await run("set_score", { dimensionId: "scrum-practices", level: null });
    r = await list();
    expect(r.draft.scored).toBe(0);
    expect(useWorkspaceStore.getState().maturityLevel).toBeUndefined();
  });

  it("saves only a complete, dated assessment and sets the level from it", async () => {
    await run("set_score", { dimensionId: "scrum-practices", level: 5 });
    expect(await run("save_assessment", {})).toMatchObject({ saved: false, reason: "incomplete" });
    expect(await run("save_assessment", { scores: { nope: 3 } })).toMatchObject({
      saved: false,
      reason: "unknown_dimension",
      unknown: ["nope"],
    });
    expect(
      await run("save_assessment", { scores: all(1), date: addDays(TODAY, 1) as string })
    ).toMatchObject({ saved: false, reason: "invalid_date" });

    // one dimension at 5 (from the draft), the other seven at 1: 1.5 => 13%, level 2.
    const rest = Object.fromEntries(MATURITY_DIMENSIONS.slice(1).map((d) => [d.id, 1]));
    const saved = await run<{
      saved: boolean;
      id: string;
      percentage: number;
      level: number;
      maturityLevel: number;
    }>("save_assessment", { scores: rest, date: "2026-05-12", note: "Baseline" });
    expect(saved).toMatchObject({
      saved: true,
      assessedAt: "2026-05-12",
      percentage: 13,
      level: 2,
      label: "Developing",
      maturityLevel: 2,
    });
    expect(useWorkspaceStore.getState().maturityLevel).toBe(2);

    const r = await list();
    expect(r).toMatchObject({
      assessed: true,
      averageLevel: 1.5,
      percentage: 13,
      level: 2,
      label: "Developing",
    });
    expect(r.draft.scored).toBe(0);
    expect(r.assessments).toHaveLength(1);
    // Seven dimensions below the target of 4, each one step up, weakest first.
    expect(r.roadmap).toHaveLength(7);
    expect(r.roadmap[0]).toMatchObject({
      key: "team-collaboration:2",
      current: 1,
      toLevel: 2,
      sent: false,
      nextLevel: { level: 2 },
    });
  });

  it("follows the latest day, shows what changed, and the target re-derives the roadmap", async () => {
    await run("save_assessment", { scores: all(3), date: "2026-09-01" });
    await run("save_assessment", { scores: { ...all(3), "agile-culture": 4 }, date: "2026-10-01" });
    // Backdated later: it isn't the latest.
    await run("save_assessment", { scores: all(1), date: "2026-01-01" });
    const r = await list();
    expect(r.latest?.assessedAt).toBe("2026-10-01");
    expect(r.assessments.map((a) => a.assessedAt)).toEqual([
      "2026-01-01",
      "2026-09-01",
      "2026-10-01",
    ]);
    expect(r.deltas).toEqual([
      { dimensionId: "agile-culture", name: "Agile Culture", from: 3, to: 4 },
    ]);
    expect(useWorkspaceStore.getState().maturityLevel).toBe(3);
    await run("set_target_level", { level: 2 });
    expect((await list()).roadmap).toEqual([]);
  });

  it("remove_assessment and reset keep the level in step, down to unassessed", async () => {
    const a = await run<{ id: string }>("save_assessment", { scores: all(4), date: "2026-09-01" });
    const b = await run<{ id: string }>("save_assessment", { scores: all(2), date: "2026-10-01" });
    expect(useWorkspaceStore.getState().maturityLevel).toBe(2);
    expect(await run("remove_assessment", { id: b.id })).toEqual({
      removed: true,
      maturityLevel: 4,
    });
    expect(useWorkspaceStore.getState().maturityLevel).toBe(4);
    expect(await run("remove_assessment", { id: "nope" })).toEqual({ removed: false });
    expect(await run("remove_assessment", { id: a.id })).toEqual({
      removed: true,
      maturityLevel: null,
    });
    expect(useWorkspaceStore.getState().maturityLevel).toBeUndefined();

    await run("save_assessment", { scores: all(3) });
    expect(await run("reset")).toEqual({ reset: true });
    const r = await list();
    expect(r).toMatchObject({ assessed: false, targetLevel: 4, assessments: [] });
    expect(useWorkspaceStore.getState().maturityLevel).toBeUndefined();
  });

  it("reads a legacy draft (scores, no history) as unassessed", async () => {
    useWorkspaceStore.setState({
      maturityAssessments: [{ id: MATURITY_ID, scores: all(1), targetLevel: 4 }],
      maturityLevel: 1,
    });
    const r = await list();
    expect(r).toMatchObject({ assessed: false, level: null, percentage: null });
    expect(r.draft).toMatchObject({ scored: 8, legacy: true });
  });

  it("sends a roadmap step to the current retro once, linked back", async () => {
    useWorkspaceStore.setState({ retroBoards: [blankRetroBoard(retroFormats[0])] });
    await run("save_assessment", { scores: { ...all(3), "technical-excellence": 1 } });
    expect(await run("send_roadmap_step", { key: "ghost:2" })).toEqual({
      sent: false,
      reason: "not_on_roadmap",
    });
    const sent = await run<{ sent: boolean; cardId: string; boardId: string }>(
      "send_roadmap_step",
      {
        key: "technical-excellence:2",
        owner: "Priya",
      }
    );
    expect(sent).toMatchObject({ sent: true, boardId: RETRO_CURRENT_ID });
    const card = useWorkspaceStore
      .getState()
      .retroBoards?.[0].cards.find((c) => c.id === sent.cardId);
    expect(card).toMatchObject({
      text: "Maturity: Technical Excellence to level 2",
      isActionItem: true,
      assignee: "Priya",
      sourceRef: { tool: "maturity", id: "technical-excellence:2", doc: MATURITY_ID },
    });
    expect(await run("send_roadmap_step", { key: "technical-excellence:2" })).toEqual({
      sent: false,
      reason: "already_sent",
      cardId: sent.cardId,
    });
    expect((await list()).roadmap.find((s) => s.key === "technical-excellence:2")?.sent).toBe(true);
  });
});

describe("tool.maturity — the server handlers", () => {
  it("read and write the user's rows, and patch the level into the scalar blob (null to clear)", async () => {
    const saved = await run<{ id: string }>(
      "save_assessment",
      { scores: all(4), date: "2026-10-01" },
      "mcpHandler"
    );
    expect(blob.patches.at(-1)).toEqual({ maturityLevel: 4 });
    const doc = rows.get(`${MATURITY_KIND}/${MATURITY_ID}`) as MaturityAssessment;
    expect(doc.history).toHaveLength(1);
    useWorkspaceStore.setState({ maturityAssessments: [doc] });
    expect(await list("mcpHandler")).toEqual(await list());

    await run("set_score", { dimensionId: "agile-culture", level: 2 }, "mcpHandler");
    expect(blob.patches).toHaveLength(1);
    await run("remove_assessment", { id: saved.id }, "mcpHandler");
    expect(blob.patches.at(-1)).toEqual({ maturityLevel: null });
    await run("reset", {}, "mcpHandler");
    expect(blob.patches.at(-1)).toEqual({ maturityLevel: null });
    expect(rows.get(`${MATURITY_KIND}/${MATURITY_ID}`)).toEqual({
      id: MATURITY_ID,
      scores: {},
      targetLevel: 4,
      history: [],
    });
  });

  it("send_roadmap_step writes the retro board row", async () => {
    const board: RetroBoard = blankRetroBoard(retroFormats[0]);
    rows.set(`workspace:retroBoard/${board.id}`, board);
    await run("save_assessment", { scores: { ...all(3), "agile-culture": 2 } }, "mcpHandler");
    const sent = await run<{ sent: boolean; cardId: string }>(
      "send_roadmap_step",
      { key: "agile-culture:3" },
      "mcpHandler"
    );
    expect(sent.sent).toBe(true);
    const stored = rows.get(`workspace:retroBoard/${board.id}`) as RetroBoard;
    expect(stored.cards.map((c) => c.sourceRef?.id)).toEqual(["agile-culture:3"]);
  });
});
