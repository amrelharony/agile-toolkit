/**
 * tool.skills_matrix.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; every write verb has an mcpHandler;
 *      reset asks for confirmation.
 *   2. no seed: an absent matrix is empty; add_member adds to the roster;
 *      add_skill needs a unique name.
 *   3. set_rating sets and clears; Not rated never counts; a single point
 *      of failure is one person at Intermediate+.
 *   4. remove_member only removes matrix-only people.
 *   5. targets and the training plan.
 *   6. reset clears the matrix and keeps the roster.
 *   7. the server handlers read the same rows and say the same.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsMatrix, TeamMember } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { SKILLS_MATRIX_ID, SKILLS_MATRIX_KIND } from "@/lib/skills/coverage";

import "@/lib/actions/tools/skills-matrix";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
// As the MCP and agent runtimes do: the params go through the schema first.
const run = <T>(
  verb: string,
  params: Record<string, unknown> = {},
  path: "handler" | "mcpHandler" = "handler"
) => {
  const action = registry.get(`tool.skills_matrix.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

type State = {
  exists: boolean;
  columns: { id: string; name: string; onRoster: boolean }[];
  members: { id: string; name: string }[];
  skills: { id: string; name: string; targetPeople: number | null; targetLevel: number }[];
  grid: Record<string, Record<string, number | null>>;
  coverage: {
    skillId: string;
    capable: number;
    gap: boolean;
    spof: boolean;
    meetsTarget: boolean | null;
  }[];
  analysis: {
    skillId: string;
    proficient: number;
    advanced: number;
    isSPOF: boolean;
    isGap: boolean;
  }[];
  gapCount: number;
  spofCount: number;
  belowTargetCount: number;
  busFactorCount: number;
  overallCoverage: number;
  verdict: string;
  suggestions: { skillId: string; learnerId: string; mentorId?: string; reason: string }[];
  training: { id: string; doneAt: string | null; reached: boolean }[];
};

const list = (path: "handler" | "mcpHandler" = "handler") => run<State>("list_state", {}, path);
const ROSTER: TeamMember[] = [
  { id: "member_ana", name: "Ana" },
  { id: "member_bo", name: "Bo" },
];
const stored = () =>
  useWorkspaceStore.getState().skillsMatrices?.find((d) => d.id === SKILLS_MATRIX_ID);

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({ skillsMatrices: [], teamMembers: ROSTER });
});

describe("tool.skills_matrix — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.skills_matrix.list_state")?.category).toBe("read");
    for (const verb of [
      "add_member",
      "remove_member",
      "add_skill",
      "remove_skill",
      "set_rating",
      "set_target",
      "add_training",
      "complete_training",
      "remove_training",
      "reset",
    ]) {
      const action = registry.get(`tool.skills_matrix.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(verb === "reset");
    }
  });
});

describe("tool.skills_matrix lifecycle", () => {
  it("starts empty (no demo seed), with the roster as columns", async () => {
    const r = await list();
    expect(r).toMatchObject({
      exists: false,
      skills: [],
      members: [],
      spofCount: 0,
      overallCoverage: 0,
    });
    expect(r.columns).toEqual([
      { id: "member_ana", name: "Ana", onRoster: true },
      { id: "member_bo", name: "Bo", onRoster: true },
    ]);
    expect(r.verdict).toMatch(/^No skills yet/);
  });

  it("adds people to the roster, never twice, and refuses a blank name", async () => {
    expect(await run("add_member", { name: " " })).toEqual({
      added: false,
      reason: "name_required",
    });
    expect(await run("add_member", { name: "ana" })).toMatchObject({
      added: true,
      id: "member_ana",
      existing: true,
    });
    const dee = await run<{ id: string; existing: boolean }>("add_member", { name: "Dee" });
    expect(dee.existing).toBe(false);
    expect(useWorkspaceStore.getState().teamMembers?.map((m) => m.name)).toEqual([
      "Ana",
      "Bo",
      "Dee",
    ]);
    expect((await list()).columns.map((c) => c.id)).toContain(dee.id);
  });

  it("adds a skill with a unique name and a target within the team", async () => {
    expect(await run("add_skill", {})).toMatchObject({ added: false, reason: "name_required" });
    const go = await run<{ added: boolean; id: string }>("add_skill", {
      name: "Go",
      targetPeople: 2,
    });
    expect(go.added).toBe(true);
    expect(await run("add_skill", { name: " go " })).toMatchObject({
      added: false,
      reason: "duplicate",
      id: go.id,
    });
    expect(await run("add_skill", { name: "SQL", targetPeople: 3 })).toMatchObject({
      added: false,
      reason: "invalid_target",
      message: "The team has 2 people.",
    });
    expect(stored()?.version).toBe(2);
    expect((await list()).skills).toEqual([
      { id: go.id, name: "Go", description: null, targetPeople: 2, targetLevel: 2 },
    ]);
  });

  it("sets and clears ratings; one person at Intermediate is a single point of failure", async () => {
    const { id } = await run<{ id: string }>("add_skill", { name: "Kubernetes" });
    expect(await run("set_rating", { skillId: id, memberId: "member_ana", level: 2 })).toEqual({
      set: true,
      level: 2,
      label: "Intermediate",
    });
    let r = await list();
    expect(r.grid[id]).toEqual({ member_ana: 2, member_bo: null });
    expect(r.coverage[0]).toMatchObject({ capable: 1, spof: true, gap: false });
    expect(r.analysis[0]).toMatchObject({ proficient: 1, advanced: 0, isSPOF: true, isGap: false });
    expect(r).toMatchObject({ spofCount: 1, busFactorCount: 1, gapCount: 0 });
    expect(r.verdict).toBe(
      "1 skill depends on one person (Kubernetes: Ana); 1 rating still missing."
    );

    await run("set_rating", { skillId: id, memberId: "member_bo", level: 0 });
    await run("set_rating", { skillId: id, memberId: "member_ana", level: null });
    r = await list();
    expect(r.grid[id]).toEqual({ member_ana: null, member_bo: 0 });
    expect(r.coverage[0]).toMatchObject({ capable: 0, gap: true });

    expect(await run("set_rating", { skillId: "ghost", memberId: "member_ana", level: 2 })).toEqual(
      { set: false }
    );
    expect(await run("set_rating", { skillId: id, memberId: "ghost", level: 2 })).toEqual({
      set: false,
    });
  });

  it("removes only matrix-only people, with their ratings", async () => {
    useWorkspaceStore.setState({
      skillsMatrices: [
        {
          id: SKILLS_MATRIX_ID,
          members: [{ id: "m9", name: "Zed" }],
          skills: [{ id: "s1", name: "Go" }],
          grid: { s1: { m9: 3 } },
          version: 2,
        },
      ],
    });
    expect(await run("remove_member", { id: "member_ana" })).toEqual({
      removed: false,
      reason: "on_roster",
    });
    expect(await run("remove_member", { id: "nope" })).toEqual({
      removed: false,
      reason: "not_found",
    });
    expect(await run("remove_member", { id: "m9" })).toEqual({ removed: true });
    const r = await list();
    expect(r.members).toEqual([]);
    expect(r.grid.s1).toEqual({ member_ana: null, member_bo: null });
    expect(useWorkspaceStore.getState().teamMembers).toEqual(ROSTER);
  });

  it("sets a target and plans, completes and removes a training pair", async () => {
    const { id } = await run<{ id: string }>("add_skill", { name: "Kubernetes" });
    await run("set_rating", { skillId: id, memberId: "member_ana", level: 3 });
    await run("set_rating", { skillId: id, memberId: "member_bo", level: 1 });
    expect(await run("set_target", { skillId: id, people: 2, level: 3 })).toMatchObject({
      set: true,
      target: 2,
      targetLevel: 3,
      atTarget: 1,
      meetsTarget: false,
    });
    expect(await run("set_target", { skillId: id, people: 5 })).toMatchObject({
      set: false,
      reason: "invalid_target",
    });

    let r = await list();
    expect(r.suggestions).toEqual([
      {
        skillId: id,
        skill: "Kubernetes",
        learnerId: "member_bo",
        learner: "Bo",
        mentorId: "member_ana",
        mentor: "Ana",
        toLevel: 3,
        from: 1,
        reason: "spof",
      },
    ]);
    const pair = await run<{ added: boolean; id: string; toLevel: number }>("add_training", {
      skillId: id,
      learnerId: "member_bo",
      mentorId: "member_ana",
    });
    expect(pair).toMatchObject({ added: true, toLevel: 3 });
    expect(await run("add_training", { skillId: id, learnerId: "member_bo" })).toMatchObject({
      added: false,
    });
    expect(
      await run("add_training", { skillId: id, learnerId: "member_ana", mentorId: "member_ana" })
    ).toEqual({
      added: false,
      message: "The mentor can't be the learner.",
    });
    r = await list();
    expect(r.suggestions).toEqual([]);

    expect(await run("complete_training", { id: pair.id, on: "2999-01-01" })).toEqual({
      done: false,
      reason: "invalid_day",
      message: "It can't be done in the future.",
    });
    // An impossible day is refused by the same rule as the page's "Done on" field.
    expect(await run("complete_training", { id: pair.id, on: "2026-02-30" })).toMatchObject({
      done: false,
      message: "Pick a real day.",
    });
    expect(await run("complete_training", { id: pair.id, on: "2026-10-01" })).toEqual({
      done: true,
      doneAt: "2026-10-01",
      reached: false,
    });
    expect(await run("complete_training", { id: pair.id, reopen: true })).toEqual({
      done: false,
      reopened: true,
    });
    expect(await run("remove_training", { id: pair.id })).toEqual({ removed: true });
    expect(await run("remove_training", { id: pair.id })).toEqual({ removed: false });
  });

  it("reset clears the matrix and leaves the roster alone", async () => {
    await run("add_skill", { name: "Go" });
    expect(await run("reset")).toEqual({ reset: true });
    expect(stored()).toEqual({
      id: SKILLS_MATRIX_ID,
      members: [],
      skills: [],
      grid: {},
      version: 2,
    });
    expect(useWorkspaceStore.getState().teamMembers).toEqual(ROSTER);
  });

  it("upgrades a legacy matrix on write: its 0s were Not rated, its people matched by name", async () => {
    useWorkspaceStore.setState({
      skillsMatrices: [
        {
          id: SKILLS_MATRIX_ID,
          members: [
            { id: "m1", name: "Ana" },
            { id: "m2", name: "Carol" },
          ],
          skills: [{ id: "s1", name: "TypeScript" }],
          grid: { s1: { m1: 3, m2: 0 } },
        },
      ],
    });
    let r = await list();
    expect(r.columns.map((c) => [c.id, c.onRoster])).toEqual([
      ["member_ana", true],
      ["member_bo", true],
      ["m2", false],
    ]);
    expect(r.grid.s1).toEqual({ member_ana: 3, member_bo: null, m2: null });
    await run("set_rating", { skillId: "s1", memberId: "member_bo", level: 2 });
    expect(stored()).toMatchObject({
      version: 2,
      members: [{ id: "m2", name: "Carol" }],
      grid: { s1: { member_ana: 3, member_bo: 2 } },
    });
    r = await list();
    expect(r.coverage[0]).toMatchObject({ capable: 2, spof: false });
  });
});

describe("tool.skills_matrix — the server handlers", () => {
  it("read the roster and the matrix from the user's rows and say what the browser says", async () => {
    const matrix: SkillsMatrix = {
      id: SKILLS_MATRIX_ID,
      version: 2,
      members: [],
      skills: [{ id: "k8s", name: "Kubernetes" }],
      grid: { k8s: { member_ana: 3 } },
    };
    for (const m of ROSTER) rows.set(`workspace:teamMember/${m.id}`, m);
    rows.set(`${SKILLS_MATRIX_KIND}/${SKILLS_MATRIX_ID}`, matrix);
    useWorkspaceStore.setState({ skillsMatrices: [matrix] });
    const server = await list("mcpHandler");
    const browser = await list();
    expect(server).toEqual(browser);
    expect(server.spofCount).toBe(1);

    expect(await run("add_member", { name: "Dee" }, "mcpHandler")).toMatchObject({
      added: true,
      existing: false,
    });
    expect(
      Array.from(rows.keys()).filter((k) => k.startsWith("workspace:teamMember/"))
    ).toHaveLength(3);
    await run("set_rating", { skillId: "k8s", memberId: "member_bo", level: 2 }, "mcpHandler");
    expect(
      (rows.get(`${SKILLS_MATRIX_KIND}/${SKILLS_MATRIX_ID}`) as SkillsMatrix).grid.k8s
    ).toEqual({
      member_ana: 3,
      member_bo: 2,
    });
    await run("reset", {}, "mcpHandler");
    expect(rows.get(`${SKILLS_MATRIX_KIND}/${SKILLS_MATRIX_ID}`)).toEqual({
      id: SKILLS_MATRIX_ID,
      members: [],
      skills: [],
      grid: {},
      version: 2,
    });
  });
});
