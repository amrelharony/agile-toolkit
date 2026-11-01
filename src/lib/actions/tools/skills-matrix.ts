/**
 * Team Skills Matrix — tool-local actions.
 *
 * Category: Team Health & Maturity (squad S4)
 * Tool:     Rate each person on the Team page roster in each skill (None,
 *           Beginner, Intermediate, Advanced, Expert, or Not rated); flag
 *           the skills nobody can do (gaps) and the ones that hang on one
 *           person (single points of failure); per-skill targets and a
 *           cross-training plan.
 *
 * Agent surface: tool.skills_matrix.*
 * Backing CRUD : workspace.skills_matrix.* (auto-generated). Singleton: one
 *                SkillsMatrix document under SKILLS_MATRIX_ID.
 *
 *   1. list_state        — columns, ratings, coverage, gaps, SPOFs, targets,
 *                          suggestions and the training plan.
 *   2. add_member        — add a person to the team roster (the matrix's columns).
 *   3. remove_member     — remove a matrix-only person (not on the roster).
 *   4. add_skill         — add a skill (name required, unique), with a target.
 *   5. remove_skill      — drop a skill, its ratings and its training pairs.
 *   6. set_rating        — set or clear (null) a person's level in a skill.
 *   7. set_target        — set or clear a skill's target people and level.
 *   8. add_training      — add a cross-training pair.
 *   9. complete_training — mark a pair done on a day, or reopen it.
 *  10. remove_training   — remove a pair.
 *  11. reset             — clear skills, ratings and training (roster untouched).
 *
 * Every number comes from lib/skills/coverage, which the page uses too, so
 * the agent and the page agree. Writes go through normalizeSkillsMatrix and
 * rekeyToRoster as the page's do: an older matrix is upgraded (its 0s were
 * Not rated) and people matched to the roster by name move to roster ids.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  emptySkillsMatrix,
  type SkillProficiency,
  type SkillsMatrix,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  SKILLS_MATRIX_ID,
  SKILLS_MATRIX_KIND,
  TARGET_PEOPLE_MAX,
  coverageCounts,
  isTargetLevel,
  matrixColumns,
  newSkill,
  newTrainingPair,
  normalizeSkillsMatrix,
  openTraining,
  proficiencyName,
  ratedCellsPct,
  ratingOf,
  realRoster,
  rekeyToRoster,
  rosterSkillsMissing,
  skillCoverage,
  skillNameError,
  skillsVerdict,
  suggestCrossTraining,
  targetPeopleError,
  trainingDoneError,
  trainingError,
  trainingReached,
  withRating,
  withSkill,
  withSkillPatch,
  withTraining,
  withTrainingPatch,
  withoutColumn,
  withoutSkill,
  withoutTraining,
  type SkillColumn,
  type SkillTargetLevel,
} from "@/lib/skills/coverage";

/** MUST match registerCollection("teamMember", …) in workspace-store.ts. */
const KIND_TEAM = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

/** Where the matrix and the roster live: the browser's workspace, or the user's rows on the server. */
interface SkillsStore {
  getDoc(): Promise<SkillsMatrix | null>;
  putDoc(doc: SkillsMatrix): Promise<void>;
  roster(): Promise<TeamMember[]>;
  addToRoster(member: TeamMember): Promise<void>;
}

const browserStore: SkillsStore = {
  getDoc: async () => (ws().skillsMatrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID) ?? null,
  putDoc: async (doc) => ws().upsertSkillsMatrix(doc),
  roster: async () => ws().teamMembers ?? [],
  addToRoster: async (member) => ws().upsertTeamMember(member),
};

function serverStore(userId: string): SkillsStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<SkillsMatrix>(userId, SKILLS_MATRIX_KIND, SKILLS_MATRIX_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<SkillsMatrix>(userId, SKILLS_MATRIX_KIND, doc);
    },
    roster: async () => serverListEntities<TeamMember>(userId, KIND_TEAM),
    addToRoster: async (member) => {
      await serverUpsertEntity<TeamMember>(userId, KIND_TEAM, member);
    },
  };
}

/** The stored matrix as the page reads it, with its columns from the roster. */
async function load(store: SkillsStore) {
  const raw = await store.getDoc();
  const roster = realRoster(await store.roster());
  const doc = normalizeSkillsMatrix(raw, SKILLS_MATRIX_ID);
  return { raw, roster, doc, columns: matrixColumns(doc, roster) };
}

/** What an action answers: a plain record, as the agent reads it. */
type Result = Record<string, unknown>;

/**
 * Change the matrix with `fn` (no `doc` writes nothing). Like the page, the
 * write upgrades an older doc and re-keys people matched to the roster
 * before `fn` runs, so a change lands on the cells list_state shows (a
 * cleared roster cell isn't refilled from the legacy one). `columns` still
 * name the legacy ids, so an agent passing one is understood.
 */
async function update(
  store: SkillsStore,
  fn: (
    doc: SkillsMatrix,
    columns: SkillColumn[],
    roster: TeamMember[]
  ) => { doc?: SkillsMatrix; result: Result }
): Promise<Result> {
  const { doc, columns, roster } = await load(store);
  const out = fn(rekeyToRoster(doc, columns), columns, roster);
  if (out.doc) await store.putDoc({ ...out.doc, id: SKILLS_MATRIX_ID, version: 2 });
  return out.result;
}

/** The column an id names: a column id, or a legacy id folded into a roster column. */
const columnFor = (columns: readonly SkillColumn[], id: string) =>
  columns.find((c) => c.id === id || c.legacyIds.includes(id));

/* ── list_state ─────────────────────────────────────────────────────── */

function summarize(
  raw: SkillsMatrix | null,
  doc: SkillsMatrix,
  columns: SkillColumn[],
  roster: TeamMember[],
  today: string
) {
  const coverage = skillCoverage(doc, columns, roster);
  const counts = coverageCounts(coverage);
  const nameOf = (id: string | undefined) =>
    id ? (columns.find((c) => c.id === id)?.name ?? null) : null;
  const skillName = (id: string) => doc.skills.find((s) => s.id === id)?.name ?? null;
  const grid: Record<string, Record<string, SkillProficiency | null>> = {};
  for (const s of doc.skills) {
    grid[s.id] = Object.fromEntries(columns.map((c) => [c.id, ratingOf(doc, s.id, c)]));
  }
  const open = new Set(openTraining(doc).map((p) => p.id));
  return {
    exists: raw !== null,
    columns: columns.map((c) => ({ id: c.id, name: c.name, onRoster: c.onRoster })),
    members: doc.members,
    skills: doc.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      targetPeople: s.targetPeople ?? null,
      targetLevel: isTargetLevel(s.targetLevel) ? s.targetLevel : 2,
    })),
    grid,
    coverage,
    gapCount: counts.gaps,
    spofCount: counts.spofs,
    belowTargetCount: counts.belowTarget,
    unratedCount: counts.unrated,
    notRatedYetCount: counts.notRatedYet,
    verdict: skillsVerdict(coverage, columns),
    suggestions: suggestCrossTraining(doc, columns, coverage).map((s) => ({
      ...s,
      skill: skillName(s.skillId),
      learner: nameOf(s.learnerId),
      mentor: nameOf(s.mentorId),
    })),
    training: (doc.training ?? []).map((p) => ({
      id: p.id,
      skillId: p.skillId,
      skill: skillName(p.skillId),
      learnerId: p.learnerId,
      learner: nameOf(p.learnerId),
      mentorId: p.mentorId ?? null,
      mentor: nameOf(p.mentorId),
      toLevel: p.toLevel,
      createdAt: p.createdAt,
      due: p.due ?? null,
      overdue: open.has(p.id) && !!p.due && p.due < today,
      doneAt: p.doneAt ?? null,
      reached: trainingReached(doc, p, columns),
    })),
    rosterSkillsMissing: rosterSkillsMissing(doc, roster),
    // Deprecated: the old shapes, kept for agents that read them.
    analysis: coverage.map((c) => ({
      skillId: c.skillId,
      name: c.name,
      proficient: c.capable,
      advanced: columns.filter((col) => (ratingOf(doc, c.skillId, col) ?? -1) >= 3).length,
      isGap: c.gap,
      isSPOF: c.spof,
      isBusFactor: c.spof,
    })),
    busFactorCount: counts.spofs,
    overallCoverage: ratedCellsPct(doc, columns),
  };
}

async function listState(store: SkillsStore) {
  const { raw, doc, columns, roster } = await load(store);
  return summarize(raw, doc, columns, roster, todayLocalISO());
}

registry.register({
  id: "tool.skills_matrix.list_state",
  toolId: "tool.skills_matrix",
  name: "list_state",
  category: "read",
  description:
    "Summarise the skills matrix, counted as the page counts it. People are the Team page roster plus any matrix-only people from before it (onRoster false). A person is capable from Intermediate (2); a gap is a skill nobody rated is capable at, a single point of failure (spof) one exactly one person is capable at; Not rated (null) never counts, and a skill nobody is rated in yet (notRatedYet) is neither a gap nor below target. Returns {exists, columns: {id, name, onRoster}[], members (matrix-only people), skills: {id, name, description, targetPeople (null = no target), targetLevel (2|3|4)}[], grid (skillId -> column id -> level 0-4, null = Not rated), coverage: {skillId, name, capable, holders, holderIds, atTarget, target, targetLevel, unrated, notRatedYet, gap, spof, meetsTarget (null without a target or while not rated yet), listedBy (roster ids whose Team page skills name it)}[], gapCount, spofCount, belowTargetCount, unratedCount, notRatedYetCount (skills nobody is rated in), verdict (the page's sentence), suggestions: {skillId, skill, learnerId, learner, mentorId?, mentor, toLevel, from, reason ('gap'|'spof'|'below-target')}[], training: {id, skillId, skill, learnerId, learner, mentorId, mentor, toLevel, createdAt, due, overdue, doneAt, reached}[], rosterSkillsMissing (skills on the Team page with no row), analysis (deprecated: {skillId, name, proficient, advanced, isGap, isSPOF, isBusFactor}), busFactorCount (deprecated, = spofCount), overallCoverage (deprecated: % of cells rated above None)}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── add_member / remove_member ─────────────────────────────────────── */

const NameParams = z.object({
  name: z.string().max(200).optional().describe("The person's name (required)."),
  description: z.string().max(2000).optional().describe("Ignored: the roster has no description."),
});

async function addMember(store: SkillsStore, params: z.infer<typeof NameParams>) {
  const name = params.name?.trim() ?? "";
  if (!name) return { added: false as const, reason: "name_required" as const };
  const roster = realRoster(await store.roster());
  const existing = findRosterMember(roster, name);
  if (existing) return { added: true as const, id: existing.id, existing: true, onRoster: true };
  const member: TeamMember = { id: `member_${crypto.randomUUID()}`, name };
  await store.addToRoster(member);
  return { added: true as const, id: member.id, existing: false, onRoster: true };
}

registry.register({
  id: "tool.skills_matrix.add_member",
  toolId: "tool.skills_matrix",
  name: "add_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a person to the team roster (the Team page), which gives them a column in the matrix, Not rated in every skill. A name already on the roster (trimmed, case-insensitive) returns that member instead. Returns {added: false, reason: 'name_required'} for a blank name, else {added: true, id (the roster id), existing, onRoster: true}.",
  paramsSchema: NameParams,
  handler: async (params) => addMember(browserStore, params),
  mcpHandler: async (params, ctx) => addMember(serverStore(ctx.userId), params),
});

const IdParams = z.object({ id: z.string() });

async function removeMember(store: SkillsStore, { id }: z.infer<typeof IdParams>) {
  return update(store, (doc, columns) => {
    const column = columnFor(columns, id);
    if (column?.onRoster) {
      return { result: { removed: false as const, reason: "on_roster" as const } };
    }
    const out = withoutColumn(doc, id);
    if (!out) return { result: { removed: false as const, reason: "not_found" as const } };
    return { doc: out.doc, result: { removed: true as const } };
  });
}

registry.register({
  id: "tool.skills_matrix.remove_member",
  toolId: "tool.skills_matrix",
  name: "remove_member",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a matrix-only person (a column with onRoster false), with their ratings and the training pairs they learn in; pairs they mentor go back to outside help. Roster people are removed on the Team page. Returns {removed: false, reason: 'on_roster' | 'not_found'} or {removed: true}.",
  paramsSchema: IdParams,
  handler: async (params) => removeMember(browserStore, params),
  mcpHandler: async (params, ctx) => removeMember(serverStore(ctx.userId), params),
});

/* ── add_skill / remove_skill ───────────────────────────────────────── */

const TargetLevel = z
  .union([z.literal(2), z.literal(3), z.literal(4)])
  .describe("2 Intermediate, 3 Advanced, 4 Expert: the level the target counts from.");

const SkillParams = z.object({
  name: z.string().max(200).optional().describe("Required; unique on the matrix."),
  description: z.string().max(2000).optional(),
  targetPeople: z
    .number()
    .int()
    .min(1)
    .max(TARGET_PEOPLE_MAX)
    .optional()
    .describe("People the team wants at targetLevel or above; no more than the team has."),
  targetLevel: TargetLevel.optional().describe("Default 2 (Intermediate or above)."),
});

async function addSkill(store: SkillsStore, params: z.infer<typeof SkillParams>) {
  return update(store, (doc, columns) => {
    const name = params.name?.trim() ?? "";
    const error = skillNameError(name, doc);
    if (error) {
      const twin = name ? doc.skills.find((s) => nameKey(s.name) === nameKey(name)) : undefined;
      const reason = !name ? "name_required" : twin ? "duplicate" : "invalid_name";
      return {
        result: { added: false as const, reason, message: error, ...(twin ? { id: twin.id } : {}) },
      };
    }
    const targetError = targetPeopleError(params.targetPeople, columns.length);
    if (targetError) {
      return {
        result: { added: false as const, reason: "invalid_target" as const, message: targetError },
      };
    }
    const skill = newSkill(
      {
        name,
        description: params.description,
        targetPeople: params.targetPeople,
        targetLevel: params.targetLevel,
      },
      crypto.randomUUID()
    );
    return { doc: withSkill(doc, skill), result: { added: true as const, id: skill.id } };
  });
}

registry.register({
  id: "tool.skills_matrix.add_skill",
  toolId: "tool.skills_matrix",
  name: "add_skill",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a skill (a new row, Not rated for everyone). Creates the matrix if absent. The name is required and unique (trimmed, case-insensitive). Returns {added: false, reason: 'name_required' | 'invalid_name' | 'duplicate' (with the existing id) | 'invalid_target', message} or {added: true, id}.",
  paramsSchema: SkillParams,
  handler: async (params) => addSkill(browserStore, params),
  mcpHandler: async (params, ctx) => addSkill(serverStore(ctx.userId), params),
});

async function removeSkill(store: SkillsStore, { id }: z.infer<typeof IdParams>) {
  return update(store, (doc) => {
    const out = withoutSkill(doc, id);
    if (!out) return { result: { removed: false as const } };
    return { doc: out.doc, result: { removed: true as const } };
  });
}

registry.register({
  id: "tool.skills_matrix.remove_skill",
  toolId: "tool.skills_matrix",
  name: "remove_skill",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a skill by id, with its ratings and its training pairs. Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: IdParams,
  handler: async (params) => removeSkill(browserStore, params),
  mcpHandler: async (params, ctx) => removeSkill(serverStore(ctx.userId), params),
});

/* ── set_rating / set_target ────────────────────────────────────────── */

const RatingParams = z.object({
  skillId: z.string(),
  memberId: z
    .string()
    .describe("A column id from list_state (a roster id, or a matrix-only person)."),
  level: z
    .number()
    .int()
    .min(0)
    .max(4)
    .nullable()
    .describe(
      "0 None, 1 Beginner, 2 Intermediate, 3 Advanced, 4 Expert; null clears it to Not rated."
    ),
});

async function setRating(store: SkillsStore, p: z.infer<typeof RatingParams>) {
  return update(store, (doc, columns) => {
    const column = columnFor(columns, p.memberId);
    if (!doc.skills.some((s) => s.id === p.skillId) || !column) {
      return { result: { set: false as const } };
    }
    const level = p.level === null ? null : (p.level as SkillProficiency);
    return {
      doc: withRating(doc, p.skillId, column.id, level),
      result: { set: true as const, level, label: proficiencyName(level) },
    };
  });
}

registry.register({
  id: "tool.skills_matrix.set_rating",
  toolId: "tool.skills_matrix",
  name: "set_rating",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a person's level in a skill: 0 none, 1 beginner, 2 intermediate, 3 advanced, 4 expert, or null to clear it back to Not rated (Not rated never counts; None does). Returns {set: false} when the skillId or memberId is unknown, else {set: true, level, label}.",
  paramsSchema: RatingParams,
  handler: async (params) => setRating(browserStore, params),
  mcpHandler: async (params, ctx) => setRating(serverStore(ctx.userId), params),
});

const TargetParams = z.object({
  skillId: z.string(),
  people: z
    .number()
    .int()
    .min(1)
    .max(TARGET_PEOPLE_MAX)
    .nullable()
    .describe("People needed at the level or above; null removes the target."),
  level: TargetLevel.optional().describe("Leave out to keep the skill's level (default 2)."),
});

async function setTarget(store: SkillsStore, p: z.infer<typeof TargetParams>) {
  return update(store, (doc, columns) => {
    if (!doc.skills.some((s) => s.id === p.skillId)) {
      return { result: { set: false as const, reason: "not_found" as const } };
    }
    const error = targetPeopleError(p.people, columns.length);
    if (error)
      return { result: { set: false as const, reason: "invalid_target" as const, message: error } };
    const next = withSkillPatch(doc, p.skillId, {
      targetPeople: p.people,
      ...(p.level !== undefined ? { targetLevel: p.level } : {}),
    });
    const coverage = skillCoverage(next, columns).find((c) => c.skillId === p.skillId);
    return {
      doc: next,
      result: {
        set: true as const,
        target: coverage?.target ?? null,
        targetLevel: coverage?.targetLevel ?? 2,
        atTarget: coverage?.atTarget ?? 0,
        meetsTarget: coverage?.meetsTarget ?? null,
      },
    };
  });
}

registry.register({
  id: "tool.skills_matrix.set_target",
  toolId: "tool.skills_matrix",
  name: "set_target",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set how many people a skill needs at a level (target coverage), or clear it with people: null. It can't exceed the team's size. Returns {set: false, reason: 'not_found' | 'invalid_target', message?} or {set: true, target, targetLevel, atTarget, meetsTarget}.",
  paramsSchema: TargetParams,
  handler: async (params) => setTarget(browserStore, params),
  mcpHandler: async (params, ctx) => setTarget(serverStore(ctx.userId), params),
});

/* ── Training pairs ─────────────────────────────────────────────────── */

const IsoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const TrainingParams = z.object({
  skillId: z.string(),
  learnerId: z.string().describe("A column id from list_state."),
  mentorId: z.string().optional().describe("A column id; leave out for outside help."),
  toLevel: TargetLevel.optional().describe("Defaults to the skill's target level (2 without one)."),
  due: IsoDay.optional().describe("When it should be done; past days are fine."),
});

async function addTraining(store: SkillsStore, p: z.infer<typeof TrainingParams>) {
  return update(store, (doc, columns) => {
    const skill = doc.skills.find((s) => s.id === p.skillId);
    const learner = columnFor(columns, p.learnerId);
    const mentor = p.mentorId ? columnFor(columns, p.mentorId) : undefined;
    const toLevel: SkillTargetLevel =
      p.toLevel ?? (isTargetLevel(skill?.targetLevel) ? skill.targetLevel : 2);
    const values = {
      skillId: p.skillId,
      learnerId: learner?.id ?? p.learnerId,
      ...(p.mentorId ? { mentorId: mentor?.id ?? p.mentorId } : {}),
      toLevel,
      ...(p.due ? { due: p.due } : {}),
    };
    const error = trainingError(values, doc, columns);
    if (error) return { result: { added: false as const, message: error } };
    const pair = newTrainingPair(
      values,
      `training_${crypto.randomUUID()}`,
      new Date().toISOString()
    );
    return { doc: withTraining(doc, pair), result: { added: true as const, id: pair.id, toLevel } };
  });
}

registry.register({
  id: "tool.skills_matrix.add_training",
  toolId: "tool.skills_matrix",
  name: "add_training",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a cross-training pair: who learns a skill (learnerId), from whom (mentorId, or none for outside help), up to which level. Take them from list_state's suggestions or pick your own. Refuses an unknown skill or person, the learner as their own mentor, and a learner already in an open pair for the skill. Returns {added: false, message} or {added: true, id, toLevel}.",
  paramsSchema: TrainingParams,
  handler: async (params) => addTraining(browserStore, params),
  mcpHandler: async (params, ctx) => addTraining(serverStore(ctx.userId), params),
});

const CompleteParams = z.object({
  id: z.string(),
  on: IsoDay.optional().describe("The day it was done; defaults to today, never after it."),
  reopen: z.boolean().optional().describe("True to mark a done pair open again."),
});

async function completeTraining(store: SkillsStore, p: z.infer<typeof CompleteParams>) {
  const today = todayLocalISO();
  return update(store, (doc, columns) => {
    const pair = (doc.training ?? []).find((t) => t.id === p.id);
    if (!pair) return { result: { done: false as const, reason: "not_found" as const } };
    if (p.reopen) {
      return {
        doc: withTrainingPatch(doc, p.id, { doneAt: null }),
        result: { done: false as const, reopened: true },
      };
    }
    const on = p.on ?? today;
    const error = trainingDoneError(on, today);
    if (error) {
      return { result: { done: false as const, reason: "invalid_day" as const, message: error } };
    }
    return {
      doc: withTrainingPatch(doc, p.id, { doneAt: on }),
      result: { done: true as const, doneAt: on, reached: trainingReached(doc, pair, columns) },
    };
  });
}

registry.register({
  id: "tool.skills_matrix.complete_training",
  toolId: "tool.skills_matrix",
  name: "complete_training",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a training pair done on a day (default today, never in the future), or reopen it with reopen: true. Done is never set automatically when the rating reaches the level; `reached` says whether it has. Returns {done: false, reason: 'not_found' | 'invalid_day', message?}, {done: false, reopened: true} or {done: true, doneAt, reached}.",
  paramsSchema: CompleteParams,
  handler: async (params) => completeTraining(browserStore, params),
  mcpHandler: async (params, ctx) => completeTraining(serverStore(ctx.userId), params),
});

async function removeTraining(store: SkillsStore, { id }: z.infer<typeof IdParams>) {
  return update(store, (doc) => {
    if (!(doc.training ?? []).some((p) => p.id === id))
      return { result: { removed: false as const } };
    return { doc: withoutTraining(doc, id), result: { removed: true as const } };
  });
}

registry.register({
  id: "tool.skills_matrix.remove_training",
  toolId: "tool.skills_matrix",
  name: "remove_training",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a training pair by id. Returns {removed: false} for an unknown id, else {removed: true}.",
  paramsSchema: IdParams,
  handler: async (params) => removeTraining(browserStore, params),
  mcpHandler: async (params, ctx) => removeTraining(serverStore(ctx.userId), params),
});

/* ── reset ──────────────────────────────────────────────────────────── */

registry.register({
  id: "tool.skills_matrix.reset",
  toolId: "tool.skills_matrix",
  name: "reset",
  category: "write",
  requiresConfirmation: true,
  description:
    "Clear the matrix: every skill, rating, matrix-only person and training pair. The team roster stays as it is. Returns {reset: true}.",
  paramsSchema: z.object({}),
  handler: async () => {
    await browserStore.putDoc(emptySkillsMatrix(SKILLS_MATRIX_ID));
    return { reset: true };
  },
  mcpHandler: async (_params, ctx) => {
    await serverStore(ctx.userId).putDoc(emptySkillsMatrix(SKILLS_MATRIX_ID));
    return { reset: true };
  },
});
