import type { LsPurpose, LsStructure } from "@/lib/liberating-structures/catalog";
import type { CeremonyKind } from "@/lib/sprints/cadence";
import { plural } from "@/lib/charts/chart-text";
import type { LsFilters, RelaxableLsFilter, TimingBucket } from "./filters";

const PURPOSE_PHRASE: Record<LsPurpose, string> = {
  ideas: "to generate ideas",
  connect: "to connect people",
  plan: "to plan the work",
  "get-help": "to get help with a challenge",
  prioritize: "to prioritize",
  "make-sense": "to make sense of a challenge",
  "stop-doing": "to stop what holds you back",
  "self-organize": "to self-organize",
};

const CEREMONY_PHRASE: Record<CeremonyKind, string> = {
  planning: "in Sprint Planning",
  daily: "in a Daily Scrum",
  refinement: "in refinement",
  review: "in a Sprint Review",
  retro: "in a retro",
};

const TIMING_PHRASE: Record<TimingBucket, string> = {
  "under 15 min": "in under 15 minutes",
  "15-30 min": "in 15 to 30 minutes",
  "30+ min": "in 30 minutes or more",
};

/** The filters by the names on the page, for "remove the … filter". */
export const LS_FILTER_NAME: Record<RelaxableLsFilter, string> = {
  people: "People",
  purpose: "Purpose",
  ceremony: "Ceremony",
  timing: "Timing",
};

/** "12 people to generate ideas in a retro in under 15 minutes" (the parts that are set). */
function scope(f: LsFilters): string {
  return [
    f.people !== null ? plural(f.people, "person", "people") : "",
    f.purpose ? PURPOSE_PHRASE[f.purpose] : "",
    f.ceremony ? CEREMONY_PHRASE[f.ceremony] : "",
    f.timing ? TIMING_PHRASE[f.timing] : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The one-sentence answer above the cards: how many structures fit, and
 * which is quickest to run; with none, which filter to relax.
 */
export function lsVerdict({
  matches,
  filters,
  relax,
}: {
  matches: readonly LsStructure[];
  filters: LsFilters;
  relax?: { filter: RelaxableLsFilter; count: number } | null;
}): string {
  const where = scope(filters);
  if (matches.length === 0) {
    const lead = where ? `No structure fits ${where}` : "No structure matches";
    if (!relax) return `${lead}. Clear the filters to see all of them.`;
    return `${lead}. Remove the ${LS_FILTER_NAME[relax.filter]} filter to see ${relax.count}.`;
  }
  const quickest = matches.reduce((a, b) => (b.timingMinutes < a.timingMinutes ? b : a));
  if (!where) {
    return `${plural(matches.length, "structure")} to choose from; ${quickest.name} is the quickest (${quickest.timing}).`;
  }
  if (matches.length === 1) {
    return `1 structure fits ${where}: ${quickest.name} (${quickest.timing}).`;
  }
  return `${matches.length} structures fit ${where}; ${quickest.name} is the quickest (${quickest.timing}).`;
}
