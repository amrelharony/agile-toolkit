/**
 * Team Skills Matrix — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Map team proficiency (0-4) across skills; surface bus-factor +
 *           knowledge-gap (SPOF) risks and overall coverage.
 *
 * Agent surface: tool.skills_matrix.*
 * Backing CRUD : workspace.skills_matrix.* (auto-generated). Singleton: one
 *                SkillsMatrix document ({members, skills, grid}) under a fixed
 *                id. grid[skillId][memberId] = proficiency 0-4.
 *
 *   1. list_state    — members, skills, grid, per-skill risk analysis, coverage.
 *   2. add_member    — add a person (name defaults to "Member N").
 *   3. remove_member — drop a person + their grid column.
 *   4. add_skill     — add a skill (name defaults to "Skill N").
 *   5. remove_skill  — drop a skill row.
 *   6. set_rating    — set grid[skill][member] (0-4); refuses unknown ids.
 *   7. reset         — restore the 3-member / 4-skill demo seed.
 *
 * Entity kind "workspace:skillsMatrix" + the fixed SM_ID match
 * skills-matrix-client.tsx, so MCP writes round-trip into the UI. The demo
 * seed comes from defaultSkillsMatrix (single source shared with the client).
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import {
  defaultSkillsMatrix,
  type SkillsMatrix,
  type SkillsMatrixGrid,
  type SkillProficiency,
} from "@/lib/stores/workspace-types";

const KIND_SM = "workspace:skillsMatrix";
// MUST match SM_ID in skills-matrix-client.tsx.
const SM_ID = "skillsMatrix:current";

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): SkillsMatrix {
  return defaultSkillsMatrix(SM_ID);
}

function browserDoc(): SkillsMatrix | null {
  return (ws().skillsMatrices ?? []).find((d) => d.id === SM_ID) ?? null;
}

/** Lowest unused "<prefix> N" label (mirrors the client's add logic). */
function nextLabel(names: string[], prefix: string): string {
  const used = new Set(
    names.map((nm) => parseInt(nm.replace(/\D/g, ""), 10)).filter(Number.isFinite)
  );
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix} ${n}`;
}

function analyze(doc: SkillsMatrix) {
  return doc.skills.map((skill) => {
    const row = doc.grid[skill.id] ?? {};
    const proficient = doc.members.filter((m) => (row[m.id] ?? 0) >= 2).length;
    const advanced = doc.members.filter((m) => (row[m.id] ?? 0) >= 3).length;
    const isSPOF = proficient === 0;
    const isBusFactor = !isSPOF && advanced === 1;
    return { skillId: skill.id, name: skill.name, proficient, advanced, isSPOF, isBusFactor };
  });
}

function coverage(doc: SkillsMatrix): number {
  const { skills, members, grid } = doc;
  if (skills.length === 0 || members.length === 0) return 0;
  let filled = 0;
  let total = 0;
  for (const skill of skills) {
    for (const member of members) {
      total++;
      if ((grid[skill.id]?.[member.id] ?? 0) > 0) filled++;
    }
  }
  return total > 0 ? Math.round((filled / total) * 100) : 0;
}

function summarize(doc: SkillsMatrix | null) {
  const d = doc ?? emptyDoc();
  const analysis = analyze(d);
  return {
    exists: doc !== null,
    members: d.members,
    skills: d.skills,
    grid: d.grid,
    analysis,
    spofCount: analysis.filter((a) => a.isSPOF).length,
    busFactorCount: analysis.filter((a) => a.isBusFactor).length,
    overallCoverage: coverage(d),
  };
}

function addMember(
  base: SkillsMatrix,
  params: { name?: string; description?: string }
): { next: SkillsMatrix; id: string } {
  const name =
    params.name?.trim() ||
    nextLabel(
      base.members.map((m) => m.name),
      "Member"
    );
  const description = params.description?.trim();
  const member = { id: crypto.randomUUID(), name, description: description || undefined };
  const grid: SkillsMatrixGrid = {};
  for (const sId of Object.keys(base.grid)) grid[sId] = { ...base.grid[sId], [member.id]: 0 };
  return { next: { ...base, id: SM_ID, members: [...base.members, member], grid }, id: member.id };
}

function removeMember(base: SkillsMatrix, id: string): SkillsMatrix | null {
  if (!base.members.some((m) => m.id === id)) return null;
  const grid: SkillsMatrixGrid = {};
  for (const sId of Object.keys(base.grid)) {
    const row = { ...base.grid[sId] };
    delete row[id];
    grid[sId] = row;
  }
  return { ...base, id: SM_ID, members: base.members.filter((m) => m.id !== id), grid };
}

function addSkill(
  base: SkillsMatrix,
  params: { name?: string; description?: string }
): { next: SkillsMatrix; id: string } {
  const name =
    params.name?.trim() ||
    nextLabel(
      base.skills.map((s) => s.name),
      "Skill"
    );
  const description = params.description?.trim();
  const skill = { id: crypto.randomUUID(), name, description: description || undefined };
  const row: Record<string, SkillProficiency> = {};
  for (const m of base.members) row[m.id] = 0;
  return {
    next: {
      ...base,
      id: SM_ID,
      skills: [...base.skills, skill],
      grid: { ...base.grid, [skill.id]: row },
    },
    id: skill.id,
  };
}

function removeSkill(base: SkillsMatrix, id: string): SkillsMatrix | null {
  if (!base.skills.some((s) => s.id === id)) return null;
  const grid = { ...base.grid };
  delete grid[id];
  return { ...base, id: SM_ID, skills: base.skills.filter((s) => s.id !== id), grid };
}

function setRating(
  base: SkillsMatrix,
  p: { skillId: string; memberId: string; level: number }
): SkillsMatrix | null {
  if (!base.skills.some((s) => s.id === p.skillId)) return null;
  if (!base.members.some((m) => m.id === p.memberId)) return null;
  return {
    ...base,
    id: SM_ID,
    grid: {
      ...base.grid,
      [p.skillId]: { ...(base.grid[p.skillId] ?? {}), [p.memberId]: p.level as SkillProficiency },
    },
  };
}

// ──────── tool.skills_matrix.list_state ────────
registry.register({
  id: "tool.skills_matrix.list_state",
  toolId: "tool.skills_matrix",
  name: "list_state",
  category: "read",
  description:
    "Summarise the skills matrix. Returns {exists, members: {id, name, description?}[], skills: {id, name, description?}[], grid (skillId -> memberId -> level 0-4), analysis: {skillId, name, proficient, advanced, isSPOF, isBusFactor}[], spofCount (knowledge gaps), busFactorCount, overallCoverage (% of cells rated > 0)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.skills_matrix.add_member ────────
const memberParams = z.object({
  name: z.string().max(200).optional().describe("Defaults to 'Member N'."),
  description: z.string().max(2000).optional(),
});
registry.register({
  id: "tool.skills_matrix.add_member",
  toolId: "tool.skills_matrix",
  name: "add_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a team member (a new column, unrated across all skills). Creates the matrix if absent. Returns {added: true, id}.",
  paramsSchema: memberParams,
  handler: async (params) => {
    const { next, id } = addMember(browserDoc() ?? emptyDoc(), params);
    ws().upsertSkillsMatrix(next);
    return { added: true, id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID)) ?? emptyDoc();
    const { next, id } = addMember(base, params);
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, next);
    return { added: true, id };
  },
});

// ──────── tool.skills_matrix.remove_member ────────
registry.register({
  id: "tool.skills_matrix.remove_member",
  toolId: "tool.skills_matrix",
  name: "remove_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a member by id (and their column from every skill). Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const next = removeMember(browserDoc() ?? emptyDoc(), params.id);
    if (!next) return { removed: false };
    ws().upsertSkillsMatrix(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID)) ?? emptyDoc();
    const next = removeMember(base, params.id);
    if (!next) return { removed: false };
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, next);
    return { removed: true };
  },
});

// ──────── tool.skills_matrix.add_skill ────────
registry.register({
  id: "tool.skills_matrix.add_skill",
  toolId: "tool.skills_matrix",
  name: "add_skill",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a skill (a new row, unrated for all members). Creates the matrix if absent. Returns {added: true, id}.",
  paramsSchema: memberParams,
  handler: async (params) => {
    const { next, id } = addSkill(browserDoc() ?? emptyDoc(), params);
    ws().upsertSkillsMatrix(next);
    return { added: true, id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID)) ?? emptyDoc();
    const { next, id } = addSkill(base, params);
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, next);
    return { added: true, id };
  },
});

// ──────── tool.skills_matrix.remove_skill ────────
registry.register({
  id: "tool.skills_matrix.remove_skill",
  toolId: "tool.skills_matrix",
  name: "remove_skill",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a skill by id (and its grid row). Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: z.object({ id: z.string() }),
  handler: async (params) => {
    const next = removeSkill(browserDoc() ?? emptyDoc(), params.id);
    if (!next) return { removed: false };
    ws().upsertSkillsMatrix(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID)) ?? emptyDoc();
    const next = removeSkill(base, params.id);
    if (!next) return { removed: false };
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, next);
    return { removed: true };
  },
});

// ──────── tool.skills_matrix.set_rating ────────
registry.register({
  id: "tool.skills_matrix.set_rating",
  toolId: "tool.skills_matrix",
  name: "set_rating",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a member's proficiency in a skill: 0 none, 1 beginner, 2 intermediate, 3 advanced, 4 expert. Returns {set: false} when the skillId or memberId is unknown, else {set: true}.",
  paramsSchema: z.object({
    skillId: z.string(),
    memberId: z.string(),
    level: z.number().int().min(0).max(4),
  }),
  handler: async (params) => {
    const next = setRating(browserDoc() ?? emptyDoc(), params);
    if (!next) return { set: false };
    ws().upsertSkillsMatrix(next);
    return { set: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<SkillsMatrix>(ctx.userId, KIND_SM, SM_ID)) ?? emptyDoc();
    const next = setRating(base, params);
    if (!next) return { set: false };
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, next);
    return { set: true };
  },
});

// ──────── tool.skills_matrix.reset ────────
registry.register({
  id: "tool.skills_matrix.reset",
  toolId: "tool.skills_matrix",
  name: "reset",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reset the matrix to the 3-member / 4-skill demo seed (all unrated). Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: async () => {
    ws().upsertSkillsMatrix(defaultSkillsMatrix(SM_ID));
    return { reset: true };
  },
  mcpHandler: async (_params, ctx) => {
    await serverUpsertEntity<SkillsMatrix>(ctx.userId, KIND_SM, defaultSkillsMatrix(SM_ID));
    return { reset: true };
  },
});
