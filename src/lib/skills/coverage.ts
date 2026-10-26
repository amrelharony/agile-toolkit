/**
 * Skills Matrix coverage: who can do what, which skills hang on one person,
 * and who could learn them.
 *
 * Pure and server-safe (no React, no client modules), so the page, the
 * agent actions (tool.skills_matrix.*) and the next-step rules count the
 * same way. Three rules carry the tool:
 *
 *   - A person is capable at a skill from Intermediate (CAPABLE_LEVEL, 2):
 *     they handle routine work in it alone.
 *   - A skill nobody is capable at is a gap; a skill exactly one person is
 *     capable at is a single point of failure. The page used to call a gap
 *     a "SPOF" and only flag one Advanced person as a bus factor, so the
 *     one Intermediate person a skill really hung on was never flagged.
 *   - Not rated is not None. A missing cell is Not rated and never counts;
 *     0 is a deliberate None. Older matrices wrote 0 into every new cell,
 *     so on a doc without `version: 2` a stored 0 reads as Not rated.
 *
 * People are the Team page roster (`TeamMember.id` columns). A matrix from
 * before the roster kept its own people (`members`): one whose name matches
 * a roster member reads as that member (and is re-keyed to the roster id on
 * the next write, `rekeyToRoster`); the rest show as "not on the team".
 */

import {
  emptySkillsMatrix,
  type SkillProficiency,
  type SkillsMatrix,
  type SkillsMatrixGrid,
  type SkillsMatrixMember,
  type SkillsMatrixSkill,
  type SkillsTrainingPair,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";

/** The tool's one document id (the page and tool.skills_matrix.* share it). */
export const SKILLS_MATRIX_ID = "skillsMatrix:current";
/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const SKILLS_MATRIX_KIND = "workspace:skillsMatrix";

/** The level from which a person handles routine work in a skill alone. */
export const CAPABLE_LEVEL = 2;

export type SkillTargetLevel = 2 | 3 | 4;
export const TARGET_LEVELS: readonly SkillTargetLevel[] = [2, 3, 4];
/** A target counts people from Intermediate unless the team picks a higher level. */
export const DEFAULT_TARGET_LEVEL: SkillTargetLevel = 2;
/** The workspace CRUD schema's bound on a target. */
export const TARGET_PEOPLE_MAX = 50;
export const SKILL_NAME_MAX = 80;
export const SKILL_DESCRIPTION_MAX = 2000;
/** People a skill needs at Intermediate when it has no target: two, so nobody is the only one. */
export const DEFAULT_CAPABLE_PEOPLE = 2;

export interface ProficiencyStep {
  value: SkillProficiency;
  name: string;
  meaning: string;
}

/** The five levels, with the guide's wording (lib/tools/guides/team.ts). */
export const PROFICIENCY_STEPS: readonly ProficiencyStep[] = [
  { value: 0, name: "None", meaning: "Hasn't worked with it." },
  { value: 1, name: "Beginner", meaning: "Learning; needs help." },
  { value: 2, name: "Intermediate", meaning: "Handles routine work alone." },
  { value: 3, name: "Advanced", meaning: "Handles complex work and helps others." },
  { value: 4, name: "Expert", meaning: "The go-to person; can teach and set direction." },
];

export const NOT_RATED = "Not rated";

/** "Intermediate", or "Not rated" for a cell nobody has rated. */
export function proficiencyName(level: number | null | undefined): string {
  if (level === null || level === undefined) return NOT_RATED;
  return PROFICIENCY_STEPS.find((s) => s.value === level)?.name ?? NOT_RATED;
}

/** "Intermediate or above", the words a target level reads as. */
export const TARGET_LEVEL_LABEL: Record<SkillTargetLevel, string> = {
  2: "Intermediate or above",
  3: "Advanced or above",
  4: "Expert",
};

export const isTargetLevel = (v: unknown): v is SkillTargetLevel => v === 2 || v === 3 || v === 4;

/* ── Columns: the people the matrix rates ───────────────────────────── */

export interface SkillColumn {
  /** The id ratings are stored under: a TeamMember.id, or a legacy member's id. */
  id: string;
  name: string;
  /** On the Team page roster. False for a matrix-only person from before it. */
  onRoster: boolean;
  /** Legacy member ids matched to this roster member by name: their ratings
   *  read as this person's until the next write re-keys them. */
  legacyIds: string[];
}

/** The roster without example people (another tool's example may have added some). */
export function realRoster(roster: readonly TeamMember[] | undefined): TeamMember[] {
  return (roster ?? []).filter((m) => !isExampleId(m.id) && Boolean(m.name?.trim()));
}

/**
 * The matrix's columns: every roster member (in roster order), then each
 * legacy member whose name matches nobody on the roster, as "not on the
 * team". Callers pass the real roster (`realRoster`), or the example's.
 */
export function matrixColumns(
  doc: SkillsMatrix | null | undefined,
  roster: readonly TeamMember[]
): SkillColumn[] {
  const columns: SkillColumn[] = roster.map((m) => ({
    id: m.id,
    name: m.name.trim(),
    onRoster: true,
    legacyIds: [],
  }));
  const byId = new Map(columns.map((c) => [c.id, c]));
  for (const legacy of doc?.members ?? []) {
    if (byId.has(legacy.id)) continue;
    const match = findRosterMember(roster, legacy.name);
    if (match) {
      byId.get(match.id)?.legacyIds.push(legacy.id);
      continue;
    }
    const column: SkillColumn = {
      id: legacy.id,
      name: legacy.name.trim() || "Unnamed",
      onRoster: false,
      legacyIds: [],
    };
    columns.push(column);
    byId.set(column.id, column);
  }
  return columns;
}

/* ── Ratings ────────────────────────────────────────────────────────── */

/** A stored cell as a level 0-4, or null for Not rated (a 0 on an older doc included). */
function storedLevel(version: SkillsMatrix["version"], raw: unknown): SkillProficiency | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const level = Math.min(4, Math.max(0, Math.round(raw))) as SkillProficiency;
  return level === 0 && version !== 2 ? null : level;
}

/**
 * A person's level in a skill; null = Not rated. A roster column falls back
 * to the legacy members matched to it by name.
 */
export function ratingOf(
  doc: SkillsMatrix | null | undefined,
  skillId: string,
  column: SkillColumn | string
): SkillProficiency | null {
  const row = doc?.grid?.[skillId];
  if (!row) return null;
  const ids = typeof column === "string" ? [column] : [column.id, ...column.legacyIds];
  for (const id of ids) {
    const level = storedLevel(doc?.version, row[id]);
    if (level !== null) return level;
  }
  return null;
}

/* ── Coverage per skill ─────────────────────────────────────────────── */

export interface SkillCoverage {
  skillId: string;
  name: string;
  /** People at Intermediate or above. */
  capable: number;
  /** Their names, strongest first. */
  holders: string[];
  holderIds: string[];
  /** People at the target level or above. */
  atTarget: number;
  /** People the team wants at `targetLevel`; null = no target. */
  target: number | null;
  targetLevel: SkillTargetLevel;
  /** People not rated in this skill yet: the counts are "so far". */
  unrated: number;
  /** Nobody is capable. */
  gap: boolean;
  /** Exactly one person is capable: the skill hangs on them. */
  spof: boolean;
  /** Null without a target. */
  meetsTarget: boolean | null;
  /** Roster ids whose Team page skills name this skill. */
  listedBy: string[];
}

export function skillCoverage(
  doc: SkillsMatrix | null | undefined,
  columns: readonly SkillColumn[],
  roster: readonly TeamMember[] = []
): SkillCoverage[] {
  return (doc?.skills ?? []).map((skill) => {
    const targetLevel = isTargetLevel(skill.targetLevel) ? skill.targetLevel : DEFAULT_TARGET_LEVEL;
    const target = validTarget(skill.targetPeople);
    const rated = columns.map((c) => ({ column: c, level: ratingOf(doc, skill.id, c) }));
    const holders = rated
      .filter(
        (r): r is { column: SkillColumn; level: SkillProficiency } =>
          (r.level ?? -1) >= CAPABLE_LEVEL
      )
      .sort((a, b) => b.level - a.level || a.column.name.localeCompare(b.column.name));
    const atTarget = rated.filter((r) => (r.level ?? -1) >= targetLevel).length;
    const key = nameKey(skill.name);
    return {
      skillId: skill.id,
      name: skill.name,
      capable: holders.length,
      holders: holders.map((h) => h.column.name),
      holderIds: holders.map((h) => h.column.id),
      atTarget,
      target,
      targetLevel,
      unrated: rated.filter((r) => r.level === null).length,
      gap: holders.length === 0,
      spof: holders.length === 1,
      meetsTarget: target === null ? null : atTarget >= target,
      listedBy: roster
        .filter((m) => (m.skills ?? []).some((s) => nameKey(s) === key))
        .map((m) => m.id),
    };
  });
}

function validTarget(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= TARGET_PEOPLE_MAX
    ? v
    : null;
}

export interface CoverageCounts {
  skills: number;
  gaps: number;
  spofs: number;
  /** Skills with a target they don't meet. */
  belowTarget: number;
  /** Skills with a target they meet. */
  atTarget: number;
  /** Skills with a target. */
  withTarget: number;
  /** Cells nobody has rated, across the matrix. */
  unrated: number;
}

export function coverageCounts(coverage: readonly SkillCoverage[]): CoverageCounts {
  return {
    skills: coverage.length,
    gaps: coverage.filter((c) => c.gap).length,
    spofs: coverage.filter((c) => c.spof).length,
    belowTarget: coverage.filter((c) => c.meetsTarget === false).length,
    atTarget: coverage.filter((c) => c.meetsTarget === true).length,
    withTarget: coverage.filter((c) => c.target !== null).length,
    unrated: coverage.reduce((n, c) => n + c.unrated, 0),
  };
}

/**
 * Deprecated: the share of person × skill cells rated above None. It was the
 * page's "Coverage" figure, and a high value could hide a single point of
 * failure; agents still get it as `overallCoverage`.
 */
export function ratedCellsPct(
  doc: SkillsMatrix | null | undefined,
  columns: readonly SkillColumn[]
): number {
  const skills = doc?.skills ?? [];
  const total = skills.length * columns.length;
  if (total === 0) return 0;
  let filled = 0;
  for (const s of skills) for (const c of columns) if ((ratingOf(doc, s.id, c) ?? 0) > 0) filled++;
  return Math.round((filled / total) * 100);
}

/* ── Cross-training ─────────────────────────────────────────────────── */

export type TrainingReason = "gap" | "spof" | "below-target";

export interface TrainingSuggestion {
  skillId: string;
  learnerId: string;
  /** The strongest holder with the fewest pairs; unset = outside help (a gap). */
  mentorId?: string;
  toLevel: SkillTargetLevel;
  /** The learner's level now. */
  from: SkillProficiency;
  reason: TrainingReason;
}

/** Pairs not done yet, for skills still on the matrix. */
export function openTraining(doc: SkillsMatrix | null | undefined): SkillsTrainingPair[] {
  const skills = new Set((doc?.skills ?? []).map((s) => s.id));
  return (doc?.training ?? []).filter((p) => !p.doneAt && skills.has(p.skillId));
}

const REASON_ORDER: Record<TrainingReason, number> = { gap: 0, spof: 1, "below-target": 2 };

function reasonOf(c: SkillCoverage): TrainingReason | null {
  if (c.gap) return "gap";
  if (c.spof) return "spof";
  if (c.meetsTarget === false) return "below-target";
  return null;
}

/**
 * Who could learn what, for the skills at risk: gaps first, then single
 * points of failure, then skills below their target.
 *
 * A skill with a target needs that many people at its target level; one
 * without needs two people at Intermediate, so nobody is the only one.
 * Open pairs already count towards it. Learners are rated roster people
 * below the level (the highest level first, then whoever learns the
 * least), never someone already learning the skill; the mentor is the
 * strongest person at the level with the fewest pairs. A gap has nobody to
 * learn from in the team, so its pairs need outside help.
 */
export function suggestCrossTraining(
  doc: SkillsMatrix | null | undefined,
  columns: readonly SkillColumn[],
  coverage: readonly SkillCoverage[]
): TrainingSuggestion[] {
  const open = openTraining(doc);
  const learning = new Map<string, number>();
  const mentoring = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string | undefined) => {
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  };
  for (const p of open) {
    bump(learning, p.learnerId);
    bump(mentoring, p.mentorId);
  }
  const atRisk = coverage
    .map((c, order) => ({ c, order, reason: reasonOf(c) }))
    .filter((x): x is { c: SkillCoverage; order: number; reason: TrainingReason } => !!x.reason)
    .sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || a.order - b.order);

  const out: TrainingSuggestion[] = [];
  for (const { c, reason } of atRisk) {
    const toLevel: SkillTargetLevel = c.target === null ? CAPABLE_LEVEL : c.targetLevel;
    const need = c.target ?? DEFAULT_CAPABLE_PEOPLE;
    const have = c.target === null ? c.capable : c.atTarget;
    const pairs = open.filter((p) => p.skillId === c.skillId);
    let missing = need - have - pairs.filter((p) => p.toLevel >= toLevel).length;
    if (missing <= 0) continue;
    const busy = new Set(pairs.map((p) => p.learnerId));
    const rated = columns.map((col) => ({ col, level: ratingOf(doc, c.skillId, col) }));
    const learners = rated
      .filter(
        (r): r is { col: SkillColumn; level: SkillProficiency } =>
          r.col.onRoster && !busy.has(r.col.id) && r.level !== null && r.level < toLevel
      )
      .sort(
        (a, b) =>
          b.level - a.level ||
          (learning.get(a.col.id) ?? 0) - (learning.get(b.col.id) ?? 0) ||
          a.col.name.localeCompare(b.col.name)
      );
    for (const learner of learners) {
      if (missing <= 0) break;
      const mentor = rated
        .filter(
          (r): r is { col: SkillColumn; level: SkillProficiency } =>
            r.col.id !== learner.col.id && r.level !== null && r.level >= toLevel
        )
        .sort(
          (a, b) =>
            b.level - a.level ||
            (mentoring.get(a.col.id) ?? 0) - (mentoring.get(b.col.id) ?? 0) ||
            a.col.name.localeCompare(b.col.name)
        )[0];
      out.push({
        skillId: c.skillId,
        learnerId: learner.col.id,
        ...(mentor ? { mentorId: mentor.col.id } : {}),
        toLevel,
        from: learner.level,
        reason,
      });
      bump(learning, learner.col.id);
      bump(mentoring, mentor?.col.id);
      missing--;
    }
  }
  return out;
}

/** Whether the learner's rating has reached the pair's level (the page asks; it never ticks it). */
export function trainingReached(
  doc: SkillsMatrix | null | undefined,
  pair: SkillsTrainingPair,
  columns: readonly SkillColumn[]
): boolean {
  const column = columns.find((c) => c.id === pair.learnerId) ?? pair.learnerId;
  return (ratingOf(doc, pair.skillId, column) ?? -1) >= pair.toLevel;
}

/* ── The Team page's skill tags ─────────────────────────────────────── */

/**
 * Skills the team listed on the Team page (TeamMember.skills) that the
 * matrix has no row for, by name key, in the order first listed.
 */
export function rosterSkillsMissing(
  doc: SkillsMatrix | null | undefined,
  roster: readonly TeamMember[]
): string[] {
  const have = new Set((doc?.skills ?? []).map((s) => nameKey(s.name)));
  const out = new Map<string, string>();
  for (const m of roster) {
    for (const raw of m.skills ?? []) {
      const name = raw.trim();
      const key = nameKey(name);
      if (key && !have.has(key) && !out.has(key)) out.set(key, name.slice(0, SKILL_NAME_MAX));
    }
  }
  return Array.from(out.values());
}

/* ── Normalising and writing ────────────────────────────────────────── */

type Loose = Record<string, unknown>;

const isRecord = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The records in a stored list that have an id (and a name, when `named`), each id once. */
function entries(v: unknown, named: boolean): Loose[] {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : []).filter((x): x is Loose => {
    if (!isRecord(x) || typeof x.id !== "string" || x.id === "" || seen.has(x.id)) return false;
    if (named && typeof x.name !== "string") return false;
    seen.add(x.id);
    return true;
  });
}

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

const day = (v: unknown): string | undefined =>
  typeof v === "string" && isIsoDate(v) ? v.slice(0, 10) : undefined;

/** A copy of `obj` without `key` (an optional field cleared). */
function without<T extends object, K extends keyof T>(obj: T, key: K): T {
  const next = { ...obj };
  delete next[key];
  return next;
}

/**
 * A stored matrix as the page and agents read it: arrays always present,
 * levels clamped to 0-4, rows for deleted skills dropped, and an older
 * doc's 0s dropped (they were Not rated) so it reads as version 2. Every
 * write starts from this, so the first write upgrades the stored doc.
 */
export function normalizeSkillsMatrix(
  raw: SkillsMatrix | null | undefined,
  id: string = SKILLS_MATRIX_ID
): SkillsMatrix {
  if (!isRecord(raw)) return emptySkillsMatrix(id);
  const r = raw as unknown as Loose;
  const version = r.version === 2 ? 2 : undefined;
  const members: SkillsMatrixMember[] = entries(r.members, true).map((m) => {
    const description = text(m.description);
    return { id: m.id as string, name: m.name as string, ...(description ? { description } : {}) };
  });
  const skills: SkillsMatrixSkill[] = entries(r.skills, true).map((s) => {
    const description = text(s.description);
    const targetPeople = validTarget(s.targetPeople);
    return {
      id: s.id as string,
      name: s.name as string,
      ...(description ? { description } : {}),
      ...(targetPeople !== null ? { targetPeople } : {}),
      ...(isTargetLevel(s.targetLevel) ? { targetLevel: s.targetLevel } : {}),
    };
  });
  const skillIds = new Set(skills.map((s) => s.id));
  const grid: SkillsMatrixGrid = {};
  for (const [skillId, row] of Object.entries(isRecord(r.grid) ? r.grid : {})) {
    if (!skillIds.has(skillId) || !isRecord(row)) continue;
    const cells: Record<string, SkillProficiency> = {};
    for (const [columnId, value] of Object.entries(row)) {
      const level = storedLevel(version, value);
      if (level !== null) cells[columnId] = level;
    }
    grid[skillId] = cells;
  }
  const training: SkillsTrainingPair[] = entries(r.training, false)
    .filter(
      (p) =>
        typeof p.skillId === "string" &&
        skillIds.has(p.skillId) &&
        typeof p.learnerId === "string" &&
        p.learnerId !== ""
    )
    .map((p) => {
      const learnerId = p.learnerId as string;
      const mentorId = text(p.mentorId);
      const due = day(p.due);
      const doneAt = day(p.doneAt);
      return {
        id: p.id as string,
        skillId: p.skillId as string,
        learnerId,
        ...(mentorId && mentorId !== learnerId ? { mentorId } : {}),
        toLevel: isTargetLevel(p.toLevel) ? p.toLevel : CAPABLE_LEVEL,
        createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
        ...(due ? { due } : {}),
        ...(doneAt ? { doneAt } : {}),
      };
    });
  return { id, members, skills, grid, version: 2, training };
}

/**
 * Move the ratings of legacy members matched to roster members by name
 * onto the roster ids (a rating the roster id already has wins), point
 * their training pairs at the roster ids, and drop them from `members`.
 */
export function rekeyToRoster(doc: SkillsMatrix, columns: readonly SkillColumn[]): SkillsMatrix {
  const alias = new Map<string, string>();
  for (const c of columns) if (c.onRoster) for (const id of c.legacyIds) alias.set(id, c.id);
  if (alias.size === 0) return doc;
  const grid: SkillsMatrixGrid = {};
  for (const [skillId, row] of Object.entries(doc.grid)) {
    const next: Record<string, SkillProficiency> = {};
    for (const [columnId, level] of Object.entries(row)) {
      if (!alias.has(columnId)) next[columnId] = level;
    }
    for (const [legacyId, rosterId] of Array.from(alias)) {
      if (next[rosterId] === undefined && row[legacyId] !== undefined) {
        next[rosterId] = row[legacyId];
      }
    }
    grid[skillId] = next;
  }
  const re = (id: string) => alias.get(id) ?? id;
  return {
    ...doc,
    members: doc.members.filter((m) => !alias.has(m.id)),
    grid,
    training: (doc.training ?? []).map((p) => {
      const learnerId = re(p.learnerId);
      const mentorId = p.mentorId ? re(p.mentorId) : undefined;
      const base = without({ ...p, learnerId }, "mentorId");
      return mentorId && mentorId !== learnerId ? { ...base, mentorId } : base;
    }),
  };
}

/** The doc with one cell set; null clears it back to Not rated. */
export function withRating(
  doc: SkillsMatrix,
  skillId: string,
  columnId: string,
  level: SkillProficiency | null
): SkillsMatrix {
  const row = { ...(doc.grid[skillId] ?? {}) };
  if (level === null) delete row[columnId];
  else row[columnId] = level;
  return { ...doc, version: 2, grid: { ...doc.grid, [skillId]: row } };
}

/** Why a skill name can't be saved, or null. `exceptId`: the skill being renamed. */
export function skillNameError(
  name: string,
  doc: SkillsMatrix | null | undefined,
  exceptId?: string
): string | null {
  const clean = name.trim();
  if (!clean) return "Name the skill.";
  if (clean.length > SKILL_NAME_MAX) return `Keep it to ${SKILL_NAME_MAX} characters.`;
  const key = nameKey(clean);
  const twin = (doc?.skills ?? []).find((s) => s.id !== exceptId && nameKey(s.name) === key);
  return twin ? `“${twin.name}” is already on the matrix.` : null;
}

/**
 * Why a target can't be set, or null. Unset is fine (no target). It can't
 * ask for more people than the team has, when the team has people.
 */
export function targetPeopleError(
  people: number | null | undefined,
  teamSize: number
): string | null {
  if (people === null || people === undefined) return null;
  if (!Number.isInteger(people) || people < 1) return "A whole number of people, 1 or more.";
  if (people > TARGET_PEOPLE_MAX) return `At most ${TARGET_PEOPLE_MAX} people.`;
  if (teamSize > 0 && people > teamSize) {
    return `The team has ${teamSize === 1 ? "1 person" : `${teamSize} people`}.`;
  }
  return null;
}

export interface NewSkill {
  name: string;
  description?: string;
  targetPeople?: number;
  targetLevel?: SkillTargetLevel;
}

/** A skill record from checked values (blank optional fields stay unset). */
export function newSkill(values: NewSkill, id: string): SkillsMatrixSkill {
  const description = values.description?.trim();
  return {
    id,
    name: values.name.trim(),
    ...(description ? { description } : {}),
    ...(values.targetPeople !== undefined ? { targetPeople: values.targetPeople } : {}),
    ...(values.targetLevel !== undefined ? { targetLevel: values.targetLevel } : {}),
  };
}

/** The doc with `skill` added at `index` (the end by default) and an empty row. */
export function withSkill(
  doc: SkillsMatrix,
  skill: SkillsMatrixSkill,
  index?: number
): SkillsMatrix {
  if (doc.skills.some((s) => s.id === skill.id)) return doc;
  const skills = [...doc.skills];
  skills.splice(index === undefined ? skills.length : Math.min(index, skills.length), 0, skill);
  return {
    ...doc,
    version: 2,
    skills,
    grid: { ...doc.grid, [skill.id]: doc.grid[skill.id] ?? {} },
  };
}

export interface SkillPatch {
  name?: string;
  description?: string | null;
  targetPeople?: number | null;
  targetLevel?: SkillTargetLevel | null;
}

/** The doc with one skill edited; null clears an optional field. */
export function withSkillPatch(
  doc: SkillsMatrix,
  skillId: string,
  patch: SkillPatch
): SkillsMatrix {
  return {
    ...doc,
    skills: doc.skills.map((s) => {
      if (s.id !== skillId) return s;
      let next: SkillsMatrixSkill = { ...s };
      if (patch.name !== undefined) next.name = patch.name.trim();
      if ("description" in patch) {
        const description = patch.description?.trim();
        next = description ? { ...next, description } : without(next, "description");
      }
      if ("targetPeople" in patch) {
        const people = validTarget(patch.targetPeople);
        next = people !== null ? { ...next, targetPeople: people } : without(next, "targetPeople");
      }
      if ("targetLevel" in patch) {
        next = isTargetLevel(patch.targetLevel)
          ? { ...next, targetLevel: patch.targetLevel }
          : without(next, "targetLevel");
      }
      return next;
    }),
  };
}

/** What removing a skill takes with it, so Undo can put it all back. */
export interface RemovedSkill {
  skill: SkillsMatrixSkill;
  index: number;
  row: Record<string, SkillProficiency>;
  training: SkillsTrainingPair[];
}

/** The doc without a skill, its row and its training pairs; null when it isn't there. */
export function withoutSkill(
  doc: SkillsMatrix,
  skillId: string
): { doc: SkillsMatrix; removed: RemovedSkill } | null {
  const index = doc.skills.findIndex((s) => s.id === skillId);
  if (index < 0) return null;
  const grid = { ...doc.grid };
  const row = grid[skillId] ?? {};
  delete grid[skillId];
  return {
    doc: {
      ...doc,
      skills: doc.skills.filter((s) => s.id !== skillId),
      grid,
      training: (doc.training ?? []).filter((p) => p.skillId !== skillId),
    },
    removed: {
      skill: doc.skills[index],
      index,
      row,
      training: (doc.training ?? []).filter((p) => p.skillId === skillId),
    },
  };
}

/** Undo for `withoutSkill`: the skill back in its place, keeping edits made since. */
export function restoreSkill(doc: SkillsMatrix, removed: RemovedSkill): SkillsMatrix {
  if (doc.skills.some((s) => s.id === removed.skill.id)) return doc;
  const back = withSkill(doc, removed.skill, removed.index);
  const have = new Set((back.training ?? []).map((p) => p.id));
  return {
    ...back,
    grid: { ...back.grid, [removed.skill.id]: { ...removed.row } },
    training: [...(back.training ?? []), ...removed.training.filter((p) => !have.has(p.id))],
  };
}

/** What removing a matrix-only person takes with it. */
export interface RemovedColumn {
  member: SkillsMatrixMember;
  index: number;
  cells: Record<string, SkillProficiency>;
  training: SkillsTrainingPair[];
}

/**
 * The doc without a legacy (matrix-only) person: their column, ratings and
 * the pairs they learn in; pairs they mentor go back to outside help. Null
 * for anyone else (roster people are removed on the Team page).
 */
export function withoutColumn(
  doc: SkillsMatrix,
  columnId: string
): { doc: SkillsMatrix; removed: RemovedColumn } | null {
  const index = doc.members.findIndex((m) => m.id === columnId);
  if (index < 0) return null;
  const cells: Record<string, SkillProficiency> = {};
  const grid: SkillsMatrixGrid = {};
  for (const [skillId, row] of Object.entries(doc.grid)) {
    const { [columnId]: level, ...rest } = row;
    if (level !== undefined) cells[skillId] = level;
    grid[skillId] = rest;
  }
  const training = doc.training ?? [];
  return {
    doc: {
      ...doc,
      members: doc.members.filter((m) => m.id !== columnId),
      grid,
      training: training
        .filter((p) => p.learnerId !== columnId)
        .map((p) => (p.mentorId === columnId ? without(p, "mentorId") : p)),
    },
    removed: {
      member: doc.members[index],
      index,
      cells,
      training: training.filter((p) => p.learnerId === columnId || p.mentorId === columnId),
    },
  };
}

/** Undo for `withoutColumn`. */
export function restoreColumn(doc: SkillsMatrix, removed: RemovedColumn): SkillsMatrix {
  if (doc.members.some((m) => m.id === removed.member.id)) return doc;
  const members = [...doc.members];
  members.splice(Math.min(removed.index, members.length), 0, removed.member);
  const grid: SkillsMatrixGrid = { ...doc.grid };
  for (const [skillId, level] of Object.entries(removed.cells)) {
    if (grid[skillId]) grid[skillId] = { ...grid[skillId], [removed.member.id]: level };
  }
  const back = new Map(removed.training.map((p) => [p.id, p]));
  const training = (doc.training ?? [])
    .filter((p) => !back.has(p.id))
    .concat(removed.training.filter((p) => grid[p.skillId] !== undefined));
  return { ...doc, members, grid, training };
}

/* ── Training pairs ─────────────────────────────────────────────────── */

export interface NewTrainingPair {
  skillId: string;
  learnerId: string;
  mentorId?: string;
  toLevel: SkillTargetLevel;
  due?: string;
}

/**
 * Why a pair can't be saved, or null: the skill and learner must be on the
 * matrix, the mentor (optional) someone else on it, the due day a real day,
 * and the learner not already learning the skill in an open pair.
 */
export function trainingError(
  values: NewTrainingPair,
  doc: SkillsMatrix | null | undefined,
  columns: readonly SkillColumn[]
): string | null {
  if (!(doc?.skills ?? []).some((s) => s.id === values.skillId))
    return "Pick a skill on the matrix.";
  if (!columns.some((c) => c.id === values.learnerId)) return "Pick a learner on the team.";
  if (values.mentorId !== undefined) {
    if (!columns.some((c) => c.id === values.mentorId)) return "Pick a mentor on the team.";
    if (values.mentorId === values.learnerId) return "The mentor can't be the learner.";
  }
  if (!isTargetLevel(values.toLevel)) return "Pick the level to reach.";
  if (values.due !== undefined && !isIsoDate(values.due))
    return "Pick a due day, or leave it empty.";
  const already = openTraining(doc).some(
    (p) => p.skillId === values.skillId && p.learnerId === values.learnerId
  );
  return already ? "They're already learning this skill in the plan." : null;
}

export function newTrainingPair(
  values: NewTrainingPair,
  id: string,
  createdAt: string
): SkillsTrainingPair {
  return {
    id,
    skillId: values.skillId,
    learnerId: values.learnerId,
    ...(values.mentorId ? { mentorId: values.mentorId } : {}),
    toLevel: values.toLevel,
    createdAt,
    ...(values.due ? { due: values.due } : {}),
  };
}

export function withTraining(doc: SkillsMatrix, pair: SkillsTrainingPair): SkillsMatrix {
  if ((doc.training ?? []).some((p) => p.id === pair.id)) return doc;
  return { ...doc, training: [...(doc.training ?? []), pair] };
}

export interface TrainingPatch {
  mentorId?: string | null;
  toLevel?: SkillTargetLevel;
  due?: string | null;
  doneAt?: string | null;
}

/** The doc with one pair edited; null clears an optional field (doneAt: null reopens it). */
export function withTrainingPatch(
  doc: SkillsMatrix,
  id: string,
  patch: TrainingPatch
): SkillsMatrix {
  return {
    ...doc,
    training: (doc.training ?? []).map((p) => {
      if (p.id !== id) return p;
      let next: SkillsTrainingPair = { ...p };
      if (isTargetLevel(patch.toLevel)) next.toLevel = patch.toLevel;
      for (const key of ["mentorId", "due", "doneAt"] as const) {
        if (!(key in patch)) continue;
        const v = patch[key];
        if (v) next = { ...next, [key]: v };
        else next = without(next, key);
      }
      if (next.mentorId === next.learnerId) next = without(next, "mentorId");
      return next;
    }),
  };
}

export function withoutTraining(doc: SkillsMatrix, id: string): SkillsMatrix {
  return { ...doc, training: (doc.training ?? []).filter((p) => p.id !== id) };
}

/* ── The verdict ────────────────────────────────────────────────────── */

const skillsWord = (n: number) => (n === 1 ? "1 skill" : `${n} skills`);

/**
 * The one sentence above the matrix: which skills hang on one person (and
 * on whom), which have nobody, and how many meet their target.
 */
export function skillsVerdict(
  coverage: readonly SkillCoverage[],
  columns: readonly SkillColumn[]
): string {
  if (coverage.length === 0) return "No skills yet: add the skills the team depends on.";
  if (columns.length === 0) {
    return "Nobody to rate yet: add your team on the Team page, then rate each person.";
  }
  const counts = coverage.reduce((n, c) => n + c.unrated, 0);
  const rated = coverage.length * columns.length - counts;
  if (rated === 0) return `Nobody is rated yet on ${skillsWord(coverage.length)}.`;
  const parts: string[] = [];
  const spofs = coverage.filter((c) => c.spof);
  if (spofs.length > 0) {
    const named = spofs
      .slice(0, 3)
      .map((c) => `${c.name}: ${c.holders[0]}`)
      .join("; ");
    const more = spofs.length > 3 ? `; ${spofs.length - 3} more` : "";
    parts.push(
      `${skillsWord(spofs.length)} ${spofs.length === 1 ? "depends" : "depend"} on one person (${named}${more})`
    );
  }
  const gaps = coverage.filter((c) => c.gap).length;
  if (gaps > 0) {
    parts.push(
      `${skillsWord(gaps)} ${gaps === 1 ? "has" : "have"} nobody at Intermediate or above`
    );
  }
  const withTarget = coverage.filter((c) => c.target !== null);
  if (withTarget.length > 0) {
    const met = withTarget.filter((c) => c.meetsTarget).length;
    parts.push(`${met} of ${skillsWord(withTarget.length)} meet their target`);
  }
  if (parts.length === 0 || (spofs.length === 0 && gaps === 0)) {
    parts.unshift(
      coverage.length === 1
        ? "The skill has at least two people at Intermediate or above"
        : `Every skill has at least two people at Intermediate or above`
    );
  }
  // The counts are only "so far" while someone is still Not rated.
  if (counts > 0) parts.push(`${counts === 1 ? "1 rating" : `${counts} ratings`} still missing`);
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
