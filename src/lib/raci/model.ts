/**
 * The RACI matrix: who is Responsible, Accountable, Consulted or Informed
 * for each of the team's activities. One workspace document (RACI_ID) that
 * the RACI page and tool.raci.* read and write through these functions, so
 * a person and an agent see the same checks.
 *
 * Pure and server-safe: no React, nothing from components. The one thing
 * that touches the browser is `hasLegacyRaci`, the cheap check for the
 * tool's old local store, which takes the storage as a parameter.
 *
 *   - A cell holds letters, normalised to [], [R], [A], [A, R], [C] or [I]:
 *     the one Accountable can also do the work, but someone consulted or
 *     informed isn't also doing it.
 *   - The per-activity checks count letters as sets, so A/R counts as an A
 *     and an R. An activity nobody is assigned to yet isn't an error: it is
 *     listed as not assigned.
 *   - The load checks are rules of thumb (RACI_LOAD), quoted on the page.
 */

import type { RaciActivity, RaciLetter, RaciMatrix, RaciRole } from "@/lib/stores/workspace-types";
import { RACI_ID, RACI_KIND } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";

export { RACI_ID, RACI_KIND };

/** The tool's old local-only store (a zustand persist blob), moved into the workspace once. */
export const RACI_LEGACY_KEY = "agile-toolkit:raci";
/** `navigator.locks` name, so two tabs never move it at the same time. */
export const RACI_MIGRATION_LOCK = "agile-toolkit:raci-migration";

/**
 * Rules of thumb for the load checks:
 *   - one role Accountable for more than half the activities (from four
 *     activities on: with three, one A each is fine) is a bottleneck;
 *   - an activity consulting more than three roles turns into a meeting.
 */
export const RACI_LOAD = {
  maxAccountableShare: 0.5,
  minActivitiesForShare: 4,
  maxConsulted: 3,
} as const;

export const RACI_LETTERS: readonly RaciLetter[] = ["R", "A", "C", "I"];

export const RACI_LETTER_NAME: Record<RaciLetter, string> = {
  R: "Responsible",
  A: "Accountable",
  C: "Consulted",
  I: "Informed",
};

export const RACI_NAME_MAX = 80;
export const RACI_DESCRIPTION_MAX = 500;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const isLetter = (v: unknown): v is RaciLetter =>
  typeof v === "string" && (RACI_LETTERS as readonly string[]).includes(v);

/** A matrix with nothing in it. */
export function emptyRaci(): RaciMatrix {
  return { id: RACI_ID, roles: [], activities: [], cells: {} };
}

/**
 * A cell's letters in the normal form: [], [R], [A], [A, R], [C] or [I].
 * Reads the old single-letter value ("A"), a joined one ("A/R"), or an
 * array. R and A win over C and I; C wins over I.
 */
export function normalizeCell(raw: unknown): RaciLetter[] {
  const parts: unknown[] =
    typeof raw === "string"
      ? raw.toUpperCase().split(/[^RACI]*/)
      : Array.isArray(raw)
        ? raw.map((v) => (typeof v === "string" ? v.toUpperCase() : v))
        : [];
  const set = new Set(parts.filter(isLetter));
  if (set.has("A") || set.has("R")) return (["A", "R"] as const).filter((l) => set.has(l));
  if (set.has("C")) return ["C"];
  if (set.has("I")) return ["I"];
  return [];
}

/** The cell's letters joined for reading: "A/R", "C", or "" for none. */
export const cellText = (letters: readonly RaciLetter[]): string => letters.join("/");

/** "Accountable and Responsible", "Consulted", or "Not assigned". */
export function cellWords(letters: readonly RaciLetter[]): string {
  if (letters.length === 0) return "Not assigned";
  return letters.map((l) => RACI_LETTER_NAME[l]).join(" and ");
}

function normalizeRow<T extends RaciRole | RaciActivity>(raw: unknown, fallback: string): T | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallback;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const memberId = typeof raw.memberId === "string" && raw.memberId ? raw.memberId : "";
  return {
    id: raw.id,
    name,
    ...(description ? { description } : {}),
    ...(memberId ? { memberId } : {}),
  } as T;
}

function uniqueById<T extends { id: string }>(rows: (T | null)[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r): r is T => {
    if (!r || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/**
 * A stored matrix in a usable shape: the workspace document, the old local
 * store (zustand's `{state: {roles, activities, matrix}, version}`, or its
 * state alone) with one letter per cell, or anything an agent wrote. Cells
 * for rows or columns that don't exist, and empty cells, are dropped.
 */
export function normalizeRaci(raw: unknown): RaciMatrix {
  const r = isRecord(raw) && isRecord(raw.state) ? raw.state : raw;
  if (!isRecord(r)) return emptyRaci();
  const roles = uniqueById(
    (Array.isArray(r.roles) ? r.roles : []).map((x) => normalizeRow<RaciRole>(x, "Unnamed role"))
  );
  // An activity has no person: a stray memberId on one is dropped.
  const activities = uniqueById(
    (Array.isArray(r.activities) ? r.activities : []).map((x) => {
      const a = normalizeRow<RaciActivity & { memberId?: string }>(x, "Unnamed activity");
      if (!a) return null;
      const { memberId, ...rest } = a;
      void memberId;
      return rest as RaciActivity;
    })
  );
  const source = isRecord(r.cells) ? r.cells : isRecord(r.matrix) ? r.matrix : {};
  const roleIds = new Set(roles.map((x) => x.id));
  const cells: RaciMatrix["cells"] = {};
  for (const a of activities) {
    const row = source[a.id];
    if (!isRecord(row)) continue;
    for (const [roleId, value] of Object.entries(row)) {
      if (!roleIds.has(roleId)) continue;
      const letters = normalizeCell(value);
      if (letters.length === 0) continue;
      (cells[a.id] ??= {})[roleId] = letters;
    }
  }
  return { id: RACI_ID, roles, activities, cells };
}

/** One cell's letters. */
export function cellOf(doc: RaciMatrix, activityId: string, roleId: string): RaciLetter[] {
  return doc.cells[activityId]?.[roleId] ?? [];
}

/** Whether anyone is assigned anything. */
export const hasAssignments = (doc: RaciMatrix): boolean =>
  Object.values(doc.cells).some((row) => Object.values(row).some((l) => l.length > 0));

/* ── Editing (pure, shared by the page and the agent) ───────────────── */

/** `doc` with one cell set (normalised; an empty cell is removed). */
export function withCell(
  doc: RaciMatrix,
  activityId: string,
  roleId: string,
  letters: readonly unknown[] | string
): RaciMatrix {
  const next = normalizeCell(letters);
  const row = { ...(doc.cells[activityId] ?? {}) };
  if (next.length === 0) delete row[roleId];
  else row[roleId] = next;
  const cells = { ...doc.cells };
  if (Object.keys(row).length === 0) delete cells[activityId];
  else cells[activityId] = row;
  return { ...doc, cells };
}

/**
 * The cell after one letter's chip is pressed: R and A toggle together
 * (A/R is one person accountable and doing it), and C or I replace
 * whatever was there, since someone consulted isn't doing the work.
 */
export function toggleLetter(current: readonly RaciLetter[], letter: RaciLetter): RaciLetter[] {
  const has = current.includes(letter);
  if (letter === "C" || letter === "I") return has ? [] : [letter];
  const ar = current.filter((l) => l === "A" || l === "R");
  return normalizeCell(has ? ar.filter((l) => l !== letter) : [...ar, letter]);
}

export const withRole = (doc: RaciMatrix, role: RaciRole): RaciMatrix => ({
  ...doc,
  roles: [...doc.roles, role],
});

export const withActivity = (doc: RaciMatrix, activity: RaciActivity): RaciMatrix => ({
  ...doc,
  activities: [...doc.activities, activity],
});

/** `doc` without a role and its column's cells. */
export function withoutRole(doc: RaciMatrix, roleId: string): RaciMatrix {
  const cells: RaciMatrix["cells"] = {};
  for (const [activityId, row] of Object.entries(doc.cells)) {
    const { [roleId]: gone, ...rest } = row;
    void gone;
    if (Object.keys(rest).length > 0) cells[activityId] = rest;
  }
  return { ...doc, roles: doc.roles.filter((r) => r.id !== roleId), cells };
}

/** `doc` without an activity and its row's cells. */
export function withoutActivity(doc: RaciMatrix, activityId: string): RaciMatrix {
  const { [activityId]: gone, ...cells } = doc.cells;
  void gone;
  return { ...doc, activities: doc.activities.filter((a) => a.id !== activityId), cells };
}

/** A role's column, for an Undo: where it was and its cells. */
export interface RemovedRole {
  role: RaciRole;
  index: number;
  cells: Record<string, RaciLetter[]>;
}

export function removedRole(doc: RaciMatrix, roleId: string): RemovedRole | null {
  const index = doc.roles.findIndex((r) => r.id === roleId);
  if (index < 0) return null;
  const cells: Record<string, RaciLetter[]> = {};
  for (const [activityId, row] of Object.entries(doc.cells)) {
    if (row[roleId]?.length) cells[activityId] = row[roleId];
  }
  return { role: doc.roles[index], index, cells };
}

/** Put a removed column back where it was, with its cells (cells set since are kept). */
export function restoreRole(doc: RaciMatrix, removed: RemovedRole): RaciMatrix {
  if (doc.roles.some((r) => r.id === removed.role.id)) return doc;
  const roles = [...doc.roles];
  roles.splice(Math.min(removed.index, roles.length), 0, removed.role);
  let next: RaciMatrix = { ...doc, roles };
  for (const [activityId, letters] of Object.entries(removed.cells)) {
    if (!next.activities.some((a) => a.id === activityId)) continue;
    if (cellOf(next, activityId, removed.role.id).length === 0) {
      next = withCell(next, activityId, removed.role.id, letters);
    }
  }
  return next;
}

/** An activity's row, for an Undo. */
export interface RemovedActivity {
  activity: RaciActivity;
  index: number;
  cells: Record<string, RaciLetter[]>;
}

export function removedActivity(doc: RaciMatrix, activityId: string): RemovedActivity | null {
  const index = doc.activities.findIndex((a) => a.id === activityId);
  if (index < 0) return null;
  return { activity: doc.activities[index], index, cells: { ...(doc.cells[activityId] ?? {}) } };
}

export function restoreActivity(doc: RaciMatrix, removed: RemovedActivity): RaciMatrix {
  if (doc.activities.some((a) => a.id === removed.activity.id)) return doc;
  const activities = [...doc.activities];
  activities.splice(Math.min(removed.index, activities.length), 0, removed.activity);
  let next: RaciMatrix = { ...doc, activities };
  for (const [roleId, letters] of Object.entries(removed.cells)) {
    if (next.roles.some((r) => r.id === roleId)) {
      next = withCell(next, removed.activity.id, roleId, letters);
    }
  }
  return next;
}

/** Whether a name is already a role (or an activity) in the list, by name key. */
export const nameTaken = (rows: readonly { name: string }[], name: string): boolean =>
  rows.some((r) => nameKey(r.name) === nameKey(name));

/* ── Checks ─────────────────────────────────────────────────────────── */

export type ActivityIssueKind = "no_a" | "many_a" | "no_r";

export interface ActivityIssue {
  kind: ActivityIssueKind;
  activityId: string;
  /** What's wrong: "“Release” has no Accountable (A)". */
  summary: string;
  /** The summary with what to do about it. */
  message: string;
}

/** An issue or warning from its summary and the advice that follows it. */
const said = (summary: string, advice: string) => ({ summary, message: `${summary}: ${advice}.` });

/** "a, b and c". */
function listAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The activities nobody is assigned to yet (not an error: not started). */
export function unassignedActivities(doc: RaciMatrix): RaciActivity[] {
  return doc.activities.filter((a) => doc.roles.every((r) => cellOf(doc, a.id, r.id).length === 0));
}

/**
 * Each assigned activity's problems: no Accountable, more than one, or
 * nobody Responsible. Letters count as sets, so an A/R is both.
 */
export function activityIssues(doc: RaciMatrix): ActivityIssue[] {
  const issues: ActivityIssue[] = [];
  const unassigned = new Set(unassignedActivities(doc).map((a) => a.id));
  for (const a of doc.activities) {
    if (unassigned.has(a.id)) continue;
    const accountable = doc.roles.filter((r) => cellOf(doc, a.id, r.id).includes("A"));
    const responsible = doc.roles.filter((r) => cellOf(doc, a.id, r.id).includes("R"));
    if (accountable.length === 0) {
      issues.push({
        kind: "no_a",
        activityId: a.id,
        ...said(`“${a.name}” has no Accountable (A)`, "pick the one person who answers for it"),
      });
    } else if (accountable.length > 1) {
      issues.push({
        kind: "many_a",
        activityId: a.id,
        ...said(
          `“${a.name}” has ${accountable.length} Accountable (${listAnd(accountable.map((r) => r.name))})`,
          "keep one"
        ),
      });
    }
    if (responsible.length === 0) {
      issues.push({
        kind: "no_r",
        activityId: a.id,
        ...said(`“${a.name}” has no Responsible (R)`, "someone has to do the work"),
      });
    }
  }
  return issues;
}

export type LoadWarningKind = "accountable_load" | "consulted_load";

export interface LoadWarning {
  kind: LoadWarningKind;
  roleId?: string;
  activityId?: string;
  /** accountable_load: the activities the role is Accountable for, in matrix order. */
  activityIds?: string[];
  count: number;
  of: number;
  summary: string;
  message: string;
}

/** How many activities a load warning names before "and N more". */
const LOAD_NAMES_SHOWN = 3;

/** Activities named in a sentence: “a”, “b”, “c” and 2 more. */
function namedActivities(activities: readonly RaciActivity[]): string {
  const shown = activities.slice(0, LOAD_NAMES_SHOWN).map((a) => `“${a.name}”`);
  const more = activities.length - shown.length;
  return listAnd(more > 0 ? [...shown, `${more} more`] : shown);
}

/**
 * Where the matrix piles too much on one place (RACI_LOAD): a role
 * Accountable for more than half of four or more activities (naming them,
 * so the team sees what to share out), and an activity that consults more
 * than three roles.
 */
export function loadWarnings(doc: RaciMatrix): LoadWarning[] {
  const warnings: LoadWarning[] = [];
  const n = doc.activities.length;
  if (n >= RACI_LOAD.minActivitiesForShare) {
    for (const role of doc.roles) {
      const held = doc.activities.filter((a) => cellOf(doc, a.id, role.id).includes("A"));
      const count = held.length;
      if (count / n > RACI_LOAD.maxAccountableShare) {
        warnings.push({
          kind: "accountable_load",
          roleId: role.id,
          activityIds: held.map((a) => a.id),
          count,
          of: n,
          ...said(
            `${role.name} is Accountable for ${count} of ${n} activities (${namedActivities(held)})`,
            "share some of it out"
          ),
        });
      }
    }
  }
  for (const a of doc.activities) {
    const count = doc.roles.filter((r) => cellOf(doc, a.id, r.id).includes("C")).length;
    if (count > RACI_LOAD.maxConsulted) {
      warnings.push({
        kind: "consulted_load",
        activityId: a.id,
        count,
        of: doc.roles.length,
        ...said(`“${a.name}” consults ${count} roles`, "every C is a conversation, so ask fewer"),
      });
    }
  }
  return warnings;
}

export interface RoleCounts {
  roleId: string;
  name: string;
  memberId?: string;
  R: number;
  A: number;
  C: number;
  I: number;
}

/** How many of each letter every role holds. */
export function countsByRole(doc: RaciMatrix): RoleCounts[] {
  return doc.roles.map((role) => {
    const counts: RoleCounts = {
      roleId: role.id,
      name: role.name,
      ...(role.memberId ? { memberId: role.memberId } : {}),
      R: 0,
      A: 0,
      C: 0,
      I: 0,
    };
    for (const a of doc.activities) for (const l of cellOf(doc, a.id, role.id)) counts[l] += 1;
    return counts;
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-sentence answer above the matrix: whether every assigned
 * activity has one Accountable and someone Responsible, and the first
 * thing to fix or to watch.
 *
 *   "7 activities, each with one Accountable and someone Responsible;
 *    Sam is Accountable for 5 of 7 activities: share some of it out."
 */
export function raciVerdict(doc: RaciMatrix): string {
  const n = doc.activities.length;
  if (n === 0 && doc.roles.length === 0) return "No activities or roles yet.";
  if (n === 0) return `${plural(doc.roles.length, "role")}, no activities yet.`;
  if (doc.roles.length === 0) return `${plural(n, "activity", "activities")}, no roles yet.`;
  if (!hasAssignments(doc)) {
    return `${plural(n, "activity", "activities")} and ${plural(doc.roles.length, "role")}, nothing assigned yet.`;
  }
  const issues = activityIssues(doc);
  const warnings = loadWarnings(doc);
  const unassigned = unassignedActivities(doc).length;
  const withIssue = new Set(issues.map((i) => i.activityId)).size;
  const assigned = n - unassigned;
  const ok = assigned - withIssue;
  const head =
    withIssue === 0
      ? assigned === 1
        ? `The assigned activity has one Accountable and someone Responsible`
        : `${assigned === n ? `${plural(n, "activity", "activities")}, each` : `${assigned} assigned activities, each`} with one Accountable and someone Responsible`
      : `${ok} of ${plural(assigned, "assigned activity", "assigned activities")} ${ok === 1 ? "has" : "have"} one Accountable and someone Responsible`;
  const parts = [head];
  if (unassigned > 0 && withIssue === 0) {
    parts[0] += ` (${plural(unassigned, "activity", "activities")} not assigned yet)`;
  }
  const first = issues[0] ?? warnings[0];
  if (first) parts.push(first.summary);
  return `${parts.join("; ")}.`;
}

/* ── The old local store ────────────────────────────────────────────── */

const DEFAULT_ROLE_NAMES = ["product owner", "scrum master", "dev team"];
const DEFAULT_ACTIVITY_NAMES = ["backlog refinement", "sprint planning", "daily standup"];

/**
 * Whether the old store holds only the defaults it seeded (three roles,
 * three activities, nothing assigned, no descriptions): those are not the
 * team's data, so the move skips them.
 */
export function isUntouchedDefault(doc: RaciMatrix): boolean {
  const names = (rows: readonly { name: string; description?: string }[]) =>
    rows.every((r) => !r.description) ? rows.map((r) => nameKey(r.name)) : null;
  return (
    !hasAssignments(doc) &&
    JSON.stringify(names(doc.roles)) === JSON.stringify(DEFAULT_ROLE_NAMES) &&
    JSON.stringify(names(doc.activities)) === JSON.stringify(DEFAULT_ACTIVITY_NAMES)
  );
}

/**
 * What the one-time move writes: the old store's matrix, unless the
 * workspace already has one (never overwritten), the old store can't be
 * read, or it holds only its untouched defaults. Null: nothing to write.
 */
export function planRaciMove(
  raw: string | undefined,
  existing: RaciMatrix | undefined
): RaciMatrix | null {
  if (raw === undefined || existing) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const doc = normalizeRaci(parsed);
  if (doc.roles.length === 0 && doc.activities.length === 0) return null;
  if (isUntouchedDefault(doc)) return null;
  return doc;
}

/** Cheap synchronous check: is the old store still in this browser? */
export function hasLegacyRaci(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store =
      storage === undefined
        ? typeof window === "undefined"
          ? null
          : window.localStorage
        : storage;
    return Boolean(store && store.getItem(RACI_LEGACY_KEY) !== null);
  } catch {
    return false;
  }
}
