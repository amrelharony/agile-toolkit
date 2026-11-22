import type { RetroFormat } from "@/lib/constants/retro-formats";
import type { CeremonyCadence } from "@/lib/sprints/cadence";

export type ISODateString = string;

export interface TeamMember {
  id: string;
  name: string;
  role?: string;
  capacityPct?: number;
  skills?: string[];
}

export interface Sprint {
  id: string;
  name: string;
  startDate: ISODateString;
  endDate: ISODateString;
  goal?: string;
  pointsPlanned: number;
  pointsCompleted?: number;
  status: "planned" | "active" | "completed" | "cancelled";
  /**
   * Capacity kept free for unplanned work (Interrupt Buffer): a share of the
   * sprint's planned points (`pct`, 0–100; the forms take 1–90), points
   * (`points`, 0 or more, which win when both are set), or both.
   * Absent: no buffer set.
   */
  interruptBuffer?: SprintInterruptBuffer;
}

/** A sprint's buffer for unplanned work (see `Sprint.interruptBuffer`). */
export interface SprintInterruptBuffer {
  pct?: number;
  points?: number;
}

/**
 * One day of a sprint's log. Day 0 is `Sprint.startDate`, counted in calendar
 * days (as Burndown always has). Burndown records `remaining` and
 * `scopeChange`; Burnup records `completed` and `scope`. Each tool shows what
 * was typed and derives the other number when it's missing
 * (`src/lib/sprints/series.ts`).
 */
export interface SprintDay {
  day: number;
  remaining?: number | null;
  completed?: number | null;
  /** Total scope that day. Missing: the previous day's, else `Sprint.pointsPlanned`. */
  scope?: number | null;
  /** Burndown's "scope changed this day" flag. */
  scopeChange?: boolean;
  note?: string;
}

/**
 * Per-sprint metrics shared by the sprint tools (Burndown, Burnup, Sprint
 * Comparison) and the Sprint Metrics hub. One row per sprint: `id` IS the
 * `Sprint.id`. Kept out of `Sprint` itself so code that rebuilds a Sprint
 * (agents, older clients) can't drop a daily log, and so sprint lists stay
 * small. A row whose sprint no longer exists is ignored.
 */
export interface SprintSeries {
  id: string;
  days?: SprintDay[];
  /** Sprint Comparison scores (1-10), keyed by dimension label. */
  ratings?: Record<string, number>;
  /** The old per-tool storage keys this row was built from (migration audit). */
  migratedFrom?: string[];
  updatedAt?: ISODateString;
}

/** The one ceremony-cadence document's id (see `CeremonyCadenceDoc`). */
export const CEREMONY_CADENCE_ID = "ceremony-cadence:current";

/** The story map's one document id (Story Mapper, its agent actions, Canvas's live story map). */
export const STORY_MAP_ID = "story-mapper:current";

/** The Kanban Flow board's one document id (the page, its agent actions, hand-offs, next steps). */
export const KANBAN_BOARD_ID = "kanban:current";

/**
 * The team's ceremony cadence as a workspace document: when the Daily Scrum,
 * Planning, Refinement, Review and Retro happen relative to a sprint's dates
 * (the fields of `CeremonyCadence` in `@/lib/sprints/cadence`). One document
 * under `CEREMONY_CADENCE_ID`, so agents read and set the same cadence the
 * Sprint Cockpit and the team charter show. Readers normalise it
 * (`normalizeCadence`), so an older or hand-edited row still yields a usable
 * cadence.
 */
export interface CeremonyCadenceDoc extends CeremonyCadence {
  id: string;
}

export type StoryStatus = "backlog" | "todo" | "in_progress" | "review" | "done";

/** One change of a story's status, as `setStoryStatus` records it. */
export interface StoryStatusChange {
  status: StoryStatus;
  /** The status it left (absent for a story created in `status`). */
  from?: StoryStatus;
  at: ISODateString;
}

/**
 * One move of a story into or out of a sprint, as the workspace store
 * records it whenever a story's sprint changes (lib/sprints/story-status.ts
 * stampStoryMembership), so burnup, scope churn and carry-over can tell when
 * a story joined or left a sprint.
 */
export interface StorySprintChange {
  /** The sprint it joined; absent when it went back to the backlog. */
  sprintId?: string;
  /** The sprint it left; absent when it came from the backlog (or was created in `sprintId`). */
  from?: string;
  at: ISODateString;
  /** Its points at the move, so added or removed scope weighs what it had then. */
  points?: number;
  /** Moved because `from` was closed (the close dialog's carry-over). */
  carriedOver?: boolean;
}

export interface Story {
  id: string;
  title: string;
  points?: number;
  status: StoryStatus;
  sprintId?: string;
  tags?: string[];
  priorityScore?: number;
  owner?: string;
  /*
   * Flow stamps, written by `setStoryStatus` (lib/sprints/store.ts) and by
   * agents' status changes, so cycle time and flow charts can read the
   * board. All optional: stories from before them have none.
   */
  /** When work started: the move into in progress, review or done (cleared
   *  when it goes back to the backlog or to do). */
  startedAt?: ISODateString;
  /** When it was moved to done (cleared when it leaves done). */
  doneAt?: ISODateString;
  /** Flagged as blocked (cleared when it is done). */
  blocked?: boolean;
  /** Status changes, oldest first; only the latest
   *  `STORY_STATUS_HISTORY_CAP` (lib/sprints/story-status.ts) are kept. */
  statusHistory?: StoryStatusChange[];
  /** When the story was first saved (stamped by the store; absent on older stories). */
  createdAt?: ISODateString;
  /** Sprint moves, oldest first; only the latest
   *  `STORY_SPRINT_HISTORY_CAP` (lib/sprints/story-status.ts) are kept. */
  sprintHistory?: StorySprintChange[];
  /** The item this was sent from (review feedback, a tech-debt item). */
  sourceRef?: HandoffRef;
  /** Definition-of-Ready checks from a refinement session. */
  readiness?: StoryReadiness;
  /** The roadmap epic this story belongs to (Epic Roadmap rolls progress up from it). */
  epicId?: string;
  /** Definition-of-Done checks ticked on the Sprint board card (absent: none ticked). */
  dodChecks?: StoryDodChecks;
  /**
   * The decided backlog order it was pulled in with: its `BacklogItem.rank`
   * when Sprint Planning imported it (1-based; absent: not ordered). The
   * shared backlog comparator sorts by it ascending, then `priorityScore`
   * descending.
   */
  backlogRank?: number;
  /*
   * What the story is about, beyond its title. All four are optional, and
   * cleaned and capped on every write (lib/stories/fields.ts). They stay out
   * of share links, which are capped at 32 KB, except the acceptance
   * criteria (and `gwt`) in Backlog Health's and Refinement's Markdown, kept
   * short there.
   */
  /** Free notes: context, a description that came with it (at most 2,000 characters). */
  notes?: string;
  /** How the team will know it is done right (at most 2,000 characters). */
  acceptanceCriteria?: string;
  /**
   * Structured acceptance criteria, Given/When/Then, in order (Backlog
   * Health). They sit beside the free-text `acceptanceCriteria`, which stays
   * as it is: neither is derived from the other. At most TOOL_LIST_MAX.gwt
   * rows, each part at most TOOL_TEXT_MAX.text.
   */
  gwt?: StoryGwt[];
  /**
   * When the story was last refined: its title, points, notes or acceptance
   * criteria (free text or Given/When/Then) changed. Stamped on write
   * (lib/sprints/story-status `stampRefinedWrite`); Backlog Health's stale
   * check reads it.
   */
  refinedAt?: ISODateString;
  /** Its issue in the team's tracker: an http or https address (at most 500 characters). */
  link?: string;
  /** Its key in the team's tracker, such as "PAY-12" (at most 50 characters). */
  ticketKey?: string;
  /*
   * Flow Insights' fields (the tools plan's phase 2; see `BlockSpell` and
   * `WORK_TYPES` in the Phase 43 block below). All optional: stories from
   * before them have none.
   */
  /** What kind of work it is: a feature, a defect, debt or risk. */
  workType?: WorkType;
  /** Whether it adds value or is repeat work caused by an earlier failure. */
  demand?: WorkDemand;
  /** Its blocked spells, oldest first, stamped by lib/flow/block-stamps; at
   *  most TOOL_LIST_MAX.blockLog are kept. */
  blockLog?: BlockSpell[];
}

/** One Given/When/Then acceptance criterion on a story (see `Story.gwt`). */
export interface StoryGwt {
  id: string;
  given: string;
  when: string;
  then: string;
}

/**
 * Where a story stands against the team's Definition of Ready, as last
 * checked in Refinement. `checked` holds the ids of the DoR criteria that
 * passed; `ready` is the team's call (usually: every criterion checked).
 */
export interface StoryReadiness {
  checked: string[];
  ready: boolean;
  updatedAt: ISODateString;
}

/**
 * Which Definition-of-Done criteria a story meets, ticked on its Sprint
 * board card. Whether it meets the DoD is derived, never stored: against
 * the team's required criteria as they are today (`DefinitionOfDone`), so
 * an id no longer in the DoD is ignored and a new criterion starts unticked.
 */
export interface StoryDodChecks {
  /** Ids of the DoD criteria met. */
  checked: string[];
  updatedAt: ISODateString;
}

export type ImpedimentSeverity = "low" | "medium" | "high" | "critical";

export type ImpedimentCategory = "technical" | "organizational" | "external" | "process";

/**
 * Something in the team's way. The Impediments tool, hand-offs and agents
 * all write here (the tool's own local store was moved in; see
 * lib/impediments). Its status is derived, never stored: resolved when
 * `resolvedAt` is set, escalated when `escalatedAt` is, open otherwise
 * (lib/impediments/model.ts).
 */
export interface Impediment {
  id: string;
  title: string;
  severity: ImpedimentSeverity;
  /** When it was raised, "YYYY-MM-DD" (can be backdated). */
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
  /** Who is working on removing it. */
  owner?: string;
  source?: "standup" | "retro" | "manual";
  /** The item this was sent from (a retro card, a standup blocker). */
  sourceRef?: HandoffRef;
  description?: string;
  category?: ImpedimentCategory;
  /** Who raised it. */
  raisedBy?: string;
  /** When it was escalated beyond the team (cleared on reopen). */
  escalatedAt?: ISODateString;
  /** "YYYY-MM-DD" it should be gone by. Without one, `raisedAt` plus
   *  `expectedResolutionDays` is the due date, when that is set. */
  dueDate?: ISODateString;
  /** Expected days to resolve, from when it was raised. */
  expectedResolutionDays?: number;
  /** The blocker cluster it belongs to, such as "Waiting for a review" (at
   *  most BLOCKER_CLUSTER_MAX characters). */
  cluster?: string;
  /** Whether the blocker sits inside the team or outside it. */
  blockSide?: BlockSide;
}

/* ── Hand-offs ─────────────────────────────────────────────────────────
 * One tool can send an item to another: a retro action becomes an
 * impediment or a Kanban card, a premortem cause becomes a risk, a story-
 * map card goes to the Planning Poker queue, review feedback becomes a
 * backlog story, a red health check a retro topic. The target records where it
 * came from (sourceRef), the source records where it went (sentTo), so
 * both sides can link to each other and a second send is avoided. All
 * optional and additive; see lib/handoffs. */

/** Where an item came from when another tool sent it here. */
export interface HandoffRef {
  /** Source tool id, e.g. "retro". */
  tool: string;
  /** Source item id (a card, a cause, a standup entry). */
  id: string;
  /** Source document when the item lives inside one, e.g. "retro:current". */
  doc?: string;
}

/** Every hand-off route (lib/handoffs/registry.ts has one per id). */
export const HANDOFF_ROUTE_IDS = [
  "impediment",
  "kanban",
  "risk",
  "poker-queue",
  "backlog-story",
  "retro-topic",
  "retro-action",
  "hypothesis",
  "decision",
  "dependency",
  // Phase 8: an interview quote raised as an opportunity on the tree.
  "opportunity",
  // Phase 42: an item opened as a root-cause analysis (Root Cause).
  "root-cause",
] as const;

export type HandoffRouteId = (typeof HANDOFF_ROUTE_IDS)[number];

/** Where an item was sent. */
export interface HandoffLink {
  route: HandoffRouteId;
  targetId: string;
  at: ISODateString;
}

/** A 1–5 rating (a risk's probability or impact, before or after mitigation). */
export type RiskScale = 1 | 2 | 3 | 4 | 5;

export interface Risk {
  id: string;
  title: string;
  /**
   * 1–5 each. Every write since Phase 8 is checked, but a row saved before
   * (or the old page blob) may hold another number, kept until a write sets
   * it: readers clamp it to the scale.
   */
  probability: RiskScale;
  impact: RiskScale;
  mitigation?: string;
  /** Target date by which mitigation should complete (ISO yyyy-mm-dd). */
  mitigationDueAt?: ISODateString;
  status: "open" | "mitigating" | "closed" | "accepted";
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  /** The item this was sent from (e.g. a premortem cause). */
  sourceRef?: HandoffRef;
  /** Who owns it: the roster's spelling when they're on the team. Absent: nobody yet. */
  owner?: string;
  /** More about it (a premortem cause's description). */
  description?: string;
  /**
   * The rating once the mitigation has worked, 1–5 each. Both or neither
   * (the CRUD schema refuses one alone); absent: not assessed.
   */
  residualProbability?: RiskScale;
  residualImpact?: RiskScale;
  /** Where it was sent: an impediment, once the risk happened. */
  sentTo?: HandoffLink[];
  /**
   * ISO timestamp of the last save, stamped by every writer from Phase 8 on
   * (the page, the hand-off, the tool verbs, the workspace.risk CRUD).
   * Absent: saved before the Risk Register moved into the workspace, so the
   * old page blob's copy of the row may be newer (lib/risks' move reads it).
   */
  updatedAt?: string;
}

/**
 * Which way a number should move to count as progress: up ("increase", a
 * sign-up count) or down ("decrease", churn, defects). One union for a key
 * result's direction and a hypothesis target's.
 */
export type MetricDirection = "increase" | "decrease";

/** Which way a key result's number should move; absent on a row means "increase". */
export type KeyResultDirection = MetricDirection;

/** Check-ins kept per key result (a year of weekly ones); the oldest go first. */
export const KR_CHECK_IN_CAP = 52;

/** One dated check-in on a key result (OKR Tracker). Can be backdated, never after the day it is entered. */
export interface KeyResultCheckIn {
  id: string;
  /** YYYY-MM-DD, the local day the value was read. */
  date: ISODateString;
  /** The key result's value that day. */
  value: number;
  /** 0–10: how sure the owner is of reaching the target. Absent = not scored. */
  confidence?: number;
  note?: string;
}

export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  target: number;
  /** The latest value: the newest-dated check-in's, else as typed or set by an agent. */
  current: number;
  unit?: string;
  /**
   * The latest scored confidence, 0–10 (≤ 3 off track, 4–6 at risk, ≥ 7 on
   * track). Absent = not scored. Checked on every write since Phase 8; one
   * an agent saved before may be off the scale, kept until a write sets it.
   */
  confidence?: number;
  /**
   * The value at the start of the quarter; progress runs baseline → target.
   * Absent on rows from before Phase 8, which read it as 0 so their
   * progress doesn't change. New key results are saved with one.
   */
  baseline?: number;
  /** "decrease" for a key result that should fall (target below baseline). Absent: "increase". */
  direction?: KeyResultDirection;
  /** Dated check-ins, oldest first, at most KR_CHECK_IN_CAP. Absent: none yet. */
  checkIns?: KeyResultCheckIn[];
}

export interface Okr {
  id: string;
  objective: string;
  description?: string;
  keyResults: KeyResult[];
  quarter: string;
  owner?: string;
}

/* ── Decision records ──
 * One entity for the Decision Log, DACI and RAPID (Phase 7): `template` says
 * which form a record was raised with, and the ADR lifecycle is the status
 * for all three. DACIDecision and RAPIDDecision rows from before the merge
 * stay as legacy types; lib/decisions reads them through as Decisions. */

/** Which form a decision record uses; absent on a record means "adr". */
export type DecisionTemplate = "adr" | "daci" | "rapid";

export const DECISION_TEMPLATES = [
  "adr",
  "daci",
  "rapid",
] as const satisfies readonly DecisionTemplate[];

/** The ADR lifecycle every template shares. DACI/RAPID's "implemented" and
 *  "revisit" are dates on the record (`implementedAt`, `reopenedAt`). */
export type DecisionStatus = "proposed" | "accepted" | "deprecated" | "superseded";

export const DECISION_STATUSES = [
  "proposed",
  "accepted",
  "deprecated",
  "superseded",
] as const satisfies readonly DecisionStatus[];

/** Named roles besides the one decider (DACI Approver / RAPID Decide / an ADR's decider). */
export type DecisionRole =
  /** DACI, one person. */
  | "driver"
  /** DACI. */
  | "contributor"
  /** DACI. */
  | "informed"
  /** RAPID, one person. */
  | "recommend"
  /** RAPID (a veto). */
  | "agree"
  /** RAPID. */
  | "perform"
  /** RAPID. */
  | "input";

export const DECISION_ROLES = [
  "driver",
  "contributor",
  "informed",
  "recommend",
  "agree",
  "perform",
  "input",
] as const satisfies readonly DecisionRole[];

/** One option a decision weighed. */
export interface DecisionOption {
  id: string;
  text: string;
  /** Why it was rejected, or its trade-offs. */
  note?: string;
}

export interface Decision {
  id: string;
  title: string;
  context?: string;
  /** The outcome ("We will …"); "" until decided. Labelled "Outcome" in the UI. */
  decision: string;
  consequences?: string;
  /** Pre-template ADRs: one option per line. Read as `options` (lib/decisions);
   *  new writes use `options`. */
  alternatives?: string[];
  status: DecisionStatus;
  /** "YYYY-MM-DD" the record was raised (can be backdated). */
  date: ISODateString;
  /** The item this was sent from (a six-hats summary, a weighted decision). */
  sourceRef?: HandoffRef;
  /** The form it was raised with; absent: "adr" (every record from before templates). */
  template?: DecisionTemplate;
  /** One numbering sequence for the whole log, across templates (ADR-0003,
   *  DACI-0004): assigned once, never changed, and never held by two records
   *  (only a deleted top record's number is given again). Absent: not
   *  numbered yet. */
  number?: number;
  /** The options weighed. Absent on a pre-template ADR, whose `alternatives` are read instead. */
  options?: DecisionOption[];
  /** The option the outcome picked (a `DecisionOption.id`). */
  chosenOptionId?: string;
  /** The DACI Driver's or RAPID Recommender's proposal. */
  recommendation?: string;
  /** Roster spelling: the one person with the final say (DACI Approver, RAPID Decide). */
  decider?: string;
  /** Roster spellings per role; "driver" and "recommend" hold at most one. */
  roles?: Partial<Record<DecisionRole, string[]>>;
  /** "YYYY-MM-DD" it was accepted on (can be backdated). */
  decidedAt?: ISODateString;
  /** "YYYY-MM-DD" it was carried out (DACI/RAPID "implemented"). */
  implementedAt?: ISODateString;
  /** "YYYY-MM-DD" an accepted decision went back to proposed (DACI "revisit"). */
  reopenedAt?: ISODateString;
  /** Id of the decision that replaced this one (status "superseded"). */
  supersededBy?: string;
}

export interface TechDebtItem {
  id: string;
  title: string;
  description?: string;
  area?: string;
  /**
   * 1–5 each. Every write since Phase 8 is checked, but a row saved before
   * may hold another number (a 2.5 the page's import copied), kept until a
   * write sets it: readers clamp it to the scale.
   */
  impact: 1 | 2 | 3 | 4 | 5;
  effort: 1 | 2 | 3 | 4 | 5;
  /** Score points gained per sprint left unpaid: 0–100 on every write since Phase 8. */
  interestRate?: number;
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
  /** Where it was sent: a backlog story to pay it down. */
  sentTo?: HandoffLink[];
  /** ISO timestamp of the last save; as `Risk.updatedAt` (absent: saved before the move into the workspace). */
  updatedAt?: string;
}

export type MaturityLevel = 1 | 2 | 3 | 4 | 5;

/* ────────────────────────────────────────────────────────────────────
 * Phase 19 — AI / LLM Product Management entities
 * ────────────────────────────────────────────────────────────────── */

export interface LLMEval {
  id: string;
  promptVersion?: string;
  model: string;
  dataset: string;
  /** 0..1 metric (accuracy / faithfulness / etc.) */
  score: number;
  /** Optional secondary metric breakdown */
  metricBreakdown?: Record<string, number>;
  recordedAt: ISODateString;
  notes?: string;
}

export interface PromptVersion {
  id: string;
  name: string;
  version: string; // semantic-ish e.g. "1.4.0"
  body: string;
  status: "draft" | "review" | "production" | "deprecated";
  evalScore?: number;
  publishedAt?: ISODateString;
  author?: string;
  changeNote?: string;
}

export interface Hallucination {
  id: string;
  feature?: string;
  input: string;
  expected?: string;
  actual: string;
  severity: "low" | "medium" | "high" | "critical";
  rootCause?: "rag-miss" | "prompt" | "model" | "context-window" | "other";
  fixApplied?: string;
  loggedAt: ISODateString;
  resolvedAt?: ISODateString;
}

export interface TokenSpend {
  id: string;
  feature: string;
  model: string;
  date: ISODateString;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ModelEntry {
  id: string;
  name: string;
  vendor: string;
  /** USD per 1k input tokens */
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  contextWindow?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  evalScore?: number;
  status: "production" | "evaluation" | "experimental" | "deprecated";
  notes?: string;
  /** Monotonic optimistic-concurrency token for last-write-wins. Edited by
   *  both the user (UI) and background agents (tool.model_registry.* over
   *  MCP); `upsertModel` and the server-side write verbs bump it on every
   *  accepted write and reject writes built from an older base, so a stale
   *  whole-row write can't silently clobber a concurrent change. Optional
   *  for back-compat: legacy rows without a version are treated as 0. */
  version?: number;
}

export interface RedTeamFinding {
  id: string;
  attackVector: string;
  promptUsed?: string;
  successful: boolean;
  severity: "low" | "medium" | "high" | "critical";
  mitigation?: string;
  loggedAt: ISODateString;
  retestDueAt?: ISODateString;
  resolvedAt?: ISODateString;
}

export interface AgentNode {
  id: string;
  workflowId: string;
  label: string;
  kind: "agent" | "tool" | "human" | "fallback" | "branch";
  description?: string;
  /** ID of the next node(s); for simplicity we keep linear with optional branch */
  next?: string[];
}

export interface AgentWorkflow {
  id: string;
  name: string;
  description?: string;
  /** Nodes are stored separately and joined by workflowId */
}

export interface HitlReview {
  id: string;
  feature?: string;
  reviewer?: string;
  /** 1..5 quality rating */
  rating: 1 | 2 | 3 | 4 | 5;
  agreedWithModel: boolean;
  reason?: string;
  loggedAt: ISODateString;
}

export interface RlhfPair {
  id: string;
  prompt: string;
  responseA: string;
  responseB: string;
  winner: "A" | "B" | "tie";
  reviewer?: string;
  reason?: string;
  loggedAt: ISODateString;
}

export interface VectorCollection {
  id: string;
  name: string;
  embeddingModel: string;
  dim: number;
  docCount: number;
  refreshCadence?: string; // free-text e.g. "daily"
  owner?: string;
  consumers?: string[];
  notes?: string;
}

export interface ModelCard {
  id: string;
  modelName: string;
  intendedUse?: string;
  trainingData?: string;
  evaluation?: string;
  limitations?: string;
  license?: string;
  updatedAt: ISODateString;
}

/* S12b singleton-doc entities (ai-feature-spec, ai-safety-checklist,
 * model-migration). Each tool keeps exactly ONE document per workspace,
 * stored as a single-element collection under a fixed id (see the
 * SINGLETON_ID constants in the matching tool action files). */

export interface AiFeatureSpec {
  id: string;
  featureName: string;
  problem: string;
  modelChoice: string;
  evalCriteria: string;
  fallback: string;
  latencyBudgetMs: string;
  hallucinationTolerance: string;
  costBudget: string;
  humanLoop: string;
  rolloutPlan: string;
  successMetric: string;
}

export interface AiSafetyChecklist {
  id: string;
  /** Map of checklist-item id → checked. Item definitions live in the
   *  client (a fixed catalog); only the checked state is persisted. */
  checks: Record<string, boolean>;
}

export interface ModelMigrationStep {
  id: string;
  text: string;
  done: boolean;
}

export interface ModelMigration {
  id: string;
  fromModel: string;
  toModel: string;
  /** Free-text deltas (carry a sign, e.g. "+2.1" / "-18"). */
  evalDeltaPct: string;
  costDeltaPct: string;
  steps: ModelMigrationStep[];
}

/* ────────────────────────────────────────────────────────────────────
 * S9 — Security & Compliance entities. Each tool is a singleton doc (one
 * document per workspace under a fixed id, like kanban), holding the tool's
 * collection(s). The nested item types are shared with the clients.
 * ────────────────────────────────────────────────────────────────── */

export type ThreatStride =
  | "spoofing"
  | "tampering"
  | "repudiation"
  | "information_disclosure"
  | "denial_of_service"
  | "elevation_of_privilege";
export type ThreatStatus = "open" | "mitigating" | "mitigated" | "accepted";

export interface Threat {
  id: string;
  service: string;
  category: ThreatStride;
  /** 1 (low) … 5 (critical). */
  severity: number;
  status: ThreatStatus;
  mitigation?: string;
  raisedAt: ISODateString;
  mitigatedAt?: string;
  description?: string;
}

export interface ThreatModel {
  id: string;
  threats: Threat[];
}

export type VulnSeverity = "critical" | "high" | "medium" | "low";
export type VulnStatus = "open" | "in_progress" | "resolved" | "accepted";

export interface Vulnerability {
  id: string;
  cve?: string;
  severity: VulnSeverity;
  status: VulnStatus;
  openedAt: ISODateString;
  resolvedAt?: string;
  slaTargetDays: number;
  owner?: string;
  description?: string;
}

export interface VulnBurndown {
  id: string;
  vulns: Vulnerability[];
}

export type ControlFramework = "soc2" | "iso27001" | "hipaa" | "gdpr" | "custom";
export type ControlStatus = "not_started" | "in_progress" | "implemented" | "verified";

export interface ComplianceControl {
  id: string;
  controlId: string;
  framework: ControlFramework;
  title: string;
  owner?: string;
  status: ControlStatus;
  evidenceLinks: string[];
  description?: string;
}

export interface ControlMap {
  id: string;
  controls: ComplianceControl[];
}

export type A11ySeverity = "critical" | "serious" | "moderate" | "minor";
export type A11yStatus = "open" | "in_progress" | "resolved";

export interface A11yIssue {
  id: string;
  component: string;
  wcagCriterion: string;
  severity: A11ySeverity;
  status: A11yStatus;
  openedAt: ISODateString;
  resolvedAt?: string;
  description?: string;
}

export interface A11yTracker {
  id: string;
  issues: A11yIssue[];
}

/* ────────────────────────────────────────────────────────────────────
 * S10 — Quality Engineering entities (singleton-doc per tool, like kanban).
 * ────────────────────────────────────────────────────────────────── */

/**
 * Minutes of CI wall-clock each layer's suite takes (Test Pyramid's "by
 * runtime" option). A layer left out hasn't been timed.
 */
export interface TestLayerRuntime {
  unit?: number;
  integration?: number;
  e2e?: number;
}

/** What the pyramid's shares are worked out from; absent on a document means "count". */
export type TestPyramidWeighting = "count" | "runtime";

/** The layer counts on one day, kept so the pyramid's shape can be followed over time. */
export interface TestPyramidSnapshot {
  /** `tps_<nanoid8>`, or `example-…` in the example. */
  id: string;
  /** Local YYYY-MM-DD the counts are for (backdatable, never after today). */
  takenOn: ISODateString;
  unit: number;
  integration: number;
  e2e: number;
  /** The runtimes that day, when they were entered. */
  runtime?: TestLayerRuntime;
  note?: string;
}

export interface TestPyramid {
  id: string;
  unit: number;
  integration: number;
  e2e: number;
  description?: string;
  /** Minutes per layer, for weighting by runtime. Absent: not timed. */
  runtime?: TestLayerRuntime;
  /** "runtime" needs all three runtimes (the CRUD schema refuses it otherwise). Absent: "count". */
  weighting?: TestPyramidWeighting;
  /** Dated copies of the counts, oldest first. Absent: none taken. */
  snapshots?: TestPyramidSnapshot[];
  /** Local YYYY-MM-DD the counts were last saved. Absent: before Phase 8. */
  updatedOn?: ISODateString;
}

export type FlakyStatus = "active" | "quarantined" | "fixed";

export interface FlakyTest {
  id: string;
  name: string;
  suite?: string;
  owner?: string;
  /**
   * 0..1 observed failure rate. Kept equal to failures / runs when both are
   * set, so readers from before Phase 8 still work; a row with only this
   * (no run counts) is a legacy rate-only row.
   */
  failureRate: number;
  status: FlakyStatus;
  firstSeenAt: ISODateString;
  fixedAt?: string;
  description?: string;
  /** Failed runs in the window counted. Set together with `runs`. */
  failures?: number;
  /** Runs in that window: at least 1 and at least `failures`. */
  runs?: number;
  /** Local YYYY-MM-DD the test went into quarantine. Absent: not quarantined, or before Phase 8. */
  quarantinedAt?: ISODateString;
  /** Where it was sent (a backlog story to fix it). */
  sentTo?: HandoffLink[];
}

export interface FlakyTestBoard {
  id: string;
  tests: FlakyTest[];
}

export interface PrSample {
  id: string;
  prNumber?: string;
  author: string;
  openedAt: ISODateString;
  mergedAt?: string;
  reviewerCount: number;
  commentCount: number;
  linesChanged: number;
  description?: string;
  /**
   * When the first review landed: local wall-clock "YYYY-MM-DDTHH:MM",
   * between openedAt and mergedAt. Absent: not recorded (rows from before
   * Phase 8, or still waiting).
   */
  firstReviewAt?: string;
}

/**
 * The hours of a working day the review maths counts, local "HH:MM"
 * (24-hour), start before end. Absent on the log: whole working days count.
 */
export interface CodeReviewWorkingWindow {
  start: string;
  end: string;
}

export interface CodeReviewLog {
  id: string;
  samples: PrSample[];
  /** The team's working hours for "working hours" medians; absent: whole working days. */
  workingWindow?: CodeReviewWorkingWindow;
}

/* ────────────────────────────────────────────────────────────────────
 * S7 — Engineering Excellence entities (singleton-doc per tool, like kanban).
 * ────────────────────────────────────────────────────────────────── */

/** What a derived DORA sample was worked out from. */
export interface DoraDerivedFrom {
  /** Releases that went out in the quarter. */
  releases: number;
  /** Of them, rolled back. */
  rolledBack: number;
  /** Finished stories and cards the lead time is measured over. */
  items: number;
  /** Incidents the time to restore is measured over. */
  incidents: number;
}

export interface DoraSample {
  id: string;
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  /** 0..1 fractional change-failure rate. */
  changeFailRate: number;
  mttrHours: number;
  description?: string;
  /** Typed by hand (absent reads as manual), or derived from the toolkit's data. */
  source?: "manual" | "derived";
  derivedFrom?: DoraDerivedFrom;
  updatedAt?: ISODateString;
}

export interface DoraScorecard {
  id: string;
  samples: DoraSample[];
}

export interface SloDefinition {
  id: string;
  name: string;
  sliDescription: string;
  /** 0..1 — e.g. 0.999 = 99.9%. */
  target: number;
  windowDays: number;
  description?: string;
}

export interface SloBurn {
  id: string;
  sloId: string;
  date: ISODateString;
  errorMinutes: number;
}

export interface SloBuilder {
  id: string;
  slos: SloDefinition[];
  burns: SloBurn[];
}

export interface SpaceScore {
  id: string;
  quarter: string;
  /** Each 1..5. */
  satisfaction: number;
  performance: number;
  activity: number;
  communication: number;
  efficiency: number;
  description?: string;
}

export interface SpacePulse {
  id: string;
  scores: SpaceScore[];
}

export interface DevexResponse {
  id: string;
  respondent: string;
  date: ISODateString;
  /** Each 1..5; cognitiveLoad higher = worse. */
  flowState: number;
  feedbackLoops: number;
  cognitiveLoad: number;
  comments?: string;
}

export interface DevexSurvey {
  id: string;
  responses: DevexResponse[];
}

export interface PlatformMaturity {
  id: string;
  /** Per-dimension score (dimension id → level). */
  dimensions: Record<string, number>;
  /** Per-dimension free-text notes. */
  notes: Record<string, string>;
}

/* ────────────────────────────────────────────────────────────────────
 * S11 — Workshops & Facilitation entities (singleton-doc per tool). Nested
 * item types are namespaced (Charter*, DesignSprint*, Wardley*, Assumption*)
 * to avoid clashing with other entities in this shared file (e.g. Sprint).
 * ────────────────────────────────────────────────────────────────── */

export type CharterRuleCategory =
  | "communication"
  | "meetings"
  | "decisions"
  | "work"
  | "conflict"
  | "other";

/** The working agreement's one document id. */
export const WORKING_AGREEMENT_ID = "workingAgreement:current";

/** How one person answered a rule: consent, a concern they can live with, or an objection. */
export type CharterConsentVote = "consent" | "concern" | "object";

/** One person's answer to a rule (one per person, matched by name). */
export interface CharterConsent {
  /** The roster spelling when the person is on the team, else as typed. */
  name: string;
  vote: CharterConsentVote;
  note?: string;
  at: ISODateString;
}

export interface CharterRule {
  id: string;
  category: CharterRuleCategory;
  text: string;
  /** Who agreed. Once `consent` is present it is derived from it (the names
   *  with vote "consent"), so the charter and older readers keep working. */
  agreedBy: string[];
  description?: string;
  /** The draft of the check-in in progress: is the rule still working in
   *  practice? true, false, or "partly" (kept some of the time, or by some
   *  of the team). Saved rounds are kept in `WorkingAgreement.checkIns`. */
  stillWorking?: boolean | "partly";
  /** Each person's answer; the source of truth for `agreedBy` once present. */
  consent?: CharterConsent[];
  /** The item it was sent from (a kickoff's rule). */
  sourceRef?: HandoffRef;
  /** The charter template that wrote it, and which of its lines (slot, at most 40 characters). */
  template?: { id: CharterTemplateId; slot: string };
}

export interface CharterMeta {
  teamName?: string;
  version: number;
  publishedAt?: string;
  description?: string;
}

/** How a rule went in a check-in; "partly" counts as half in adherence. */
export type CharterCheckInResult = "working" | "partly" | "not_working";

/** One saved adoption check-in: how each rule is working, as of `date`. */
export interface CharterCheckIn {
  id: string;
  /** YYYY-MM-DD (can be backdated). */
  date: ISODateString;
  sprintId?: string;
  /** The `meta.version` the team checked. */
  version: number;
  /** Rule id → result; a rule left out was skipped. */
  results: Record<string, CharterCheckInResult>;
  /** Each checked rule's text at the time, so a later rewording doesn't rewrite history. */
  ruleTexts?: Record<string, string>;
  note?: string;
}

/** A rule as it read in a published version. */
export interface CharterVersionRule {
  id: string;
  category: CharterRuleCategory;
  text: string;
  description?: string;
}

/** A published version of the agreement, kept so versions can be compared. */
export interface CharterVersion {
  version: number;
  publishedAt: ISODateString;
  teamName?: string;
  description?: string;
  rules: CharterVersionRule[];
}

export interface WorkingAgreement {
  id: string;
  rules: CharterRule[];
  meta: CharterMeta;
  /** Saved check-ins, oldest first (the latest 52 are kept). */
  checkIns?: CharterCheckIn[];
  /** Published versions, oldest first (the latest 20 are kept). */
  versions?: CharterVersion[];
  /** The charter templates applied (the tools plan's phase 2, P2.9; see `CharterTemplates`). */
  templates?: CharterTemplates;
}

export interface LsFavorite {
  id: string;
  structureId: string;
  ts: ISODateString;
}

export interface LiberatingStructures {
  id: string;
  favorites: LsFavorite[];
}

export type DesignSprintDayNumber = 1 | 2 | 3 | 4 | 5;

export interface DesignSprintTask {
  id: string;
  text: string;
  done: boolean;
  owner?: string;
}

export type DesignSprintOutputKind =
  | "long-term-goal"
  | "sprint-question"
  | "target"
  | "sketch"
  | "decision"
  | "storyboard"
  | "prototype"
  | "finding"
  | "note";

/** Something a design-sprint day produced: the goal, a sketch, a decision, a finding. */
export interface DesignSprintOutput {
  id: string;
  kind: DesignSprintOutputKind;
  text: string;
  url?: string;
  /** Test day: how the interviews took it; unset until judged. */
  signal?: "positive" | "negative" | "mixed";
  /** Test day: in how many interviews it came up (0–5). */
  seenIn?: number;
  /** A Map-day sprint question: the answer Test day gave. */
  answer?: "yes" | "no" | "unclear";
  /** Where a finding was sent (a hypothesis, a backlog story). */
  sentTo?: HandoffLink[];
  createdAt?: ISODateString;
}

export interface DesignSprintDay {
  day: DesignSprintDayNumber;
  dayName: "Map" | "Sketch" | "Decide" | "Prototype" | "Test";
  tasks: DesignSprintTask[];
  /** Free-text notes, from before days had typed outputs. */
  artifacts: string[];
  /** What the day produced. */
  outputs?: DesignSprintOutput[];
}

export interface DesignSprintPlan {
  id: string;
  name: string;
  startDate: ISODateString;
  /** Kept for older readers. Today's day is derived from `startDate` and
   *  the team's working days (lib/design-sprint/day.ts). */
  currentDay: DesignSprintDayNumber;
  days: DesignSprintDay[];
  description?: string;
  decider?: string;
  facilitator?: string;
  completedAt?: string;
}

export interface DesignSprint {
  id: string;
  sprint: DesignSprintPlan | null;
}

export type AssumptionLevel = 1 | 2 | 3 | 4 | 5;
export type AssumptionStatus = "untested" | "testing" | "validated" | "invalidated";

export interface Assumption {
  id: string;
  statement: string;
  /**
   * 1–5, how badly it hurts if the assumption is wrong. Absent = not rated:
   * never ranked or placed in the matrix. Rows from before Phase 8 always
   * have both ratings and stay rated (one an agent stored off the scale is
   * kept until a write sets it; readers clamp it).
   */
  riskLevel?: AssumptionLevel;
  /** 1–5, how much evidence backs it. Absent = not rated, as riskLevel. */
  evidenceLevel?: AssumptionLevel;
  testIdea?: string;
  status: AssumptionStatus;
  description?: string;
  /** Where it was sent: the hypothesis that tests it. */
  sentTo?: HandoffLink[];
}

export interface RiskiestAssumption {
  id: string;
  assumptions: Assumption[];
}

export interface WardleyComponent {
  id: string;
  name: string;
  /** 0 = Genesis … 1 = Commodity (X axis). */
  evolution: number;
  /** 0 = invisible … 1 = highly visible to user (Y axis). */
  visibility: number;
  description?: string;
}

export interface WardleyLink {
  id: string;
  fromId: string;
  toId: string;
}

export interface WardleyMap {
  id: string;
  components: WardleyComponent[];
  links: WardleyLink[];
}

/* ────────────────────────────────────────────────────────────────────
 * S5 — Portfolio & Discovery entities (singleton-doc per tool; each wraps a
 * flat array of records). Generic nested types namespaced (HypothesisStatus,
 * TreeNodeKind).
 * ────────────────────────────────────────────────────────────────── */

/** An epic's place on the Now, Next, Later board (Epic Roadmap). */
export const EPIC_HORIZONS = ["now", "next", "later"] as const;
export type EpicHorizon = (typeof EPIC_HORIZONS)[number];

export interface Epic {
  id: string;
  title: string;
  description?: string;
  startQuarter: string;
  endQuarter: string;
  progress: number;
  owner?: string;
  color?: string;
  /** Set by hand on the Now, Next, Later board; absent: read from its quarters. */
  horizon?: EpicHorizon;
  /** The item it was sent from (an impact map's deliverable, a strategy tree's initiative). */
  sourceRef?: HandoffRef;
}

export interface EpicRoadmap {
  id: string;
  epics: Epic[];
}

// ──────── S8 — Incidents & Reliability ────────

/** Runbook hygiene score on a 1..5 scale. */
export type ScoreValue = 1 | 2 | 3 | 4 | 5;

export interface Runbook {
  id: string;
  name: string;
  owner?: string;
  lastReviewedAt?: string;
  freshness: ScoreValue;
  completeness: ScoreValue;
  testedRecently: boolean;
  description?: string;
}

/** runbook-scorer singleton: hygiene scoring across operational runbooks. */
export interface RunbookScorer {
  id: string;
  runbooks: Runbook[];
}

export type ReleaseStatus = "planning" | "shipped" | "rolled_back";

export type GateId =
  | "a11y_audit"
  | "perf_baseline"
  | "monitoring_dashboards"
  | "alerts_tuned"
  | "rollback_tested"
  | "runbook_linked"
  | "sre_review"
  | "security_review"
  | "feature_flag_ready";

/** Canonical readiness gates — the source of truth for both the client catalog
 *  (which adds labels/descriptions) and the agent actions (empty/count math). */
export const RELEASE_GATE_IDS: GateId[] = [
  "a11y_audit",
  "perf_baseline",
  "monitoring_dashboards",
  "alerts_tuned",
  "rollback_tested",
  "runbook_linked",
  "sre_review",
  "security_review",
  "feature_flag_ready",
];

/** A gate the toolkit can check by itself: the release's feature flags, or the Definition of Done. */
export type ReleaseGateAuto = "flags" | "dod";

/** A readiness gate in the team's list: one of the built-ins (`GateId`) or the team's own. */
export interface ReleaseGateDef {
  id: string;
  label: string;
  description?: string;
  auto?: ReleaseGateAuto;
  /** Taken off the list; kept so shipped releases still name it. */
  archived?: boolean;
}

/** An earlier ship of a release that was reopened, kept so the stats still count it. */
export interface ReleaseShip {
  shippedDate: string;
  rolledBackAt?: string;
  /** The gates that applied, frozen at ship. */
  gateIds?: string[];
  gates?: Record<string, boolean>;
  gatesOpenAtShip?: number;
}

export interface Release {
  id: string;
  name: string;
  plannedDate: string;
  status: ReleaseStatus;
  shippedDate?: string;
  /** Gate id → passed. A built-in gate is a `GateId`; a missing key is open. */
  gates: Record<string, boolean>;
  /** Open-gate count snapshotted at ship time (kept for historical p-charts). */
  gatesOpenAtShip?: number;
  description?: string;
  /** The gates that applied, frozen at ship (absent: the built-in `RELEASE_GATE_IDS`). */
  gateIds?: string[];
  /** When it was rolled back (YYYY-MM-DD). */
  rolledBackAt?: string;
  /** Earlier ships, oldest first, kept when a shipped release is reopened. */
  previousShips?: ReleaseShip[];
  /** Stories it ships, for an exact DORA lead time. */
  storyIds?: string[];
  /** Its release notes, for customers or for the team (text at most TOOL_TEXT_MAX.releaseNotes). */
  releaseNotes?: { audience: "customers" | "team"; text: string; updatedAt: string };
}

/** release-readiness singleton: launch gates + ship/rollback tracking. */
export interface ReleaseReadiness {
  id: string;
  releases: Release[];
  /** The team's gate list, in order; absent: the built-in gates. */
  gates?: ReleaseGateDef[];
}

export type OncallSeverity = "sev1" | "sev2" | "sev3" | "sev4";

export interface OncallShift {
  id: string;
  person: string;
  startDate: string;
  endDate: string;
  description?: string;
}

export interface OncallPage {
  id: string;
  shiftId: string;
  ts: string;
  severity: OncallSeverity;
  description?: string;
}

/** oncall-roster singleton: shifts + paging load + expected-pages baseline. */
export interface OncallRoster {
  id: string;
  shifts: OncallShift[];
  pages: OncallPage[];
  expectedPagesPerWeek?: number;
}

export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus = "active" | "mitigated" | "resolved";

export interface IncidentTimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  commander?: string;
  scribe?: string;
  description?: string;
  timeline: IncidentTimelineEntry[];
}

/** incident-commander singleton: live incident board with timelines + MTTR. */
export interface IncidentCommander {
  id: string;
  incidents: Incident[];
}

export type PostMortemStatus = "draft" | "review" | "published";
export type PostMortemActionStatus = "open" | "in_progress" | "done";

export interface PostMortemAction {
  id: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: PostMortemActionStatus;
}

export interface PostMortemTimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

export interface PostMortem {
  id: string;
  title: string;
  incidentDate: string;
  status: PostMortemStatus;
  summary?: string;
  contributingFactors: string[];
  timeline: PostMortemTimelineEntry[];
  actions: PostMortemAction[];
  description?: string;
  createdAt?: string;
  publishedAt?: string;
}

/** post-mortem singleton: blameless retrospectives with factors + actions. */
export interface PostMortemLog {
  id: string;
  postmortems: PostMortem[];
}

export type HypothesisStatus = "drafted" | "running" | "validated" | "invalidated" | "inconclusive";

/** What counts as success: at least (increase) or at most (decrease) `value`. */
export interface HypothesisTarget {
  direction: MetricDirection;
  value: number;
  /** Shown after numbers: "%", "sign-ups", "s". */
  unit?: string;
  /** Where the metric stood before the test. */
  baseline?: number;
}

export interface Hypothesis {
  id: string;
  description?: string;
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment?: string;
  outcome?: string;
  status: HypothesisStatus;
  raisedAt: ISODateString;
  resolvedAt?: string;
  /**
   * The item this was sent from: a riskiest assumption, an Opportunity Tree
   * experiment, a Cynefin item or a Design Sprint finding.
   */
  sourceRef?: HandoffRef;
  /** The number the test aims for. Absent on rows from before Phase 8; successMetric keeps the words. */
  target?: HypothesisTarget;
  /** The measured result, in target.unit. Absent until measured. */
  actual?: number;
  /*
   * Value checks (the tools plan's phase 2, P2.5): did the shipped work
   * deliver? See `HypothesisMeasuredBy` and `HypothesisShipped` in the
   * Phase 43 block.
   */
  /** How it is measured. */
  measuredBy?: HypothesisMeasuredBy;
  /** The shipped story or epic it checks: present makes it a value check. */
  shipped?: HypothesisShipped;
  /** The day to read the result (YYYY-MM-DD). */
  checkOn?: string;
}

export interface HypothesisTracker {
  id: string;
  hypotheses: Hypothesis[];
}

export interface InterviewQuote {
  id: string;
  text: string;
  tags: string[];
  /** Where it was sent: an opportunity on the Opportunity Tree. */
  sentTo?: HandoffLink[];
}

export interface Interview {
  id: string;
  date: ISODateString;
  participant: string;
  context?: string;
  quotes: InterviewQuote[];
}

export interface UserInterviewLog {
  id: string;
  interviews: Interview[];
}

export type TreeNodeKind = "outcome" | "opportunity" | "solution" | "experiment";

export interface TreeNode {
  id: string;
  kind: TreeNodeKind;
  text: string;
  parentId: string | null;
  evidence?: string;
  description?: string;
  /**
   * The opportunity the team pursues under its outcome. Opportunities only
   * (the CRUD schema refuses it on another kind), at most one per outcome.
   */
  target?: boolean;
  /** Where it was sent: an experiment's hypothesis. */
  sentTo?: HandoffLink[];
  /** Where it came from: an opportunity raised from an interview quote. */
  sourceRef?: HandoffRef;
}

/** The Opportunity Tree's one document id (the page, its agent actions, JTBD's links, the opportunity hand-off). */
export const OPPORTUNITY_TREE_ID = "opportunityTree:current";

export interface OpportunityTree {
  id: string;
  nodes: TreeNode[];
}

/* ────────────────────────────────────────────────────────────────────
 * Phase 20 — Prioritization Frameworks entities
 * ────────────────────────────────────────────────────────────────── */

export interface PrioritizationItem {
  id: string;
  /** Which framework this row belongs to so multiple tools share storage */
  framework:
    | "rice"
    | "ice"
    | "moscow"
    | "kano"
    | "wsjf"
    | "cost-of-delay"
    | "value-effort"
    | "buy-feature"
    | "hundred-dollar"
    | "eisenhower"
    | "walking-skeleton";
  title: string;
  description?: string;
  /** Generic numeric score derived by the framework, unrounded. Absent: Not
   *  scored (a title-only row, status "open"); readers never treat it as 0. */
  score?: number;
  /** Free-form data bag (per-framework fields) */
  fields?: Record<string, number | string>;
  status?: "open" | "scored" | "decided" | "shipped" | "dropped";
  updatedAt: ISODateString;
  /** The shared backlog item (workspace backlogItems) this row scores. */
  backlogItemId?: string;
  /** Where this row was sent (Buy-a-Feature: a funded feature pushed to the
   *  backlog as a story). */
  sentTo?: HandoffLink[];
}

/* ── Group allocation rounds (Phase 7) ──
 * Buy-a-Feature and the $100 Test run "allocation" rounds: each person splits
 * a budget across the items, anonymously (the vote-room kit's allocation
 * kind, or splits typed in by the facilitator). Only aggregates are kept,
 * never anyone's split: per item the total, how many backed it and how many
 * fell in each of five bands of the budget. */

/** The tools whose rounds are AllocationRounds. */
export const ALLOCATION_ROUND_TOOLS = [
  "buy-a-feature",
  "hundred-dollar-test",
] as const satisfies readonly string[];

export type AllocationRoundTool = (typeof ALLOCATION_ROUND_TOOLS)[number];

/** One item's line in a saved allocation round. */
export interface AllocationRoundItem {
  /** The PrioritizationItem this line was. */
  itemId: string;
  /** Its title when the round ran. */
  text: string;
  /** The most it could take, in all and from one person (Buy-a-Feature: what
   *  was left of its price). A total above it is over-funding. */
  cap?: number;
  /** Everyone's amounts on the item, added up. */
  total: number;
  /** People who gave it more than 0; null when the spread was withheld. */
  backers: number | null;
  /** People per band (`AllocationRound.bandEdges`); null when withheld (fewer
   *  than 5 answers, or totals typed by hand). */
  bands: number[] | null;
}

/** One anonymous allocation round: totals only, never anyone's split. */
export interface AllocationRound {
  /** "allocationRound_<nanoid(8)>". */
  id: string;
  tool: AllocationRoundTool;
  /** The live round's id, or "tally-<base36>" for a count entry. */
  roundId: string;
  title: string;
  /** Whole units each person split, 10..9999. */
  budget: number;
  /** Shown before amounts, ≤ 4 chars, e.g. "$". */
  unit: string;
  /** true: each split used the whole budget ($100 Test); false: up to it (Buy-a-Feature). */
  spendAll: boolean;
  /** YYYY-MM-DD the round is for (a hand-entered round can be backdated). */
  date: ISODateString;
  /** When the round closed (ISO). */
  closedAt: ISODateString;
  /** The fewest answers the totals showed from. */
  minN: number;
  /** How many people answered. */
  ballots: number;
  source: "room" | "facilitator";
  /**
   * false when the totals were typed by hand: how the amounts were spread
   * isn't known at any count, so no backers or bands. Written only then;
   * absent, it's read from the bands (lib/hundred-dollar spreadKnownOf).
   */
  spreadKnown?: boolean;
  /** Lower edge of each band, ascending from 0 (the kit's allocationBandEdges(budget)). */
  bandEdges: number[];
  items: AllocationRoundItem[];
}

/** The kind allocation rounds sync under (user_entities), for server-side code. */
export const ALLOCATION_ROUND_KIND = "workspace:allocationRound";

/** Buy-a-Feature's one game document id. */
export const BUY_A_FEATURE_ID = "buyAFeature:current";

/** The kind the game syncs under (user_entities), for server-side code. */
export const BUY_A_FEATURE_KIND = "workspace:buyAFeatureGame";

/**
 * The Buy-a-Feature game's settings (a singleton, id BUY_A_FEATURE_ID). The
 * features are PrioritizationItem rows (framework "buy-feature") with their
 * price and what was raised; the pool is budgetPerPlayer × players.
 */
export interface BuyAFeatureGame {
  /** BUY_A_FEATURE_ID. */
  id: string;
  /** Play money each player gets, whole units 10..9999. Unset until the facilitator sets it. */
  budgetPerPlayer?: number;
  /** Players in the game, 1..999. Unset until set (the roster size is offered, never assumed). */
  players?: number;
  /** Shown before amounts, ≤ 4 chars, e.g. "$". */
  unit?: string;
  updatedAt: ISODateString;
}

/* ────────────────────────────────────────────────────────────────────
 * Phase 21 — Decision Frameworks entities
 * ────────────────────────────────────────────────────────────────── */

export interface DACIDecision {
  id: string;
  title: string;
  context?: string;
  driver?: string;
  approver?: string;
  contributors?: string[];
  informed?: string[];
  options?: string[];
  recommendation?: string;
  status: "open" | "decided" | "implemented" | "revisit";
  date: ISODateString;
}

export interface RAPIDDecision {
  id: string;
  title: string;
  context?: string;
  recommend?: string;
  agree?: string[];
  perform?: string[];
  input?: string[];
  decide?: string;
  status: "open" | "decided" | "implemented";
  date: ISODateString;
}

/**
 * The matrix every option and criterion without a `matrixId` belongs to: the
 * one unnamed matrix from before named matrices (read-time, no migration).
 */
export const DEFAULT_WEIGHTED_MATRIX_ID = "weightedMatrix:default";

/** The kind weighted matrices sync under (user_entities), for server-side code. */
export const WEIGHTED_MATRIX_KIND = "workspace:weightedMatrix";

/**
 * A named weighted-decision matrix: one question, scored on its own options
 * and criteria (the rows whose `matrixId` is this id). The default matrix
 * (`DEFAULT_WEIGHTED_MATRIX_ID`) needs no stored row: legacy rows belong to
 * it even when none is saved.
 */
export interface WeightedMatrix {
  /** "weightedMatrix_<nanoid(8)>", or DEFAULT_WEIGHTED_MATRIX_ID once the default one is named. */
  id: string;
  name: string;
  /** What is being decided; becomes the decision record's title. */
  question?: string;
  createdAt: ISODateString;
  updatedAt?: ISODateString;
  /** Where the result went (a decision record). */
  sentTo?: HandoffLink[];
}

export interface WeightedOption {
  id: string;
  name: string;
  scores: Record<string, number>; // criterionId -> score
  /** The matrix this option is in; absent: the default matrix (DEFAULT_WEIGHTED_MATRIX_ID). */
  matrixId?: string;
  /** Why it scored as it did, or a caveat. */
  note?: string;
}

export interface WeightedCriterion {
  id: string;
  name: string;
  weight: number;
  /** The matrix this criterion is in; absent: the default matrix (DEFAULT_WEIGHTED_MATRIX_ID). */
  matrixId?: string;
  /** What a score of 1 means on this criterion. */
  low?: string;
  /** What a score of 10 means on this criterion. */
  high?: string;
}

/** The kinds weighted options and criteria sync under (user_entities), for server-side code. */
export const WEIGHTED_OPTION_KIND = "workspace:weightedOption";
export const WEIGHTED_CRITERION_KIND = "workspace:weightedCriterion";

/**
 * The matrix a weighted option or criterion is in: its `matrixId`, or the
 * default matrix when it has none. An empty id (the CRUD refuses one) reads
 * as none too, so no row sits in a matrix nothing can open.
 */
export function weightedMatrixIdOf(row: { matrixId?: string }): string {
  return row.matrixId || DEFAULT_WEIGHTED_MATRIX_ID;
}

/** The options that held a score for one of `criterionIds`, without those scores. */
export function withoutWeightedScores(
  options: readonly WeightedOption[],
  criterionIds: ReadonlySet<string>
): WeightedOption[] {
  const out: WeightedOption[] = [];
  for (const o of options) {
    const stale = Object.keys(o.scores ?? {}).filter((k) => criterionIds.has(k));
    if (stale.length === 0) continue;
    const scores = { ...o.scores };
    for (const k of stale) delete scores[k];
    out.push({ ...o, scores });
  }
  return out;
}

/**
 * What deleting matrix `id` removes: the options and criteria in it (for
 * DEFAULT_WEIGHTED_MATRIX_ID, the rows without a matrixId), plus `rescored`,
 * the options left that held a score for a removed criterion, without it.
 * The store's removeWeightedMatrix and the MCP side of
 * workspace.weighted_matrix.delete both apply it, so the two leave the same rows.
 */
export function weightedMatrixRemoval(
  id: string,
  options: readonly WeightedOption[],
  criteria: readonly WeightedCriterion[]
): { optionIds: string[]; criterionIds: string[]; rescored: WeightedOption[] } {
  const inMatrix = (row: { matrixId?: string }) => weightedMatrixIdOf(row) === id;
  const criterionIds = criteria.filter(inMatrix).map((c) => c.id);
  return {
    optionIds: options.filter(inMatrix).map((o) => o.id),
    criterionIds,
    rescored: withoutWeightedScores(
      options.filter((o) => !inMatrix(o)),
      new Set(criterionIds)
    ),
  };
}

export interface SixHatsThought {
  id: string;
  hat: "white" | "red" | "black" | "yellow" | "green" | "blue";
  text: string;
  loggedAt: ISODateString;
  /** The session it was said in; absent on thoughts from before sessions. */
  sessionId?: string;
}

export type SixHatsHat = SixHatsThought["hat"];

/**
 * A Six Thinking Hats session: one topic, worn hat by hat in timed rounds,
 * closed with the Blue hat's summary (which can become a decision record).
 */
export interface SixHatsSession {
  id: string;
  topic: string;
  /** Hats in the agreed order; a hat may repeat (Blue to open and to close). */
  order: SixHatsHat[];
  /** Minutes per round. */
  roundMinutes: number;
  /** Index in `order` of the round being worn; absent before the first and after the last. */
  currentRound?: number;
  /** The Blue hat's summary: conclusions and next steps. */
  summary?: string;
  startedAt: ISODateString;
  closedAt?: ISODateString;
  /** Where the summary went (a decision record). */
  sentTo?: HandoffLink[];
}

export interface OODACycle {
  id: string;
  topic: string;
  observe?: string;
  orient?: string;
  decide?: string;
  act?: string;
  startedAt: ISODateString;
  completedAt?: ISODateString;
}

export interface CynefinItem {
  id: string;
  title: string;
  /** The domain the user confirmed (the guided questions only suggest one). */
  domain: "clear" | "complicated" | "complex" | "chaotic" | "confused";
  rationale?: string;
  recommendedAction?: string;
  loggedAt: ISODateString;
  /** The guided sense-making answers the suggestion came from; absent on
   *  items placed by hand or from before the questions. */
  answers?: Partial<Record<CynefinQuestionId, CynefinAnswer>>;
  /** Where it was sent (a complex item: a hypothesis to test). */
  sentTo?: HandoffLink[];
}

export type CynefinDomain = CynefinItem["domain"];

/** The guided sense-making questions (lib/cynefin has their wording). */
export type CynefinQuestionId = "crisis" | "known" | "analysable" | "emergent" | "disagree";

export const CYNEFIN_QUESTION_IDS = [
  "crisis",
  "known",
  "analysable",
  "emergent",
  "disagree",
] as const satisfies readonly CynefinQuestionId[];

export type CynefinAnswer = "yes" | "no" | "unsure";

export const CYNEFIN_ANSWERS = ["yes", "no", "unsure"] as const satisfies readonly CynefinAnswer[];

export interface StaceyItem {
  id: string;
  title: string;
  /** 0..1 — how much agreement on what to do */
  agreement: number;
  /** 0..1 — how much certainty on how to do it */
  certainty: number;
  region?: "simple" | "complicated" | "complex" | "chaotic";
  loggedAt: ISODateString;
}

export interface PolarityPole {
  id: string;
  polarityId: string;
  side: "left" | "right";
  label: string;
  upsides: string[];
  downsides: string[];
}

export interface Polarity {
  id: string;
  title: string;
  greaterPurpose?: string;
  deeperFear?: string;
}

/* ────────────────────────────────────────────────────────────────────
 * Phase 22 — Canvas (Miro-like whiteboard) entities
 * World-space coords (positive x = right, positive y = down).
 * Per-object `version` enables last-write-wins conflict resolution
 * for the realtime diff-sync layer.
 * ────────────────────────────────────────────────────────────────── */

export type WhiteboardObjectKind =
  | "sticky"
  | "rect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "line"
  | "arrow"
  | "connector"
  | "text"
  | "freehand"
  | "image"
  | "frame"
  | "embed"
  // Phase 23+ extensions:
  | "card"
  | "kanban"
  | "timer"
  | "voting"
  | "table"
  | "mindMapNode"
  | "diagramShape";

export interface WhiteboardObjectBase {
  id: string;
  boardId: string;
  type: WhiteboardObjectKind;
  /** World-space top-left. For line/arrow this is the start point. */
  x: number;
  y: number;
  /** Bounding-box size. For line/arrow these are dx/dy to the end point. */
  w: number;
  h: number;
  rotation?: number; // degrees clockwise; default 0
  z: number; // z-index; higher = on top
  locked?: boolean;
  groupId?: string;
  frameId?: string;
  /** Free-form tags — shared with Story.tags, Risk.tags, etc. so a
   * sticky tagged "blocker" surfaces in the same filter as a story
   * tagged "blocker". Phase 26 addition. */
  tags?: string[];
  /** Monotonic version for LWW conflict resolution. */
  version: number;
  updatedBy?: string;
  updatedAt: ISODateString;
  createdBy?: string;
  createdAt: ISODateString;
  /** Optional back-reference to another tool's entity. */
  sourceRef?: { tool: string; entityId: string };
}

export interface WhiteboardSticky extends WhiteboardObjectBase {
  type: "sticky";
  content: string;
  color: string;
  textColor?: string;
  fontSize?: number;
  /** Optional font family override. Defaults to ui-sans-serif when unset. */
  fontFamily?: string;
}

export interface WhiteboardShape extends WhiteboardObjectBase {
  type: "rect" | "ellipse" | "diamond" | "triangle";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Dashed border / outline. Maps to stroke-dasharray "6 4" in SVG. */
  dashed?: boolean;
  content?: string;
  /** Inner text color (defaults to a light slate against dark fills). */
  contentColor?: string;
}

export interface WhiteboardLine extends WhiteboardObjectBase {
  type: "line" | "arrow";
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}

export type ConnectorAnchor = "top" | "right" | "bottom" | "left" | "auto";
export type ConnectorRouting = "straight" | "orthogonal" | "curved";

export interface WhiteboardConnector extends WhiteboardObjectBase {
  type: "connector";
  fromId: string;
  toId: string;
  fromAnchor?: ConnectorAnchor;
  toAnchor?: ConnectorAnchor;
  routing: ConnectorRouting;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  stroke: string;
  strokeWidth: number;
  label?: string;
  dashed?: boolean;
}

export interface WhiteboardText extends WhiteboardObjectBase {
  type: "text";
  content: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  align?: "left" | "center" | "right";
  /** Optional font family override. Defaults to ui-sans-serif when unset. */
  fontFamily?: string;
}

export interface WhiteboardFreehand extends WhiteboardObjectBase {
  type: "freehand";
  /** Flat [x0,y0,x1,y1,...] in WORLD coords — ALWAYS stride-2 so older
   * clients on the realtime channel keep rendering correctly. */
  points: number[];
  /** Optional per-sample pressure in [0, 1]. `pressures.length` equals
   * `points.length / 2`. Present only for strokes drawn by a stylus
   * that reported real pressure; absent or undefined falls back to the
   * legacy polyline render path. Stored as a separate array so old
   * clients (pre-stylus build) ignore it cleanly and render the
   * polyline as before. */
  pressures?: number[];
  stroke: string;
  strokeWidth: number;
  smoothness?: number;
}

export interface WhiteboardImage extends WhiteboardObjectBase {
  type: "image";
  src: string;
  alt?: string;
  fit?: "cover" | "contain";
}

export interface WhiteboardFrame extends WhiteboardObjectBase {
  type: "frame";
  label: string;
  fill?: string;
  /** Optional speaker notes shown inside PresentationMode when this
   * frame is the active slide. Plain text; multi-line. The frame
   * itself stays unchanged — notes are presenter-only. */
  presenterNotes?: string;
}

export interface WhiteboardEmbed extends WhiteboardObjectBase {
  type: "embed";
  src: string;
  kind: "youtube" | "figma" | "loom" | "generic";
}

/** Phase 26 — first-class card backed by a Story (or standalone). When
 * `sourceRef.tool === "backlog"`, edits to the card propagate to the
 * underlying Story and vice versa via the cross-tool sync layer. */
export interface WhiteboardCard extends WhiteboardObjectBase {
  type: "card";
  title: string;
  description?: string;
  assignee?: string;
  /** ISO date for the due date. */
  due?: ISODateString;
  /** Story points or a similar numeric estimate. */
  points?: number;
  /** Status: free-form so any tool can map to its own status set. */
  status?: string;
  /** Card accent color. Defaults to cyan. */
  color?: string;
}

/** Phase 26 — Kanban frame: a frame that auto-layouts contained Cards
 * into named columns. Children are positioned by the canvas based on
 * their `status`. */
export interface WhiteboardKanbanFrame extends WhiteboardObjectBase {
  type: "kanban";
  label: string;
  /** Column status keys in left-to-right order. */
  columns: string[];
  /** Optional column display labels (defaults to the status keys). */
  columnLabels?: string[];
}

/** Phase 25 — facilitation timer. */
export interface WhiteboardTimer extends WhiteboardObjectBase {
  type: "timer";
  /** Total duration in seconds. */
  durationSec: number;
  /** When `running` is true, this is the unix-ms epoch the timer
   * started counting from. Receivers compute remaining = durationSec
   * - (now - startedAt)/1000. */
  startedAt?: number;
  /** Paused state: pre-paused remaining seconds (0 when freshly created). */
  remainingSec?: number;
  running: boolean;
  /** Optional label shown above the time display. */
  label?: string;
}

/**
 * Phase post-launch — editable table object.
 *
 * Cell content is plain text (no Tiptap per cell — would compound
 * the React tree depth). Rendered as <table>; cells are
 * double-click-to-edit, Tab/Enter navigate between cells. Column
 * widths are proportional fractions of the object's width — if
 * unset, evenly distributed across columns. The first row is treated
 * as a header (rendered <th>) when `headerRow !== false`.
 *
 * CSV paste (in import-modal) creates one of these. Empty cells are
 * preserved (the layout depends on consistent column counts per row).
 */
export interface WhiteboardTable extends WhiteboardObjectBase {
  type: "table";
  /** Cell content as `rows[rowIndex][colIndex]`. Every row must
   * carry the same number of cells; trim/pad on import. */
  rows: string[][];
  /** Optional per-column width fractions; must sum to ~1.0. When
   * omitted, columns get equal width. */
  columnFractions?: number[];
  /** When `false`, render row 0 as a normal data row. Default behaviour
   * (undefined or true) renders row 0 as a sticky header. */
  headerRow?: boolean;
  /** Optional border colour; defaults to the canvas's standard
   * border colour. */
  borderColor?: string;
}

/**
 * Mind map node — a single bubble in a tree-structured map.
 *
 * Nodes are linked into a tree by `parentNodeId` (undefined for the
 * root) and grouped by `mindMapId` so the auto-layout knows which
 * nodes belong together. Each node is its own WhiteboardObject so
 * standard selection / drag / undo all work; the auto-layout sits
 * on top, repositioning every node in a mind map whenever any
 * node's children change.
 *
 * Edges (parent → child curves) are NOT stored — they're rendered
 * procedurally by `<MindMapEdges>` from the parent/child relationship.
 * That way deleting a parent automatically deletes the visual edges
 * and there's no edge-state to keep in sync.
 *
 * `collapsed: true` hides every descendant node (and their edges)
 * without deleting them; the renderer skips drawing collapsed
 * subtrees, and the layout skips computing them.
 */
export interface WhiteboardMindMapNode extends WhiteboardObjectBase {
  type: "mindMapNode";
  text: string;
  /** Undefined for the root node of a mind map. */
  parentNodeId?: string;
  /** Ties every node in the same mind map together for layout. */
  mindMapId: string;
  /** When true, hide descendants. */
  collapsed?: boolean;
  /** Optional accent colour for the node border + edge stroke.
   * Defaults to the canvas accent. */
  color?: string;
}

/**
 * Named diagram shape — a styled box with an icon + label slot,
 * meant for visually-distinctive diagram nodes (database, server,
 * cloud, decision-gateway, etc.) that the generic rect/ellipse
 * primitives can't capture.
 *
 * `kind` identifies which icon + visual treatment to apply. The
 * library is small (8 kinds) but covers the common architecture-
 * diagram vocabulary. Extending it later is a 1-line registry
 * addition.
 *
 * `label` is the user-editable text shown beside / under the icon.
 * Inline edit reuses the same textarea pattern as sticky/shape edit.
 */
export interface WhiteboardDiagramShape extends WhiteboardObjectBase {
  type: "diagramShape";
  /** Which named diagram shape this is. See DIAGRAM_SHAPE_KINDS in
   * the renderer for the canonical list. */
  kind: string;
  label: string;
  fill?: string;
  stroke?: string;
}

/** Phase 27 — voting/estimation widget. */
export interface WhiteboardVoting extends WhiteboardObjectBase {
  type: "voting";
  question: string;
  /** Bidirectional with Story.points when sourceRef points at a story. */
  storyId?: string;
  /** Vote tally keyed by user id → choice. Anonymous display until
   * `revealed` flips true; cleared on reset. */
  votes: Record<string, string>;
  /** Vote options, in display order. For Planning Poker: ["1","2","3","5","8","13","?","☕"]. */
  options: string[];
  /** When false, render hidden tallies; flip to true to reveal everyone's vote. */
  revealed: boolean;
}

export type WhiteboardObject =
  | WhiteboardSticky
  | WhiteboardShape
  | WhiteboardLine
  | WhiteboardConnector
  | WhiteboardText
  | WhiteboardFreehand
  | WhiteboardImage
  | WhiteboardFrame
  | WhiteboardEmbed
  | WhiteboardCard
  | WhiteboardKanbanFrame
  | WhiteboardTimer
  | WhiteboardVoting
  | WhiteboardTable
  | WhiteboardMindMapNode
  | WhiteboardDiagramShape;

export interface Whiteboard {
  id: string;
  name: string;
  defaultCamera?: { x: number; y: number; zoom: number };
  template?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WhiteboardComment {
  id: string;
  author: string;
  text: string;
  at: ISODateString;
  /** @mention TeamMember ids referenced in this comment. Surfaces in
   * the cross-tool notification stream via the
   * `whiteboard.commentMentioned` signal. */
  mentions?: string[];
}

export interface WhiteboardCommentThread {
  id: string;
  boardId: string;
  /** When pinned to an object. */
  objectId?: string;
  /** Anchor point in world coords. */
  x: number;
  y: number;
  resolved?: boolean;
  comments: WhiteboardComment[];
}

export interface WhiteboardGroup {
  id: string;
  boardId: string;
  label?: string;
}

/** Saved-as-template — a snapshot of board objects keyed by id,
 * accumulated by a workspace so teams can re-apply their own agile
 * patterns. Phase 31. */
export interface WhiteboardSavedTemplate {
  id: string;
  name: string;
  description?: string;
  /** Category for grouping in the gallery: "retro" / "planning" /
   * "strategy" / "custom" / etc. */
  category?: string;
  /** Snapshot of objects with boardId/id stripped (caller assigns
   * fresh values on apply). */
  objects: WhiteboardObject[];
  createdAt: ISODateString;
  createdBy?: string;
}

// ── Ceremonies (squad S3) ───────────────────────────────────────────
/** One cross-team coordination entry in the Scrum of Scrums log. */
export interface SosEntry {
  id: string;
  meetingDate: ISODateString;
  team: string;
  kind: "blocker" | "dependency" | "decision" | "update";
  text: string;
  blockedBy?: string;
  status: "open" | "resolved";
  resolvedAt?: ISODateString;
  /** Creation timestamp — drives stable newest-first ordering now that
   *  entries live in the insertion-ordered workspace store rather than a
   *  prepend-ordered local array. */
  loggedAt: ISODateString;
}

/** One member's async daily standup update. */
export interface AsyncUpdate {
  id: string;
  member: string;
  /** YYYY-MM-DD (local). */
  date: ISODateString;
  yesterday: string;
  today: string;
  blockers?: string;
  description?: string;
}

/** How a standup entry was given: in the live meeting, or posted async. */
export type StandupMode = "live" | "async";

/**
 * One member's daily standup entry. The live standup and the async
 * standup share these (`mode`); the async tool's older `AsyncUpdate` rows
 * are read alongside them (lib/standup/entries.ts).
 */
export interface StandupEntry {
  id: string;
  member: string;
  /** YYYY-MM-DD (local). */
  date: ISODateString;
  yesterday: string;
  today: string;
  blockers: string;
  /** Epoch ms the entry (and its blocker) was first raised. Preserved
   *  across edits so blocker-age analytics don't reset. */
  timestamp: number;
  /** True once this entry's blocker has been marked resolved. Folds in the
   *  old standalone resolvedBlockers[] list from the isolated store. */
  blockerResolved?: boolean;
  /** Where this entry's blocker was sent (e.g. raised as an impediment). */
  sentTo?: HandoffLink[];
  /** Absent: live (every entry from before async posts moved here). */
  mode?: StandupMode;
  /** Anything else the person added (async posts). */
  description?: string;
  /*
   * The tools plan's phase 2 (P2.9): Progress/Plans/Problems, a DRI per
   * blocker and a hand-over between time zones.
   */
  /** Absent: classic (yesterday, today, blockers). */
  format?: StandupFormat;
  /** Who is directly responsible for the blocker (at most 120 characters). */
  blockerDri?: string;
  /** A hand-over to the next time zone (at most 4,000 characters). */
  handoff?: string;
}

/** A standup's format: classic (yesterday, today, blockers) or Progress/Plans/Problems. */
export const STANDUP_FORMATS = ["classic", "ppp"] as const;
export type StandupFormat = (typeof STANDUP_FORMATS)[number];

/** A demo item in a sprint review's demo script. */
export interface DemoFeature {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string;
  timeMinutes: number;
}

export type FeedbackCategory = "positive" | "concern" | "suggestion";

/** One piece of stakeholder feedback captured during a sprint review. */
export interface FeedbackItem {
  id: string;
  stakeholder: string;
  feedback: string;
  category: FeedbackCategory;
  /** Where it was sent (a backlog story). */
  sentTo?: HandoffLink[];
}

/** A showcase-prep checklist item. */
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

/** A sprint review session — a document holding its demo script, stakeholder
 *  feedback, showcase checklist, and velocity summary. The tool is a
 *  singleton, so there is normally one row under a fixed id. */
export interface SprintReview {
  id: string;
  /** The sprint this review is for: its document is
   *  `sprint-review:sprint:<sprintId>` (lib/sprints/review-doc.ts). Absent
   *  on the draft, `sprint-review:current`. */
  sprintId?: string;
  sprintName: string;
  sprintNumber: string;
  features: DemoFeature[];
  meetingDate: string;
  feedbackItems: FeedbackItem[];
  checklistItems: ChecklistItem[];
  committed: number;
  completed: number;
  totalBacklog: number;
  backlogDone: number;
}

/** One card on a retrospective board. */
export interface RetroCard {
  id: string;
  columnKey: string;
  text: string;
  votes: number;
  /** id of the parent card when grouped, else null. */
  groupedWith: string | null;
  isActionItem: boolean;
  assignee: string;
  discussing: boolean;
  /** Where this action was sent (an impediment, a Kanban card, a story). */
  sentTo?: HandoffLink[];
  /** Id of the previous retro's card this action was carried over from. */
  carriedFrom?: string;
  /** The action is done (set in Retro Actions, or by the agent). */
  done?: boolean;
  doneAt?: ISODateString;
  /** When the action is due, YYYY-MM-DD. */
  dueDate?: ISODateString;
  /** The item this was sent from (a red health check, a kudos). */
  sourceRef?: HandoffRef;
  /**
   * The sprint day it happened, 0-based like `SprintDay.day` (0 is the first
   * day), at most RETRO_CARD_DAY_MAX: an Emotional Seismograph board charts
   * its cards by day.
   */
  day?: number;
}

/** The latest sprint day a retro card can be placed on (0-based). */
export const RETRO_CARD_DAY_MAX = 30;

/** A retrospective board — a singleton document (one current retro under a
 *  fixed id) holding the format, phase, cards, and timer state. Starting a
 *  new retro copies the finished one to its own id with `archivedAt` set. */
export interface RetroBoard {
  id: string;
  format: RetroFormat;
  phase: "write" | "vote" | "discuss" | "actions";
  cards: RetroCard[];
  userVotes: number;
  timerSeconds: number;
  timerRunning: boolean;
  discussingIndex: number;
  /** ISO time the retro was archived; absent on the current board. */
  archivedAt?: string;
  /** The archived retro this one follows, for carrying its actions over. */
  previousRetroId?: string;
  /** Facilitator mode: votes cast per participant (name → count), so each
   *  person gets their own budget on a shared screen. `userVotes` stays the
   *  single-voter count. */
  votesBy?: Record<string, number>;
  /** Votes each person has ("Votes each"); absent means 3, as on every
   *  board from before the setting (lib/retro/board.ts `retroVotes`). */
  votesPerPerson?: 3 | 5 | 8;
  /** The sprint this retro looks back on (Sprint.id). Absent on boards from
   *  before retros were per sprint: the cockpit then places the retro by its
   *  archive date (lib/retro/board.ts). Archived copies keep it. */
  sprintId?: string;
}

// ── Sprint Planning (squad S1) ───────────────────────────────────────
/** One acceptance criterion on a sprint goal. */
export interface AcceptanceCriterion {
  id: string;
  text: string;
  relevantChecked: boolean;
}

/** The Sprint Goal builder's state — a singleton document (one current goal
 *  under a fixed id): business objective, the goal statement, acceptance
 *  criteria, and key results. */
export interface SprintGoal {
  id: string;
  businessObjective: string;
  goal: string;
  criteria: AcceptanceCriterion[];
  keyResults: string[];
  /** The sprint this goal is for; its `goal` is mirrored to `Sprint.goal`.
   *  Absent on the `sprint-goal:current` draft. */
  sprintId?: string;
  /** Linked OKR ids, instead of key results copied into the goal. */
  okrIds?: string[];
  /** Whether the sprint met its goal, answered when it ends (Sprint Review reads it). */
  outcome?: SprintGoalOutcome;
}

/** The team's answer to "Did we meet the sprint goal?" */
export interface SprintGoalOutcome {
  met: "met" | "partly" | "not-met";
  note?: string;
  decidedAt: ISODateString;
}

/** A Jobs-to-be-Done job story: "When <situation>, I want to <motivation>,
 *  so I can <outcome>." parentJobId builds the job hierarchy. */
export interface JobStory {
  id: string;
  situation: string;
  motivation: string;
  outcome: string;
  parentJobId?: string;
  description?: string;
  /** The Opportunity Tree node this job serves (a node of kind "opportunity"). */
  opportunityId?: string;
}

/** A capacity-planner team member. Distinct from the lean workspace
 *  TeamMember — carries sprint-capacity fields (availability, daysOff). */
export interface CapacityMember {
  id: string;
  name: string;
  role: string;
  description?: string;
  /** 0–100 percent. */
  availability: number;
  daysOff: number;
  /** The roster member (workspace teamMembers) this row is for. */
  teamMemberId?: string;
}

/** Sprint configuration for a capacity plan. */
export interface CapacityConfig {
  sprintDays: number;
  /** 0–100 percent. */
  ceremonyOverhead: number;
  /** 0–1. */
  focusFactor: number;
  hoursPerDay: number;
  /** Planned commitment in points, stored as a string so the input can be
   *  cleared without coercing to NaN/0 mid-edit. */
  pointsCommitted: string;
}

/** The capacity planner's state — a singleton document (one plan under a
 *  fixed id): the team members and the sprint config. */
export interface CapacityPlan {
  id: string;
  members: CapacityMember[];
  config: CapacityConfig;
  /** The sprint this plan is for. Absent on the `capacity-planner:current`
   *  fallback plan (lib/sprints/capacity: capacityPlanIdFor). */
  sprintId?: string;
}

/** A card on the story map. */
export interface StoryMapCard {
  id: string;
  title: string;
  description: string;
  color: string;
  /** Planning Poker's estimate, written back when the story is estimated. */
  estimate?: string;
  sentTo?: HandoffLink[];
}

/** A horizontal release slice; `cards` is keyed by step id. */
export interface StoryMapSlice {
  id: string;
  name: string;
  cards: Record<string, StoryMapCard[]>;
}

/** A user-activity step (column header) on the story map. */
export interface StoryMapStep {
  id: string;
  name: string;
}

/** The story map — a singleton document (one map under a fixed id): the
 *  steps (columns) and slices (rows) of the steps × slices grid. */
export interface StoryMap {
  id: string;
  steps: StoryMapStep[];
  slices: StoryMapSlice[];
}

/** How often a RICE reach count happens: the people reached per week, month,
 *  quarter or year. The score normalises reach to per quarter, so items with
 *  different periods compare. */
export type ReachPeriod = "week" | "month" | "quarter" | "year";

export const REACH_PERIODS = [
  "week",
  "month",
  "quarter",
  "year",
] as const satisfies readonly ReachPeriod[];

/**
 * A backlog item scored across the prioritizer's four embedded methods
 * (MoSCoW, WSJF, RICE, Value vs Effort).
 *
 * Every method input is optional: a missing one is Not scored, never a
 * mid-range default (Phase 7). Items saved before then carry the old "Add
 * item" defaults (moscow "should"; WSJF parts all 5; RICE reach 100, impact
 * 1, confidence 80, effort 1; value 5 and matrixEffort 5); a method whose
 * every field still equals its old default reads as Not scored (the
 * fingerprint rule in lib/prioritization), and the next save through the
 * new code unsets them, never a bulk write on load.
 */
export interface BacklogItem {
  id: string;
  name: string;
  description?: string;
  /** MoSCoW bucket; absent: Not sorted yet (no default bucket). */
  moscow?: "must" | "should" | "could" | "wont";
  /**
   * THE value of the item, on WSJF's modified Fibonacci scale (1, 2, 3, 5,
   * 8, 13, 20): WSJF's user-business value and the Value/Effort matrix's
   * value axis (high value = 8 or more). Absent: Not scored, unless a
   * legacy `value` is there to read.
   */
  businessValue?: number;
  /** WSJF time criticality, Fibonacci 1–20. */
  timeCriticality?: number;
  /** WSJF risk reduction / opportunity enablement (a row's `rrOe`), Fibonacci 1–20. */
  riskReduction?: number;
  /** WSJF job size, Fibonacci 1–20 (floor 1: a legacy 0 < size < 1 scores as 1). */
  jobSize?: number;
  /** RICE reach: people (or events) per `reachPeriod`. */
  reach?: number;
  /** The period `reach` counts over; absent: per quarter (what the hub's
   *  Reach always meant). */
  reachPeriod?: ReachPeriod;
  /** RICE impact. The steps are 3 massive, 2 high, 1 medium, 0.5 low and
   *  0.25 minimal; an exact custom value is kept (no snapping). */
  impact?: number;
  /** RICE confidence, percent (100 high, 80 medium, 50 low). */
  confidence?: number;
  /** RICE effort, person-months; minimum 0.5 (a legacy smaller value scores as 0.5). */
  effort?: number;
  /**
   * @deprecated Read-only legacy: the Value/Effort matrix's 1–10 value from
   * before the one value field. Read only when `businessValue` is missing,
   * mapped to the nearest Fibonacci step at or above it (1→1, 2→2, 3→3,
   * 4–5→5, 6–8→8, 9–10→13); never written again.
   */
  value?: number;
  /** Value/Effort matrix effort, 1–10 (high effort = 6 or more). */
  matrixEffort?: number;
  /**
   * The decided order: 1-based, unique among ranked items, set only by the
   * Prioritizer's Decide order. Absent: Not ordered yet (new items stay
   * unranked until the next Decide order).
   */
  rank?: number;
  /** When the item was last saved (stamped by the code that writes it). */
  updatedAt?: ISODateString;
}

// ── Outcomes & Pulse (squad S6) ──────────────────────────────────────
/** At most this many theme tags on one survey response. */
export const NPS_TAG_LIMIT = 10;
/** The longest theme tag on a survey response. */
export const NPS_TAG_MAX_LENGTH = 40;

/** One NPS or CSAT survey response. */
export interface NpsResponse {
  id: string;
  kind: "nps" | "csat";
  /**
   * YYYY-MM-DD, the day the answer was given, on every write since Phase 8.
   * A row saved before may hold a blank or free-text date (the page saved
   * what its field held), kept until a write sets it: read it as undated.
   */
  date: ISODateString;
  /**
   * A whole number: NPS 0–10, CSAT 1–5 (≥ 4 counts as satisfied), on every
   * write since Phase 8. A row saved before may hold a fraction or a value
   * off the scale (the page clamped, never rounded), kept until a write
   * sets it.
   */
  score: number;
  respondent?: string;
  verbatim?: string;
  /**
   * Theme tags on the verbatim ("pricing", "onboarding"): lower-case and
   * unique, at most NPS_TAG_LIMIT of up to NPS_TAG_MAX_LENGTH characters.
   * Absent: not tagged.
   */
  tags?: string[];
}

/** One daily team-mood data point for a member (1 rough … 5 great). */
export interface MoodEntry {
  id: string;
  memberId: string;
  date: ISODateString;
  score: 1 | 2 | 3 | 4 | 5;
  note?: string;
  /** True when created note-first before a face was picked; excluded from
   *  averages/trend until a real score lands. */
  isPlaceholder?: boolean;
  /** When it was entered (ISO), for a day filled in afterwards; `date` is the
   *  day it is for. Absent on entries logged on the day. */
  loggedAt?: ISODateString;
}

/**
 * One anonymous team mood pulse: how many people picked each face on a day,
 * from a vote room or typed in by the facilitator. Only the counts are kept,
 * never who answered; a person's own named check-in is a `MoodEntry`.
 */
export interface MoodPulse {
  /** "moodPulse_<nanoid(8)>". */
  id: string;
  /** YYYY-MM-DD the pulse is for (can be backdated). */
  date: ISODateString;
  /** How many picked each face, 1 rough … 5 great. */
  counts: Record<1 | 2 | 3 | 4 | 5, number>;
  source: "room" | "facilitator";
  createdAt: ISODateString;
}

/** The mood tracker's one document id. */
export const MOOD_TRACKER_ID = "moodTracker:current";

/**
 * The `user_entities` kinds the mood settings and the anonymous pulses sync
 * under, for server-side code (tool.mood_tracker.*, the retro and sprint
 * comparison loaders). They are what kindFromToolId derives from
 * workspace.mood_tracker_doc and workspace.mood_pulse and what the store
 * registers; a kind that differs is one the browser never syncs.
 */
export const MOOD_TRACKER_KIND = "workspace:moodTrackerDoc";
export const MOOD_PULSE_KIND = "workspace:moodPulse";

/** A run of low team-mood days, and where it was sent. */
export interface MoodStreak {
  /** YYYY-MM-DD, first and last day of the run. */
  start: ISODateString;
  end: ISODateString;
  sentTo?: HandoffLink[];
}

/** The mood tracker's settings: how the team checks in, and low-mood runs sent on. */
export interface MoodTrackerDoc {
  id: string;
  /** "named": each person logs their own check-in; "anonymous": team pulses only. */
  mode: "named" | "anonymous";
  /** Low-mood streaks that went to the retro (keyed by their start day). */
  streaks?: MoodStreak[];
}

export type KanbanColumnId = "backlog" | "ready" | "in_progress" | "review" | "done";
export type KanbanClassOfService = "standard" | "expedite" | "fixed_date" | "intangible";

/** One card on the kanban board. */
export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  column: KanbanColumnId;
  class: KanbanClassOfService;
  createdAt: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  /** The item this was sent from (e.g. a retro action). */
  sourceRef?: HandoffRef;
  /** Who is working on it. */
  assignee?: string;
  /** Flagged as blocked. */
  blocked?: boolean;
  /** When it entered its current column, for its age there. */
  columnSince?: ISODateString;
  /** Column moves, oldest first; only the latest `KANBAN_HISTORY_CAP`
   *  (lib/kanban/flow.ts) are kept. Absent on cards from before it. */
  history?: KanbanColumnChange[];
  /** What kind of work it is (see `Story.workType`). */
  workType?: WorkType;
  /** Whether it adds value or is failure demand (see `Story.demand`). */
  demand?: WorkDemand;
  /** Its blocked spells, oldest first, stamped by lib/flow/block-stamps; at
   *  most TOOL_LIST_MAX.blockLog are kept. */
  blockLog?: BlockSpell[];
}

/** One move of a Flow-board card, as `movedCard` (lib/kanban/flow.ts) records it. */
export interface KanbanColumnChange {
  column: KanbanColumnId;
  from?: KanbanColumnId;
  at: ISODateString;
}

/** The kanban board — a singleton document (cards + per-column WIP limits). */
export interface KanbanBoard {
  id: string;
  cards: KanbanCard[];
  wipLimits: Record<KanbanColumnId, number>;
}

/** A node in the dependency graph (a team / workstream / deliverable). */
export interface DependencyNode {
  id: string;
  label: string;
  description?: string;
  team?: string;
  /** The item this was sent from (a Scrum of Scrums dependency). */
  sourceRef?: HandoffRef;
}

/** Where a dependency stands. Absent on edges drawn before it existed: read as "open". */
export type DependencyStatus = "open" | "at-risk" | "resolved";

/**
 * A directed dependency edge between two nodes — the one dependency model:
 * Dependency Map draws it, PI Planning and Scrum of Scrums create and
 * resolve it (they used to keep their own dependency items).
 */
export interface DependencyEdge {
  id: string;
  from: string;
  to: string;
  kind: "blocks" | "needs" | "informs";
  /** The item this was sent from, when a hand-off drew the edge. */
  sourceRef?: HandoffRef;
  status?: DependencyStatus;
  /** Who chases it (a roster name). */
  owner?: string;
  /** When it must be resolved by (YYYY-MM-DD). */
  due?: ISODateString;
  note?: string;
  resolvedAt?: ISODateString;
}

/** The dependency map — a singleton graph document (nodes + edges). */
export interface DependencyMap {
  id: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/** One stage in a value-stream map. processTime + leadTime in the same unit
 *  (typically days); completeAccurate is the %C/A (0–100) handed downstream. */
export interface ValueStreamStage {
  id: string;
  name: string;
  description?: string;
  processTime: number;
  leadTime: number;
  completeAccurate: number;
  /** Position in its map, 0 first; absent on stages saved before reordering
   *  (they keep their stored order, after the numbered ones). */
  order?: number;
  /** Which map it belongs to; absent reads as "current". */
  state?: ValueStreamState;
}

export type ValueStreamState = "current" | "future";

/* ── Health dashboard settings (singleton) ── */

/** The health dashboard's one settings document id. */
export const HEALTH_DASHBOARD_ID = "healthDashboard:current";

/** Where a KPI turns amber and red. Whether higher is better is the KPI's own. */
export interface KpiThreshold {
  /** Green up to (or, for a higher-is-better KPI, from) here. */
  green: number;
  /** Amber up to (or from) here; beyond is red. */
  amber: number;
}

/** The team's health dashboard settings: thresholds and the windows the KPIs read. */
export interface HealthDashboardConfig {
  id: string;
  /** Per KPI id (lib/health-dashboard); a KPI left out uses the default. */
  thresholds?: Record<string, KpiThreshold>;
  /** Pointed sprints predictability looks at. */
  sprintWindow?: number;
  /** Days a standup blocker stays recent. */
  blockerWindowDays?: number;
  /** Days of finished work cycle time looks at. */
  cycleWindowDays?: number;
  updatedAt?: ISODateString;
}

/* ── Feature flags ── */

export type FeatureFlagStatus = "on" | "off" | "retired";
export type FeatureFlagPurpose = "rollout" | "experiment" | "kill_switch" | "permission";
export type FeatureFlagEnv = "dev" | "staging" | "prod" | "all";

/** A feature flag the team tracks until it is removed from the code. */
export interface FeatureFlag {
  id: string;
  name: string;
  owner?: string;
  status: FeatureFlagStatus;
  purpose: FeatureFlagPurpose;
  environment?: FeatureFlagEnv;
  /** YYYY-MM-DD; editable, so an older flag can be backdated. */
  createdAt: string;
  /** The day the team plans to remove it (YYYY-MM-DD). */
  removeBy?: string;
  /** Set when retired (YYYY-MM-DD); absent on a legacy retirement with no date. */
  retiredAt?: string;
  /** The Release Readiness release it ships behind. */
  releaseId?: string;
  description?: string;
  sentTo?: HandoffLink[];
}

// ──────── S4 — Team Health & Maturity (singleton docs) ────────

/** Edmondson 7-question psychological-safety instrument. q1/q3/q5 are reversed. */
export type PsychSafetyQuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7";

export interface PsychSafetyResponse {
  id: string;
  ts: string; // ISO timestamp
  scores: Record<PsychSafetyQuestionId, number>; // 1-5 raw Likert
  respondent?: string;
  description?: string;
}

/** The psych-safety tool's one document id. */
export const PSYCH_SAFETY_ID = "psychSafety:current";

/** How many answered 1, 2, 3, 4 and 5 to one question, raw (not reversed). */
export type PsychSafetyCounts = [number, number, number, number, number];

/**
 * One survey round, as counts per question: from a vote room, typed in by
 * the facilitator, or folded from the per-response list the tool kept
 * before rounds ("legacy"). A round holds counts only, nothing per person.
 */
export interface PsychSafetyRound {
  /** "psRound_<nanoid(8)>". */
  id: string;
  name: string;
  /** YYYY-MM-DD the round was taken (can be backdated, never in the future). */
  date: ISODateString;
  sprintId?: string;
  source: "room" | "facilitator" | "legacy";
  /** How many people answered. */
  responses: number;
  counts: Record<PsychSafetyQuestionId, PsychSafetyCounts>;
  createdAt: ISODateString;
  /** Where the round's lowest question was sent (a retro topic). */
  sentTo?: HandoffLink[];
}

export interface PsychSafetyLog {
  id: string;
  /** The per-response list from before rounds. Nothing moves it into
   *  `rounds`: `roundsOf` reads it, counts only, as one read-only "legacy"
   *  round, and it is emptied only when the team deletes that round (the
   *  deprecated tool.psych_safety.remove_response still drops one sheet).
   *  New answers are kept only as `rounds`. */
  responses: PsychSafetyResponse[];
  /** Saved rounds, oldest first. */
  rounds?: PsychSafetyRound[];
}

/** One saved, dated maturity assessment. */
export interface MaturityAssessmentEntry {
  id: string;
  /** YYYY-MM-DD it was taken (can be backdated, never in the future). */
  assessedAt: ISODateString;
  /** All 8 dimensions, 1-5. */
  scores: Record<string, number>;
  targetLevel?: number;
  note?: string;
}

/**
 * Agile Maturity Assessment — 8 dimensions scored 1-5 + an improvement target.
 * The team's maturity level (`Workspace.maturityLevel`) comes from the latest
 * saved entry in `history`; with none, the team is unassessed.
 */
export interface MaturityAssessment {
  id: string;
  /** The draft being scored (dimensionId -> level 1-5); a missing dimension
   *  is not scored. A legacy doc with scores and no history is an undated
   *  draft, never counted as an assessment. */
  scores: Record<string, number>;
  targetLevel: number;
  /** Saved assessments, oldest first. */
  history?: MaturityAssessmentEntry[];
}

/** Spotify-model squad health check dimensions (single source for client + actions). */
export const HEALTH_CHECK_DIMENSIONS = [
  "Delivering Value",
  "Easy to Release",
  "Fun",
  "Health of Codebase",
  "Learning",
  "Mission",
  "Speed",
  "Teamwork",
] as const;
export type HealthDimension = (typeof HEALTH_CHECK_DIMENSIONS)[number];
export type HealthTrafficLight = "green" | "yellow" | "red";
export type HealthTrend = "up" | "same" | "down";

/** The health check's one document id. */
export const HEALTH_CHECK_ID = "healthCheck:current";

/** How many people voted each light for a dimension (anonymous counts only). */
export interface HealthVotes {
  green: number;
  yellow: number;
  red: number;
}

/** A dimension the team added to the eight built-in ones. */
export interface HealthCustomDimension {
  /** "custom-<nanoid(8)>": the key its lights use in `customScores`. */
  id: string;
  name: string;
  description?: string;
  /** Hidden from new checks; saved checks keep its lights. */
  archived?: boolean;
}

export interface HealthDimensionScore {
  light: HealthTrafficLight;
  /** Stamped at save from the previous saved check, not picked by hand. */
  trend: HealthTrend;
  /** The vote counts the light came from, when the team voted. */
  votes?: HealthVotes;
  /** What the team said about it (up to 500 characters). */
  note?: string;
  /** Where this dimension went (a red sent to the retro as a topic). */
  sentTo?: HandoffLink[];
}

export interface HealthCheckSnapshot {
  sprintName: string;
  scores: Record<HealthDimension, HealthDimensionScore>;
  /** The sprint this check is for. */
  sprintId?: string;
  /** YYYY-MM-DD to save it under (backdated; never in the future); absent: the day it is saved. */
  date?: ISODateString;
  /** Dimension keys rated in this draft (built-in names and custom ids).
   *  Absent on older drafts, which read yellow and red as rated, green not. */
  rated?: string[];
  /** Lights for custom dimensions, by `HealthCustomDimension.id`. */
  customScores?: Record<string, HealthDimensionScore>;
  /** How the lights were set: a vote room, or by the facilitator. */
  source?: "room" | "facilitator";
  /** How many people voted, for a room round. */
  responses?: number;
}

export interface HealthCheckEntry {
  id: string;
  sprintName: string;
  date: string;
  scores: Record<HealthDimension, HealthDimensionScore>;
  /** The sprint it was for (matched before the sprint name). */
  sprintId?: string;
  /** Lights for custom dimensions, by `HealthCustomDimension.id`. */
  customScores?: Record<string, HealthDimensionScore>;
  source?: "room" | "facilitator";
  responses?: number;
}

/** One synced squad-health-check document: the in-progress check + saved history. */
export interface HealthCheck {
  id: string;
  current: HealthCheckSnapshot;
  history: HealthCheckEntry[];
  /** Dimensions the team added, archived ones included. */
  customDimensions?: HealthCustomDimension[];
}

export type SkillProficiency = 0 | 1 | 2 | 3 | 4;
// Named SkillsMatrix* to avoid clashing with the workspace's own TeamMember.
export interface SkillsMatrixMember {
  id: string;
  name: string;
  description?: string;
}
export interface SkillsMatrixSkill {
  id: string;
  name: string;
  description?: string;
  /** People needed at `targetLevel` or above; unset = no target. */
  targetPeople?: number;
  /** The level the target counts from. Default 2 (handles routine work alone). */
  targetLevel?: 2 | 3 | 4;
}
/** skillId -> column id (a TeamMember.id, or a legacy member id) -> level.
 *  A missing key is Not rated; 0 is rated None (on a version 2 doc). */
export type SkillsMatrixGrid = Record<string, Record<string, SkillProficiency>>;

/** One cross-training pair: who learns a skill, from whom, up to which level. */
export interface SkillsTrainingPair {
  id: string;
  skillId: string;
  /** Column id of the learner. */
  learnerId: string;
  /** Column id of the mentor; unset = outside help. */
  mentorId?: string;
  toLevel: 2 | 3 | 4;
  createdAt: ISODateString;
  /** YYYY-MM-DD it should be done by. */
  due?: ISODateString;
  /** YYYY-MM-DD it was done. */
  doneAt?: ISODateString;
}

export interface SkillsMatrix {
  id: string;
  /** Legacy tool-local people; columns now come from the roster. */
  members: SkillsMatrixMember[];
  skills: SkillsMatrixSkill[];
  grid: SkillsMatrixGrid;
  /** 2 once the grid tells Not rated (missing) from None (0). Absent on
   *  older docs, whose 0s read as Not rated. */
  version?: 2;
  /** Cross-training pairs, oldest first. */
  training?: SkillsTrainingPair[];
}

/** A matrix with nothing in it yet (version 2: a 0 means rated None). */
export function emptySkillsMatrix(id: string): SkillsMatrix {
  return { id, members: [], skills: [], grid: {}, version: 2 };
}

/* ── Definition of Done (singleton) ──
 * A workspace document, so stories, Release Readiness, the charter, next
 * steps and agents read the same one. The DoD builder's own cloud blob
 * ("agile-toolkit:dod-builder") moves in once and stays as the backup. */

/** The Definition of Done's one document id. */
export const DOD_DOC_ID = "definitionOfDone:current";

/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const DOD_KIND = "workspace:definitionOfDone";

export type DodCategory = "code" | "testing" | "docs" | "performance" | "security" | "other";

export interface DodCriterion {
  id: string;
  label: string;
  description?: string;
  category: DodCategory;
  /** A story meets the DoD when every required criterion is ticked. */
  required: boolean;
  /** @deprecated The team-level tick from before Phase 6. Release Readiness
   *  falls back to it only for a release with no linked stories. */
  done?: boolean;
}

/** A sprint's DoD tally from before Phase 6 (read-only history). */
export interface DodSnapshot {
  sprintName: string;
  totalRequired: number;
  completed: number;
  ts: string;
}

export interface DefinitionOfDone {
  id: string;
  items: DodCriterion[];
  /** Pre-Phase-6 snapshots, read-only. */
  history: DodSnapshot[];
}

/* ── RACI matrix (singleton) ──
 * A workspace document, so it syncs and agents and next steps can read and
 * write it. The tool's local-only store ("agile-toolkit:raci") moves in once. */

/** The RACI matrix's one document id. */
export const RACI_ID = "raciMatrix:current";

/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const RACI_KIND = "workspace:raciMatrix";

export type RaciLetter = "R" | "A" | "C" | "I";

/** A column of the matrix: one person, or a group role. */
export interface RaciRole {
  id: string;
  name: string;
  description?: string;
  /** TeamMember.id when the column is one roster person; absent for a group
   *  role such as "Dev Team". */
  memberId?: string;
}

export interface RaciActivity {
  id: string;
  name: string;
  description?: string;
}

export interface RaciMatrix {
  id: string;
  roles: RaciRole[];
  activities: RaciActivity[];
  /** Activity id → role id → letters, normalised to [], [R], [A], [A, R],
   *  [C] or [I]. A missing cell is empty. */
  cells: Record<string, Record<string, RaciLetter[]>>;
}

/* ── ADKAR change initiatives (singleton) ──
 * A workspace document, so next steps and agents can read it. The tool's own
 * blob ("agile-toolkit:adkar", a bare list of initiatives) moves in once. */

/** Prosci ADKAR elements, in the order a change moves through them. */
export const ADKAR_ELEMENTS = [
  "awareness",
  "desire",
  "knowledge",
  "ability",
  "reinforcement",
] as const;
export type AdkarElement = (typeof ADKAR_ELEMENTS)[number];
export type AdkarScore = 1 | 2 | 3 | 4 | 5;

/** A group affected by the change, scored per element by the facilitator. */
export interface AdkarGroup {
  id: string;
  name: string;
  /** A missing element is not scored. */
  scores: Partial<Record<AdkarElement, AdkarScore>>;
  /** YYYY-MM-DD the scores were taken. */
  assessedAt?: ISODateString;
  note?: string;
}

/** The day an initiative entered a stage. */
export interface AdkarStageEntry {
  stage: AdkarElement;
  /** YYYY-MM-DD. */
  enteredAt: ISODateString;
}

export interface AdkarInitiative {
  id: string;
  name: string;
  owner?: string;
  /** YYYY-MM-DD. */
  startDate: ISODateString;
  description?: string;
  currentStage: AdkarElement;
  /** Legacy; derived from `currentStage` from now on. */
  stagesCompleted?: AdkarElement[];
  /** Oldest first; entry 0 is { awareness, startDate }. */
  stageHistory: AdkarStageEntry[];
  groups?: AdkarGroup[];
}

/** The ADKAR tool's one document id. */
export const ADKAR_DOC_ID = "adkar:current";

/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const ADKAR_KIND = "workspace:adkarDoc";

export interface AdkarDoc {
  id: string;
  initiatives: AdkarInitiative[];
}

/**
 * Planning Poker — the live session is realtime-only (no persistence), but
 * committed final estimates are recorded here so they survive + are agent-
 * readable. One PokerEstimationLog singleton holding the estimate history.
 */
export interface PokerEstimate {
  id: string;
  storyTitle: string;
  finalEstimate: string;
  scaleType: string; // "fibonacci" | "tshirt" | "custom" (the tool's ScaleType)
  votes?: string[]; // raw revealed votes that led to the estimate, if known
  decidedAt: ISODateString;
  /** The story this estimated, when it came from another tool's queue. */
  sourceRef?: HandoffRef;
  /**
   * The session story the estimate was accepted for, when it came from the
   * queue. The queue forgets the story once it is estimated, so this is how
   * the session's rows are tied back to `sourceRef` afterwards (the CSV's
   * ticket key). Absent on estimates logged before it was kept.
   */
  sessionStoryId?: string;
}

/** A story another tool sent for estimation, waiting for a Poker session. */
export interface PokerQueueItem {
  id: string;
  title: string;
  description?: string;
  sourceRef: HandoffRef;
  queuedAt: ISODateString;
  /** The session story it became, so the estimate can be written back. */
  sessionStoryId?: string;
}

export interface PokerEstimationLog {
  id: string;
  estimates: PokerEstimate[];
  /** Stories waiting to be estimated (sent from Story Mapper and others). */
  queue?: PokerQueueItem[];
}

/**
 * Planning Poker — a single agent-drivable estimation ROUND (server-persisted),
 * parallel to the realtime human session. One PokerRound singleton: when
 * `storyTitle` is null the board is idle; start_round opens a round, cast_vote
 * collects blind votes, reveal flips `revealed`, commit_round writes a
 * PokerEstimate to the log and returns the board to idle.
 */
export interface PokerRoundVote {
  participant: string;
  card: string;
  at: ISODateString;
}

export interface PokerRound {
  id: string;
  storyTitle: string | null; // null ⇒ no active round (idle board)
  scaleType: string; // "fibonacci" | "tshirt" | "custom"
  votes: PokerRoundVote[];
  revealed: boolean;
  startedAt: ISODateString | null;
}

/* ── Phase 42: the tools plan's phase 1 ───────────────────────────────
 * Parking Lot, Root Cause, Product Goal, Interrupt Buffer, the Scrum Master
 * Notebook and Meeting Audit keep their records here, so agents and other
 * tools read the same data the pages show. Each syncs under the kind its
 * workspace.* CRUD derives (the *_KIND constants below). The agents' schemas
 * cap text and lists at TOOL_TEXT_MAX and TOOL_LIST_MAX; the pages' forms use
 * the same caps, so a record a page saved is always one an agent can update. */

/** Text caps for the Phase 42 and Phase 43 records: a label, a sentence or two, notes. */
export const TOOL_TEXT_MAX = {
  short: 200,
  text: 1000,
  long: 5000,
  /** A note typed on the go: a hill scope's or check-in's note, a test session note. */
  capture: 500,
  /** Pasted meeting notes (Notes to Actions). */
  paste: 12000,
  /** A release's notes (Release Readiness). */
  releaseNotes: 3000,
} as const;

/** List caps for the Phase 42 and Phase 43 records. */
export const TOOL_LIST_MAX = {
  /** A 5 Whys chain. */
  whys: 20,
  /** Fishbone causes. */
  causes: 100,
  /** A Product Goal's measures. */
  measures: 10,
  /** A notebook entry's tags. */
  tags: 20,
  /** A meeting audit's ratings. */
  ratings: 20,
  /** A story's Given/When/Then criteria. */
  gwt: 20,
  /** A sectioned document's sections (lib/sectioned: Kickoff, Product Canvas). */
  sections: 16,
  /** Items in one section of a sectioned document. */
  sectionItems: 30,
  /** Blocked spells kept on a story or a Kanban card (lib/flow/block-stamps). */
  blockLog: 20,
  /** Saved versions of the Definition of Workflow. */
  workflowVersions: 12,
  /** Kanban cadences on the Definition of Workflow. */
  kanbanCadences: 10,
  /** An example map's rules (Example Mapping). */
  mapRules: 12,
  /** An example map's examples, all rules together. */
  mapExamples: 60,
  /** An example map's open questions. */
  mapQuestions: 20,
  /** A hill chart's scopes. */
  hillScopes: 30,
  /** A hill chart's saved check-ins (the oldest go first). */
  hillCheckIns: 52,
  /** A test session's notes. */
  sessionNotes: 200,
  /** Items found in one set of meeting notes. */
  noteItems: 50,
  /** A product canvas's items, all sections together. */
  canvasItems: 60,
  /** Links on one product canvas item. */
  itemLinks: 10,
  /** Who asked for an idea in the idea inbox. */
  requesters: 20,
  /** A strategy map's nodes (Impact Map, Strategy Tree). */
  strategyNodes: 150,
  /** A persona's goals, frustrations or habits, each list. */
  personaPoints: 8,
  /** The interviews a persona comes from. */
  personaInterviews: 20,
  /** A North Star's input metrics. */
  northStarInputs: 5,
  /** Product metrics in all (Product Metrics, EBM Dashboard). */
  productMetrics: 60,
  /** An A/B test's guardrail metrics. */
  abGuardrails: 3,
  /** EBM reviews kept (six years of quarters). */
  ebmReviews: 24,
  /** An Improvement Kata's obstacles. */
  kataObstacles: 30,
  /** An improvement's steps: an A3's countermeasures or a Kata's experiments. */
  improveSteps: 50,
  /** An improvement's readings. */
  improveReadings: 100,
  /** An Improvement Kata's past target conditions. */
  improvePastTargets: 20,
  /** The things on a causal loop (Root Cause). */
  loopNodes: 30,
  /** The arrows on a causal loop. */
  loopLinks: 60,
  /** The named loops on a causal loop. */
  loopNames: 20,
  /** A kickoff's trade-off sliders. */
  kickoffSliders: 8,
  /** The people at a kickoff. */
  kickoffParticipants: 30,
} as const;

export const PARKING_LOT_STATUSES = ["open", "discussed", "sent", "dropped"] as const;
export type ParkingLotStatus = (typeof PARKING_LOT_STATUSES)[number];

/**
 * A point parked during a meeting (Parking Lot), to be discussed later, sent
 * to another tool or dropped. Where it was sent is recorded the way every
 * hand-off source records it (`sentTo`, lib/handoffs), so sendHandoff and
 * liveLink work on it: the backlog ("backlog-story"), the Impediment Tracker
 * ("impediment") or Retro Actions ("retro-action").
 */
export interface ParkingLotItem {
  id: string;
  /** The point, as raised (at most TOOL_TEXT_MAX.text). */
  text: string;
  /** The meeting it came up in, as typed, such as "Daily Scrum". */
  meeting?: string;
  /** Who raised it: the roster's spelling when they're on the team. */
  raisedBy?: string;
  status: ParkingLotStatus;
  /** Where it was sent ("sent" status): one link per route. */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** The kind it syncs under (user_entities), for server-side reads and writes. */
export const PARKING_LOT_ITEM_KIND = "workspace:parkingLotItem";

export const ROOT_CAUSE_METHODS = ["five-whys", "fishbone", "causal-loop"] as const;
export type RootCauseMethod = (typeof ROOT_CAUSE_METHODS)[number];

/** One answer in a 5 Whys chain, in order: the first answers why the problem happened. */
export interface RootCauseWhy {
  id: string;
  text: string;
}

/** One cause on a fishbone, under a category (people, process, tools…), with how often it happens. */
export interface RootCauseCause {
  id: string;
  category: string;
  text: string;
  /** How many times it happened: the Pareto chart orders causes by it. A whole number, 0 or more. */
  count: number;
}

/**
 * A root-cause analysis (Root Cause): a problem taken back to its causes by
 * 5 Whys or a fishbone, the root cause the team settled on and the
 * countermeasure it agreed. `method` is the view it was started in; both
 * lists are kept whichever it is.
 */
export interface RootCauseAnalysis {
  id: string;
  title: string;
  /** The problem as a fact: what happened, where and how often. */
  problem: string;
  method: RootCauseMethod;
  whys: RootCauseWhy[];
  causes: RootCauseCause[];
  rootCause?: string;
  countermeasure?: string;
  /** The retro board it came from or was raised at. */
  retroBoardId?: string;
  /** The post-mortem it came from (Post-Mortem's record id). */
  postMortemId?: string;
  /** The item this analysis was sent from (a retro card, a post-mortem). */
  sourceRef?: HandoffRef;
  /** Where its countermeasure was sent (Retro Actions: "retro-action"). */
  sentTo?: HandoffLink[];
  /** Its causal loop (the tools plan's phase 2; see `RootCauseLoop`). */
  loop?: RootCauseLoop;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const ROOT_CAUSE_ANALYSIS_KIND = "workspace:rootCauseAnalysis";

export const PRODUCT_GOAL_STATUSES = ["active", "achieved", "abandoned"] as const;
export type ProductGoalStatus = (typeof PRODUCT_GOAL_STATUSES)[number];

/**
 * The Product Goal (Product Goal): the long-term objective the Scrum Team's
 * sprints work towards. At most one goal is "active" at a time: the tool
 * and its agent verbs close the active one (achieved or abandoned) before
 * another becomes active, and readers that find two take the latest
 * `updatedAt`. Earlier goals stay as the team's record.
 */
export interface ProductGoal {
  id: string;
  /** The goal, one sentence about the outcome (at most TOOL_TEXT_MAX.text). */
  statement: string;
  /** Why it matters. */
  why?: string;
  /** How progress is measured: up to TOOL_LIST_MAX.measures short lines. */
  measures: string[];
  /** "YYYY-MM-DD" it should be reached by. */
  targetDate?: ISODateString;
  status: ProductGoalStatus;
  /**
   * When it was marked achieved or abandoned (cleared if it is made active
   * again): a full ISO timestamp (toISOString), as the agents' schema
   * accepts no other form.
   */
  closedAt?: ISODateString;
  /** A note on the outcome, such as why it was abandoned. */
  note?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const PRODUCT_GOAL_KIND = "workspace:productGoal";

export const INTERRUPT_KINDS = ["bug", "support", "request", "incident", "other"] as const;
export type InterruptKind = (typeof INTERRUPT_KINDS)[number];

/**
 * Unplanned work that landed in a sprint (Interrupt Buffer). Every interrupt
 * logged in the sprint uses its `interruptBuffer`, open or resolved:
 * resolving it means the work is done, not that the capacity came back.
 * `size` is in the team's points when known.
 */
export interface InterruptItem {
  id: string;
  /** The sprint it landed in; absent: logged with no sprint running. */
  sprintId?: string;
  title: string;
  kind: InterruptKind;
  /** Its size in points, 0 or more, when known. */
  size?: number;
  /** It couldn't wait: the team stopped other work for it. */
  emergency: boolean;
  /**
   * When it landed, a full ISO timestamp (toISOString; it can be backdated).
   * The agents' schema accepts no other form, so a page that lets someone
   * pick a time turns the picker's value into one before saving.
   */
  loggedAt: ISODateString;
  /** When it was resolved, a full ISO timestamp; absent while it is open (never ""). */
  resolvedAt?: ISODateString;
  /** Where it was sent (the backlog, the Impediment Tracker). */
  sentTo?: HandoffLink[];
  /** The item it was sent from (a bug fixed now, from Bug Triage). */
  sourceRef?: HandoffRef;
}

export const INTERRUPT_ITEM_KIND = "workspace:interruptItem";

/**
 * A note in the Scrum Master Notebook: the coach's own record of what they
 * saw and tried. Private to the owner's workspace like everything else here.
 */
export interface NotebookEntry {
  id: string;
  /** "YYYY-MM-DD" the note is about. */
  date: ISODateString;
  title?: string;
  /** The note itself (at most TOOL_TEXT_MAX.long). */
  body: string;
  /** Free tags, each at most TOOL_TEXT_MAX.short. */
  tags: string[];
  /** The Scrum event it came from, such as "daily-scrum" or "retro". */
  event?: string;
  /**
   * The tool it is about, by tool id (src/lib/constants/tools.ts), such as
   * "impediments". The agents' schema takes only a tool id's shape
   * (lowercase words joined by hyphens), but not only ids the registry has:
   * link it through getToolById, and show no link for an unknown id.
   */
  linkedTool?: string;
  /** Where it was sent (an impediment, a retro action). */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const NOTEBOOK_ENTRY_KIND = "workspace:notebookEntry";

export const MEETING_CADENCES = ["daily", "weekly", "fortnightly", "monthly", "quarterly"] as const;
export type MeetingCadence = (typeof MEETING_CADENCES)[number];

export const MEETING_VERDICTS = ["keep", "change", "drop"] as const;
export type MeetingVerdict = (typeof MEETING_VERDICTS)[number];

/**
 * One recurring meeting under review (Meeting Audit): how often, how long and
 * for how many, what it's for, the team's ratings and a verdict.
 */
export interface MeetingAudit {
  id: string;
  /** The meeting's name. */
  meeting: string;
  cadence: MeetingCadence;
  /** Length of one occurrence in minutes, more than 0. */
  minutes: number;
  /** How many people attend, 1 or more. */
  attendees: number;
  /** What it is for. */
  purpose: string;
  /** The team's ratings by question id (the tool's own questions), each a number. */
  ratings: Record<string, number>;
  verdict?: MeetingVerdict;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const MEETING_AUDIT_KIND = "workspace:meetingAudit";

/* ── Phase 43: the tools plan's phase 2 ───────────────────────────────
 * The shared types the phase 2 tools build on, grouped by PR. Text and list
 * caps are TOOL_TEXT_MAX and TOOL_LIST_MAX above; "short" is
 * TOOL_TEXT_MAX.short and "text" TOOL_TEXT_MAX.text. */

/**
 * The most bytes of UTF-8 JSON one synced row may hold. The database refuses
 * a `user_entities` row over 512 KB (0005_user_state.sql); this leaves room
 * for the row's own columns. At their caps several Phase 43 records could
 * pass it, so their CRUDs refuse a bigger row and their pages check
 * `jsonBytes(row)` against it before a write that grows one.
 */
export const ENTITY_ROW_MAX_BYTES = 480 * 1024;

/* The sectioned kit (lib/sectioned): Kickoff and Product Canvas. */

/** One line in a sectioned document (lib/sectioned): Kickoff's and Product Canvas's items extend it. */
export interface SectionItem {
  id: string;
  text: string;
  /** Who owns it: the roster's spelling when they're on the team. */
  owner?: string;
  /** Where it was sent: one link per route. */
  sentTo?: HandoffLink[];
}

/* P2.1, Example Mapping and Planning Poker's estimates without a meeting. */

/** What an example map says about its story: ready to build, too big (split by rule), or waiting on answers. */
export const EXAMPLE_MAP_VERDICTS = ["ready", "split", "not-yet"] as const;
export type ExampleMapVerdict = (typeof EXAMPLE_MAP_VERDICTS)[number];

export const EXAMPLE_QUESTION_STATUSES = ["open", "answered", "dropped"] as const;
export type ExampleQuestionStatus = (typeof EXAMPLE_QUESTION_STATUSES)[number];

/** A rule the story must follow (a blue card). */
export interface ExampleMapRule {
  id: string;
  /** The rule (at most "short"). */
  text: string;
  /** The backlog story "Split by rule" made from it ("backlog-story"). */
  sentTo?: HandoffLink[];
}

/** A concrete example under one rule (a green card); Given, When and Then are all three or none. */
export interface ExampleMapExample {
  id: string;
  /** The rule it illustrates. */
  ruleId: string;
  /** The example in a line (at most "short"). */
  text: string;
  /** Each at most "text". */
  given?: string;
  when?: string;
  then?: string;
}

/** A question nobody can answer yet (a red card). */
export interface ExampleMapQuestion {
  id: string;
  /** The question (at most "short"). */
  text: string;
  /** The rule it is about, when it is about one. */
  ruleId?: string;
  /** Who will find the answer (at most "short"): the roster's spelling when they're on the team. */
  owner?: string;
  status: ExampleQuestionStatus;
  /** The answer, once it is answered (at most "text"). */
  answer?: string;
}

/**
 * An example map (Example Mapping): one story's rules, an example for each
 * and the open questions, mapped in a short timebox.
 */
export interface ExampleMap {
  id: string;
  /** The story as typed, or its title (at most "short"). */
  title: string;
  /** The backlog story it maps. */
  storyId?: string;
  /** At most TOOL_LIST_MAX.mapRules. */
  rules: ExampleMapRule[];
  /** At most TOOL_LIST_MAX.mapExamples. */
  examples: ExampleMapExample[];
  /** At most TOOL_LIST_MAX.mapQuestions. */
  questions: ExampleMapQuestion[];
  verdict?: ExampleMapVerdict;
  /** The timebox in minutes, 5–60 (the page starts at 25). */
  timeboxMinutes?: number;
  /** When its rules and examples were last sent to the story. */
  sentAt?: ISODateString;
  /** Where it was sent: only "backlog-story". */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const EXAMPLE_MAP_KIND = "workspace:exampleMap";

export const POKER_ASYNC_STATUSES = ["open", "revealed", "closed"] as const;
export type PokerAsyncStatus = (typeof POKER_ASYNC_STATUSES)[number];

/** Caps for an estimate without a meeting (Planning Poker); `keepDays` is how long a closed round is kept. */
export const POKER_ASYNC_MAX = {
  stories: 20,
  replies: 20,
  deck: 16,
  title: 80,
  storyTitle: 120,
  note: 140,
  notesPerReply: 5,
  name: 40,
  expected: 20,
  keepDays: 14,
} as const;

/** One story in an estimate without a meeting. */
export interface PokerAsyncStory {
  /** The queue story's sessionStoryId, otherwise a UUID. */
  id: string;
  /** At most POKER_ASYNC_MAX.storyTitle. */
  title: string;
  /** The card the team settled on. */
  finalEstimate?: string;
  /** Marked to talk about. */
  discuss?: boolean;
}

/** One person's reply: a card per story and up to POKER_ASYNC_MAX.notesPerReply notes. */
export interface PokerAsyncReply {
  id: string;
  /** As they typed it, cleaned to at most POKER_ASYNC_MAX.name characters. */
  name: string;
  votes: { storyId: string; card: string }[];
  /** Each at most POKER_ASYNC_MAX.note characters. */
  notes?: { storyId: string; text: string }[];
  at: ISODateString;
}

/**
 * A Planning Poker round without a meeting: people reply by a due date,
 * then the host reveals. Store only (no CRUD): replies hold other people's
 * names and notes.
 */
export interface PokerAsyncRound {
  /** "async_…". */
  id: string;
  /** At most POKER_ASYNC_MAX.title. */
  title: string;
  /** The tool's ScaleType ("fibonacci", "tshirt" or "custom"). */
  scaleType: string;
  /** The cards, at most POKER_ASYNC_MAX.deck, each at most 32 characters. */
  deck: string[];
  /** 1 to POKER_ASYNC_MAX.stories. */
  stories: PokerAsyncStory[];
  /** Who is expected to reply, at most POKER_ASYNC_MAX.expected names. */
  expected?: string[];
  /** The day replies are due (YYYY-MM-DD). */
  dueDate?: string;
  /** Show each card's meaning from the Estimation Guide. */
  withMeanings?: boolean;
  /** At most POKER_ASYNC_MAX.replies. */
  replies: PokerAsyncReply[];
  status: PokerAsyncStatus;
  revealedAt?: ISODateString;
  closedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const POKER_ASYNC_ROUND_KIND = "workspace:pokerAsyncRound";

/* P2.2, the bug flow (Bug Triage, Test Sessions), Hill Chart and Notes to
 * Actions. Release notes ride `Release.releaseNotes`; an interrupt sent
 * from another tool records it in `InterruptItem.sourceRef`. */

/** How bad a bug is. */
export const BUG_SEVERITIES = ["critical", "major", "minor", "cosmetic"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

/** How soon a bug needs fixing. */
export const BUG_PRIORITIES = ["now", "next", "later", "someday"] as const;
export type BugPriority = (typeof BUG_PRIORITIES)[number];

export const BUG_STATUSES = ["new", "triaged", "closed"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const BUG_CLOSE_REASONS = [
  "fixed",
  "duplicate",
  "cant-reproduce",
  "wont-fix",
  "not-a-bug",
] as const;
export type BugCloseReason = (typeof BUG_CLOSE_REASONS)[number];

/** How many people a bug reaches. */
export const BUG_REACH = ["one", "some", "many", "all"] as const;
export type BugReach = (typeof BUG_REACH)[number];

/** The quick checks Bug Triage asks before a bug is placed on the grid. */
export interface BugChecks {
  dataLoss?: boolean;
  security?: boolean;
  workaround?: boolean;
  blocksRelease?: boolean;
  reach?: BugReach;
}

/** A bug logged for triage (Bug Triage). */
export interface BugReport {
  id: string;
  /** One line (at most "short"). */
  title: string;
  /** The steps, what was expected and what happened (each at most "text"). */
  steps?: string;
  expected?: string;
  actual?: string;
  /** Each at most "short". */
  environment?: string;
  /** The product area. */
  area?: string;
  /** Who reported it: the roster's spelling when they're on the team. */
  reportedBy?: string;
  severity?: BugSeverity;
  priority?: BugPriority;
  checks?: BugChecks;
  status: BugStatus;
  /** Why it was closed ("closed" status). */
  closeReason?: BugCloseReason;
  /** The bug it repeats (closed as "duplicate"). */
  duplicateOf?: string;
  triagedAt?: ISODateString;
  closedAt?: ISODateString;
  /** The item it was sent from (a test session note, meeting notes). */
  sourceRef?: HandoffRef;
  /** Where it was sent: the backlog or an interrupt in the running sprint. */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const BUG_REPORT_KIND = "workspace:bugReport";

/** One piece of work on a hill chart: uphill (0–50) while it is being worked out, downhill after. */
export interface HillScope {
  id: string;
  /** At most "short". */
  title: string;
  /** Where it stands, a whole number 0–100: 50 is the top of the hill. */
  position: number;
  /** The story or epic it follows. */
  storyId?: string;
  epicId?: string;
  /** At most "capture". */
  note?: string;
  /** When its position last changed. */
  movedAt: ISODateString;
  /** When it reached the bottom on the right (done). */
  doneAt?: ISODateString;
  /** Where it was sent (an impediment, when it is stuck). */
  sentTo?: HandoffLink[];
}

/** A weekly check-in: every scope's position at the time. */
export interface HillCheckIn {
  id: string;
  at: ISODateString;
  /** At most TOOL_LIST_MAX.hillScopes, each position a whole number 0–100. */
  positions: { scopeId: string; position: number }[];
  /** At most "capture". */
  note?: string;
}

/** A hill chart (Hill Chart) for a sprint or an epic. */
export interface HillChart {
  id: string;
  /** At most "short". */
  title: string;
  /** What it covers (at most "text"). */
  about?: string;
  sprintId?: string;
  epicId?: string;
  /** At most TOOL_LIST_MAX.hillScopes. */
  scopes: HillScope[];
  /** At most TOOL_LIST_MAX.hillCheckIns; the oldest go first. */
  checkIns: HillCheckIn[];
  archived?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const HILL_CHART_KIND = "workspace:hillChart";

export const TEST_SESSION_STATUSES = ["planned", "running", "done"] as const;
export type TestSessionStatus = (typeof TEST_SESSION_STATUSES)[number];

/** How much of its charter a session covered. */
export const TEST_SESSION_COVERAGE = ["all", "most", "some", "little"] as const;
export type TestSessionCoverage = (typeof TEST_SESSION_COVERAGE)[number];

export const TEST_NOTE_KINDS = ["note", "bug", "question", "idea"] as const;
export type TestNoteKind = (typeof TEST_NOTE_KINDS)[number];

/** What a test session explores, with what, and what it wants to learn. */
export interface TestCharter {
  /** At most "short". */
  target: string;
  /** At most "short". */
  using?: string;
  /** At most "text". */
  toLearn: string;
}

/** One line noted during a session. */
export interface TestSessionNote {
  id: string;
  at: ISODateString;
  kind: TestNoteKind;
  /** At most "capture". */
  text: string;
  /** Where it was sent (a bug, to Bug Triage). */
  sentTo?: HandoffLink[];
}

/** A timed exploratory test session (Test Sessions). */
export interface TestSession {
  id: string;
  charter: TestCharter;
  /** Who tests (at most "short"). */
  tester?: string;
  storyId?: string;
  /** At most "short". */
  area?: string;
  /** Its length, a whole number of minutes from 15 to 240. */
  minutes: number;
  status: TestSessionStatus;
  startedAt?: ISODateString;
  endedAt?: ISODateString;
  coverage?: TestSessionCoverage;
  /** How the time split, in whole percents that add up to 100. */
  split?: { testing: number; bugs: number; setup: number };
  /** At most TOOL_LIST_MAX.sessionNotes. */
  notes: TestSessionNote[];
  /** At most "text". */
  debrief?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const TEST_SESSION_KIND = "workspace:testSession";

export const MEETING_NOTE_ITEM_KINDS = [
  "action",
  "decision",
  "impediment",
  "story",
  "bug",
  "question",
] as const;
export type MeetingNoteItemKind = (typeof MEETING_NOTE_ITEM_KINDS)[number];

export const MEETING_NOTE_ITEM_STATUSES = ["open", "sent", "dropped", "answered"] as const;
export type MeetingNoteItemStatus = (typeof MEETING_NOTE_ITEM_STATUSES)[number];

/** One item kept from a meeting's notes. */
export interface MeetingNoteItem {
  id: string;
  kind: MeetingNoteItemKind;
  /** At most "short". */
  text: string;
  /** At most "text". */
  detail?: string;
  /** At most "short": the roster's spelling when they're on the team. */
  owner?: string;
  /** The day it is due (YYYY-MM-DD). */
  due?: string;
  /** The line of the notes it came from (at most 200 characters). */
  quote?: string;
  status: MeetingNoteItemStatus;
  keptAt: ISODateString;
  /** Where it was sent: one link per route. */
  sentTo?: HandoffLink[];
}

/** One meeting's notes and the items kept from them (Notes to Actions). */
export interface MeetingNote {
  id: string;
  /** The meeting's name (at most "short"). */
  meeting?: string;
  /** The day of the meeting (YYYY-MM-DD). */
  date: string;
  /** The pasted notes (at most "paste"); "" once forgotten. */
  text: string;
  /** When the pasted text was forgotten, keeping only the items. */
  forgottenAt?: ISODateString;
  /** At most TOOL_LIST_MAX.noteItems. */
  items: MeetingNoteItem[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const MEETING_NOTE_KIND = "workspace:meetingNote";

/* P2.3, Product Canvas: a product idea on one page, in one of seven formats
 * built on the sectioned kit. Product names carry the Product/PRODUCT_
 * prefix, so nothing is ambiguous beside Kickoff's. */

export const PRODUCT_CANVAS_FORMATS = [
  "vision-board",
  "value-proposition",
  "idea",
  "lean-ux",
  "pr-faq",
  "business-case",
  "shape-up",
] as const;
export type ProductCanvasFormat = (typeof PRODUCT_CANVAS_FORMATS)[number];

/** Whether a canvas item is a known fact or a guess still to test. */
export const PRODUCT_CANVAS_EVIDENCE = ["fact", "assumption"] as const;
export type ProductCanvasEvidence = (typeof PRODUCT_CANVAS_EVIDENCE)[number];

export const PRODUCT_IDEA_SOURCES = ["customer", "stakeholder", "team", "data", "other"] as const;
export type ProductIdeaSource = (typeof PRODUCT_IDEA_SOURCES)[number];

export const PRODUCT_IDEA_STATUSES = [
  "new",
  "assessing",
  "accepted",
  "declined",
  "merged",
] as const;
export type ProductIdeaStatus = (typeof PRODUCT_IDEA_STATUSES)[number];

export const PRODUCT_CASE_VERDICTS = ["pending", "go", "no-go", "change"] as const;
export type ProductCaseVerdict = (typeof PRODUCT_CASE_VERDICTS)[number];

export const PRODUCT_BET_STATUSES = ["table", "bet", "passed", "shipped", "cut"] as const;
export type ProductBetStatus = (typeof PRODUCT_BET_STATUSES)[number];

/** Number caps on a product canvas: a Shape Up cycle, weeks of appetite, an idea's demand. */
export const PRODUCT_CANVAS_MAX = { cycle: 60, weeks: 12, demand: 9999 } as const;

/** One line on a product canvas (the sectioned kit's item, with Product Canvas's fields). */
export interface ProductCanvasItem extends SectionItem {
  /** More about it (at most "text"). */
  detail?: string;
  evidence?: ProductCanvasEvidence;
  /** At most TOOL_LIST_MAX.itemLinks, each at most 40 characters. */
  links?: string[];
  /** The hard question it answers (at most "short"). */
  promptId?: string;
  /** A nice-to-have in a Shape Up pitch. */
  niceToHave?: boolean;
}

/** An idea in the idea inbox: who asked, where it came from and how many want it. */
export interface ProductIdeaIntake {
  /** At most TOOL_LIST_MAX.requesters, each at most "short". */
  requesters: string[];
  source: ProductIdeaSource;
  /** How many asked for it, 1 to PRODUCT_CANVAS_MAX.demand. */
  demand: number;
  status: ProductIdeaStatus;
  /** The idea it was merged into ("merged"). */
  mergedInto?: string;
  /** At most "text". */
  note?: string;
}

/** A lean business case's decision. */
export interface ProductCaseDecision {
  verdict: ProductCaseVerdict;
  note?: string;
  decidedAt?: ISODateString;
}

/** A Shape Up pitch on the betting table. */
export interface ProductPitchBet {
  status: ProductBetStatus;
  /** The cycle it is bet on, 1 to PRODUCT_CANVAS_MAX.cycle. */
  cycle?: number;
  /** The day the cycle starts (YYYY-MM-DD). */
  start?: string;
  /** 1 to PRODUCT_CANVAS_MAX.weeks. */
  weeks?: number;
  decidedAt?: ISODateString;
}

/**
 * A product idea on one page (Product Canvas): its format's sections hold
 * the items, keyed by the format's section ids (lib/sectioned). At most
 * TOOL_LIST_MAX.sections sections and TOOL_LIST_MAX.canvasItems items.
 */
export interface ProductCanvas {
  id: string;
  format: ProductCanvasFormat;
  /** At most "short". */
  title: string;
  sections: Record<string, ProductCanvasItem[]>;
  /** A Shape Up pitch's appetite, 1 to PRODUCT_CANVAS_MAX.weeks. */
  appetiteWeeks?: number;
  /** The idea format's inbox fields. */
  intake?: ProductIdeaIntake;
  /** The business case format's decision. */
  decision?: ProductCaseDecision;
  /** The Shape Up format's bet. */
  bet?: ProductPitchBet;
  /** The Product Goal it was drafted from. */
  productGoalId?: string;
  /** Where it was sent: one link per route. */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const PRODUCT_CANVAS_KIND = "workspace:productCanvas";

/* P2.4, Impact Map and Strategy Tree (one StrategyMap entity with a
 * format) and the Persona Library. The Epic Roadmap's Now, Next, Later
 * rides `Epic.horizon`; an epic sent from a map records it in
 * `Epic.sourceRef`. */

export const STRATEGY_MAP_FORMATS = ["impact-map", "dibb", "lean-value-tree", "hoshin"] as const;
export type StrategyMapFormat = (typeof STRATEGY_MAP_FORMATS)[number];

/** Where a strategy tree's part stands (not used on an impact map). */
export const STRATEGY_NODE_STATUSES = ["proposed", "agreed", "questioned", "dropped"] as const;
export type StrategyNodeStatus = (typeof STRATEGY_NODE_STATUSES)[number];

/**
 * One node of a strategy map. On an impact map level 0 is the goal, 1 an
 * actor, 2 an impact and 3 a deliverable; a strategy tree's levels follow
 * its format. Rules (lib/strategy-map/rules): one root at level 0, each
 * node one level below its parent; `personaId` only on an impact map's
 * actors, `focus` only on one of its impacts; `status` and `note` only on
 * a strategy tree.
 */
export interface StrategyMapNode {
  id: string;
  /** null for the root. */
  parentId: string | null;
  level: 0 | 1 | 2 | 3;
  /** At most "short". */
  text: string;
  /** At most "text". */
  detail?: string;
  /** How it is measured (at most "short"). */
  measure?: string;
  /** Who owns it (at most "short"). */
  owner?: string;
  status?: StrategyNodeStatus;
  /** At most "text". */
  note?: string;
  /** The persona an impact map's actor is (Persona Library). */
  personaId?: string;
  /** The impact the team focuses on (one per impact map). */
  focus?: boolean;
  /** Where it was sent: the backlog, the roadmap or the Hypothesis Tracker. */
  sentTo?: HandoffLink[];
}

/** An impact map or a strategy tree (DIBB, Lean Value Tree or Hoshin Kanri). */
export interface StrategyMap {
  id: string;
  /** Fixed once the map is made. */
  format: StrategyMapFormat;
  /** At most "short". */
  title: string;
  /** At most TOOL_LIST_MAX.strategyNodes. */
  nodes: StrategyMapNode[];
  /** The Product Goal it starts from. */
  productGoalId?: string;
  /** The day its goal is due (YYYY-MM-DD). */
  targetDate?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const STRATEGY_MAP_KIND = "workspace:strategyMap";

/** A main persona, a secondary one, or an anti-persona (who the product is not for). */
export const PERSONA_TIERS = ["primary", "secondary", "anti"] as const;
export type PersonaTier = (typeof PERSONA_TIERS)[number];

/** How much of a persona comes from research. */
export const PERSONA_EVIDENCE = ["assumed", "some", "researched"] as const;
export type PersonaEvidence = (typeof PERSONA_EVIDENCE)[number];

/** Someone the team builds for (Persona Library). Personas live only here. */
export interface Persona {
  id: string;
  /** A made-up name (at most "short"). */
  name: string;
  /** At most "short". */
  role: string;
  /** At most "text". */
  summary?: string;
  tier: PersonaTier;
  evidence: PersonaEvidence;
  /** Each list at most TOOL_LIST_MAX.personaPoints points of at most "short". */
  goals: string[];
  pains: string[];
  behaviours: string[];
  /** At most "short". */
  quote?: string;
  /** At most "text". */
  context?: string;
  /** At most TOOL_LIST_MAX.tags, each at most "short". */
  tags: string[];
  /** The User Interview Log interviews it comes from, at most TOOL_LIST_MAX.personaInterviews. */
  interviewIds?: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const PERSONA_KIND = "workspace:persona";

/* P2.5, Product Metrics, the A/B Calculator and the EBM Dashboard. The EBM
 * measures are ProductMetric rows with `kva` set. The Hypothesis Tracker's
 * value checks ride `Hypothesis.measuredBy`, `shipped` and `checkOn`. */

/** A North Star, or one of the inputs that move it. */
export const METRIC_ROLES = ["north-star", "input"] as const;
export type MetricRole = (typeof METRIC_ROLES)[number];

export const HEART_CATEGORIES = [
  "happiness",
  "engagement",
  "adoption",
  "retention",
  "task-success",
] as const;
export type HeartCategory = (typeof HEART_CATEGORIES)[number];

export const AARRR_STAGES = [
  "acquisition",
  "activation",
  "retention",
  "referral",
  "revenue",
] as const;
export type AarrrStage = (typeof AARRR_STAGES)[number];

/** Evidence-Based Management's four key value areas. */
export const EBM_VALUE_AREAS = [
  "current-value",
  "unrealized-value",
  "time-to-market",
  "ability-to-innovate",
] as const;
export type EbmValueArea = (typeof EBM_VALUE_AREAS)[number];

/** The toolkit's own numbers a metric can read its value from. */
export const METRIC_SOURCE_IDS = [
  "cycle-time-median",
  "dora-lead-time",
  "dora-deploys",
  "dora-change-fail",
  "nps-90d",
  "open-tech-debt",
] as const;
export type MetricSourceId = (typeof METRIC_SOURCE_IDS)[number];

/** One dated reading of a product metric. */
export interface MetricReading {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  value: number;
  /** At most "short". */
  note?: string;
}

/** A number the product lives by (Product Metrics), or an EBM measure (`kva`). */
export interface ProductMetric {
  id: string;
  /** At most "short". */
  name: string;
  /** What it means (at most "text"). */
  definition?: string;
  /** At most HYPOTHESIS_UNIT_MAX (40) characters. */
  unit?: string;
  direction: MetricDirection;
  baseline?: number;
  target?: number;
  /** At most "short". */
  owner?: string;
  /** A North Star or one of its inputs. */
  role?: MetricRole;
  /** Its HEART goal for one feature (each text at most "short"). */
  heart?: { category: HeartCategory; feature: string; goal?: string; signal?: string };
  /** Its AARRR funnel stage. */
  aarrr?: AarrrStage;
  /** Its EBM key value area. */
  kva?: EbmValueArea;
  /** Where its readings come from in the toolkit, when not typed. */
  source?: MetricSourceId;
  /** Oldest first, one per day; at most KR_CHECK_IN_CAP. */
  readings: MetricReading[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const PRODUCT_METRIC_KIND = "workspace:productMetric";

export const AB_TEST_STATUSES = ["planned", "running", "done"] as const;
export type AbTestStatus = (typeof AB_TEST_STATUSES)[number];

export const AB_DECISIONS = ["ship", "keep", "rerun"] as const;
export type AbDecision = (typeof AB_DECISIONS)[number];

/** One version in an A/B test: whole-number counts, conversions at most visitors. */
export interface AbVariant {
  id: string;
  /** At most "short". */
  name: string;
  visitors: number;
  conversions: number;
}

/** How an A/B test is planned, every rate as a fraction. */
export interface AbTestPlan {
  /** The current conversion rate, 0–1. */
  baseline: number;
  /** The smallest change worth finding. */
  mde: number;
  mdeMode: "relative" | "absolute";
  /** 0.90, 0.95 or 0.99. */
  confidence: number;
  /** 0.8 or 0.9. */
  power: number;
  sided: "two" | "one";
  /** Visitors a day, to say how long it runs. */
  dailyTraffic?: number;
}

/** A planned or finished conversion test (A/B Calculator). */
export interface AbTest {
  id: string;
  /** At most "short". */
  name: string;
  /** At most "text". */
  question?: string;
  metricName?: string;
  /** The product metric it moves. */
  metricId?: string;
  /** The hypothesis it tests (Hypothesis Tracker). */
  hypothesisId?: string;
  plan: AbTestPlan;
  /** Exactly two: the control, then B. */
  variants: AbVariant[];
  /** At most TOOL_LIST_MAX.abGuardrails. */
  guardrails?: { name: string; why?: string }[];
  status: AbTestStatus;
  /** YYYY-MM-DD. */
  startedOn?: string;
  endedOn?: string;
  decision?: AbDecision;
  /** At most "text". */
  note?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const AB_TEST_KIND = "workspace:abTest";

/** A recorded EBM review: each area's score (0–1; absent: not measured) and the area to focus on next. */
export interface EbmReview {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  focus: EbmValueArea;
  /** At most "text". */
  note?: string;
  areas: Partial<Record<EbmValueArea, number>>;
}

/** The EBM Dashboard's one document, id EBM_BOARD_ID: the strategic goal and the reviews. */
export interface EbmBoard {
  id: string;
  strategicGoal?: string;
  /** Why it matters (at most "text"). */
  strategicWhy?: string;
  /** Oldest first, at most TOOL_LIST_MAX.ebmReviews. */
  reviews: EbmReview[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const EBM_BOARD_KIND = "workspace:ebmBoard";
export const EBM_BOARD_ID = "ebmBoard:current";

/** How a value check is measured: a product metric, a key result, or in words. */
export const MEASURED_BY_KINDS = ["metric", "key-result", "words"] as const;
export type MeasuredByKind = (typeof MEASURED_BY_KINDS)[number];

/** What a value check was shipped as. */
export const SHIPPED_KINDS = ["story", "epic"] as const;
export type ShippedKind = (typeof SHIPPED_KINDS)[number];

/** How a hypothesis is measured: `metric` names `metricId`, `key-result` both ids, `words` a note. */
export interface HypothesisMeasuredBy {
  kind: MeasuredByKind;
  metricId?: string;
  okrId?: string;
  keyResultId?: string;
  /** At most 200 characters. */
  note?: string;
}

/** The shipped story or epic a value check follows. */
export interface HypothesisShipped {
  kind: ShippedKind;
  id: string;
  /** At most 200 characters. */
  title: string;
  doneAt: string;
}

/* P2.6, Flow Insights and the Definition of Workflow: work types, blocked
 * spells (`Story`, `KanbanCard` and `Impediment` carry the fields) and the
 * workflow definition. */

/** The kinds of work a story or a card can be. */
export const WORK_TYPES = ["feature", "defect", "debt", "risk"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/** Value demand is new work people asked for; failure demand is repeat work caused by an earlier failure. */
export const WORK_DEMANDS = ["value", "failure"] as const;
export type WorkDemand = (typeof WORK_DEMANDS)[number];

/** Whether a blocker sits inside the team or outside it. */
export const BLOCK_SIDES = ["internal", "external"] as const;
export type BlockSide = (typeof BLOCK_SIDES)[number];

/** The most characters a blocker cluster's name can have. */
export const BLOCKER_CLUSTER_MAX = 60;

/**
 * A blocked spell, stamped by lib/flow/block-stamps: when the flag went on
 * (`from`) and off (`to`, absent while it is still blocked). `earlier`:
 * flagged before tracking began (its time is a lower bound).
 */
export interface BlockSpell {
  from: ISODateString;
  to?: ISODateString;
  /** What blocked it (at most "short"). */
  cause?: string;
  /** The blocker cluster it belongs to (at most BLOCKER_CLUSTER_MAX). */
  cluster?: string;
  side?: BlockSide;
  earlier?: true;
  /** Where it was sent (an impediment): at most one link per route. */
  sentTo?: HandoffLink[];
}

/** The percentiles a service level expectation can be set at. */
export const WORKFLOW_SLE_PERCENTILES = [50, 75, 85, 90, 95] as const;
export type WorkflowSlePercentile = (typeof WORKFLOW_SLE_PERCENTILES)[number];

/** One work type on the workflow: what it means here and the share of finished work it aims for. */
export interface WorkflowWorkType {
  type: WorkType;
  /** What it means for this team (at most "short"). */
  meaning?: string;
  /** The target share of finished work, a whole number 0–100. */
  targetPct?: number;
}

/** When work enters and leaves one stage of the workflow. */
export interface WorkflowStagePolicy {
  /** The stage's name (at most 20 characters). */
  stage: string;
  /** When work enters it (at most "short"). */
  enter?: string;
  /** When work leaves it (at most "short"). */
  exit?: string;
}

/** How one class of service is handled (the policy at most "short"). */
export interface WorkflowClassPolicy {
  class: KanbanClassOfService;
  policy: string;
}

/** Notes from the STATIK steps, one per step (each at most "text"). */
export interface StatikNotes {
  inside?: string;
  outside?: string;
  demand?: string;
  capability?: string;
  workflow?: string;
  classes?: string;
  design?: string;
  rollout?: string;
}

/** A recurring Kanban meeting on the workflow. */
export interface KanbanCadence {
  id: string;
  /** Its name (at most "short"). */
  name: string;
  cadence: MeetingCadence;
  /** Its length in minutes, 5–240. */
  minutes?: number;
  /** What it is for (at most "short"). */
  purpose?: string;
}

/**
 * A saved version's copy of the workflow, with the board's WIP limits at the
 * time, so a compare shows a WIP change. No STATIK notes, no cadences and no
 * versions.
 */
export type WorkflowSnapshot = Pick<
  WorkflowDefinition,
  | "board"
  | "workItem"
  | "startPoint"
  | "finishPoint"
  | "workTypes"
  | "policies"
  | "classPolicies"
  | "wipPolicy"
  | "pullPolicy"
  | "blockerPolicy"
  | "sle"
> & { wipLimits: Record<KanbanColumnId, number> };

/** A saved version of the workflow. */
export interface WorkflowVersion {
  /** Its number, a whole number from 1. */
  version: number;
  savedAt: ISODateString;
  /** What changed. */
  note?: string;
  /** What the team expects to change because of it (at most "short"). */
  expect?: string;
  snapshot: WorkflowSnapshot;
}

/**
 * The team's Definition of Workflow (Kanban): one document, id
 * WORKFLOW_DEFINITION_ID, describing one board (`board`). Its work-type
 * targets apply to both boards, because Flow Insights reads them for both.
 * Every policy and short text is at most "short", so its saved versions
 * keep the row small.
 */
export interface WorkflowDefinition {
  /** WORKFLOW_DEFINITION_ID. */
  id: string;
  /** The board it describes. */
  board?: "sprint" | "flow";
  /** What one item of work is. */
  workItem?: string;
  /** Where work is counted as started. */
  startPoint?: string;
  /** Where work is counted as finished. */
  finishPoint?: string;
  /** At most 4, one per work type. */
  workTypes?: WorkflowWorkType[];
  /** At most 6. */
  policies?: WorkflowStagePolicy[];
  /** At most 4, one per class of service. */
  classPolicies?: WorkflowClassPolicy[];
  wipPolicy?: string;
  pullPolicy?: string;
  blockerPolicy?: string;
  /** The service level expectation: `pct` percent of items finish within `days` (1–365). */
  sle?: { days: number; pct: WorkflowSlePercentile };
  statik?: StatikNotes;
  /** At most TOOL_LIST_MAX.kanbanCadences. */
  cadences?: KanbanCadence[];
  /** Saved versions: only the latest TOOL_LIST_MAX.workflowVersions are kept. */
  versions?: WorkflowVersion[];
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export const WORKFLOW_DEFINITION_ID = "workflow-definition:current";
export const WORKFLOW_DEFINITION_KIND = "workspace:workflowDefinition";

/* P2.7, Improve (an A3 or the Improvement Kata), Root Cause's causal loop
 * (`RootCauseAnalysis.loop`) and the Emotional Seismograph's card days
 * (`RetroCard.day`). */

export const IMPROVEMENT_METHODS = ["a3", "kata"] as const;
export type ImprovementMethod = (typeof IMPROVEMENT_METHODS)[number];

export const IMPROVEMENT_STATUSES = ["open", "checking", "closed", "dropped"] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export const IMPROVEMENT_STEP_STATUSES = ["planned", "running", "done", "dropped"] as const;
export type ImprovementStepStatus = (typeof IMPROVEMENT_STEP_STATUSES)[number];

export const KATA_OBSTACLE_STATUSES = ["open", "working", "cleared"] as const;
export type KataObstacleStatus = (typeof KATA_OBSTACLE_STATUSES)[number];

/** The most characters an improvement's unit can have. */
export const IMPROVEMENT_UNIT_MAX = 20;

/** Where things stand, or where the team wants them: words, and a number with a date when there is one. */
export interface ImprovementCondition {
  /** At most "text"; may be blank. */
  text: string;
  /** What is measured (at most "short"). */
  metric?: string;
  value?: number;
  /** At most IMPROVEMENT_UNIT_MAX. */
  unit?: string;
  /** YYYY-MM-DD. */
  date?: string;
}

/** A Kata target that was reached, kept when the next one is set. */
export type ImprovementPastTarget = ImprovementCondition & { reachedAt: ISODateString };

/** One dated reading of the improvement's number (note at most "short"). */
export type ImprovementReading = Pick<KeyResultCheckIn, "id" | "date" | "value" | "note">;

/** Something in the way of a Kata's target. */
export interface ImprovementObstacle {
  id: string;
  text: string;
  status: KataObstacleStatus;
  /** Where it was sent (an impediment). */
  sentTo?: HandoffLink[];
}

/** An A3's countermeasure or a Kata's experiment. */
export interface ImprovementStep {
  id: string;
  /** Each at most "text". */
  text: string;
  expect?: string;
  result?: string;
  learned?: string;
  /** The obstacle a Kata experiment works on. */
  obstacleId?: string;
  /** At most "short". */
  owner?: string;
  /** YYYY-MM-DD. */
  due?: string;
  status: ImprovementStepStatus;
  doneAt?: ISODateString;
  /** Where it was sent: Retro Actions or the backlog. */
  sentTo?: HandoffLink[];
}

/** One thing being improved (Improve): an A3 or an Improvement Kata. */
export interface Improvement {
  id: string;
  /** At most "short"; the only field that can't be blank. */
  title: string;
  /** Fixed when it starts. */
  method: ImprovementMethod;
  status: ImprovementStatus;
  /** Each at most "short". */
  owner?: string;
  coach?: string;
  /** Why it matters (at most "text"). */
  background: string;
  current: ImprovementCondition;
  target: ImprovementCondition;
  /** At most TOOL_LIST_MAX.improvePastTargets. */
  pastTargets?: ImprovementPastTarget[];
  /** Why it happens (at most "text"). */
  analysis?: string;
  /** The Root Cause analysis it links (at most 64 characters). */
  rootCauseId?: string;
  /** At most TOOL_LIST_MAX.kataObstacles; at most one "working". */
  obstacles: ImprovementObstacle[];
  /** At most TOOL_LIST_MAX.improveSteps. */
  steps: ImprovementStep[];
  /** At most TOOL_LIST_MAX.improveReadings. */
  readings: ImprovementReading[];
  /** Each at most "text". */
  check?: string;
  followUp?: string;
  /** The next coaching talk (YYYY-MM-DD). */
  nextCoachingAt?: string;
  closedAt?: ISODateString;
  /** Where it was sent: one link per route. */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const IMPROVEMENT_KIND = "workspace:improvement";

/** An arrow on a causal loop: both things move the same way, or opposite ways. */
export const LOOP_POLARITIES = ["same", "opposite"] as const;
export type LoopPolarity = (typeof LOOP_POLARITIES)[number];

/** Text caps on a causal loop: a thing on it, a loop's name. */
export const LOOP_TEXT_MAX = { node: 120, name: 80 } as const;

/** A thing on a causal loop that goes up or down. */
export interface RootCauseLoopNode {
  id: string;
  /** At most LOOP_TEXT_MAX.node. */
  text: string;
}

/** An arrow from one thing to another. */
export interface RootCauseLoopLink {
  id: string;
  from: string;
  to: string;
  polarity: LoopPolarity;
  /** The effect comes later. */
  delay?: boolean;
}

/** A name the team gave one loop, keyed by the loop (at most 1,000 characters). */
export interface RootCauseLoopName {
  key: string;
  /** At most LOOP_TEXT_MAX.name. */
  name: string;
}

/** A Root Cause analysis's causal loop diagram. */
export interface RootCauseLoop {
  /** At most TOOL_LIST_MAX.loopNodes. */
  nodes: RootCauseLoopNode[];
  /** At most TOOL_LIST_MAX.loopLinks. */
  links: RootCauseLoopLink[];
  /** At most TOOL_LIST_MAX.loopNames. */
  names?: RootCauseLoopName[];
}

/* P2.8, Kickoff: six formats built on the sectioned kit. A rule it sends to
 * the Working Agreement records it in `CharterRule.sourceRef`. */

export const KICKOFF_FORMATS = [
  "alignment-map",
  "project-poster",
  "team-canvas",
  "inception",
  "trade-offs",
  "problem-framing",
] as const;
export type KickoffFormat = (typeof KICKOFF_FORMATS)[number];

export const KICKOFF_STATUSES = ["draft", "agreed"] as const;
export type KickoffStatus = (typeof KICKOFF_STATUSES)[number];

/** The most characters a kickoff item can have. */
export const KICKOFF_ITEM_MAX = 500;
/** The most characters a kickoff's brief can have. */
export const KICKOFF_BRIEF_MAX = 2000;
/** The most characters a trade-off slider's label can have. */
export const KICKOFF_SLIDER_LABEL_MAX = 60;

/**
 * One line on a kickoff (the sectioned kit's item): its text is at most
 * KICKOFF_ITEM_MAX and may be empty only when `owner` is set (a person whose
 * role isn't known yet).
 */
export interface KickoffItem extends SectionItem {
  /** A worry's likelihood and impact, whole numbers 1–5. */
  likelihood?: number;
  impact?: number;
  /** The id of the worry item in the same kickoff this one answers. */
  covers?: string;
}

/** One trade-off slider: positions are whole numbers 1–8, each used once. */
export interface KickoffSlider {
  id: string;
  /** At most KICKOFF_SLIDER_LABEL_MAX. */
  label: string;
  position: number;
  /** At most "short". */
  note?: string;
}

/** A team's or a piece of work's kickoff (Kickoff), in one of six formats. */
export interface Kickoff {
  id: string;
  /** At most "short". */
  title: string;
  format: KickoffFormat;
  /** At most KICKOFF_BRIEF_MAX. */
  brief?: string;
  /** YYYY-MM-DD. */
  date?: string;
  /** At most TOOL_LIST_MAX.kickoffParticipants names, each at most "short". */
  participants?: string[];
  /** The items by the format's section id (lib/sectioned). */
  sections: Record<string, KickoffItem[]>;
  /** At most TOOL_LIST_MAX.kickoffSliders. */
  sliders?: KickoffSlider[];
  slidersSetAt?: ISODateString;
  status: KickoffStatus;
  agreedAt?: ISODateString;
  /** The slider order's decision link. */
  sentTo?: HandoffLink[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const KICKOFF_KIND = "workspace:kickoff";

/* P2.9, Team Time (people, meeting-time polls and rotations), the Async
 * Standup's formats (`StandupEntry.format`, `blockerDri`, `handoff`) and the
 * Working Agreement's charter templates (`WorkingAgreement.templates`,
 * `CharterRule.template`). */

export const TEAM_TIME_PERSON_KIND = "workspace:teamTimePerson";
export const TEAM_TIME_POLL_KIND = "workspace:teamTimePoll";
export const TEAM_TIME_ROTATION_KIND = "workspace:teamTimeRotation";

export const TEAM_TIME_ANSWERS = ["yes", "maybe", "no"] as const;
export type TeamTimeAnswer = (typeof TEAM_TIME_ANSWERS)[number];

export const TEAM_TIME_POLL_STATUSES = ["open", "closed"] as const;
export type TeamTimePollStatus = (typeof TEAM_TIME_POLL_STATUSES)[number];

/** A rotation moves the meeting's time in turn, or to whoever has had it worst. */
export const TEAM_TIME_ROTATION_MODES = ["in-turn", "fairest"] as const;
export type TeamTimeRotationMode = (typeof TEAM_TIME_ROTATION_MODES)[number];

/** Team Time's caps: people, poll slots and answers, rotation options and held meetings, and text lengths. */
export const TEAM_TIME_MAX = {
  people: 50,
  slots: 20,
  answers: 50,
  options: 4,
  held: 52,
  attendees: 50,
  zone: 64,
  site: 60,
  label: 60,
} as const;

/** One person's time zone, hours and days (Team Time). */
export interface TeamTimePerson {
  id: string;
  /** The roster member it is. */
  teamMemberId?: string;
  /** At most "short". */
  name: string;
  /** An IANA time zone in its canonical spelling, such as "Africa/Cairo". */
  timeZone: string;
  /** Working hours, "HH:MM" in their zone. */
  start: string;
  end: string;
  /** 0 Sunday to 6 Saturday. */
  workingDays: number[];
  /** Days in the office, within the working days. */
  officeDays?: number[];
  /** Their office (at most TEAM_TIME_MAX.site). */
  site?: string;
  /** At most "text". */
  note?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** One time a poll offers: a UTC instant. */
export interface TeamTimeSlot {
  id: string;
  start: ISODateString;
}

/** One person's answers to a poll, by slot id. */
export interface TeamTimePollAnswer {
  /** At most "short". */
  name: string;
  picks: Record<string, TeamTimeAnswer>;
}

/** A poll for a meeting time (Team Time), answered by the facilitator. */
export interface TeamTimePoll {
  id: string;
  /** At most "short". */
  title: string;
  /** The meeting's length in minutes. */
  minutes: number;
  /** At most TEAM_TIME_MAX.slots. */
  slots: TeamTimeSlot[];
  /** At most TEAM_TIME_MAX.answers. */
  answers: TeamTimePollAnswer[];
  status: TeamTimePollStatus;
  chosenSlotId?: string;
  /** At most "text". */
  note?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** One time a rotating meeting can be held: a weekday and time in a zone. */
export interface TeamTimeRotationOption {
  id: string;
  /** At most TEAM_TIME_MAX.label. */
  label?: string;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  /** "HH:MM". */
  time: string;
  timeZone: string;
}

/** A held (or skipped) meeting of a rotation. */
export interface TeamTimeHeld {
  /** YYYY-MM-DD in the option's zone. */
  date: string;
  optionId: string;
  skipped?: true;
}

/** A meeting that rotates between times, so the same people don't always take the late call. */
export interface TeamTimeRotation {
  id: string;
  /** At most "short". */
  meeting: string;
  minutes: number;
  everyWeeks: 1 | 2 | 3 | 4;
  /** YYYY-MM-DD. */
  startDate: string;
  mode: TeamTimeRotationMode;
  /** 2 to TEAM_TIME_MAX.options. */
  options: TeamTimeRotationOption[];
  /** TeamTimePerson ids, at most TEAM_TIME_MAX.attendees. */
  attendees?: string[];
  /** At most TEAM_TIME_MAX.held. */
  held: TeamTimeHeld[];
  /** The Meeting Audit row of the same meeting. */
  meetingAuditId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** The Working Agreement's charter templates. */
export const CHARTER_TEMPLATE_IDS = [
  "urgency-ladder",
  "core-hours",
  "focus-time",
  "ai-use",
] as const;
export type CharterTemplateId = (typeof CHARTER_TEMPLATE_IDS)[number];

/** The caps of the charter templates' fields. */
export const CHARTER_TEMPLATE_MAX = {
  slot: 40,
  levelsMin: 2,
  levels: 6,
  levelLabel: 40,
  levelWhen: 160,
  levelChannel: 80,
  levelReplyWithin: 40,
  anchorDays: 4,
  site: 60,
  weeklyMinHoursMin: 1,
  weeklyMinHours: 40,
  aiTools: 5,
  aiTool: 60,
  aiNote: 120,
} as const;

/** One rung of an urgency ladder: when to use it, where, and how fast a reply comes. */
export interface UrgencyLevel {
  id: string;
  /** At most CHARTER_TEMPLATE_MAX.levelLabel. */
  label: string;
  /** At most CHARTER_TEMPLATE_MAX.levelWhen. */
  when: string;
  /** At most CHARTER_TEMPLATE_MAX.levelChannel. */
  channel: string;
  /** Free text, at most CHARTER_TEMPLATE_MAX.levelReplyWithin. */
  replyWithin: string;
}

export interface UrgencyLadderTemplate {
  /** 2 to CHARTER_TEMPLATE_MAX.levels. */
  levels: UrgencyLevel[];
  /** Whether the ladder holds after hours. */
  afterHours: boolean;
  appliedAt: ISODateString;
}

export const CORE_HOURS_PURPOSES = ["meetings", "quick-replies", "pairing"] as const;
export type CoreHoursPurpose = (typeof CORE_HOURS_PURPOSES)[number];

export interface CoreHoursTemplate {
  /** "HH:MM". */
  start: string;
  end: string;
  timeZone: string;
  /** 0 Sunday to 6 Saturday. */
  days: number[];
  /** At least one. */
  purposes: CoreHoursPurpose[];
  /** Office anchor days by site, at most CHARTER_TEMPLATE_MAX.anchorDays. */
  anchorDays?: { site: string; days: number[] }[];
  appliedAt: ISODateString;
}

export interface FocusTimeTemplate {
  days: number[];
  start: string;
  end: string;
  /** null: each person's own clock. */
  timeZone: string | null;
  /** 1 to CHARTER_TEMPLATE_MAX.weeklyMinHours. */
  weeklyMinHours?: number;
  appliedAt: ISODateString;
}

/** Where AI is never used. */
export const AI_USE_NEVER_IN = ["customer-data", "secrets", "confidential"] as const;
export type AiUseNeverIn = (typeof AI_USE_NEVER_IN)[number];

/** How AI-made work is reviewed. */
export const AI_USE_REVIEW = ["as-any-work", "closer-look", "not-production"] as const;
export type AiUseReview = (typeof AI_USE_REVIEW)[number];

export interface AiUseTemplate {
  /** At most CHARTER_TEMPLATE_MAX.aiTools, each at most CHARTER_TEMPLATE_MAX.aiTool. */
  tools: string[];
  neverIn: AiUseNeverIn[];
  /** At most CHARTER_TEMPLATE_MAX.aiNote. */
  neverInOther?: string;
  review: AiUseReview;
  customerFacing: boolean;
  /** At most CHARTER_TEMPLATE_MAX.aiNote. */
  shareWhere?: string;
  appliedAt: ISODateString;
}

/** The templates a Working Agreement has applied. */
export interface CharterTemplates {
  urgencyLadder?: UrgencyLadderTemplate;
  coreHours?: CoreHoursTemplate;
  focusTime?: FocusTimeTemplate;
  aiUse?: AiUseTemplate;
}

export interface Workspace {
  teamMembers: TeamMember[];
  sprints: Sprint[];
  /** Daily logs and ratings per sprint (see `SprintSeries`). */
  sprintSeries?: SprintSeries[];
  /** The team's ceremony cadence: one document (see `CeremonyCadenceDoc`). */
  ceremonyCadences?: CeremonyCadenceDoc[];
  stories: Story[];
  impediments: Impediment[];
  risks: Risk[];
  okrs: Okr[];
  decisions: Decision[];
  techDebt: TechDebtItem[];
  maturityLevel?: MaturityLevel;
  teamName?: string;
  // Phase 19 — AI/LLM PM
  llmEvals?: LLMEval[];
  prompts?: PromptVersion[];
  hallucinations?: Hallucination[];
  tokenSpend?: TokenSpend[];
  models?: ModelEntry[];
  redTeamFindings?: RedTeamFinding[];
  agentWorkflows?: AgentWorkflow[];
  agentNodes?: AgentNode[];
  hitlReviews?: HitlReview[];
  rlhfPairs?: RlhfPair[];
  vectorCollections?: VectorCollection[];
  modelCards?: ModelCard[];
  // S12b singleton-doc tools
  aiFeatureSpecs?: AiFeatureSpec[];
  aiSafetyChecklists?: AiSafetyChecklist[];
  modelMigrations?: ModelMigration[];
  // S9 — Security & Compliance (singleton docs)
  threatModels?: ThreatModel[];
  vulnBurndowns?: VulnBurndown[];
  controlMaps?: ControlMap[];
  a11yTrackers?: A11yTracker[];
  // S10 — Quality Engineering (singleton docs)
  testPyramids?: TestPyramid[];
  flakyTestBoards?: FlakyTestBoard[];
  codeReviewLogs?: CodeReviewLog[];
  // S7 — Engineering Excellence (singleton docs)
  doraScorecards?: DoraScorecard[];
  healthDashboards?: HealthDashboardConfig[];
  featureFlags?: FeatureFlag[];
  sloBuilders?: SloBuilder[];
  spacePulses?: SpacePulse[];
  devexSurveys?: DevexSurvey[];
  platformMaturities?: PlatformMaturity[];
  // S11 — Workshops & Facilitation (singleton docs)
  workingAgreements?: WorkingAgreement[];
  liberatingStructures?: LiberatingStructures[];
  designSprints?: DesignSprint[];
  riskiestAssumptions?: RiskiestAssumption[];
  wardleyMaps?: WardleyMap[];
  // S5 — Portfolio & Discovery (singleton docs)
  epicRoadmaps?: EpicRoadmap[];
  hypothesisTrackers?: HypothesisTracker[];
  userInterviewLogs?: UserInterviewLog[];
  opportunityTrees?: OpportunityTree[];
  // S8 — Incidents & Reliability (singleton docs)
  runbookScorers?: RunbookScorer[];
  releaseReadinesses?: ReleaseReadiness[];
  oncallRosters?: OncallRoster[];
  incidentCommanders?: IncidentCommander[];
  postMortemLogs?: PostMortemLog[];
  // S4 — Team Health & Maturity (singleton docs)
  psychSafetyLogs?: PsychSafetyLog[];
  maturityAssessments?: MaturityAssessment[];
  healthChecks?: HealthCheck[];
  skillsMatrices?: SkillsMatrix[];
  pokerEstimationLogs?: PokerEstimationLog[];
  pokerRounds?: PokerRound[];
  // Phase 6 — Team & people (singleton docs, except mood pulses)
  /** One `DefinitionOfDone`, id `DOD_DOC_ID`. */
  definitionsOfDone?: DefinitionOfDone[];
  /** One `RaciMatrix`, id `RACI_ID`. */
  raciMatrices?: RaciMatrix[];
  /** One `AdkarDoc`, id `ADKAR_DOC_ID`. */
  adkarDocs?: AdkarDoc[];
  /** One `MoodTrackerDoc`, id `MOOD_TRACKER_ID`. */
  moodTrackerDocs?: MoodTrackerDoc[];
  /** Anonymous team mood pulses (counts only). */
  moodPulses?: MoodPulse[];
  // Phase 20 — Prioritization
  prioritizations?: PrioritizationItem[];
  // Phase 7 — Prioritize & decide
  /** Saved Buy-a-Feature and $100 Test rounds (aggregates only). */
  allocationRounds?: AllocationRound[];
  /** One `BuyAFeatureGame`, id `BUY_A_FEATURE_ID`. */
  buyAFeatureGames?: BuyAFeatureGame[];
  /** Named weighted-decision matrices (the default one needs no row). */
  weightedMatrices?: WeightedMatrix[];
  // Phase 21 — Decision Frameworks
  /** Legacy since Phase 7: read through as `decisions` (template "daci"). */
  daciDecisions?: DACIDecision[];
  /** Legacy since Phase 7: read through as `decisions` (template "rapid"). */
  rapidDecisions?: RAPIDDecision[];
  weightedOptions?: WeightedOption[];
  weightedCriteria?: WeightedCriterion[];
  sixHatsThoughts?: SixHatsThought[];
  sixHatsSessions?: SixHatsSession[];
  oodaCycles?: OODACycle[];
  cynefinItems?: CynefinItem[];
  staceyItems?: StaceyItem[];
  polarities?: Polarity[];
  polarityPoles?: PolarityPole[];
  // Phase 22 — Canvas (whiteboard)
  whiteboards?: Whiteboard[];
  whiteboardObjects?: WhiteboardObject[];
  whiteboardCommentThreads?: WhiteboardCommentThread[];
  whiteboardGroups?: WhiteboardGroup[];
  whiteboardSavedTemplates?: WhiteboardSavedTemplate[];
  /** Activity log — rolling 200-event ring per board. Phase 32. */
  whiteboardActivityLog?: WhiteboardActivityEvent[];
  /** Squad-interactive kudos wall — rolling 500-entry cap to bound
   *  localStorage growth (see workspace-store.upsertKudos). */
  kudos?: Kudos[];
  // Ceremonies (squad S3)
  sosEntries?: SosEntry[];
  asyncUpdates?: AsyncUpdate[];
  standupEntries?: StandupEntry[];
  sprintReviews?: SprintReview[];
  retroBoards?: RetroBoard[];
  // Sprint Planning (squad S1)
  sprintGoals?: SprintGoal[];
  jobStories?: JobStory[];
  capacityPlans?: CapacityPlan[];
  storyMaps?: StoryMap[];
  backlogItems?: BacklogItem[];
  // Outcomes & Pulse (squad S6)
  npsResponses?: NpsResponse[];
  moodEntries?: MoodEntry[];
  // Flow & Delivery (squad S6)
  kanbanBoards?: KanbanBoard[];
  dependencyMaps?: DependencyMap[];
  valueStreamStages?: ValueStreamStage[];
  // Phase 42 — the tools plan's phase 1
  parkingLotItems?: ParkingLotItem[];
  rootCauseAnalyses?: RootCauseAnalysis[];
  /** At most one "active" (see `ProductGoal`). */
  productGoals?: ProductGoal[];
  interruptItems?: InterruptItem[];
  notebookEntries?: NotebookEntry[];
  meetingAudits?: MeetingAudit[];
  // Phase 43 — the tools plan's phase 2
  exampleMaps?: ExampleMap[];
  /** Planning Poker's estimates without a meeting (store only, no CRUD). */
  pokerAsyncRounds?: PokerAsyncRound[];
  bugReports?: BugReport[];
  hillCharts?: HillChart[];
  testSessions?: TestSession[];
  meetingNotes?: MeetingNote[];
  productCanvases?: ProductCanvas[];
  /** Impact Maps and Strategy Trees (one entity, by format). */
  strategyMaps?: StrategyMap[];
  personas?: Persona[];
  /** Product metrics and EBM measures (those with kva set). */
  productMetrics?: ProductMetric[];
  abTests?: AbTest[];
  /** One EbmBoard, id EBM_BOARD_ID. */
  ebmBoards?: EbmBoard[];
  /** One WorkflowDefinition, id WORKFLOW_DEFINITION_ID (Kanban's Definition of Workflow). */
  workflowDefinitions?: WorkflowDefinition[];
  improvements?: Improvement[];
  kickoffs?: Kickoff[];
  teamTimePeople?: TeamTimePerson[];
  teamTimePolls?: TeamTimePoll[];
  teamTimeRotations?: TeamTimeRotation[];
}

/**
 * Single recognition card on the workspace kudos wall.
 *
 * Authored by the workspace owner OR any squad guest with an active
 * invite. Persists in the owner's workspace store; broadcast to all
 * peers in `tool:kudos:room:workspace` so guests' walls converge live.
 * Guests don't persist beyond their session — the owner's heartbeat
 * snapshot re-populates the wall on their next connect.
 */
/**
 * Built-in theme ids. The first six are the print campaign's cards (the
 * four habits and the two open cards, lib/kudos/print-cards), the only ones
 * a new kudos is written on; the seven after them are the tool's original
 * themes, which saved cards still carry and every reader still takes.
 * A saved kudos may also carry a `KudosCustomTheme` object, from when the
 * settings let owners define their own themes. No custom theme is made any
 * more, but those rows still parse; they, the original ids and a habit with
 * no episode are drawn as the "Thank you!" card (lib/kudos/card-designs).
 */
export type KudosBuiltInTheme =
  | "focus"
  | "ownership"
  | "real-needs"
  | "trust"
  | "open-thank-you"
  | "open-teamwork"
  | "awesome"
  | "thank-you"
  | "great-job"
  | "congratulations"
  | "very-happy"
  | "you-rock"
  | "well-done";

/**
 * A custom theme as older saved kudos carry it. Kept so those rows still
 * parse and type-check; the card is drawn as "Thank you!" whatever it says.
 */
export interface KudosCustomTheme {
  /** Stable identifier; alphanumeric+hyphen, ≤ 32 chars. */
  id: string;
  /** Display title. */
  title: string;
  /** The emoji it was made with. ≤ 4 codepoints. */
  emoji: string;
  /** The colour it was made with. */
  hex: string;
}

export type KudosTheme = KudosBuiltInTheme | KudosCustomTheme;

export interface KudosSentiment {
  label: "positive" | "neutral" | "backhanded";
  /** 0..1 LLM confidence. */
  confidence: number;
  /** Free-form tone tags (e.g. ["grateful", "playful"]). */
  tone: string[];
}

export interface KudosReaction {
  emoji: string;
  byProfileId: string;
  at: ISODateString;
}

export interface Kudos {
  id: string;
  /**
   * Schema version. Absent on pre-redesign rows; parseKudos auto-stamps
   * `1` on legacy inputs and `2` on inputs carrying v2-only fields. The
   * field is forward-only — once a row is v2 it stays v2.
   */
  version?: 1 | 2;
  theme: KudosTheme;
  /** Recipient display name (free-text fallback or squad profile name). */
  toName: string;
  /** Squad profile id when sent to a named guest; lets the recipient's
   *  tab highlight kudos addressed to them. */
  toProfileId?: string;
  /** TeamMember.id when the recipient was picked from the roster, so a
   *  later rename still counts the kudos for the same person. */
  toMemberId?: string;
  /** Sender display name — owner email/display_name or guest profile name. */
  fromName: string;
  /** Squad profile id when guest-authored; null for owner-authored. */
  fromProfileId?: string;
  /** Optional team label (e.g. "Data Governance"). The form no longer asks
   *  for one; saved cards keep and show theirs. */
  teamName?: string;
  /** The book episode (1-26) whose printed kudos card this one is written
   *  on, or, on an open card ("Thank you!", "Great teamwork!"), the episode
   *  it reminds the sender of. Only the number is kept: the card's words
   *  are always read from the print campaign's data file. */
  episode?: number;
  /** Message body — capped at ~50 words client-side. */
  message: string;
  /** Send timestamp. */
  sentAt: ISODateString;
  /**
   * Phase 4 — beacon identity hooks. The flying-card animation reads
   * sender + recipient DOM rects via the `data-identity-id` attribute
   * convention; these fields are the wire copy so every peer resolves
   * the same endpoints independently.
   */
  senderIdentityId?: string;
  recipientIdentityId?: string;
  /** Phase 3 LLM advisories — never required; the no-AI path leaves all
   *  three undefined and the wall renders identically. */
  sentiment?: KudosSentiment;
  /** Shared id across LLM-detected near-duplicates. The wall stacks
   *  kudos that carry the same group. */
  llmDedupGroup?: string;
  /** Snapshot of recipient under-recognition score at send time (0..1).
   *  Frozen on send so the audit log captures the signal that
   *  prompted the sender, not its drift afterwards. */
  fairnessScoreAtSend?: number;
  /** Phase 5 — peers can react with emoji; depth-1 thread via replyTo. */
  reactions?: KudosReaction[];
  replyTo?: string;
}

/** Per-board activity event (Phase 32). */
export interface WhiteboardActivityEvent {
  id: string;
  boardId: string;
  /** When (epoch ms). */
  at: number;
  /** Who — display name, derived from sender's presence. May be spoofed
   * by a hostile peer; trust `by` for identity-binding checks. */
  author: string;
  /** Free-form event kind: "added", "removed", "moved", "edited",
   * "comment", "vote", etc. */
  kind: string;
  /** Short preview of what changed — e.g. "3 stickies added". */
  summary: string;
  /** Sender's room identity. Optional for backward compatibility with
   * pre-fix events already persisted in localStorage. Set by
   * `broadcastActivity` on the wire and used by the receiver to verify
   * the event came from a peer in the current presence roster. */
  by?: string;
}

export const emptyWorkspace = {
  teamMembers: [],
  sprints: [],
  sprintSeries: [],
  ceremonyCadences: [],
  stories: [],
  impediments: [],
  risks: [],
  okrs: [],
  decisions: [],
  techDebt: [],
  // Explicit-undefined so { ...emptyWorkspace, ...patch } reliably clears
  // these optional fields when patch omits them. Otherwise an import that
  // omits `teamName` lets the prior session's teamName survive.
  maturityLevel: undefined,
  teamName: undefined,
  // Phase 19 — AI/LLM PM. Initialised to empty arrays (not undefined) so that
  // selectors using `s.llmEvals ?? []` return a STABLE reference instead of a
  // fresh `[]` per render — the latter triggers a Zustand re-render loop.
  llmEvals: [],
  prompts: [],
  hallucinations: [],
  tokenSpend: [],
  models: [],
  redTeamFindings: [],
  agentWorkflows: [],
  agentNodes: [],
  hitlReviews: [],
  rlhfPairs: [],
  vectorCollections: [],
  modelCards: [],
  // S12b singleton-doc tools
  aiFeatureSpecs: [],
  aiSafetyChecklists: [],
  modelMigrations: [],
  // S9 — Security & Compliance
  threatModels: [],
  vulnBurndowns: [],
  controlMaps: [],
  a11yTrackers: [],
  // S10 — Quality Engineering
  testPyramids: [],
  flakyTestBoards: [],
  codeReviewLogs: [],
  // S7 — Engineering Excellence
  doraScorecards: [],
  healthDashboards: [],
  featureFlags: [],
  sloBuilders: [],
  spacePulses: [],
  devexSurveys: [],
  platformMaturities: [],
  // S11 — Workshops & Facilitation
  workingAgreements: [],
  liberatingStructures: [],
  designSprints: [],
  riskiestAssumptions: [],
  wardleyMaps: [],
  // S5 — Portfolio & Discovery
  epicRoadmaps: [],
  hypothesisTrackers: [],
  userInterviewLogs: [],
  opportunityTrees: [],
  // S8 — Incidents & Reliability
  runbookScorers: [],
  releaseReadinesses: [],
  oncallRosters: [],
  incidentCommanders: [],
  postMortemLogs: [],
  // S4 — Team Health & Maturity
  psychSafetyLogs: [],
  maturityAssessments: [],
  healthChecks: [],
  skillsMatrices: [],
  pokerEstimationLogs: [],
  pokerRounds: [],
  // Phase 6 — Team & people
  definitionsOfDone: [],
  raciMatrices: [],
  adkarDocs: [],
  moodTrackerDocs: [],
  moodPulses: [],
  // Phase 20 — Prioritization
  prioritizations: [],
  // Phase 7 — Prioritize & decide
  allocationRounds: [],
  buyAFeatureGames: [],
  weightedMatrices: [],
  // Phase 21 — Decision Frameworks
  daciDecisions: [],
  rapidDecisions: [],
  weightedOptions: [],
  weightedCriteria: [],
  sixHatsThoughts: [],
  sixHatsSessions: [],
  oodaCycles: [],
  cynefinItems: [],
  staceyItems: [],
  polarities: [],
  polarityPoles: [],
  // Phase 22 — Canvas. Default empty arrays so workspace-store selectors
  // returning `?? []` produce a stable reference (otherwise infinite loop).
  whiteboards: [],
  whiteboardObjects: [],
  whiteboardCommentThreads: [],
  whiteboardGroups: [],
  whiteboardSavedTemplates: [],
  whiteboardActivityLog: [],
  kudos: [],
  // R12-fix: Ceremonies (S3), Sprint Planning (S1), and Outcomes/Flow (S6)
  // collections were missing entirely, so `set({ ...emptyWorkspace })` in
  // resetWorkspace / replaceWorkspace / importJSON silently RETAINED the
  // prior workspace's data for these 15 collections (zustand set() is a
  // shallow merge — a key absent here has no default to stand in). The
  // CompleteWorkspace `satisfies` guard below now makes that a compile
  // error instead of a silent data leak.
  sosEntries: [],
  asyncUpdates: [],
  standupEntries: [],
  sprintReviews: [],
  retroBoards: [],
  sprintGoals: [],
  jobStories: [],
  capacityPlans: [],
  storyMaps: [],
  backlogItems: [],
  npsResponses: [],
  moodEntries: [],
  kanbanBoards: [],
  dependencyMaps: [],
  valueStreamStages: [],
  // Phase 42 — the tools plan's phase 1
  parkingLotItems: [],
  rootCauseAnalyses: [],
  productGoals: [],
  interruptItems: [],
  notebookEntries: [],
  meetingAudits: [],
  // Phase 43 — the tools plan's phase 2
  exampleMaps: [],
  pokerAsyncRounds: [],
  bugReports: [],
  hillCharts: [],
  testSessions: [],
  meetingNotes: [],
  productCanvases: [],
  strategyMaps: [],
  personas: [],
  productMetrics: [],
  abTests: [],
  ebmBoards: [],
  workflowDefinitions: [],
  improvements: [],
  kickoffs: [],
  teamTimePeople: [],
  teamTimePolls: [],
  teamTimeRotations: [],
} satisfies Workspace;

/**
 * R12-fix: compile-time completeness guard for emptyWorkspace. The const
 * uses `satisfies Workspace` (not a `: Workspace` annotation) so
 * `typeof emptyWorkspace` keeps the literal's ACTUAL keys — letting the
 * assignment below fail to compile, naming the missing keys, whenever a
 * future Workspace collection is added but forgotten above. That matters
 * because `resetWorkspace`, `replaceWorkspace`, and `importJSON` all rely
 * on `{ ...emptyWorkspace, ... }` supplying a default for EVERY key —
 * zustand's set() is a shallow merge, so a key missing from this object
 * silently retains the prior workspace's data.
 */
type MissingEmptyWorkspaceKeys = Exclude<keyof Workspace, keyof typeof emptyWorkspace>;
const emptyWorkspaceIsComplete: MissingEmptyWorkspaceKeys extends never ? true : never = true;
void emptyWorkspaceIsComplete;
