/**
 * The next steps of Product Goal, Backlog Health and Interrupt Buffer, as
 * pure builders over workspace slices. `RULES` in lib/tools/next-steps.ts
 * wires each to its tool (`select` there passes the store's own values,
 * never arrays built on the fly); the logic and its tests live here.
 *
 * Each points somewhere else that matters now, ignores example rows, and
 * stays quiet when nothing applies.
 */

import type {
  BacklogItem,
  InterruptItem,
  ProductGoal,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { pickDefaultSprint, todayIso } from "@/lib/sprints/series";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import { activeGoal, daysToTarget } from "@/lib/product-goal/model";
import { backlogForHealth, backlogHealth } from "@/lib/backlog/health";
import { interruptBufferStatus, pointsText } from "@/lib/sprints/interrupts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const real = <T extends { id: string }>(xs: readonly T[] | undefined): T[] =>
  (xs ?? []).filter((x) => !isExampleId(x.id));

/** The sprint a step is about: the active one, else the newest planned. */
function focusSprint(sprints: readonly Sprint[] | undefined): Sprint | undefined {
  const s = pickDefaultSprint(real(sprints), null);
  return s && (s.status === "active" || s.status === "planned") ? s : undefined;
}

/* ── Product Goal ───────────────────────────────────────────────────── */

export function productGoalSteps({
  goals,
  sprints,
  stories,
  today = todayIso(),
}: {
  goals: readonly ProductGoal[] | undefined;
  sprints: readonly Sprint[] | undefined;
  stories: readonly Story[] | undefined;
  today?: string;
}): NextStep[] {
  const goal = activeGoal(goals);
  if (!goal) return [];
  const steps: NextStep[] = [];
  const sprint = focusSprint(sprints);
  if (sprint && !sprint.goal?.trim()) {
    steps.push({
      id: "product-goal-sprint-goal",
      label: `Write ${sprint.name}'s goal towards it`,
      detail: "The sprint has no goal yet. Say which part of the Product Goal it moves.",
      href: sprintHref("/sprint-goal", sprint.id),
    });
  }
  const backlog = backlogForHealth(real(stories));
  if (backlog.length > 0) {
    steps.push({
      id: "product-goal-backlog",
      label: "Check the backlog serves it",
      detail: `${plural(backlog.length, "story", "stories")} in the backlog. A healthy one is the work that gets you to the goal.`,
      href: "/backlog-health",
    });
  }
  const days = daysToTarget(goal.targetDate, today);
  if (days !== null && days < 0) {
    steps.push({
      id: "product-goal-past-target",
      label: "Review the goal at the Sprint Review",
      detail: `Its target date passed ${plural(-days, "day")} ago: reached, changed or dropped?`,
      href: "/sprint-review",
    });
  }
  return steps;
}

/* ── Backlog Health ─────────────────────────────────────────────────── */

export function backlogHealthSteps({
  stories,
  backlogItems,
  goals,
  today = todayIso(),
}: {
  stories: readonly Story[] | undefined;
  backlogItems: readonly BacklogItem[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  today?: string;
}): NextStep[] {
  const backlog = backlogForHealth(real(stories), backlogItems);
  if (backlog.length === 0) return [];
  const health = backlogHealth(backlog, { today });
  const top = health.stories.filter((s) => s.top);
  const has = (id: string) => (s: (typeof health.stories)[number]) =>
    s.flags.some((f) => f.id === id);
  const steps: NextStep[] = [];
  const unsized = top.filter(has("no-points")).length;
  if (unsized > 0) {
    steps.push({
      id: "backlog-health-estimate",
      label: `Estimate ${plural(unsized, "story", "stories")} in Planning Poker`,
      detail: `Near the top of the backlog with no points: Sprint Planning can't weigh ${unsized === 1 ? "it" : "them"}.`,
      href: "/planning-poker",
    });
  }
  const unready = top.filter((s) => has("no-criteria")(s) || has("vague")(s)).length;
  if (unready > 0) {
    steps.push({
      id: "backlog-health-refine",
      label: "Refine the top of the backlog",
      detail: `${plural(unready, "story", "stories")} near the top ${unready === 1 ? "needs" : "need"} acceptance criteria or a clearer title.`,
      href: "/refinement",
    });
  }
  const stale = health.stories.filter(has("stale")).length;
  if (stale > 0) {
    steps.push({
      id: "backlog-health-stale",
      label: "Decide on the stale stories",
      detail: `${plural(stale, "story", "stories")} untouched for weeks: refine or drop ${stale === 1 ? "it" : "them"} at the next refinement.`,
      href: "/refinement",
    });
  }
  if (!activeGoal(goals)) {
    steps.push({
      id: "backlog-health-product-goal",
      label: "Write the Product Goal the backlog serves",
      detail: "No goal says what the backlog is for, so the order has nothing to follow.",
      href: "/product-goal",
    });
  }
  return steps;
}

/* ── Interrupt Buffer ───────────────────────────────────────────────── */

export function interruptBufferSteps({
  sprints,
  items,
}: {
  sprints: readonly Sprint[] | undefined;
  items: readonly InterruptItem[] | undefined;
}): NextStep[] {
  const all = real(items);
  const steps: NextStep[] = [];
  const sprint = focusSprint(sprints);
  if (sprint) {
    const status = interruptBufferStatus(sprint, all);
    if (status.over && sprint.status === "active") {
      steps.push({
        id: "interrupt-buffer-over",
        label: "Re-plan with the Product Owner in the cockpit",
        detail: `${sprint.name}'s buffer is spent: ${status.summary}`,
        href: sprintHref("/sprint", sprint.id),
      });
    } else if (!status.set) {
      const earlier = real(sprints).some(
        (s) => s.id !== sprint.id && all.some((i) => i.sprintId === s.id)
      );
      if (earlier) {
        steps.push({
          id: "interrupt-buffer-plan",
          label: `Keep a buffer in ${sprint.name}'s plan`,
          detail: "Earlier sprints had interrupts, and this one keeps nothing free for them.",
          href: sprintHref("/sprint-planning", sprint.id),
        });
      }
    }
  }
  const finished = real(sprints)
    .filter((s) => s.status === "completed")
    .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  if (finished) {
    const st = interruptBufferStatus(finished, all);
    if (st.total > 0) {
      steps.push({
        id: "interrupt-buffer-retro",
        label: "Look at where the interrupts came from at the retro",
        detail: `${finished.name} logged ${plural(st.total, "interrupt")}, ${pointsText(st.usedPoints)}.`,
        href: "/retro",
      });
    }
  }
  return steps;
}
