/**
 * Interrupt Buffer: the share of a sprint kept free for unplanned work
 * (`Sprint.interruptBuffer`), the interrupts logged against it
 * (`InterruptItem`), and what they add up to. One reading for the tool, its
 * agent verbs, Sprint Planning's buffer line and the Sprint Cockpit's tile
 * (`interruptBufferStatus`).
 *
 * The buffer in points:
 *   - `points` when it is set (0 or more);
 *   - else `pct` of the sprint's planned points (`Sprint.pointsPlanned`),
 *     to one decimal place, once the sprint has planned points;
 *   - else none can be worked out ("can't tell"): the interrupts are still
 *     counted, but not weighed against it.
 *
 * Every interrupt logged in the sprint (`sprintId`) uses the buffer, open or
 * resolved: resolving it means the work is done, not that the capacity came
 * back. One with no size counts as an interrupt but adds no points; the
 * status says how many are unsized, so "4 of 6 points" is never read as the
 * whole story.
 *
 * Pure; server-safe. Example rows ("example-" ids) are the caller's to
 * leave out.
 */

import {
  INTERRUPT_KINDS,
  TOOL_TEXT_MAX,
  type InterruptItem,
  type InterruptKind,
  type Sprint,
  type SprintInterruptBuffer,
} from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";

/** The highest share a buffer may take: past it, nothing is left to plan. */
export const BUFFER_PCT_MAX = 90;
/** Used at or above this share of the buffer, it is worth watching. */
export const BUFFER_WATCH_SHARE = 0.75;
/** The largest interrupt size the form takes, in points. */
export const INTERRUPT_SIZE_MAX = 100;

export const INTERRUPT_KIND_LABEL: Record<InterruptKind, string> = {
  bug: "Bug",
  support: "Support",
  request: "Request",
  incident: "Incident",
  other: "Other",
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Points as text: "6", "4.5", "1 point". */
export function pointsText(n: number): string {
  const v = round1(n);
  return `${v} ${v === 1 ? "point" : "points"}`;
}

/**
 * The buffer as stored, cleaned: a pct inside 0–BUFFER_PCT_MAX is kept, a
 * points value of 0 or more is kept, anything else dropped. Undefined when
 * nothing is left (no buffer).
 */
export function cleanBuffer(
  buffer: SprintInterruptBuffer | undefined | null
): SprintInterruptBuffer | undefined {
  if (!buffer || typeof buffer !== "object") return undefined;
  const out: SprintInterruptBuffer = {};
  if (finite(buffer.pct) && buffer.pct > 0 && buffer.pct <= BUFFER_PCT_MAX) {
    out.pct = round1(buffer.pct);
  }
  if (finite(buffer.points) && buffer.points >= 0) out.points = round1(buffer.points);
  return out.pct !== undefined || out.points !== undefined ? out : undefined;
}

/** Whether the sprint keeps a buffer at all. */
export function hasBuffer(sprint: Pick<Sprint, "interruptBuffer">): boolean {
  return cleanBuffer(sprint.interruptBuffer) !== undefined;
}

/**
 * The sprint's buffer in points (see the file header), or null when it has
 * none or it can't be worked out yet (a share of a sprint with no planned
 * points).
 */
export function bufferPoints(
  sprint: Pick<Sprint, "interruptBuffer" | "pointsPlanned">
): number | null {
  const buffer = cleanBuffer(sprint.interruptBuffer);
  if (!buffer) return null;
  if (buffer.points !== undefined) return buffer.points;
  const planned = finite(sprint.pointsPlanned) ? sprint.pointsPlanned : 0;
  if (buffer.pct !== undefined && planned > 0) return round1((planned * buffer.pct) / 100);
  return null;
}

/** "20% of the sprint (6 points)", "6 points", "20% of the sprint", or "No buffer set". */
export function bufferLabel(sprint: Pick<Sprint, "interruptBuffer" | "pointsPlanned">): string {
  const buffer = cleanBuffer(sprint.interruptBuffer);
  if (!buffer) return "No buffer set";
  const pts = bufferPoints(sprint);
  if (buffer.pct !== undefined && buffer.points === undefined) {
    return pts !== null
      ? `${buffer.pct}% of the sprint (${pointsText(pts)})`
      : `${buffer.pct}% of the sprint`;
  }
  if (buffer.pct !== undefined && pts !== null) {
    return `${pointsText(pts)} (${buffer.pct}% of the sprint)`;
  }
  return pts !== null ? pointsText(pts) : "No buffer set";
}

/** An interrupt's size in points, or 0 when it has none. */
export function interruptSize(item: Pick<InterruptItem, "size">): number {
  return finite(item.size) && item.size > 0 ? item.size : 0;
}

/** Whether the interrupt is still being worked on. */
export const isOpenInterrupt = (item: Pick<InterruptItem, "resolvedAt">): boolean =>
  !item.resolvedAt;

/** The sprint's interrupts, newest first by when they landed. */
export function sprintInterrupts(
  items: readonly InterruptItem[],
  sprintId: string
): InterruptItem[] {
  return items
    .filter((i) => i.sprintId === sprintId)
    .slice()
    .sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : a.loggedAt > b.loggedAt ? -1 : 0));
}

export type BufferState = "none" | "ok" | "watch" | "over";

export interface InterruptBufferStatus {
  sprintId: string;
  /** A buffer is set on the sprint. */
  set: boolean;
  /** The buffer in points; null when none is set or it can't be worked out. */
  bufferPoints: number | null;
  /** Points of every interrupt logged in the sprint (open or resolved). */
  usedPoints: number;
  /** What is left of the buffer (0 or less once it is used up); null with no buffer in points. */
  leftPoints: number | null;
  /** usedPoints / bufferPoints (above 1 when over); null with no buffer in points, or a 0 one. */
  usedShare: number | null;
  /**
   * "none": no buffer in points to weigh against; "ok": under three
   * quarters used; "watch": three quarters or more, up to all of it;
   * "over": more than the buffer (a 0-point buffer is over at the first
   * point).
   */
  state: BufferState;
  /** The buffer is spent: the Emergency Procedure applies. */
  over: boolean;
  total: number;
  open: number;
  resolved: number;
  emergencies: number;
  /** Interrupts with no size: counted, but adding no points. */
  unsized: number;
  /** How many of each kind. */
  byKind: Record<InterruptKind, number>;
  /** One plain sentence: "4 of 6 points used, 2 left." */
  summary: string;
}

/**
 * Where the sprint's interrupt buffer stands. `items` may hold every
 * interrupt in the workspace: only the sprint's own count.
 */
export function interruptBufferStatus(
  sprint: Pick<Sprint, "id" | "interruptBuffer" | "pointsPlanned">,
  items: readonly InterruptItem[]
): InterruptBufferStatus {
  const mine = items.filter((i) => i.sprintId === sprint.id);
  const byKind = Object.fromEntries(INTERRUPT_KINDS.map((k) => [k, 0])) as Record<
    InterruptKind,
    number
  >;
  let used = 0;
  let open = 0;
  let emergencies = 0;
  let unsized = 0;
  for (const item of mine) {
    const kind = INTERRUPT_KINDS.includes(item.kind) ? item.kind : "other";
    byKind[kind] += 1;
    used += interruptSize(item);
    if (isOpenInterrupt(item)) open += 1;
    if (item.emergency) emergencies += 1;
    if (interruptSize(item) === 0 && !(finite(item.size) && item.size === 0)) unsized += 1;
  }
  used = round1(used);
  const set = hasBuffer(sprint);
  const buffer = bufferPoints(sprint);
  const left = buffer === null ? null : round1(buffer - used);
  const share = buffer === null || buffer === 0 ? null : used / buffer;
  let state: BufferState = "none";
  if (buffer !== null) {
    if (used > buffer) state = "over";
    else if (buffer > 0 && share !== null && share >= BUFFER_WATCH_SHARE) state = "watch";
    else state = "ok";
  }
  const total = mine.length;
  return {
    sprintId: sprint.id,
    set,
    bufferPoints: buffer,
    usedPoints: used,
    leftPoints: left,
    usedShare: share,
    state,
    over: state === "over",
    total,
    open,
    resolved: total - open,
    emergencies,
    unsized,
    byKind,
    summary: statusSummary({ set, buffer, used, left, total, unsized, state }),
  };
}

function statusSummary({
  set,
  buffer,
  used,
  left,
  total,
  unsized,
  state,
}: {
  set: boolean;
  buffer: number | null;
  used: number;
  left: number | null;
  total: number;
  unsized: number;
  state: BufferState;
}): string {
  const count = `${total} ${total === 1 ? "interrupt" : "interrupts"}`;
  const unsizedNote =
    unsized > 0 ? ` ${unsized} ${unsized === 1 ? "has" : "have"} no size yet.` : "";
  if (!set) {
    return total === 0
      ? "No buffer set and no interrupts logged."
      : `No buffer set. ${count} logged, ${pointsText(used)}.${unsizedNote}`;
  }
  if (buffer === null) {
    return `The buffer is a share of the sprint, which has no planned points yet. ${count} logged, ${pointsText(used)}.${unsizedNote}`;
  }
  if (total === 0) return `Nothing logged yet: all ${pointsText(buffer)} of the buffer left.`;
  const usedText = `${round1(used)} of ${pointsText(buffer)} used`;
  if (state === "over") {
    return `${usedText}: ${pointsText(Math.abs(left ?? 0))} over the buffer.${unsizedNote}`;
  }
  if (left === 0) return `${usedText}: the buffer is used up.${unsizedNote}`;
  return `${usedText}, ${pointsText(left ?? 0)} left.${unsizedNote}`;
}

/* ── History ────────────────────────────────────────────────────────── */

export interface BufferHistoryRow {
  sprint: Pick<Sprint, "id" | "name" | "startDate" | "endDate" | "status">;
  status: InterruptBufferStatus;
}

/**
 * Every sprint that kept a buffer or logged an interrupt, newest first (by
 * start date): how much each used. Cancelled sprints are left out.
 */
export function bufferHistory(
  sprints: readonly Sprint[],
  items: readonly InterruptItem[]
): BufferHistoryRow[] {
  return sprints
    .filter((s) => s.status !== "cancelled")
    .map((sprint) => ({ sprint, status: interruptBufferStatus(sprint, items) }))
    .filter((row) => row.status.set || row.status.total > 0)
    .sort((a, b) =>
      a.sprint.startDate < b.sprint.startDate ? 1 : a.sprint.startDate > b.sprint.startDate ? -1 : 0
    );
}

/**
 * A buffer to start from, from finished sprints' interrupts: the average
 * points they used, to one decimal place. Null with no finished sprint
 * that logged any.
 */
export function suggestedBufferPoints(
  sprints: readonly Sprint[],
  items: readonly InterruptItem[],
  window = 3
): number | null {
  const done = sprints
    .filter((s) => s.status === "completed")
    .slice()
    .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))
    .map((s) => interruptBufferStatus(s, items))
    .filter((st) => st.total > 0)
    .slice(0, window);
  if (done.length === 0) return null;
  return round1(done.reduce((n, st) => n + st.usedPoints, 0) / done.length);
}

/* ── The Emergency Procedure ─────────────────────────────────────────── */

export interface EmergencyStep {
  id: string;
  title: string;
  detail: string;
}

/**
 * What to do once the buffer is spent, in order. Our own words for the
 * well-known pattern: stop and look, change how the work is done, get help,
 * re-plan with the Product Owner, and only then end the sprint early; then
 * learn from it at the retro.
 */
export const EMERGENCY_STEPS: readonly EmergencyStep[] = [
  {
    id: "stop",
    title: "Stop and look",
    detail:
      "Pause new interrupts for a moment. Check what is still open, and what the sprint goal needs.",
  },
  {
    id: "inform",
    title: "Tell the Product Owner",
    detail: "Say the buffer is spent and what that puts at risk, today, not at the review.",
  },
  {
    id: "change",
    title: "Change how the work is done",
    detail: "Can the team swarm, cut a step or finish something smaller that still meets the goal?",
  },
  {
    id: "help",
    title: "Get help",
    detail: "Ask someone outside the team to take the interrupts, or a part of the work, for now.",
  },
  {
    id: "replan",
    title: "Re-plan with the Product Owner",
    detail:
      "Take scope out of the sprint together, keeping the sprint goal. If the goal can't be kept, end the sprint early and plan again.",
  },
  {
    id: "retro",
    title: "Review it at the retro",
    detail: "Look at where the interrupts came from and decide one thing to fix at the source.",
  },
];

/* ── Kinds from titles, without AI ───────────────────────────────────── */

const KIND_WORDS: readonly [InterruptKind, RegExp][] = [
  [
    "incident",
    /\b(outage|down|incident|sev ?[0-4]|p[01]\b|crash(?:ed|es|ing)?|breach|on-?call|paged|pager|paging)\b/i,
  ],
  [
    "bug",
    /\b(bug|error|broken|fails?|failing|failure|defect|regression|500|exception|wrong|not working|doesn'?t work|fix)\b/i,
  ],
  [
    "support",
    /\b(support|customer|help(?:desk)?|ticket|question|access|password|reset|account|login|how (?:do|to))\b/i,
  ],
  [
    "request",
    /\b(request|asks?|asked|need(?:s|ed)?|wants?|could you|can we|add|new|report|export|change|update|stakeholder|ceo|sales)\b/i,
  ],
];

const SIZE_WORDS: readonly [number, RegExp][] = [
  [8, /\b(outage|down|breach|migration|all (?:users|customers)|sev ?[01]|p0)\b/i],
  [5, /\b(investigate|investigation|root cause|crash|data loss|corrupt)\b/i],
  [1, /\b(typo|copy|text|label|quick|small|tiny|question|access|password|reset)\b/i],
];

/**
 * A kind for an interrupt from its title, by keywords: an outage or a
 * crash is an incident, an error a bug, a customer or access question
 * support, an ask a request, anything else other. With a guessed size in
 * points when a word suggests one (an outage 8, an investigation 5, a typo
 * 1); none otherwise. The AI fallback, and the form's starting kind.
 */
export function classifyInterrupt(title: string): { kind: InterruptKind; size?: number } {
  const text = title.trim();
  const kind = KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? "other";
  const size = SIZE_WORDS.find(([, re]) => re.test(text))?.[0];
  return size !== undefined ? { kind, size } : { kind };
}

/* ── Forms ──────────────────────────────────────────────────────────── */

export interface InterruptDraft {
  title: string;
  kind: InterruptKind;
  /** As typed: "" for no size. */
  size: string;
  emergency: boolean;
}

export type InterruptField = "title" | "size";

export interface InterruptValues {
  title: string;
  kind: InterruptKind;
  size?: number;
  emergency: boolean;
}

export const EMPTY_INTERRUPT_DRAFT: InterruptDraft = {
  title: "",
  kind: "bug",
  size: "",
  emergency: false,
};

/** Size in points, 0–INTERRUPT_SIZE_MAX, or blank. */
export function sizeError(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return "Enter a number of points, or leave it empty.";
  if (n < 0) return "Use 0 or more points.";
  if (n > INTERRUPT_SIZE_MAX) return `Keep it to ${INTERRUPT_SIZE_MAX} points or fewer.`;
  return undefined;
}

export function validateInterruptDraft(
  draft: InterruptDraft
): Validation<InterruptValues, InterruptField> {
  const errors: Partial<Record<InterruptField, string>> = {};
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (!title) errors.title = "Say what came in.";
  else if (title.length > TOOL_TEXT_MAX.text) {
    errors.title = `Keep it to ${TOOL_TEXT_MAX.text.toLocaleString("en-GB")} characters or fewer.`;
  }
  const sizeProblem = sizeError(draft.size);
  if (sizeProblem) errors.size = sizeProblem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const kind = INTERRUPT_KINDS.includes(draft.kind) ? draft.kind : "other";
  const size = draft.size.trim() === "" ? undefined : round1(Number(draft.size));
  return {
    ok: true,
    values: { title, kind, ...(size !== undefined ? { size } : {}), emergency: draft.emergency },
  };
}

export type BufferMode = "pct" | "points";

export interface BufferDraft {
  mode: BufferMode;
  /** As typed. */
  value: string;
}

export function bufferDraftFor(sprint: Pick<Sprint, "interruptBuffer">): BufferDraft {
  const b = cleanBuffer(sprint.interruptBuffer);
  if (b?.points !== undefined) return { mode: "points", value: String(b.points) };
  if (b?.pct !== undefined) return { mode: "pct", value: String(b.pct) };
  return { mode: "pct", value: "" };
}

/**
 * The buffer as typed, checked: a share from 1 to BUFFER_PCT_MAX percent,
 * or points, 0 or more. Blank clears the buffer (`values` undefined).
 */
export function validateBufferDraft(
  draft: BufferDraft
): Validation<SprintInterruptBuffer | undefined, "value"> {
  const t = draft.value.trim();
  if (!t) return { ok: true, values: undefined };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, errors: { value: "Enter a number." } };
  if (draft.mode === "pct") {
    if (n <= 0 || n > BUFFER_PCT_MAX) {
      return {
        ok: false,
        errors: { value: `Use a share from 1 to ${BUFFER_PCT_MAX}%, or leave it empty.` },
      };
    }
    return { ok: true, values: { pct: round1(n) } };
  }
  if (n < 0) return { ok: false, errors: { value: "Use 0 or more points." } };
  return { ok: true, values: { points: round1(n) } };
}

/** Whether two buffers say the same. */
export function sameBuffer(
  a: SprintInterruptBuffer | undefined,
  b: SprintInterruptBuffer | undefined
): boolean {
  const x = cleanBuffer(a);
  const y = cleanBuffer(b);
  return x?.pct === y?.pct && x?.points === y?.points;
}
