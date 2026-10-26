/**
 * Workspace entity CRUD actions.
 *
 * Each entity collection in the workspace store gets create/list/update/
 * delete via `defineCrudActions`. Selection helpers and intent
 * compositions live in `../intents/`.
 *
 * The zod schemas here are intentionally loose (using `passthrough` /
 * generic records) — the workspace types are large and well-documented
 * in `src/lib/stores/workspace-types.ts`; we accept the unwrapped shape
 * and let the workspace store's own runtime checks do the heavy lifting.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { defineCrudActions } from "../define-crud";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ADKAR_DOC_ID,
  ADKAR_ELEMENTS,
  ALLOCATION_ROUND_TOOLS,
  BUY_A_FEATURE_ID,
  CEREMONY_CADENCE_ID,
  DECISION_ROLES,
  DECISION_STATUSES,
  DECISION_TEMPLATES,
  DEFAULT_WEIGHTED_MATRIX_ID,
  DOD_DOC_ID,
  HANDOFF_ROUTE_IDS,
  HEALTH_DASHBOARD_ID,
  MOOD_TRACKER_ID,
  RACI_ID,
  REACH_PERIODS,
  WORKING_AGREEMENT_ID,
} from "@/lib/stores/workspace-types";
import { CeremonyCadenceSchema } from "@/lib/sprints/cadence-schema";
import { MATURITY_ID } from "@/lib/maturity/assessment";
import { SKILLS_MATRIX_ID } from "@/lib/skills/coverage";
import {
  STORY_STATUSES,
  STORY_SPRINT_HISTORY_CAP,
  STORY_STATUS_HISTORY_CAP,
  stampStoryWrite,
} from "@/lib/sprints/story-status";
import type {
  Sprint,
  SprintSeries,
  CeremonyCadenceDoc,
  Story,
  Impediment,
  Risk,
  Okr,
  Decision,
  TechDebtItem,
  TeamMember,
  // Phase 19 — AI / LLM PM
  LLMEval,
  PromptVersion,
  Hallucination,
  TokenSpend,
  ModelEntry,
  ModelCard,
  RedTeamFinding,
  AgentWorkflow,
  AgentNode,
  HitlReview,
  RlhfPair,
  VectorCollection,
  AiFeatureSpec,
  AiSafetyChecklist,
  ModelMigration,
  // S9 — Security & Compliance
  ThreatModel,
  VulnBurndown,
  ControlMap,
  A11yTracker,
  // S10 — Quality Engineering
  TestPyramid,
  FlakyTestBoard,
  CodeReviewLog,
  // S7 — Engineering Excellence
  DoraScorecard,
  FeatureFlag,
  HealthDashboardConfig,
  SloBuilder,
  SpacePulse,
  DevexSurvey,
  PlatformMaturity,
  // S11 — Workshops & Facilitation
  WorkingAgreement,
  LiberatingStructures,
  DesignSprint,
  RiskiestAssumption,
  WardleyMap,
  // S5 — Portfolio & Discovery
  EpicRoadmap,
  HypothesisTracker,
  UserInterviewLog,
  OpportunityTree,
  // S8 — Incidents & Reliability
  RunbookScorer,
  ReleaseReadiness,
  OncallRoster,
  IncidentCommander,
  PostMortemLog,
  // S4 — Team Health & Maturity
  PsychSafetyLog,
  MaturityAssessment,
  HealthCheck,
  SkillsMatrix,
  PokerEstimationLog,
  // Phase 6 — Team & people
  DefinitionOfDone,
  RaciMatrix,
  AdkarDoc,
  MoodTrackerDoc,
  MoodPulse,
  // Phase 20 — Prioritization
  PrioritizationItem,
  // Phase 7 — Prioritize & decide
  AllocationRound,
  BuyAFeatureGame,
  WeightedMatrix,
  // Phase 21 — Decision Frameworks
  DACIDecision,
  RAPIDDecision,
  WeightedOption,
  WeightedCriterion,
  SixHatsThought,
  SixHatsSession,
  OODACycle,
  CynefinItem,
  Polarity,
  // Ceremonies (squad S3)
  SosEntry,
  AsyncUpdate,
  StandupEntry,
  SprintReview,
  RetroBoard,
  // Sprint Planning (squad S1)
  SprintGoal,
  JobStory,
  CapacityPlan,
  StoryMap,
  BacklogItem,
  // Outcomes & Pulse (squad S6)
  NpsResponse,
  MoodEntry,
  // Flow & Delivery (squad S6)
  KanbanBoard,
  DependencyMap,
  ValueStreamStage,
  // Phase 22 — Canvas (board only — objects have a dedicated tool action set)
  Whiteboard,
} from "@/lib/stores/workspace-types";

const ws = () => useWorkspaceStore.getState();

const SprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  goal: z.string().optional(),
  pointsPlanned: z.number(),
  pointsCompleted: z.number().optional(),
  status: z.enum(["planned", "active", "completed", "cancelled"]),
}) as unknown as z.ZodType<Sprint>;

// Mirrors `SprintDay` / `SprintSeries` field for field: `update` writes the
// parsed record and `z.object` drops unknown keys, so a field missing here
// would be erased by every agent update.
const SprintDaySchema = z.object({
  day: z.number(),
  remaining: z.number().nullable().optional(),
  completed: z.number().nullable().optional(),
  scope: z.number().nullable().optional(),
  scopeChange: z.boolean().optional(),
  note: z.string().optional(),
});

const SprintSeriesSchema = z.object({
  id: z.string(),
  days: z.array(SprintDaySchema).optional(),
  ratings: z.record(z.string(), z.number()).optional(),
  migratedFrom: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
}) as unknown as z.ZodType<SprintSeries>;

// Hand-off links (workspace-types HandoffRef / HandoffLink). Every schema
// that holds them must list them: updates write the parsed object, and
// z.object drops keys it doesn't know.
const HandoffRefSchema = z.object({
  tool: z.string(),
  id: z.string(),
  doc: z.string().optional(),
});
const HandoffLinkSchema = z.object({
  route: z.enum(HANDOFF_ROUTE_IDS),
  targetId: z.string(),
  at: z.string(),
});

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// The id of a singleton document: the one id its tool reads. Its CRUD has no
// `generateId`, so `create` needs this id and defineCrudActions' duplicate
// guard runs: a second create is an error, never a silent overwrite of the
// team's document (a generateId returning the fixed id skipped that guard),
// and no create makes an orphan under another id. The ceremony cadence's
// CRUD is the precedent.
const SingletonId = (id: string) => z.literal(id).describe(`Always "${id}", the one document.`);

const StoryStatusSchema = z.enum(STORY_STATUSES as [Story["status"], ...Story["status"][]]);

// The flow stamps are listed so an update keeps them (z.object drops keys it
// doesn't know). A status change through create/update stamps them itself
// (`stampStoryWrite`, as the app's setStoryStatus does); send them only to
// backfill.
const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  points: z.number().optional(),
  status: StoryStatusSchema,
  sprintId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priorityScore: z.number().optional(),
  owner: z.string().optional(),
  startedAt: z.string().optional().describe("When work started (ISO). Stamped on a status change."),
  doneAt: z
    .string()
    .optional()
    .describe("When it was moved to done (ISO). Stamped on a status change."),
  blocked: z.boolean().optional().describe("Flagged as blocked; cleared when it is done."),
  statusHistory: z
    .array(
      z.object({ status: StoryStatusSchema, from: StoryStatusSchema.optional(), at: z.string() })
    )
    .max(STORY_STATUS_HISTORY_CAP)
    .optional()
    .describe("Status changes, oldest first (latest 50). Appended on a status change."),
  createdAt: z.string().optional().describe("When the story was first saved (ISO). Stamped."),
  sprintHistory: z
    .array(
      z.object({
        sprintId: z.string().optional(),
        from: z.string().optional(),
        at: z.string(),
        points: z.number().optional(),
        carriedOver: z.boolean().optional(),
      })
    )
    .max(STORY_SPRINT_HISTORY_CAP)
    .optional()
    .describe(
      "Sprint moves, oldest first (latest 20): {sprintId (joined; absent: back to the backlog), from (left), at, points, carriedOver}. Appended when sprintId changes."
    ),
  sourceRef: HandoffRefSchema.optional(),
  readiness: z
    .object({
      checked: z.array(z.string()).describe("Ids of the Definition-of-Ready criteria that passed."),
      ready: z.boolean(),
      updatedAt: z.string(),
    })
    .optional()
    .describe("Definition-of-Ready result from the last refinement of this story."),
  epicId: z.string().optional().describe("The Epic Roadmap epic this story belongs to."),
  dodChecks: z
    .object({
      checked: z.array(z.string()).describe("Ids of the Definition-of-Done criteria met."),
      updatedAt: z.string(),
    })
    .optional()
    .describe(
      "Definition-of-Done criteria ticked on the story's board card. Whether it meets the DoD is derived against today's required criteria (workspace.definition_of_done)."
    ),
  backlogRank: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The decided backlog order it was pulled in with (its backlog item's rank, 1 = first). Absent: not ordered."
    ),
}) as unknown as z.ZodType<Story>;

const ImpedimentSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  raisedAt: z.string(),
  resolvedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string().optional(),
  source: z.enum(["standup", "retro", "manual"]).optional(),
  sourceRef: HandoffRefSchema.optional(),
  description: z.string().optional(),
  category: z.enum(["technical", "organizational", "external", "process"]).optional(),
  raisedBy: z.string().optional(),
  escalatedAt: z.string().optional(),
  dueDate: z.string().optional(),
  expectedResolutionDays: z.number().int().min(0).optional(),
}) as unknown as z.ZodType<Impediment>;

const RiskSchema = z.object({
  id: z.string(),
  title: z.string(),
  probability: z.number(),
  impact: z.number(),
  mitigation: z.string().optional(),
  mitigationDueAt: z.string().optional(),
  status: z.enum(["open", "mitigating", "closed", "accepted"]),
  raisedAt: z.string(),
  resolvedAt: z.string().optional(),
  sourceRef: HandoffRefSchema.optional(),
}) as unknown as z.ZodType<Risk>;

const KeyResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  target: z.number(),
  current: z.number(),
  unit: z.string().optional(),
  confidence: z.number().optional(),
});

const OkrSchema = z.object({
  id: z.string(),
  objective: z.string(),
  description: z.string().optional(),
  keyResults: z.array(KeyResultSchema),
  quarter: z.string(),
  owner: z.string().optional(),
}) as unknown as z.ZodType<Okr>;

// Every Phase 7 field is listed so an update keeps it (z.object drops keys it
// doesn't know). Dates stay loose strings, as `date` always was: older rows
// and agents may hold a timestamp, which lib/decisions reads as its day.
const DecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  decision: z.string().describe('The outcome ("We will …"); "" until decided.'),
  consequences: z.string().optional(),
  alternatives: z
    .array(z.string())
    .optional()
    .describe("Pre-template ADRs: one option per line. New records use options."),
  status: z.enum(DECISION_STATUSES),
  date: z.string().describe("YYYY-MM-DD the record was raised (can be backdated)."),
  sourceRef: HandoffRefSchema.optional(),
  template: z
    .enum(DECISION_TEMPLATES)
    .optional()
    .describe('The form it was raised with; absent: "adr".'),
  number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("One numbering sequence across templates (ADR-0003, DACI-0004); never reused."),
  options: z
    .array(z.object({ id: z.string(), text: z.string(), note: z.string().optional() }))
    .optional()
    .describe("The options weighed: {id, text, note (why rejected, or its trade-offs)}."),
  chosenOptionId: z.string().optional().describe("The option the outcome picked."),
  recommendation: z
    .string()
    .optional()
    .describe("The DACI Driver's or RAPID Recommender's proposal."),
  decider: z
    .string()
    .optional()
    .describe("Roster spelling: the one person with the final say (DACI Approver, RAPID Decide)."),
  roles: z
    .partialRecord(z.enum(DECISION_ROLES), z.array(z.string()))
    .optional()
    .describe("Roster spellings per role; driver and recommend hold at most one."),
  decidedAt: z.string().optional().describe("YYYY-MM-DD it was accepted on."),
  implementedAt: z
    .string()
    .optional()
    .describe('YYYY-MM-DD it was carried out (DACI/RAPID "implemented").'),
  reopenedAt: z
    .string()
    .optional()
    .describe('YYYY-MM-DD an accepted decision went back to proposed (DACI "revisit").'),
  supersededBy: z
    .string()
    .optional()
    .describe('Id of the decision that replaced this one (status "superseded").'),
}) as unknown as z.ZodType<Decision>;

const TechDebtSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  area: z.string().optional(),
  impact: z.number(),
  effort: z.number(),
  interestRate: z.number().optional(),
  raisedAt: z.string(),
  resolvedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
}) as unknown as z.ZodType<TechDebtItem>;

const TeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  capacityPct: z.number().optional(),
  skills: z.array(z.string()).optional(),
}) as unknown as z.ZodType<TeamMember>;

defineCrudActions<Sprint>({
  toolId: "workspace.sprint",
  entityName: "sprint",
  schema: SprintSchema,
  selectAll: () => ws().sprints,
  upsert: (s) => ws().upsertSprint(s),
  remove: (id) => ws().removeSprint(id),
  generateId: () => `sprint_${nanoid(8)}`,
});

// A sprint's daily log and ratings. No `generateId`: the id must be the
// sprint's own id, so a create without one is rejected.
defineCrudActions<SprintSeries>({
  toolId: "workspace.sprint_series",
  entityName: "sprint series",
  schema: SprintSeriesSchema,
  selectAll: () => ws().sprintSeries ?? [],
  upsert: (x) => ws().upsertSprintSeries(x),
  remove: (id) => ws().removeSprintSeries(id),
});

// The team's ceremony cadence: one document under CEREMONY_CADENCE_ID, the
// row the Sprint Cockpit and the team charter read (tool.ceremony_cadence.*
// has the normalised reading and a patch). The schema rejects what
// `normalizeCadence` would replace by a default, so a bad time or weekday is
// an error rather than a silent reset. No `generateId`: the id must be the
// singleton's, so a create without one is rejected.
const CeremonyCadenceDocSchema = CeremonyCadenceSchema.extend({
  id: z.literal(CEREMONY_CADENCE_ID),
}) as unknown as z.ZodType<CeremonyCadenceDoc>;

defineCrudActions<CeremonyCadenceDoc>({
  toolId: "workspace.ceremony_cadence",
  entityName: "ceremony cadence",
  schema: CeremonyCadenceDocSchema,
  selectAll: () => ws().ceremonyCadences ?? [],
  upsert: (x) => ws().upsertCeremonyCadence(x),
  remove: (id) => ws().removeCeremonyCadence(id),
});

defineCrudActions<Story>({
  toolId: "workspace.story",
  entityName: "story",
  schema: StorySchema,
  selectAll: () => ws().stories,
  upsert: (s) => ws().upsertStory(s),
  remove: (id) => ws().removeStory(id),
  generateId: () => `story_${nanoid(8)}`,
  prepare: (next, current) => stampStoryWrite(next, current),
});

defineCrudActions<Impediment>({
  toolId: "workspace.impediment",
  entityName: "impediment",
  schema: ImpedimentSchema,
  selectAll: () => ws().impediments,
  upsert: (i) => ws().upsertImpediment(i),
  remove: (id) => ws().removeImpediment(id),
  generateId: () => `imp_${nanoid(8)}`,
});

defineCrudActions<Risk>({
  toolId: "workspace.risk",
  entityName: "risk",
  schema: RiskSchema,
  selectAll: () => ws().risks,
  upsert: (r) => ws().upsertRisk(r),
  remove: (id) => ws().removeRisk(id),
  generateId: () => `risk_${nanoid(8)}`,
});

defineCrudActions<Okr>({
  toolId: "workspace.okr",
  entityName: "OKR",
  schema: OkrSchema,
  selectAll: () => ws().okrs,
  upsert: (o) => ws().upsertOkr(o),
  remove: (id) => ws().removeOkr(id),
  generateId: () => `okr_${nanoid(8)}`,
});

defineCrudActions<Decision>({
  toolId: "workspace.decision",
  entityName: "decision",
  schema: DecisionSchema,
  selectAll: () => ws().decisions,
  upsert: (d) => ws().upsertDecision(d),
  remove: (id) => ws().removeDecision(id),
  generateId: () => `dec_${nanoid(8)}`,
});

defineCrudActions<TechDebtItem>({
  toolId: "workspace.tech_debt",
  entityName: "tech-debt item",
  schema: TechDebtSchema,
  selectAll: () => ws().techDebt,
  upsert: (t) => ws().upsertTechDebt(t),
  remove: (id) => ws().removeTechDebt(id),
  generateId: () => `td_${nanoid(8)}`,
});

defineCrudActions<TeamMember>({
  toolId: "workspace.team_member",
  entityName: "team member",
  schema: TeamMemberSchema,
  selectAll: () => ws().teamMembers,
  upsert: (m) => ws().upsertTeamMember(m),
  remove: (id) => ws().removeTeamMember(id),
  generateId: () => `member_${nanoid(8)}`,
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 19 — AI / LLM Product Management entities
 *
 * Schemas are intentionally loose (most fields optional) — the entity
 * shapes in workspace-types.ts have many discriminated enums that don't
 * round-trip cleanly through a typed agent tool-call. The workspace
 * store's runtime checks own validation; these schemas exist mostly so
 * the JSON-Schema export to Anthropic / MCP advertises the field names.
 * ────────────────────────────────────────────────────────────────── */

const LLMEvalSchema = z.object({
  id: z.string(),
  promptVersion: z.string().optional(),
  model: z.string(),
  dataset: z.string(),
  score: z.number(),
  metricBreakdown: z.record(z.string(), z.number()).optional(),
  recordedAt: z.string(),
  notes: z.string().optional(),
}) as unknown as z.ZodType<LLMEval>;

const PromptVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  body: z.string(),
  status: z.enum(["draft", "review", "production", "deprecated"]),
  evalScore: z.number().optional(),
  publishedAt: z.string().optional(),
  author: z.string().optional(),
  changeNote: z.string().optional(),
}) as unknown as z.ZodType<PromptVersion>;

const HallucinationSchema = z.object({
  id: z.string(),
  feature: z.string().optional(),
  input: z.string(),
  expected: z.string().optional(),
  actual: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  rootCause: z.enum(["rag-miss", "prompt", "model", "context-window", "other"]).optional(),
  fixApplied: z.string().optional(),
  loggedAt: z.string(),
  resolvedAt: z.string().optional(),
}) as unknown as z.ZodType<Hallucination>;

const TokenSpendSchema = z.object({
  id: z.string(),
  feature: z.string(),
  model: z.string(),
  date: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
}) as unknown as z.ZodType<TokenSpend>;

const ModelEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string(),
  inputCostPer1k: z.number().optional(),
  outputCostPer1k: z.number().optional(),
  contextWindow: z.number().optional(),
  latencyP50Ms: z.number().optional(),
  latencyP95Ms: z.number().optional(),
  evalScore: z.number().optional(),
  status: z.enum(["production", "evaluation", "experimental", "deprecated"]),
  notes: z.string().optional(),
  version: z.number().optional(),
}) as unknown as z.ZodType<ModelEntry>;

/** Model Card *documentation* (intended use / training data / limitations).
 *  Distinct from ModelEntry above — that's the cost/latency/status registry
 *  (kind workspace:model). This is the /model-card builder's collection
 *  (kind workspace:modelCard). modelName is the only required field; the
 *  rest are free-text doc sections the agent may fill incrementally. */
const ModelCardSchema = z.object({
  id: z.string(),
  modelName: z.string(),
  intendedUse: z.string().optional(),
  trainingData: z.string().optional(),
  evaluation: z.string().optional(),
  limitations: z.string().optional(),
  license: z.string().optional(),
  updatedAt: z.string().optional(),
}) as unknown as z.ZodType<ModelCard>;

const RedTeamFindingSchema = z.object({
  id: z.string(),
  attackVector: z.string(),
  promptUsed: z.string().optional(),
  successful: z.boolean(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  mitigation: z.string().optional(),
  loggedAt: z.string(),
  retestDueAt: z.string().optional(),
  resolvedAt: z.string().optional(),
}) as unknown as z.ZodType<RedTeamFinding>;

defineCrudActions<LLMEval>({
  toolId: "workspace.llm_eval",
  entityName: "LLM eval",
  schema: LLMEvalSchema,
  selectAll: () => ws().llmEvals ?? [],
  upsert: (x) => ws().upsertLLMEval(x),
  remove: (id) => ws().removeLLMEval(id),
  generateId: () => `llmEval_${nanoid(8)}`,
});

defineCrudActions<PromptVersion>({
  toolId: "workspace.prompt",
  entityName: "prompt version",
  schema: PromptVersionSchema,
  selectAll: () => ws().prompts ?? [],
  upsert: (x) => ws().upsertPrompt(x),
  remove: (id) => ws().removePrompt(id),
  generateId: () => `prompt_${nanoid(8)}`,
});

defineCrudActions<Hallucination>({
  toolId: "workspace.hallucination",
  entityName: "hallucination report",
  schema: HallucinationSchema,
  selectAll: () => ws().hallucinations ?? [],
  upsert: (x) => ws().upsertHallucination(x),
  remove: (id) => ws().removeHallucination(id),
  generateId: () => `hallucination_${nanoid(8)}`,
});

defineCrudActions<TokenSpend>({
  toolId: "workspace.token_spend",
  entityName: "token-spend entry",
  schema: TokenSpendSchema,
  selectAll: () => ws().tokenSpend ?? [],
  upsert: (x) => ws().upsertTokenSpend(x),
  remove: (id) => ws().removeTokenSpend(id),
  generateId: () => `tokenSpend_${nanoid(8)}`,
});

defineCrudActions<ModelEntry>({
  toolId: "workspace.model",
  entityName: "model entry",
  schema: ModelEntrySchema,
  selectAll: () => ws().models ?? [],
  upsert: (x) => ws().upsertModel(x),
  remove: (id) => ws().removeModel(id),
  generateId: () => `model_${nanoid(8)}`,
  // ModelEntry carries a monotonic `version` and is edited by both the user
  // (the /model-comparison UI's version-guarded upsertModel) and agents
  // (tool.model_registry.* writes server-side via serverVersionedUpdate). The
  // generic workspace.model.update must use the same compare-and-set or it's a
  // lost-update back-door that clobbers a concurrent field change in the DB.
  versioned: true,
});

// workspace.model_card.* → kind "workspace:modelCard", matching
// registerCollection("modelCard", "modelCards") in workspace-store.ts. This
// is the agent surface for the /model-card documentation builder, which had
// none before (the similarly-named tool.model_registry.* operates on the
// `models` registry, a different collection).
defineCrudActions<ModelCard>({
  toolId: "workspace.model_card",
  entityName: "model card",
  schema: ModelCardSchema,
  selectAll: () => ws().modelCards ?? [],
  upsert: (x) => ws().upsertModelCard(x),
  remove: (id) => ws().removeModelCard(id),
  generateId: () => `modelCard_${nanoid(8)}`,
});

defineCrudActions<RedTeamFinding>({
  toolId: "workspace.red_team_finding",
  entityName: "red-team finding",
  schema: RedTeamFindingSchema,
  selectAll: () => ws().redTeamFindings ?? [],
  upsert: (x) => ws().upsertRedTeamFinding(x),
  remove: (id) => ws().removeRedTeamFinding(id),
  generateId: () => `redTeam_${nanoid(8)}`,
});

/* ── S12b: agentic-workflow, hitl-quality, rlhf-log, vector-store-inventory.
 * Entities + store wiring + registerCollection already existed; these CRUD
 * surfaces (+ the tool.<x>.* domain verbs in ../tools/) complete the agent
 * enablement. agent-workflow has two collections joined by workflowId. */

const AgentWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
}) as unknown as z.ZodType<AgentWorkflow>;

const AgentNodeSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  label: z.string(),
  kind: z.enum(["agent", "tool", "human", "fallback", "branch"]),
  description: z.string().optional(),
  next: z.array(z.string()).optional(),
}) as unknown as z.ZodType<AgentNode>;

const HitlReviewSchema = z.object({
  id: z.string(),
  feature: z.string().optional(),
  reviewer: z.string().optional(),
  rating: z.number(),
  agreedWithModel: z.boolean(),
  reason: z.string().optional(),
  loggedAt: z.string(),
}) as unknown as z.ZodType<HitlReview>;

const RlhfPairSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  responseA: z.string(),
  responseB: z.string(),
  winner: z.enum(["A", "B", "tie"]),
  reviewer: z.string().optional(),
  reason: z.string().optional(),
  loggedAt: z.string(),
}) as unknown as z.ZodType<RlhfPair>;

const VectorCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  embeddingModel: z.string(),
  dim: z.number(),
  docCount: z.number(),
  refreshCadence: z.string().optional(),
  owner: z.string().optional(),
  consumers: z.array(z.string()).optional(),
  notes: z.string().optional(),
}) as unknown as z.ZodType<VectorCollection>;

defineCrudActions<AgentWorkflow>({
  toolId: "workspace.agent_workflow",
  entityName: "agent workflow",
  schema: AgentWorkflowSchema,
  selectAll: () => ws().agentWorkflows ?? [],
  upsert: (x) => ws().upsertAgentWorkflow(x),
  remove: (id) => ws().removeAgentWorkflow(id),
  generateId: () => `agentWorkflow_${nanoid(8)}`,
});

defineCrudActions<AgentNode>({
  toolId: "workspace.agent_node",
  entityName: "agent node",
  schema: AgentNodeSchema,
  selectAll: () => ws().agentNodes ?? [],
  upsert: (x) => ws().upsertAgentNode(x),
  remove: (id) => ws().removeAgentNode(id),
  generateId: () => `agentNode_${nanoid(8)}`,
});

defineCrudActions<HitlReview>({
  toolId: "workspace.hitl_review",
  entityName: "HITL review",
  schema: HitlReviewSchema,
  selectAll: () => ws().hitlReviews ?? [],
  upsert: (x) => ws().upsertHitlReview(x),
  remove: (id) => ws().removeHitlReview(id),
  generateId: () => `hitlReview_${nanoid(8)}`,
});

defineCrudActions<RlhfPair>({
  toolId: "workspace.rlhf_pair",
  entityName: "RLHF pair",
  schema: RlhfPairSchema,
  selectAll: () => ws().rlhfPairs ?? [],
  upsert: (x) => ws().upsertRlhfPair(x),
  remove: (id) => ws().removeRlhfPair(id),
  generateId: () => `rlhfPair_${nanoid(8)}`,
});

defineCrudActions<VectorCollection>({
  toolId: "workspace.vector_collection",
  entityName: "vector collection",
  schema: VectorCollectionSchema,
  selectAll: () => ws().vectorCollections ?? [],
  upsert: (x) => ws().upsertVectorCollection(x),
  remove: (id) => ws().removeVectorCollection(id),
  generateId: () => `vectorCollection_${nanoid(8)}`,
});

/* ── S12b singleton-doc tools (ai-feature-spec, ai-safety-checklist,
 * model-migration). Each keeps ONE document per workspace under a fixed id
 * (see SINGLETON_ID in the matching tool action files). The generic CRUD
 * here still works, but the tool.<x>.* verbs operate on the singleton. */

const AiFeatureSpecSchema = z.object({
  id: z.string(),
  featureName: z.string(),
  problem: z.string(),
  modelChoice: z.string(),
  evalCriteria: z.string(),
  fallback: z.string(),
  latencyBudgetMs: z.string(),
  hallucinationTolerance: z.string(),
  costBudget: z.string(),
  humanLoop: z.string(),
  rolloutPlan: z.string(),
  successMetric: z.string(),
}) as unknown as z.ZodType<AiFeatureSpec>;

const AiSafetyChecklistSchema = z.object({
  id: z.string(),
  checks: z.record(z.string(), z.boolean()),
}) as unknown as z.ZodType<AiSafetyChecklist>;

const ModelMigrationSchema = z.object({
  id: z.string(),
  fromModel: z.string(),
  toModel: z.string(),
  evalDeltaPct: z.string(),
  costDeltaPct: z.string(),
  steps: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })),
}) as unknown as z.ZodType<ModelMigration>;

defineCrudActions<AiFeatureSpec>({
  toolId: "workspace.ai_feature_spec",
  entityName: "AI feature spec",
  schema: AiFeatureSpecSchema,
  selectAll: () => ws().aiFeatureSpecs ?? [],
  upsert: (x) => ws().upsertAiFeatureSpec(x),
  remove: (id) => ws().removeAiFeatureSpec(id),
  generateId: () => `aiFeatureSpec_${nanoid(8)}`,
});

defineCrudActions<AiSafetyChecklist>({
  toolId: "workspace.ai_safety_checklist",
  entityName: "AI safety checklist",
  schema: AiSafetyChecklistSchema,
  selectAll: () => ws().aiSafetyChecklists ?? [],
  upsert: (x) => ws().upsertAiSafetyChecklist(x),
  remove: (id) => ws().removeAiSafetyChecklist(id),
  generateId: () => `aiSafetyChecklist_${nanoid(8)}`,
});

defineCrudActions<ModelMigration>({
  toolId: "workspace.model_migration",
  entityName: "model migration",
  schema: ModelMigrationSchema,
  selectAll: () => ws().modelMigrations ?? [],
  upsert: (x) => ws().upsertModelMigration(x),
  remove: (id) => ws().removeModelMigration(id),
  generateId: () => `modelMigration_${nanoid(8)}`,
});

/* ── S9 — Security & Compliance (singleton-doc tools). ThreatModel holds a
 * threats[] array under a fixed id (see SINGLETON_ID in the tool action
 * file); the nested Threat shape rides through as a typed array schema. */

const ThreatSchema = z.object({
  id: z.string(),
  service: z.string(),
  category: z.enum([
    "spoofing",
    "tampering",
    "repudiation",
    "information_disclosure",
    "denial_of_service",
    "elevation_of_privilege",
  ]),
  severity: z.number(),
  status: z.enum(["open", "mitigating", "mitigated", "accepted"]),
  mitigation: z.string().optional(),
  raisedAt: z.string(),
  mitigatedAt: z.string().optional(),
  description: z.string().optional(),
});

const ThreatModelSchema = z.object({
  id: z.string(),
  threats: z.array(ThreatSchema),
}) as unknown as z.ZodType<ThreatModel>;

defineCrudActions<ThreatModel>({
  toolId: "workspace.threat_model",
  entityName: "threat model",
  schema: ThreatModelSchema,
  selectAll: () => ws().threatModels ?? [],
  upsert: (x) => ws().upsertThreatModel(x),
  remove: (id) => ws().removeThreatModel(id),
  generateId: () => `threatModel_${nanoid(8)}`,
});

const VulnSchema = z.object({
  id: z.string(),
  cve: z.string().optional(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["open", "in_progress", "resolved", "accepted"]),
  openedAt: z.string(),
  resolvedAt: z.string().optional(),
  slaTargetDays: z.number(),
  owner: z.string().optional(),
  description: z.string().optional(),
});

const VulnBurndownSchema = z.object({
  id: z.string(),
  vulns: z.array(VulnSchema),
}) as unknown as z.ZodType<VulnBurndown>;

const ComplianceControlSchema = z.object({
  id: z.string(),
  controlId: z.string(),
  framework: z.enum(["soc2", "iso27001", "hipaa", "gdpr", "custom"]),
  title: z.string(),
  owner: z.string().optional(),
  status: z.enum(["not_started", "in_progress", "implemented", "verified"]),
  evidenceLinks: z.array(z.string()),
  description: z.string().optional(),
});

const ControlMapSchema = z.object({
  id: z.string(),
  controls: z.array(ComplianceControlSchema),
}) as unknown as z.ZodType<ControlMap>;

const A11yIssueSchema = z.object({
  id: z.string(),
  component: z.string(),
  wcagCriterion: z.string(),
  severity: z.enum(["critical", "serious", "moderate", "minor"]),
  status: z.enum(["open", "in_progress", "resolved"]),
  openedAt: z.string(),
  resolvedAt: z.string().optional(),
  description: z.string().optional(),
});

const A11yTrackerSchema = z.object({
  id: z.string(),
  issues: z.array(A11yIssueSchema),
}) as unknown as z.ZodType<A11yTracker>;

defineCrudActions<VulnBurndown>({
  toolId: "workspace.vuln_burndown",
  entityName: "vulnerability burndown",
  schema: VulnBurndownSchema,
  selectAll: () => ws().vulnBurndowns ?? [],
  upsert: (x) => ws().upsertVulnBurndown(x),
  remove: (id) => ws().removeVulnBurndown(id),
  generateId: () => `vulnBurndown_${nanoid(8)}`,
});

defineCrudActions<ControlMap>({
  toolId: "workspace.control_map",
  entityName: "compliance control map",
  schema: ControlMapSchema,
  selectAll: () => ws().controlMaps ?? [],
  upsert: (x) => ws().upsertControlMap(x),
  remove: (id) => ws().removeControlMap(id),
  generateId: () => `controlMap_${nanoid(8)}`,
});

defineCrudActions<A11yTracker>({
  toolId: "workspace.a11y_tracker",
  entityName: "accessibility tracker",
  schema: A11yTrackerSchema,
  selectAll: () => ws().a11yTrackers ?? [],
  upsert: (x) => ws().upsertA11yTracker(x),
  remove: (id) => ws().removeA11yTracker(id),
  generateId: () => `a11yTracker_${nanoid(8)}`,
});

/* ── S10 — Quality Engineering (singleton-doc tools). quality-cost is a pure
 * calculator (no entity) — its compute action lives in ../tools/. */

const TestPyramidSchema = z.object({
  id: z.string(),
  unit: z.number(),
  integration: z.number(),
  e2e: z.number(),
  description: z.string().optional(),
}) as unknown as z.ZodType<TestPyramid>;

const FlakyTestSchema = z.object({
  id: z.string(),
  name: z.string(),
  suite: z.string().optional(),
  owner: z.string().optional(),
  failureRate: z.number(),
  status: z.enum(["active", "quarantined", "fixed"]),
  firstSeenAt: z.string(),
  fixedAt: z.string().optional(),
  description: z.string().optional(),
});

const FlakyTestBoardSchema = z.object({
  id: z.string(),
  tests: z.array(FlakyTestSchema),
}) as unknown as z.ZodType<FlakyTestBoard>;

const PrSampleSchema = z.object({
  id: z.string(),
  prNumber: z.string().optional(),
  author: z.string(),
  openedAt: z.string(),
  mergedAt: z.string().optional(),
  reviewerCount: z.number(),
  commentCount: z.number(),
  linesChanged: z.number(),
  description: z.string().optional(),
});

const CodeReviewLogSchema = z.object({
  id: z.string(),
  samples: z.array(PrSampleSchema),
}) as unknown as z.ZodType<CodeReviewLog>;

defineCrudActions<TestPyramid>({
  toolId: "workspace.test_pyramid",
  entityName: "test pyramid",
  schema: TestPyramidSchema,
  selectAll: () => ws().testPyramids ?? [],
  upsert: (x) => ws().upsertTestPyramid(x),
  remove: (id) => ws().removeTestPyramid(id),
  generateId: () => `testPyramid_${nanoid(8)}`,
});

defineCrudActions<FlakyTestBoard>({
  toolId: "workspace.flaky_test_board",
  entityName: "flaky-test board",
  schema: FlakyTestBoardSchema,
  selectAll: () => ws().flakyTestBoards ?? [],
  upsert: (x) => ws().upsertFlakyTestBoard(x),
  remove: (id) => ws().removeFlakyTestBoard(id),
  generateId: () => `flakyTestBoard_${nanoid(8)}`,
});

defineCrudActions<CodeReviewLog>({
  toolId: "workspace.code_review_log",
  entityName: "code-review log",
  schema: CodeReviewLogSchema,
  selectAll: () => ws().codeReviewLogs ?? [],
  upsert: (x) => ws().upsertCodeReviewLog(x),
  remove: (id) => ws().removeCodeReviewLog(id),
  generateId: () => `codeReviewLog_${nanoid(8)}`,
});

/* ── S7 — Engineering Excellence (singleton-doc tools). */

const DoraSampleSchema = z.object({
  id: z.string(),
  quarter: z.string(),
  deployFreqPerWeek: z.number(),
  leadTimeHours: z.number(),
  changeFailRate: z.number(),
  mttrHours: z.number(),
  description: z.string().optional(),
  source: z.enum(["manual", "derived"]).optional(),
  derivedFrom: z
    .object({
      releases: z.number(),
      rolledBack: z.number(),
      items: z.number(),
      incidents: z.number(),
    })
    .optional(),
  updatedAt: z.string().optional(),
});

const DoraScorecardSchema = z.object({
  id: z.string(),
  samples: z.array(DoraSampleSchema),
}) as unknown as z.ZodType<DoraScorecard>;

const SloDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  sliDescription: z.string(),
  target: z.number(),
  windowDays: z.number(),
  description: z.string().optional(),
});

const SloBurnSchema = z.object({
  id: z.string(),
  sloId: z.string(),
  date: z.string(),
  errorMinutes: z.number(),
});

const SloBuilderSchema = z.object({
  id: z.string(),
  slos: z.array(SloDefinitionSchema),
  burns: z.array(SloBurnSchema),
}) as unknown as z.ZodType<SloBuilder>;

const SpaceScoreSchema = z.object({
  id: z.string(),
  quarter: z.string(),
  satisfaction: z.number(),
  performance: z.number(),
  activity: z.number(),
  communication: z.number(),
  efficiency: z.number(),
  description: z.string().optional(),
});

const SpacePulseSchema = z.object({
  id: z.string(),
  scores: z.array(SpaceScoreSchema),
}) as unknown as z.ZodType<SpacePulse>;

const DevexResponseSchema = z.object({
  id: z.string(),
  respondent: z.string(),
  date: z.string(),
  flowState: z.number(),
  feedbackLoops: z.number(),
  cognitiveLoad: z.number(),
  comments: z.string().optional(),
});

const DevexSurveySchema = z.object({
  id: z.string(),
  responses: z.array(DevexResponseSchema),
}) as unknown as z.ZodType<DevexSurvey>;

const PlatformMaturitySchema = z.object({
  id: z.string(),
  dimensions: z.record(z.string(), z.number()),
  notes: z.record(z.string(), z.string()),
}) as unknown as z.ZodType<PlatformMaturity>;

defineCrudActions<DoraScorecard>({
  toolId: "workspace.dora_scorecard",
  entityName: "DORA scorecard (singleton id doraScorecard:current)",
  schema: DoraScorecardSchema,
  selectAll: () => ws().doraScorecards ?? [],
  upsert: (x) => ws().upsertDoraScorecard(x),
  remove: (id) => ws().removeDoraScorecard(id),
  generateId: () => `doraScorecard_${nanoid(8)}`,
});

defineCrudActions<SloBuilder>({
  toolId: "workspace.slo_builder",
  entityName: "SLO builder",
  schema: SloBuilderSchema,
  selectAll: () => ws().sloBuilders ?? [],
  upsert: (x) => ws().upsertSloBuilder(x),
  remove: (id) => ws().removeSloBuilder(id),
  generateId: () => `sloBuilder_${nanoid(8)}`,
});

defineCrudActions<SpacePulse>({
  toolId: "workspace.space_pulse",
  entityName: "SPACE pulse",
  schema: SpacePulseSchema,
  selectAll: () => ws().spacePulses ?? [],
  upsert: (x) => ws().upsertSpacePulse(x),
  remove: (id) => ws().removeSpacePulse(id),
  generateId: () => `spacePulse_${nanoid(8)}`,
});

defineCrudActions<DevexSurvey>({
  toolId: "workspace.devex_survey",
  entityName: "DevEx survey",
  schema: DevexSurveySchema,
  selectAll: () => ws().devexSurveys ?? [],
  upsert: (x) => ws().upsertDevexSurvey(x),
  remove: (id) => ws().removeDevexSurvey(id),
  generateId: () => `devexSurvey_${nanoid(8)}`,
});

defineCrudActions<PlatformMaturity>({
  toolId: "workspace.platform_maturity",
  entityName: "platform maturity assessment",
  schema: PlatformMaturitySchema,
  selectAll: () => ws().platformMaturities ?? [],
  upsert: (x) => ws().upsertPlatformMaturity(x),
  remove: (id) => ws().removePlatformMaturity(id),
  generateId: () => `platformMaturity_${nanoid(8)}`,
});

/* ── S11 — Workshops & Facilitation (singleton-doc tools). */

const CharterRuleCategorySchema = z.enum([
  "communication",
  "meetings",
  "decisions",
  "work",
  "conflict",
  "other",
]);

// Consent, check-ins and versions are listed so an update keeps them
// (z.object drops keys it doesn't know).
const CharterConsentSchema = z.object({
  name: z.string().describe("The roster spelling when the person is on the team."),
  vote: z.enum(["consent", "concern", "object"]),
  note: z.string().optional(),
  at: z.string(),
});

const CharterRuleSchema = z.object({
  id: z.string(),
  category: CharterRuleCategorySchema,
  text: z.string(),
  agreedBy: z
    .array(z.string())
    .describe("Who agreed; derived from consent (the names voting consent) once that is set."),
  description: z.string().optional(),
  stillWorking: z
    .union([z.boolean(), z.literal("partly")])
    .optional()
    .describe("The draft of the check-in in progress: true, false or 'partly'."),
  consent: z.array(CharterConsentSchema).optional().describe("Each person's answer to the rule."),
});

const CharterMetaSchema = z.object({
  teamName: z.string().optional(),
  version: z.number(),
  publishedAt: z.string().optional(),
  description: z.string().optional(),
});

const CharterCheckInSchema = z.object({
  id: z.string(),
  date: IsoDay,
  sprintId: z.string().optional(),
  version: z.number().int().min(0).describe("The meta.version checked."),
  results: z
    .record(z.string(), z.enum(["working", "partly", "not_working"]))
    .describe("Rule id → result ('partly' counts as half); a rule left out was skipped."),
  ruleTexts: z.record(z.string(), z.string()).optional(),
  note: z.string().optional(),
});

const CharterVersionSchema = z.object({
  version: z.number().int().min(0),
  publishedAt: z.string(),
  teamName: z.string().optional(),
  description: z.string().optional(),
  rules: z.array(
    z.object({
      id: z.string(),
      category: CharterRuleCategorySchema,
      text: z.string(),
      description: z.string().optional(),
    })
  ),
});

const WorkingAgreementSchema = z.object({
  id: SingletonId(WORKING_AGREEMENT_ID),
  rules: z.array(CharterRuleSchema),
  meta: CharterMetaSchema,
  checkIns: z
    .array(CharterCheckInSchema)
    .optional()
    .describe("Saved check-ins, oldest first (the latest 52 are kept)."),
  versions: z
    .array(CharterVersionSchema)
    .optional()
    .describe("Published versions, oldest first (the latest 20 are kept)."),
}) as unknown as z.ZodType<WorkingAgreement>;

const LsFavoriteSchema = z.object({
  id: z.string(),
  structureId: z.string(),
  ts: z.string(),
});

const LiberatingStructuresSchema = z.object({
  id: z.string(),
  favorites: z.array(LsFavoriteSchema),
}) as unknown as z.ZodType<LiberatingStructures>;

const DesignSprintTaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  owner: z.string().optional(),
});

const DesignSprintOutputSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "long-term-goal",
    "sprint-question",
    "target",
    "sketch",
    "decision",
    "storyboard",
    "prototype",
    "finding",
    "note",
  ]),
  text: z.string(),
  url: z.string().optional(),
  signal: z.enum(["positive", "negative", "mixed"]).optional(),
  seenIn: z.number().int().min(0).max(5).optional(),
  answer: z.enum(["yes", "no", "unclear"]).optional(),
  sentTo: z.array(HandoffLinkSchema).optional(),
  createdAt: z.string().optional(),
});

const DesignSprintDaySchema = z.object({
  day: z.number(),
  dayName: z.enum(["Map", "Sketch", "Decide", "Prototype", "Test"]),
  tasks: z.array(DesignSprintTaskSchema),
  artifacts: z.array(z.string()),
  outputs: z.array(DesignSprintOutputSchema).optional(),
});

const DesignSprintPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  currentDay: z.number(),
  days: z.array(DesignSprintDaySchema),
  description: z.string().optional(),
  decider: z.string().optional(),
  facilitator: z.string().optional(),
  completedAt: z.string().optional(),
});

const DesignSprintSchema = z.object({
  id: z.string(),
  sprint: DesignSprintPlanSchema.nullable(),
}) as unknown as z.ZodType<DesignSprint>;

const AssumptionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  riskLevel: z.number(),
  evidenceLevel: z.number(),
  testIdea: z.string().optional(),
  status: z.enum(["untested", "testing", "validated", "invalidated"]),
  description: z.string().optional(),
});

const RiskiestAssumptionSchema = z.object({
  id: z.string(),
  assumptions: z.array(AssumptionSchema),
}) as unknown as z.ZodType<RiskiestAssumption>;

const WardleyComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  evolution: z.number(),
  visibility: z.number(),
  description: z.string().optional(),
});

const WardleyLinkSchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
});

const WardleyMapSchema = z.object({
  id: z.string(),
  components: z.array(WardleyComponentSchema),
  links: z.array(WardleyLinkSchema),
}) as unknown as z.ZodType<WardleyMap>;

defineCrudActions<WorkingAgreement>({
  toolId: "workspace.working_agreement",
  entityName: `working agreement (singleton id ${WORKING_AGREEMENT_ID})`,
  schema: WorkingAgreementSchema,
  selectAll: () => ws().workingAgreements ?? [],
  upsert: (x) => ws().upsertWorkingAgreement(x),
  remove: (id) => ws().removeWorkingAgreement(id),
  // No generateId: the page and tool.working_agreement.* read only the
  // singleton id (a generated `workingAgreement_<nanoid>` doc was an orphan
  // nothing showed), and create must name it so it never overwrites.
});

defineCrudActions<LiberatingStructures>({
  toolId: "workspace.liberating_structures",
  entityName: "liberating-structures favorites",
  schema: LiberatingStructuresSchema,
  selectAll: () => ws().liberatingStructures ?? [],
  upsert: (x) => ws().upsertLiberatingStructures(x),
  remove: (id) => ws().removeLiberatingStructures(id),
  generateId: () => `liberatingStructures_${nanoid(8)}`,
});

defineCrudActions<DesignSprint>({
  toolId: "workspace.design_sprint",
  entityName: "design sprint",
  schema: DesignSprintSchema,
  selectAll: () => ws().designSprints ?? [],
  upsert: (x) => ws().upsertDesignSprint(x),
  remove: (id) => ws().removeDesignSprint(id),
  generateId: () => `designSprint_${nanoid(8)}`,
});

defineCrudActions<RiskiestAssumption>({
  toolId: "workspace.riskiest_assumption",
  entityName: "riskiest-assumption canvas",
  schema: RiskiestAssumptionSchema,
  selectAll: () => ws().riskiestAssumptions ?? [],
  upsert: (x) => ws().upsertRiskiestAssumption(x),
  remove: (id) => ws().removeRiskiestAssumption(id),
  generateId: () => `riskiestAssumption_${nanoid(8)}`,
});

defineCrudActions<WardleyMap>({
  toolId: "workspace.wardley_map",
  entityName: "Wardley map",
  schema: WardleyMapSchema,
  selectAll: () => ws().wardleyMaps ?? [],
  upsert: (x) => ws().upsertWardleyMap(x),
  remove: (id) => ws().removeWardleyMap(id),
  generateId: () => `wardleyMap_${nanoid(8)}`,
});

/* ── S5 — Portfolio & Discovery (singleton-doc tools; each wraps a flat array). */

const EpicSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  startQuarter: z.string(),
  endQuarter: z.string(),
  progress: z.number(),
  owner: z.string().optional(),
  color: z.string().optional(),
});

const EpicRoadmapSchema = z.object({
  id: z.string(),
  epics: z.array(EpicSchema),
}) as unknown as z.ZodType<EpicRoadmap>;

const HypothesisSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  believe: z.string(),
  willDo: z.string(),
  toLearn: z.string(),
  successMetric: z.string(),
  experiment: z.string().optional(),
  outcome: z.string().optional(),
  status: z.enum(["drafted", "running", "validated", "invalidated", "inconclusive"]),
  raisedAt: z.string(),
  resolvedAt: z.string().optional(),
  sourceRef: HandoffRefSchema.optional(),
});

const HypothesisTrackerSchema = z.object({
  id: z.string(),
  hypotheses: z.array(HypothesisSchema),
}) as unknown as z.ZodType<HypothesisTracker>;

const InterviewQuoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
});

const InterviewSchema = z.object({
  id: z.string(),
  date: z.string(),
  participant: z.string(),
  context: z.string().optional(),
  quotes: z.array(InterviewQuoteSchema),
});

const UserInterviewLogSchema = z.object({
  id: z.string(),
  interviews: z.array(InterviewSchema),
}) as unknown as z.ZodType<UserInterviewLog>;

const PsychSafetyResponseSchema = z.object({
  id: z.string(),
  ts: z.string(),
  scores: z.record(z.string(), z.number()),
  respondent: z.string().optional(),
  description: z.string().optional(),
});

// A count of people: a whole number, never negative.
const PeopleCount = z.number().int().min(0);

// How many answered 1..5 to one question, raw (not reversed).
const PsychSafetyCountsSchema = z.tuple([
  PeopleCount,
  PeopleCount,
  PeopleCount,
  PeopleCount,
  PeopleCount,
]);

const PsychSafetyRoundSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: IsoDay,
  sprintId: z.string().optional(),
  source: z.enum(["room", "facilitator", "legacy"]),
  responses: PeopleCount.describe("How many people answered."),
  counts: z
    .object({
      q1: PsychSafetyCountsSchema,
      q2: PsychSafetyCountsSchema,
      q3: PsychSafetyCountsSchema,
      q4: PsychSafetyCountsSchema,
      q5: PsychSafetyCountsSchema,
      q6: PsychSafetyCountsSchema,
      q7: PsychSafetyCountsSchema,
    })
    .describe("Per question, how many answered 1, 2, 3, 4 and 5 (raw, not reversed)."),
  createdAt: z.string(),
  sentTo: z.array(HandoffLinkSchema).optional(),
});

const PsychSafetyLogSchema = z.object({
  id: z.string(),
  responses: z
    .array(PsychSafetyResponseSchema)
    .describe(
      "The answer sheets the tool kept one by one before rounds, each one person's answers. They are read as one legacy round and stay until the team deletes that round."
    ),
  rounds: z
    .array(PsychSafetyRoundSchema)
    .optional()
    .describe("Survey rounds as counts per question, oldest first."),
}) as unknown as z.ZodType<PsychSafetyLog>;

// A maturity level: a whole number 1-5.
const MaturityScore = z.number().int().min(1).max(5);

const MaturityAssessmentSchema = z.object({
  id: SingletonId(MATURITY_ID),
  scores: z
    .record(z.string(), MaturityScore)
    .describe(
      "The draft being scored: dimensionId -> level 1-5; a missing dimension is not scored."
    ),
  targetLevel: z.number(),
  history: z
    .array(
      z.object({
        id: z.string(),
        assessedAt: IsoDay,
        scores: z.record(z.string(), MaturityScore),
        targetLevel: MaturityScore.optional(),
        note: z.string().optional(),
      })
    )
    .optional()
    .describe("Saved assessments, oldest first. The latest one sets the workspace maturity level."),
}) as unknown as z.ZodType<MaturityAssessment>;

const HealthVotesSchema = z.object({
  green: PeopleCount,
  yellow: PeopleCount,
  red: PeopleCount,
});

const HealthDimensionScoreSchema = z.object({
  light: z.string(),
  // Optional at parse: it is stamped at save from the previous check.
  trend: z.string().optional().describe("Derived at save from the previous saved check."),
  votes: HealthVotesSchema.optional().describe("The vote counts the light came from."),
  note: z.string().max(500).optional(),
  sentTo: z.array(HandoffLinkSchema).optional(),
});

const HealthCheckSourceSchema = z.enum(["room", "facilitator"]);

const HealthCheckSnapshotSchema = z.object({
  sprintName: z.string(),
  scores: z.record(z.string(), HealthDimensionScoreSchema),
  sprintId: z.string().optional(),
  date: IsoDay.optional().describe("The day to save it under (backdated); absent: today."),
  rated: z
    .array(z.string())
    .optional()
    .describe("Dimension keys rated in this draft (built-in names and custom ids)."),
  customScores: z.record(z.string(), HealthDimensionScoreSchema).optional(),
  source: HealthCheckSourceSchema.optional(),
  responses: PeopleCount.optional(),
});

const HealthCheckSchema = z.object({
  id: z.string(),
  current: HealthCheckSnapshotSchema,
  history: z.array(
    z.object({
      id: z.string(),
      sprintName: z.string(),
      date: z.string(),
      scores: z.record(z.string(), HealthDimensionScoreSchema),
      sprintId: z.string().optional(),
      customScores: z.record(z.string(), HealthDimensionScoreSchema).optional(),
      source: HealthCheckSourceSchema.optional(),
      responses: PeopleCount.optional(),
    })
  ),
  customDimensions: z
    .array(
      z.object({
        id: z.string().describe('"custom-<id>": the key its lights use in customScores.'),
        name: z.string(),
        description: z.string().optional(),
        archived: z.boolean().optional(),
      })
    )
    .optional(),
}) as unknown as z.ZodType<HealthCheck>;

const SkillsMatrixEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

const SkillTargetLevelSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);

const SkillsMatrixSkillSchema = SkillsMatrixEntrySchema.extend({
  targetPeople: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("People needed at targetLevel or above; unset = no target."),
  targetLevel: SkillTargetLevelSchema.optional().describe("Default 2."),
});

const SkillsTrainingPairSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  learnerId: z.string(),
  mentorId: z.string().optional().describe("Unset = outside help."),
  toLevel: SkillTargetLevelSchema,
  createdAt: z.string(),
  due: z.string().optional(),
  doneAt: z.string().optional(),
});

const SkillsMatrixSchema = z.object({
  id: SingletonId(SKILLS_MATRIX_ID),
  members: z.array(SkillsMatrixEntrySchema),
  skills: z.array(SkillsMatrixSkillSchema),
  grid: z
    .record(z.string(), z.record(z.string(), z.number().int().min(0).max(4)))
    .describe("skillId -> column id -> level 0-4. A missing key is Not rated."),
  version: z
    .literal(2)
    .optional()
    .describe("2 once a 0 means rated None; on older docs a 0 reads as Not rated."),
  training: z.array(SkillsTrainingPairSchema).optional(),
}) as unknown as z.ZodType<SkillsMatrix>;

/* ── Phase 6 — Team & people singletons (DoD, RACI, ADKAR). */

const DodCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  category: z.enum(["code", "testing", "docs", "performance", "security", "other"]),
  required: z.boolean().describe("A story meets the DoD when every required criterion is ticked."),
  done: z
    .boolean()
    .optional()
    .describe("Deprecated team-level tick; read only for a release with no linked stories."),
});

const DefinitionOfDoneSchema = z.object({
  id: SingletonId(DOD_DOC_ID),
  items: z.array(DodCriterionSchema),
  history: z
    .array(
      z.object({
        sprintName: z.string(),
        totalRequired: z.number(),
        completed: z.number(),
        ts: z.string(),
      })
    )
    .describe("Pre-Phase-6 sprint snapshots, read-only."),
}) as unknown as z.ZodType<DefinitionOfDone>;

const RaciMatrixSchema = z.object({
  id: SingletonId(RACI_ID),
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      memberId: z
        .string()
        .optional()
        .describe("TeamMember.id when the column is one roster person; absent for a group role."),
    })
  ),
  activities: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string().optional() })
  ),
  cells: z
    .record(z.string(), z.record(z.string(), z.array(z.enum(["R", "A", "C", "I"]))))
    .describe(
      "Activity id → role id → letters: [], [R], [A], [A, R], [C] or [I]. A missing cell is empty."
    ),
}) as unknown as z.ZodType<RaciMatrix>;

const AdkarElementSchema = z.enum(ADKAR_ELEMENTS);
const AdkarScoreSchema = z.number().int().min(1).max(5);

const AdkarInitiativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  startDate: IsoDay,
  description: z.string().optional(),
  currentStage: AdkarElementSchema,
  stagesCompleted: z
    .array(AdkarElementSchema)
    .optional()
    .describe("Legacy; derived from currentStage."),
  stageHistory: z
    .array(z.object({ stage: AdkarElementSchema, enteredAt: IsoDay }))
    .describe("Oldest first; entry 0 is { awareness, startDate }."),
  groups: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        scores: z
          .partialRecord(AdkarElementSchema, AdkarScoreSchema)
          .describe("Element → score 1-5; a missing element is not scored."),
        assessedAt: IsoDay.optional(),
        note: z.string().optional(),
      })
    )
    .optional(),
});

const AdkarDocSchema = z.object({
  id: SingletonId(ADKAR_DOC_ID),
  initiatives: z.array(AdkarInitiativeSchema),
}) as unknown as z.ZodType<AdkarDoc>;

const PokerEstimationLogSchema = z.object({
  id: z.string(),
  estimates: z.array(
    z.object({
      id: z.string(),
      storyTitle: z.string(),
      finalEstimate: z.string(),
      scaleType: z.string(),
      votes: z.array(z.string()).optional(),
      decidedAt: z.string(),
      sourceRef: HandoffRefSchema.optional(),
    })
  ),
  queue: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        sourceRef: HandoffRefSchema,
        queuedAt: z.string(),
        sessionStoryId: z.string().optional(),
      })
    )
    .optional(),
}) as unknown as z.ZodType<PokerEstimationLog>;

const TreeNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["outcome", "opportunity", "solution", "experiment"]),
  text: z.string(),
  parentId: z.string().nullable(),
  evidence: z.string().optional(),
  description: z.string().optional(),
});

const OpportunityTreeSchema = z.object({
  id: z.string(),
  nodes: z.array(TreeNodeSchema),
}) as unknown as z.ZodType<OpportunityTree>;

// S8 — Incidents & Reliability
const RunbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  freshness: z.number().int().min(1).max(5),
  completeness: z.number().int().min(1).max(5),
  testedRecently: z.boolean(),
  description: z.string().optional(),
});

const RunbookScorerSchema = z.object({
  id: z.string(),
  runbooks: z.array(RunbookSchema),
}) as unknown as z.ZodType<RunbookScorer>;

const ReleaseShipSchema = z.object({
  shippedDate: z.string(),
  rolledBackAt: z.string().optional(),
  gateIds: z.array(z.string()).optional(),
  gates: z.record(z.string(), z.boolean()).optional(),
  gatesOpenAtShip: z.number().optional(),
});

const ReleaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  plannedDate: z.string(),
  status: z.enum(["planning", "shipped", "rolled_back"]),
  shippedDate: z.string().optional(),
  gates: z.record(z.string(), z.boolean()),
  gatesOpenAtShip: z.number().optional(),
  description: z.string().optional(),
  gateIds: z.array(z.string()).optional().describe("Gates that applied, frozen at ship."),
  rolledBackAt: z.string().optional(),
  previousShips: z.array(ReleaseShipSchema).optional(),
  storyIds: z.array(z.string()).optional(),
});

const ReleaseGateDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  auto: z.enum(["flags", "dod"]).optional(),
  archived: z.boolean().optional(),
});

const ReleaseReadinessSchema = z.object({
  id: z.string(),
  releases: z.array(ReleaseSchema),
  gates: z.array(ReleaseGateDefSchema).optional(),
}) as unknown as z.ZodType<ReleaseReadiness>;

const OncallShiftSchema = z.object({
  id: z.string(),
  person: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  description: z.string().optional(),
});

const OncallPageSchema = z.object({
  id: z.string(),
  shiftId: z.string(),
  ts: z.string(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  description: z.string().optional(),
});

const OncallRosterSchema = z.object({
  id: z.string(),
  shifts: z.array(OncallShiftSchema),
  pages: z.array(OncallPageSchema),
  expectedPagesPerWeek: z.number().optional(),
}) as unknown as z.ZodType<OncallRoster>;

const IncidentTimelineEntrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  author: z.string(),
  text: z.string(),
});

const IncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  status: z.enum(["active", "mitigated", "resolved"]),
  openedAt: z.string(),
  resolvedAt: z.string().optional(),
  commander: z.string().optional(),
  scribe: z.string().optional(),
  description: z.string().optional(),
  timeline: z.array(IncidentTimelineEntrySchema),
});

const IncidentCommanderSchema = z.object({
  id: z.string(),
  incidents: z.array(IncidentSchema),
}) as unknown as z.ZodType<IncidentCommander>;

const PostMortemActionSchema = z.object({
  id: z.string(),
  text: z.string(),
  owner: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["open", "in_progress", "done"]),
});

const PostMortemSchema = z.object({
  id: z.string(),
  title: z.string(),
  incidentDate: z.string(),
  status: z.enum(["draft", "review", "published"]),
  summary: z.string().optional(),
  contributingFactors: z.array(z.string()),
  timeline: z.array(IncidentTimelineEntrySchema),
  actions: z.array(PostMortemActionSchema),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  publishedAt: z.string().optional(),
});

const PostMortemLogSchema = z.object({
  id: z.string(),
  postmortems: z.array(PostMortemSchema),
}) as unknown as z.ZodType<PostMortemLog>;

defineCrudActions<EpicRoadmap>({
  toolId: "workspace.epic_roadmap",
  entityName: "epic roadmap",
  schema: EpicRoadmapSchema,
  selectAll: () => ws().epicRoadmaps ?? [],
  upsert: (x) => ws().upsertEpicRoadmap(x),
  remove: (id) => ws().removeEpicRoadmap(id),
  generateId: () => `epicRoadmap_${nanoid(8)}`,
});

defineCrudActions<HypothesisTracker>({
  toolId: "workspace.hypothesis_tracker",
  entityName: "hypothesis tracker",
  schema: HypothesisTrackerSchema,
  selectAll: () => ws().hypothesisTrackers ?? [],
  upsert: (x) => ws().upsertHypothesisTracker(x),
  remove: (id) => ws().removeHypothesisTracker(id),
  generateId: () => `hypothesisTracker_${nanoid(8)}`,
});

defineCrudActions<UserInterviewLog>({
  toolId: "workspace.user_interview_log",
  entityName: "user-interview log",
  schema: UserInterviewLogSchema,
  selectAll: () => ws().userInterviewLogs ?? [],
  upsert: (x) => ws().upsertUserInterviewLog(x),
  remove: (id) => ws().removeUserInterviewLog(id),
  generateId: () => `userInterviewLog_${nanoid(8)}`,
});

defineCrudActions<PsychSafetyLog>({
  toolId: "workspace.psych_safety_log",
  entityName: "psych-safety log",
  schema: PsychSafetyLogSchema,
  selectAll: () => ws().psychSafetyLogs ?? [],
  upsert: (x) => ws().upsertPsychSafetyLog(x),
  remove: (id) => ws().removePsychSafetyLog(id),
  generateId: () => `psychSafetyLog_${nanoid(8)}`,
  // kindFromToolId("workspace.psych_safety_log") → "workspace:psychSafetyLog",
  // but the browser sync engine registers this collection — and the
  // tool.psych_safety.* verbs write — under "workspace:psychSafety"
  // (registerCollection("psychSafety", ...) in workspace-store.ts). Without
  // this override the MCP CRUD writes/reads an orphaned kind the app never
  // syncs, so create/update/delete vanish and list always returns [].
  serverKind: "workspace:psychSafety",
});

// The page and tool.maturity.* read only MATURITY_ID, so there is no
// generateId (see SingletonId): a minted `maturityAssessment_<nanoid>` doc
// was an orphan no page showed, and create must name the id so it never
// overwrites.
defineCrudActions<MaturityAssessment>({
  toolId: "workspace.maturity_assessment",
  entityName: `maturity assessment (singleton id ${MATURITY_ID})`,
  schema: MaturityAssessmentSchema,
  selectAll: () => ws().maturityAssessments ?? [],
  upsert: (x) => ws().upsertMaturityAssessment(x),
  remove: (id) => ws().removeMaturityAssessment(id),
});

defineCrudActions<HealthCheck>({
  toolId: "workspace.health_check",
  entityName: "health check",
  schema: HealthCheckSchema,
  selectAll: () => ws().healthChecks ?? [],
  upsert: (x) => ws().upsertHealthCheck(x),
  remove: (id) => ws().removeHealthCheck(id),
  generateId: () => `healthCheck_${nanoid(8)}`,
});

// Like the maturity assessment: the page and tool.skills_matrix.* read only
// SKILLS_MATRIX_ID, so create needs it and there is no generateId.
defineCrudActions<SkillsMatrix>({
  toolId: "workspace.skills_matrix",
  entityName: `skills matrix (singleton id ${SKILLS_MATRIX_ID})`,
  schema: SkillsMatrixSchema,
  selectAll: () => ws().skillsMatrices ?? [],
  upsert: (x) => ws().upsertSkillsMatrix(x),
  remove: (id) => ws().removeSkillsMatrix(id),
});

// Phase 6 singletons: each tool reads only its fixed id, so the schema's id is
// that literal and there is no generateId (see SingletonId): create needs the
// id and refuses when the document exists. The toolId suffixes camelCase to
// the kinds the browser registers (DOD_KIND, RACI_KIND, ADKAR_KIND), so no
// serverKind override is needed.
defineCrudActions<DefinitionOfDone>({
  toolId: "workspace.definition_of_done",
  entityName: `Definition of Done (singleton id ${DOD_DOC_ID})`,
  schema: DefinitionOfDoneSchema,
  selectAll: () => ws().definitionsOfDone ?? [],
  upsert: (x) => ws().upsertDefinitionOfDone(x),
  remove: (id) => ws().removeDefinitionOfDone(id),
});

defineCrudActions<RaciMatrix>({
  toolId: "workspace.raci_matrix",
  entityName: `RACI matrix (singleton id ${RACI_ID})`,
  schema: RaciMatrixSchema,
  selectAll: () => ws().raciMatrices ?? [],
  upsert: (x) => ws().upsertRaciMatrix(x),
  remove: (id) => ws().removeRaciMatrix(id),
});

defineCrudActions<AdkarDoc>({
  toolId: "workspace.adkar_doc",
  entityName: `ADKAR initiatives document (singleton id ${ADKAR_DOC_ID})`,
  schema: AdkarDocSchema,
  selectAll: () => ws().adkarDocs ?? [],
  upsert: (x) => ws().upsertAdkarDoc(x),
  remove: (id) => ws().removeAdkarDoc(id),
});

defineCrudActions<PokerEstimationLog>({
  toolId: "workspace.poker_estimation_log",
  entityName: "poker estimation log",
  schema: PokerEstimationLogSchema,
  selectAll: () => ws().pokerEstimationLogs ?? [],
  upsert: (x) => ws().upsertPokerEstimationLog(x),
  remove: (id) => ws().removePokerEstimationLog(id),
  generateId: () => `pokerEstimationLog_${nanoid(8)}`,
});

defineCrudActions<OpportunityTree>({
  toolId: "workspace.opportunity_tree",
  entityName: "opportunity solution tree",
  schema: OpportunityTreeSchema,
  selectAll: () => ws().opportunityTrees ?? [],
  upsert: (x) => ws().upsertOpportunityTree(x),
  remove: (id) => ws().removeOpportunityTree(id),
  generateId: () => `opportunityTree_${nanoid(8)}`,
});

defineCrudActions<RunbookScorer>({
  toolId: "workspace.runbook_scorer",
  entityName: "runbook scorecard",
  schema: RunbookScorerSchema,
  selectAll: () => ws().runbookScorers ?? [],
  upsert: (x) => ws().upsertRunbookScorer(x),
  remove: (id) => ws().removeRunbookScorer(id),
  generateId: () => `runbookScorer_${nanoid(8)}`,
});

defineCrudActions<ReleaseReadiness>({
  toolId: "workspace.release_readiness",
  entityName: "release readiness board",
  schema: ReleaseReadinessSchema,
  selectAll: () => ws().releaseReadinesses ?? [],
  upsert: (x) => ws().upsertReleaseReadiness(x),
  remove: (id) => ws().removeReleaseReadiness(id),
  generateId: () => `releaseReadiness_${nanoid(8)}`,
});

defineCrudActions<OncallRoster>({
  toolId: "workspace.oncall_roster",
  entityName: "on-call roster",
  schema: OncallRosterSchema,
  selectAll: () => ws().oncallRosters ?? [],
  upsert: (x) => ws().upsertOncallRoster(x),
  remove: (id) => ws().removeOncallRoster(id),
  generateId: () => `oncallRoster_${nanoid(8)}`,
});

defineCrudActions<IncidentCommander>({
  toolId: "workspace.incident_commander",
  entityName: "incident board",
  schema: IncidentCommanderSchema,
  selectAll: () => ws().incidentCommanders ?? [],
  upsert: (x) => ws().upsertIncidentCommander(x),
  remove: (id) => ws().removeIncidentCommander(id),
  generateId: () => `incidentCommander_${nanoid(8)}`,
});

defineCrudActions<PostMortemLog>({
  toolId: "workspace.post_mortem",
  entityName: "post-mortem log",
  schema: PostMortemLogSchema,
  selectAll: () => ws().postMortemLogs ?? [],
  upsert: (x) => ws().upsertPostMortemLog(x),
  remove: (id) => ws().removePostMortemLog(id),
  generateId: () => `postMortemLog_${nanoid(8)}`,
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 20 — Prioritization
 * ────────────────────────────────────────────────────────────────── */

const PrioritizationItemSchema = z.object({
  id: z.string(),
  framework: z.enum([
    "rice",
    "ice",
    "moscow",
    "kano",
    "wsjf",
    "cost-of-delay",
    "value-effort",
    "buy-feature",
    "hundred-dollar",
    "eisenhower",
    "walking-skeleton",
  ]),
  title: z.string(),
  description: z.string().optional(),
  score: z.number().optional(),
  fields: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  status: z.enum(["open", "scored", "decided", "shipped", "dropped"]).optional(),
  updatedAt: z.string(),
  backlogItemId: z.string().optional(),
  sentTo: z
    .array(HandoffLinkSchema)
    .optional()
    .describe("Where this row was sent (a funded Buy-a-Feature feature: a backlog story)."),
}) as unknown as z.ZodType<PrioritizationItem>;

defineCrudActions<PrioritizationItem>({
  toolId: "workspace.prioritization",
  entityName: "prioritization item",
  schema: PrioritizationItemSchema,
  selectAll: () => ws().prioritizations ?? [],
  upsert: (x) => ws().upsertPrioritization(x),
  remove: (id) => ws().removePrioritization(id),
  generateId: () => `prio_${nanoid(8)}`,
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 7 — Prioritize & decide: group allocation rounds and the
 * Buy-a-Feature game
 * ────────────────────────────────────────────────────────────────── */

// Whole units of play money: the vote-room kit's allocation budget bounds.
const AllocationBudget = z.number().int().min(10).max(9_999);
const AllocationUnit = z.string().max(4);

const AllocationRoundSchema = z.object({
  id: z.string(),
  tool: z.enum(ALLOCATION_ROUND_TOOLS),
  roundId: z.string().describe('The live round\'s id, or "tally-<base36>" for a count entry.'),
  title: z.string(),
  budget: AllocationBudget.describe("Whole units each person split."),
  unit: AllocationUnit.describe('Shown before amounts, e.g. "$".'),
  spendAll: z
    .boolean()
    .describe("true: each split used the whole budget ($100 Test); false: up to it."),
  date: IsoDay.describe("The day the round is for (can be backdated)."),
  closedAt: z.string(),
  minN: PeopleCount.min(1).describe("The fewest answers the totals showed from."),
  ballots: PeopleCount.describe("How many people answered."),
  source: z.enum(["room", "facilitator"]),
  bandEdges: z
    .array(z.number().int().min(0))
    .describe("Lower edge of each band, ascending from 0."),
  items: z
    .array(
      z.object({
        itemId: z.string().describe("The prioritization row this line was."),
        text: z.string(),
        cap: z.number().int().min(0).optional(),
        total: z.number().int().min(0).describe("Everyone's amounts on the item, added up."),
        backers: PeopleCount.nullable().describe(
          "People who gave it more than 0; null when the spread was withheld."
        ),
        bands: z
          .array(PeopleCount)
          .nullable()
          .describe(
            "People per band; null when withheld (under 5 answers, or totals typed by hand)."
          ),
      })
    )
    // The kit's sheets hold at most 20 items.
    .max(20)
    .describe("Aggregates per item only, never anyone's split."),
}) as unknown as z.ZodType<AllocationRound>;

defineCrudActions<AllocationRound>({
  toolId: "workspace.allocation_round",
  entityName: "anonymous allocation round",
  schema: AllocationRoundSchema,
  selectAll: () => ws().allocationRounds ?? [],
  upsert: (x) => ws().upsertAllocationRound(x),
  remove: (id) => ws().removeAllocationRound(id),
  generateId: () => `allocationRound_${nanoid(8)}`,
});

const BuyAFeatureGameSchema = z.object({
  id: SingletonId(BUY_A_FEATURE_ID),
  budgetPerPlayer: AllocationBudget.optional().describe(
    "Play money each player gets. Unset until the facilitator sets it."
  ),
  players: z
    .number()
    .int()
    .min(1)
    .max(999)
    .optional()
    .describe("Players in the game. Unset until set (never assumed from the roster)."),
  unit: AllocationUnit.optional().describe('Shown before amounts, e.g. "$".'),
  updatedAt: z.string(),
}) as unknown as z.ZodType<BuyAFeatureGame>;

// A singleton like the Phase 6 documents: the page and tool.buy_a_feature.*
// read only BUY_A_FEATURE_ID, so there is no generateId and create needs the
// id (see SingletonId). The kind kindFromToolId derives is BUY_A_FEATURE_KIND.
defineCrudActions<BuyAFeatureGame>({
  toolId: "workspace.buy_a_feature_game",
  entityName: `Buy-a-Feature game settings (singleton id ${BUY_A_FEATURE_ID})`,
  schema: BuyAFeatureGameSchema,
  selectAll: () => ws().buyAFeatureGames ?? [],
  upsert: (x) => ws().upsertBuyAFeatureGame(x),
  remove: (id) => ws().removeBuyAFeatureGame(id),
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 21 — Decision Frameworks
 * ────────────────────────────────────────────────────────────────── */

const DACIDecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  driver: z.string().optional(),
  approver: z.string().optional(),
  contributors: z.array(z.string()).optional(),
  informed: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
  recommendation: z.string().optional(),
  status: z.enum(["open", "decided", "implemented", "revisit"]),
  date: z.string(),
}) as unknown as z.ZodType<DACIDecision>;

const RAPIDDecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  recommend: z.string().optional(),
  agree: z.array(z.string()).optional(),
  perform: z.array(z.string()).optional(),
  input: z.array(z.string()).optional(),
  decide: z.string().optional(),
  status: z.enum(["open", "decided", "implemented"]),
  date: z.string(),
}) as unknown as z.ZodType<RAPIDDecision>;

const WeightedMatrixIdField = z
  .string()
  .optional()
  .describe(`The matrix it is in; absent: the default matrix (${DEFAULT_WEIGHTED_MATRIX_ID}).`);

const WeightedOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  scores: z.record(z.string(), z.number()),
  matrixId: WeightedMatrixIdField,
  note: z.string().optional().describe("Why it scored as it did, or a caveat."),
}) as unknown as z.ZodType<WeightedOption>;

const WeightedCriterionSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight: z.number().min(0),
  matrixId: WeightedMatrixIdField,
  low: z.string().optional().describe("What a score of 1 means on this criterion."),
  high: z.string().optional().describe("What a score of 10 means on this criterion."),
}) as unknown as z.ZodType<WeightedCriterion>;

const WeightedMatrixSchema = z.object({
  id: z.string(),
  name: z.string(),
  question: z
    .string()
    .optional()
    .describe("What is being decided; becomes the decision record's title."),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  sentTo: z
    .array(HandoffLinkSchema)
    .optional()
    .describe("Where the result went (a decision record)."),
}) as unknown as z.ZodType<WeightedMatrix>;

const SixHatsHatSchema = z.enum(["white", "red", "black", "yellow", "green", "blue"]);

const SixHatsThoughtSchema = z.object({
  id: z.string(),
  hat: SixHatsHatSchema,
  text: z.string(),
  loggedAt: z.string(),
  sessionId: z.string().optional(),
}) as unknown as z.ZodType<SixHatsThought>;

const SixHatsSessionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  order: z.array(SixHatsHatSchema),
  roundMinutes: z.number(),
  currentRound: z.number().int().min(0).optional(),
  summary: z.string().optional(),
  startedAt: z.string(),
  closedAt: z.string().optional(),
  sentTo: z.array(HandoffLinkSchema).optional(),
}) as unknown as z.ZodType<SixHatsSession>;

const OODACycleSchema = z.object({
  id: z.string(),
  topic: z.string(),
  observe: z.string().optional(),
  orient: z.string().optional(),
  decide: z.string().optional(),
  act: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
}) as unknown as z.ZodType<OODACycle>;

const CynefinItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  domain: z.enum(["clear", "complicated", "complex", "chaotic", "confused"]),
  rationale: z.string().optional(),
  recommendedAction: z.string().optional(),
  loggedAt: z.string(),
}) as unknown as z.ZodType<CynefinItem>;

const PolaritySchema = z.object({
  id: z.string(),
  title: z.string(),
  greaterPurpose: z.string().optional(),
  deeperFear: z.string().optional(),
}) as unknown as z.ZodType<Polarity>;

const SosEntrySchema = z.object({
  id: z.string(),
  meetingDate: z.string(),
  team: z.string(),
  kind: z.enum(["blocker", "dependency", "decision", "update"]),
  text: z.string(),
  blockedBy: z.string().optional(),
  status: z.enum(["open", "resolved"]),
  resolvedAt: z.string().optional(),
  loggedAt: z.string(),
}) as unknown as z.ZodType<SosEntry>;

const AsyncUpdateSchema = z.object({
  id: z.string(),
  member: z.string(),
  date: z.string(),
  yesterday: z.string(),
  today: z.string(),
  blockers: z.string().optional(),
  description: z.string().optional(),
}) as unknown as z.ZodType<AsyncUpdate>;

const StandupEntrySchema = z.object({
  id: z.string(),
  member: z.string(),
  date: z.string(),
  yesterday: z.string(),
  today: z.string(),
  blockers: z.string(),
  timestamp: z.number(),
  blockerResolved: z.boolean().optional(),
  sentTo: z.array(HandoffLinkSchema).optional(),
  mode: z.enum(["live", "async"]).optional(),
  description: z.string().optional(),
}) as unknown as z.ZodType<StandupEntry>;

const SprintReviewSchema = z.object({
  id: z.string(),
  sprintId: z.string().optional(),
  sprintName: z.string(),
  sprintNumber: z.string(),
  features: z.array(z.record(z.string(), z.unknown())),
  meetingDate: z.string(),
  feedbackItems: z.array(z.record(z.string(), z.unknown())),
  checklistItems: z.array(z.record(z.string(), z.unknown())),
  committed: z.number(),
  completed: z.number(),
  totalBacklog: z.number(),
  backlogDone: z.number(),
}) as unknown as z.ZodType<SprintReview>;

const RetroBoardSchema = z.object({
  id: z.string(),
  format: z.record(z.string(), z.unknown()),
  phase: z.enum(["write", "vote", "discuss", "actions"]),
  cards: z.array(z.record(z.string(), z.unknown())),
  userVotes: z.number(),
  timerSeconds: z.number(),
  timerRunning: z.boolean(),
  discussingIndex: z.number(),
  archivedAt: z.string().optional(),
  previousRetroId: z.string().optional(),
  votesBy: z.record(z.string(), z.number()).optional(),
  sprintId: z.string().optional(),
}) as unknown as z.ZodType<RetroBoard>;

const SprintGoalSchema = z.object({
  id: z.string(),
  businessObjective: z.string(),
  goal: z.string(),
  criteria: z.array(z.object({ id: z.string(), text: z.string(), relevantChecked: z.boolean() })),
  keyResults: z.array(z.string()),
  sprintId: z
    .string()
    .optional()
    .describe("The sprint this goal is for (id sprint-goal:sprint:<sprintId>)."),
  okrIds: z.array(z.string()).optional().describe("Linked OKR ids."),
  outcome: z
    .object({
      met: z.enum(["met", "partly", "not-met"]),
      note: z.string().optional(),
      decidedAt: z.string(),
    })
    .optional()
    .describe("Whether the sprint met its goal, answered when it ends."),
}) as unknown as z.ZodType<SprintGoal>;

const JobStorySchema = z.object({
  id: z.string(),
  situation: z.string(),
  motivation: z.string(),
  outcome: z.string(),
  parentJobId: z.string().optional(),
  description: z.string().optional(),
  opportunityId: z
    .string()
    .optional()
    .describe("The Opportunity Tree node (kind opportunity) this job serves."),
}) as unknown as z.ZodType<JobStory>;

const CapacityPlanSchema = z.object({
  id: z.string(),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      description: z.string().optional(),
      availability: z.number(),
      daysOff: z.number(),
      teamMemberId: z.string().optional(),
    })
  ),
  config: z.object({
    sprintDays: z.number(),
    ceremonyOverhead: z.number(),
    focusFactor: z.number(),
    hoursPerDay: z.number(),
    pointsCommitted: z.string(),
  }),
  sprintId: z
    .string()
    .optional()
    .describe("The sprint this plan is for (id capacity-planner:sprint:<sprintId>)."),
}) as unknown as z.ZodType<CapacityPlan>;

const StoryMapSchema = z.object({
  id: z.string(),
  steps: z.array(z.object({ id: z.string(), name: z.string() })),
  slices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cards: z.record(
        z.string(),
        z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            color: z.string(),
            estimate: z.string().optional(),
            sentTo: z.array(HandoffLinkSchema).optional(),
          })
        )
      ),
    })
  ),
}) as unknown as z.ZodType<StoryMap>;

// Every method input is optional since Phase 7: a missing one is Not scored,
// never a default. The bounds stay as loose as before (any number), so no
// stored item stops validating on update; the method engine judges the scale.
const BacklogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  moscow: z
    .enum(["must", "should", "could", "wont"])
    .optional()
    .describe("MoSCoW bucket; absent: not sorted yet."),
  businessValue: z
    .number()
    .optional()
    .describe(
      "THE value: WSJF business value and the Value/Effort value axis, Fibonacci 1, 2, 3, 5, 8, 13, 20."
    ),
  timeCriticality: z.number().optional().describe("WSJF time criticality, Fibonacci 1-20."),
  riskReduction: z
    .number()
    .optional()
    .describe("WSJF risk reduction / opportunity enablement, Fibonacci 1-20."),
  jobSize: z.number().optional().describe("WSJF job size, Fibonacci 1-20."),
  reach: z.number().optional().describe("RICE reach: people per reachPeriod."),
  reachPeriod: z
    .enum(REACH_PERIODS)
    .optional()
    .describe("The period reach counts over; absent: per quarter."),
  impact: z.number().optional().describe("RICE impact: 3, 2, 1, 0.5 or 0.25 (exact value kept)."),
  confidence: z.number().optional().describe("RICE confidence, percent: 100, 80 or 50."),
  effort: z.number().optional().describe("RICE effort, person-months (minimum 0.5)."),
  value: z
    .number()
    .optional()
    .describe(
      "Deprecated, read-only: the old 1-10 matrix value, read only when businessValue is missing. Write businessValue instead."
    ),
  matrixEffort: z.number().optional().describe("Value/Effort effort, 1-10."),
  rank: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The decided order, 1 = first (set by the Prioritizer's Decide order)."),
  updatedAt: z.string().optional(),
}) as unknown as z.ZodType<BacklogItem>;

const NpsResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(["nps", "csat"]),
  date: z.string(),
  score: z.number(),
  respondent: z.string().optional(),
  verbatim: z.string().optional(),
}) as unknown as z.ZodType<NpsResponse>;

// A check-in's day. Before Phase 6 this CRUD and tool.mood_tracker.record took
// any string, so an agent may have stored a timestamp. One is read as its
// first ten characters, the day record itself derives from toISOString(), so
// an update to such a row stores the day instead of failing on it.
const MoodEntryDay = z.preprocess(
  (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v),
  IsoDay
);

const MoodEntrySchema = z.object({
  id: z.string(),
  memberId: z.string(),
  date: MoodEntryDay.describe("The day the check-in is for."),
  score: z.number().int().min(1).max(5).describe("1 rough … 5 great."),
  note: z.string().optional(),
  isPlaceholder: z.boolean().optional(),
  loggedAt: z
    .string()
    .optional()
    .describe("When it was entered (ISO), for a day filled in afterwards."),
}) as unknown as z.ZodType<MoodEntry>;

const MoodPulseSchema = z.object({
  id: z.string(),
  date: IsoDay.describe("The day the pulse is for (can be backdated)."),
  counts: z
    .object({ 1: PeopleCount, 2: PeopleCount, 3: PeopleCount, 4: PeopleCount, 5: PeopleCount })
    .describe("How many picked each face, 1 rough … 5 great. Counts only, never who."),
  source: z.enum(["room", "facilitator"]),
  createdAt: z.string(),
}) as unknown as z.ZodType<MoodPulse>;

const MoodTrackerDocSchema = z.object({
  id: SingletonId(MOOD_TRACKER_ID),
  mode: z
    .enum(["named", "anonymous"])
    .describe("named: each person logs a check-in; anonymous: team pulses only."),
  streaks: z
    .array(
      z.object({
        start: IsoDay,
        end: IsoDay,
        sentTo: z.array(HandoffLinkSchema).optional(),
      })
    )
    .optional()
    .describe("Low team-mood runs that went to the retro."),
}) as unknown as z.ZodType<MoodTrackerDoc>;

const KanbanBoardSchema = z.object({
  id: z.string(),
  cards: z.array(z.record(z.string(), z.unknown())),
  wipLimits: z.record(z.string(), z.number()),
}) as unknown as z.ZodType<KanbanBoard>;

const DependencyMapSchema = z.object({
  id: z.string(),
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
}) as unknown as z.ZodType<DependencyMap>;

const ValueStreamStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  processTime: z.number(),
  leadTime: z.number(),
  completeAccurate: z.number(),
  order: z.number().int().min(0).optional().describe("Position in its map, 0 first."),
  state: z.enum(["current", "future"]).optional().describe("Which map; absent reads as current."),
}) as unknown as z.ZodType<ValueStreamStage>;

const KpiThresholdSchema = z.object({ green: z.number(), amber: z.number() });

const HealthDashboardConfigSchema = z.object({
  id: SingletonId(HEALTH_DASHBOARD_ID),
  thresholds: z.record(z.string(), KpiThresholdSchema).optional(),
  sprintWindow: z.number().int().min(1).optional(),
  blockerWindowDays: z.number().int().min(1).optional(),
  cycleWindowDays: z.number().int().min(1).optional(),
  updatedAt: z.string().optional(),
}) as unknown as z.ZodType<HealthDashboardConfig>;

const FeatureFlagSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().optional(),
  status: z.enum(["on", "off", "retired"]),
  purpose: z.enum(["rollout", "experiment", "kill_switch", "permission"]),
  environment: z.enum(["dev", "staging", "prod", "all"]).optional(),
  createdAt: IsoDay,
  removeBy: IsoDay.optional(),
  retiredAt: IsoDay.optional(),
  releaseId: z.string().optional(),
  description: z.string().optional(),
  sentTo: z.array(HandoffLinkSchema).optional(),
}) as unknown as z.ZodType<FeatureFlag>;

defineCrudActions<HealthDashboardConfig>({
  toolId: "workspace.health_dashboard",
  entityName: `health dashboard settings (singleton id ${HEALTH_DASHBOARD_ID})`,
  schema: HealthDashboardConfigSchema,
  selectAll: () => ws().healthDashboards ?? [],
  upsert: (x) => ws().upsertHealthDashboard(x),
  remove: (id) => ws().removeHealthDashboard(id),
  // No generateId: create names the singleton id, so it refuses when the
  // settings exist instead of replacing them (see SingletonId).
});

defineCrudActions<FeatureFlag>({
  toolId: "workspace.feature_flag",
  entityName: "feature flag",
  schema: FeatureFlagSchema,
  selectAll: () => ws().featureFlags ?? [],
  upsert: (x) => ws().upsertFeatureFlag(x),
  remove: (id) => ws().removeFeatureFlag(id),
  generateId: () => `featureFlag_${nanoid(8)}`,
});

defineCrudActions<DACIDecision>({
  toolId: "workspace.daci_decision",
  entityName: "DACI decision",
  schema: DACIDecisionSchema,
  selectAll: () => ws().daciDecisions ?? [],
  upsert: (x) => ws().upsertDACIDecision(x),
  remove: (id) => ws().removeDACIDecision(id),
  generateId: () => `daci_${nanoid(8)}`,
});

defineCrudActions<RAPIDDecision>({
  toolId: "workspace.rapid_decision",
  entityName: "RAPID decision",
  schema: RAPIDDecisionSchema,
  selectAll: () => ws().rapidDecisions ?? [],
  upsert: (x) => ws().upsertRAPIDDecision(x),
  remove: (id) => ws().removeRAPIDDecision(id),
  generateId: () => `rapid_${nanoid(8)}`,
});

defineCrudActions<WeightedOption>({
  toolId: "workspace.weighted_option",
  entityName: "weighted-decision option",
  schema: WeightedOptionSchema,
  selectAll: () => ws().weightedOptions ?? [],
  upsert: (x) => ws().upsertWeightedOption(x),
  remove: (id) => ws().removeWeightedOption(id),
  generateId: () => `weightedOpt_${nanoid(8)}`,
});

// The criteria the page always kept (workspace:weightedCriterion) had no
// CRUD before Phase 7; kindFromToolId derives the kind the browser syncs.
defineCrudActions<WeightedCriterion>({
  toolId: "workspace.weighted_criterion",
  entityName: "weighted-decision criterion",
  schema: WeightedCriterionSchema,
  selectAll: () => ws().weightedCriteria ?? [],
  upsert: (x) => ws().upsertWeightedCriterion(x),
  remove: (id) => ws().removeWeightedCriterion(id),
  generateId: () => `weightedCrit_${nanoid(8)}`,
});

// Kind WEIGHTED_MATRIX_KIND (workspace:weightedMatrix), which kindFromToolId
// derives. Delete in the app also removes the matrix's options and criteria
// (removeWeightedMatrix); the server-side delete removes the matrix row only.
defineCrudActions<WeightedMatrix>({
  toolId: "workspace.weighted_matrix",
  entityName: "weighted-decision matrix",
  schema: WeightedMatrixSchema,
  selectAll: () => ws().weightedMatrices ?? [],
  upsert: (x) => ws().upsertWeightedMatrix(x),
  remove: (id) => ws().removeWeightedMatrix(id),
  generateId: () => `weightedMatrix_${nanoid(8)}`,
});

defineCrudActions<SixHatsThought>({
  toolId: "workspace.six_hats_thought",
  entityName: "Six Hats thought",
  schema: SixHatsThoughtSchema,
  selectAll: () => ws().sixHatsThoughts ?? [],
  upsert: (x) => ws().upsertSixHatsThought(x),
  remove: (id) => ws().removeSixHatsThought(id),
  generateId: () => `sixHats_${nanoid(8)}`,
});

defineCrudActions<SixHatsSession>({
  toolId: "workspace.six_hats_session",
  entityName: "Six Hats session",
  schema: SixHatsSessionSchema,
  selectAll: () => ws().sixHatsSessions ?? [],
  upsert: (x) => ws().upsertSixHatsSession(x),
  remove: (id) => ws().removeSixHatsSession(id),
  generateId: () => `sixHatsSession_${nanoid(8)}`,
});

defineCrudActions<OODACycle>({
  toolId: "workspace.ooda_cycle",
  entityName: "OODA cycle",
  schema: OODACycleSchema,
  selectAll: () => ws().oodaCycles ?? [],
  upsert: (x) => ws().upsertOODACycle(x),
  remove: (id) => ws().removeOODACycle(id),
  generateId: () => `ooda_${nanoid(8)}`,
});

defineCrudActions<CynefinItem>({
  toolId: "workspace.cynefin_item",
  entityName: "Cynefin item",
  schema: CynefinItemSchema,
  selectAll: () => ws().cynefinItems ?? [],
  upsert: (x) => ws().upsertCynefinItem(x),
  remove: (id) => ws().removeCynefinItem(id),
  generateId: () => `cynefin_${nanoid(8)}`,
});

defineCrudActions<Polarity>({
  toolId: "workspace.polarity",
  entityName: "polarity",
  schema: PolaritySchema,
  selectAll: () => ws().polarities ?? [],
  upsert: (x) => ws().upsertPolarity(x),
  remove: (id) => ws().removePolarity(id),
  generateId: () => `polarity_${nanoid(8)}`,
});

defineCrudActions<SosEntry>({
  toolId: "workspace.sos_entry",
  entityName: "Scrum of Scrums entry",
  schema: SosEntrySchema,
  selectAll: () => ws().sosEntries ?? [],
  upsert: (x) => ws().upsertSosEntry(x),
  remove: (id) => ws().removeSosEntry(id),
  generateId: () => `sos_${nanoid(8)}`,
});

defineCrudActions<AsyncUpdate>({
  toolId: "workspace.async_update",
  entityName: "async standup update",
  schema: AsyncUpdateSchema,
  selectAll: () => ws().asyncUpdates ?? [],
  upsert: (x) => ws().upsertAsyncUpdate(x),
  remove: (id) => ws().removeAsyncUpdate(id),
  generateId: () => `async_${nanoid(8)}`,
});

defineCrudActions<StandupEntry>({
  toolId: "workspace.standup_entry",
  entityName: "standup entry",
  schema: StandupEntrySchema,
  selectAll: () => ws().standupEntries ?? [],
  upsert: (x) => ws().upsertStandupEntry(x),
  remove: (id) => ws().removeStandupEntry(id),
  generateId: () => `standup_${nanoid(8)}`,
});

defineCrudActions<SprintReview>({
  toolId: "workspace.sprint_review",
  entityName: "sprint review",
  schema: SprintReviewSchema,
  selectAll: () => ws().sprintReviews ?? [],
  upsert: (x) => ws().upsertSprintReview(x),
  remove: (id) => ws().removeSprintReview(id),
  generateId: () => `sprintReview_${nanoid(8)}`,
});

defineCrudActions<RetroBoard>({
  toolId: "workspace.retro_board",
  entityName: "retro board",
  schema: RetroBoardSchema,
  selectAll: () => ws().retroBoards ?? [],
  upsert: (x) => ws().upsertRetroBoard(x),
  remove: (id) => ws().removeRetroBoard(id),
  generateId: () => `retro_${nanoid(8)}`,
});

defineCrudActions<SprintGoal>({
  toolId: "workspace.sprint_goal",
  entityName: "sprint goal",
  schema: SprintGoalSchema,
  selectAll: () => ws().sprintGoals ?? [],
  upsert: (x) => ws().upsertSprintGoal(x),
  remove: (id) => ws().removeSprintGoal(id),
  generateId: () => `sprintGoal_${nanoid(8)}`,
});

defineCrudActions<JobStory>({
  toolId: "workspace.job_story",
  entityName: "job story",
  schema: JobStorySchema,
  selectAll: () => ws().jobStories ?? [],
  upsert: (x) => ws().upsertJobStory(x),
  remove: (id) => ws().removeJobStory(id),
  generateId: () => `job_${nanoid(8)}`,
});

defineCrudActions<CapacityPlan>({
  toolId: "workspace.capacity_plan",
  entityName: "capacity plan",
  schema: CapacityPlanSchema,
  selectAll: () => ws().capacityPlans ?? [],
  upsert: (x) => ws().upsertCapacityPlan(x),
  remove: (id) => ws().removeCapacityPlan(id),
  generateId: () => `capacityPlan_${nanoid(8)}`,
});

defineCrudActions<StoryMap>({
  toolId: "workspace.story_map",
  entityName: "story map",
  schema: StoryMapSchema,
  selectAll: () => ws().storyMaps ?? [],
  upsert: (x) => ws().upsertStoryMap(x),
  remove: (id) => ws().removeStoryMap(id),
  generateId: () => `storyMap_${nanoid(8)}`,
});

defineCrudActions<BacklogItem>({
  toolId: "workspace.backlog_item",
  entityName: "backlog item",
  schema: BacklogItemSchema,
  selectAll: () => ws().backlogItems ?? [],
  upsert: (x) => ws().upsertBacklogItem(x),
  remove: (id) => ws().removeBacklogItem(id),
  generateId: () => `backlog_${nanoid(8)}`,
});

defineCrudActions<NpsResponse>({
  toolId: "workspace.nps_response",
  entityName: "NPS/CSAT response",
  schema: NpsResponseSchema,
  selectAll: () => ws().npsResponses ?? [],
  upsert: (x) => ws().upsertNpsResponse(x),
  remove: (id) => ws().removeNpsResponse(id),
  generateId: () => `nps_${nanoid(8)}`,
});

defineCrudActions<MoodEntry>({
  toolId: "workspace.mood_entry",
  entityName: "mood entry",
  schema: MoodEntrySchema,
  selectAll: () => ws().moodEntries ?? [],
  upsert: (x) => ws().upsertMoodEntry(x),
  remove: (id) => ws().removeMoodEntry(id),
  generateId: () => `mood_${nanoid(8)}`,
});

defineCrudActions<MoodPulse>({
  toolId: "workspace.mood_pulse",
  entityName: "anonymous mood pulse",
  schema: MoodPulseSchema,
  selectAll: () => ws().moodPulses ?? [],
  upsert: (x) => ws().upsertMoodPulse(x),
  remove: (id) => ws().removeMoodPulse(id),
  generateId: () => `moodPulse_${nanoid(8)}`,
});

// Kind MOOD_TRACKER_KIND (workspace:moodTrackerDoc), which is what
// kindFromToolId derives (the browser registers the same), so no serverKind
// override. A singleton: create needs MOOD_TRACKER_ID (see SingletonId).
defineCrudActions<MoodTrackerDoc>({
  toolId: "workspace.mood_tracker_doc",
  entityName: `mood tracker settings (singleton id ${MOOD_TRACKER_ID})`,
  schema: MoodTrackerDocSchema,
  selectAll: () => ws().moodTrackerDocs ?? [],
  upsert: (x) => ws().upsertMoodTrackerDoc(x),
  remove: (id) => ws().removeMoodTrackerDoc(id),
});

defineCrudActions<KanbanBoard>({
  toolId: "workspace.kanban_board",
  entityName: "kanban board",
  schema: KanbanBoardSchema,
  selectAll: () => ws().kanbanBoards ?? [],
  upsert: (x) => ws().upsertKanbanBoard(x),
  remove: (id) => ws().removeKanbanBoard(id),
  generateId: () => `kanban_${nanoid(8)}`,
});

defineCrudActions<DependencyMap>({
  toolId: "workspace.dependency_map",
  entityName: "dependency map",
  schema: DependencyMapSchema,
  selectAll: () => ws().dependencyMaps ?? [],
  upsert: (x) => ws().upsertDependencyMap(x),
  remove: (id) => ws().removeDependencyMap(id),
  generateId: () => `depmap_${nanoid(8)}`,
});

defineCrudActions<ValueStreamStage>({
  toolId: "workspace.value_stream_stage",
  entityName: "value-stream stage",
  schema: ValueStreamStageSchema,
  selectAll: () => ws().valueStreamStages ?? [],
  upsert: (x) => ws().upsertValueStreamStage(x),
  remove: (id) => ws().removeValueStreamStage(id),
  generateId: () => `vsstage_${nanoid(8)}`,
});

/* ────────────────────────────────────────────────────────────────────
 * Phase 22 — Canvas board (whiteboard) — board itself, not its objects.
 * Object-level actions live in `../tools/canvas.ts` because they have
 * canvas-specific semantics (z-ordering, world coords) that don't fit
 * the generic CRUD shape.
 * ────────────────────────────────────────────────────────────────── */

const WhiteboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultCamera: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  template: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) as unknown as z.ZodType<Whiteboard>;

defineCrudActions<Whiteboard>({
  toolId: "workspace.whiteboard",
  entityName: "whiteboard",
  schema: WhiteboardSchema,
  selectAll: () => ws().whiteboards ?? [],
  upsert: (x) => ws().upsertWhiteboard(x),
  remove: (id) => ws().removeWhiteboard(id),
  // A board id names its Realtime channels (tool:canvas:room:<id>), so it
  // must not be guessable: nanoid's full 21 characters (~126 bits).
  generateId: () => `wb_${nanoid()}`,
});
