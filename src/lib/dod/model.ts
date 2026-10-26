/**
 * The Definition of Done: the team's criteria, and whether each done story
 * meets them. One workspace document (DOD_DOC_ID) that the DoD page, the
 * Sprint board's cards, Release Readiness, the Team charter and
 * tool.dod_builder.* read through these functions, so a person and an
 * agent count adherence the same way.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it; example rows are told apart with
 * lib/utils/example-id).
 *
 *   - A story meets the DoD when every required criterion is ticked on its
 *     card (Story.dodChecks), against the criteria as they are today: an id
 *     no longer in the DoD is ignored, a new criterion starts unticked.
 *   - Adherence is the share of done stories that meet it. It is "—" (null)
 *     with no done stories, or with nothing required to meet.
 *   - The pre-Phase-6 team-level ticks (`done` on a criterion) and sprint
 *     snapshots (`history`) are kept and read-only: Release Readiness falls
 *     back to the ticks for a release that links no stories, while the DoD
 *     still carries them (hasLegacyTicks).
 */

import type {
  DefinitionOfDone,
  DodCategory,
  DodCriterion,
  DodSnapshot,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import { DOD_DOC_ID, DOD_KIND } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { isExampleSprintId } from "@/lib/sprints/example";
import { enoughData } from "@/lib/analytics/min-sample";

export { DOD_DOC_ID, DOD_KIND };

/** The DoD builder's old cloud-synced blob, moved into the workspace once and kept as the backup. */
export const DOD_LEGACY_KEY = "agile-toolkit:dod-builder";

/**
 * Set (true) once the old blob has moved, or the workspace had a DoD of its
 * own: the blob stays as the backup, so without this a DoD deleted from the
 * workspace later would be copied back in from it on the next visit.
 */
export const DOD_MOVED_KEY = "agile-toolkit:dod-builder:moved";

/** Whether a stored moved marker says the blob has moved (anything else reads as not yet). */
export const isMovedMarker = (raw: unknown): boolean => raw === true;

export const DOD_CATEGORIES: readonly DodCategory[] = [
  "code",
  "testing",
  "docs",
  "performance",
  "security",
  "other",
];

export const DOD_CATEGORY_LABEL: Record<DodCategory, string> = {
  code: "Code",
  testing: "Testing",
  docs: "Docs",
  performance: "Performance",
  security: "Security",
  other: "Other",
};

export const CRITERION_LABEL_MAX = 200;
export const CRITERION_DESCRIPTION_MAX = 1000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const isCategory = (v: unknown): v is DodCategory =>
  typeof v === "string" && (DOD_CATEGORIES as readonly string[]).includes(v);

/** A DoD with no criteria yet. */
export function emptyDefinitionOfDone(): DefinitionOfDone {
  return { id: DOD_DOC_ID, items: [], history: [] };
}

function normalizeCriterion(raw: unknown, index: number): DodCriterion | null {
  if (!isRecord(raw) || typeof raw.label !== "string") return null;
  const label = raw.label.trim();
  if (!label) return null;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  return {
    // Every stored criterion had an id; a hand-made blob might not.
    id: typeof raw.id === "string" && raw.id ? raw.id : `criterion-${index + 1}`,
    label,
    category: isCategory(raw.category) ? raw.category : "other",
    required: raw.required === true,
    ...(description ? { description } : {}),
    ...(typeof raw.done === "boolean" ? { done: raw.done } : {}),
  };
}

function normalizeSnapshot(raw: unknown): DodSnapshot | null {
  if (!isRecord(raw) || typeof raw.sprintName !== "string") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    sprintName: raw.sprintName,
    totalRequired: n(raw.totalRequired),
    completed: n(raw.completed),
    ts: typeof raw.ts === "string" ? raw.ts : "",
  };
}

/**
 * A stored DoD in a usable shape: the workspace document, the old blob
 * ({items, history}), or anything an agent wrote. Criteria without a label
 * are dropped, duplicate ids keep the first, and unknown categories read
 * as "other".
 */
export function normalizeDefinitionOfDone(raw: unknown): DefinitionOfDone {
  if (!isRecord(raw)) return emptyDefinitionOfDone();
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(normalizeCriterion)
    .filter((c): c is DodCriterion => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map(normalizeSnapshot)
    .filter((h): h is DodSnapshot => h !== null);
  return { id: DOD_DOC_ID, items, history };
}

/** Whether a stored blob holds anything worth moving. */
export function hasDodContent(doc: Pick<DefinitionOfDone, "items" | "history">): boolean {
  return doc.items.length > 0 || doc.history.length > 0;
}

/** The criteria a story is checked against (the document, or just its items). */
export interface DodCriteria {
  items: readonly DodCriterion[];
}

/** The criteria every story must meet. */
export function requiredCriteria(doc: DodCriteria): DodCriterion[] {
  return doc.items.filter((c) => c.required);
}

/**
 * Whether the DoD still carries the team-level ticks from before stories
 * had their own (`done` on some criterion). Only then is there a tick to
 * read for a release that links no stories: a DoD written since has none,
 * and nothing on the page sets them any more.
 */
export function hasLegacyTicks(doc: DodCriteria): boolean {
  return doc.items.some((c) => typeof c.done === "boolean");
}

/** The criterion ids ticked on a story's card. */
export function checkedOf(story: Pick<Story, "dodChecks">): Set<string> {
  const checked = story.dodChecks?.checked;
  return new Set(Array.isArray(checked) ? checked.filter((id) => typeof id === "string") : []);
}

/** The required criteria a story hasn't ticked yet. */
export function openCriteria(story: Pick<Story, "dodChecks">, doc: DodCriteria): DodCriterion[] {
  const checked = checkedOf(story);
  return requiredCriteria(doc).filter((c) => !checked.has(c.id));
}

/** Whether a story meets the DoD; null when nothing is required (nothing to meet). */
export function meetsDod(story: Pick<Story, "dodChecks">, doc: DodCriteria): boolean | null {
  if (requiredCriteria(doc).length === 0) return null;
  return openCriteria(story, doc).length === 0;
}

/**
 * `story` with `criterionId` ticked (or not) on its card. The same story
 * back when nothing changes; `dodChecks` goes once nothing is ticked.
 */
export function withStoryDodCheck(
  story: Story,
  criterionId: string,
  checked: boolean,
  at: string
): Story {
  const current = checkedOf(story);
  if (current.has(criterionId) === checked) return story;
  if (checked) current.add(criterionId);
  else current.delete(criterionId);
  const next: Story = { ...story };
  if (current.size === 0) delete next.dodChecks;
  else next.dodChecks = { checked: Array.from(current), updatedAt: at };
  return next;
}

/** Which rows count: the team's own, or (for the page's example preview) example rows too. */
export interface CountOptions {
  /** Count example rows: only the page's in-memory example passes this. */
  examples?: boolean;
}

/** A row the numbers count: never an example row, unless asked (the example preview). */
const counts = (s: Pick<Story, "id">, opts?: CountOptions) =>
  opts?.examples === true || !isExampleId(s.id);

export interface DodMiss {
  id: string;
  title: string;
  sprintId?: string;
  /** Labels of the required criteria still open. */
  open: string[];
}

export interface DodAdherence {
  /** Required criteria the stories are checked against. */
  required: number;
  /** Done stories counted. */
  done: number;
  /** Done stories that meet every required criterion. */
  meeting: number;
  /** meeting / done as a whole percentage; null with no done stories or nothing required. */
  pct: number | null;
  /** The done stories that don't meet it, and what each still needs. */
  missing: DodMiss[];
}

/**
 * How many done stories meet the DoD: in one sprint (`sprintId`), or
 * across every story when none is given. Example stories never count.
 */
export function dodAdherence(
  stories: readonly Story[],
  doc: DodCriteria,
  sprintId?: string,
  opts?: CountOptions
): DodAdherence {
  const required = requiredCriteria(doc);
  const done = stories.filter(
    (s) =>
      counts(s, opts) && s.status === "done" && (sprintId === undefined || s.sprintId === sprintId)
  );
  const missing: DodMiss[] = [];
  if (required.length > 0) {
    for (const s of done) {
      const open = openCriteria(s, doc);
      if (open.length > 0) {
        missing.push({
          id: s.id,
          title: s.title,
          ...(s.sprintId ? { sprintId: s.sprintId } : {}),
          open: open.map((c) => c.label),
        });
      }
    }
  }
  const meeting = required.length > 0 ? done.length - missing.length : 0;
  return {
    required: required.length,
    done: done.length,
    meeting,
    pct: required.length > 0 && done.length > 0 ? Math.round((meeting / done.length) * 100) : null,
    missing,
  };
}

export interface SprintAdherenceRow {
  sprintId: string;
  name: string;
  startDate: string;
  endDate: string;
  done: number;
  meeting: number;
  pct: number | null;
}

/**
 * Adherence per sprint, oldest first: every sprint (not cancelled, not an
 * example) with at least one done story. Each is checked against today's
 * required criteria, so a criterion added later counts against old sprints
 * too; the page says so.
 */
export function adherenceBySprint(
  stories: readonly Story[],
  sprints: readonly Sprint[],
  doc: DodCriteria,
  opts?: CountOptions
): SprintAdherenceRow[] {
  return [...sprints]
    .filter(
      (s) =>
        s.status !== "cancelled" &&
        (opts?.examples === true || (!isExampleSprintId(s.id) && counts(s)))
    )
    .sort((a, b) =>
      a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.name.localeCompare(b.name)
    )
    .flatMap((s) => {
      const a = dodAdherence(stories, doc, s.id, opts);
      if (a.done === 0) return [];
      return [
        {
          sprintId: s.id,
          name: s.name,
          startDate: s.startDate,
          endDate: s.endDate,
          done: a.done,
          meeting: a.meeting,
          pct: a.pct,
        },
      ];
    });
}

const storiesWord = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;
const criteriaWord = (n: number) => `${n} ${n === 1 ? "criterion" : "criteria"}`;

/** “title”, cut to a readable length for a sentence. */
function quoted(t: string, max = 48): string {
  const s = t.trim().replace(/\s+/g, " ") || "story";
  return `“${s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s}”`;
}

/** "a, b and c". */
function listAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Adherence is quotable as a percentage from MIN_SAMPLE.average done stories. */
export const quotableAdherence = (a: DodAdherence): boolean =>
  a.pct !== null && enoughData(a.done, "average");

/**
 * The one-sentence answer at the top of the DoD page: how many done
 * stories in the sprint meet it, and what the first one that doesn't
 * still needs.
 *
 *   "3 of 5 done stories in Sprint 7 meet the DoD (60%); “Pay by card”
 *    still needs Tests pass in CI."
 */
export function dodVerdict(doc: DodCriteria, adherence: DodAdherence, where?: string): string {
  if (doc.items.length === 0) return "No Definition of Done yet.";
  const required = requiredCriteria(doc).length;
  if (required === 0) {
    return `${criteriaWord(doc.items.length)}, none required yet: mark the ones every story must meet.`;
  }
  const scope = where ? ` in ${where}` : "";
  if (adherence.done === 0) {
    return `${criteriaWord(doc.items.length)} (${required} required); no story${scope} is done yet.`;
  }
  const pct = quotableAdherence(adherence) ? ` (${adherence.pct}%)` : "";
  const head =
    adherence.meeting === adherence.done
      ? adherence.done === 1
        ? `The done story${scope} meets the DoD`
        : `All ${adherence.done} done stories${scope} meet the DoD`
      : `${adherence.meeting} of ${adherence.done} done ${adherence.done === 1 ? "story" : "stories"}${scope} meet the DoD${pct}`;
  const first = adherence.missing[0];
  if (!first) return `${head}.`;
  const more = adherence.missing.length - 1;
  return `${head}; ${quoted(first.title)} still needs ${listAnd(first.open)}${
    more > 0 ? ` (and ${storiesWord(more)} more)` : ""
  }.`;
}
