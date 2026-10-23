/**
 * Data-aware next steps: where a tool's result should go next.
 *
 * "More in <section>" under every tool is positional — the next four tools
 * in the list, whatever is on the page. A next step reads the workspace and
 * points somewhere that matters now ("3 stories unsized → Planning Poker").
 * `<NextStepCard>` (components/tool-frame/next-step) renders the first one
 * that applies above the related-tools list; a tool can also render
 * `<NextStepCard>` inline next to its result.
 *
 * Each rule picks the workspace slices it needs (`select`, compared
 * shallowly, so it must return store values — not arrays built on the fly)
 * and turns them into steps, most useful first. Tools join as their phase
 * of the tool upgrade lands (plan: tool UX contract, item 8).
 */

import type { Sprint, Story, Workspace } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import { edgeStatus, isOverdue, validEdges } from "@/lib/dependencies/edges";
import { findCapacityPlan, pointsForecast } from "@/lib/sprints/capacity";
import { velocity } from "@/lib/sprints/metrics";
import { carryOver } from "@/lib/sprints/progress";
import { todayIso } from "@/lib/sprints/series";
import { pickDefaultSprint, sprintHref } from "@/lib/sprints/use-selected-sprint";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";

export interface NextStep {
  /** Stable id, for keys and tests. */
  id: string;
  /** What to do, imperative: "Compare across methods". */
  label: string;
  /** Why now, from the data: "4 ICE ideas are on the backlog." */
  detail?: string;
  href: string;
}

export interface NextStepRule<S extends object> {
  select: (ws: Workspace) => S;
  steps: (slices: S) => NextStep[];
}

const rule = <S extends object>(r: NextStepRule<S>) => r as unknown as NextStepRule<object>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "is" / "are" for a count. */
const be = (n: number) => (n === 1 ? "is" : "are");

const real = <T extends { id: string }>(xs: readonly T[] | undefined): T[] =>
  (xs ?? []).filter((x) => !isExampleId(x.id));

const isOpenSprint = (s: Sprint) => s.status === "planned" || s.status === "active";

/** The sprint a planning step is about: the active one, else the newest not cancelled. */
function focusSprint(sprints: readonly Sprint[] | undefined): Sprint | undefined {
  const s = pickDefaultSprint(real(sprints), null);
  return s && isOpenSprint(s) ? s : undefined;
}

const unestimated = (s: Story) => !(typeof s.points === "number" && s.points > 0);

/** Backlog stories: not done, not planned into a sprint. */
const inBacklog = (s: Story) => !s.sprintId && s.status !== "done";

const fromTool = (s: Story, tool: string) => s.sourceRef?.tool === tool;

/** Completed sprints, for velocity (example sprints left out). */
const completed = (sprints: readonly Sprint[] | undefined) =>
  real(sprints).filter((s) => s.status === "completed");

const RULES: Record<string, NextStepRule<object>> = {
  "sprint-planning": rule({
    select: (ws) => ({ sprints: ws.sprints, stories: ws.stories }),
    steps: ({ sprints, stories }) => {
      const all = real(stories);
      const steps: NextStep[] = [];
      for (const closed of real(sprints).filter(
        (s) => s.status === "completed" || s.status === "cancelled"
      )) {
        const left = carryOver(closed, all);
        if (left.stories.length === 0) continue;
        steps.push({
          id: "planning-carry-over",
          label: "Carry over unfinished stories",
          detail: `${closed.name} left ${plural(left.stories.length, "story", "stories")} (${plural(left.points, "point")}) unfinished. Carry them into the next sprint or send them back to the backlog.`,
          href: "/sprint-planning",
        });
        break;
      }
      const sprint = focusSprint(sprints);
      if (sprint) {
        const planned = all.filter((s) => s.sprintId === sprint.id);
        const unsized = planned.filter(unestimated);
        if (unsized.length > 0) {
          steps.push({
            id: "planning-estimate",
            label: "Estimate the unsized stories",
            detail: `${plural(unsized.length, "story", "stories")} planned into ${sprint.name} ${unsized.length === 1 ? "has" : "have"} no points, so the commitment can't be weighed.`,
            href: "/planning-poker",
          });
        }
        if (sprint.status === "active" && planned.length > 0) {
          steps.push({
            id: "planning-cockpit",
            label: "Run the sprint from the cockpit",
            detail: `${sprint.name} is under way with ${plural(planned.length, "story", "stories")}.`,
            href: sprintHref("/sprint", sprint.id),
          });
        }
      }
      return steps;
    },
  }),

  "capacity-planner": rule({
    select: (ws) => ({ sprints: ws.sprints, plans: ws.capacityPlans }),
    steps: ({ sprints, plans }) => {
      const sprint = focusSprint(sprints);
      if (!sprint) return [];
      const found = findCapacityPlan(plans, sprint.id);
      if (!found?.perSprint || real(found.plan.members).length === 0) return [];
      const { ratio, points } = pointsForecast(found.plan, velocity(completed(sprints)).average);
      return [
        {
          id: "capacity-plan-sprint",
          label: "Plan the sprint with this capacity",
          detail:
            ratio !== null && points !== null
              ? `Capacity is ${Math.round(ratio * 100)}% of a normal sprint, so plan about ${plural(points, "point")} in ${sprint.name}.`
              : `${sprint.name} has its own capacity plan. Use it to size the commitment.`,
          href: sprintHref("/sprint-planning", sprint.id),
        },
      ];
    },
  }),

  "sprint-goal": rule({
    select: (ws) => ({ sprints: ws.sprints, stories: ws.stories }),
    steps: ({ sprints, stories }) => {
      const sprint = focusSprint(sprints);
      if (!sprint?.goal?.trim()) return [];
      const planned = real(stories).filter((s) => s.sprintId === sprint.id).length;
      return [
        {
          id: "goal-plan",
          label: `Plan ${sprint.name} around its goal`,
          detail:
            planned === 0
              ? `${sprint.name} has a goal but no stories yet. Pick the ones that serve it.`
              : `${plural(planned, "story", "stories")} ${be(planned)} planned into ${sprint.name}. Check each one serves the goal.`,
          href: sprintHref("/sprint-planning", sprint.id),
        },
      ];
    },
  }),

  "planning-poker": rule({
    select: (ws) => ({ stories: ws.stories }),
    steps: ({ stories }) => {
      const saved = real(stories).filter((s) => fromTool(s, "planning-poker") && inBacklog(s));
      return saved.length === 0
        ? []
        : [
            {
              id: "poker-plan",
              label: "Plan the estimated stories into a sprint",
              detail: `${plural(saved.length, "story", "stories")} estimated in Planning Poker ${be(saved.length)} waiting in the backlog.`,
              href: "/sprint-planning",
            },
          ];
    },
  }),

  "estimation-guide": rule({
    select: (ws) => ({ logs: ws.pokerEstimationLogs }),
    steps: ({ logs }) => {
      const queue = (logs ?? []).find((d) => d.id === "pokerEstimationLog:current")?.queue ?? [];
      const waiting = real(queue).length;
      return waiting === 0
        ? []
        : [
            {
              id: "guide-poker",
              label: "Estimate the queue in Planning Poker",
              detail: `${plural(waiting, "story", "stories")} ${be(waiting)} waiting. The guide's reference stories show under the deck.`,
              href: "/planning-poker",
            },
          ];
    },
  }),

  refinement: rule({
    select: (ws) => ({ stories: ws.stories, logs: ws.pokerEstimationLogs }),
    steps: ({ stories, logs }) => {
      const steps: NextStep[] = [];
      const queued = real(
        (logs ?? []).find((d) => d.id === "pokerEstimationLog:current")?.queue ?? []
      ).length;
      if (queued > 0) {
        steps.push({
          id: "refinement-poker",
          label: "Estimate the queued stories",
          detail: `${plural(queued, "story", "stories")} ${be(queued)} waiting in Planning Poker.`,
          href: "/planning-poker",
        });
      }
      const ready = real(stories).filter(
        (s) => inBacklog(s) && s.readiness?.ready === true && !unestimated(s)
      ).length;
      if (ready > 0) {
        steps.push({
          id: "refinement-plan",
          label: "Plan the sprint with the ready stories",
          detail: `${plural(ready, "backlog story", "backlog stories")} ${be(ready)} ready to plan.`,
          href: "/sprint-planning",
        });
      }
      return steps;
    },
  }),

  "story-mapper": rule({
    select: (ws) => ({ maps: ws.storyMaps }),
    steps: ({ maps }) => {
      const map = (maps ?? []).find((m) => m.id === "story-mapper:current");
      if (!map) return [];
      const steps: NextStep[] = [];
      const cardsOf = (slice: (typeof map.slices)[number]) =>
        real(Object.values(slice.cards ?? {}).flat());
      const points = (estimate: string | undefined) => {
        const n = Number(estimate);
        return estimate && estimate.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
      };
      const unsized = map.slices.flatMap(cardsOf).filter((c) => points(c.estimate) === null);
      if (unsized.length > 0) {
        steps.push({
          id: "map-estimate",
          label: "Size the unestimated stories",
          detail: `${plural(unsized.length, "story", "stories")} on the map ${unsized.length === 1 ? "has" : "have"} no points. Queue them for Planning Poker so slice totals and the Release Planner can use them.`,
          href: "/planning-poker",
        });
      }
      const first = map.slices.find((sl) => cardsOf(sl).some((c) => points(c.estimate) !== null));
      if (first) {
        const total = cardsOf(first).reduce((sum, c) => sum + (points(c.estimate) ?? 0), 0);
        steps.push({
          id: "map-release",
          label: "Plan the first release",
          detail: `“${first.name}” totals ${plural(Math.round(total * 10) / 10, "point")}. See when it can ship at your velocity.`,
          href: `/release-planner?slice=${encodeURIComponent(first.id)}`,
        });
      }
      return steps;
    },
  }),

  "walking-skeleton": rule({
    select: (ws) => ({ stories: ws.stories }),
    steps: ({ stories }) => {
      const open = real(stories).filter(
        (s) => fromTool(s, "walking-skeleton") && s.status !== "done"
      ).length;
      return open === 0
        ? []
        : [
            {
              id: "skeleton-plan",
              label: "Plan the skeleton's remaining steps",
              detail: `${plural(open, "walking-skeleton step")} ${be(open)} waiting in the backlog. Pull them into the next sprint so the path runs end to end early.`,
              href: "/sprint-planning",
            },
          ];
    },
  }),

  "release-planner": rule({
    select: (ws) => ({ sprints: ws.sprints, stories: ws.stories }),
    steps: ({ sprints, stories }) => {
      const steps: NextStep[] = [];
      const closed = new Set(
        (sprints ?? [])
          .filter((s) => s.status === "completed" || s.status === "cancelled")
          .map((s) => s.id)
      );
      const unsized = real(stories).filter(
        (s) => s.status !== "done" && !(s.sprintId && closed.has(s.sprintId)) && unestimated(s)
      ).length;
      if (unsized > 0) {
        steps.push({
          id: "release-estimate",
          label: "Estimate the unsized stories",
          detail: `${plural(unsized, "open story", "open stories")} ${unsized === 1 ? "has" : "have"} no points, so the release forecast leaves ${unsized === 1 ? "it" : "them"} out.`,
          href: "/planning-poker",
        });
      }
      const history = completed(sprints).length;
      if (history < MIN_SAMPLE.forecast) {
        steps.push({
          id: "release-history",
          label: "Close sprints with their points",
          detail: `The forecast samples completed sprints and needs at least ${MIN_SAMPLE.forecast}; it has ${history}.`,
          href: "/velocity",
        });
      }
      return steps;
    },
  }),

  "jtbd-mapper": rule({
    select: (ws) => ({ jobs: ws.jobStories, stories: ws.stories }),
    steps: ({ jobs, stories }) => {
      const fromJobs = real(stories).filter(
        (s) => fromTool(s, "jtbd-mapper") && s.status !== "done"
      );
      const unsized = fromJobs.filter(unestimated).length;
      if (unsized > 0) {
        return [
          {
            id: "jobs-estimate",
            label: "Size the stories from your jobs",
            detail: `${plural(unsized, "backlog story", "backlog stories")} came from job stories and ${unsized === 1 ? "isn't" : "aren't"} estimated yet.`,
            href: "/planning-poker",
          },
        ];
      }
      const mapped = real(jobs).length;
      if (mapped >= 3 && fromJobs.length === 0) {
        return [
          {
            id: "jobs-choose",
            label: "Choose the jobs worth building",
            detail: `${plural(mapped, "job")} mapped, none on the backlog yet. Weigh them on the Opportunity Tree, then use “Create story”.`,
            href: "/opportunity-tree",
          },
        ];
      }
      return [];
    },
  }),

  "epic-roadmap": rule({
    select: (ws) => ({ docs: ws.epicRoadmaps, stories: ws.stories }),
    steps: ({ docs, stories }) => {
      const epics = real((docs ?? []).find((d) => d.id === "epicRoadmap:current")?.epics ?? []);
      if (epics.length === 0) return [];
      const linked = new Set(
        real(stories)
          .map((s) => s.epicId)
          .filter(Boolean)
      );
      const bare = epics.filter((e) => !linked.has(e.id)).length;
      return bare === 0
        ? []
        : [
            {
              id: "epics-break-down",
              label: "Break epics into stories",
              detail: `${plural(bare, "epic")} ${bare === 1 ? "has" : "have"} no linked stories, so ${bare === 1 ? "its" : "their"} progress is typed by hand.`,
              href: "/story-mapper",
            },
          ];
    },
  }),

  "dependency-map": rule({
    select: (ws) => ({ maps: ws.dependencyMaps }),
    steps: ({ maps }) => {
      const map = (maps ?? []).find((m) => m.id === "dependency-map:current");
      if (!map) return [];
      const today = todayIso();
      const overdue = real(validEdges(map)).filter((e) => isOverdue(e, today)).length;
      return overdue === 0
        ? []
        : [
            {
              id: "deps-overdue",
              label: "Chase overdue dependencies at the Scrum of Scrums",
              detail: `${plural(overdue, "dependency", "dependencies")} ${be(overdue)} past due. Put them on the next cross-team agenda, or raise the worst as an impediment.`,
              href: "/scrum-of-scrums",
            },
          ];
    },
  }),

  "pi-planning": rule({
    select: (ws) => ({ maps: ws.dependencyMaps }),
    steps: ({ maps }) => {
      const map = (maps ?? []).find((m) => m.id === "dependency-map:current");
      const open = map
        ? real(validEdges(map)).filter(
            (e) =>
              e.sourceRef?.tool === "pi-planning" &&
              !isExampleId(e.sourceRef.id) &&
              edgeStatus(e) !== "resolved"
          ).length
        : 0;
      return open === 0
        ? []
        : [
            {
              id: "pi-dependencies",
              label: "Review the PI's open dependencies",
              detail: `${plural(open, "dependency", "dependencies")} from the PI board ${be(open)} still open. Check owners and due dates on the Dependency Map.`,
              href: "/dependency-map",
            },
          ];
    },
  }),

  "scrum-of-scrums": rule({
    select: (ws) => ({ entries: ws.sosEntries, impediments: ws.impediments }),
    steps: ({ entries, impediments }) => {
      const raised = new Set(
        (impediments ?? [])
          .filter((i) => i.sourceRef?.tool === "scrum-of-scrums")
          .map((i) => i.sourceRef?.id)
      );
      const blockers = real(entries).filter(
        (e) => e.kind === "blocker" && e.status === "open" && !raised.has(e.id)
      ).length;
      return blockers === 0
        ? []
        : [
            {
              id: "sos-impediments",
              label: "Raise the open blockers as impediments",
              detail: `${plural(blockers, "cross-team blocker")} ${be(blockers)} open with no impediment owner yet.`,
              href: "/impediments",
            },
          ];
    },
  }),

  "ice-score": rule({
    select: (ws) => ({ rows: ws.prioritizations }),
    steps: ({ rows }) => {
      const ideas = (rows ?? []).filter((r) => r.framework === "ice" && !isExampleId(r.id));
      const linked = ideas.filter((r) => r.backlogItemId);
      const steps: NextStep[] = [];
      if (linked.length > 0) {
        steps.push({
          id: "ice-compare",
          label: "Compare across methods",
          detail: `${plural(linked.length, "ICE idea")} ${linked.length === 1 ? "is" : "are"} on the backlog. See how ${linked.length === 1 ? "it ranks" : "they rank"} under RICE, WSJF and MoSCoW.`,
          href: "/prioritizer",
        });
      }
      if (ideas.length >= 3) {
        steps.push({
          id: "ice-rice",
          label: "Check the front-runners with RICE",
          detail:
            "ICE is a quick filter. Put the top few on the backlog and score them with RICE's reach and effort before committing.",
          href: "/rice-scoring",
        });
      }
      return steps;
    },
  }),
};

export function getNextStepRule(toolId: string): NextStepRule<object> | undefined {
  return RULES[toolId];
}

/** Tool ids that declare next steps (the UX contract test checks upgraded tools are here). */
export function toolsWithNextSteps(): string[] {
  return Object.keys(RULES);
}
