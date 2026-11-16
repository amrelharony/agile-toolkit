/**
 * lib/flow: how work flows across the Sprint board (stories) and the Flow
 * board (cards), shared by Cumulative Flow, Cycle Time, Value Stream, the
 * Health Dashboard, the DORA Scorecard, the Kanban page and their agent
 * actions. Pure (no store, no hooks), so a page and its tool.* action read
 * the same numbers from the same workspace rows.
 *
 *   - ./items: stories and cards as FlowItems, the two workflows, stageOn, doneOn.
 *   - ./counts: items per stage per day (the CFD), WIP and done.
 *   - ./cycle: cycle days (same day = 1), finished items, summary stats, ageing WIP.
 *   - ./throughput: per day and per ISO week, Little's Law, recent moves, lead time.
 *   - ./stages: time in each stage over a finished item's cycle, and flow efficiency.
 */

export type { FlowItem, FlowMove, FlowSource, FlowStage, FlowWorkflow, StageKind } from "./types";
export {
  BOARD_WORKFLOW,
  SPRINT_WORKFLOW,
  cardItems,
  doneOn,
  stageKind,
  stageOf,
  stageOn,
  storyItems,
  workflowOf,
  type StoryItemsOptions,
} from "./items";
export { dailyCounts, doneOf, wipOf, type DailyCounts, type FlowDay } from "./counts";
export {
  ageingWip,
  cycleDays,
  cycleSummary,
  finishedItems,
  type AgeingItem,
  type CycleSummary,
  type FinishedItem,
} from "./cycle";
export {
  isoWeek,
  leadTimeHours,
  littlesLaw,
  recentMoves,
  throughputByDay,
  throughputByWeek,
  throughputLastWeek,
  weekOf,
  type LittlesLaw,
  type ThroughputPoint,
} from "./throughput";
export { MAX_RANGE_DAYS, addDays, dayRange } from "./days";
export {
  DEFAULT_WAITING,
  STAGE_LABEL,
  STAGE_ORDER,
  cleanStageIds,
  isStageId,
  itemEfficiency,
  itemStageTimes,
  stageBreakdown,
  stageDuration,
  stageSentence,
  type EfficiencyReason,
  type FlowEfficiency,
  type ItemStageTimes,
  type StageBreakdown,
  type StageBreakdownOptions,
  type StageId,
  type StageStat,
  type StageTime,
} from "./stages";
