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
import type {
  Sprint,
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
  RedTeamFinding,
  AgentWorkflow,
  AgentNode,
  HitlReview,
  RlhfPair,
  VectorCollection,
  AiFeatureSpec,
  AiSafetyChecklist,
  ModelMigration,
  // Phase 20 — Prioritization
  PrioritizationItem,
  // Phase 21 — Decision Frameworks
  DACIDecision,
  RAPIDDecision,
  WeightedOption,
  SixHatsThought,
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

const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  points: z.number().optional(),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]),
  sprintId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priorityScore: z.number().optional(),
  owner: z.string().optional(),
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

const DecisionSchema = z.object({
  id: z.string(),
  title: z.string(),
  context: z.string().optional(),
  decision: z.string(),
  consequences: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  status: z.enum(["proposed", "accepted", "deprecated", "superseded"]),
  date: z.string(),
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

defineCrudActions<Story>({
  toolId: "workspace.story",
  entityName: "story",
  schema: StorySchema,
  selectAll: () => ws().stories,
  upsert: (s) => ws().upsertStory(s),
  remove: (id) => ws().removeStory(id),
  generateId: () => `story_${nanoid(8)}`,
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
}) as unknown as z.ZodType<ModelEntry>;

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

const WeightedOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  scores: z.record(z.string(), z.number()),
}) as unknown as z.ZodType<WeightedOption>;

const SixHatsThoughtSchema = z.object({
  id: z.string(),
  hat: z.enum(["white", "red", "black", "yellow", "green", "blue"]),
  text: z.string(),
  loggedAt: z.string(),
}) as unknown as z.ZodType<SixHatsThought>;

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
}) as unknown as z.ZodType<StandupEntry>;

const SprintReviewSchema = z.object({
  id: z.string(),
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
}) as unknown as z.ZodType<RetroBoard>;

const SprintGoalSchema = z.object({
  id: z.string(),
  businessObjective: z.string(),
  goal: z.string(),
  criteria: z.array(z.object({ id: z.string(), text: z.string(), relevantChecked: z.boolean() })),
  keyResults: z.array(z.string()),
}) as unknown as z.ZodType<SprintGoal>;

const JobStorySchema = z.object({
  id: z.string(),
  situation: z.string(),
  motivation: z.string(),
  outcome: z.string(),
  parentJobId: z.string().optional(),
  description: z.string().optional(),
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
    })
  ),
  config: z.object({
    sprintDays: z.number(),
    ceremonyOverhead: z.number(),
    focusFactor: z.number(),
    hoursPerDay: z.number(),
    pointsCommitted: z.string(),
  }),
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
          })
        )
      ),
    })
  ),
}) as unknown as z.ZodType<StoryMap>;

const BacklogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  moscow: z.enum(["must", "should", "could", "wont"]),
  businessValue: z.number(),
  timeCriticality: z.number(),
  riskReduction: z.number(),
  jobSize: z.number(),
  reach: z.number(),
  impact: z.number(),
  confidence: z.number(),
  effort: z.number(),
  value: z.number(),
  matrixEffort: z.number(),
}) as unknown as z.ZodType<BacklogItem>;

const NpsResponseSchema = z.object({
  id: z.string(),
  kind: z.enum(["nps", "csat"]),
  date: z.string(),
  score: z.number(),
  respondent: z.string().optional(),
  verbatim: z.string().optional(),
}) as unknown as z.ZodType<NpsResponse>;

const MoodEntrySchema = z.object({
  id: z.string(),
  memberId: z.string(),
  date: z.string(),
  score: z.number(),
  note: z.string().optional(),
  isPlaceholder: z.boolean().optional(),
}) as unknown as z.ZodType<MoodEntry>;

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
}) as unknown as z.ZodType<ValueStreamStage>;

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

defineCrudActions<SixHatsThought>({
  toolId: "workspace.six_hats_thought",
  entityName: "Six Hats thought",
  schema: SixHatsThoughtSchema,
  selectAll: () => ws().sixHatsThoughts ?? [],
  upsert: (x) => ws().upsertSixHatsThought(x),
  remove: (id) => ws().removeSixHatsThought(id),
  generateId: () => `sixHats_${nanoid(8)}`,
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
  generateId: () => `wb_${nanoid(8)}`,
});
