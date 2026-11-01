/**
 * The retro facts (lib/retro/facts) as plain sentences, one per fact, each
 * with the tool it was read from. Shared by the facts panel and the
 * Markdown export so both say the same thing.
 *
 * A fact without data says so ("No mood check-ins this sprint") instead of
 * showing a zero that reads like a finding, and marks itself `missing` so
 * the panel can mute it.
 */

import { needMore } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import { GOAL_OUTCOME_LABEL } from "@/lib/sprints/goal-doc";
import { SAY_DO_GRADE_LABEL } from "@/lib/sprints/metrics";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { RetroFacts } from "@/lib/retro/facts";
import type { SprintGoalOutcome } from "@/lib/stores/workspace-types";

export type FactKey =
  | "goal"
  | "sayDo"
  | "burndown"
  | "dates"
  | "impediments"
  | "mood"
  | "followThrough"
  | "kudos";

export interface FactLine {
  key: FactKey;
  label: string;
  sentence: string;
  /** No data behind it: the sentence says what's missing. */
  missing: boolean;
  /** Where the fact comes from; absent in the example, whose links would leave it. */
  href?: string;
  /** The tool's name, for the link. */
  tool: string;
}

const GOAL_VERB: Record<SprintGoalOutcome["met"], string> = {
  met: "met its goal",
  partly: "partly met its goal",
  "not-met": "didn't meet its goal",
};

/** "Sprint 12 partly met its goal", for the verdict. */
export function goalClause(sprintName: string, outcome: SprintGoalOutcome | null): string | null {
  return outcome ? `${sprintName} ${GOAL_VERB[outcome.met]}` : null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function goalLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const base = { key: "goal" as const, label: "Sprint goal" };
  if (!f.goal) return { ...base, sentence: `${f.sprintName} had no sprint goal.`, missing: true };
  const outcome = f.goalOutcome;
  if (!outcome) {
    return {
      ...base,
      sentence: `“${f.goal}”: whether it was met isn't answered yet.`,
      missing: true,
    };
  }
  const note = outcome.note?.trim();
  return {
    ...base,
    sentence: `${GOAL_OUTCOME_LABEL[outcome.met]}: “${f.goal}”${note ? ` (${note})` : ""}.`,
    missing: false,
  };
}

function sayDoLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const base = { key: "sayDo" as const, label: "Say/do" };
  if (f.committed <= 0) {
    return { ...base, sentence: `No points were committed to ${f.sprintName}.`, missing: true };
  }
  if (!f.sayDo) {
    return {
      ...base,
      sentence: `${plural(f.committed, "point")} committed; the points done aren't recorded yet.`,
      missing: true,
    };
  }
  // Not from the stories: typed on the sprint, or recorded when it started and closed.
  const source = f.fromStories ? "" : " (as recorded on the sprint)";
  return {
    ...base,
    sentence: `${fmt(f.completed)} of ${plural(f.committed, "committed point")} done${source}: say/do ${f.sayDo.pct}%, ${SAY_DO_GRADE_LABEL[f.sayDo.grade].toLowerCase()}.`,
    missing: false,
  };
}

function burndownLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const base = { key: "burndown" as const, label: "Burndown" };
  if (!f.burndown) {
    return {
      ...base,
      sentence: `No pointed stories in ${f.sprintName}, so there's no burndown to read.`,
      missing: true,
    };
  }
  // "No pointed story was finished" is a finding, not missing data.
  return { ...base, sentence: f.burndown.sentence, missing: false };
}

function impedimentsLine(f: RetroFacts, recorded: boolean): Omit<FactLine, "href" | "tool"> {
  const { raised, resolvedInSprint, stillOpen, escalated } = f.impediments;
  const base = { key: "impediments" as const, label: "Impediments" };
  // None raised is a finding only when the team logs impediments at all.
  if (raised === 0 && !recorded) {
    return { ...base, sentence: "No impediments recorded in Impediments yet.", missing: true };
  }
  if (raised === 0) {
    return {
      ...base,
      sentence: `No impediments were raised during ${f.sprintName}.`,
      missing: false,
    };
  }
  const parts = [
    `${fmt(resolvedInSprint)} resolved by its last day`,
    `${fmt(stillOpen)} still open`,
  ];
  if (escalated > 0) parts.push(`${fmt(escalated)} escalated`);
  return {
    ...base,
    sentence: `${plural(raised, "impediment")} raised during the sprint: ${parts.join(", ")}.`,
    missing: false,
  };
}

function moodLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const { average, checkIns, people } = f.mood;
  const anonymous = f.mood.anonymous ?? 0;
  const base = { key: "mood" as const, label: "Mood" };
  if (checkIns === 0) return { ...base, sentence: "No mood check-ins this sprint.", missing: true };
  if (average === null) {
    const more = needMore(checkIns, "average");
    return {
      ...base,
      sentence: `Only ${plural(checkIns, "mood check-in")} this sprint: ${fmt(more)} more before an average means much.`,
      missing: true,
    };
  }
  // `people` counts only who checked in by name: anonymous pulse answers are
  // said apart, as Sprint Comparison says them, never as "by 0 people".
  const named = checkIns - anonymous;
  const who =
    anonymous === 0
      ? ` by ${plural(people, "person", "people")}`
      : named === 0
        ? ", all anonymous"
        : ` (${fmt(anonymous)} anonymous, ${fmt(named)} by ${plural(people, "person", "people")})`;
  return {
    ...base,
    sentence: `Average mood ${fmt(average)} out of 5, from ${plural(checkIns, "check-in")}${who}.`,
    missing: false,
  };
}

function followThroughLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const base = { key: "followThrough" as const, label: "Last retro's actions" };
  const ft = f.followThrough;
  if (!ft) return { ...base, sentence: "No earlier retro to follow up on.", missing: true };
  if (ft.agreed === 0) {
    return {
      ...base,
      sentence: `The last retro (${ft.retroLabel}) agreed no actions.`,
      missing: true,
    };
  }
  const parts: string[] = [];
  if (ft.carried > 0) parts.push(`${fmt(ft.carried)} carried over`);
  if (ft.open > 0) parts.push(`${fmt(ft.open)} still open`);
  return {
    ...base,
    sentence: `${fmt(ft.done)} of ${plural(ft.agreed, "action")} from the last retro done (${pct(ft.rate ?? 0)})${parts.length ? `, ${parts.join(", ")}` : ""}.`,
    missing: false,
  };
}

function kudosLine(f: RetroFacts): Omit<FactLine, "href" | "tool"> {
  const n = f.kudos.length;
  const base = { key: "kudos" as const, label: "Kudos" };
  if (n === 0) {
    return { ...base, sentence: `No kudos were given during ${f.sprintName}.`, missing: true };
  }
  return {
    ...base,
    sentence: `${fmt(n)} kudos given during the sprint, ready for the appreciations column.`,
    missing: false,
  };
}

/**
 * Each fact as a sentence and the tool it comes from. A sprint without real
 * dates gets one "set its dates" line in place of the facts that need them
 * (the burndown, impediments, mood, kudos). `links: false` (the example)
 * leaves the links off. `impedimentsRecorded: false` (the team has never
 * logged one) says so rather than report none raised as a finding.
 */
export function factLines(
  facts: RetroFacts,
  {
    links = true,
    impedimentsRecorded = true,
  }: { links?: boolean; impedimentsRecorded?: boolean } = {}
): FactLine[] {
  const id = facts.sprintId;
  const link = (href: string) => (links ? { href } : {});
  const lines: FactLine[] = [
    { ...goalLine(facts), tool: "Sprint Goal", ...link(sprintHref("/sprint-goal", id)) },
    { ...sayDoLine(facts), tool: "Sprint Cockpit", ...link(sprintHref("/sprint", id)) },
  ];
  if (facts.dated) {
    lines.push(
      { ...burndownLine(facts), tool: "Burndown", ...link(sprintHref("/burndown", id)) },
      {
        ...impedimentsLine(facts, impedimentsRecorded),
        tool: "Impediments",
        ...link("/impediments"),
      },
      { ...moodLine(facts), tool: "Mood Tracker", ...link("/mood-tracker") }
    );
  } else {
    // Without dates the burndown can't be read either: it would be read
    // against no days, or against the old placeholder dates.
    lines.push({
      key: "dates",
      label: "Dates",
      sentence: `${facts.sprintName} has no dates yet, so its burndown and the impediments, mood and kudos from it can't be read.`,
      missing: true,
      tool: "Sprint Cockpit",
      ...link(sprintHref("/sprint", id)),
    });
  }
  lines.push({ ...followThroughLine(facts), tool: "Retro Actions", ...link("/retro-actions") });
  if (facts.dated) lines.push({ ...kudosLine(facts), tool: "Kudos", ...link("/kudos") });
  return lines;
}
