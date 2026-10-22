/**
 * tool.skills_matrix.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; add/remove/set_rating/reset write.
 *   2. demo seed + add_member / add_skill extend the grid.
 *   3. set_rating updates the grid, flags bus factor, refuses unknown ids.
 *   4. remove_member drops the member and its grid column.
 *   5. reset restores the 3-member / 4-skill demo seed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/skills-matrix";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type State = {
  exists: boolean;
  members: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  grid: Record<string, Record<string, number>>;
  analysis: { skillId: string; proficient: number; advanced: number; isBusFactor: boolean }[];
  busFactorCount: number;
  spofCount: number;
  overallCoverage: number;
};

const list = async () =>
  (await registry.get("tool.skills_matrix.list_state")!.handler({}, ctx())) as State;

describe("tool.skills_matrix — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.skills_matrix.list_state")?.category).toBe("read");
    for (const verb of [
      "add_member",
      "remove_member",
      "add_skill",
      "remove_skill",
      "set_rating",
      "reset",
    ]) {
      expect(registry.get(`tool.skills_matrix.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.skills_matrix.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.skills_matrix.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.skills_matrix lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ skillsMatrices: [] }));

  it("exposes the demo seed and extends it on add", async () => {
    const seed = await list();
    expect(seed.exists).toBe(false); // not yet persisted, but seed visible
    expect(seed.members).toHaveLength(3);
    expect(seed.skills).toHaveLength(4);
    expect(seed.overallCoverage).toBe(0);

    const added = (await registry
      .get("tool.skills_matrix.add_member")!
      .handler({ name: "Dave" }, ctx())) as { added: boolean; id: string };
    expect(added.added).toBe(true);

    const r = await list();
    expect(r.members).toHaveLength(4);
    expect(r.members.some((m) => m.name === "Dave")).toBe(true);
    // new member gets a 0 cell in every skill row.
    expect(r.grid["s1"][added.id]).toBe(0);

    await registry.get("tool.skills_matrix.add_skill")!.handler({ name: "Go" }, ctx());
    const r2 = await list();
    expect(r2.skills).toHaveLength(5);
  });

  it("set_rating updates the grid, flags bus factor, refuses unknown ids", async () => {
    const ok = (await registry
      .get("tool.skills_matrix.set_rating")!
      .handler({ skillId: "s1", memberId: "m1", level: 3 }, ctx())) as { set: boolean };
    expect(ok.set).toBe(true);

    const r = await list();
    expect(r.grid["s1"]["m1"]).toBe(3);
    const s1 = r.analysis.find((a) => a.skillId === "s1")!;
    expect(s1.advanced).toBe(1);
    expect(s1.isBusFactor).toBe(true);
    expect(r.busFactorCount).toBeGreaterThanOrEqual(1);
    // 1 filled cell of 12 (3 members x 4 skills) => round(1/12*100) = 8.
    expect(r.overallCoverage).toBe(8);

    const badSkill = (await registry
      .get("tool.skills_matrix.set_rating")!
      .handler({ skillId: "ghost", memberId: "m1", level: 2 }, ctx())) as { set: boolean };
    expect(badSkill.set).toBe(false);
    const badMember = (await registry
      .get("tool.skills_matrix.set_rating")!
      .handler({ skillId: "s1", memberId: "ghost", level: 2 }, ctx())) as { set: boolean };
    expect(badMember.set).toBe(false);
  });

  it("remove_member drops the member and its grid column", async () => {
    const r0 = (await registry
      .get("tool.skills_matrix.remove_member")!
      .handler({ id: "m1" }, ctx())) as { removed: boolean };
    expect(r0.removed).toBe(true);

    const r = await list();
    expect(r.members).toHaveLength(2);
    expect(r.members.some((m) => m.id === "m1")).toBe(false);
    expect(r.grid["s1"]["m1"]).toBeUndefined();

    const ghost = (await registry
      .get("tool.skills_matrix.remove_member")!
      .handler({ id: "nope" }, ctx())) as { removed: boolean };
    expect(ghost.removed).toBe(false);
  });

  it("reset restores the demo seed", async () => {
    await registry.get("tool.skills_matrix.remove_member")!.handler({ id: "m1" }, ctx());
    await registry.get("tool.skills_matrix.remove_skill")!.handler({ id: "s1" }, ctx());

    const rr = (await registry.get("tool.skills_matrix.reset")!.handler({}, ctx())) as {
      reset: boolean;
    };
    expect(rr.reset).toBe(true);

    const r = await list();
    expect(r.members).toHaveLength(3);
    expect(r.skills).toHaveLength(4);
  });

  it("names unnamed members / skills with the lowest free number and trims text", async () => {
    const m = (await registry
      .get("tool.skills_matrix.add_member")!
      .handler({ name: "   ", description: "  Tech lead  " }, ctx())) as { id: string };
    const s = (await registry
      .get("tool.skills_matrix.add_skill")!
      .handler({ description: "   " }, ctx())) as { id: string };
    const r = await list();
    expect(r.members.find((x) => x.id === m.id)).toEqual({
      id: m.id,
      name: "Member 1",
      description: "Tech lead",
    });
    expect(r.skills.find((x) => x.id === s.id)).toEqual({
      id: s.id,
      name: "Skill 1",
      description: undefined,
    });
    // The new skill row covers every member, including the one just added.
    expect(r.grid[s.id]).toEqual({ m1: 0, m2: 0, m3: 0, [m.id]: 0 });
  });

  it("remove_skill drops the row and refuses an unknown id", async () => {
    const ok = (await registry
      .get("tool.skills_matrix.remove_skill")!
      .handler({ id: "s2" }, ctx())) as { removed: boolean };
    expect(ok.removed).toBe(true);
    const r = await list();
    expect(r.skills.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    expect(r.grid["s2"]).toBeUndefined();

    const ghost = (await registry
      .get("tool.skills_matrix.remove_skill")!
      .handler({ id: "nope" }, ctx())) as { removed: boolean };
    expect(ghost.removed).toBe(false);
  });

  it("flags knowledge gaps and keeps analysis in sync with the grid", async () => {
    const set = (skillId: string, memberId: string, level: number) =>
      registry.get("tool.skills_matrix.set_rating")!.handler({ skillId, memberId, level }, ctx());
    await set("s1", "m1", 4);
    await set("s1", "m2", 3);
    await set("s2", "m1", 2);
    const r = await list();
    const byId = Object.fromEntries(r.analysis.map((a) => [a.skillId, a]));
    expect(byId.s1).toMatchObject({ proficient: 2, advanced: 2, isBusFactor: false });
    expect(byId.s2).toMatchObject({ proficient: 1, advanced: 0, isBusFactor: false });
    expect(r.spofCount).toBe(2); // s3, s4
    expect(r.busFactorCount).toBe(0);
    expect(r.overallCoverage).toBe(25); // 3 of 12
  });
});
