/**
 * Team stability: who was in each finished sprint against the sprint
 * before, so a team can see when it changed (people joined or left) and
 * read its numbers from before the change with care. Forecasts and the mix
 * of work lean on stable teams; this says when that held, never why it
 * changed.
 *
 * Who was in a sprint: the sprint's own Capacity Planner plan when it has
 * one (`perSprint`), else the owners of its stories (rough: someone who
 * owned no story doesn't show). A pair of sprints compares plans only when
 * both have their own; otherwise both sides use the owners and the row says
 * so (`source: "owners"`, `rough`). People are matched by roster id
 * (`teamMemberId`) when both sides have one, else by name (`nameKey`).
 *
 * Pure and server-safe (the agent actions and the next steps read it).
 */

import type { CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { findCapacityPlan } from "@/lib/sprints/capacity";
import { sprintsByEndDate } from "@/lib/sprints/metrics";
import { nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import { storyItems } from "./items";

/** The finished sprints, oldest first by end date (examples only when asked for). */
export function finishedSprints(sprints: readonly Sprint[], includeExamples = false): Sprint[] {
  const list: unknown = sprints;
  if (!Array.isArray(list)) return [];
  return sprintsByEndDate(
    (list as Sprint[]).filter(
      (s) =>
        Boolean(s) &&
        typeof s.id === "string" &&
        s.status === "completed" &&
        (includeExamples || !isExampleId(s.id))
    )
  );
}

/** One person in a sprint. */
interface Person {
  name: string;
  key: string;
  memberId?: string;
}

/** One finished sprint against the one before. */
export interface StabilityRow {
  sprintId: string;
  name: string;
  endDate: string | null;
  /** People in this sprint. */
  people: number;
  /** In both this sprint and the one before (0 for the first sprint). */
  stayed: number;
  /** Names new since the sprint before (empty for the first sprint). */
  joined: string[];
  /** Names gone since the sprint before. */
  left: string[];
  /**
   * People in both sprints over people in either, a whole-number percent;
   * null for the first sprint, or when neither sprint shows anyone.
   */
  pct: number | null;
  /** Where the people came from: both sprints' own capacity plans, or the story owners. */
  source: "capacity" | "owners";
  /** Owners only: someone who owned no story doesn't show. */
  rough: boolean;
  /** The sprint's completed points, as recorded on it. */
  pointsCompleted: number | null;
}

export interface TeamStability {
  /** Oldest first, one per finished sprint. */
  rows: StabilityRow[];
  /** The latest row where someone joined or left, or null. */
  lastChange: StabilityRow | null;
}

function capacityPeople(
  plans: readonly CapacityPlan[] | undefined,
  sprintId: string
): Person[] | null {
  const found = findCapacityPlan(plans, sprintId);
  if (!found || !found.perSprint) return null;
  const members: unknown = found.plan.members;
  if (!Array.isArray(members)) return [];
  return dedupe(
    members.flatMap((m) => {
      if (!m || typeof m !== "object") return [];
      const name = typeof m.name === "string" ? m.name.trim() : "";
      const memberId =
        typeof m.teamMemberId === "string" && m.teamMemberId ? m.teamMemberId : undefined;
      const key = nameKey(name);
      if (!key && !memberId) return [];
      return [{ name: name || "Someone", key, ...(memberId ? { memberId } : {}) }];
    })
  );
}

function ownerPeople(
  stories: readonly Story[],
  sprint: Sprint,
  includeExamples: boolean
): Person[] {
  return dedupe(
    storyItems(stories, { sprint, includeExamples }).flatMap((it) => {
      const name = it.owner?.trim() ?? "";
      const key = nameKey(name);
      return key ? [{ name, key }] : [];
    })
  );
}

/** Each person once (by roster id, else by name). */
function dedupe(people: Person[]): Person[] {
  const out: Person[] = [];
  for (const p of people) if (!out.some((q) => samePerson(p, q))) out.push(p);
  return out;
}

function samePerson(a: Person, b: Person): boolean {
  if (a.memberId && b.memberId) return a.memberId === b.memberId;
  return a.key !== "" && a.key === b.key;
}

/**
 * Who was in each finished sprint (examples only when asked for), against
 * the sprint before, oldest first, with the latest change.
 */
export function teamStability(
  sprints: readonly Sprint[],
  plans: readonly CapacityPlan[] | undefined,
  stories: readonly Story[],
  { includeExamples = false }: { includeExamples?: boolean } = {}
): TeamStability {
  const finished = finishedSprints(sprints, includeExamples);
  const rows: StabilityRow[] = [];
  let prev: { sprint: Sprint; cap: Person[] | null; owners: Person[] } | null = null;
  for (const sprint of finished) {
    const cap = capacityPeople(plans, sprint.id);
    const owners = ownerPeople(stories, sprint, includeExamples);
    const both = prev ? cap !== null && prev.cap !== null : cap !== null;
    const source: StabilityRow["source"] = both ? "capacity" : "owners";
    const now = both ? (cap as Person[]) : owners;
    const earlier = prev ? (both ? (prev.cap as Person[]) : prev.owners) : null;
    // Owners only: a sprint whose stories name nobody says nothing about
    // who was there, so it isn't compared (everyone "joined" or "left" would
    // be made up).
    const before = earlier && (both || (earlier.length > 0 && now.length > 0)) ? earlier : null;
    const stayed = before ? now.filter((p) => before.some((q) => samePerson(p, q))) : [];
    const joined = before ? now.filter((p) => !before.some((q) => samePerson(p, q))) : [];
    const left = before ? before.filter((q) => !now.some((p) => samePerson(p, q))) : [];
    const either = before ? before.length + joined.length : 0;
    rows.push({
      sprintId: sprint.id,
      name: sprint.name || "Untitled sprint",
      endDate: sprint.endDate ?? null,
      people: now.length,
      stayed: stayed.length,
      joined: joined.map((p) => p.name),
      left: left.map((p) => p.name),
      pct: before && either > 0 ? Math.round((stayed.length / either) * 100) : null,
      source,
      rough: source === "owners",
      pointsCompleted:
        typeof sprint.pointsCompleted === "number" && Number.isFinite(sprint.pointsCompleted)
          ? sprint.pointsCompleted
          : null,
    });
    prev = { sprint, cap, owners };
  }
  let lastChange: StabilityRow | null = null;
  for (const r of rows) if (r.joined.length > 0 || r.left.length > 0) lastChange = r;
  return { rows, lastChange };
}

/** Whether the team changed in one of the last `n` finished sprints. */
export function changedRecently(stability: TeamStability, n = 2): boolean {
  return stability.rows.slice(-n).some((r) => r.joined.length > 0 || r.left.length > 0);
}
