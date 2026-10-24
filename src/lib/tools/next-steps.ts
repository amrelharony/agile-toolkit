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
import { estimateKind, estimatePoints, sliceCards } from "@/lib/story-map/points";
import {
  impedimentAgeDays,
  isImpedimentOverdue,
  isResolved,
  openDuring,
} from "@/lib/impediments/model";
import {
  CEREMONY_HREF,
  CEREMONY_LABEL,
  nextCeremonies,
  normalizeCadence,
  whenLabel,
} from "@/lib/sprints/cadence";
import { reviewDocId, reviewHasContent } from "@/lib/sprints/review-doc";
import { selectCadenceDoc } from "@/lib/sprints/use-ceremony-cadence";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { cycleStats } from "@/lib/kanban/flow";
import { impedimentStatus } from "@/lib/impediments/model";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";

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

/** The sprint being run: the focus sprint while it is active. */
function activeSprint(sprints: readonly Sprint[] | undefined): Sprint | undefined {
  const s = focusSprint(sprints);
  return s?.status === "active" ? s : undefined;
}

/** An impediment is "stuck" from two weeks open. */
const STUCK_DAYS = 14;

/** The Kanban Flow board's id (lib/handoffs/targets/kanban, the page's KB_ID). */
const FLOW_BOARD_ID = "kanban:current";

/** How soon a ceremony has to start for the timer to be the next step. */
const TIMER_LEAD_MS = 60 * 60 * 1000;

/** Live and async standups are one tool with one next step. */
const standupRule = rule({
  select: (ws) => ({ impediments: ws.impediments, sprints: ws.sprints, stories: ws.stories }),
  steps: ({ impediments, sprints, stories }) => {
    const steps: NextStep[] = [];
    const raised = real(impediments).filter(
      (i) =>
        (i.sourceRef?.tool === "standup" || i.sourceRef?.tool === "async-standup") && !isResolved(i)
    ).length;
    if (raised > 0) {
      steps.push({
        id: "standup-impediments",
        label: "Follow up the blockers raised at standup",
        detail: `${plural(raised, "blocker")} raised at standup ${be(raised)} still open in Impediments.`,
        href: "/impediments",
      });
    }
    const sprint = activeSprint(sprints);
    const planned = sprint ? real(stories).filter((s) => s.sprintId === sprint.id) : [];
    const unowned = planned.filter((s) => s.status !== "done" && !s.owner?.trim()).length;
    if (sprint && unowned > 0) {
      steps.push({
        id: "standup-owners",
        label: "Give the sprint's stories owners",
        detail: `${plural(unowned, "story", "stories")} on ${sprint.name}'s board ${unowned === 1 ? "has" : "have"} no owner, so ${unowned === 1 ? "it doesn't" : "they don't"} come up in anyone's turn when the team walks the board.`,
        href: sprintHref("/kanban", sprint.id),
      });
    }
    if (sprint && planned.length > 0) {
      steps.push({
        id: "standup-board",
        label: "Update the sprint board",
        detail: `Move ${sprint.name}'s stories to where they are now, so the burndown and the cockpit read the board.`,
        href: sprintHref("/kanban", sprint.id),
      });
    }
    return steps;
  },
});

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
      const map = (maps ?? []).find((m) => m.id === STORY_MAP_ID);
      if (!map) return [];
      const steps: NextStep[] = [];
      // Cards under the map's steps, read the way the Story Mapper reads them.
      const cardsOf = (slice: (typeof map.slices)[number]) => real(sliceCards(slice, map.steps));
      const unsized = map.slices
        .flatMap(cardsOf)
        .filter((c) => estimateKind(c.estimate) === "none");
      if (unsized.length > 0) {
        steps.push({
          id: "map-estimate",
          label: "Size the unestimated stories",
          detail: `${plural(unsized.length, "story", "stories")} on the map ${unsized.length === 1 ? "has" : "have"} no points. Queue them for Planning Poker so slice totals and the Release Planner can use them.`,
          href: "/planning-poker",
        });
      }
      const first = map.slices.find((sl) =>
        cardsOf(sl).some((c) => estimateKind(c.estimate) === "points")
      );
      if (first) {
        const total = cardsOf(first).reduce((sum, c) => sum + (estimatePoints(c.estimate) ?? 0), 0);
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

  // Run the sprint.
  kanban: rule({
    select: (ws) => ({ sprints: ws.sprints, stories: ws.stories, boards: ws.kanbanBoards }),
    steps: ({ sprints, stories, boards }) => {
      const sprint = activeSprint(sprints);
      if (!sprint) {
        // No sprint running: the Flow board is the one in use.
        const cards = real((boards ?? []).find((b) => b.id === FLOW_BOARD_ID)?.cards);
        const steps: NextStep[] = [];
        const blocked = cards.filter((c) => c.blocked && c.column !== "done").length;
        if (blocked > 0) {
          steps.push({
            id: "kanban-flow-blocked",
            label: "Raise the blocked cards as impediments",
            detail: `${plural(blocked, "card")} on the Flow board ${be(blocked)} blocked. Raise what the team can't unblock itself as an impediment.`,
            href: "/impediments",
          });
        }
        const finished = cycleStats(cards).count;
        if (finished >= MIN_SAMPLE.distribution) {
          steps.push({
            id: "kanban-cycle-time",
            label: "See how long cards take in Cycle Time",
            detail: `${plural(finished, "finished card")} ${finished === 1 ? "has" : "have"} start and finish dates: enough for a cycle-time spread.`,
            href: "/cycle-time",
          });
        }
        return steps;
      }
      const planned = real(stories).filter((s) => s.sprintId === sprint.id);
      if (planned.length === 0) {
        return [
          {
            id: "kanban-plan",
            label: `Plan stories into ${sprint.name}`,
            detail: `${sprint.name} is active but its board is empty.`,
            href: sprintHref("/sprint-planning", sprint.id),
          },
        ];
      }
      const steps: NextStep[] = [];
      const blocked = planned.filter((s) => s.blocked && s.status !== "done").length;
      if (blocked > 0) {
        steps.push({
          id: "kanban-blocked",
          label: "Talk through the blocked stories at the Daily Scrum",
          detail: `${plural(blocked, "story", "stories")} on ${sprint.name}'s board ${be(blocked)} blocked. Raise what the team can't unblock itself as an impediment.`,
          href: "/standup",
        });
      }
      if (planned.every((s) => s.status === "done")) {
        steps.push({
          id: "kanban-review",
          label: `Prepare the review of ${sprint.name}`,
          detail: `All ${plural(planned.length, "story", "stories")} on the board are done.`,
          href: sprintHref("/sprint-review", sprint.id),
        });
      }
      return steps;
    },
  }),

  sprint: rule({
    select: (ws) => ({
      sprints: ws.sprints,
      impediments: ws.impediments,
      reviews: ws.sprintReviews,
      stories: ws.stories,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ sprints, impediments, reviews, stories, cadences }) => {
      const sprint = focusSprint(sprints);
      if (!sprint) return [];
      const today = todayIso();
      const steps: NextStep[] = [];
      const overdue = real(impediments).filter(
        (i) => openDuring(i, sprint.startDate, sprint.endDate) && isImpedimentOverdue(i, today)
      ).length;
      if (overdue > 0) {
        steps.push({
          id: "cockpit-impediments",
          label: "Chase the overdue impediments",
          detail: `${plural(overdue, "impediment")} in ${sprint.name}'s way ${be(overdue)} past due.`,
          href: "/impediments",
        });
      }
      const blocked = real(stories).filter(
        (s) => s.sprintId === sprint.id && s.blocked && s.status !== "done"
      ).length;
      if (sprint.status === "active" && blocked > 0) {
        steps.push({
          id: "cockpit-blocked",
          label: "Unblock the blocked stories",
          detail: `${plural(blocked, "story", "stories")} on ${sprint.name}'s board ${be(blocked)} flagged as blocked.`,
          href: sprintHref("/kanban", sprint.id),
        });
      }
      if (sprint.status === "active") {
        const now = new Date();
        const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
        const [next] = nextCeremonies(sprint, cadence, now, 1);
        if (next && next.at.getTime() - now.getTime() <= TIMER_LEAD_MS) {
          steps.push({
            id: "cockpit-timer",
            label: `Time the ${CEREMONY_LABEL[next.kind]} with its agenda`,
            detail: `It starts ${whenLabel(next.at, now)}.`,
            href: `/ceremony-timer?agenda=${next.kind}`,
          });
        }
      }
      const review = (reviews ?? []).find((r) => r.id === reviewDocId(sprint.id));
      if (sprint.status === "active" && sprint.endDate <= today && !reviewHasContent(review)) {
        steps.push({
          id: "cockpit-review",
          label: `Prepare the review of ${sprint.name}`,
          detail: `${sprint.name} ${sprint.endDate < today ? "has ended" : "ends today"}. Build the review from its done stories.`,
          href: sprintHref("/sprint-review", sprint.id),
        });
      }
      return steps;
    },
  }),

  standup: standupRule,
  "async-standup": standupRule,

  impediments: rule({
    select: (ws) => ({ impediments: ws.impediments }),
    steps: ({ impediments }) => {
      const today = todayIso();
      const open = real(impediments).filter((i) => !isResolved(i));
      const overdue = open.filter((i) => isImpedimentOverdue(i, today)).length;
      const stuck = open.filter((i) => (impedimentAgeDays(i, today) ?? 0) >= STUCK_DAYS).length;
      const escalated = open.filter((i) => impedimentStatus(i) === "escalated").length;
      const steps: NextStep[] = [];
      if (escalated > 0) {
        steps.push({
          id: "impediments-sos",
          label: "Raise the escalated impediments at the Scrum of Scrums",
          detail: `${plural(escalated, "escalated impediment")} ${escalated === 1 ? "needs" : "need"} help from outside the team.`,
          href: "/scrum-of-scrums",
        });
      }
      if (overdue === 0 && stuck === 0) return steps;
      return [
        ...steps,
        {
          id: "impediments-retro",
          label: "Take the stuck impediments to the retrospective",
          detail:
            overdue > 0
              ? `${plural(overdue, "impediment")} ${be(overdue)} past due. Ask the team what keeps ${overdue === 1 ? "it" : "them"} in place.`
              : `${plural(stuck, "impediment")} ${be(stuck)} open for two weeks or more.`,
          href: "/retro",
        },
      ];
    },
  }),

  "ceremony-timer": rule({
    select: (ws) => ({ sprints: ws.sprints, cadences: ws.ceremonyCadences }),
    steps: ({ sprints, cadences }) => {
      const sprint = activeSprint(sprints);
      if (!sprint) return [];
      const now = new Date();
      const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
      const [next] = nextCeremonies(sprint, cadence, now, 1);
      if (!next) return [];
      return [
        {
          id: "timer-next-ceremony",
          label: `Get ready for the ${CEREMONY_LABEL[next.kind]}`,
          detail: `It's ${whenLabel(next.at, now)}. Open its tool to prepare.`,
          href: sprintHref(CEREMONY_HREF[next.kind], sprint.id),
        },
      ];
    },
  }),

  "sprint-review": rule({
    select: (ws) => ({
      sprints: ws.sprints,
      reviews: ws.sprintReviews,
      stories: ws.stories,
      goals: ws.sprintGoals,
    }),
    steps: ({ sprints, reviews, stories, goals }) => {
      const steps: NextStep[] = [];
      // The latest sprint whose review has something in it.
      const reviewed = real(sprints)
        .filter((s) => reviewHasContent((reviews ?? []).find((r) => r.id === reviewDocId(s.id))))
        .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
      // That one, or the active sprint once it's on its last day.
      const ending = activeSprint(sprints);
      const asked = reviewed ?? (ending && ending.endDate <= todayIso() ? ending : undefined);
      const goal = asked && (goals ?? []).find((g) => g.id === goalDocId(asked.id));
      if (asked && goal?.goal.trim() && !goal.outcome) {
        steps.push({
          id: "review-goal-met",
          label: `Answer “Did we meet the sprint goal?” for ${asked.name}`,
          detail:
            "The review leads with that answer. Record it in Sprint Goal and it shows here, in the export and in the cockpit.",
          href: sprintHref("/sprint-goal", asked.id),
        });
      }
      if (reviewed) {
        steps.push({
          id: "review-retro",
          label: `Hold the retrospective for ${reviewed.name}`,
          detail: "The review is done. Look back at how the sprint went while it's fresh.",
          href: "/retro",
        });
      }
      const fromReview = real(stories).filter(
        (s) => fromTool(s, "sprint-review") && inBacklog(s) && !s.readiness?.ready
      ).length;
      if (fromReview > 0) {
        steps.push({
          id: "review-refine",
          label: "Refine the stories from the review's feedback",
          detail: `${plural(fromReview, "story", "stories")} from review feedback ${be(fromReview)} on the backlog, not refined yet.`,
          href: "/refinement",
        });
      }
      return steps;
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
