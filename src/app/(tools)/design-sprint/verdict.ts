import type { DesignSprintDayNumber, DesignSprintPlan } from "@/lib/stores/workspace-types";
import type { DesignSprintToday } from "@/lib/design-sprint/day";
import { DESIGN_SPRINT_DAY_NAMES } from "@/lib/design-sprint/plan";
import { plural } from "@/lib/charts/chart-text";
import { dayOutputs, dayTasks, findingsSent, longDay, planDay, type FindingsSent } from "./doc";

/** Today's headline output, set or still missing: "decision recorded", "no sketches yet". */
function dayOutputClause(plan: Pick<DesignSprintPlan, "days">, day: DesignSprintDayNumber): string {
  const outputs = dayOutputs(planDay(plan, day));
  const count = (kind: string) => outputs.filter((o) => o.kind === kind).length;
  switch (day) {
    case 1: {
      if (count("long-term-goal") === 0) return "no long-term goal yet";
      return count("target") > 0 ? "goal and target set" : "goal set, no target picked yet";
    }
    case 2: {
      const n = count("sketch");
      return n > 0 ? plural(n, "sketch", "sketches") : "no sketches yet";
    }
    case 3:
      return count("decision") > 0 ? "decision recorded" : "no decision recorded yet";
    case 4:
      return count("prototype") > 0 ? "prototype ready" : "no prototype yet";
    case 5: {
      const n = count("finding");
      return n > 0 ? plural(n, "finding") : "no findings yet";
    }
  }
}

/** "2 sent to the Hypothesis Tracker and 1 to the backlog", or "none sent on yet". */
export function sentClause(s: FindingsSent): string {
  if (s.hypotheses > 0 && s.stories > 0) {
    return `${s.hypotheses} sent to the Hypothesis Tracker and ${s.stories} to the backlog`;
  }
  if (s.hypotheses > 0) return `${s.hypotheses} sent to the Hypothesis Tracker`;
  if (s.stories > 0) return `${s.stories} sent to the backlog`;
  return "none sent on yet";
}

/**
 * The one sentence above the days: where the sprint stands today and what
 * it has produced. "Day 3 of 5 (Decide): 2 of 5 tasks done, no decision
 * recorded yet." / "Starts Monday 27 Oct, in 2 working days." / "Finished:
 * 4 findings, 2 sent to the Hypothesis Tracker."
 */
export function designSprintVerdict(
  plan: Pick<DesignSprintPlan, "days" | "completedAt">,
  t: DesignSprintToday
): string {
  const sent = findingsSent(plan);
  const findings = sent.total > 0 ? `${plural(sent.total, "finding")}, ${sentClause(sent)}` : null;

  if (plan.completedAt) {
    return findings ? `Finished: ${findings}.` : "Finished, with no findings recorded.";
  }
  if (t.dates.length === 0) return "Set a valid start date to place the five days.";
  if (t.status === "over") {
    return findings
      ? `All five days are over: ${findings}.`
      : "All five days are over, with no findings recorded yet.";
  }
  if (t.status === "upcoming" || !t.day) {
    const when =
      t.startsIn === undefined || t.startsIn <= 1
        ? "the next working day"
        : `in ${t.startsIn} working days`;
    return `Starts ${longDay(t.dates[0])}, ${when}.`;
  }

  const tasks = dayTasks(planDay(plan, t.day));
  const done = tasks.filter((x) => x.done).length;
  const taskClause =
    tasks.length === 0 ? "no tasks" : `${done} of ${plural(tasks.length, "task")} done`;
  return `Day ${t.day} of 5 (${DESIGN_SPRINT_DAY_NAMES[t.day]}): ${taskClause}, ${dayOutputClause(
    plan,
    t.day
  )}.`;
}
