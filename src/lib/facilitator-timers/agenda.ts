/**
 * Drafting an agenda from a meeting's goal and length, for the Ceremony
 * Timer's saved agendas. With AI it is Amr's draft; without, the nearest
 * built-in agenda (by the words in the goal) split over the minutes asked
 * for. Either way the segments are made to add up to the length asked for.
 *
 * Pure and server-safe: the AI task's fallback runs it on both sides.
 */

import {
  agendaLabel,
  splitSeconds,
  templateSegments,
  type AgendaId,
} from "@/app/(tools)/ceremony-timer/agenda";

export interface AgendaSegmentDraft {
  label: string;
  minutes: number;
  hint: string;
}

export interface AgendaDraftResult {
  title: string;
  segments: AgendaSegmentDraft[];
}

/** Words that point at each built-in agenda, most telling first. */
const KEYWORDS: readonly [AgendaId, RegExp][] = [
  ["retro", /\b(retro|retrospective|lessons learn\w*|look(ing)? back|went well|improve\w*)\b/gi],
  ["daily", /\b(daily|stand-?ups?|daily scrum|check-?ins?|sync)\b/gi],
  ["planning", /\b(sprint planning|plan(ning)?|commit\w*|forecast\w*|capacity)\b/gi],
  ["refinement", /\b(refine\w*|groom\w*|backlog|estimat\w*|stor(y|ies)|split\w*)\b/gi],
  ["review", /\b(review|demo\w*|showcase|stakeholders?|feedback)\b/gi],
  [
    "one-two-four-all",
    /\b(ideas?|brainstorm\w*|ideat\w*|options?|workshop|explore|decide|decision)\b/gi,
  ],
];

/**
 * The built-in agenda whose words the goal uses most (ties go to the one
 * listed first); 1-2-4-All, which suits any question, when none match.
 */
export function nearestTemplate(goal: string): AgendaId {
  let best: AgendaId = "one-two-four-all";
  let bestScore = 0;
  for (const [id, re] of KEYWORDS) {
    const score = (goal.match(re) ?? []).length;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Segments rescaled so they add up to `totalMinutes` exactly, keeping their
 * proportions (whole minutes where the total allows, else half minutes,
 * never below half a minute each when the total has room).
 */
export function fitToTotal<T extends { minutes: number }>(
  segments: readonly T[],
  totalMinutes: number
): T[] {
  if (segments.length === 0) return [];
  const seconds = splitSeconds(
    Math.round(totalMinutes * 60),
    segments.map((s) => (Number.isFinite(s.minutes) && s.minutes > 0 ? s.minutes : 1))
  );
  // Half minutes at most: the Ceremony Timer's editor works in half minutes.
  const halves = seconds.map((s) => Math.max(30, Math.round(s / 30) * 30));
  const drift = Math.round(totalMinutes * 60) - halves.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    const biggest = halves.indexOf(Math.max(...halves));
    halves[biggest] = Math.max(30, halves[biggest] + drift);
  }
  return segments.map((s, i) => ({ ...s, minutes: halves[i] / 60 }));
}

/** The agenda without AI: the nearest built-in one, split over `minutes`. */
export function fallbackAgenda({
  goal,
  minutes,
}: {
  goal: string;
  minutes: number;
}): AgendaDraftResult {
  const id = nearestTemplate(goal);
  const segments = templateSegments(id, minutes).map((s) => ({
    label: s.label,
    minutes: Math.max(0.5, s.seconds / 60),
    hint: s.hint,
  }));
  return { title: agendaLabel(id), segments: fitToTotal(segments, minutes) };
}
