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
import { isExampleId } from "@/lib/utils/example-id";
import { edgeStatus, isOverdue, validEdges } from "@/lib/dependencies/edges";
import { findCapacityPlan, pointsForecast } from "@/lib/sprints/capacity";
import { velocity } from "@/lib/sprints/metrics";
import { carryOver } from "@/lib/sprints/progress";
import { JIRA_SOURCE_TOOL } from "@/lib/jira/csv-export";
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
import { unansweredGoal } from "@/app/(tools)/sprint-goal/doc";
import { cycleStats } from "@/lib/kanban/flow";
import { impedimentStatus } from "@/lib/impediments/model";
import { RETRO_CURRENT_ID, collectRetroActions, followThroughByRetro } from "@/lib/retro/actions";
import { recurringThemes } from "@/lib/retro/recurring-themes";
import { liveOnBoards, readAnalyses, sentLink } from "@/lib/root-cause/model";
import { hasOwnCards } from "@/lib/retro/board";
import { LS_DOC_ID } from "@/lib/liberating-structures/doc";
import { lsStructure } from "@/lib/liberating-structures/catalog";
import { KANBAN_BOARD_ID, STORY_MAP_ID } from "@/lib/stores/workspace-types";
import type { CeremonyCadenceDoc, SprintSeries } from "@/lib/stores/workspace-types";
import { cadenceCalendar } from "@/lib/sprints/cadence";
import { burnSeries, burnStatus, openUnpointed } from "@/lib/sprints/burn";
import { predictability } from "@/lib/sprints/metrics";
import { sprintTrends } from "@/lib/sprints/trends";
import { hasSyntheticDates } from "@/lib/sprints/series";
import { addDays, ageingWip, cardItems, cycleSummary, finishedItems, storyItems } from "@/lib/flow";
import { bottleneck, orderedStages } from "@/lib/value-stream/summary";
import { dashboardKpis } from "@/lib/health-dashboard/kpis";
import { kpiReading } from "@/lib/health-dashboard/verdict";
import { HEALTH_DASHBOARD_ID } from "@/lib/stores/workspace-types";
import { DORA_DOC_ID } from "@/lib/dora/samples";
import {
  currentQuarter,
  currentQuarterIndex,
  dashQuarter,
  normalizeQuarter,
  quarterBounds,
  quarterLabel,
} from "@/lib/roadmap/quarters";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { shipEvents, shippedBetween } from "@/lib/releases/model";
import { gateResults, releaseChecks } from "@/lib/releases/auto-gates";
import { flagSummary } from "@/lib/flags/model";
import { ceremonyDates } from "@/lib/sprints/cadence";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { dayNumber } from "@/lib/flow/days";
import { isRecognition, listNames, sentIn, sprintWindow } from "@/lib/kudos/recognition";
import {
  WA_ID,
  agreementConsent,
  dayLabel,
  lastCheckIn,
  normalizeAgreement,
  slippingRun,
} from "@/lib/working-agreement/model";
import {
  DOD_DOC_ID,
  dodAdherence,
  normalizeDefinitionOfDone,
  requiredCriteria,
} from "@/lib/dod/model";
import { RACI_ID, activityIssues, loadWarnings, normalizeRaci } from "@/lib/raci/model";
import {
  SKILLS_MATRIX_ID,
  matrixColumns,
  normalizeSkillsMatrix,
  openTraining,
  realRoster,
  skillCoverage,
} from "@/lib/skills/coverage";
import {
  MATURITY_ID,
  latestAssessment,
  roadmapCards,
  roadmapFor,
  roadmapTitle,
  targetOf,
} from "@/lib/maturity/assessment";
import {
  ADKAR_DOC_ID,
  ELEMENT_LABEL,
  daysInStage,
  initiativeBarrier,
  normalizeAdkarDoc,
  stageIndex,
  stuckInitiatives,
} from "@/lib/adkar/model";
import {
  HEALTH_CHECK_ID,
  QUALITY_DIMENSIONS,
  checksByDate,
  entryShare,
  healthCheckFor,
  redDimensions,
  scoreOf,
  sharePct,
} from "@/lib/health-check/score";
import {
  ANOMALY_DROP,
  PSYCH_SAFETY_ID,
  compareRounds,
  questionMeta,
  roundResult,
  roundsOf,
} from "@/lib/psych-safety/instrument";
import { MOOD_TRACKER_ID, lowMoodStreak, moodDuring, streakLinks } from "@/lib/team/mood";
import { fmt, listAnd } from "@/lib/charts/chart-text";
import { nameKey } from "@/lib/team/names";
import { linkedItem } from "@/lib/prioritization/binding";
import { BACKLOG_ITEM_PARAM } from "@/lib/prioritization/frameworks";
import { evaluateItemIn, readThrough } from "@/lib/prioritization/methods";
import { toChoice, toNumber } from "@/lib/prioritization/methods/fields";
import { dueText } from "@/lib/prioritization/methods/eisenhower";
import {
  MOSCOW_BUCKETS,
  MUST_BUDGET_SHARE,
  moscowEffort,
  mustBudget,
} from "@/lib/prioritization/methods/moscow";
import { consensusMethods, rankMethodRows } from "@/lib/prioritization/rank";
import { eisRows, taskView } from "@/app/(tools)/eisenhower/model";
import { isExampleBacklogId } from "@/app/(tools)/prioritizer/example";
import {
  STALE_PROPOSED_DAYS,
  type DecisionIssueKind,
  allDecisions,
  daysWaiting,
  decisionHref,
  decisionIssues,
  decisionLabel,
  templateOf,
} from "@/lib/decisions/model";
import { TEMPLATES } from "@/lib/decisions/templates";
import {
  budgetProblem,
  featureLedger,
  featureRows,
  gameCheck,
  isFunded,
  pricesOf,
  unitOf,
} from "@/lib/buy-a-feature/game";
import {
  dollars,
  hundredRows,
  roundsFor,
  splitSummary,
  teamAverages,
} from "@/lib/hundred-dollar/allocation";
import {
  matricesOf,
  matrixResult,
  matrixTitle,
  sendBlock,
  sentDecisionOf,
} from "@/lib/weighted/model";
import { complexNotTested, hypothesisStateOf, normalizeDomain } from "@/lib/cynefin/model";
import { BUY_A_FEATURE_ID } from "@/lib/stores/workspace-types";
import { CHECK_IN_STALE_DAYS, daysSinceCheckIn, quarterPace } from "@/lib/okrs/progress";
import { realResponses } from "@/lib/nps/score";
import { RECENT_DAYS, hypothesisTag, recentResponses } from "@/app/(tools)/nps-csat/tags";
import { formatMetric, linkedTest, missingFields, suggestVerdict } from "@/lib/hypotheses/model";
import { missingText } from "@/app/(tools)/hypothesis-tracker/view";
import { RA_ID, rankAssumptions, ratingOf } from "@/lib/assumptions/model";
import {
  experimentHypothesisSource,
  nodeTitle,
  outcomeOf,
  treeNodes,
} from "@/lib/opportunity-tree/model";
import {
  UI_ID,
  participantCount,
  quotesTagged,
  sentOpportunity,
  themeCounts,
} from "@/lib/interviews/model";
import {
  impedimentLinkOf,
  isActiveRisk,
  isHighRisk,
  riskDaysOverdue,
  riskLevelOf,
  riskScore,
} from "@/lib/risks/model";
import { debtStoryOf, isOpenDebt, rankedDebt } from "@/lib/tech-debt/model";
import {
  FLAKY_BOARD_ID,
  QUARANTINE_ALERT_DAYS,
  longQuarantined,
  ratePercent,
  weightedFailureRate,
} from "@/lib/quality/flaky";
import {
  PYRAMID_SHAPE_LABEL,
  TEST_PYRAMID_ID,
  classifyShape,
  layerShares,
  shapeVerdict,
  weightingOf,
  type PyramidShape,
} from "@/lib/quality/pyramid";
import {
  CODE_REVIEW_LOG_ID,
  SIZE_BANDS,
  formatReviewHours,
  reviewSummary,
  windowMinutes,
  workingBasisLabel,
} from "@/lib/quality/review";
import { isIsoDate } from "@/lib/sprints/calendar";
import {
  backlogHealthSteps,
  interruptBufferSteps,
  productGoalSteps,
} from "@/lib/tools/next-steps-phase42";
import type {
  AdkarElement,
  Assumption,
  BacklogItem,
  Decision,
  DefinitionOfDone,
  FlakyTest,
  FlakyTestBoard,
  HandoffLink,
  Hypothesis,
  HypothesisTracker,
  PrioritizationItem,
  RetroBoard,
  RiskiestAssumption,
  TestPyramid,
  TestPyramidWeighting,
  TreeNode,
} from "@/lib/stores/workspace-types";

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

/** The Kanban Flow board's id (the page's, the agents' and the hand-offs'). */
const FLOW_BOARD_ID = KANBAN_BOARD_ID;

/** How soon a ceremony has to start for the timer to be the next step. */
const TIMER_LEAD_MS = 60 * 60 * 1000;

/** MUST match HYPOTHESIS_TRACKER_ID in lib/handoffs/targets/hypothesis.ts. */
const HYPOTHESIS_TRACKER_ID = "hypothesisTracker:current";

/** How far ahead a saved structure is suggested for the next ceremony. */
const STRUCTURE_LEAD_MS = 2 * 24 * 60 * 60 * 1000;

/** Follow-through under this, over the last few retros, means too many actions are agreed. */
const LOW_FOLLOW_THROUGH = 0.5;

/** The next sprint to plan: the earliest planned one. */
function nextPlannedSprint(sprints: readonly Sprint[] | undefined): Sprint | undefined {
  return real(sprints)
    .filter((s) => s.status === "planned")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

/** How recent a rollback has to be for the retro to be the next step. */
const ROLLBACK_LEAD_DAYS = 14;

/** How soon a planned release has to be for a premortem to be the next step. */
const RELEASE_LEAD_DAYS = 7;

/** MUST match KUDOS_TOOL in app/(tools)/retro/kudos.ts: the tool a kudos card's sourceRef names. */
const KUDOS_TOOL = "kudos";

/** How soon the Sprint Review has to be for inviting stakeholders to be the next step. */
const REVIEW_INVITE_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/** A week of mood check-ins averaging this or lower is worth raising in 1:1s (scores are 1–5). */
const LOW_MOOD = 2.5;

/** Days after the last check-in (or the first publish) when the working agreement is due one. */
const AGREEMENT_CHECK_IN_DAYS = 30;

/**
 * The workspace's Definition of Done, read the way the DoD page reads it.
 * Until the DoD builder's old blob has moved in (lib/dod/use-definition-of-done:
 * the owner's first cloud pull, or held by an open merge/discard question),
 * a page shows the blob while this reads no DoD: a rule can't read the blob.
 * The gap closes once the move runs.
 */
const dodOf = (docs: readonly DefinitionOfDone[] | undefined) =>
  normalizeDefinitionOfDone((docs ?? []).find((d) => d.id === DOD_DOC_ID));

/** Whole days from `from` to `to` (local days or timestamps); null when either isn't one. */
function daysFrom(from: string | undefined, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/**
 * The sprint whose kudos a retro would open with: the one the current retro
 * board looks back on, else the newest sprint that has begun. Only sprints
 * with real dates, so the kudos can be read against their days.
 */
function kudosSprint(
  sprints: readonly Sprint[] | undefined,
  boardSprintId: string | undefined,
  today: string
): Sprint | undefined {
  const begun = sprintsNewestFirst(real(sprints)).filter((s) => {
    const window = sprintWindow(s);
    return s.status !== "cancelled" && window !== null && window.from <= today;
  });
  return begun.find((s) => s.id === boardSprintId) ?? begun[0];
}

/**
 * Where an item sent to the retro as a topic is now, read from the boards
 * the way the retro-topic route finds its card (on any board: an archived
 * retro keeps its cards' ids): on the current retro, on an archived one
 * (that retro has been held), or nowhere (never sent, or the card was
 * removed, so it can be sent again).
 */
function retroTopicAt(
  links: readonly HandoffLink[] | undefined,
  boards: readonly RetroBoard[] | undefined
): "current" | "held" | null {
  const link = (links ?? []).find((l) => l.route === "retro-topic");
  if (!link) return null;
  let at: "held" | null = null;
  for (const b of boards ?? []) {
    if (!(b.cards ?? []).some((c) => c.id === link.targetId)) continue;
    if (b.id === RETRO_CURRENT_ID && !b.archivedAt) return "current";
    at = "held";
  }
  return at;
}

/** "24–26 Oct", or "30 Sept–2 Oct" across months: a run of days, as the Mood Tracker writes it. */
function daySpan(start: string, end: string): string {
  if (start === end) return dayLabel(start);
  const [day] = dayLabel(start).split(" ");
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${day}–${dayLabel(end)}`
    : `${dayLabel(start)}–${dayLabel(end)}`;
}

/** A psych-safety statement scoring under this (the scale's "neither agree nor disagree") is worth a retro. */
const UNSAFE_BELOW = 3;

/**
 * Where the weakest maturity dimension is worked on in the toolkit, and the
 * first thing to do there.
 */
const MATURITY_TOOL: Record<string, { href: string; start: string }> = {
  "scrum-practices": {
    href: "/ceremony-timer",
    start: "Run each event to its timebox and agenda in the Ceremony Timer.",
  },
  "team-collaboration": {
    href: "/working-agreement",
    start: "Agree how the team works together in the Working Agreement.",
  },
  "technical-excellence": {
    href: "/dod-builder",
    start: "Raise the bar every story has to meet in the Definition of Done.",
  },
  "product-management": {
    href: "/prioritizer",
    start: "Order the backlog by value in the Prioritizer.",
  },
  "metrics-transparency": {
    href: "/health-dashboard",
    start: "Put the team's numbers in view on the Health Dashboard.",
  },
  "continuous-improvement": {
    href: "/retro-actions",
    start: "Follow the retro's actions through in Retro Actions.",
  },
  "stakeholder-engagement": {
    href: "/stakeholder-map",
    start: "Map who to involve, and how closely, on the Stakeholder Map.",
  },
  "agile-culture": { href: "/kudos", start: "Make good work visible with Kudos." },
};

interface BarrierStep {
  id: string;
  href: string;
  label: (group: string, change: string) => string;
  /** What the low score means, after "Support scored Desire 2/5: ". */
  why: string;
}

const MAKE_THE_CASE: BarrierStep = {
  id: "adkar-barrier-case",
  href: "/stakeholder-map",
  label: (_group, change) => `Plan who explains why “${change}” matters`,
  why: "the case for the change hasn't landed with them yet.",
};
const COACH: BarrierStep = {
  id: "adkar-barrier-coach",
  href: "/one-on-one",
  label: (group, change) => `Coach ${group} one-on-one on “${change}”`,
  why: "they need training, or practice with support.",
};
const RECOGNISE: BarrierStep = {
  id: "adkar-barrier-recognise",
  href: "/kudos",
  label: (group, change) => `Recognise ${group} for sticking with “${change}”`,
  why: "make the new way of working visible, and thank people for it.",
};

/** Where an ADKAR barrier is worked on: making the case, coaching, or recognising. */
const ADKAR_BARRIER_STEP: Record<AdkarElement, BarrierStep> = {
  awareness: MAKE_THE_CASE,
  desire: MAKE_THE_CASE,
  knowledge: COACH,
  ability: COACH,
  reinforcement: RECOGNISE,
};

/**
 * The focus sprint's burn, as Burndown and Burnup chart it: from the board
 * or the typed log, on the team's working days. Null without an open sprint.
 */
function focusBurn(
  sprints: readonly Sprint[] | undefined,
  stories: readonly Story[] | undefined,
  series: readonly SprintSeries[] | undefined,
  cadences: readonly CeremonyCadenceDoc[] | undefined
) {
  const sprint = focusSprint(sprints);
  if (!sprint) return null;
  const calendar = cadenceCalendar(
    normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences as CeremonyCadenceDoc[] }))
  );
  const burn = burnSeries({
    sprint,
    series: (series ?? []).find((x) => x.id === sprint.id),
    stories: real(stories),
    calendar,
    today: todayIso(),
  });
  return { sprint, burn, status: burnStatus(burn, sprint) };
}

/** "N open stories in Sprint 7 have no points": the unsized step both burn charts share. */
function unsizedStep(
  id: string,
  sprint: Sprint,
  stories: readonly Story[] | undefined,
  chart: string
): NextStep[] {
  const n = openUnpointed(real(stories), sprint.id);
  return n === 0
    ? []
    : [
        {
          id,
          label: "Estimate the unsized stories",
          detail: `${plural(n, "open story", "open stories")} in ${sprint.name} ${n === 1 ? "has" : "have"} no points, so the ${chart} can't show all of the work.`,
          href: "/planning-poker",
        },
      ];
}

/** Sprints whose end date has passed but that were never closed. */
function endedOpenSprints(sprints: readonly Sprint[] | undefined): Sprint[] {
  const today = todayIso();
  return real(sprints)
    .filter((s) => isOpenSprint(s) && !hasSyntheticDates(s) && s.endDate.slice(0, 10) < today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

/** Finished sprints still missing their completed points (velocity skips them). */
const missingPoints = (sprints: readonly Sprint[] | undefined) =>
  completed(sprints).filter(
    (s) => !(typeof s.pointsCompleted === "number" && Number.isFinite(s.pointsCompleted))
  );

/** MUST match BACKLOG_SOURCE_TOOL in lib/sprints/plan.ts: the tool a story pulled from the backlog names. */
const BACKLOG_SOURCE_TOOL = "prioritizer";

/**
 * MUST match OPEN_PARAM and DECIDE_ORDER_OPEN in
 * app/(tools)/prioritizer/prioritizer-client.tsx: it opens the Decide order
 * step, from another tool or on the hub itself.
 */
const DECIDE_ORDER_HREF = "/prioritizer?open=decide-order";

/** WSJF with the backlog item preselected (lib/prioritization/frameworks scoreWithHref). */
const scoreWithWsjf = (itemId: string) =>
  `/wsjf?${BACKLOG_ITEM_PARAM}=${encodeURIComponent(itemId)}`;

/** MUST match MATRIX_PARAM in app/(tools)/weighted-decision/weighted-decision-client.tsx: it opens one matrix. */
const matrixHref = (id: string) => `/weighted-decision?matrix=${encodeURIComponent(id)}`;

/**
 * The team's backlog and method rows: no example rows, no backlog items
 * the Prioritizer counts as example (its old `default:item-*` seed too),
 * and no row linked to one of those (it reads the example's values, and
 * its tool shows it as on the backlog).
 */
function teamBacklog(
  items: readonly BacklogItem[] | undefined,
  rows: readonly PrioritizationItem[] | undefined
): { backlog: BacklogItem[]; rows: PrioritizationItem[] } {
  const all = items ?? [];
  const examples = new Set(all.filter((b) => isExampleBacklogId(b.id)).map((b) => b.id));
  return {
    backlog: all.filter((b) => !examples.has(b.id)),
    rows: real(rows).filter((r) => !(r.backlogItemId && examples.has(r.backlogItemId))),
  };
}

/**
 * Whether a story already carries a row's work: planned into a sprint
 * still to run or under way, or done. It's the story pulled from the row's
 * backlog item, or one named like the row or the item (as Sprint
 * Planning's import matches names).
 */
function plannedStory(
  row: PrioritizationItem,
  item: BacklogItem | undefined,
  stories: readonly Story[] | undefined,
  sprints: readonly Sprint[] | undefined
): boolean {
  const open = new Set(
    real(sprints)
      .filter(isOpenSprint)
      .map((s) => s.id)
  );
  const names = new Set([row.title, item?.name ?? ""].map(nameKey).filter(Boolean));
  return real(stories).some(
    (s) =>
      (s.status === "done" || open.has(s.sprintId ?? "")) &&
      ((item !== undefined && fromTool(s, BACKLOG_SOURCE_TOOL) && s.sourceRef?.id === item.id) ||
        names.has(nameKey(s.title)))
  );
}

/** How soon a fixed-date item's latest start has to be for planning it to be the next step. */
const FIXED_DATE_LEAD_DAYS = 14;

/** A RICE confidence at or under this ("mostly a guess") is worth testing before building. */
const LOW_CONFIDENCE = 50;

/** In the decided order: BacklogItem.rank, set only by the Prioritizer's Decide order. */
const isRanked = (item: BacklogItem) =>
  typeof item.rank === "number" && Number.isFinite(item.rank) && item.rank > 0;

/** An effort the Must budget counts (mustBudget's rule: a finite number, 0 or more). */
const isSized = (effort: number | null) =>
  effort !== null && Number.isFinite(effort) && effort >= 0;

/**
 * Backlog items Sprint Planning can still import, as its importCandidates
 * reads them: named, with no story pulled from them and none of the same
 * name (every story counts, as there).
 */
function notPulled(
  items: readonly BacklogItem[],
  stories: readonly Story[] | undefined
): BacklogItem[] {
  const all = stories ?? [];
  const taken = new Set(all.map((s) => nameKey(s.title)));
  const pulled = new Set(
    all.filter((s) => fromTool(s, BACKLOG_SOURCE_TOOL)).map((s) => s.sourceRef?.id)
  );
  return items.filter((b) => b.name.trim() && !taken.has(nameKey(b.name)) && !pulled.has(b.id));
}

/**
 * Whether the link on `route` points at a target still among `ids`: the
 * hand-offs' liveLink, read from the slices (a deleted target doesn't
 * count, so the item can be sent again).
 */
function linkedTo(
  links: readonly HandoffLink[] | undefined,
  route: HandoffLink["route"],
  ids: ReadonlySet<string>
): boolean {
  const link = (links ?? []).find((l) => l.route === route);
  return link !== undefined && ids.has(link.targetId);
}

/** “Title”, or what to call an item without one. */
const quote = (title: string | undefined, untitled: string) => `“${title?.trim() || untitled}”`;

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

/**
 * The Decision Log, DACI and RAPID are one decision record with one next
 * step: every record, old DACI and RAPID rows read through (the Decision
 * Log's old blob isn't a slice: its rows count once the page has moved
 * them in), checked the way the record's own issues are.
 */
const decisionRule = rule({
  select: (ws) => ({
    decisions: ws.decisions,
    daci: ws.daciDecisions,
    rapid: ws.rapidDecisions,
  }),
  steps: ({ decisions, daci, rapid }) => {
    const today = todayIso();
    const records = real(allDecisions(decisions, daci, rapid));
    const titleOf = (d: Decision) => quote(d.title, decisionLabel(d));
    const has = (d: Decision, kind: DecisionIssueKind) =>
      decisionIssues(d, today).some((i) => i.kind === kind);
    const steps: NextStep[] = [];
    // Waiting longest first.
    const stale = records
      .flatMap((d) => {
        const days = daysWaiting(d, today);
        return days !== null && days > STALE_PROPOSED_DAYS ? [{ d, days }] : [];
      })
      .sort((a, b) => b.days - a.days);
    const [oldest] = stale;
    if (oldest) {
      const more = stale.length - 1;
      steps.push({
        id: "decision-stale",
        label: `Decide on ${titleOf(oldest.d)}: proposed ${plural(oldest.days, "day")} ago`,
        detail: `${more > 0 ? `${plural(more, "other proposal")} ${be(more)} waiting over two weeks too. ` : ""}An open proposal holds up the work that waits on it: accept it, or record why not.`,
        href: decisionHref(oldest.d.id),
      });
    }
    const blank = records.find((d) => has(d, "accepted_no_outcome"));
    if (blank) {
      steps.push({
        id: "decision-outcome",
        label: `Write down what was decided on ${titleOf(blank)}`,
        detail:
          "It's accepted, but the outcome isn't written down, so nobody can check what was agreed.",
        href: decisionHref(blank.id),
      });
    }
    const noDecider = records.find((d) => has(d, "no_decider"));
    if (noDecider) {
      const spec = TEMPLATES[templateOf(noDecider)];
      steps.push({
        id: "decision-decider",
        label: `Name the ${spec.deciderLabel} for ${titleOf(noDecider)}`,
        detail: `A ${spec.label} decision needs the one person who makes the call named before it can be decided.`,
        href: decisionHref(noDecider.id),
      });
    }
    return steps;
  },
});

/** The most of a statement, quote or test a step quotes before cutting it at a word. */
const QUOTE_MAX = 60;

/**
 * `text` on one line, cut at a word to QUOTE_MAX characters with "…": a
 * hypothesis or an assumption can run to 2,000 characters, too long for a
 * step's label.
 */
function clip(text: string | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > QUOTE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** ", and 2 others" after the first of `n` items named. */
const andOthers = (n: number, other: string, others = `${other}s`) =>
  n > 1 ? `, and ${plural(n - 1, other, others)}` : "";

/** The quarter ("2026 Q4") a sprint falls in by its first day; today's for one with made-up dates. */
function sprintQuarter(sprint: Sprint): string {
  if (hasSyntheticDates(sprint)) return currentQuarter();
  const [y, m] = sprint.startDate.slice(0, 10).split("-").map(Number);
  return quarterLabel(y * 4 + Math.floor((m - 1) / 3) + 1);
}

/** A month without a survey answer: the page's default period has nothing new to read. */
const SURVEY_QUIET_DAYS = 30;

/** The Hypothesis Tracker's own hypotheses (example rows left out). */
const hypothesesOf = (trackers: readonly HypothesisTracker[] | undefined) =>
  real((trackers ?? []).find((t) => t.id === HYPOTHESIS_TRACKER_ID)?.hypotheses);

/** The Riskiest Assumption canvas's own assumptions (example rows left out). */
const assumptionsOf = (canvases: readonly RiskiestAssumption[] | undefined) =>
  real((canvases ?? []).find((c) => c.id === RA_ID)?.assumptions);

interface SettledAssumption {
  assumption: Assumption;
  hypothesis: Hypothesis;
  result: "validated" | "invalidated";
}

/**
 * Assumptions whose hypothesis came back validated or invalidated while
 * their own status doesn't say so yet. The canvas offers "Mark validated"
 * (or invalidated) as one click and never writes it on its own
 * (riskiest-assumption/view offeredStatus reads it the same way).
 */
function settledAssumptions(
  assumptions: readonly Assumption[],
  hypotheses: readonly Hypothesis[]
): SettledAssumption[] {
  return assumptions.flatMap((a) => {
    if (a.status === "validated" || a.status === "invalidated") return [];
    const test = linkedTest(a.sentTo, hypotheses);
    if (test.state !== "tested" || test.result === "inconclusive") return [];
    const hypothesis = hypotheses.find((h) => h.id === test.hypothesisId);
    return hypothesis ? [{ assumption: a, hypothesis, result: test.result }] : [];
  });
}

/** How recent an experiment's result has to be for reading it to be the next step. */
const RESULT_RECENT_DAYS = 30;

/** The target opportunity a node sits under: its nearest flagged ancestor. Cycle-safe. */
function targetAbove(node: TreeNode, byId: ReadonlyMap<string, TreeNode>): TreeNode | undefined {
  const seen = new Set<string>([node.id]);
  let cur = node.parentId ? byId.get(node.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === "opportunity" && cur.target) return cur;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

/** “Node title”, cut to QUOTE_MAX (an untitled node is named by its kind). */
const nodeQuote = (n: Pick<TreeNode, "kind" | "text">) => `“${clip(nodeTitle(n))}”`;

/** MUST match TOOL_ID in app/(tools)/tech-debt/tech-debt-client.tsx: the tool a debt story's sourceRef names. */
const TECH_DEBT_TOOL = "tech-debt";

/** The flaky-test board's own tests (example rows left out). */
const flakyTestsOf = (boards: readonly FlakyTestBoard[] | undefined) =>
  real((boards ?? []).find((b) => b.id === FLAKY_BOARD_ID)?.tests);

/** Flaky tests still open: active or quarantined (lib/quality/flaky counts the same). */
const openFlaky = (tests: readonly FlakyTest[]) => tests.filter((t) => t.status !== "fixed");

/** Open flaky tests from which the suite's shape is worth checking. */
const FLAKY_SHAPE_MIN = 3;

/**
 * The test pyramid's shape as its page reads it (by count, or by run time
 * when the team chose that), "empty" while nothing is counted. The
 * example is held in memory by the page, so a stored pyramid is the team's.
 */
function pyramidShape(docs: readonly TestPyramid[] | undefined) {
  const doc = (docs ?? []).find((d) => d.id === TEST_PYRAMID_ID);
  const weighting = weightingOf(doc);
  const shares = doc ? layerShares(doc, weighting, doc.runtime) : null;
  return { shape: classifyShape(shares), shares, weighting };
}

/** Wider at the top than a pyramid should be: mostly end to end, or thin in the middle. */
const TOP_HEAVY: ReadonlySet<PyramidShape> = new Set<PyramidShape>(["ice-cream-cone", "hourglass"]);

/**
 * "an ice-cream cone", "an hourglass by run time": a top-heavy shape in a
 * sentence, with the basis shapeVerdict names (a suite shaped like a
 * pyramid by count can be a cone by run time).
 */
const topHeavyName = (shape: PyramidShape, weighting: TestPyramidWeighting) =>
  `an ${PYRAMID_SHAPE_LABEL[shape].toLowerCase()}${weighting === "runtime" ? " by run time" : ""}`;

/** The largest PRs' share of the logged ones from which PR size is worth a retro. */
const LARGE_PR_SHARE = 0.25;

/** Large PRs this many times slower to merge than small ones are worth naming (as reviewVerdict does). */
const LARGE_PR_SLOWER = 1.5;

/** What to do on the tree once an experiment's hypothesis has its result. */
const RESULT_NEXT: Record<"validated" | "invalidated" | "inconclusive", string> = {
  validated: "build on the solution it tested",
  invalidated: "prune the solution it tested, or try another for the same opportunity",
  inconclusive: "test it again more sharply, or try another experiment",
};

const RULES: Record<string, NextStepRule<object>> = {
  // ── Track delivery ──
  burndown: rule({
    select: (ws) => ({
      sprints: ws.sprints,
      stories: ws.stories,
      series: ws.sprintSeries,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ sprints, stories, series, cadences }) => {
      const now = focusBurn(sprints, stories, series, cadences);
      if (!now) return [];
      const { sprint, burn, status } = now;
      const steps: NextStep[] = [];
      if (burn.phase === "over" && sprint.status === "active") {
        steps.push({
          id: "burndown-close",
          label: `Close ${sprint.name} in the cockpit`,
          detail:
            "It has ended. Closing it records its velocity and carries the unfinished stories over.",
          href: sprintHref("/sprint", sprint.id),
        });
      }
      steps.push(...unsizedStep("burndown-unsized", sprint, stories, "burndown"));
      if (burn.phase === "running" && !status.cantTell && (status.gap ?? 0) > 0) {
        steps.push({
          id: "burndown-gap",
          label: "Talk through the gap at the Daily Scrum",
          detail: `${status.gapLabel} against the ideal line, counted on working days.`,
          href: sprintHref("/standup", sprint.id),
        });
      }
      return steps;
    },
  }),

  burnup: rule({
    select: (ws) => ({
      sprints: ws.sprints,
      stories: ws.stories,
      series: ws.sprintSeries,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ sprints, stories, series, cadences }) => {
      const now = focusBurn(sprints, stories, series, cadences);
      if (!now) return [];
      const { sprint, burn } = now;
      const steps: NextStep[] = [];
      if (burn.scopeAdded > 0) {
        steps.push({
          id: "burnup-scope-added",
          label: "Check the added scope against the Sprint Goal",
          detail: `${plural(burn.scopeAdded, "point")} joined ${sprint.name} after its first day.`,
          href: sprintHref("/sprint-goal", sprint.id),
        });
      }
      if (burn.scopeRemoved > 0) {
        steps.push({
          id: "burnup-scope-removed",
          label: "Note the descoped work in the Sprint Review",
          detail: `${plural(burn.scopeRemoved, "point")} left ${sprint.name} after its first day.`,
          href: sprintHref("/sprint-review", sprint.id),
        });
      }
      steps.push(...unsizedStep("burnup-unsized", sprint, stories, "burnup"));
      return steps;
    },
  }),

  velocity: rule({
    select: (ws) => ({ sprints: ws.sprints }),
    steps: ({ sprints }) => {
      const steps: NextStep[] = [];
      const [ended] = endedOpenSprints(sprints);
      if (ended) {
        steps.push({
          id: "velocity-close",
          label: `Close ${ended.name} with its completed points`,
          detail:
            "It has ended. Closing it counts its points toward velocity and decides where its unfinished stories go.",
          href: sprintHref("/sprint", ended.id),
        });
      }
      const [unscored] = missingPoints(sprints);
      if (unscored) {
        steps.push({
          id: "velocity-missing-points",
          label: `Add ${unscored.name}'s completed points`,
          detail:
            "Velocity and forecasts skip a finished sprint until it has its completed points.",
          href: "/velocity",
        });
      }
      const recent = predictability(real(sprints), { window: 3 });
      const short = recent.byGrade.missed + recent.byGrade.close;
      if (recent.count >= 2 && short >= 2) {
        steps.push({
          id: "velocity-commitments",
          label: "Talk about the missed commitments at the retro",
          detail: `${short} of the last ${plural(recent.count, "pointed sprint")} finished under 90% of their commitment.`,
          href: "/retro",
        });
      }
      return steps;
    },
  }),

  "sprint-compare": rule({
    select: (ws) => ({ sprints: ws.sprints, goals: ws.sprintGoals }),
    steps: ({ sprints, goals }) => {
      const [newest] = completed(sprints).sort((a, b) => b.endDate.localeCompare(a.endDate));
      if (!newest) return [];
      const goal = (goals ?? []).find((g) => g.id === goalDocId(newest.id));
      return goal?.goal.trim() && !goal.outcome
        ? [
            {
              id: "sprint-compare-goal",
              label: `Answer whether ${newest.name} met its goal`,
              detail: "Goal Achievement isn't scored until the team answers it in Sprint Goal.",
              href: sprintHref("/sprint-goal", newest.id),
            },
          ]
        : [];
    },
  }),

  "sprint-metrics": rule({
    select: (ws) => ({ sprints: ws.sprints, stories: ws.stories, series: ws.sprintSeries }),
    steps: ({ sprints, stories, series }) => {
      const steps: NextStep[] = [];
      const unscored = missingPoints(sprints);
      if (unscored.length > 0) {
        steps.push({
          id: "sprint-metrics-missing-points",
          label: "Add the missing completed points",
          detail: `${plural(unscored.length, "finished sprint")} ${be(unscored.length)} left out of the trend and velocity.`,
          href: "/velocity",
        });
      }
      const rows = sprintTrends({
        sprints: sprints ?? [],
        stories: stories ?? [],
        series,
        window: 3,
      }).rows;
      const missed = rows.filter((r) => r.sayDo?.grade === "missed").length;
      if (missed >= 2) {
        steps.push({
          id: "sprint-metrics-slipping",
          label: "Look at why commitments slip",
          detail: `${missed} of the last ${plural(rows.length, "sprint")} delivered under 70% of their commitment.`,
          href: "/retro",
        });
      }
      const carried = rows.filter((r) => (r.carryOver.pct ?? 0) > 20).length;
      const next = nextPlannedSprint(sprints);
      if (carried >= 2 && next) {
        steps.push({
          id: "sprint-metrics-carry-over",
          label: `Plan ${next.name} lighter, or split stories`,
          detail: `${carried} of the last ${plural(rows.length, "sprint")} carried over more than a fifth of their commitment.`,
          href: sprintHref("/sprint-planning", next.id),
        });
      }
      return steps;
    },
  }),

  "cumulative-flow": rule({
    select: (ws) => ({ stories: ws.stories, boards: ws.kanbanBoards }),
    steps: ({ stories, boards }) => {
      const board = (boards ?? []).find((b) => b.id === FLOW_BOARD_ID);
      const finished = finishedItems([
        ...storyItems(stories ?? []),
        ...cardItems(board?.cards ?? []),
      ]);
      return finished.length >= MIN_SAMPLE.distribution
        ? [
            {
              id: "cfd-cycle-time",
              label: "See how long items take to finish in Cycle Time",
              detail: `${plural(finished.length, "item")} finished on the boards. Little's Law gives an average; Cycle Time gives the spread.`,
              href: "/cycle-time",
            },
          ]
        : [];
    },
  }),

  "cycle-time": rule({
    select: (ws) => ({ stories: ws.stories, boards: ws.kanbanBoards }),
    steps: ({ stories, boards }) => {
      const board = (boards ?? []).find((b) => b.id === FLOW_BOARD_ID);
      const items = [...storyItems(stories ?? []), ...cardItems(board?.cards ?? [])];
      const finished = finishedItems(items);
      if (finished.length < MIN_SAMPLE.distribution) {
        return [
          {
            id: "cycle-time-move-work",
            label: "Move work to Done on the board to see cycle times",
            detail: `${plural(finished.length, "item")} finished with a start date; a spread needs ${MIN_SAMPLE.distribution}.`,
            href: "/kanban",
          },
        ];
      }
      const { p85 } = cycleSummary(finished.map((f) => f.days));
      const old = ageingWip(items, todayIso(), p85).filter((a) => a.overP85);
      return old.length > 0
        ? [
            {
              id: "cycle-time-ageing",
              label: `Talk through the ${plural(old.length, "oldest item")} at the Daily Scrum`,
              detail: `${old.length === 1 ? "It is" : "They are"} already older than 85% of finished work took (${p85} days).`,
              href: "/standup",
            },
          ]
        : [];
    },
  }),

  "value-stream": rule({
    select: (ws) => ({ stages: ws.valueStreamStages }),
    steps: ({ stages }) => {
      const current = orderedStages(real(stages), "current");
      const steps: NextStep[] = [];
      const worst = bottleneck(current);
      if (worst) {
        steps.push({
          id: "value-stream-bottleneck",
          label: `Take the ${worst.stage.name} wait to the retro`,
          detail: `Work waits ${Math.round(worst.waitDays * 10) / 10} days there, ${Math.round(worst.sharePct)}% of the lead time.`,
          href: "/retro",
        });
      }
      if (current.length >= 2 && orderedStages(real(stages), "future").length === 0) {
        steps.push({
          id: "value-stream-future",
          label: "Draft the future state you want",
          detail: "Copy the current map and change it to the flow the team is aiming for.",
          href: "/value-stream",
        });
      }
      return steps;
    },
  }),

  "health-dashboard": rule({
    select: (ws) => ({
      sprints: ws.sprints,
      stories: ws.stories,
      kanbanBoards: ws.kanbanBoards,
      healthChecks: ws.healthChecks,
      impediments: ws.impediments,
      standupEntries: ws.standupEntries,
      asyncUpdates: ws.asyncUpdates,
      configs: ws.healthDashboards,
    }),
    steps: ({ configs, ...sources }) => {
      const kpis = dashboardKpis({
        ...sources,
        config: (configs ?? []).find((c) => c.id === HEALTH_DASHBOARD_ID) ?? null,
        today: todayIso(),
      });
      const steps: NextStep[] = [];
      const red = kpis.find((k) => k.status === "red");
      if (red) {
        steps.push({
          id: "health-dashboard-red",
          label: `Look into ${red.name.toLowerCase()}`,
          detail: kpiReading(red),
          href: red.source.href,
        });
      }
      if (kpis.some((k) => k.id === "team-health" && !k.hasData)) {
        steps.push({
          id: "health-dashboard-health-check",
          label: "Run a squad health check",
          detail: "Team health reads the latest saved health check, and there is none yet.",
          href: "/health-check",
        });
      }
      return steps;
    },
  }),

  "dora-scorecard": rule({
    select: (ws) => ({ scorecards: ws.doraScorecards, readiness: ws.releaseReadinesses }),
    steps: ({ scorecards, readiness }) => {
      const samples = real((scorecards ?? []).find((d) => d.id === DORA_DOC_ID)?.samples);
      const doc = (readiness ?? []).find((d) => d.id === RELEASE_DOC_ID);
      const events = shipEvents(doc ? { ...doc, releases: real(doc.releases) } : undefined);
      const quarter = dashQuarter(currentQuarterIndex() - 1);
      const bounds = quarterBounds(quarter);
      const shipped = bounds ? shippedBetween(events, bounds.start, bounds.end).length : 0;
      if (shipped > 0 && !samples.some((s) => s.quarter === quarter)) {
        return [
          {
            id: "dora-fill-quarter",
            label: `Fill ${quarter} from your data`,
            detail: `No sample for ${quarter} yet, and ${plural(shipped, "release")} went out in it.`,
            href: "/dora-scorecard",
          },
        ];
      }
      if (samples.length === 0 && events.length === 0) {
        return [
          {
            id: "dora-track-releases",
            label: "Track releases to derive the deployment numbers",
            detail:
              "Deployment frequency and change failure rate come from shipped and rolled-back releases.",
            href: "/release-readiness",
          },
        ];
      }
      return [];
    },
  }),

  "release-readiness": rule({
    select: (ws) => ({
      readiness: ws.releaseReadinesses,
      flags: ws.featureFlags,
      dods: ws.definitionsOfDone,
      stories: ws.stories,
    }),
    steps: ({ readiness, flags, dods, stories }) => {
      const doc = (readiness ?? []).find((d) => d.id === RELEASE_DOC_ID);
      const releases = real(doc?.releases);
      const today = todayIso();
      // The DoD gate as the page reads it: the workspace DoD (dodOf says
      // why not the old blob), against the release's linked stories.
      const dod = (dods ?? []).find((d) => d.id === DOD_DOC_ID) ?? null;
      const linkable = real(stories);
      const steps: NextStep[] = [];
      const since = addDays(today, -ROLLBACK_LEAD_DAYS) ?? today;
      const rolledBack = releases
        .filter((r) => r.status === "rolled_back" && r.rolledBackAt && r.rolledBackAt >= since)
        .sort((a, b) => (b.rolledBackAt ?? "").localeCompare(a.rolledBackAt ?? ""))[0];
      if (rolledBack) {
        steps.push({
          id: "release-rollback-retro",
          label: `Talk about the ${rolledBack.name} rollback at the retro`,
          detail: `It was rolled back on ${rolledBack.rolledBackAt}. Send it as a retro topic from its card.`,
          href: "/retro",
        });
      }
      const soon = addDays(today, RELEASE_LEAD_DAYS) ?? today;
      for (const r of releases) {
        if (r.status !== "planning" || r.plannedDate < today || r.plannedDate > soon) continue;
        const open = gateResults(
          r,
          doc,
          releaseChecks(r, real(flags), dod, today, linkable)
        ).filter((g) => !g.passed).length;
        if (open === 0) continue;
        steps.push({
          id: "release-premortem",
          label: `Run a premortem on ${r.name}`,
          detail: `It's planned for ${r.plannedDate} with ${plural(open, "gate")} still open.`,
          href: "/premortem",
        });
        break;
      }
      return steps;
    },
  }),

  "feature-flag-tracker": rule({
    select: (ws) => ({ flags: ws.featureFlags }),
    steps: ({ flags }) => {
      const summary = flagSummary(real(flags), todayIso());
      const steps: NextStep[] = [];
      if (summary.stale > 0) {
        steps.push({
          id: "flags-stale",
          label: `Plan the removal of ${plural(summary.stale, "stale flag")}`,
          detail: `${summary.pastRemoval} past the removal date the team set, ${summary.overLifetime} older than their purpose's typical lifetime. Send each to the backlog from its card.`,
          href: "/sprint-planning",
        });
      }
      if (summary.noOwner > 0) {
        steps.push({
          id: "flags-no-owner",
          label: `Give ${plural(summary.noOwner, "flag")} an owner`,
          detail: "A flag nobody owns is the one nobody removes.",
          href: "/feature-flag-tracker",
        });
      }
      return steps;
    },
  }),

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
      // A Jira export often comes without points: size those before planning them in.
      const unsizedImports = all.filter(
        (s) => fromTool(s, JIRA_SOURCE_TOOL) && inBacklog(s) && unestimated(s)
      );
      if (unsizedImports.length > 0) {
        steps.push({
          id: "planning-refine-imported",
          label: "Refine the stories imported from Jira",
          detail: `${plural(unsizedImports.length, "story", "stories")} imported from the Jira CSV ${be(unsizedImports.length)} in the backlog with no points. Check them against the Definition of Ready and size them before planning.`,
          href: "/refinement",
        });
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

  // Tools plan, phase 1. The logic and its tests are in lib/tools/next-steps-phase42.
  "product-goal": rule({
    select: (ws) => ({ goals: ws.productGoals, sprints: ws.sprints, stories: ws.stories }),
    steps: ({ goals, sprints, stories }) => productGoalSteps({ goals, sprints, stories }),
  }),

  "backlog-health": rule({
    select: (ws) => ({
      stories: ws.stories,
      backlogItems: ws.backlogItems,
      goals: ws.productGoals,
    }),
    steps: ({ stories, backlogItems, goals }) =>
      backlogHealthSteps({ stories, backlogItems, goals }),
  }),

  // Run the sprint.
  kanban: rule({
    select: (ws) => ({
      sprints: ws.sprints,
      stories: ws.stories,
      boards: ws.kanbanBoards,
      dods: ws.definitionsOfDone,
    }),
    steps: ({ sprints, stories, boards, dods }) => {
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
      const done = planned.filter((s) => s.status === "done").length;
      const dod = dodOf(dods);
      if (done > 0 && requiredCriteria(dod).length === 0) {
        steps.push({
          id: "kanban-dod",
          label:
            dod.items.length === 0
              ? "Write a Definition of Done for the board's cards"
              : "Mark the DoD criteria every story must meet",
          detail: `${plural(done, "story", "stories")} on ${sprint.name}'s board ${be(done)} done with no required criteria to check ${done === 1 ? "it" : "them"} against.`,
          href: "/dod-builder",
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
      goals: ws.sprintGoals,
    }),
    steps: ({ sprints, impediments, reviews, stories, cadences, goals }) => {
      // The last sprint closed with a goal and no answer to "Did we meet
      // it?": the close dialog asks, but it can be skipped, and a Scrum
      // Master who closes from here may never open Sprint Goal or the Review.
      const [lastClosed] = completed(sprints).sort((a, b) => b.endDate.localeCompare(a.endDate));
      const goalStep: NextStep[] =
        lastClosed && unansweredGoal(goals, lastClosed)
          ? [
              {
                id: "cockpit-goal-answer",
                label: `Answer whether ${lastClosed.name} met its goal`,
                detail:
                  "It closed without an answer to “Did we meet the sprint goal?”. The Sprint Review, the retro and Sprint Comparison read it.",
                href: sprintHref("/sprint-goal", lastClosed.id),
              },
            ]
          : [];
      const sprint = focusSprint(sprints);
      if (!sprint) return goalStep;
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
      // After what the running sprint needs today.
      return [...steps, ...goalStep];
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

  // Tools plan, phase 1.
  picker: rule({
    select: (ws) => ({
      members: ws.teamMembers,
      sprints: ws.sprints,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ members, sprints, cadences }) => {
      const steps: NextStep[] = [];
      if (real(members).length === 0) {
        steps.push({
          id: "picker-team",
          label: "Add your team",
          detail: "The wheel and the role rotation pick from the people on the Team page.",
          href: "/team",
        });
      }
      const sprint = activeSprint(sprints);
      if (sprint) {
        const now = new Date();
        const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
        const [next] = nextCeremonies(sprint, cadence, now, 1);
        if (next && next.at.getTime() - now.getTime() <= TIMER_LEAD_MS) {
          steps.push({
            id: "picker-ceremony",
            label: `Go on to the ${CEREMONY_LABEL[next.kind]}`,
            detail: `It starts ${whenLabel(next.at, now)}. You've picked who runs it; open it there.`,
            href: sprintHref(CEREMONY_HREF[next.kind], sprint.id),
          });
        }
      }
      return steps;
    },
  }),

  // Audience Wall's saved walls live in its own tool store, not the
  // workspace: its steps read what the walls sent on (backlog stories)
  // and when the next review is due.
  "audience-wall": rule({
    select: (ws) => ({ stories: ws.stories, sprints: ws.sprints }),
    steps: ({ stories, sprints }) => {
      const steps: NextStep[] = [];
      const fromWall = real(stories).filter(
        (s) => fromTool(s, "audience-wall") && inBacklog(s) && !s.readiness?.ready
      ).length;
      if (fromWall > 0) {
        steps.push({
          id: "audience-wall-refine",
          label: "Refine the stories from the wall's feedback",
          detail: `${plural(fromWall, "story", "stories")} from Audience Wall ${be(fromWall)} on the backlog, not refined yet.`,
          href: "/refinement",
        });
      }
      const ending = activeSprint(sprints);
      const today = todayIso();
      // A full ISO end date counts as its day.
      const end = ending && !hasSyntheticDates(ending) ? ending.endDate.slice(0, 10) : null;
      if (ending && end && end <= today) {
        steps.push({
          id: "audience-wall-review",
          label: `Collect the feedback on ${ending.name} in a feedback room`,
          detail: `${end === today ? "The sprint ends today." : "The sprint has ended."} Sprint Review's Feedback tab runs a room, and the posts join the feedback when you save them.`,
          href: sprintHref("/sprint-review", ending.id),
        });
      }
      return steps;
    },
  }),

  // Facilitator Timers keep their runs in the browser tab: the steps read
  // what the session still owes (parked points) and the next ceremony to time.
  "facilitator-timers": rule({
    select: (ws) => ({
      sprints: ws.sprints,
      cadences: ws.ceremonyCadences,
      parked: ws.parkingLotItems,
    }),
    steps: ({ sprints, cadences, parked }) => {
      const steps: NextStep[] = [];
      const open = real(parked).filter((p) => p.status === "open").length;
      if (open > 0) {
        steps.push({
          id: "timers-parking-lot",
          label: `Go through the ${plural(open, "parked point")}`,
          detail: `${open === 1 ? "It is" : "They are"} still open in the Parking Lot. Keep the last minutes of the session for ${open === 1 ? "it" : "them"}.`,
          href: "/parking-lot",
        });
      }
      const sprint = activeSprint(sprints);
      if (sprint) {
        const now = new Date();
        const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
        const [next] = nextCeremonies(sprint, cadence, now, 1);
        if (next) {
          steps.push({
            id: "timers-next-ceremony",
            label: `Time the ${CEREMONY_LABEL[next.kind]} to its agenda`,
            detail: `It's ${whenLabel(next.at, now)}. The Ceremony Timer gives each part its time-box and every speaker a fair turn.`,
            href: `/ceremony-timer?agenda=${next.kind}`,
          });
        }
      }
      return steps;
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

  // Tools plan, phase 1. The logic and its tests are in lib/tools/next-steps-phase42.
  "interrupt-buffer": rule({
    select: (ws) => ({ sprints: ws.sprints, items: ws.interruptItems }),
    steps: ({ sprints, items }) => interruptBufferSteps({ sprints, items }),
  }),

  // A vote's result goes on: a proposed decision to settle, a topic for the retro.
  "quick-vote": rule({
    select: (ws) => ({ decisions: ws.decisions, boards: ws.retroBoards }),
    steps: ({ decisions, boards }) => {
      const steps: NextStep[] = [];
      const proposed = real(decisions).filter(
        (d) => d.sourceRef?.tool === "quick-vote" && d.status === "proposed"
      );
      if (proposed.length > 0) {
        steps.push({
          id: "quick-vote-decide",
          label: `Record the decision on “${proposed[0].title}”`,
          detail: `${plural(proposed.length, "vote")} ${be(proposed.length)} in the Decision Log as proposed. Accept it, or say why not.`,
          href: decisionHref(proposed[0].id),
        });
      }
      const board = (boards ?? []).find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
      const topics = real(board?.cards).filter(
        (c) => c.sourceRef?.tool === "quick-vote" && !c.isActionItem
      ).length;
      if (topics > 0) {
        steps.push({
          id: "quick-vote-retro",
          label: "Talk the vote through at the retro",
          detail: `${plural(topics, "vote result")} ${be(topics)} on the retro board.`,
          href: "/retro",
        });
      }
      return steps;
    },
  }),

  // Retrospect & improve.
  retro: rule({
    select: (ws) => ({ boards: ws.retroBoards, sprints: ws.sprints }),
    steps: ({ boards, sprints }) => {
      const steps: NextStep[] = [];
      const current = (boards ?? []).find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
      const actions = current
        ? current.cards.filter((c) => c.isActionItem && !isExampleId(c.id))
        : [];
      if (current && actions.length > 0) {
        const unowned = actions.filter((c) => !c.assignee?.trim()).length;
        steps.push({
          id: "retro-follow-up",
          label: `Follow up the ${plural(actions.length, "action")} in Retro Actions`,
          detail:
            unowned > 0
              ? `${plural(unowned, "action")} ${unowned === 1 ? "has" : "have"} no owner yet. An action without one rarely gets done.`
              : "Each has an owner. Retro Actions keeps them in view until the next retro.",
          href: "/retro-actions",
        });
      }
      const next = nextPlannedSprint(sprints);
      if (next && current && hasOwnCards(current) && current.phase === "actions") {
        steps.push({
          id: "retro-plan-next",
          label: `Plan ${next.name}`,
          detail: "Bring the retro's actions into the next sprint's plan.",
          href: sprintHref("/sprint-planning", next.id),
        });
      }
      return steps;
    },
  }),

  "retro-actions": rule({
    select: (ws) => ({ boards: ws.retroBoards }),
    steps: ({ boards }) => {
      const steps: NextStep[] = [];
      const all = boards ?? [];
      const overdue = collectRetroActions(all, { today: todayIso() }).filter(
        (a) => !a.done && a.overdue
      ).length;
      if (overdue > 0) {
        steps.push({
          id: "retro-actions-overdue",
          label: `Raise the ${plural(overdue, "overdue action")} at the next retro`,
          detail: "Ask what got in the way, then drop them or give them a new date.",
          href: "/retro",
        });
      }
      const recent = followThroughByRetro(all)
        .filter((f) => !isExampleId(f.boardId))
        .slice(-3);
      const agreed = recent.reduce((sum, f) => sum + f.agreed, 0);
      const done = recent.reduce((sum, f) => sum + f.done, 0);
      if (recent.length >= 3 && agreed >= 3 && done / agreed < LOW_FOLLOW_THROUGH) {
        steps.push({
          id: "retro-actions-low-follow-through",
          label: "Agree fewer, owned actions at the next retro",
          detail: `The last ${plural(recent.length, "retro")} got ${done} of ${plural(agreed, "action")} done.`,
          href: "/retro",
        });
      }
      const back = recurringThemes(all.filter((b) => !isExampleId(b.id))).find((t) => t.cameBack);
      if (back?.cameBack) {
        steps.push({
          id: "retro-actions-came-back",
          label: `Find the root cause of “${clip(back.name)}”`,
          detail: `It came up again after “${clip(back.cameBack.actionText)}” was marked done.`,
          href: "/root-cause",
        });
      }
      return steps;
    },
  }),

  premortem: rule({
    select: (ws) => ({ risks: ws.risks }),
    steps: ({ risks }) => {
      const open = real(risks).filter(
        (r) =>
          r.sourceRef?.tool === "premortem" && (r.status === "open" || r.status === "mitigating")
      );
      const unplanned = open.filter((r) => !r.mitigation?.trim()).length;
      if (unplanned > 0) {
        return [
          {
            id: "premortem-mitigations",
            label: "Agree mitigations for the premortem's risks",
            detail: `${plural(unplanned, "risk")} from the premortem ${unplanned === 1 ? "has" : "have"} no mitigation yet.`,
            href: "/risk-register",
          },
        ];
      }
      const undated = open.filter((r) => !r.mitigationDueAt).length;
      return undated === 0
        ? []
        : [
            {
              id: "premortem-risks",
              label: "Give the premortem's risks a mitigation date",
              detail: `${plural(undated, "risk")} from the premortem ${be(undated)} open with no due date.`,
              href: "/risk-register",
            },
          ];
    },
  }),

  "liberating-structures": rule({
    select: (ws) => ({
      docs: ws.liberatingStructures,
      sprints: ws.sprints,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ docs, sprints, cadences }) => {
      const sprint = activeSprint(sprints);
      const doc = (docs ?? []).find((d) => d.id === LS_DOC_ID);
      if (!sprint || !doc) return [];
      const now = new Date();
      const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
      const [next] = nextCeremonies(sprint, cadence, now, 1);
      if (!next || next.at.getTime() - now.getTime() > STRUCTURE_LEAD_MS) return [];
      const fits = real(doc.favorites)
        .map((f) => lsStructure(f.structureId))
        .find((st) => st?.ceremonies.includes(next.kind));
      if (!fits) return [];
      return [
        {
          id: "ls-use-in-ceremony",
          label: `Use ${fits.name} in the ${CEREMONY_LABEL[next.kind]}`,
          detail: `It's ${whenLabel(next.at, now)}, and your saved structure suits it.`,
          href: fits.ceremonyTimerAgenda
            ? `/ceremony-timer?agenda=${fits.ceremonyTimerAgenda}`
            : sprintHref(CEREMONY_HREF[next.kind], sprint.id),
        },
      ];
    },
  }),

  // Points on to Retro Actions. Nothing in this file ever points at a VIP tool.
  "squad-session": rule({
    select: (ws) => ({ boards: ws.retroBoards }),
    steps: ({ boards }) => {
      // An archived board keeps its cards' ids, so each card counts once.
      const open = new Set(
        (boards ?? [])
          .flatMap((b) => b.cards)
          .filter((c) => c.isActionItem && !c.done && c.sourceRef?.tool === "squad-session")
          .map((c) => c.id)
      );
      if (open.size === 0) return [];
      return [
        {
          id: "squad-session-follow-up",
          label: "Follow up your session's actions",
          detail: `${plural(open.size, "action")} from your squad sessions ${open.size === 1 ? "is" : "are"} still open.`,
          href: "/retro-actions",
        },
      ];
    },
  }),

  "six-hats": rule({
    select: (ws) => ({
      decisions: ws.decisions,
      sessions: ws.sixHatsSessions,
      thoughts: ws.sixHatsThoughts,
    }),
    steps: ({ decisions, sessions, thoughts }) => {
      const steps: NextStep[] = [];
      const proposed = real(decisions).filter(
        (d) => d.sourceRef?.tool === "six-hats" && d.status === "proposed"
      );
      if (proposed.length > 0) {
        steps.push({
          id: "six-hats-decide",
          label: `Record the decision on “${proposed[0].title}”`,
          detail:
            "The Blue hat's summary is in the Decision Log as proposed. Accept it, or say why not.",
          href: decisionHref(proposed[0].id),
        });
      }
      const latest = [...real(sessions)].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      const risks = latest
        ? real(thoughts).filter((t) => t.sessionId === latest.id && t.hat === "black").length
        : 0;
      if (latest && risks >= 3) {
        steps.push({
          id: "six-hats-premortem",
          label: `Run a premortem on “${latest.topic}”`,
          detail: `${plural(risks, "risk")} came up under the Black hat. A premortem turns the worst into owned risks.`,
          href: "/premortem",
        });
      }
      return steps;
    },
  }),

  "design-sprint": rule({
    select: (ws) => ({ trackers: ws.hypothesisTrackers, stories: ws.stories }),
    steps: ({ trackers, stories }) => {
      const steps: NextStep[] = [];
      const drafted = real(
        (trackers ?? []).find((t) => t.id === HYPOTHESIS_TRACKER_ID)?.hypotheses
      ).filter((h) => h.sourceRef?.tool === "design-sprint" && h.status === "drafted").length;
      if (drafted > 0) {
        steps.push({
          id: "design-sprint-hypotheses",
          label: "Plan how to test the design sprint's hypotheses",
          detail: `${plural(drafted, "hypothesis", "hypotheses")} from the design sprint ${be(drafted)} still drafted.`,
          href: "/hypothesis-tracker",
        });
      }
      const fromSprint = real(stories).filter(
        (s) => fromTool(s, "design-sprint") && inBacklog(s) && !s.readiness?.ready
      ).length;
      if (fromSprint > 0) {
        steps.push({
          id: "design-sprint-refine",
          label: "Refine the stories from the design sprint",
          detail: `${plural(fromSprint, "story", "stories")} from the design sprint ${be(fromSprint)} on the backlog, not refined yet.`,
          href: "/refinement",
        });
      }
      return steps;
    },
  }),

  // Tools plan, phase 1: a named root cause wants a countermeasure, and an
  // agreed one goes to Retro Actions, where someone owns it.
  "root-cause": rule({
    select: (ws) => ({ analyses: ws.rootCauseAnalyses, boards: ws.retroBoards }),
    steps: ({ analyses, boards }) => {
      const steps: NextStep[] = [];
      // A synced row can hold anything: read each one as the page does.
      const newest = real(readAnalyses(analyses)).sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
      );
      const open = (id: string) => `/root-cause?analysis=${encodeURIComponent(id)}`;
      const named = newest.filter((a) => a.rootCause?.trim() && !a.countermeasure?.trim());
      if (named.length > 0) {
        steps.push({
          id: "root-cause-countermeasure",
          label: `Agree a countermeasure for “${clip(named[0].title)}”`,
          detail: `${plural(named.length, "analysis", "analyses")} ${named.length === 1 ? "has" : "have"} a root cause and nothing agreed yet to change it.`,
          href: open(named[0].id),
        });
      }
      // A countermeasure whose action was deleted in Retro Actions is unsent again.
      const isLive = liveOnBoards(boards);
      const unsent = newest.filter((a) => a.countermeasure?.trim() && !sentLink(a, isLive));
      if (unsent.length > 0) {
        steps.push({
          id: "root-cause-send",
          label: `Send the countermeasure for “${clip(unsent[0].title)}” to Retro Actions`,
          detail: "There someone owns it until it's done; left in the analysis, it rarely is.",
          href: open(unsent[0].id),
        });
      }
      return steps;
    },
  }),

  icebreaker: rule({
    select: (ws) => ({ sprints: ws.sprints, cadences: ws.ceremonyCadences }),
    steps: ({ sprints, cadences }) => {
      const sprint = activeSprint(sprints);
      if (!sprint) return [];
      const now = new Date();
      const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
      const [next] = nextCeremonies(sprint, cadence, now, 1);
      if (!next || next.at.getTime() - now.getTime() > TIMER_LEAD_MS) return [];
      return [
        {
          id: "icebreaker-ceremony",
          label: `Go on to the ${CEREMONY_LABEL[next.kind]}`,
          detail: `It starts ${whenLabel(next.at, now)}. Warm up, then run it there.`,
          href: sprintHref(CEREMONY_HREF[next.kind], sprint.id),
        },
      ];
    },
  }),

  // Tools plan, phase 1. Card Decks keeps its decks in its own store; from
  // the workspace it sees the next ceremony to open with a card, and the big
  // backlog stories the story-splitting deck helps with.
  "card-decks": rule({
    select: (ws) => ({ stories: ws.stories, sprints: ws.sprints, cadences: ws.ceremonyCadences }),
    steps: ({ stories, sprints, cadences }) => {
      const steps: NextStep[] = [];
      const sprint = activeSprint(sprints);
      if (sprint) {
        const now = new Date();
        const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
        const [next] = nextCeremonies(sprint, cadence, now, 1);
        if (next && next.at.getTime() - now.getTime() <= TIMER_LEAD_MS) {
          steps.push({
            id: "card-decks-ceremony",
            label: `Go on to the ${CEREMONY_LABEL[next.kind]}`,
            detail: `It starts ${whenLabel(next.at, now)}. Open it with a card, then run it there.`,
            href: sprintHref(CEREMONY_HREF[next.kind], sprint.id),
          });
        }
      }
      const big = real(stories).filter(
        (s) => inBacklog(s) && typeof s.points === "number" && s.points >= 13
      ).length;
      if (big > 0) {
        steps.push({
          id: "card-decks-split",
          label: "Split the big stories in Refinement",
          detail: `${plural(big, "story", "stories")} on the backlog ${be(big)} 13 points or more. Take the story-splitting cards along.`,
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

  // Prioritize & decide. Scores come from the method registry
  // (lib/prioritization/methods), read through to the backlog items as the
  // tools read them; a backlog link counts only while its item exists.
  prioritizer: rule({
    select: (ws) => ({ items: ws.backlogItems, rows: ws.prioritizations, stories: ws.stories }),
    steps: ({ items, rows, stories }) => {
      const { backlog, rows: team } = teamBacklog(items, rows);
      const steps: NextStep[] = [];
      // With the rows, as the hub reads it: a WSJF or RICE row linked
      // before Phase 7 still scores an item whose old defaults hide it.
      const unscored = backlog.filter(
        (b) =>
          evaluateItemIn(b, team, "wsjf").score === null &&
          evaluateItemIn(b, team, "rice").score === null
      );
      const [first] = unscored;
      if (first) {
        steps.push({
          id: "prioritizer-score",
          label: `Score ${plural(unscored.length, "item")} with WSJF`,
          detail: `${plural(unscored.length, "backlog item")} ${unscored.length === 1 ? "has" : "have"} no WSJF or RICE score yet, starting with ${quote(first.name, "an untitled item")}. A value-for-size score lets the order weigh ${unscored.length === 1 ? "it" : "them"} against the rest.`,
          href: scoreWithWsjf(first.id),
        });
      }
      // The methods Decide order can use: 2 or more items scored in each.
      const { used } = consensusMethods(backlog, team);
      const unordered = backlog.filter(
        (b) => !isRanked(b) && used.some((m) => m.position.has(b.id))
      ).length;
      if (unordered > 0) {
        steps.push({
          id: "prioritizer-decide-order",
          label: "Decide the order",
          detail: `${plural(unordered, "scored item")} ${unordered === 1 ? "isn't" : "aren't"} in the backlog order yet. Compare the methods and save one order.`,
          href: DECIDE_ORDER_HREF,
        });
      }
      const toImport = notPulled(backlog.filter(isRanked), stories).length;
      if (toImport > 0) {
        steps.push({
          id: "prioritizer-import",
          label: `Import ${plural(toImport, "ordered item")} into Sprint Planning`,
          detail:
            "“Import from the backlog” lists them in the decided order, top of the backlog first.",
          href: "/sprint-planning",
        });
      }
      return steps;
    },
  }),

  "rice-scoring": rule({
    select: (ws) => ({ rows: ws.prioritizations, items: ws.backlogItems }),
    steps: ({ rows, items }) => {
      const team = teamBacklog(items, rows);
      const ranked = rankMethodRows("rice", team.rows, team.backlog);
      const steps: NextStep[] = [];
      // Every row tied for the lead, as the page's verdict reads them: the least sure one.
      const leaders = ranked.filter((r) => r.rank === 1);
      const [shakiest] = leaders
        .flatMap((r) => {
          const confidence = toNumber(r.values.confidence);
          return confidence !== undefined && confidence <= LOW_CONFIDENCE
            ? [{ r, confidence }]
            : [];
        })
        .sort((a, b) => a.confidence - b.confidence);
      if (shakiest) {
        steps.push({
          id: "rice-test-front-runner",
          label: "Test the front-runner before building",
          detail: `${quote(shakiest.r.row.title, "The top initiative")} ${leaders.length === 1 ? "leads" : "ties for the lead"} on RICE at only ${fmt(shakiest.confidence)}% confidence. Write it up as a hypothesis and test it first.`,
          href: "/hypothesis-tracker",
        });
      }
      const linked = ranked.filter((r) => r.live).length;
      if (linked > 0) {
        steps.push({
          id: "rice-compare",
          label: "Compare across methods",
          detail: `${plural(linked, "RICE initiative")} ${be(linked)} on the backlog. See how ${linked === 1 ? "it ranks" : "they rank"} under WSJF and MoSCoW, then decide the order.`,
          href: "/prioritizer",
        });
      }
      return steps;
    },
  }),

  wsjf: rule({
    select: (ws) => ({ rows: ws.prioritizations, items: ws.backlogItems }),
    steps: ({ rows, items }) => {
      const { backlog, rows: team } = teamBacklog(items, rows);
      const scored = rankMethodRows("wsjf", team, backlog).filter((r) => r.result.score !== null);
      const linked = scored.flatMap((r) => {
        const item = linkedItem(r.row, backlog);
        return item ? [item] : [];
      });
      const steps: NextStep[] = [];
      // Decide order ranks a method from 2 scored items.
      const onBacklog = new Set(linked.map((b) => b.id)).size;
      const unordered = new Set(linked.filter((b) => !isRanked(b)).map((b) => b.id)).size;
      if (onBacklog >= 2 && unordered > 0) {
        steps.push({
          id: "wsjf-decide-order",
          label: "Decide the backlog order",
          detail: `${plural(unordered, "scored feature")} ${unordered === 1 ? "has" : "have"} no place in the backlog order yet. Decide the order so Sprint Planning pulls them in that order.`,
          href: DECIDE_ORDER_HREF,
        });
      }
      if (scored.length >= 3 && linked.length === 0) {
        steps.push({
          id: "wsjf-backlog",
          label: "Put the top features on the backlog",
          detail: `${plural(scored.length, "feature")} ${be(scored.length)} scored and none is on the backlog. Add the top ones from their rows, so the Backlog Prioritizer can order them and Sprint Planning can pull them.`,
          href: "/wsjf",
        });
      }
      return steps;
    },
  }),

  moscow: rule({
    select: (ws) => ({ rows: ws.prioritizations, items: ws.backlogItems }),
    steps: ({ rows, items }) => {
      const { backlog, rows: team } = teamBacklog(items, rows);
      // The Must budget as the page reads it: a linked item's job size, else the row's effort.
      const entries = rankMethodRows("moscow", team, backlog).map((r) => {
        const item = linkedItem(r.row, backlog);
        return {
          bucket: toChoice(MOSCOW_BUCKETS, r.result.bucket) ?? null,
          effort: moscowEffort(readThrough(r.row, item), item),
          linked: item !== undefined,
        };
      });
      const budget = mustBudget(entries);
      const steps: NextStep[] = [];
      if (budget.over && budget.share !== null) {
        steps.push({
          id: "moscow-over-budget",
          label: "Order the Musts with WSJF",
          detail: `Musts take ${Math.round(budget.share * 100)}% of the planned effort, over the limit of about ${Math.round(MUST_BUDGET_SHARE * 100)}%. Score them with WSJF to see which can drop to Should.`,
          href: "/wsjf",
        });
      }
      const unsized = entries.filter(
        (e) => e.linked && e.bucket !== null && e.bucket !== "wont" && !isSized(e.effort)
      ).length;
      if (unsized > 0) {
        steps.push({
          id: "moscow-size",
          label: "Size the unsized backlog items",
          detail: `${plural(unsized, "planned backlog item")} ${unsized === 1 ? "has" : "have"} no job size, so the Must budget can't count ${unsized === 1 ? "it" : "them"}. Set ${unsized === 1 ? "its" : "their"} job size in the Backlog Prioritizer.`,
          href: "/prioritizer",
        });
      }
      return steps;
    },
  }),

  "cost-of-delay": rule({
    select: (ws) => ({
      rows: ws.prioritizations,
      items: ws.backlogItems,
      stories: ws.stories,
      sprints: ws.sprints,
    }),
    steps: ({ rows, items, stories, sprints }) => {
      const today = todayIso();
      const soon = addDays(today, FIXED_DATE_LEAD_DAYS) ?? today;
      const { backlog, rows: team } = teamBacklog(items, rows);
      const scored = rankMethodRows("cost-of-delay", team).filter((r) => r.result.score !== null);
      const steps: NextStep[] = [];
      // The fixed-date item that has to start soonest (or should have started),
      // until a story for it is planned into a sprint or done.
      const [fixed] = scored
        .flatMap((r) => {
          const start = r.result.extra?.latestStart;
          const due = r.values.fixedDate;
          return r.result.bucket === "fixed_date" &&
            typeof start === "string" &&
            typeof due === "string" &&
            start <= soon &&
            !plannedStory(r.row, linkedItem(r.row, backlog), stories, sprints)
            ? [{ r, start, due }]
            : [];
        })
        .sort((a, b) => a.start.localeCompare(b.start));
      if (fixed) {
        const what = quote(fixed.r.row.title, "A fixed-date item");
        const next = nextPlannedSprint(sprints);
        const into = next?.name ?? "the next sprint";
        steps.push({
          id: "cod-fixed-date",
          label: "Plan the fixed-date work now",
          detail:
            fixed.start < today
              ? `${what} should have started by ${dayLabel(fixed.start)} to land by ${dayLabel(fixed.due)}: it's already late. Pull it into ${into}, or agree a new date.`
              : `${what} must start by ${dayLabel(fixed.start)} to land by ${dayLabel(fixed.due)}. Pull it into ${into}.`,
          href: sprintHref("/sprint-planning", next?.id),
        });
      }
      if (scored.length >= 2) {
        steps.push({
          id: "cod-wsjf",
          label: "Cross-check with WSJF",
          detail:
            "CD3 puts money on waiting; WSJF sizes the same trade-off relatively. A big disagreement between them is worth a conversation.",
          href: "/wsjf",
        });
      }
      return steps;
    },
  }),

  "value-effort-matrix": rule({
    select: (ws) => ({
      rows: ws.prioritizations,
      items: ws.backlogItems,
      stories: ws.stories,
      sprints: ws.sprints,
    }),
    steps: ({ rows, items, stories, sprints }) => {
      const { backlog, rows: team } = teamBacklog(items, rows);
      const wins = rankMethodRows("value-effort", team, backlog).filter(
        (r) => r.result.bucket === "quick_wins"
      );
      const steps: NextStep[] = [];
      const onBacklog = new Map(
        wins.flatMap((r) => {
          const item = linkedItem(r.row, backlog);
          return item ? [[item.id, item] as const] : [];
        })
      );
      const toPlan = notPulled(Array.from(onBacklog.values()), stories).length;
      if (toPlan > 0) {
        const next = nextPlannedSprint(sprints);
        steps.push({
          id: "value-effort-plan",
          label: "Plan the quick wins",
          detail: `${plural(toPlan, "Quick Win")} ${be(toPlan)} on the backlog and not in Sprint Planning yet. Pull ${toPlan === 1 ? "it" : "them"} into ${next?.name ?? "the next sprint"}.`,
          href: sprintHref("/sprint-planning", next?.id),
        });
      }
      const off = wins.filter((r) => !r.live).length;
      if (off > 0) {
        steps.push({
          id: "value-effort-backlog",
          label: "Put the quick wins on the backlog",
          detail: `${plural(off, "Quick Win")} ${off === 1 ? "isn't" : "aren't"} on the backlog yet. Add ${off === 1 ? "it from its row" : "them from their rows"}, so Sprint Planning can pull ${off === 1 ? "it" : "them"}.`,
          href: "/value-effort-matrix",
        });
      }
      return steps;
    },
  }),

  eisenhower: rule({
    select: (ws) => ({ rows: ws.prioritizations, members: ws.teamMembers }),
    steps: ({ rows, members }) => {
      const today = todayIso();
      // The panes as the page derives them today (a legacy quadrant read first).
      const tasks = eisRows(real(rows), today).map((r) => taskView(r, today));
      const steps: NextStep[] = [];
      const dueNow = tasks
        .flatMap((t) => {
          const days = t.urgency.daysToDue;
          return t.quadrant === "do" && days !== null && days <= 0 ? [{ t, days }] : [];
        })
        .sort((a, b) => a.days - b.days);
      const [worst] = dueNow;
      if (worst) {
        const n = dueNow.length;
        steps.push({
          id: "eisenhower-due",
          label:
            n === 1
              ? "Raise the Do task due now at the standup"
              : `Raise the ${n} Do tasks due now at the standup`,
          detail: `${quote(worst.t.ranked.row.title, "A Do task")} is ${dueText(worst.days)}${n > 1 ? `, and ${plural(n - 1, "other Do task")} ${n === 2 ? "is" : "are"} due or past due` : ""}. Say at the Daily Scrum what ${n === 1 ? "it needs" : "they need"} to get done.`,
          href: "/standup",
        });
      }
      const unassigned = tasks.filter((t) => t.quadrant === "delegate" && !t.delegateTo);
      const [nobody] = unassigned;
      if (nobody) {
        const n = unassigned.length;
        steps.push(
          real(members).length === 0
            ? {
                id: "eisenhower-team",
                label: "Add your team to delegate to",
                detail: `${plural(n, "Delegate task")} ${n === 1 ? "has" : "have"} nobody named. With the team on the Team page, “Who takes it?” picks from them.`,
                href: "/team",
              }
            : {
                id: "eisenhower-delegate",
                label: `Name who takes ${n === 1 ? "the Delegate task" : `the ${n} Delegate tasks`}`,
                detail: `${quote(nobody.ranked.row.title, "A Delegate task")}${n > 1 ? ` and ${plural(n - 1, "other")}` : ""} ${n === 1 ? "has" : "have"} nobody named yet: a task delegated to nobody stays yours.`,
                href: "/eisenhower",
              }
        );
      }
      return steps;
    },
  }),

  "kano-model": rule({
    select: (ws) => ({ rows: ws.prioritizations, items: ws.backlogItems }),
    steps: ({ rows, items }) => {
      const { backlog, rows: team } = teamBacklog(items, rows);
      const features = rankMethodRows("kano", team);
      // Categories from answers: a legacy one picked by hand says nothing about customers.
      const answered = features.filter((r) => r.result.extra?.source !== "picked");
      const steps: NextStep[] = [];
      const mustBe = answered.filter(
        (r) => r.result.bucket === "must-be" && !linkedItem(r.row, backlog)
      );
      if (mustBe.length > 0) {
        const n = mustBe.length;
        steps.push({
          id: "kano-must-be",
          label: "Put the must-haves on the backlog",
          detail: `${listNames(mustBe.map((r) => quote(r.row.title, "an untitled feature")))} came out Must-be: customers expect ${n === 1 ? "it" : "them"}, and ${n === 1 ? "it isn't" : "they aren't"} on the backlog yet. Add ${n === 1 ? "it from its row" : "them from their rows"}.`,
          href: "/kano-model",
        });
      }
      const questionable = answered.filter((r) => r.result.bucket === "questionable");
      if (questionable.length > 0) {
        const n = questionable.length;
        steps.push({
          id: "kano-questionable",
          label:
            n === 1
              ? `Find out why the answers on ${quote(questionable[0].row.title, "a feature")} contradict`
              : `Find out why the answers on ${n} features contradict`,
          detail: `Questionable means the two answers contradict each other. Ask about ${n === 1 ? "it" : "them"} in your next customer interview, then reword the ${n === 1 ? "question" : "questions"}.`,
          href: "/user-interviews",
        });
      }
      const linked = features.filter((r) => linkedItem(r.row, backlog)).length;
      if (linked > 0) {
        steps.push({
          id: "kano-compare",
          label: "Compare across methods",
          detail: `${plural(linked, "Kano feature")} ${be(linked)} on the backlog. See ${linked === 1 ? "its" : "their"} Kano category next to WSJF and RICE for the same ${linked === 1 ? "item" : "items"}.`,
          href: "/prioritizer",
        });
      }
      return steps;
    },
  }),

  "buy-a-feature": rule({
    select: (ws) => ({
      rows: ws.prioritizations,
      games: ws.buyAFeatureGames,
      stories: ws.stories,
    }),
    steps: ({ rows, games, stories }) => {
      const features = featureRows(real(rows)).map((row) => ({ row, f: featureLedger(row) }));
      const storyIds = new Set((stories ?? []).map((s) => s.id));
      const steps: NextStep[] = [];
      const unsent = features.filter(
        ({ row, f }) => isFunded(f) && !linkedTo(row.sentTo, "backlog-story", storyIds)
      ).length;
      if (unsent > 0) {
        steps.push({
          id: "buy-a-feature-push",
          label: "Push the funded features to the backlog",
          detail: `${plural(unsent, "funded feature")} ${unsent === 1 ? "isn't" : "aren't"} on the backlog yet. “Add ${plural(unsent, "funded feature")} to the backlog” under Funded makes ${unsent === 1 ? "it a story" : "each one a story"}.`,
          href: "/buy-a-feature",
        });
      }
      const unsized = real(stories).filter(
        (s) => fromTool(s, "buy-a-feature") && inBacklog(s) && unestimated(s)
      ).length;
      if (unsized > 0) {
        steps.push({
          id: "buy-a-feature-size",
          label: "Size the funded stories",
          detail: `${plural(unsized, "story", "stories")} from Buy-a-Feature ${unsized === 1 ? "has" : "have"} no points yet.`,
          href: "/planning-poker",
        });
      }
      // Setting the game up: prices first, then a pool that can't buy everything.
      const ledgers = features.map((x) => x.f);
      const unpriced = ledgers.filter((f) => f.price === null).length;
      const game = (games ?? []).find((g) => g.id === BUY_A_FEATURE_ID) ?? null;
      const check = gameCheck(game, ledgers);
      const problem = check && budgetProblem(check, unitOf(game));
      if (unpriced > 0) {
        steps.push({
          id: "buy-a-feature-price",
          label: `Price ${plural(unpriced, "feature")}`,
          detail: `${unpriced === 1 ? "It has" : "They have"} no whole price, so ${unpriced === 1 ? "it's" : "they're"} left out of rounds and the budget check.`,
          href: "/buy-a-feature",
        });
      } else if (pricesOf(ledgers).length >= 2 && (!check || problem)) {
        steps.push({
          id: "buy-a-feature-pool",
          label: "Set the players and their budget",
          detail:
            problem ||
            "The pool is the players times each one's budget. Keep it to about half of the prices, so nobody can have everything.",
          href: "/buy-a-feature",
        });
      }
      return steps;
    },
  }),

  "hundred-dollar-test": rule({
    select: (ws) => ({ rows: ws.prioritizations, rounds: ws.allocationRounds }),
    steps: ({ rows, rounds }) => {
      const items = hundredRows(real(rows));
      const [latest] = roundsFor(real(rounds), "hundred-dollar-test");
      const steps: NextStep[] = [];
      // Team level only: a round keeps totals, never anyone's split.
      const money = latest ? latest.budget * latest.ballots : 0;
      if (latest && money > 0 && latest.items.length >= 2) {
        const top = [...teamAverages(latest)].sort((a, b) => b.total - a.total).slice(0, 2);
        const share = (top[0].total + top[1].total) / money;
        steps.push({
          id: "hundred-dollar-score",
          label: "Score the front-runners in the Backlog Prioritizer",
          detail: `${listAnd(top.map((a) => quote(a.text, "an untitled item")))} got ${Math.round(share * 100)}% of the team's money in the round of ${dayLabel(latest.date)}. Put them on the backlog and score them, so the decided order reflects it.`,
          href: "/prioritizer",
        });
      }
      if (!latest && items.length >= 2) {
        steps.push({
          id: "hundred-dollar-round",
          label: "Run a team round",
          detail:
            "Let everyone split their own $100 anonymously, then compare the team's averages with the agreed split.",
          href: "/hundred-dollar-test",
        });
      }
      const split = splitSummary(items);
      if (split.given > 0 && !split.full && split.remaining > 0) {
        steps.push({
          id: "hundred-dollar-split",
          label: `Give out the last ${dollars(split.remaining)}`,
          detail:
            "The $100 Test only works when the whole budget is split: money left over hides the trade-offs.",
          href: "/hundred-dollar-test",
        });
      }
      return steps;
    },
  }),

  "decision-log": decisionRule,
  daci: decisionRule,
  "rapid-decision": decisionRule,

  "weighted-decision": rule({
    select: (ws) => ({
      matrices: ws.weightedMatrices,
      options: ws.weightedOptions,
      criteria: ws.weightedCriteria,
      decisions: ws.decisions,
      daci: ws.daciDecisions,
      rapid: ws.rapidDecisions,
    }),
    steps: ({ matrices, options, criteria, decisions, daci, rapid }) => {
      const opts = real(options);
      const crits = real(criteria);
      const records = allDecisions(decisions, daci, rapid);
      // Newest first, as the page opens the newest.
      const results = matricesOf(real(matrices), opts, crits)
        .reverse()
        .map((m) => ({
          m,
          r: matrixResult(m.id, crits, opts),
          sent: sentDecisionOf(m, records) !== undefined,
        }));
      const steps: NextStep[] = [];
      const ready = results.find((x) => !x.sent && !x.r.tie && sendBlock(x.m, x.r) === null);
      if (ready) {
        steps.push({
          id: "weighted-record",
          label: `Record the decision on “${matrixTitle(ready.m)}”`,
          detail: `${ready.r.verdict} Use “Send to…” → “Decision record (proposed)” under the result: the team writes down what it decides.`,
          href: matrixHref(ready.m.id),
        });
      }
      const tied = results.find((x) => !x.sent && x.r.tie);
      if (tied) {
        steps.push({
          id: "weighted-tie",
          label: `“${matrixTitle(tied.m)}” is too close to call: talk it through before deciding`,
          detail: tied.r.verdict,
          href: matrixHref(tied.m.id),
        });
      }
      const empty = results.find((x) => x.r.emptyCells > 0);
      if (empty) {
        steps.push({
          id: "weighted-empty-cells",
          label: `Score the ${plural(empty.r.emptyCells, "empty cell")} in “${matrixTitle(empty.m)}”`,
          detail: `An empty cell isn't 0: an option gets a total, and can lead, only once every weighted criterion is scored.`,
          href: matrixHref(empty.m.id),
        });
      }
      return steps;
    },
  }),

  cynefin: rule({
    select: (ws) => ({ items: ws.cynefinItems, trackers: ws.hypothesisTrackers }),
    steps: ({ items, trackers }) => {
      const board = real(items);
      const hypotheses = (trackers ?? []).find((t) => t.id === HYPOTHESIS_TRACKER_ID)?.hypotheses;
      const steps: NextStep[] = [];
      // Something going wrong now comes before learning.
      const chaotic = board.filter((it) => normalizeDomain(it.domain) === "chaotic");
      if (chaotic.length > 0) {
        const n = chaotic.length;
        steps.push({
          id: "cynefin-chaotic",
          label:
            n === 1 ? "Stabilise the chaotic item first" : `Stabilise the ${n} chaotic items first`,
          detail: `${quote(chaotic[0].title, "A chaotic item")}${n > 1 ? ` and ${plural(n - 1, "other")}` : ""} ${n === 1 ? "needs" : "need"} action before analysis: act to stop the harm, then sense where ${n === 1 ? "it stands and move it" : "each stands and move it"} to its new domain.`,
          href: "/cynefin",
        });
      }
      const untested = complexNotTested(board, hypotheses);
      if (untested.length > 0) {
        const n = untested.length;
        steps.push({
          id: "cynefin-hypotheses",
          label:
            n === 1
              ? "Turn the complex item into a hypothesis to test"
              : `Turn the ${n} complex items into hypotheses to test`,
          detail: `Only trying will tell with complex work. “Turn into a hypothesis” on ${n === 1 ? "its card" : "each card"} sends it to the Hypothesis Tracker, starting with ${quote(untested[0].title, "an untitled item")}.`,
          href: "/cynefin",
        });
      }
      const tested = board.find(
        (it) =>
          normalizeDomain(it.domain) === "complex" && hypothesisStateOf(it, hypotheses) === "tested"
      );
      if (tested) {
        steps.push({
          id: "cynefin-results",
          label: `See what the test of ${quote(tested.title, "a complex item")} found`,
          detail:
            "Its hypothesis has a result. Act on what it showed, or move the item if it isn't complex any more.",
          href: "/hypothesis-tracker",
        });
      }
      return steps;
    },
  }),

  // Team & people. The pulse tools first: a vote round keeps only totals,
  // so their steps read team-level numbers (saved checks, rounds of counts,
  // the team's mood) and never name or single out anyone. One-on-One,
  // Onboarding and the Stakeholder Map keep their records in the tool's own
  // saved blob, which a rule can't read: their steps come from the roster,
  // the sprints and the mood check-ins.
  "health-check": rule({
    select: (ws) => ({ docs: ws.healthChecks, boards: ws.retroBoards, sprints: ws.sprints }),
    steps: ({ docs, boards, sprints }) => {
      const doc = (docs ?? []).find((d) => d.id === HEALTH_CHECK_ID);
      // Saved checks only (never the draft), example ones left out.
      const checks = checksByDate(doc);
      const latest = checks[checks.length - 1];
      if (!latest) return [];
      const steps: NextStep[] = [];
      const name = latest.sprintName?.trim();
      const where = name
        ? `the ${name} check`
        : `the check of ${dayLabel(latest.date) || "an unknown day"}`;
      const reds = redDimensions(latest, doc).map((d) => ({
        name: d.name,
        at: retroTopicAt(scoreOf(latest, d.key)?.sentTo, boards),
      }));
      const unsent = reds.filter((r) => r.at === null);
      const onBoard = reds.filter((r) => r.at === "current");
      if (unsent.length > 0) {
        // The check's own button: "Send N more" once some of its reds are topics.
        const button =
          unsent.length === reds.length ? "Send reds to retro" : `Send ${unsent.length} more`;
        steps.push({
          id: "health-check-send-reds",
          label: `Send the ${plural(unsent.length, "red dimension")} to the retro`,
          detail: `${listNames(unsent.map((r) => r.name))} ${unsent.length === 1 ? "was" : "were"} red in ${where}. “${button}” under Saved checks makes ${unsent.length === 1 ? "it" : "each one"} a topic.`,
          href: "/health-check",
        });
      } else if (onBoard.length > 0) {
        steps.push({
          id: "health-check-discuss-reds",
          label: `Discuss the ${plural(onBoard.length, "red dimension")} at the retro`,
          detail: `${listNames(onBoard.map((r) => r.name))} from ${where} ${be(onBoard.length)} on the current retro board as ${onBoard.length === 1 ? "a topic" : "topics"}.`,
          href: "/retro",
        });
      }
      // Sprint Comparison reads Quality from the check it matches to a sprint.
      const all = real(sprints);
      const sprint = latest.sprintId ? all.find((s) => s.id === latest.sprintId) : undefined;
      const others = sprint
        ? all.filter((s) => s.id !== sprint.id && healthCheckFor(doc, s, all)).length
        : 0;
      if (sprint && others > 0) {
        steps.push({
          id: "health-check-compare",
          label: "Compare quality across sprints",
          detail: `Sprint Comparison suggests ${sprint.name}'s Quality from this check's ${listNames(QUALITY_DIMENSIONS)} lights, next to ${plural(others, "other sprint")} with a check.`,
          href: sprintHref("/sprint-compare", sprint.id),
        });
      }
      const before = checks[checks.length - 2];
      const was = sharePct(entryShare(before));
      const now = sharePct(entryShare(latest));
      if (steps.length === 0 && was !== null && now !== null) {
        steps.push({
          id: "health-check-dashboard",
          label: "See team health on the Team Dashboard",
          detail:
            was === now
              ? `Health held at ${now}% since the check before.`
              : `Health went from ${was}% to ${now}% since the check before.`,
          href: "/health-dashboard",
        });
      }
      return steps;
    },
  }),

  "psych-safety": rule({
    select: (ws) => ({ logs: ws.psychSafetyLogs, boards: ws.retroBoards }),
    steps: ({ logs, boards }) => {
      const stored = (logs ?? []).find((l) => l.id === PSYCH_SAFETY_ID);
      // Example rounds and answer sheets left out (a sheet's answers are only
      // ever counted), behind the guards roundsOf keeps against a malformed log.
      const sheets = Array.isArray(stored?.responses) ? stored.responses : [];
      const rounds = roundsOf(
        stored && { ...stored, responses: sheets.filter((r) => r && !isExampleId(r.id)) }
      ).filter((r) => !isExampleId(r.id));
      const latest = rounds[rounds.length - 1];
      // Below the minimum a round shows nothing, so it suggests nothing either.
      const result = roundResult(latest);
      if (!latest || !result) return [];
      const steps: NextStep[] = [];
      const previous = rounds[rounds.length - 2];
      const cmp = compareRounds(previous, latest);
      const dropped = cmp?.dropped ?? [];
      const [fell] = dropped;
      if (previous && fell) {
        const what =
          dropped.length === 1
            ? `“${questionMeta(fell)?.text}”`
            : `${dropped.length} statements, “${questionMeta(fell)?.text}” most,`;
        const fact = `${what} fell by more than ${ANOMALY_DROP} since ${previous.name}`;
        const at = retroTopicAt(latest.sentTo, boards);
        // The legacy round is read-only: it has nowhere to keep a send.
        if (at === null && latest.source !== "legacy") {
          steps.push({
            id: "psych-safety-send-drop",
            label: "Send the drop to the retro",
            detail: `${fact}. Use “Send to…” → “Retro topic (no names)” under Results: the topic names the statements, never who answered what.`,
            href: "/psych-safety",
          });
        } else if (at !== "held") {
          steps.push({
            id: "psych-safety-drop",
            label: "Talk about the drop at the retro",
            detail:
              at === "current"
                ? `${fact}. It's on the current retro board as a topic.`
                : `${fact}. Talk it through as a team, without asking who answered what.`,
            href: "/retro",
          });
        }
      }
      // A statement that fell is raised with the drop already.
      const low = result.perQuestion.find((q) => q.id === result.lowest);
      if (
        low &&
        low.adjusted !== null &&
        low.adjusted < UNSAFE_BELOW &&
        !dropped.includes(low.id)
      ) {
        steps.push({
          id: "psych-safety-lowest",
          label: "Talk through the lowest-scoring statement at the retro",
          detail: `“${low.text}” scored ${fmt(low.adjusted, 2)} out of 5${low.reversed ? " (reverse-scored)" : ""} in ${latest.name}. Ask what would make it safer, never who answered what.`,
          href: "/retro",
        });
      }
      return steps;
    },
  }),

  "mood-tracker": rule({
    select: (ws) => ({
      entries: ws.moodEntries,
      pulses: ws.moodPulses,
      docs: ws.moodTrackerDocs,
      boards: ws.retroBoards,
      sprints: ws.sprints,
    }),
    steps: ({ entries, pulses, docs, boards, sprints }) => {
      const steps: NextStep[] = [];
      // Team level only: a streak day needs three check-ins, so it is never one person's mood.
      const streak = lowMoodStreak(entries, pulses, todayIso());
      if (streak) {
        const doc = (docs ?? []).find((d) => d.id === MOOD_TRACKER_ID);
        const at = retroTopicAt(streakLinks(doc, streak), boards);
        const fact = `The team averaged ${fmt(streak.average)} out of 5 over ${streak.days} check-in days in a row (${daySpan(streak.start, streak.end)})`;
        if (at === null) {
          steps.push({
            id: "mood-send-streak",
            label: "Raise the low-mood streak at the retro",
            detail: `${fact}. Use “Send to…” → “Retro topic (no names)” on the low-mood callout: the topic names no one.`,
            href: "/mood-tracker",
          });
        } else if (at === "current") {
          steps.push({
            id: "mood-discuss-streak",
            label: "Discuss the low-mood streak at the retro",
            detail: `${fact}. It's on the current retro board as a topic.`,
            href: "/retro",
          });
        }
      }
      // Sprint Comparison's Team Happiness reads the same check-ins, pulses included.
      const sprint = pickDefaultSprint(real(sprints), null);
      const mood =
        sprint && sprint.status !== "cancelled" && !hasSyntheticDates(sprint)
          ? moodDuring(entries, sprint.startDate.slice(0, 10), sprint.endDate.slice(0, 10), pulses)
          : null;
      if (sprint && mood && mood.average !== null) {
        steps.push({
          id: "mood-sprint-compare",
          label: "See Team Happiness in Sprint Comparison",
          detail: `${plural(mood.checkIns, "check-in")} during ${sprint.name} average ${fmt(mood.average)} out of 5: Sprint Comparison suggests its Team Happiness from them.`,
          href: sprintHref("/sprint-compare", sprint.id),
        });
      }
      return steps;
    },
  }),

  kudos: rule({
    select: (ws) => ({
      kudos: ws.kudos,
      boards: ws.retroBoards,
      sprints: ws.sprints,
      members: ws.teamMembers,
    }),
    steps: ({ kudos, boards, sprints, members }) => {
      const steps: NextStep[] = [];
      const today = todayIso();
      const current = (boards ?? []).find((b) => b.id === RETRO_CURRENT_ID && !b.archivedAt);
      const sprint = kudosSprint(sprints, current?.sprintId, today);
      const window = sprint ? sprintWindow(sprint) : null;
      if (sprint && window) {
        // A kudos on any retro board, this one or an archived one, was appreciated already.
        const onBoard = new Set(
          (boards ?? []).flatMap((b) =>
            (b.cards ?? []).flatMap((c) =>
              c.sourceRef?.tool === KUDOS_TOOL ? [c.sourceRef.id] : []
            )
          )
        );
        const waiting = (kudos ?? []).filter(
          (k) => isRecognition(k) && sentIn(k, window) && !onBoard.has(k.id)
        ).length;
        if (waiting > 0) {
          const named = current?.sprintId === sprint.id;
          // The board lists the sprint's kudos in its Write phase only; a
          // kudos' own "Add to retro" works in any phase.
          const pastWrite = (current?.phase ?? "write") !== "write";
          steps.push({
            id: "kudos-retro",
            label: `Bring ${waiting} kudos from ${sprint.name} to the retro`,
            detail: pastWrite
              ? named
                ? `The retro is past its Write phase: step back to Write for “Kudos from ${sprint.name}”, or use “Add to retro” on each kudos.`
                : "The retro is past its Write phase: use “Add to retro” on each kudos."
              : named
                ? `They go in the appreciations column: add them from “Kudos from ${sprint.name}” on the board.`
                : `Pick ${sprint.name} on the retro board to add them to the appreciations column.`,
            href: "/retro",
          });
        }
      }
      if (real(members).length === 0) {
        steps.push({
          id: "kudos-team",
          label: "Add your team to see who the kudos reach",
          detail: "With the roster, Not thanked yet shows who hasn't had a kudos lately.",
          href: "/team",
        });
      }
      return steps;
    },
  }),

  "one-on-one": rule({
    select: (ws) => ({ members: ws.teamMembers, mood: ws.moodEntries, pulses: ws.moodPulses }),
    steps: ({ members, mood, pulses }) => {
      const steps: NextStep[] = [];
      const today = todayIso();
      // Anonymous pulse answers count as check-ins, as on the Mood Tracker.
      const week = moodDuring(mood, addDays(today, -6) ?? today, today, pulses);
      if (week.average !== null && week.average <= LOW_MOOD) {
        steps.push({
          id: "one-on-one-mood",
          label: "Look at this week's low mood before your 1:1s",
          detail: `${plural(week.checkIns, "mood check-in")} this week average ${week.average} out of 5.`,
          href: "/mood-tracker",
        });
      }
      if (real(members).length === 0) {
        steps.push({
          id: "one-on-one-team",
          label: "Add your reports to the team",
          detail: "With them on the Team page, each report's cadence and timeline follow them.",
          href: "/team",
        });
      }
      return steps;
    },
  }),

  // No capacity step: who is new is in the tool's blob, and a roster
  // member has no join date, so it would show for every open sprint.
  "onboarding-tracker": rule({
    select: (ws) => ({ members: ws.teamMembers }),
    steps: ({ members }) =>
      real(members).length === 0
        ? [
            {
              id: "onboarding-team",
              label: "Add the new joiner to the team",
              detail:
                "On the Team page they show up in capacity, standups and their buddy's picker.",
              href: "/team",
            },
          ]
        : [],
  }),

  "stakeholder-map": rule({
    select: (ws) => ({ sprints: ws.sprints, cadences: ws.ceremonyCadences }),
    steps: ({ sprints, cadences }) => {
      const sprint = activeSprint(sprints);
      if (!sprint) return [];
      const now = new Date();
      const cadence = normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }));
      const review = ceremonyDates(sprint, cadence).find(
        (o) => o.kind === "review" && o.at.getTime() >= now.getTime()
      );
      if (!review || review.at.getTime() - now.getTime() > REVIEW_INVITE_LEAD_MS) return [];
      return [
        {
          id: "stakeholder-review",
          label: `Invite your key stakeholders to the ${sprint.name} review`,
          detail: `It's ${whenLabel(review.at, now)}. The ones you manage closely should see the increment and give feedback.`,
          href: sprintHref("/sprint-review", sprint.id),
        },
      ];
    },
  }),

  "working-agreement": rule({
    select: (ws) => ({ docs: ws.workingAgreements, members: ws.teamMembers }),
    steps: ({ docs, members }) => {
      const stored = normalizeAgreement((docs ?? []).find((d) => d.id === WA_ID));
      const doc = { ...stored, rules: real(stored.rules), checkIns: real(stored.checkIns) };
      const steps: NextStep[] = [];
      const today = todayIso();
      const last = lastCheckIn(doc);
      if (last) {
        // Rules the last round found not working, still in the agreement, longest run first.
        // The run counts rounds that found it not working: a "partly" round before them ends it.
        const failing = doc.rules
          .filter((r) => last.results[r.id] === "not_working")
          .map((r) => {
            const run = slippingRun(doc, r.id);
            const partly = run.indexOf("partly");
            return { rule: r, streak: partly < 0 ? run.length : partly };
          })
          .sort((a, b) => b.streak - a.streak);
        const [worst] = failing;
        if (worst) {
          const more = failing.length - 1;
          steps.push({
            id: "working-agreement-retro",
            label: `Talk through the ${plural(failing.length, "rule")} not working at the retro`,
            detail: `The ${dayLabel(last.date)} check-in found “${worst.rule.text.trim()}” not working${
              worst.streak >= 2 ? ` (${worst.streak} check-ins in a row)` : ""
            }${more > 0 ? `, and ${plural(more, "other rule")}` : ""}.`,
            href: "/retro",
          });
        }
      }
      const missing =
        doc.rules.length > 0 ? agreementConsent(doc, real(members)).missingPeople : [];
      if (missing.length > 0) {
        steps.push({
          id: "working-agreement-consent",
          label: `Ask ${plural(missing.length, "teammate")} for consent to the working agreement`,
          detail: `${listNames(missing)} ${missing.length === 1 ? "hasn't" : "haven't"} answered every rule yet.`,
          href: "/working-agreement",
        });
      }
      // Due a round some time after the last one, or after it was first published.
      const published = doc.meta.version > 0 ? doc.meta.publishedAt : undefined;
      const since = last?.date ?? doc.versions?.[0]?.publishedAt ?? published;
      const age = published ? daysFrom(since, today) : null;
      if (age !== null && age >= AGREEMENT_CHECK_IN_DAYS) {
        steps.push({
          id: "working-agreement-check-in",
          label: "Check in on the working agreement",
          detail: last
            ? `The last check-in was ${age} days ago. Is each rule still working?`
            : `It was published ${age} days ago and hasn't had a check-in yet. Is each rule working?`,
          href: "/working-agreement",
        });
      }
      return steps;
    },
  }),

  "dod-builder": rule({
    select: (ws) => ({ dods: ws.definitionsOfDone, stories: ws.stories, sprints: ws.sprints }),
    steps: ({ dods, stories, sprints }) => {
      const doc = dodOf(dods);
      const sprint = pickDefaultSprint(real(sprints), null);
      const adherence = dodAdherence(stories ?? [], doc, sprint?.id);
      if (requiredCriteria(doc).length === 0) {
        return adherence.done === 0
          ? []
          : [
              {
                id: "dod-required",
                label:
                  doc.items.length === 0
                    ? "Write your Definition of Done"
                    : "Mark the criteria every story must meet",
                detail: `${plural(adherence.done, "story", "stories")}${sprint ? ` in ${sprint.name}` : ""} ${adherence.done === 1 ? "is" : "are"} done with nothing required to check ${adherence.done === 1 ? "it" : "them"} against.`,
                href: "/dod-builder",
              },
            ];
      }
      const [first] = adherence.missing;
      if (!sprint || !first) return [];
      const more = adherence.missing.length - 1;
      return [
        {
          id: "dod-missing",
          label: `Check the ${plural(adherence.missing.length, "done story", "done stories")} that miss the DoD`,
          detail: `In ${sprint.name}, “${first.title.trim() || "an untitled story"}” still needs ${listNames(first.open)}${
            more > 0
              ? `, and ${plural(more, "other story", "other stories")} need${more === 1 ? "s" : ""} ticks too`
              : ""
          }.`,
          href: sprintHref("/kanban", sprint.id),
        },
      ];
    },
  }),

  raci: rule({
    select: (ws) => ({ matrices: ws.raciMatrices }),
    steps: ({ matrices }) => {
      const stored = normalizeRaci((matrices ?? []).find((m) => m.id === RACI_ID));
      // Example rows out; their cells are never read once the rows are gone.
      const m = { ...stored, roles: real(stored.roles), activities: real(stored.activities) };
      const steps: NextStep[] = [];
      const issues = activityIssues(m);
      if (issues.length > 0) {
        const n = new Set(issues.map((i) => i.activityId)).size;
        steps.push({
          id: "raci-issues",
          label: `Give ${plural(n, "activity", "activities")} one Accountable and someone Responsible`,
          detail: issues[0].message,
          href: "/raci",
        });
      }
      const load = loadWarnings(m).find((w) => w.kind === "accountable_load");
      const role = load && m.roles.find((r) => r.id === load.roleId);
      if (load && role) {
        steps.push({
          id: "raci-accountable-load",
          label: `Share out some of ${role.name}'s accountability`,
          detail: `${load.summary}.`,
          href: "/raci",
        });
      }
      return steps;
    },
  }),

  "skills-matrix": rule({
    select: (ws) => ({ matrices: ws.skillsMatrices, members: ws.teamMembers, sprints: ws.sprints }),
    steps: ({ matrices, members, sprints }) => {
      const steps: NextStep[] = [];
      const roster = realRoster(members);
      if (roster.length === 0) {
        steps.push({
          id: "skills-team",
          label: "Add your team to rate their skills",
          detail: "The matrix rates the people on the Team page: each one becomes a column.",
          href: "/team",
        });
      }
      const doc = normalizeSkillsMatrix((matrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID));
      const columns = matrixColumns(doc, roster);
      const pairs = openTraining(doc).filter((p) => !isExampleId(p.id));
      const paired = new Set(pairs.map((p) => p.skillId));
      // With one person every skill hangs on them, and there is nobody to pair with.
      const alone =
        columns.length < 2
          ? []
          : skillCoverage(doc, columns).filter(
              (c) => c.spof && !paired.has(c.skillId) && !isExampleId(c.skillId)
            );
      const [first] = alone;
      if (first) {
        const next = nextPlannedSprint(sprints);
        const more = alone.length - 1;
        steps.push({
          id: "skills-pairing",
          label: `Plan pairing on ${first.name} into the next sprint`,
          detail: `${first.name} depends on ${first.holders[0]} alone${
            more > 0 ? `, and ${plural(more, "other skill")} on one person each` : ""
          }. A pair spreads it before it becomes a blocker.`,
          href: sprintHref("/sprint-planning", next?.id),
        });
      }
      if (pairs.length > 0) {
        steps.push({
          id: "skills-one-on-one",
          label: `Check progress on ${plural(pairs.length, "cross-training pair")} in 1:1s`,
          detail:
            "Talk each learner's progress through with them, and tick a pair off once they reach its level.",
          href: "/one-on-one",
        });
      }
      return steps;
    },
  }),

  maturity: rule({
    select: (ws) => ({ docs: ws.maturityAssessments, boards: ws.retroBoards }),
    steps: ({ docs, boards }) => {
      const stored = (docs ?? []).find((d) => d.id === MATURITY_ID);
      const doc = stored && { ...stored, history: real(stored.history) };
      const latest = latestAssessment(doc);
      if (!latest) return [];
      const steps: NextStep[] = [];
      const roadmap = roadmapFor(latest, targetOf(doc)).map((step) => ({
        step,
        cards: roadmapCards(boards, step.key).filter((c) => !isExampleId(c.id)),
      }));
      const open = roadmap.filter((r) => r.cards.length > 0 && !r.cards.some((c) => c.done));
      if (open.length > 0) {
        steps.push({
          id: "maturity-follow-up",
          label: `Follow up ${plural(open.length, "maturity step")} in Retro Actions`,
          detail: `Sent from the roadmap and not done yet, starting with “${roadmapTitle(open[0].step)}”.`,
          href: "/retro-actions",
        });
      }
      // The weakest dimension not sent to the retro yet (roadmapFor orders weakest first).
      const weakest = roadmap.find((r) => r.cards.length === 0)?.step;
      const tool = weakest && MATURITY_TOOL[weakest.dimensionId];
      if (weakest && tool) {
        // A weaker one already sent (its card perhaps done) still heads the roadmap.
        const lowest = weakest.current === roadmap[0].step.current;
        steps.push({
          id: "maturity-weakest",
          label: `Work on ${weakest.name} (level ${weakest.current})`,
          detail: `It's the weakest dimension ${lowest ? "in the latest assessment" : "not sent to the retro yet"}. ${tool.start}`,
          href: tool.href,
        });
      }
      return steps;
    },
  }),

  adkar: rule({
    select: (ws) => ({ docs: ws.adkarDocs }),
    steps: ({ docs }) => {
      const today = todayIso();
      const initiatives = real(
        normalizeAdkarDoc(
          (docs ?? []).find((d) => d.id === ADKAR_DOC_ID),
          today
        ).initiatives
      );
      const steps: NextStep[] = [];
      // The earliest barrier across the changes (then the lowest score): later elements wait on it.
      const held = initiatives
        .flatMap((i) => {
          const b = initiativeBarrier(i);
          return b ? [{ i, b }] : [];
        })
        .sort((x, y) => stageIndex(x.b.element) - stageIndex(y.b.element) || x.b.score - y.b.score);
      const [worst] = held;
      if (worst) {
        const how = ADKAR_BARRIER_STEP[worst.b.element];
        const group = worst.b.groupName.trim();
        steps.push({
          id: how.id,
          label: how.label(group || "the group", worst.i.name),
          detail: `${group || "The group"} scored ${ELEMENT_LABEL[worst.b.element]} ${worst.b.score}/5: ${how.why}`,
          href: how.href,
        });
      }
      // Stuck with no barrier to work on: the team has to find out what holds it.
      const [stuck] = stuckInitiatives(initiatives, today)
        .filter((i) => !initiativeBarrier(i))
        .sort((a, b) => daysInStage(b, today) - daysInStage(a, today));
      if (stuck) {
        steps.push({
          id: "adkar-stuck",
          label: `Talk about “${stuck.name}” at the retro`,
          detail: `It has been at ${ELEMENT_LABEL[stuck.currentStage]} for ${daysInStage(stuck, today)} days. Ask what's holding it.`,
          href: "/retro",
        });
      }
      return steps;
    },
  }),

  // Team Mixer keeps who is mixing in its own store; from the workspace it
  // sees the roster it mixes from, and the roles and skills it balances by.
  "team-mixer": rule({
    select: (ws) => ({ members: ws.teamMembers }),
    steps: ({ members }) => {
      const team = real(members);
      if (team.length === 0) {
        return [
          {
            id: "team-mixer-team",
            label: "Add your team to the Team page",
            detail:
              "Then Team Mixer can put everyone in the mix at once, with their roles and skills.",
            href: "/team",
          },
        ];
      }
      // Balancing needs two groups of two at least.
      if (team.length < 4) return [];
      const bare = team.filter((m) => !m.role?.trim() && !(m.skills ?? []).some((s) => s.trim()));
      if (bare.length === 0) return [];
      return [
        {
          id: "team-mixer-roles",
          label: "Add roles or skills on the Team page",
          detail:
            bare.length === team.length
              ? "Nobody on the team has a role or skills yet, so Team Mixer can't balance groups by them."
              : `${plural(bare.length, "person", "people")} on the team ${
                  bare.length === 1 ? "has" : "have"
                } no role or skills yet, so balanced groups place them at random.`,
          href: "/team",
        },
      ];
    },
  }),

  // Outcomes, quality & library. Risk Register and Tech Debt read
  // workspace.risks and workspace.techDebt, their one store since Phase 8.
  // Rows still waiting in a page's old blob (lib/risks/legacy-register,
  // lib/tech-debt/legacy) aren't a slice, so a rule can't read them: they
  // count once the page has opened and moved them in. Quality Cost keeps
  // its figures in a blob of its own too, so its steps read the quality
  // tools beside it.
  okrs: rule({
    select: (ws) => ({ okrs: ws.okrs, sprints: ws.sprints, goals: ws.sprintGoals }),
    steps: ({ okrs, sprints, goals }) => {
      const objectives = real(okrs);
      if (objectives.length === 0) return [];
      const steps: NextStep[] = [];
      // Sprint Goal is the only writer of the link, so the step opens it.
      const sprint = focusSprint(sprints);
      if (sprint) {
        const quarter = sprintQuarter(sprint);
        const options = objectives.filter((o) => normalizeQuarter(o.quarter) === quarter);
        const linked = new Set(
          (goals ?? []).find((g) => g.id === goalDocId(sprint.id))?.okrIds ?? []
        );
        if (options.length > 0 && !options.some((o) => linked.has(o.id))) {
          steps.push({
            id: "okrs-link-goal",
            label: `Link ${sprint.name}'s goal to an OKR`,
            detail: `${plural(options.length, "objective")} ${be(options.length)} set for ${quarter}, and ${sprint.name}'s goal ${options.length === 1 ? "doesn't link it" : "links none of them"}. Linking one shows which objective the sprint moves.`,
            href: sprintHref("/sprint-goal", sprint.id),
          });
        }
      }
      // This quarter's key results due a check-in: none for CHECK_IN_STALE_DAYS
      // (the page's flag), or none at all once the quarter is that old.
      const today = todayIso();
      const quarter = currentQuarter();
      const gone = quarterPace(quarter, today)?.elapsedDays ?? 0;
      let stale = 0;
      let never = 0;
      for (const o of objectives) {
        if (normalizeQuarter(o.quarter) !== quarter) continue;
        for (const kr of o.keyResults ?? []) {
          const days = daysSinceCheckIn(kr, today);
          if (days === null) {
            if (gone >= CHECK_IN_STALE_DAYS) never += 1;
          } else if (days >= CHECK_IN_STALE_DAYS) stale += 1;
        }
      }
      if (stale + never > 0) {
        const parts = [
          stale > 0
            ? `${plural(stale, "key result")} last checked in ${CHECK_IN_STALE_DAYS} or more days ago`
            : "",
          never > 0
            ? `${plural(never, "key result")} with no check-in ${gone} days into ${quarter}`
            : "",
        ].filter(Boolean);
        steps.push({
          id: "okrs-check-in",
          label: `Check in on ${plural(stale + never, "key result")}`,
          detail: `${listAnd(parts)}. A dated check-in with a confidence score keeps the trend going.`,
          href: "/okrs",
        });
      }
      return steps;
    },
  }),

  "nps-csat": rule({
    select: (ws) => ({ responses: ws.npsResponses }),
    steps: ({ responses }) => {
      const own = realResponses(responses ?? []);
      if (own.length === 0) return [];
      const today = todayIso();
      const steps: NextStep[] = [];
      // The theme the page points at too: the last RECENT_DAYS days only.
      const theme = hypothesisTag(own, today);
      if (theme) {
        steps.push({
          id: "nps-csat-test-fix",
          label: `Test a fix for “${theme.tag}”`,
          detail: `${plural(theme.unhappy, "unhappy answer")} in the last ${RECENT_DAYS} days ${theme.unhappy === 1 ? "mentions" : "mention"} it. Write the change as a hypothesis, with the score you expect it to move.`,
          href: "/hypothesis-tracker",
        });
      }
      if (recentResponses(own, today, SURVEY_QUIET_DAYS).length === 0) {
        // An undated answer from before Phase 8 can't say when the survey went quiet.
        const latest = own
          .map((r) => (typeof r.date === "string" ? r.date.slice(0, 10) : ""))
          .filter((day) => isIsoDate(day) && day <= today)
          .sort()
          .pop();
        if (latest) {
          steps.push({
            id: "nps-csat-add-answers",
            label: "Add the latest survey answers",
            detail: `The newest answer is from ${dayLabel(latest, true)}. Import the survey export, or add the answers, to keep the trend going.`,
            href: "/nps-csat",
          });
        }
      }
      return steps;
    },
  }),

  "hypothesis-tracker": rule({
    select: (ws) => ({ trackers: ws.hypothesisTrackers, canvases: ws.riskiestAssumptions }),
    steps: ({ trackers, canvases }) => {
      const hypotheses = hypothesesOf(trackers);
      if (hypotheses.length === 0) return [];
      const steps: NextStep[] = [];
      const [settled] = settledAssumptions(assumptionsOf(canvases), hypotheses);
      if (settled) {
        steps.push({
          id: "hypothesis-tracker-assumption",
          label: "Mark the assumption your test settled",
          detail: `${quote(clip(settled.hypothesis.believe), "An untitled hypothesis")} was ${settled.result}: mark ${quote(clip(settled.assumption.statement), "its assumption")} ${settled.result} on the Riskiest Assumption canvas too.`,
          href: "/riskiest-assumption",
        });
      }
      // Hand-off drafts arrive with the title only, and can't run without the rest.
      const drafts = hypotheses.filter(
        (h) => h.status === "drafted" && missingFields(h).length > 0
      );
      const [draft] = drafts;
      if (draft) {
        const n = drafts.length;
        const more =
          n > 1
            ? `, and ${plural(n - 1, "other draft")} ${n - 1 === 1 ? "needs" : "need"} detail too`
            : "";
        steps.push({
          id: "hypothesis-tracker-needs-detail",
          label: n === 1 ? "Finish the drafted hypothesis" : `Finish the ${n} drafted hypotheses`,
          detail: `${quote(clip(draft.believe), "An untitled hypothesis")} still needs ${missingText(missingFields(draft))} before it can run${more}. The “Needs detail” filter lists ${n === 1 ? "it" : "them all"}.`,
          href: "/hypothesis-tracker",
        });
      }
      // Running with a number to hit and nothing measured yet, the oldest first.
      const waiting = hypotheses
        .filter(
          (h) =>
            h.status === "running" &&
            typeof h.target?.value === "number" &&
            Number.isFinite(h.target.value) &&
            suggestVerdict(h) === null
        )
        .sort((a, b) => (a.raisedAt ?? "").localeCompare(b.raisedAt ?? ""));
      const [running] = waiting;
      if (running?.target) {
        const n = waiting.length;
        const bound = running.target.direction === "decrease" ? "at most" : "at least";
        steps.push({
          id: "hypothesis-tracker-result",
          label: `Record the result of ${quote(clip(running.believe), "a running test")}`,
          detail: `Its target is ${bound} ${formatMetric(running.target.value, running.target.unit)}${
            n > 1 ? `, and ${plural(n - 1, "other running test")} ${be(n - 1)} waiting too` : ""
          }. Enter the measured number to get a suggested verdict.`,
          href: "/hypothesis-tracker",
        });
      }
      return steps;
    },
  }),

  "riskiest-assumption": rule({
    select: (ws) => ({ canvases: ws.riskiestAssumptions, trackers: ws.hypothesisTrackers }),
    steps: ({ canvases, trackers }) => {
      const assumptions = assumptionsOf(canvases);
      if (assumptions.length === 0) return [];
      const hypotheses = hypothesesOf(trackers);
      const { ranked, unrated } = rankAssumptions(assumptions, hypotheses);
      const steps: NextStep[] = [];
      // The riskiest one with no hypothesis on it (a riskier one may be under test).
      const next = ranked.find((r) => linkedTest(r.assumption.sentTo, hypotheses).state === "none");
      if (next) {
        const a = next.assumption;
        steps.push({
          id: "riskiest-assumption-test",
          label: `Test ${quote(clip(a.statement), "the untitled assumption")} ${next.rank === 1 ? "first" : "next"}`,
          detail: `It scores ${next.score} (risk ${ratingOf(a.riskLevel)}, evidence ${ratingOf(a.evidenceLevel)}), ${
            next.rank === 1
              ? "the riskiest on the canvas"
              : "the riskiest with no hypothesis on it yet"
          }. “Test” on its card makes one in the Hypothesis Tracker.`,
          href: "/riskiest-assumption",
        });
      }
      const settled = settledAssumptions(assumptions, hypotheses);
      const [first] = settled;
      if (first) {
        const more = settled.length - 1;
        steps.push({
          id: "riskiest-assumption-mark",
          label: `Mark ${quote(clip(first.assumption.statement), "the untitled assumption")} ${first.result}`,
          detail: `Its hypothesis came back ${first.result}${
            more > 0 ? `, and ${plural(more, "other assumption")} ${be(more)} settled too` : ""
          }. The canvas waits for you to confirm: “Mark ${first.result}” on its card.`,
          href: "/riskiest-assumption",
        });
      }
      const [unratedFirst] = unrated;
      if (unratedFirst) {
        const n = unrated.length;
        steps.push({
          id: "riskiest-assumption-rate",
          label: `Rate ${plural(n, "assumption")} to rank ${n === 1 ? "it" : "them"}`,
          detail: `${quote(clip(unratedFirst.statement), "An untitled assumption")}${andOthers(n, "other")} ${n === 1 ? "needs" : "need"} a risk and an evidence rating before ${n === 1 ? "it is" : "they are"} ranked or placed on the matrix.`,
          href: "/riskiest-assumption",
        });
      }
      return steps;
    },
  }),

  "opportunity-tree": rule({
    select: (ws) => ({ trees: ws.opportunityTrees, trackers: ws.hypothesisTrackers }),
    steps: ({ trees, trackers }) => {
      const nodes = treeNodes(trees);
      const own = real(nodes);
      if (own.length === 0) return [];
      const hypotheses = hypothesesOf(trackers);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const experiments = own.filter((n) => n.kind === "experiment");
      const steps: NextStep[] = [];
      // Under the opportunity the team pursues, and not tested yet. One with
      // nothing to believe (no text, under no named solution) is left out:
      // its card disables "Test as a hypothesis" until it is named.
      const untested = experiments.flatMap((n) => {
        const target = targetAbove(n, byId);
        return target &&
          linkedTest(n.sentTo, hypotheses).state === "none" &&
          experimentHypothesisSource(n, nodes).title.trim().length > 0
          ? [{ n, target }]
          : [];
      });
      const [test] = untested;
      if (test) {
        const more = untested.length - 1;
        steps.push({
          id: "opportunity-tree-test",
          label: `Test ${nodeQuote(test.n)} as a hypothesis`,
          detail: `It sits under your target opportunity ${nodeQuote(test.target)} and hasn't been tested yet${
            more > 0
              ? ` (${plural(more, "other experiment")} there ${more === 1 ? "hasn't" : "haven't"} either)`
              : ""
          }. “Test as a hypothesis” on it sends it to the Hypothesis Tracker.`,
          href: "/opportunity-tree",
        });
      }
      // A result from the last month. Tested experiments stay on the tree as
      // its history, so an older one isn't news any more.
      const today = todayIso();
      const [result] = experiments
        .flatMap((n) => {
          const t = linkedTest(n.sentTo, hypotheses);
          if (t.state !== "tested") return [];
          const age = daysFrom(hypotheses.find((h) => h.id === t.hypothesisId)?.resolvedAt, today);
          return age !== null && age >= 0 && age <= RESULT_RECENT_DAYS
            ? [{ n, result: t.result, age }]
            : [];
        })
        .sort((a, b) => a.age - b.age);
      if (result) {
        steps.push({
          id: "opportunity-tree-result",
          label: `See what the test of ${nodeQuote(result.n)} found`,
          detail: `Its hypothesis came back ${result.result}: ${RESULT_NEXT[result.result]}.`,
          href: "/hypothesis-tracker",
        });
      }
      // An outcome with a choice of opportunities and no target picked.
      const under = new Map<string, TreeNode[]>();
      for (const n of own) {
        if (n.kind !== "opportunity") continue;
        const outcome = outcomeOf(n, byId);
        if (outcome) under.set(outcome.id, [...(under.get(outcome.id) ?? []), n]);
      }
      const unpicked = own.find((o) => {
        const options = under.get(o.id) ?? [];
        return o.kind === "outcome" && options.length >= 2 && !options.some((n) => n.target);
      });
      if (unpicked) {
        steps.push({
          id: "opportunity-tree-target",
          label: `Pick the opportunity to pursue for ${nodeQuote(unpicked)}`,
          detail: `${plural(under.get(unpicked.id)?.length ?? 0, "opportunity", "opportunities")} sit under it and none is the target yet. Mark the one to work on as the target: its solutions and experiments come next.`,
          href: "/opportunity-tree",
        });
      }
      return steps;
    },
  }),

  "user-interviews": rule({
    select: (ws) => ({ logs: ws.userInterviewLogs, trees: ws.opportunityTrees }),
    steps: ({ logs, trees }) => {
      const interviews = real((logs ?? []).find((l) => l.id === UI_ID)?.interviews);
      if (interviews.length === 0) return [];
      const nodes = treeNodes(trees);
      // A theme enough people raised (counted per participant), with no
      // quote of it on the tree yet (one whose opportunity was deleted can go again).
      const theme = themeCounts(interviews).find(
        (t) =>
          t.participants >= MIN_SAMPLE.average &&
          !quotesTagged(interviews, t.tag).some(({ quote: q }) => sentOpportunity(q, nodes))
      );
      if (!theme) return [];
      return [
        {
          id: "user-interviews-opportunity",
          label: `Turn the “${theme.tag}” theme into an opportunity`,
          detail: `${theme.participants} of ${plural(participantCount(interviews), "participant")} raised it. “Raise as an opportunity” on one of its quotes puts it on the Opportunity Tree.`,
          href: "/user-interviews",
        },
      ];
    },
  }),

  // workspace.risks only: see the note on this section.
  "risk-register": rule({
    select: (ws) => ({ risks: ws.risks, impediments: ws.impediments }),
    steps: ({ risks, impediments }) => {
      const active = real(risks).filter(isActiveRisk);
      if (active.length === 0) return [];
      const today = todayIso();
      const steps: NextStep[] = [];
      // Raising a risk as an impediment leaves its status alone; once the
      // impediment is resolved the row offers "Close the risk".
      const resolved = new Set((impediments ?? []).filter(isResolved).map((i) => i.id));
      const closable = active.filter((r) => {
        const link = impedimentLinkOf(r);
        return link !== undefined && resolved.has(link.targetId);
      });
      const [done] = closable;
      if (done) {
        const n = closable.length;
        steps.push({
          id: "risk-register-close",
          label:
            n === 1
              ? "Close the risk whose impediment is resolved"
              : `Close the ${n} risks whose impediments are resolved`,
          detail: `${quote(done.title, "An untitled risk")}${andOthers(n, "other")} ${n === 1 ? "was raised as an impediment that is" : "were raised as impediments that are"} resolved now, but the register still lists ${n === 1 ? "it" : "them"} as active. “Close the risk” on ${n === 1 ? "its row" : "each row"} closes ${n === 1 ? "it" : "them"} here too.`,
          href: "/risk-register",
        });
      }
      // Most days past due first.
      const overdue = active
        .map((r) => ({ r, days: riskDaysOverdue(r, today) }))
        .filter((x) => x.days > 0)
        .sort((a, b) => b.days - a.days);
      const [late] = overdue;
      if (late) {
        const more = overdue.length - 1;
        steps.push({
          id: "risk-register-overdue",
          label:
            more === 0
              ? "Raise the overdue mitigation at the retro"
              : `Raise the ${overdue.length} overdue mitigations at the retro`,
          detail: `The mitigation for ${quote(late.r.title, "an untitled risk")} is ${plural(late.days, "day")} past due${
            more > 0 ? `, and ${plural(more, "other")} ${be(more)} overdue too` : ""
          }. Ask what got in the way, then re-plan it or give it a new date.`,
          href: "/retro",
        });
      }
      // High or critical (lib/risks' one meaning of "high"), highest first.
      const unowned = active
        .filter((r) => isHighRisk(r) && !r.owner?.trim())
        .sort((a, b) => riskScore(b) - riskScore(a));
      const [top] = unowned;
      if (top) {
        const n = unowned.length;
        const rating = `${riskScore(top)} (${riskLevelOf(top)})`;
        steps.push({
          id: "risk-register-owner",
          label: n === 1 ? "Give the high risk an owner" : `Give the ${n} high risks an owner`,
          detail:
            n === 1
              ? `${quote(top.title, "An untitled risk")} scores ${rating} and has no owner: nobody is named to watch it and act on the plan.`
              : `${n} high or critical risks have no owner, starting with ${quote(top.title, "an untitled risk")} at ${rating}. Name who watches each one and acts on its plan.`,
          href: "/risk-register",
        });
      }
      return steps;
    },
  }),

  // workspace.techDebt only: see the note on this section.
  "tech-debt": rule({
    select: (ws) => ({
      items: ws.techDebt,
      stories: ws.stories,
      sprints: ws.sprints,
      cadences: ws.ceremonyCadences,
    }),
    steps: ({ items, stories, sprints, cadences }) => {
      const open = real(items).filter(isOpenDebt);
      if (open.length === 0) return [];
      const all = stories ?? [];
      const steps: NextStep[] = [];
      // Paid down on the backlog, still open here.
      const paid = open.filter((t) => debtStoryOf(t, all)?.done);
      const [first] = paid;
      if (first) {
        const n = paid.length;
        steps.push({
          id: "tech-debt-resolve",
          label:
            n === 1
              ? "Mark the paid-down debt resolved"
              : `Mark the ${n} paid-down debt items resolved`,
          detail: `${quote(first.title, "An untitled item")}${andOthers(n, "other item")} ${n === 1 ? "has a done backlog story but is" : "have done backlog stories but are"} still open here. “Mark resolved” on ${n === 1 ? "its row" : "each row"} records the day ${n === 1 ? "it was" : "each was"} paid down.`,
          href: "/tech-debt",
        });
      }
      // On the backlog with no sprint, for an item still open.
      const openIds = new Set(open.map((t) => t.id));
      const waiting = real(stories).filter(
        (s) => fromTool(s, TECH_DEBT_TOOL) && inBacklog(s) && openIds.has(s.sourceRef?.id ?? "")
      );
      const [story] = waiting;
      if (story) {
        const n = waiting.length;
        steps.push({
          id: "tech-debt-plan",
          label:
            n === 1
              ? "Plan the debt story into a sprint"
              : `Plan the ${n} debt stories into a sprint`,
          detail: `${quote(story.title, "An untitled story")}${andOthers(n, "other")} ${n === 1 ? "waits" : "wait"} on the backlog with no sprint. Debt gets paid down once it has a slot in a sprint, like any other work.`,
          href: sprintHref("/sprint-planning", nextPlannedSprint(sprints)?.id),
        });
      }
      // The page's top item (age in the team's sprints), when it isn't on the backlog yet.
      const len = normalizeCadence(
        selectCadenceDoc({ ceremonyCadences: cadences })
      ).sprintLengthDays;
      const [top] = rankedDebt(open, len, todayIso());
      if (top && debtStoryOf(top.item, all) === null) {
        const age =
          top.ageSprints === null
            ? ""
            : top.ageSprints === 0
              ? ` and is under a sprint old (${len}-day sprints)`
              : ` and is ≈ ${plural(top.ageSprints, "sprint")} old (${len}-day sprints)`;
        // The row disables "Add to backlog" while the title is blank: name it first.
        const titled = (top.item.title ?? "").trim().length > 0;
        steps.push({
          id: "tech-debt-backlog",
          label: "Put the top debt item on the backlog",
          detail: `${titled ? quote(top.item.title, "") : "The untitled item"} scores ${fmt(top.score.total)}${top.score.capped ? " (interest capped)" : ""}${age}: the highest of the open items. ${
            titled
              ? "“Add to backlog” on its row makes a story to pay it down."
              : "Give it a title on its row, then “Add to backlog” makes a story to pay it down."
          }`,
          href: "/tech-debt",
        });
      }
      return steps;
    },
  }),

  // Quality Cost's own figures are in its blob: its steps read the flaky
  // tests and the test pyramid, where quality costs show up first.
  "quality-cost": rule({
    select: (ws) => ({ boards: ws.flakyTestBoards, pyramids: ws.testPyramids }),
    steps: ({ boards, pyramids }) => {
      const steps: NextStep[] = [];
      const open = openFlaky(flakyTestsOf(boards));
      if (open.length > 0) {
        // The rate is the counted tests' only (as flakyVerdict words it):
        // legacy rows with a rate and no run counts are left out of it.
        const n = open.length;
        const { rate, counted, rateOnly } = weightedFailureRate(open);
        const failing =
          rate === null
            ? ""
            : rateOnly === 0
              ? `, failing ${ratePercent(rate)} of ${n === 1 ? "its" : "their"} runs`
              : `; the ${counted} with run counts ${counted === 1 ? "fails" : "fail"} ${ratePercent(rate)} of ${counted === 1 ? "its" : "their"} runs`;
        steps.push({
          id: "quality-cost-flaky",
          label: "Count flaky reruns as internal failure cost",
          detail: `${plural(n, "flaky test")} ${be(n)} open${failing}. ${n === 1 ? "Its" : "Their"} reruns and triage time are internal failure cost: estimate the hours from the runs on the flaky board, then log them here under Internal failure with “Hours × rate”.`,
          href: "/flaky-tests",
        });
      }
      const { shape, weighting } = pyramidShape(pyramids);
      if (TOP_HEAVY.has(shape)) {
        steps.push({
          id: "quality-cost-pyramid",
          label: "Check the test pyramid's shape",
          detail: `The suite is ${topHeavyName(shape, weighting)}: slow end-to-end checks are detection cost that unit tests cover for less.`,
          href: "/test-pyramid",
        });
      }
      return steps;
    },
  }),

  "test-pyramid": rule({
    select: (ws) => ({ pyramids: ws.testPyramids, boards: ws.flakyTestBoards }),
    steps: ({ pyramids, boards }) => {
      const { shape, shares, weighting } = pyramidShape(pyramids);
      if (!TOP_HEAVY.has(shape)) return [];
      const open = openFlaky(flakyTestsOf(boards)).length;
      if (open > 0) {
        return [
          {
            id: "test-pyramid-flaky",
            label: "Triage the flaky tests in a top-heavy suite",
            detail: `The suite is ${topHeavyName(shape, weighting)} and ${plural(open, "flaky test")} ${be(open)} open. End-to-end tests are the slowest and flakiest layer: look there first.`,
            href: "/flaky-tests",
          },
        ];
      }
      return [
        {
          id: "test-pyramid-retro",
          label: "Raise the suite's shape at the retro",
          detail: `${shapeVerdict(shape, shares, weighting)} Agree which end-to-end checks could move down to unit or integration tests.`,
          href: "/retro",
        },
      ];
    },
  }),

  "flaky-tests": rule({
    select: (ws) => ({
      boards: ws.flakyTestBoards,
      pyramids: ws.testPyramids,
      sprints: ws.sprints,
    }),
    steps: ({ boards, pyramids, sprints }) => {
      const open = openFlaky(flakyTestsOf(boards));
      if (open.length === 0) return [];
      const steps: NextStep[] = [];
      const long = longQuarantined(open, todayIso());
      const [longest] = long;
      if (longest) {
        const n = long.length;
        steps.push({
          id: "flaky-tests-quarantine",
          label: `Plan fixes for the ${n === 1 ? "test" : `${n} tests`} quarantined ${QUARANTINE_ALERT_DAYS}+ days`,
          detail: `“${clip(longest.name)}” has been in quarantine ${plural(longest.days, "day")}${
            n > 1 ? `, the longest of the ${n}` : ""
          }. A quarantined test still hides a bug: give its fix a slot in the next sprint.`,
          href: sprintHref("/sprint-planning", nextPlannedSprint(sprints)?.id),
        });
      }
      if (open.length >= FLAKY_SHAPE_MIN && pyramidShape(pyramids).shape === "empty") {
        steps.push({
          id: "flaky-tests-pyramid",
          label: "Check the test pyramid behind the flaky tests",
          detail: `${plural(open.length, "flaky test")} ${be(open.length)} open. A suite heavy on end-to-end tests flakes more: count each layer's tests to see its shape.`,
          href: "/test-pyramid",
        });
      }
      return steps;
    },
  }),

  "code-review-metrics": rule({
    select: (ws) => ({ logs: ws.codeReviewLogs, cadences: ws.ceremonyCadences }),
    steps: ({ logs, cadences }) => {
      const log = (logs ?? []).find((l) => l.id === CODE_REVIEW_LOG_ID);
      const samples = real(log?.samples);
      if (samples.length === 0) return [];
      // The page's reading: the team's working days, and its working window if set.
      const calendar = cadenceCalendar(
        normalizeCadence(selectCadenceDoc({ ceremonyCadences: cadences }))
      );
      const win = windowMinutes(log?.workingWindow);
      const summary = reviewSummary(samples, calendar, win);
      const steps: NextStep[] = [];
      // Over a working day to a first review: the window's hours, or 24 when whole days count.
      const wait = summary.headline.medianFirstReviewWorkingH;
      const day = win ? (win.endMinute - win.startMinute) / 60 : 24;
      if (wait !== null && wait > day) {
        steps.push({
          id: "code-review-turnaround",
          label: "Agree a review turnaround",
          detail: `Half of pull requests wait ${formatReviewHours(wait)} working hours or more for a first review (${workingBasisLabel(calendar, log?.workingWindow)}), over a working day. Agree in the working agreement how soon a review starts.`,
          href: "/working-agreement",
        });
      }
      const large = summary.bySize.find((b) => b.band === "large");
      const counted = summary.total - summary.invalid;
      const share = large && counted > 0 ? large.n / counted : 0;
      if (
        summary.largeNoComments > 0 ||
        (counted >= MIN_SAMPLE.distribution && share >= LARGE_PR_SHARE)
      ) {
        const over = `over ${SIZE_BANDS.find((b) => b.id === "medium")?.maxLines} lines`;
        const small = summary.bySize.find((b) => b.band === "small")?.medianCycleWorkingH ?? null;
        const slow = large?.medianCycleWorkingH ?? null;
        const ratio = small !== null && slow !== null && small > 0 ? slow / small : null;
        const fact =
          summary.largeNoComments > 0
            ? `${plural(summary.largeNoComments, "large pull request")} (${over}) merged with no review comment`
            : `${Math.round(share * 100)}% of pull requests are ${over}`;
        steps.push({
          id: "code-review-pr-size",
          label: "Talk about PR size at the retro",
          detail: `${fact}${
            ratio !== null && ratio >= LARGE_PR_SLOWER
              ? `, and large ones take ${formatReviewHours(ratio)}× longer to merge than small ones`
              : ""
          }. Agree how to keep changes small enough to review well.`,
          href: "/retro",
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
