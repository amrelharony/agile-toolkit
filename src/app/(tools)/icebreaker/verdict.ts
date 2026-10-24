import { plural } from "@/lib/charts/chart-text";
import type { RelaxableFilter } from "./filter";

/** The filters by the names on the page, for "remove the … filter". */
export const FILTER_NAME: Record<RelaxableFilter, string> = {
  people: "People",
  maxMinutes: "Time",
  energy: "Energy",
  category: "Category",
  favoritesOnly: "Favorites only",
};

export interface IcebreakerVerdictInput {
  /** Activities offered. */
  matches: number;
  /** Headcount filtered on; null for any size. */
  people: number | null;
  /** "Up to N minutes"; null for any length. */
  maxMinutes: number | null;
  /** Matches left out because they were used in the last two weeks. */
  hiddenRecent: number;
  /** When nothing matches: the filter that would bring the most back. */
  relax?: { filter: RelaxableFilter; count: number } | null;
}

/**
 * The one-sentence answer above the cards: how many activities fit the
 * group and the time, what "used recently" hides, and with no match, which
 * filter to relax.
 */
export function icebreakerVerdict({
  matches,
  people,
  maxMinutes,
  hiddenRecent,
  relax,
}: IcebreakerVerdictInput): string {
  const time = maxMinutes !== null ? `in up to ${plural(maxMinutes, "minute")}` : "";
  const fits = (n: number) => (n === 1 ? "fits" : "fit");
  const scope = [people !== null ? plural(people, "person", "people") : "", time]
    .filter(Boolean)
    .join(" ");

  if (matches === 0) {
    if (hiddenRecent > 0) {
      return hiddenRecent === 1
        ? "The only match was used in the last two weeks."
        : `All ${hiddenRecent} matches were used in the last two weeks.`;
    }
    const lead = scope ? `Nothing fits ${scope}` : "Nothing matches your filters";
    if (!relax) return `${lead}. Clear the filters to see every activity.`;
    return `${lead}. Remove the ${FILTER_NAME[relax.filter]} filter to see ${relax.count}.`;
  }

  const what = plural(matches, "activity", "activities");
  const lead = scope
    ? `${what} ${fits(matches)} ${scope}`
    : `${what} ${matches === 1 ? "matches" : "match"} your filters`;
  if (hiddenRecent === 0) return `${lead}.`;
  return `${lead}; ${hiddenRecent} used in the last two weeks ${hiddenRecent === 1 ? "is" : "are"} hidden.`;
}
