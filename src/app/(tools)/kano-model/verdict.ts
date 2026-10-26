import { listAnd } from "@/lib/charts/chart-text";
import type { RankedRow } from "@/lib/prioritization/rank";
import { coefText, compareFeatures, kanoGroups, shortName, type FeatureView } from "./model";

/** Features named in one clause; the rest are counted. */
const NAMED = 2;

const quoted = (f: FeatureView) => `“${shortName(f.ranked.row.title)}”`;

/** "“A” and “B”", or "“A”, “B” and 3 more". */
function names(features: readonly FeatureView[]): string {
  const shown = features.slice(0, NAMED).map(quoted);
  const more = features.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : listAnd(shown);
}

/**
 * The answer over the list: what customers expect (cover it first), what
 * delights them, what got contradictory answers, and what still needs
 * answers. Features are named in list order (the most missed first).
 *
 *   "Cover “SSO” and “Export” first (Must-be); “Dark mode” delights
 *    (Better 0.71); “Sounds” got contradictory answers: check the
 *    question; 2 need more answers."
 */
export function kanoVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No features yet.";
  const g = Object.fromEntries(
    kanoGroups([...rows].sort(compareFeatures)).map((x) => [x.id, x.features])
  ) as Record<string, FeatureView[]>;
  const sorted = rows.length - g["needs-more"].length - g.unanswered.length;
  if (sorted === 0) {
    if (g["needs-more"].length > 0) {
      return `${g["needs-more"].length === 1 ? "The feature needs" : `All ${g["needs-more"].length} features with answers need`} more answers: a category shows from 3.`;
    }
    return rows.length === 1
      ? "Answer both questions about the feature, or run a survey, to find its category."
      : `Answer both questions about the ${rows.length} features, or run a survey, to find their categories.`;
  }

  const parts: string[] = [];
  if (g["must-be"].length > 0) parts.push(`Cover ${names(g["must-be"])} first (Must-be)`);
  else if (g.performance.length > 0) parts.push(`Invest in ${names(g.performance)} (Performance)`);
  const delight = g.attractive[0];
  if (delight) {
    const better = delight.coefficients ? ` (Better ${coefText(delight.coefficients.better)})` : "";
    parts.push(`${quoted(delight)} delights${better}`);
  }
  if (g.questionable.length > 0) {
    parts.push(
      `${names(g.questionable)} got contradictory answers: check the question${g.questionable.length === 1 ? "" : "s"}`
    );
  }
  if (g.reverse.length > 0) {
    parts.push(`${names(g.reverse)} ${g.reverse.length === 1 ? "puts" : "put"} some customers off`);
  }
  if (parts.length === 0 && g.indifferent.length > 0) {
    parts.push(`Customers don't mind ${names(g.indifferent)} either way`);
  }
  const more = g["needs-more"].length;
  if (more > 0) parts.push(`${more} ${more === 1 ? "needs" : "need"} more answers`);
  const none = g.unanswered.length;
  if (none > 0) parts.push(`${none} not answered yet`);
  return `${parts.join("; ")}.`;
}
