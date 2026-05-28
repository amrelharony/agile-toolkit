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
}

export interface Story {
  id: string;
  title: string;
  points?: number;
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  sprintId?: string;
  tags?: string[];
  priorityScore?: number;
  owner?: string;
}

export type ImpedimentSeverity = "low" | "medium" | "high" | "critical";

export interface Impediment {
  id: string;
  title: string;
  severity: ImpedimentSeverity;
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
  owner?: string;
  source?: "standup" | "retro" | "manual";
}

export interface Risk {
  id: string;
  title: string;
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  mitigation?: string;
  /** Target date by which mitigation should complete (ISO yyyy-mm-dd). */
  mitigationDueAt?: ISODateString;
  status: "open" | "mitigating" | "closed" | "accepted";
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
}

export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  target: number;
  current: number;
  unit?: string;
  confidence?: number;
}

export interface Okr {
  id: string;
  objective: string;
  description?: string;
  keyResults: KeyResult[];
  quarter: string;
  owner?: string;
}

export interface Decision {
  id: string;
  title: string;
  context?: string;
  decision: string;
  consequences?: string;
  alternatives?: string[];
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  date: ISODateString;
}

export interface TechDebtItem {
  id: string;
  title: string;
  description?: string;
  area?: string;
  impact: 1 | 2 | 3 | 4 | 5;
  effort: 1 | 2 | 3 | 4 | 5;
  interestRate?: number;
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
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
  /** Generic numeric score derived by the framework */
  score?: number;
  /** Free-form data bag (per-framework fields) */
  fields?: Record<string, number | string>;
  status?: "open" | "scored" | "decided" | "shipped" | "dropped";
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

export interface WeightedOption {
  id: string;
  name: string;
  scores: Record<string, number>; // criterionId -> score
}

export interface WeightedCriterion {
  id: string;
  name: string;
  weight: number;
}

export interface SixHatsThought {
  id: string;
  hat: "white" | "red" | "black" | "yellow" | "green" | "blue";
  text: string;
  loggedAt: ISODateString;
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
  domain: "clear" | "complicated" | "complex" | "chaotic" | "confused";
  rationale?: string;
  recommendedAction?: string;
  loggedAt: ISODateString;
}

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
}

/** A card on the story map. */
export interface StoryMapCard {
  id: string;
  title: string;
  description: string;
  color: string;
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

export interface Workspace {
  teamMembers: TeamMember[];
  sprints: Sprint[];
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
  // Phase 20 — Prioritization
  prioritizations?: PrioritizationItem[];
  // Phase 21 — Decision Frameworks
  daciDecisions?: DACIDecision[];
  rapidDecisions?: RAPIDDecision[];
  weightedOptions?: WeightedOption[];
  weightedCriteria?: WeightedCriterion[];
  sixHatsThoughts?: SixHatsThought[];
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
  // Sprint Planning (squad S1)
  sprintGoals?: SprintGoal[];
  jobStories?: JobStory[];
  capacityPlans?: CapacityPlan[];
  storyMaps?: StoryMap[];
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
 * Built-in catalog ids — the seven themes that ship with the tool.
 * Custom themes live alongside as `KudosCustomTheme` objects so the
 * Phase 3 LLM can synthesise themes without code edits and the Phase 5
 * settings UI can let owners define palette additions.
 */
export type KudosBuiltInTheme =
  | "awesome"
  | "thank-you"
  | "great-job"
  | "congratulations"
  | "very-happy"
  | "you-rock"
  | "well-done";

export interface KudosCustomTheme {
  /** Stable identifier; alphanumeric+hyphen, ≤ 32 chars. */
  id: string;
  /** Display title. */
  title: string;
  /** Emoji shown on the card header strip. ≤ 4 codepoints. */
  emoji: string;
  /** Hex accent for the PNG-export path (CSS uses Tailwind utility classes). */
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
  /** Sender display name — owner email/display_name or guest profile name. */
  fromName: string;
  /** Squad profile id when guest-authored; null for owner-authored. */
  fromProfileId?: string;
  /** Optional team label (e.g. "Data Governance"). */
  teamName?: string;
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

export const emptyWorkspace: Workspace = {
  teamMembers: [],
  sprints: [],
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
  // Phase 20 — Prioritization
  prioritizations: [],
  // Phase 21 — Decision Frameworks
  daciDecisions: [],
  rapidDecisions: [],
  weightedOptions: [],
  weightedCriteria: [],
  sixHatsThoughts: [],
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
};
