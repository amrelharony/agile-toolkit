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
  version: string;       // semantic-ish e.g. "1.4.0"
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
  framework: "rice" | "ice" | "moscow" | "kano" | "wsjf" | "cost-of-delay" | "value-effort" | "buy-feature" | "hundred-dollar" | "eisenhower" | "walking-skeleton";
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
  | "embed";

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
}

export interface WhiteboardShape extends WhiteboardObjectBase {
  type: "rect" | "ellipse" | "diamond" | "triangle";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  content?: string;
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
}

export interface WhiteboardFreehand extends WhiteboardObjectBase {
  type: "freehand";
  /** Flat [x0,y0,x1,y1,...] in WORLD coords. */
  points: number[];
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
}

export interface WhiteboardEmbed extends WhiteboardObjectBase {
  type: "embed";
  src: string;
  kind: "youtube" | "figma" | "loom" | "generic";
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
  | WhiteboardEmbed;

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
};
