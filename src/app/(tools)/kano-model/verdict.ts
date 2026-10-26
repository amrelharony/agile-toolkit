import { listAnd, plural } from "@/lib/charts/chart-text";
import { KANO_CATEGORIES, KANO_MIN_RESPONSES } from "@/lib/prioritization/methods/kano";
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
 * Categories that come from one person's answer pair, not a survey, are
 * counted at the end, so a lone Must-be isn't read as the customers' view.
 *
 *   "Cover “SSO” and “Export” first (Must-be); “Dark mode” delights
 *    (Better 0.71); “Sounds” got contradictory answers: check the
 *    question; 1 category comes from one person's answers: survey
 *    customers to confirm it; 2 need more answers."
 */
export function kanoVerdict(rows: readonly RankedRow[]): string {
  if (rows.length === 0) return "No features yet.";
  const g = Object.fromEntries(
    kanoGroups([...rows].sort(compareFeatures)).map((x) => [x.id, x.features])
  ) as Record<string, FeatureView[]>;
  const sorted = rows.length - g["needs-more"].length - g.unanswered.length;
  if (sorted === 0) {
    const few = g["needs-more"];
    if (few.length > 0) {
      const lead =
        few.length === 1
          ? `${quoted(few[0])} needs ${plural(Math.max(1, KANO_MIN_RESPONSES - few[0].n), "more answer")} for a category`
          : `${names(few)} need more answers: a category shows from ${KANO_MIN_RESPONSES}`;
      const none = g.unanswered.length;
      return none > 0 ? `${lead}; ${none} not answered yet.` : `${lead}.`;
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
  const fromPair = KANO_CATEGORIES.reduce((n, c) => n + g[c].filter((f) => f.fromPair).length, 0);
  if (fromPair > 0) {
    parts.push(
      fromPair === 1
        ? "1 category comes from one person's answers: survey customers to confirm it"
        : `${fromPair} categories come from one person's answers: survey customers to confirm them`
    );
  }
  const more = g["needs-more"].length;
  if (more > 0) parts.push(`${more} ${more === 1 ? "needs" : "need"} more answers`);
  const none = g.unanswered.length;
  if (none > 0) parts.push(`${none} not answered yet`);
  return `${parts.join("; ")}.`;
}
