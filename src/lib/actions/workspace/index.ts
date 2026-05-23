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
