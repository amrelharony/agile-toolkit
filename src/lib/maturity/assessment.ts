/**
 * Agile Maturity Assessment: the draft, the saved (dated) assessments, the
 * team's level and the roadmap.
 *
 * Pure and server-safe, so the page, the agent actions (tool.maturity.*)
 * and the next-step rules agree. The rules:
 *
 *   - A team that never saved an assessment is unassessed: no level, no
 *     percentage, no roadmap. The page used to score every dimension 1 by
 *     default and push "Level 1" into every tool's AI prompt for a team that
 *     had only opened it.
 *   - `MaturityAssessment.scores` is the draft; a missing dimension is Not
 *     scored. Only a saved entry in `history` (every dimension scored, a day
 *     that isn't in the future) counts, and the latest one by day sets
 *     `Workspace.maturityLevel` (maturityLevelOf).
 *   - Overall maturity runs 0-100% from all 1s to all 5s (maturityPct).
 */

import {
  MATURITY_DIMENSIONS,
  MATURITY_LEVEL_LABELS,
  getMaturityScore,
  maturityPct,
  type MaturityTone,
} from "@/lib/constants/maturity-model";
import type {
  MaturityAssessment,
  MaturityAssessmentEntry,
  MaturityLevel,
  RetroBoard,
} from "@/lib/stores/workspace-types";
import { isIsoDate } from "@/lib/sprints/calendar";
import { formatDate } from "@/lib/utils/formatters";

export { maturityPct };

/** The tool's one document id (the page and tool.maturity.* share it). */
export const MATURITY_ID = "maturity:current";
/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const MATURITY_KIND = "workspace:maturityAssessment";
/** The roadmap's target when the team hasn't picked one. */
export const DEFAULT_TARGET_LEVEL = 4;
export const TARGET_LEVELS = [2, 3, 4, 5] as const;
export const NOTE_MAX = 2000;

const DIMENSION_COUNT = () => MATURITY_DIMENSIONS.length;

/** A stored level as a whole 1-5 (out-of-range values clamped), or null for Not scored. */
export function levelOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(5, Math.max(1, Math.round(v)));
}

/** How many of the eight dimensions have a score. */
export function scoredCount(scores: Readonly<Record<string, unknown>> | undefined): number {
  return MATURITY_DIMENSIONS.filter((d) => levelOf(scores?.[d.id]) !== null).length;
}

/** The dimensions without a score, in the model's order. */
export function missingDimensions(
  scores: Readonly<Record<string, unknown>> | undefined
): { id: string; name: string }[] {
  return MATURITY_DIMENSIONS.filter((d) => levelOf(scores?.[d.id]) === null).map((d) => ({
    id: d.id,
    name: d.name,
  }));
}

/** The average level across the eight dimensions; null unless every one is scored. */
export function averageOf(scores: Readonly<Record<string, unknown>> | undefined): number | null {
  const levels = MATURITY_DIMENSIONS.map((d) => levelOf(scores?.[d.id]));
  if (levels.some((l) => l === null)) return null;
  return (levels as number[]).reduce((a, b) => a + b, 0) / levels.length;
}

/** Only the known dimensions' scores, as whole 1-5 levels. */
export function cleanScores(
  scores: Readonly<Record<string, unknown>> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of MATURITY_DIMENSIONS) {
    const level = levelOf(scores?.[d.id]);
    if (level !== null) out[d.id] = level;
  }
  return out;
}

/** A saved entry that counts: an id, a real day, and every dimension scored. */
export function isSavedEntry(e: unknown): e is MaturityAssessmentEntry {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Partial<MaturityAssessmentEntry>;
  return (
    typeof x.id === "string" &&
    typeof x.assessedAt === "string" &&
    isIsoDate(x.assessedAt) &&
    averageOf(x.scores) !== null
  );
}

/** The saved assessments that count, oldest first by day (ties keep the order saved). */
export function savedAssessments(
  doc: MaturityAssessment | null | undefined
): MaturityAssessmentEntry[] {
  const list = Array.isArray(doc?.history) ? doc.history : [];
  return list
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: MaturityAssessmentEntry; i: number } => isSavedEntry(x.e))
    .sort(
      (a, b) => a.e.assessedAt.slice(0, 10).localeCompare(b.e.assessedAt.slice(0, 10)) || a.i - b.i
    )
    .map((x) => x.e);
}

/** The latest saved assessment (by day, then the last saved), or null. */
export function latestAssessment(
  doc: MaturityAssessment | null | undefined
): MaturityAssessmentEntry | null {
  const saved = savedAssessments(doc);
  return saved[saved.length - 1] ?? null;
}

/** The one before the latest, or null. */
export function previousAssessment(
  doc: MaturityAssessment | null | undefined
): MaturityAssessmentEntry | null {
  const saved = savedAssessments(doc);
  return saved.length > 1 ? saved[saved.length - 2] : null;
}

/**
 * The team's maturity level, for `Workspace.maturityLevel`: the latest saved
 * assessment's rounded average. Undefined = unassessed, never 1.
 */
export function maturityLevelOf(
  doc: MaturityAssessment | null | undefined
): MaturityLevel | undefined {
  const latest = latestAssessment(doc);
  const avg = latest ? averageOf(latest.scores) : null;
  return avg === null ? undefined : (getMaturityScore(avg).level as MaturityLevel);
}

/** The roadmap's target, 2-5; the default when the stored one isn't. */
export function targetOf(doc: MaturityAssessment | null | undefined): number {
  const t = doc?.targetLevel;
  return typeof t === "number" && Number.isInteger(t) && t >= 2 && t <= 5
    ? t
    : DEFAULT_TARGET_LEVEL;
}

export interface AssessmentSummary {
  id: string;
  assessedAt: string;
  averageLevel: number;
  /** 0-100. */
  percentage: number;
  level: number;
  label: string;
  tone: MaturityTone;
  note: string | null;
}

export function summarizeEntry(entry: MaturityAssessmentEntry): AssessmentSummary {
  const avg = averageOf(entry.scores) ?? 1;
  const score = getMaturityScore(avg);
  return {
    id: entry.id,
    assessedAt: entry.assessedAt.slice(0, 10),
    averageLevel: Math.round(avg * 100) / 100,
    percentage: score.percentage,
    level: score.level,
    label: score.label,
    tone: score.tone,
    note: entry.note?.trim() || null,
  };
}

/* ── Roadmap ────────────────────────────────────────────────────────── */

export interface RoadmapStep {
  /** `${dimensionId}:${toLevel}`: the retro action sent for it carries this id. */
  key: string;
  dimensionId: string;
  name: string;
  current: number;
  /** The next level: one step at a time. */
  toLevel: number;
  toLabel: string;
  /** What the next level looks like. */
  description: string;
  /** The roadmap's target. */
  target: number;
}

/** One step per dimension below the target, weakest first, from a saved assessment. */
export function roadmapFor(
  entry: MaturityAssessmentEntry | null | undefined,
  targetLevel: number
): RoadmapStep[] {
  if (!entry) return [];
  const target = Math.min(5, Math.max(2, Math.round(targetLevel)));
  return MATURITY_DIMENSIONS.map((d, order) => ({ d, order, current: levelOf(entry.scores[d.id]) }))
    .filter(
      (x): x is { d: (typeof MATURITY_DIMENSIONS)[number]; order: number; current: number } =>
        x.current !== null && x.current < target
    )
    .sort((a, b) => a.current - b.current || a.order - b.order)
    .map(({ d, current }) => {
      const next = d.levels.find((l) => l.level === current + 1);
      return {
        key: `${d.id}:${current + 1}`,
        dimensionId: d.id,
        name: d.name,
        current,
        toLevel: current + 1,
        toLabel: next?.label ?? MATURITY_LEVEL_LABELS[current + 1] ?? "",
        description: next?.description ?? "",
        target,
      };
    });
}

/** The retro action title a roadmap step goes out as. */
export const roadmapTitle = (step: Pick<RoadmapStep, "name" | "toLevel">) =>
  `Maturity: ${step.name} to level ${step.toLevel}`;

/**
 * The retro cards sent from a roadmap step, on any board (an archived retro
 * keeps its cards' ids), each card once. "Sent" is derived from them, so
 * the assessment needs no link field of its own.
 */
export function roadmapCards(
  boards: readonly RetroBoard[] | undefined,
  key: string
): { id: string; boardId: string; done: boolean }[] {
  const seen = new Set<string>();
  const out: { id: string; boardId: string; done: boolean }[] = [];
  for (const b of boards ?? []) {
    for (const c of b.cards ?? []) {
      if (c.sourceRef?.tool !== "maturity" || c.sourceRef.id !== key || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, boardId: b.id, done: c.done === true });
    }
  }
  return out;
}

/* ── Change between assessments ─────────────────────────────────────── */

export interface DimensionDelta {
  dimensionId: string;
  name: string;
  from: number;
  to: number;
}

/** The dimensions whose level changed from `prev` to `cur`. */
export function assessmentDeltas(
  prev: MaturityAssessmentEntry | null | undefined,
  cur: MaturityAssessmentEntry | null | undefined
): DimensionDelta[] {
  if (!prev || !cur) return [];
  return MATURITY_DIMENSIONS.flatMap((d) => {
    const from = levelOf(prev.scores[d.id]);
    const to = levelOf(cur.scores[d.id]);
    return from !== null && to !== null && from !== to
      ? [{ dimensionId: d.id, name: d.name, from, to }]
      : [];
  });
}

/* ── Writing ────────────────────────────────────────────────────────── */

/** Why an assessment can't be dated `day`, or null: a real day, not after today. */
export function assessedAtError(day: string, today: string): string | null {
  if (!day.trim()) return "Pick the day you took it.";
  if (!isIsoDate(day)) return "Pick a real day.";
  if (day.slice(0, 10) > today) return "It can't be taken in the future.";
  return null;
}

/**
 * A stored doc as the page and agents read it: only the known dimensions'
 * scores (whole 1-5) in the draft, a target 2-5, and the history as stored
 * (entries that don't count are kept, never deleted, but never counted).
 */
export function normalizeMaturity(doc: MaturityAssessment | null | undefined): MaturityAssessment {
  return {
    id: MATURITY_ID,
    scores: cleanScores(doc?.scores),
    targetLevel: targetOf(doc),
    history: Array.isArray(doc?.history) ? doc.history : [],
  };
}

/**
 * A doc from before dated assessments: draft scores and no history. Its
 * scores are shown as a draft to save with the day they were taken; they
 * never count as an assessment on their own.
 */
export function isLegacyDraft(doc: MaturityAssessment | null | undefined): boolean {
  return !!doc && !Array.isArray(doc.history) && scoredCount(doc.scores) > 0;
}

export function newAssessment(
  values: {
    scores: Record<string, number>;
    assessedAt: string;
    targetLevel: number;
    note?: string;
  },
  id: string
): MaturityAssessmentEntry {
  const note = values.note?.trim();
  return {
    id,
    assessedAt: values.assessedAt.slice(0, 10),
    scores: cleanScores(values.scores),
    targetLevel: values.targetLevel,
    ...(note ? { note } : {}),
  };
}

/** The doc with `entry` saved and the draft cleared for the next assessment. */
export function withAssessment(
  doc: MaturityAssessment,
  entry: MaturityAssessmentEntry
): MaturityAssessment {
  const base = normalizeMaturity(doc);
  return { ...base, scores: {}, history: [...(base.history ?? []), entry] };
}

/** The doc with a saved entry edited (its day or note); null when it isn't there. */
export function withAssessmentPatch(
  doc: MaturityAssessment,
  id: string,
  patch: { assessedAt?: string; note?: string | null }
): MaturityAssessment | null {
  const base = normalizeMaturity(doc);
  if (!(base.history ?? []).some((e) => e.id === id)) return null;
  return {
    ...base,
    history: (base.history ?? []).map((e) => {
      if (e.id !== id) return e;
      const next: MaturityAssessmentEntry = { ...e };
      if (patch.assessedAt !== undefined) next.assessedAt = patch.assessedAt.slice(0, 10);
      if (patch.note !== undefined) {
        const note = patch.note?.trim();
        if (note) next.note = note;
        else delete next.note;
      }
      return next;
    }),
  };
}

/** The doc without a saved entry, and where it was (for Undo); null when it isn't there. */
export function withoutAssessment(
  doc: MaturityAssessment,
  id: string
): { doc: MaturityAssessment; entry: MaturityAssessmentEntry; index: number } | null {
  const base = normalizeMaturity(doc);
  const history = base.history ?? [];
  const index = history.findIndex((e) => e.id === id);
  if (index < 0) return null;
  return {
    doc: { ...base, history: history.filter((e) => e.id !== id) },
    entry: history[index],
    index,
  };
}

/** Undo for `withoutAssessment`: the entry back where it was. */
export function restoreAssessment(
  doc: MaturityAssessment,
  entry: MaturityAssessmentEntry,
  index: number
): MaturityAssessment {
  const base = normalizeMaturity(doc);
  const history = (base.history ?? []).filter((e) => e.id !== entry.id);
  history.splice(Math.min(index, history.length), 0, entry);
  return { ...base, history };
}

/** The doc after a reset: no draft, no history, the default target. */
export function emptyMaturity(): MaturityAssessment {
  return { id: MATURITY_ID, scores: {}, targetLevel: DEFAULT_TARGET_LEVEL, history: [] };
}

/* ── The verdict ────────────────────────────────────────────────────── */

/** "Technical Excellence (1)", or two names sharing the lowest level. */
function weakest(entry: MaturityAssessmentEntry): string {
  const levels = MATURITY_DIMENSIONS.map((d) => ({
    name: d.name,
    level: levelOf(entry.scores[d.id]) ?? 1,
  }));
  const low = Math.min(...levels.map((l) => l.level));
  const names = levels.filter((l) => l.level === low).map((l) => l.name);
  const shown =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return `${shown} (${low})`;
}

/**
 * The one sentence above the assessment: unassessed (and how far the draft
 * is), or the latest level with its percentage and day, how it moved since
 * the one before, and the weakest dimension.
 */
export function maturityVerdict(doc: MaturityAssessment | null | undefined): string {
  const saved = savedAssessments(doc);
  const latest = saved[saved.length - 1];
  if (!latest) {
    const scored = scoredCount(doc?.scores);
    const total = DIMENSION_COUNT();
    if (scored === 0) {
      return "Not assessed yet. Score the eight dimensions together, then save the assessment with the day you took it.";
    }
    if (scored < total)
      return `Not assessed yet: ${scored} of ${total} dimensions scored in the draft.`;
    return `Not assessed yet: all ${total} dimensions are scored. Save the assessment to count it.`;
  }
  const now = summarizeEntry(latest);
  const head = `Level ${now.level} · ${now.label} (${now.percentage}%)`;
  const prev = saved.length > 1 ? summarizeEntry(saved[saved.length - 2]) : null;
  const when = formatDate(now.assessedAt);
  let moved = `, assessed on ${when}`;
  if (prev) {
    const then = formatDate(prev.assessedAt);
    moved =
      prev.percentage === now.percentage
        ? ` on ${when}, the same as on ${then}`
        : ` on ${when}, ${now.percentage > prev.percentage ? "up" : "down"} from ${prev.percentage}% on ${then}`;
  }
  return `${head}${moved}. Weakest: ${weakest(latest)}.`;
}
