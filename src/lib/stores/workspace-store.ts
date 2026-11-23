"use client";

import { create } from "zustand";
import {
  stampRefinedWrite,
  stampStoryMembership,
  withStorySprint,
} from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { persist, createJSONStorage } from "zustand/middleware";
import { reportStorageWriteFailure } from "./storage-health";
import type {
  Workspace,
  TeamMember,
  Sprint,
  SprintSeries,
  CeremonyCadenceDoc,
  Story,
  Impediment,
  Risk,
  Okr,
  Decision,
  TechDebtItem,
  MaturityLevel,
  // Phase 19 entity types
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
  ModelCard,
  // S12b singleton-doc tools
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
  PokerRound,
  // Phase 6 — Team & people
  DefinitionOfDone,
  RaciMatrix,
  AdkarDoc,
  MoodTrackerDoc,
  MoodPulse,
  // Phase 20
  PrioritizationItem,
  // Phase 7 — Prioritize & decide
  AllocationRound,
  BuyAFeatureGame,
  WeightedMatrix,
  // Phase 21
  DACIDecision,
  RAPIDDecision,
  WeightedOption,
  WeightedCriterion,
  SixHatsThought,
  SixHatsSession,
  OODACycle,
  CynefinItem,
  StaceyItem,
  Polarity,
  PolarityPole,
  // Phase 22 — Canvas
  Whiteboard,
  WhiteboardObject,
  WhiteboardCommentThread,
  WhiteboardGroup,
  WhiteboardSavedTemplate,
  WhiteboardActivityEvent,
  // Kudos wall
  Kudos,
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
  NpsResponse,
  MoodEntry,
  KanbanBoard,
  DependencyMap,
  ValueStreamStage,
  // Phase 42 — the tools plan's phase 1
  ParkingLotItem,
  RootCauseAnalysis,
  ProductGoal,
  InterruptItem,
  NotebookEntry,
  MeetingAudit,
} from "./workspace-types";
import { emptyWorkspace, weightedMatrixRemoval } from "./workspace-types";
import { parseKudos } from "@/lib/kudos/parse";
import { rowsUnlinkedFrom } from "@/lib/prioritization/binding";

interface WorkspaceActions {
  setTeamName: (name: string) => void;
  upsertTeamMember: (m: TeamMember) => void;
  removeTeamMember: (id: string) => void;
  upsertSprint: (s: Sprint) => void;
  removeSprint: (id: string) => void;
  upsertSprintSeries: (x: SprintSeries) => void;
  removeSprintSeries: (id: string) => void;
  upsertCeremonyCadence: (x: CeremonyCadenceDoc) => void;
  removeCeremonyCadence: (id: string) => void;
  upsertStory: (s: Story) => void;
  removeStory: (id: string) => void;
  /** `removeStory` for several stories in one write (the Undo of a paste or an import). */
  removeStories: (ids: readonly string[]) => void;
  upsertImpediment: (i: Impediment) => void;
  removeImpediment: (id: string) => void;
  upsertRisk: (r: Risk) => void;
  removeRisk: (id: string) => void;
  upsertOkr: (o: Okr) => void;
  removeOkr: (id: string) => void;
  upsertDecision: (d: Decision) => void;
  removeDecision: (id: string) => void;
  upsertTechDebt: (t: TechDebtItem) => void;
  removeTechDebt: (id: string) => void;
  setMaturityLevel: (level: MaturityLevel | undefined) => void;
  // Phase 19 — AI/LLM PM
  upsertLLMEval: (x: LLMEval) => void;
  removeLLMEval: (id: string) => void;
  upsertPrompt: (x: PromptVersion) => void;
  removePrompt: (id: string) => void;
  upsertHallucination: (x: Hallucination) => void;
  removeHallucination: (id: string) => void;
  upsertTokenSpend: (x: TokenSpend) => void;
  removeTokenSpend: (id: string) => void;
  upsertModel: (x: ModelEntry) => void;
  removeModel: (id: string) => void;
  upsertRedTeamFinding: (x: RedTeamFinding) => void;
  removeRedTeamFinding: (id: string) => void;
  upsertAgentWorkflow: (x: AgentWorkflow) => void;
  removeAgentWorkflow: (id: string) => void;
  upsertAgentNode: (x: AgentNode) => void;
  removeAgentNode: (id: string) => void;
  upsertHitlReview: (x: HitlReview) => void;
  removeHitlReview: (id: string) => void;
  upsertRlhfPair: (x: RlhfPair) => void;
  removeRlhfPair: (id: string) => void;
  upsertVectorCollection: (x: VectorCollection) => void;
  removeVectorCollection: (id: string) => void;
  upsertModelCard: (x: ModelCard) => void;
  removeModelCard: (id: string) => void;
  upsertAiFeatureSpec: (x: AiFeatureSpec) => void;
  removeAiFeatureSpec: (id: string) => void;
  upsertAiSafetyChecklist: (x: AiSafetyChecklist) => void;
  removeAiSafetyChecklist: (id: string) => void;
  upsertModelMigration: (x: ModelMigration) => void;
  removeModelMigration: (id: string) => void;
  upsertThreatModel: (x: ThreatModel) => void;
  removeThreatModel: (id: string) => void;
  upsertVulnBurndown: (x: VulnBurndown) => void;
  removeVulnBurndown: (id: string) => void;
  upsertControlMap: (x: ControlMap) => void;
  removeControlMap: (id: string) => void;
  upsertA11yTracker: (x: A11yTracker) => void;
  removeA11yTracker: (id: string) => void;
  upsertTestPyramid: (x: TestPyramid) => void;
  removeTestPyramid: (id: string) => void;
  upsertFlakyTestBoard: (x: FlakyTestBoard) => void;
  removeFlakyTestBoard: (id: string) => void;
  upsertCodeReviewLog: (x: CodeReviewLog) => void;
  removeCodeReviewLog: (id: string) => void;
  upsertDoraScorecard: (x: DoraScorecard) => void;
  removeDoraScorecard: (id: string) => void;
  upsertHealthDashboard: (x: HealthDashboardConfig) => void;
  removeHealthDashboard: (id: string) => void;
  upsertFeatureFlag: (x: FeatureFlag) => void;
  removeFeatureFlag: (id: string) => void;
  upsertSloBuilder: (x: SloBuilder) => void;
  removeSloBuilder: (id: string) => void;
  upsertSpacePulse: (x: SpacePulse) => void;
  removeSpacePulse: (id: string) => void;
  upsertDevexSurvey: (x: DevexSurvey) => void;
  removeDevexSurvey: (id: string) => void;
  upsertPlatformMaturity: (x: PlatformMaturity) => void;
  removePlatformMaturity: (id: string) => void;
  upsertWorkingAgreement: (x: WorkingAgreement) => void;
  removeWorkingAgreement: (id: string) => void;
  upsertLiberatingStructures: (x: LiberatingStructures) => void;
  removeLiberatingStructures: (id: string) => void;
  upsertDesignSprint: (x: DesignSprint) => void;
  removeDesignSprint: (id: string) => void;
  upsertRiskiestAssumption: (x: RiskiestAssumption) => void;
  removeRiskiestAssumption: (id: string) => void;
  upsertWardleyMap: (x: WardleyMap) => void;
  removeWardleyMap: (id: string) => void;
  upsertEpicRoadmap: (x: EpicRoadmap) => void;
  removeEpicRoadmap: (id: string) => void;
  upsertHypothesisTracker: (x: HypothesisTracker) => void;
  removeHypothesisTracker: (id: string) => void;
  upsertUserInterviewLog: (x: UserInterviewLog) => void;
  removeUserInterviewLog: (id: string) => void;
  upsertOpportunityTree: (x: OpportunityTree) => void;
  removeOpportunityTree: (id: string) => void;
  upsertRunbookScorer: (x: RunbookScorer) => void;
  removeRunbookScorer: (id: string) => void;
  upsertReleaseReadiness: (x: ReleaseReadiness) => void;
  removeReleaseReadiness: (id: string) => void;
  upsertOncallRoster: (x: OncallRoster) => void;
  removeOncallRoster: (id: string) => void;
  upsertIncidentCommander: (x: IncidentCommander) => void;
  removeIncidentCommander: (id: string) => void;
  upsertPostMortemLog: (x: PostMortemLog) => void;
  removePostMortemLog: (id: string) => void;
  upsertPsychSafetyLog: (x: PsychSafetyLog) => void;
  removePsychSafetyLog: (id: string) => void;
  upsertMaturityAssessment: (x: MaturityAssessment) => void;
  removeMaturityAssessment: (id: string) => void;
  upsertHealthCheck: (x: HealthCheck) => void;
  removeHealthCheck: (id: string) => void;
  upsertSkillsMatrix: (x: SkillsMatrix) => void;
  removeSkillsMatrix: (id: string) => void;
  upsertPokerEstimationLog: (x: PokerEstimationLog) => void;
  removePokerEstimationLog: (id: string) => void;
  upsertPokerRound: (x: PokerRound) => void;
  removePokerRound: (id: string) => void;
  // Phase 6 — Team & people
  upsertDefinitionOfDone: (x: DefinitionOfDone) => void;
  removeDefinitionOfDone: (id: string) => void;
  upsertRaciMatrix: (x: RaciMatrix) => void;
  removeRaciMatrix: (id: string) => void;
  upsertAdkarDoc: (x: AdkarDoc) => void;
  removeAdkarDoc: (id: string) => void;
  upsertMoodTrackerDoc: (x: MoodTrackerDoc) => void;
  removeMoodTrackerDoc: (id: string) => void;
  upsertMoodPulse: (x: MoodPulse) => void;
  removeMoodPulse: (id: string) => void;
  // Phase 20 — Prioritization
  upsertPrioritization: (x: PrioritizationItem) => void;
  removePrioritization: (id: string) => void;
  // Phase 7 — Prioritize & decide
  upsertAllocationRound: (x: AllocationRound) => void;
  removeAllocationRound: (id: string) => void;
  upsertBuyAFeatureGame: (x: BuyAFeatureGame) => void;
  removeBuyAFeatureGame: (id: string) => void;
  upsertWeightedMatrix: (x: WeightedMatrix) => void;
  /**
   * The matrix and the options and criteria in it (for the default matrix,
   * also the rows without a `matrixId`), with their canvas links cleared:
   * the rows weightedMatrixRemoval names, as the MCP delete removes them.
   * The page offers Undo by restoring what it removed.
   */
  removeWeightedMatrix: (id: string) => void;
  // Phase 21 — Decision Frameworks
  upsertDACIDecision: (x: DACIDecision) => void;
  removeDACIDecision: (id: string) => void;
  upsertRAPIDDecision: (x: RAPIDDecision) => void;
  removeRAPIDDecision: (id: string) => void;
  upsertWeightedOption: (x: WeightedOption) => void;
  removeWeightedOption: (id: string) => void;
  upsertWeightedCriterion: (x: WeightedCriterion) => void;
  removeWeightedCriterion: (id: string) => void;
  upsertSixHatsThought: (x: SixHatsThought) => void;
  removeSixHatsThought: (id: string) => void;
  upsertSixHatsSession: (x: SixHatsSession) => void;
  /** The session only: its thoughts stay (the page removes them with its own Undo). */
  removeSixHatsSession: (id: string) => void;
  upsertOODACycle: (x: OODACycle) => void;
  removeOODACycle: (id: string) => void;
  upsertCynefinItem: (x: CynefinItem) => void;
  removeCynefinItem: (id: string) => void;
  upsertStaceyItem: (x: StaceyItem) => void;
  removeStaceyItem: (id: string) => void;
  upsertPolarity: (x: Polarity) => void;
  removePolarity: (id: string) => void;
  upsertPolarityPole: (x: PolarityPole) => void;
  removePolarityPole: (id: string) => void;
  // Phase 22 — Canvas
  upsertWhiteboard: (x: Whiteboard) => void;
  removeWhiteboard: (id: string) => void;
  upsertWhiteboardObject: (x: WhiteboardObject) => void;
  upsertWhiteboardObjects: (xs: WhiteboardObject[]) => void;
  /**
   * BUG-T1-canvas-5: atomic per-board replace — drops objects on the
   * named board that aren't in `next` AND upserts `next` in a SINGLE
   * setState call. The prior pattern (removeWhiteboardObjects then
   * upsertWhiteboardObjects) broadcast two realtime events with a
   * flicker between, and split-rendered for every store subscriber.
   */
  replaceBoardWhiteboardObjects: (boardId: string, next: WhiteboardObject[]) => void;
  removeWhiteboardObject: (id: string) => void;
  removeWhiteboardObjects: (ids: string[]) => void;
  upsertWhiteboardCommentThread: (x: WhiteboardCommentThread) => void;
  removeWhiteboardCommentThread: (id: string) => void;
  upsertWhiteboardGroup: (x: WhiteboardGroup) => void;
  removeWhiteboardGroup: (id: string) => void;
  // Phase 31 — saved templates
  upsertWhiteboardSavedTemplate: (x: WhiteboardSavedTemplate) => void;
  removeWhiteboardSavedTemplate: (id: string) => void;
  // Phase 32 — activity log
  appendWhiteboardActivity: (ev: WhiteboardActivityEvent) => void;
  // Kudos wall — squad-interactive recognition cards
  upsertKudos: (k: Kudos) => void;
  removeKudos: (id: string) => void;
  // Ceremonies (squad S3)
  upsertSosEntry: (x: SosEntry) => void;
  removeSosEntry: (id: string) => void;
  upsertAsyncUpdate: (x: AsyncUpdate) => void;
  removeAsyncUpdate: (id: string) => void;
  upsertStandupEntry: (x: StandupEntry) => void;
  removeStandupEntry: (id: string) => void;
  upsertSprintReview: (x: SprintReview) => void;
  removeSprintReview: (id: string) => void;
  upsertRetroBoard: (x: RetroBoard) => void;
  removeRetroBoard: (id: string) => void;
  // Sprint Planning (squad S1)
  upsertSprintGoal: (x: SprintGoal) => void;
  removeSprintGoal: (id: string) => void;
  upsertJobStory: (x: JobStory) => void;
  removeJobStory: (id: string) => void;
  upsertCapacityPlan: (x: CapacityPlan) => void;
  removeCapacityPlan: (id: string) => void;
  upsertStoryMap: (x: StoryMap) => void;
  removeStoryMap: (id: string) => void;
  upsertBacklogItem: (x: BacklogItem) => void;
  removeBacklogItem: (id: string) => void;
  upsertNpsResponse: (x: NpsResponse) => void;
  removeNpsResponse: (id: string) => void;
  upsertMoodEntry: (x: MoodEntry) => void;
  removeMoodEntry: (id: string) => void;
  upsertKanbanBoard: (x: KanbanBoard) => void;
  removeKanbanBoard: (id: string) => void;
  upsertDependencyMap: (x: DependencyMap) => void;
  removeDependencyMap: (id: string) => void;
  upsertValueStreamStage: (x: ValueStreamStage) => void;
  removeValueStreamStage: (id: string) => void;
  // Phase 42 — the tools plan's phase 1
  upsertParkingLotItem: (x: ParkingLotItem) => void;
  removeParkingLotItem: (id: string) => void;
  upsertRootCauseAnalysis: (x: RootCauseAnalysis) => void;
  removeRootCauseAnalysis: (id: string) => void;
  upsertProductGoal: (x: ProductGoal) => void;
  removeProductGoal: (id: string) => void;
  upsertInterruptItem: (x: InterruptItem) => void;
  removeInterruptItem: (id: string) => void;
  upsertNotebookEntry: (x: NotebookEntry) => void;
  removeNotebookEntry: (id: string) => void;
  upsertMeetingAudit: (x: MeetingAudit) => void;
  removeMeetingAudit: (id: string) => void;
  replaceWorkspace: (w: Partial<Workspace>) => void;
  resetWorkspace: () => void;
  /** Batch upsert, stamped and cleaned as `upsertStory` does each one. Use
   *  this for bulk adds (a paste, an import): single-item upserts are O(n)
   *  each (find + copy), so calling N times is O(n²), and every call
   *  persists the whole workspace again. */
  bulkUpsertStories: (items: Story[]) => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const replaceById = <T extends { id: string }>(arr: T[], item: T): T[] => {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
  // R5: short-circuit when the slot already holds the exact same reference.
  // Without this, every upsert with an unchanged object creates a new array
  // and triggers a re-render in every subscribe-with-selector consumer —
  // worst case, a typing tool that re-`upsert`s the same item per keystroke.
  if (arr[idx] === item) return arr;
  const next = arr.slice();
  next[idx] = item;
  return next;
};

/** O(n) batch upsert: build a Map once, write everything, materialize once. */
const batchUpsertById = <T extends { id: string }>(arr: T[], items: T[]): T[] => {
  if (items.length === 0) return arr;
  const map = new Map<string, T>();
  for (const x of arr) map.set(x.id, x);
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
};

/** Defend against prototype pollution in nested imported payloads. */
function safeJsonReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    return undefined;
  }
  return value;
}

/** Minimum shape check for array-of-record imports. We don't validate every
 *  enum value (would be heavy and brittle), but require an `id` and reject
 *  obvious junk like `[null, "abc", 5]`. */
function isRecordWithId(v: unknown): v is { id: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { id?: unknown }).id === "string"
  );
}

function sanitizeArray<T extends { id: string }>(raw: unknown): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecordWithId) as T[];
}

/** An integer 1-5. `typeof x === "number"` lets floats and NaN through;
 *  `Number.isInteger(NaN)` is false. */
function isMaturityLevel(v: unknown): v is MaturityLevel {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
}

// R11-fix: shared cascade for canvas sourceRef cleanup on entity removal.
// Maps `whiteboardObjects` that point at the deleted entity via
// `sourceRef: { tool, entityId }` to a copy with sourceRef cleared (and
// version + updatedAt bumped so peer LWW accepts the change).
//
// Audit A6 H6 flagged 16 Phase 19+ entity removes that lacked this
// cascade — orphaned canvas cards still claimed to be linked to deleted
// LLMEvals, Prompts, DACI/RAPID decisions, etc. The signal-bridge already
// fires the right close/remove signal; this helper handles the
// workspace-side bookkeeping.
function cascadeSourceRefRemoval(
  whiteboardObjects: WhiteboardObject[] | undefined,
  tool: string,
  entityId: string
): WhiteboardObject[] | undefined {
  if (!whiteboardObjects || whiteboardObjects.length === 0) return whiteboardObjects;
  const isLink = (o: WhiteboardObject) =>
    o.sourceRef?.tool === tool && o.sourceRef.entityId === entityId;
  if (!whiteboardObjects.some(isLink)) return whiteboardObjects;
  const now = new Date().toISOString();
  return whiteboardObjects.map((o) =>
    isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o
  );
}

/**
 * The workspace without stories `ids`, for `removeStory` and `removeStories`.
 *
 * Phase 26 cascade: any canvas object pinned to a removed Story via
 * sourceRef now points at nothing. Strip the sourceRef so the object
 * becomes a standalone snapshot; without this, future sync attempts
 * against the dead id would silently fail and the link badge
 * ("↳ backlog") would be misleading.
 *
 * Two tool labels are in the wild: cards added via the canvas wizard use
 * `tool: "backlog"`, while `importFromStories` in cross-tool-import.ts
 * emits `tool: "story"`. Match both, and include ALL object kinds
 * (sticky/card) — `importFromStories` produces stickies, not just cards.
 */
function withoutStories(
  s: Pick<Workspace, "stories" | "whiteboardObjects">,
  ids: ReadonlySet<string>
): Pick<Workspace, "stories"> | Pick<Workspace, "stories" | "whiteboardObjects"> {
  const stories = s.stories.filter((x) => !ids.has(x.id));
  const isStoryLink = (o: WhiteboardObject) =>
    (o.sourceRef?.tool === "backlog" || o.sourceRef?.tool === "story") &&
    ids.has(o.sourceRef.entityId);
  // R5: WhiteboardVoting can pin to a story via `storyId` (Phase 27);
  // clear that too so the voting widget doesn't keep a dead link
  // that would cause confusing UI ("anchored to a story that no
  // longer exists").
  const isVotingLink = (o: WhiteboardObject) =>
    o.type === "voting" && o.storyId !== undefined && ids.has(o.storyId);
  // Pre-check so the common case (zero refs) doesn't allocate
  // a fresh whiteboardObjects array via .map().
  const affected = (s.whiteboardObjects ?? []).some((o) => isStoryLink(o) || isVotingLink(o));
  if (!affected) return { stories };
  const now = new Date().toISOString();
  return {
    stories,
    whiteboardObjects: (s.whiteboardObjects ?? []).map((o) => {
      if (isStoryLink(o)) {
        return { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now };
      }
      if (isVotingLink(o)) {
        return { ...o, storyId: undefined, version: o.version + 1, updatedAt: now };
      }
      return o;
    }),
  };
}

export const useWorkspaceStore = create<Workspace & WorkspaceActions>()(
  persist(
    (set, get) => ({
      ...emptyWorkspace,
      setTeamName: (name) => set({ teamName: name }),
      upsertTeamMember: (m) => set((_st) => ({ teamMembers: replaceById(_st.teamMembers, m) })),
      removeTeamMember: (id) =>
        set((s) => {
          // Stories whose `owner` pointed at this member, OKRs whose
          // `owner` did, impediments whose `owner` did, and canvas cards
          // whose `assignee` referenced this member id should all clear
          // the reference. The data model uses `owner` / `assignee`
          // fields as opaque strings — they might be display names OR
          // ids — so we only strip when the field exactly matches the
          // deleted member's id.
          const storiesAffected = s.stories.some((st) => st.owner === id);
          const okrsAffected = (s.okrs ?? []).some((o) => o.owner === id);
          // R12-fix: impediments were skipped here even though
          // Impediment.owner has the identical shape and semantics as
          // Story.owner — a deleted member's id survived on impediments
          // and a recreated member reusing the id would silently
          // inherit them.
          const impedimentsAffected = s.impediments.some((i) => i.owner === id);
          const cardsAffected = (s.whiteboardObjects ?? []).some(
            (o) => o.type === "card" && o.assignee === id
          );
          const next: Partial<Workspace> = {
            teamMembers: s.teamMembers.filter((x) => x.id !== id),
          };
          if (storiesAffected) {
            next.stories = s.stories.map((st) =>
              st.owner === id ? { ...st, owner: undefined } : st
            );
          }
          if (okrsAffected) {
            next.okrs = s.okrs.map((o) => (o.owner === id ? { ...o, owner: undefined } : o));
          }
          if (impedimentsAffected) {
            next.impediments = s.impediments.map((i) =>
              i.owner === id ? { ...i, owner: undefined } : i
            );
          }
          if (cardsAffected) {
            const now = new Date().toISOString();
            next.whiteboardObjects = (s.whiteboardObjects ?? []).map((o) =>
              o.type === "card" && o.assignee === id
                ? { ...o, assignee: undefined, version: o.version + 1, updatedAt: now }
                : o
            );
          }
          return next;
        }),
      upsertSprint: (s) => set((_st) => ({ sprints: replaceById(_st.sprints, s) })),
      upsertSprintSeries: (x) =>
        set((_st) => ({ sprintSeries: replaceById(_st.sprintSeries ?? [], x) })),
      removeSprintSeries: (id) =>
        set((s) => ({ sprintSeries: (s.sprintSeries ?? []).filter((y) => y.id !== id) })),
      upsertCeremonyCadence: (x) =>
        set((_st) => ({ ceremonyCadences: replaceById(_st.ceremonyCadences ?? [], x) })),
      removeCeremonyCadence: (id) =>
        set((s) => ({
          ceremonyCadences: (s.ceremonyCadences ?? []).filter((y) => y.id !== id),
        })),
      removeSprint: (id) =>
        set((s) => {
          // Stories that pointed at this sprint are now stranded — clear
          // their sprintId so they fall back into the backlog rather than
          // referencing a dead id. Without this a removed-then-recreated
          // sprint would silently inherit the prior sprint's stories.
          const storyAffected = s.stories.some((st) => st.sprintId === id);
          const isWbLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "sprint" && o.sourceRef.entityId === id;
          const wbAffected = (s.whiteboardObjects ?? []).some(isWbLink);
          const next: Partial<Workspace> = {
            sprints: s.sprints.filter((x) => x.id !== id),
          };
          // Its daily log and ratings go with it.
          if ((s.sprintSeries ?? []).some((x) => x.id === id)) {
            next.sprintSeries = (s.sprintSeries ?? []).filter((x) => x.id !== id);
          }
          if (storyAffected) {
            const at = new Date().toISOString();
            next.stories = s.stories.map((st) =>
              st.sprintId === id ? withStorySprint(st, undefined, at) : st
            );
          }
          if (wbAffected) {
            next.whiteboardObjects = (s.whiteboardObjects ?? []).map((o) =>
              isWbLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            );
          }
          return next;
        }),
      // Every local write of a story records when it was created, any
      // change of its sprint and when what it says was refined (refinedAt;
      // lib/sprints/story-status.ts); synced rows from other devices arrive
      // through setEntities and keep their own stamps. Its notes, acceptance
      // criteria, link and ticket key are cleaned and capped here too
      // (lib/stories/fields.ts), whichever page wrote them.
      upsertStory: (s) =>
        set((_st) => {
          const prev = _st.stories.find((x) => x.id === s.id);
          return {
            stories: replaceById(
              _st.stories,
              stampRefinedWrite(stampStoryMembership(cleanStoryFields(s), prev), prev)
            ),
          };
        }),
      // With the Canvas links to the story cleared (`withoutStories`).
      removeStory: (id) => set((s) => withoutStories(s, new Set([id]))),
      // One write for the lot: each write persists the whole workspace.
      removeStories: (ids) =>
        set((s) => {
          const gone = new Set(ids);
          return s.stories.some((x) => gone.has(x.id)) ? withoutStories(s, gone) : s;
        }),
      upsertImpediment: (i) => set((_st) => ({ impediments: replaceById(_st.impediments, i) })),
      removeImpediment: (id) =>
        set((s) => {
          // Same cascade for any canvas object pinned to this Impediment
          // via sourceRef. Importers don't currently produce these, but
          // future workflows + the AI-actions "Extract action items"
          // prompt suggest landing items into impediments — leave the
          // cascade defensive so a future emit-site doesn't orphan.
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "impediment" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected) return { impediments: s.impediments.filter((x) => x.id !== id) };
          return {
            impediments: s.impediments.filter((x) => x.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            ),
          };
        }),
      upsertRisk: (r) => set((_st) => ({ risks: replaceById(_st.risks, r) })),
      removeRisk: (id) =>
        set((s) => {
          // Same Phase 26 cascade for risks imported as cards or stickies.
          // `importFromRisks` emits stickies (not cards), so don't gate
          // on `o.type === "card"` here — match any object that carries
          // the matching sourceRef.
          const isRiskLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "risk" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isRiskLink);
          if (!affected) return { risks: s.risks.filter((x) => x.id !== id) };
          return {
            risks: s.risks.filter((x) => x.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isRiskLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            ),
          };
        }),
      // R10: KR-aware upsert. When an OKR is updated with a SHRUNK
      // keyResults array (user removed a KR via okrs-client.tsx
      // `removeKr` which calls upsertOkr with the trimmed list),
      // cascade-clear any canvas sticky/card pinned to the removed
      // KR ids. Previously upsertOkr was a plain replaceById and
      // canvas stickies pointed at dead KR ids forever.
      upsertOkr: (o) =>
        set((s) => {
          const prev = s.okrs.find((x) => x.id === o.id);
          const next: Partial<Workspace> = {
            okrs: replaceById(s.okrs, o),
          };
          if (prev) {
            const nextKrIds = new Set(o.keyResults.map((k) => k.id));
            const droppedKrIds = prev.keyResults
              .map((k) => k.id)
              .filter((id) => !nextKrIds.has(id));
            if (droppedKrIds.length > 0) {
              const dropped = new Set(droppedKrIds);
              const isOrphan = (w: WhiteboardObject) =>
                w.sourceRef?.tool === "okr" && dropped.has(w.sourceRef.entityId);
              const affected = (s.whiteboardObjects ?? []).some(isOrphan);
              if (affected) {
                const now = new Date().toISOString();
                next.whiteboardObjects = (s.whiteboardObjects ?? []).map((w) =>
                  isOrphan(w)
                    ? { ...w, sourceRef: undefined, version: w.version + 1, updatedAt: now }
                    : w
                );
              }
            }
          }
          return next;
        }),
      removeOkr: (id) =>
        set((s) => {
          // OKR import lays down a sticky per Objective (entityId = o.id)
          // AND a sticky per Key Result (entityId = kr.id). On removeOkr
          // we must clear BOTH — otherwise KR-level stickies orphan to a
          // dead parent OKR. Build a set of dead entity ids spanning the
          // OKR + all its KRs.
          const okr = s.okrs.find((x) => x.id === id);
          const deadEntityIds = new Set<string>([id]);
          for (const kr of okr?.keyResults ?? []) deadEntityIds.add(kr.id);
          const isOkrLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "okr" && deadEntityIds.has(o.sourceRef.entityId);
          const affected = (s.whiteboardObjects ?? []).some(isOkrLink);
          if (!affected) return { okrs: s.okrs.filter((x) => x.id !== id) };
          return {
            okrs: s.okrs.filter((x) => x.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isOkrLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            ),
          };
        }),
      upsertDecision: (d) => set((_st) => ({ decisions: replaceById(_st.decisions, d) })),
      removeDecision: (id) =>
        set((s) => {
          // R5: previously gated on `o.type === "card"`, but cross-tool
          // importers may emit stickies too (mirroring removeRisk above).
          // Drop the type filter so both shapes get cleaned up.
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "decision" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected) return { decisions: s.decisions.filter((x) => x.id !== id) };
          return {
            decisions: s.decisions.filter((x) => x.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            ),
          };
        }),
      upsertTechDebt: (t) => set((_st) => ({ techDebt: replaceById(_st.techDebt, t) })),
      removeTechDebt: (id) =>
        set((s) => {
          // Defensive cascade — same pattern as the other entity removes.
          // Canvas importers don't yet emit tech-debt sourceRefs, but a
          // future "import all tech debt as stickies" path shouldn't have
          // to remember to add a cascade here.
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "techDebt" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected) return { techDebt: s.techDebt.filter((x) => x.id !== id) };
          return {
            techDebt: s.techDebt.filter((x) => x.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o)
                ? {
                    ...o,
                    sourceRef: undefined,
                    version: o.version + 1,
                    updatedAt: new Date().toISOString(),
                  }
                : o
            ),
          };
        }),
      setMaturityLevel: (level) => set({ maturityLevel: level }),
      bulkUpsertStories: (items) =>
        // BUG-W46: functional updater — non-functional read-then-set
        // races concurrent sync-engine writes and silently drops the
        // loser.
        set((_st) => {
          if (items.length === 0) return _st;
          // Stamped as `upsertStory` stamps each one (created, joined its
          // sprint, refined), with one time for the batch.
          const stored = new Map(_st.stories.map((x) => [x.id, x]));
          const at = new Date().toISOString();
          return {
            stories: batchUpsertById(
              _st.stories,
              items.map((s) => {
                const prev = stored.get(s.id);
                return stampRefinedWrite(
                  stampStoryMembership(cleanStoryFields(s), prev, at),
                  prev,
                  at
                );
              })
            ),
          };
        }),
      // Phase 19 — AI/LLM PM
      upsertLLMEval: (x) => set((_st) => ({ llmEvals: replaceById(_st.llmEvals ?? [], x) })),
      // R11-fix: canvas sourceRef cascade. Audit A6 H6 flagged 16
      // Phase 19+ removes that left orphaned canvas cards still
      // claiming a link to the deleted entity. The cascadeSourceRefRemoval
      // helper centralises the bookkeeping.
      removeLLMEval: (id) =>
        set((s) => ({
          llmEvals: (s.llmEvals ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "llmEval", id),
        })),
      upsertPrompt: (x) => set((_st) => ({ prompts: replaceById(_st.prompts ?? [], x) })),
      removePrompt: (id) =>
        set((s) => ({
          prompts: (s.prompts ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "prompt", id),
        })),
      upsertHallucination: (x) =>
        set((_st) => ({ hallucinations: replaceById(_st.hallucinations ?? [], x) })),
      removeHallucination: (id) =>
        set((s) => ({
          hallucinations: (s.hallucinations ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "hallucination", id),
        })),
      upsertTokenSpend: (x) => set((_st) => ({ tokenSpend: replaceById(_st.tokenSpend ?? [], x) })),
      // R5: extend the cascade pattern from removeTechDebt — canvas stickies
      // imported from this tool would otherwise dangle.
      removeTokenSpend: (id) =>
        set((s) => {
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "tokenSpend" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected) return { tokenSpend: (s.tokenSpend ?? []).filter((y) => y.id !== id) };
          const now = new Date().toISOString();
          return {
            tokenSpend: (s.tokenSpend ?? []).filter((y) => y.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o
            ),
          };
        }),
      // Optimistic concurrency (audit MEDIUM). ModelEntry rows are written
      // by BOTH the user (UI) and background agents (tool.model_registry.*).
      // `version` is a monotonic LWW token: a write whose base version is
      // strictly older than the stored row is a stale lost-update attempt
      // and is dropped (the newer row stands); every accepted write bumps
      // the version. A write that OMITS `version` is a legacy/blind write —
      // accepted and stamped — so existing callers keep working (opt-in).
      // Realtime-delivered rows bypass this (they go through setEntities),
      // so this guards LOCAL writes against an already-advanced store.
      upsertModel: (x) =>
        set((s) => {
          const list = s.models ?? [];
          const current = list.find((m) => m.id === x.id);
          if (!current) {
            // First write for this id — keep an explicit version, else stamp 1.
            return { models: replaceById(list, { ...x, version: x.version ?? 1 }) };
          }
          const currentV = current.version ?? 0;
          if (x.version !== undefined && x.version < currentV) {
            // Stale write — keep the newer stored row untouched.
            return {};
          }
          return { models: replaceById(list, { ...x, version: currentV + 1 }) };
        }),
      removeModel: (id) =>
        set((s) => ({
          models: (s.models ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "model", id),
        })),
      upsertRedTeamFinding: (x) =>
        set((_st) => ({ redTeamFindings: replaceById(_st.redTeamFindings ?? [], x) })),
      removeRedTeamFinding: (id) =>
        set((s) => ({
          redTeamFindings: (s.redTeamFindings ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "redTeam", id),
        })),
      upsertAgentWorkflow: (x) =>
        set((_st) => ({ agentWorkflows: replaceById(_st.agentWorkflows ?? [], x) })),
      // R5: use functional updater so both reads share one snapshot.
      // The previous dual `get()` could tear under interleaved actions.
      removeAgentWorkflow: (id) =>
        set((s) => ({
          agentWorkflows: (s.agentWorkflows ?? []).filter((y) => y.id !== id),
          agentNodes: (s.agentNodes ?? []).filter((n) => n.workflowId !== id),
        })),
      upsertAgentNode: (x) => set((_st) => ({ agentNodes: replaceById(_st.agentNodes ?? [], x) })),
      // R5: also strip the deleted node from other nodes' `next: string[]`
      // arrays so the workflow graph doesn't keep dangling references.
      removeAgentNode: (id) =>
        set((s) => ({
          agentNodes: (s.agentNodes ?? [])
            .filter((y) => y.id !== id)
            .map((n) =>
              n.next?.includes(id) ? { ...n, next: n.next.filter((x) => x !== id) } : n
            ),
        })),
      upsertHitlReview: (x) =>
        set((_st) => ({ hitlReviews: replaceById(_st.hitlReviews ?? [], x) })),
      removeHitlReview: (id) =>
        set((s) => ({
          hitlReviews: (s.hitlReviews ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "hitlReview", id),
        })),
      upsertRlhfPair: (x) => set((_st) => ({ rlhfPairs: replaceById(_st.rlhfPairs ?? [], x) })),
      removeRlhfPair: (id) =>
        set((s) => ({
          rlhfPairs: (s.rlhfPairs ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "rlhfPair", id),
        })),
      upsertVectorCollection: (x) =>
        set((_st) => ({ vectorCollections: replaceById(_st.vectorCollections ?? [], x) })),
      // R5: canvas sticky cascade.
      removeVectorCollection: (id) =>
        set((s) => {
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "vectorCollections" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected)
            return { vectorCollections: (s.vectorCollections ?? []).filter((y) => y.id !== id) };
          const now = new Date().toISOString();
          return {
            vectorCollections: (s.vectorCollections ?? []).filter((y) => y.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o
            ),
          };
        }),
      upsertModelCard: (x) => set((_st) => ({ modelCards: replaceById(_st.modelCards ?? [], x) })),
      removeModelCard: (id) =>
        set((s) => ({
          modelCards: (s.modelCards ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "modelCard", id),
        })),
      // S12b singleton-doc tools (one document per workspace; no canvas
      // cascade — these entities aren't importable onto the whiteboard).
      upsertAiFeatureSpec: (x) =>
        set((_st) => ({ aiFeatureSpecs: replaceById(_st.aiFeatureSpecs ?? [], x) })),
      removeAiFeatureSpec: (id) =>
        set((s) => ({ aiFeatureSpecs: (s.aiFeatureSpecs ?? []).filter((y) => y.id !== id) })),
      upsertAiSafetyChecklist: (x) =>
        set((_st) => ({ aiSafetyChecklists: replaceById(_st.aiSafetyChecklists ?? [], x) })),
      removeAiSafetyChecklist: (id) =>
        set((s) => ({
          aiSafetyChecklists: (s.aiSafetyChecklists ?? []).filter((y) => y.id !== id),
        })),
      upsertModelMigration: (x) =>
        set((_st) => ({ modelMigrations: replaceById(_st.modelMigrations ?? [], x) })),
      removeModelMigration: (id) =>
        set((s) => ({ modelMigrations: (s.modelMigrations ?? []).filter((y) => y.id !== id) })),
      // S9 — Security & Compliance (singleton docs; no canvas cascade)
      upsertThreatModel: (x) =>
        set((_st) => ({ threatModels: replaceById(_st.threatModels ?? [], x) })),
      removeThreatModel: (id) =>
        set((s) => ({ threatModels: (s.threatModels ?? []).filter((y) => y.id !== id) })),
      upsertVulnBurndown: (x) =>
        set((_st) => ({ vulnBurndowns: replaceById(_st.vulnBurndowns ?? [], x) })),
      removeVulnBurndown: (id) =>
        set((s) => ({ vulnBurndowns: (s.vulnBurndowns ?? []).filter((y) => y.id !== id) })),
      upsertControlMap: (x) =>
        set((_st) => ({ controlMaps: replaceById(_st.controlMaps ?? [], x) })),
      removeControlMap: (id) =>
        set((s) => ({ controlMaps: (s.controlMaps ?? []).filter((y) => y.id !== id) })),
      upsertA11yTracker: (x) =>
        set((_st) => ({ a11yTrackers: replaceById(_st.a11yTrackers ?? [], x) })),
      removeA11yTracker: (id) =>
        set((s) => ({ a11yTrackers: (s.a11yTrackers ?? []).filter((y) => y.id !== id) })),
      upsertTestPyramid: (x) =>
        set((_st) => ({ testPyramids: replaceById(_st.testPyramids ?? [], x) })),
      removeTestPyramid: (id) =>
        set((s) => ({ testPyramids: (s.testPyramids ?? []).filter((y) => y.id !== id) })),
      upsertFlakyTestBoard: (x) =>
        set((_st) => ({ flakyTestBoards: replaceById(_st.flakyTestBoards ?? [], x) })),
      removeFlakyTestBoard: (id) =>
        set((s) => ({ flakyTestBoards: (s.flakyTestBoards ?? []).filter((y) => y.id !== id) })),
      upsertCodeReviewLog: (x) =>
        set((_st) => ({ codeReviewLogs: replaceById(_st.codeReviewLogs ?? [], x) })),
      removeCodeReviewLog: (id) =>
        set((s) => ({ codeReviewLogs: (s.codeReviewLogs ?? []).filter((y) => y.id !== id) })),
      upsertDoraScorecard: (x) =>
        set((_st) => ({ doraScorecards: replaceById(_st.doraScorecards ?? [], x) })),
      removeDoraScorecard: (id) =>
        set((s) => ({ doraScorecards: (s.doraScorecards ?? []).filter((y) => y.id !== id) })),
      upsertHealthDashboard: (x) =>
        set((_st) => ({ healthDashboards: replaceById(_st.healthDashboards ?? [], x) })),
      removeHealthDashboard: (id) =>
        set((s) => ({ healthDashboards: (s.healthDashboards ?? []).filter((y) => y.id !== id) })),
      upsertFeatureFlag: (x) =>
        set((_st) => ({ featureFlags: replaceById(_st.featureFlags ?? [], x) })),
      removeFeatureFlag: (id) =>
        set((s) => ({ featureFlags: (s.featureFlags ?? []).filter((y) => y.id !== id) })),
      upsertSloBuilder: (x) =>
        set((_st) => ({ sloBuilders: replaceById(_st.sloBuilders ?? [], x) })),
      removeSloBuilder: (id) =>
        set((s) => ({ sloBuilders: (s.sloBuilders ?? []).filter((y) => y.id !== id) })),
      upsertSpacePulse: (x) =>
        set((_st) => ({ spacePulses: replaceById(_st.spacePulses ?? [], x) })),
      removeSpacePulse: (id) =>
        set((s) => ({ spacePulses: (s.spacePulses ?? []).filter((y) => y.id !== id) })),
      upsertDevexSurvey: (x) =>
        set((_st) => ({ devexSurveys: replaceById(_st.devexSurveys ?? [], x) })),
      removeDevexSurvey: (id) =>
        set((s) => ({ devexSurveys: (s.devexSurveys ?? []).filter((y) => y.id !== id) })),
      upsertPlatformMaturity: (x) =>
        set((_st) => ({ platformMaturities: replaceById(_st.platformMaturities ?? [], x) })),
      removePlatformMaturity: (id) =>
        set((s) => ({
          platformMaturities: (s.platformMaturities ?? []).filter((y) => y.id !== id),
        })),
      upsertWorkingAgreement: (x) =>
        set((_st) => ({ workingAgreements: replaceById(_st.workingAgreements ?? [], x) })),
      removeWorkingAgreement: (id) =>
        set((s) => ({ workingAgreements: (s.workingAgreements ?? []).filter((y) => y.id !== id) })),
      upsertLiberatingStructures: (x) =>
        set((_st) => ({ liberatingStructures: replaceById(_st.liberatingStructures ?? [], x) })),
      removeLiberatingStructures: (id) =>
        set((s) => ({
          liberatingStructures: (s.liberatingStructures ?? []).filter((y) => y.id !== id),
        })),
      upsertDesignSprint: (x) =>
        set((_st) => ({ designSprints: replaceById(_st.designSprints ?? [], x) })),
      removeDesignSprint: (id) =>
        set((s) => ({ designSprints: (s.designSprints ?? []).filter((y) => y.id !== id) })),
      upsertRiskiestAssumption: (x) =>
        set((_st) => ({ riskiestAssumptions: replaceById(_st.riskiestAssumptions ?? [], x) })),
      removeRiskiestAssumption: (id) =>
        set((s) => ({
          riskiestAssumptions: (s.riskiestAssumptions ?? []).filter((y) => y.id !== id),
        })),
      upsertWardleyMap: (x) =>
        set((_st) => ({ wardleyMaps: replaceById(_st.wardleyMaps ?? [], x) })),
      removeWardleyMap: (id) =>
        set((s) => ({ wardleyMaps: (s.wardleyMaps ?? []).filter((y) => y.id !== id) })),
      upsertEpicRoadmap: (x) =>
        set((_st) => ({ epicRoadmaps: replaceById(_st.epicRoadmaps ?? [], x) })),
      removeEpicRoadmap: (id) =>
        set((s) => ({ epicRoadmaps: (s.epicRoadmaps ?? []).filter((y) => y.id !== id) })),
      upsertHypothesisTracker: (x) =>
        set((_st) => ({ hypothesisTrackers: replaceById(_st.hypothesisTrackers ?? [], x) })),
      removeHypothesisTracker: (id) =>
        set((s) => ({
          hypothesisTrackers: (s.hypothesisTrackers ?? []).filter((y) => y.id !== id),
        })),
      upsertUserInterviewLog: (x) =>
        set((_st) => ({ userInterviewLogs: replaceById(_st.userInterviewLogs ?? [], x) })),
      removeUserInterviewLog: (id) =>
        set((s) => ({ userInterviewLogs: (s.userInterviewLogs ?? []).filter((y) => y.id !== id) })),
      upsertOpportunityTree: (x) =>
        set((_st) => ({ opportunityTrees: replaceById(_st.opportunityTrees ?? [], x) })),
      removeOpportunityTree: (id) =>
        set((s) => ({ opportunityTrees: (s.opportunityTrees ?? []).filter((y) => y.id !== id) })),
      upsertRunbookScorer: (x) =>
        set((_st) => ({ runbookScorers: replaceById(_st.runbookScorers ?? [], x) })),
      removeRunbookScorer: (id) =>
        set((s) => ({ runbookScorers: (s.runbookScorers ?? []).filter((y) => y.id !== id) })),
      upsertReleaseReadiness: (x) =>
        set((_st) => ({ releaseReadinesses: replaceById(_st.releaseReadinesses ?? [], x) })),
      removeReleaseReadiness: (id) =>
        set((s) => ({
          releaseReadinesses: (s.releaseReadinesses ?? []).filter((y) => y.id !== id),
        })),
      upsertOncallRoster: (x) =>
        set((_st) => ({ oncallRosters: replaceById(_st.oncallRosters ?? [], x) })),
      removeOncallRoster: (id) =>
        set((s) => ({ oncallRosters: (s.oncallRosters ?? []).filter((y) => y.id !== id) })),
      upsertIncidentCommander: (x) =>
        set((_st) => ({ incidentCommanders: replaceById(_st.incidentCommanders ?? [], x) })),
      removeIncidentCommander: (id) =>
        set((s) => ({
          incidentCommanders: (s.incidentCommanders ?? []).filter((y) => y.id !== id),
        })),
      upsertPostMortemLog: (x) =>
        set((_st) => ({ postMortemLogs: replaceById(_st.postMortemLogs ?? [], x) })),
      removePostMortemLog: (id) =>
        set((s) => ({ postMortemLogs: (s.postMortemLogs ?? []).filter((y) => y.id !== id) })),
      upsertPsychSafetyLog: (x) =>
        set((_st) => ({ psychSafetyLogs: replaceById(_st.psychSafetyLogs ?? [], x) })),
      removePsychSafetyLog: (id) =>
        set((s) => ({ psychSafetyLogs: (s.psychSafetyLogs ?? []).filter((y) => y.id !== id) })),
      upsertMaturityAssessment: (x) =>
        set((_st) => ({ maturityAssessments: replaceById(_st.maturityAssessments ?? [], x) })),
      removeMaturityAssessment: (id) =>
        set((s) => ({
          maturityAssessments: (s.maturityAssessments ?? []).filter((y) => y.id !== id),
        })),
      upsertHealthCheck: (x) =>
        set((_st) => ({ healthChecks: replaceById(_st.healthChecks ?? [], x) })),
      removeHealthCheck: (id) =>
        set((s) => ({ healthChecks: (s.healthChecks ?? []).filter((y) => y.id !== id) })),
      upsertSkillsMatrix: (x) =>
        set((_st) => ({ skillsMatrices: replaceById(_st.skillsMatrices ?? [], x) })),
      removeSkillsMatrix: (id) =>
        set((s) => ({ skillsMatrices: (s.skillsMatrices ?? []).filter((y) => y.id !== id) })),
      upsertPokerEstimationLog: (x) =>
        set((_st) => ({ pokerEstimationLogs: replaceById(_st.pokerEstimationLogs ?? [], x) })),
      removePokerEstimationLog: (id) =>
        set((s) => ({
          pokerEstimationLogs: (s.pokerEstimationLogs ?? []).filter((y) => y.id !== id),
        })),
      upsertPokerRound: (x) =>
        set((_st) => ({ pokerRounds: replaceById(_st.pokerRounds ?? [], x) })),
      removePokerRound: (id) =>
        set((s) => ({ pokerRounds: (s.pokerRounds ?? []).filter((y) => y.id !== id) })),
      // Phase 6 — Team & people
      upsertDefinitionOfDone: (x) =>
        set((_st) => ({ definitionsOfDone: replaceById(_st.definitionsOfDone ?? [], x) })),
      removeDefinitionOfDone: (id) =>
        set((s) => ({
          definitionsOfDone: (s.definitionsOfDone ?? []).filter((y) => y.id !== id),
        })),
      upsertRaciMatrix: (x) =>
        set((_st) => ({ raciMatrices: replaceById(_st.raciMatrices ?? [], x) })),
      removeRaciMatrix: (id) =>
        set((s) => ({ raciMatrices: (s.raciMatrices ?? []).filter((y) => y.id !== id) })),
      upsertAdkarDoc: (x) => set((_st) => ({ adkarDocs: replaceById(_st.adkarDocs ?? [], x) })),
      removeAdkarDoc: (id) =>
        set((s) => ({ adkarDocs: (s.adkarDocs ?? []).filter((y) => y.id !== id) })),
      upsertMoodTrackerDoc: (x) =>
        set((_st) => ({ moodTrackerDocs: replaceById(_st.moodTrackerDocs ?? [], x) })),
      removeMoodTrackerDoc: (id) =>
        set((s) => ({ moodTrackerDocs: (s.moodTrackerDocs ?? []).filter((y) => y.id !== id) })),
      upsertMoodPulse: (x) => set((_st) => ({ moodPulses: replaceById(_st.moodPulses ?? [], x) })),
      removeMoodPulse: (id) =>
        set((s) => ({ moodPulses: (s.moodPulses ?? []).filter((y) => y.id !== id) })),
      // Phase 20 — Prioritization
      upsertPrioritization: (x) =>
        set((_st) => ({ prioritizations: replaceById(_st.prioritizations ?? [], x) })),
      // R5: canvas sticky cascade.
      removePrioritization: (id) =>
        set((s) => {
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "prioritizations" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected)
            return { prioritizations: (s.prioritizations ?? []).filter((y) => y.id !== id) };
          const now = new Date().toISOString();
          return {
            prioritizations: (s.prioritizations ?? []).filter((y) => y.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o
            ),
          };
        }),
      // Phase 7 — Prioritize & decide
      upsertAllocationRound: (x) =>
        set((_st) => ({ allocationRounds: replaceById(_st.allocationRounds ?? [], x) })),
      removeAllocationRound: (id) =>
        set((s) => ({ allocationRounds: (s.allocationRounds ?? []).filter((y) => y.id !== id) })),
      upsertBuyAFeatureGame: (x) =>
        set((_st) => ({ buyAFeatureGames: replaceById(_st.buyAFeatureGames ?? [], x) })),
      removeBuyAFeatureGame: (id) =>
        set((s) => ({ buyAFeatureGames: (s.buyAFeatureGames ?? []).filter((y) => y.id !== id) })),
      upsertWeightedMatrix: (x) =>
        set((_st) => ({ weightedMatrices: replaceById(_st.weightedMatrices ?? [], x) })),
      removeWeightedMatrix: (id) =>
        set((s) => {
          const options = s.weightedOptions ?? [];
          const criteria = s.weightedCriteria ?? [];
          // The same plan the MCP delete applies server-side (a row without a
          // matrixId is in the default matrix, as the page reads it).
          const plan = weightedMatrixRemoval(id, options, criteria);
          if (plan.optionIds.length === 0 && plan.criterionIds.length === 0) {
            return { weightedMatrices: (s.weightedMatrices ?? []).filter((y) => y.id !== id) };
          }
          const goneOptions = new Set(plan.optionIds);
          const goneCriteria = new Set(plan.criterionIds);
          // Only the canvas links of the removed options; criteria have none.
          let whiteboardObjects = s.whiteboardObjects;
          for (const optionId of plan.optionIds) {
            whiteboardObjects = cascadeSourceRefRemoval(
              whiteboardObjects,
              "weightedOption",
              optionId
            );
          }
          // Like removeWeightedCriterion: no option keeps a score for a removed criterion.
          const rescored = new Map(plan.rescored.map((o) => [o.id, o]));
          return {
            weightedMatrices: (s.weightedMatrices ?? []).filter((y) => y.id !== id),
            weightedOptions: options
              .filter((o) => !goneOptions.has(o.id))
              .map((o) => rescored.get(o.id) ?? o),
            weightedCriteria: criteria.filter((c) => !goneCriteria.has(c.id)),
            whiteboardObjects,
          };
        }),
      // Phase 21 — Decision Frameworks
      upsertDACIDecision: (x) =>
        set((_st) => ({ daciDecisions: replaceById(_st.daciDecisions ?? [], x) })),
      removeDACIDecision: (id) =>
        set((s) => ({
          daciDecisions: (s.daciDecisions ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "daci", id),
        })),
      upsertRAPIDDecision: (x) =>
        set((_st) => ({ rapidDecisions: replaceById(_st.rapidDecisions ?? [], x) })),
      removeRAPIDDecision: (id) =>
        set((s) => ({
          rapidDecisions: (s.rapidDecisions ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "rapid", id),
        })),
      upsertWeightedOption: (x) =>
        set((_st) => ({ weightedOptions: replaceById(_st.weightedOptions ?? [], x) })),
      removeWeightedOption: (id) =>
        set((s) => ({
          weightedOptions: (s.weightedOptions ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "weightedOption", id),
        })),
      upsertWeightedCriterion: (x) =>
        set((_st) => ({ weightedCriteria: replaceById(_st.weightedCriteria ?? [], x) })),
      // R5: also strip the stale criterion key from every WeightedOption's
      // `scores` map. Previously the option kept the score for a deleted
      // criterion, biasing future weightedScore re-computations.
      removeWeightedCriterion: (id) =>
        set((s) => ({
          weightedCriteria: (s.weightedCriteria ?? []).filter((y) => y.id !== id),
          weightedOptions: (s.weightedOptions ?? []).map((o) => {
            if (!o.scores || !(id in o.scores)) return o;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [id]: _drop, ...rest } = o.scores;
            return { ...o, scores: rest };
          }),
        })),
      upsertSixHatsThought: (x) =>
        set((_st) => ({ sixHatsThoughts: replaceById(_st.sixHatsThoughts ?? [], x) })),
      removeSixHatsThought: (id) =>
        set((s) => ({
          sixHatsThoughts: (s.sixHatsThoughts ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "sixHats", id),
        })),
      upsertSixHatsSession: (x) =>
        set((_st) => ({ sixHatsSessions: replaceById(_st.sixHatsSessions ?? [], x) })),
      removeSixHatsSession: (id) =>
        set((s) => ({ sixHatsSessions: (s.sixHatsSessions ?? []).filter((y) => y.id !== id) })),
      upsertOODACycle: (x) => set((_st) => ({ oodaCycles: replaceById(_st.oodaCycles ?? [], x) })),
      removeOODACycle: (id) =>
        set((s) => ({
          oodaCycles: (s.oodaCycles ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "ooda", id),
        })),
      upsertCynefinItem: (x) =>
        set((_st) => ({ cynefinItems: replaceById(_st.cynefinItems ?? [], x) })),
      removeCynefinItem: (id) =>
        set((s) => ({
          cynefinItems: (s.cynefinItems ?? []).filter((y) => y.id !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "cynefin", id),
        })),
      upsertStaceyItem: (x) =>
        set((_st) => ({ staceyItems: replaceById(_st.staceyItems ?? [], x) })),
      // R5: canvas sticky cascade.
      removeStaceyItem: (id) =>
        set((s) => {
          const isLink = (o: WhiteboardObject) =>
            o.sourceRef?.tool === "staceyItems" && o.sourceRef.entityId === id;
          const affected = (s.whiteboardObjects ?? []).some(isLink);
          if (!affected) return { staceyItems: (s.staceyItems ?? []).filter((y) => y.id !== id) };
          const now = new Date().toISOString();
          return {
            staceyItems: (s.staceyItems ?? []).filter((y) => y.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o
            ),
          };
        }),
      upsertPolarity: (x) => set((_st) => ({ polarities: replaceById(_st.polarities ?? [], x) })),
      // R5: functional updater so the polarity + its poles share one snapshot.
      // R11-fix: also cascade canvas sourceRef cleanup.
      removePolarity: (id) =>
        set((s) => ({
          polarities: (s.polarities ?? []).filter((y) => y.id !== id),
          polarityPoles: (s.polarityPoles ?? []).filter((p) => p.polarityId !== id),
          whiteboardObjects: cascadeSourceRefRemoval(s.whiteboardObjects, "polarity", id),
        })),
      upsertPolarityPole: (x) =>
        set((_st) => ({ polarityPoles: replaceById(_st.polarityPoles ?? [], x) })),
      removePolarityPole: (id) =>
        set({ polarityPoles: (get().polarityPoles ?? []).filter((y) => y.id !== id) }),
      // Phase 22 — Canvas. Deleting a board cascades to all its objects,
      // comments, and groups so we never leak orphan rows.
      upsertWhiteboard: (x) =>
        set((_st) => ({ whiteboards: replaceById(_st.whiteboards ?? [], x) })),
      // R5: functional updater so all four cascades share one snapshot —
      // the prior FOUR `get()` calls could race with concurrent activity.
      // ALSO cascade `whiteboardActivityLog` (previously leaked forever
      // after board delete — entries accumulated invisibly in storage).
      removeWhiteboard: (id) =>
        set((s) => ({
          whiteboards: (s.whiteboards ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).filter((o) => o.boardId !== id),
          whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter(
            (c) => c.boardId !== id
          ),
          whiteboardGroups: (s.whiteboardGroups ?? []).filter((g) => g.boardId !== id),
          whiteboardActivityLog: (s.whiteboardActivityLog ?? []).filter((e) => e.boardId !== id),
        })),
      upsertWhiteboardObject: (x) =>
        set((_st) => ({ whiteboardObjects: replaceById(_st.whiteboardObjects ?? [], x) })),
      // Bulk upsert — used by templates, paste, cross-tool import, and the
      // diff-sync receiver. Single set() to avoid N re-renders for N objects.
      upsertWhiteboardObjects: (xs) =>
        set((s) => {
          const list = s.whiteboardObjects ?? [];
          const map = new Map(list.map((o) => [o.id, o]));
          for (const x of xs) map.set(x.id, x);
          return { whiteboardObjects: Array.from(map.values()) };
        }),
      // BUG-T1-canvas-5: atomic board-level replace. Keeps objects
      // belonging to OTHER boards untouched; replaces this board's
      // slice with `next`. Single setState → single subscriber wave,
      // single realtime broadcast — no inter-write flicker on peers.
      replaceBoardWhiteboardObjects: (boardId, next) =>
        set((s) => {
          const others = (s.whiteboardObjects ?? []).filter((o) => o.boardId !== boardId);
          return { whiteboardObjects: [...others, ...next] };
        }),
      // R12-fix: delegate to the bulk remove so the cascade logic lives in
      // ONE place. The previous inline copy (a) cleared `frameId` WITHOUT
      // bumping version/updatedAt — the diff-sync layer detects changes by
      // version inequality (computeWhiteboardDiff), so the clear never
      // broadcast and peers kept a dangling reference to the deleted frame
      // forever (heartbeat drift-recovery compares versions too, so it
      // could never heal) — and (b) dropped only first-level connectors,
      // leaving a labelling connector pinned to a dropped connector
      // dangling. The plural action handles both (version bump +
      // fixed-point connector cascade), and its comment-thread cleanup is
      // a strict superset of the old single-id filter.
      removeWhiteboardObject: (id) => get().removeWhiteboardObjects([id]),
      removeWhiteboardObjects: (ids) => {
        const removeSet = new Set(ids);
        set((s) => {
          const objects = s.whiteboardObjects ?? [];
          // R5: connectors can themselves be `fromId`/`toId` of another
          // connector (labels-on-arrows). One pass dropped only first-
          // level dangling connectors; a labeling-arrow pointing at a
          // dropped connector would survive with a dead pointer. Loop
          // until the remove set stabilises.
          let grew = true;
          while (grew) {
            grew = false;
            for (const y of objects) {
              if (
                !removeSet.has(y.id) &&
                y.type === "connector" &&
                (removeSet.has(y.fromId) || removeSet.has(y.toId))
              ) {
                removeSet.add(y.id);
                grew = true;
              }
            }
          }
          const now = new Date().toISOString();
          const nextObjects: WhiteboardObject[] = [];
          for (const y of objects) {
            if (removeSet.has(y.id)) continue;
            // R5: when clearing frameId, bump version+updatedAt so realtime
            // LWW peers don't revive the frame reference from a stale
            // broadcast and silently re-orphan the object.
            if (y.frameId && removeSet.has(y.frameId)) {
              nextObjects.push({
                ...y,
                frameId: undefined,
                version: y.version + 1,
                updatedAt: now,
              });
              continue;
            }
            nextObjects.push(y);
          }
          return {
            whiteboardObjects: nextObjects,
            // Keep threads where (a) the thread isn't pinned to an object,
            // or (b) the pinned object is not being removed.
            whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter(
              (t) => !t.objectId || !removeSet.has(t.objectId)
            ),
          };
        });
      },
      upsertWhiteboardCommentThread: (x) =>
        set((_st) => ({
          whiteboardCommentThreads: replaceById(_st.whiteboardCommentThreads ?? [], x),
        })),
      removeWhiteboardCommentThread: (id) =>
        set({
          whiteboardCommentThreads: (get().whiteboardCommentThreads ?? []).filter(
            (y) => y.id !== id
          ),
        }),
      upsertWhiteboardGroup: (x) =>
        set((_st) => ({ whiteboardGroups: replaceById(_st.whiteboardGroups ?? [], x) })),
      // R5: functional updater so both reads share one snapshot. Also bump
      // version+updatedAt on any object whose `groupId` we clear so a
      // stale peer broadcast doesn't revive the dead group reference.
      removeWhiteboardGroup: (id) =>
        set((s) => {
          const now = new Date().toISOString();
          return {
            whiteboardGroups: (s.whiteboardGroups ?? []).filter((y) => y.id !== id),
            whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
              o.groupId === id
                ? { ...o, groupId: undefined, version: o.version + 1, updatedAt: now }
                : o
            ),
          };
        }),
      upsertWhiteboardSavedTemplate: (x) =>
        set({
          whiteboardSavedTemplates: replaceById(get().whiteboardSavedTemplates ?? [], x),
        }),
      removeWhiteboardSavedTemplate: (id) =>
        set({
          whiteboardSavedTemplates: (get().whiteboardSavedTemplates ?? []).filter(
            (y) => y.id !== id
          ),
        }),
      appendWhiteboardActivity: (ev) =>
        set((s) => {
          // Reject malformed events to avoid polluting the rolling log with
          // garbage (e.g. from a buggy AI prompt feeding the log). Each
          // string field has a length cap matched by the import validator,
          // so we don't drift between the two surfaces.
          if (!ev || typeof ev !== "object") return s;
          if (typeof ev.id !== "string" || ev.id.length > 100) return s;
          if (typeof ev.boardId !== "string" || ev.boardId.length > 100) return s;
          if (typeof ev.at !== "number" || !Number.isFinite(ev.at)) return s;
          if (typeof ev.author !== "string" || ev.author.length > 200) return s;
          if (typeof ev.kind !== "string" || ev.kind.length > 64) return s;
          if (typeof ev.summary !== "string" || ev.summary.length > 1000) return s;
          // Rolling 200-event ring per board, with global cap at 1000
          // events total to bound localStorage growth.
          const log = (s.whiteboardActivityLog ?? []).slice();
          log.push(ev);
          // Drop oldest for this board past 200; then global cap.
          const byBoard = new Map<string, number>();
          for (let i = log.length - 1; i >= 0; i--) {
            const e = log[i];
            const c = (byBoard.get(e.boardId) ?? 0) + 1;
            byBoard.set(e.boardId, c);
            if (c > 200) log.splice(i, 1);
          }
          const next = log.slice(-1000);
          return { whiteboardActivityLog: next };
        }),
      // Kudos wall: append + cap at 500 entries (drop oldest). Validates
      // shape via the canonical `parseKudos` — the SAME parser the
      // realtime wire path uses — so a payload that survives one
      // boundary cannot smuggle past the other. The parser also
      // auto-upgrades v1 (pre-redesign) rows by stamping `version: 1`,
      // and we write the upgraded shape back so the persist slot heals
      // on next save without a one-shot migration.
      upsertKudos: (k) =>
        set((s) => {
          const parsed = parseKudos(k);
          if (!parsed.ok) return s;
          const stored = parsed.kudos;
          const list = s.kudos ?? [];
          // Dedup by id (peer broadcast may re-deliver during reconnect).
          // If the id already exists we replace in place — kudos are
          // immutable in practice but the same id means "same event".
          const idx = list.findIndex((x) => x.id === stored.id);
          if (idx >= 0) {
            if (list[idx] === stored) return s;
            const replaced = list.slice();
            replaced[idx] = stored;
            return { kudos: replaced };
          }
          // Append + cap. Newest at the END so reverse-iteration in the
          // wall component is cheap; cap drops oldest from the front.
          const appended = [...list, stored];
          const KUDOS_CAP = 500;
          return {
            kudos: appended.length > KUDOS_CAP ? appended.slice(-KUDOS_CAP) : appended,
          };
        }),
      removeKudos: (id) => set((s) => ({ kudos: (s.kudos ?? []).filter((k) => k.id !== id) })),
      // Ceremonies (squad S3)
      upsertSosEntry: (x) => set((_st) => ({ sosEntries: replaceById(_st.sosEntries ?? [], x) })),
      removeSosEntry: (id) =>
        set((s) => ({ sosEntries: (s.sosEntries ?? []).filter((y) => y.id !== id) })),
      upsertAsyncUpdate: (x) =>
        set((_st) => ({ asyncUpdates: replaceById(_st.asyncUpdates ?? [], x) })),
      removeAsyncUpdate: (id) =>
        set((s) => ({ asyncUpdates: (s.asyncUpdates ?? []).filter((y) => y.id !== id) })),
      upsertStandupEntry: (x) =>
        set((_st) => ({ standupEntries: replaceById(_st.standupEntries ?? [], x) })),
      removeStandupEntry: (id) =>
        set((s) => ({ standupEntries: (s.standupEntries ?? []).filter((y) => y.id !== id) })),
      upsertSprintReview: (x) =>
        set((_st) => ({ sprintReviews: replaceById(_st.sprintReviews ?? [], x) })),
      removeSprintReview: (id) =>
        set((s) => ({ sprintReviews: (s.sprintReviews ?? []).filter((y) => y.id !== id) })),
      upsertRetroBoard: (x) =>
        set((_st) => ({ retroBoards: replaceById(_st.retroBoards ?? [], x) })),
      removeRetroBoard: (id) =>
        set((s) => ({ retroBoards: (s.retroBoards ?? []).filter((y) => y.id !== id) })),
      upsertSprintGoal: (x) =>
        set((_st) => ({ sprintGoals: replaceById(_st.sprintGoals ?? [], x) })),
      removeSprintGoal: (id) =>
        set((s) => ({ sprintGoals: (s.sprintGoals ?? []).filter((y) => y.id !== id) })),
      upsertJobStory: (x) => set((_st) => ({ jobStories: replaceById(_st.jobStories ?? [], x) })),
      removeJobStory: (id) =>
        set((s) => ({ jobStories: (s.jobStories ?? []).filter((y) => y.id !== id) })),
      upsertCapacityPlan: (x) =>
        set((_st) => ({ capacityPlans: replaceById(_st.capacityPlans ?? [], x) })),
      removeCapacityPlan: (id) =>
        set((s) => ({ capacityPlans: (s.capacityPlans ?? []).filter((y) => y.id !== id) })),
      upsertStoryMap: (x) => set((_st) => ({ storyMaps: replaceById(_st.storyMaps ?? [], x) })),
      removeStoryMap: (id) =>
        set((s) => ({ storyMaps: (s.storyMaps ?? []).filter((y) => y.id !== id) })),
      upsertBacklogItem: (x) =>
        set((_st) => ({ backlogItems: replaceById(_st.backlogItems ?? [], x) })),
      removeBacklogItem: (id) =>
        set((s) => {
          // Framework rows that scored this item stay, unlinked, each with
          // a frozen copy of the values it read through to the item (so a
          // WSJF row keeps its scores), whoever deletes it: the hub, Undo
          // of an add, the agent's workspace.backlog_item.delete.
          const item = (s.backlogItems ?? []).find((y) => y.id === id);
          const unlinked = rowsUnlinkedFrom(s.prioritizations ?? [], id, item);
          const byId = new Map(unlinked.map((p) => [p.id, p]));
          return {
            backlogItems: (s.backlogItems ?? []).filter((y) => y.id !== id),
            ...(unlinked.length > 0
              ? {
                  prioritizations: (s.prioritizations ?? []).map((p) => byId.get(p.id) ?? p),
                }
              : {}),
          };
        }),
      upsertNpsResponse: (x) =>
        set((_st) => ({ npsResponses: replaceById(_st.npsResponses ?? [], x) })),
      removeNpsResponse: (id) =>
        set((s) => ({ npsResponses: (s.npsResponses ?? []).filter((y) => y.id !== id) })),
      upsertMoodEntry: (x) =>
        set((_st) => ({ moodEntries: replaceById(_st.moodEntries ?? [], x) })),
      removeMoodEntry: (id) =>
        set((s) => ({ moodEntries: (s.moodEntries ?? []).filter((y) => y.id !== id) })),
      upsertKanbanBoard: (x) =>
        set((_st) => ({ kanbanBoards: replaceById(_st.kanbanBoards ?? [], x) })),
      removeKanbanBoard: (id) =>
        set((s) => ({ kanbanBoards: (s.kanbanBoards ?? []).filter((y) => y.id !== id) })),
      upsertDependencyMap: (x) =>
        set((_st) => ({ dependencyMaps: replaceById(_st.dependencyMaps ?? [], x) })),
      removeDependencyMap: (id) =>
        set((s) => ({ dependencyMaps: (s.dependencyMaps ?? []).filter((y) => y.id !== id) })),
      upsertValueStreamStage: (x) =>
        set((_st) => ({ valueStreamStages: replaceById(_st.valueStreamStages ?? [], x) })),
      removeValueStreamStage: (id) =>
        set((s) => ({ valueStreamStages: (s.valueStreamStages ?? []).filter((y) => y.id !== id) })),
      // Phase 42 — the tools plan's phase 1
      upsertParkingLotItem: (x) =>
        set((_st) => ({ parkingLotItems: replaceById(_st.parkingLotItems ?? [], x) })),
      removeParkingLotItem: (id) =>
        set((s) => ({ parkingLotItems: (s.parkingLotItems ?? []).filter((y) => y.id !== id) })),
      upsertRootCauseAnalysis: (x) =>
        set((_st) => ({ rootCauseAnalyses: replaceById(_st.rootCauseAnalyses ?? [], x) })),
      removeRootCauseAnalysis: (id) =>
        set((s) => ({ rootCauseAnalyses: (s.rootCauseAnalyses ?? []).filter((y) => y.id !== id) })),
      upsertProductGoal: (x) =>
        set((_st) => ({ productGoals: replaceById(_st.productGoals ?? [], x) })),
      removeProductGoal: (id) =>
        set((s) => ({ productGoals: (s.productGoals ?? []).filter((y) => y.id !== id) })),
      upsertInterruptItem: (x) =>
        set((_st) => ({ interruptItems: replaceById(_st.interruptItems ?? [], x) })),
      removeInterruptItem: (id) =>
        set((s) => ({ interruptItems: (s.interruptItems ?? []).filter((y) => y.id !== id) })),
      upsertNotebookEntry: (x) =>
        set((_st) => ({ notebookEntries: replaceById(_st.notebookEntries ?? [], x) })),
      removeNotebookEntry: (id) =>
        set((s) => ({ notebookEntries: (s.notebookEntries ?? []).filter((y) => y.id !== id) })),
      upsertMeetingAudit: (x) =>
        set((_st) => ({ meetingAudits: replaceById(_st.meetingAudits ?? [], x) })),
      removeMeetingAudit: (id) =>
        set((s) => ({ meetingAudits: (s.meetingAudits ?? []).filter((y) => y.id !== id) })),
      // Merge with emptyWorkspace first so "replace" truly replaces — unset
      // keys revert to their default rather than silently keeping prior state.
      replaceWorkspace: (w) => set({ ...emptyWorkspace, ...w }),
      resetWorkspace: () => set({ ...emptyWorkspace }),
      exportJSON: () => {
        const s = get();
        const data: Workspace = {
          teamMembers: s.teamMembers,
          sprints: s.sprints,
          sprintSeries: s.sprintSeries,
          ceremonyCadences: s.ceremonyCadences,
          stories: s.stories,
          impediments: s.impediments,
          risks: s.risks,
          okrs: s.okrs,
          decisions: s.decisions,
          techDebt: s.techDebt,
          maturityLevel: s.maturityLevel,
          teamName: s.teamName,
          // Phase 19
          llmEvals: s.llmEvals,
          prompts: s.prompts,
          hallucinations: s.hallucinations,
          tokenSpend: s.tokenSpend,
          models: s.models,
          redTeamFindings: s.redTeamFindings,
          agentWorkflows: s.agentWorkflows,
          agentNodes: s.agentNodes,
          hitlReviews: s.hitlReviews,
          rlhfPairs: s.rlhfPairs,
          vectorCollections: s.vectorCollections,
          modelCards: s.modelCards,
          aiFeatureSpecs: s.aiFeatureSpecs,
          aiSafetyChecklists: s.aiSafetyChecklists,
          modelMigrations: s.modelMigrations,
          threatModels: s.threatModels,
          vulnBurndowns: s.vulnBurndowns,
          controlMaps: s.controlMaps,
          a11yTrackers: s.a11yTrackers,
          testPyramids: s.testPyramids,
          flakyTestBoards: s.flakyTestBoards,
          codeReviewLogs: s.codeReviewLogs,
          doraScorecards: s.doraScorecards,
          healthDashboards: s.healthDashboards,
          featureFlags: s.featureFlags,
          sloBuilders: s.sloBuilders,
          spacePulses: s.spacePulses,
          devexSurveys: s.devexSurveys,
          platformMaturities: s.platformMaturities,
          workingAgreements: s.workingAgreements,
          liberatingStructures: s.liberatingStructures,
          designSprints: s.designSprints,
          riskiestAssumptions: s.riskiestAssumptions,
          wardleyMaps: s.wardleyMaps,
          epicRoadmaps: s.epicRoadmaps,
          hypothesisTrackers: s.hypothesisTrackers,
          userInterviewLogs: s.userInterviewLogs,
          runbookScorers: s.runbookScorers,
          releaseReadinesses: s.releaseReadinesses,
          oncallRosters: s.oncallRosters,
          incidentCommanders: s.incidentCommanders,
          postMortemLogs: s.postMortemLogs,
          psychSafetyLogs: s.psychSafetyLogs,
          maturityAssessments: s.maturityAssessments,
          healthChecks: s.healthChecks,
          skillsMatrices: s.skillsMatrices,
          pokerEstimationLogs: s.pokerEstimationLogs,
          pokerRounds: s.pokerRounds,
          // Phase 6 — Team & people
          definitionsOfDone: s.definitionsOfDone,
          raciMatrices: s.raciMatrices,
          adkarDocs: s.adkarDocs,
          moodTrackerDocs: s.moodTrackerDocs,
          moodPulses: s.moodPulses,
          opportunityTrees: s.opportunityTrees,
          // Phase 20
          prioritizations: s.prioritizations,
          // Phase 7 — Prioritize & decide
          allocationRounds: s.allocationRounds,
          buyAFeatureGames: s.buyAFeatureGames,
          weightedMatrices: s.weightedMatrices,
          // Phase 21
          daciDecisions: s.daciDecisions,
          rapidDecisions: s.rapidDecisions,
          weightedOptions: s.weightedOptions,
          weightedCriteria: s.weightedCriteria,
          sixHatsThoughts: s.sixHatsThoughts,
          sixHatsSessions: s.sixHatsSessions,
          oodaCycles: s.oodaCycles,
          cynefinItems: s.cynefinItems,
          staceyItems: s.staceyItems,
          polarities: s.polarities,
          polarityPoles: s.polarityPoles,
          sosEntries: s.sosEntries,
          asyncUpdates: s.asyncUpdates,
          standupEntries: s.standupEntries,
          sprintReviews: s.sprintReviews,
          retroBoards: s.retroBoards,
          sprintGoals: s.sprintGoals,
          jobStories: s.jobStories,
          capacityPlans: s.capacityPlans,
          storyMaps: s.storyMaps,
          backlogItems: s.backlogItems,
          npsResponses: s.npsResponses,
          moodEntries: s.moodEntries,
          kanbanBoards: s.kanbanBoards,
          dependencyMaps: s.dependencyMaps,
          valueStreamStages: s.valueStreamStages,
          // Phase 42 — the tools plan's phase 1
          parkingLotItems: s.parkingLotItems,
          rootCauseAnalyses: s.rootCauseAnalyses,
          productGoals: s.productGoals,
          interruptItems: s.interruptItems,
          notebookEntries: s.notebookEntries,
          meetingAudits: s.meetingAudits,
          // Phase 22
          whiteboards: s.whiteboards,
          whiteboardObjects: s.whiteboardObjects,
          whiteboardCommentThreads: s.whiteboardCommentThreads,
          whiteboardGroups: s.whiteboardGroups,
          // Phase 31/32 — these were silently omitted from export, so a
          // round-trip import/export lost the user's saved templates and
          // per-board activity log. Include them so backups are faithful.
          whiteboardSavedTemplates: s.whiteboardSavedTemplates,
          whiteboardActivityLog: s.whiteboardActivityLog,
          // R12-fix: kudos had the same omission — importJSON resets
          // missing keys to emptyWorkspace defaults ([]), so importing
          // your own export erased the entire kudos wall (and the sync
          // engine then propagated the wipe cloud-wide). importJSON
          // already validates entries via parseKudos on the way back in.
          kudos: s.kudos,
        };
        return JSON.stringify(data, null, 2);
      },
      importJSON: (json) => {
        // Validate shape before mutating state. Bound the payload size to
        // prevent UI-freezing JSON.parse calls on hostile inputs.
        if (typeof json !== "string" || json.length > MAX_IMPORT_BYTES) {
          throw new Error(`Import payload too large (max ${MAX_IMPORT_BYTES} bytes)`);
        }
        // Parse with a reviver that strips __proto__/constructor/prototype keys
        // so a crafted nested payload can't pollute the global Object prototype.
        const parsed: unknown = JSON.parse(json, safeJsonReviver);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Import payload must be a JSON object");
        }
        const p = parsed as Record<string, unknown>;
        // Generic helper used by all the Phase-19+ entity slots. The Workspace
        // entity types share no common base, so we type-assert at the call site
        // (export round-trips trust the producer). Sanitization still goes
        // through `sanitizeArray` for the core entities where we want strict
        // id+shape checks.
        const arr = <K extends keyof Workspace>(k: K): Workspace[K] | undefined =>
          Array.isArray(p[k]) ? (p[k] as Workspace[K]) : undefined;
        const sanitized: Partial<Workspace> = {
          teamMembers: sanitizeArray<TeamMember>(p.teamMembers),
          sprints: sanitizeArray<Sprint>(p.sprints),
          sprintSeries: sanitizeArray<SprintSeries>(p.sprintSeries),
          ceremonyCadences: sanitizeArray<CeremonyCadenceDoc>(p.ceremonyCadences),
          stories: sanitizeArray<Story>(p.stories),
          impediments: sanitizeArray<Impediment>(p.impediments),
          risks: sanitizeArray<Risk>(p.risks),
          okrs: sanitizeArray<Okr>(p.okrs),
          decisions: sanitizeArray<Decision>(p.decisions),
          techDebt: sanitizeArray<TechDebtItem>(p.techDebt),
          // Require an integer in [1,5] (isMaturityLevel).
          maturityLevel: isMaturityLevel(p.maturityLevel) ? p.maturityLevel : undefined,
          teamName: typeof p.teamName === "string" ? p.teamName : undefined,
          // Phase 19 — accept arrays only; unknown shapes get dropped
          llmEvals: arr("llmEvals"),
          prompts: arr("prompts"),
          hallucinations: arr("hallucinations"),
          tokenSpend: arr("tokenSpend"),
          models: arr("models"),
          redTeamFindings: arr("redTeamFindings"),
          agentWorkflows: arr("agentWorkflows"),
          agentNodes: arr("agentNodes"),
          hitlReviews: arr("hitlReviews"),
          rlhfPairs: arr("rlhfPairs"),
          vectorCollections: arr("vectorCollections"),
          modelCards: arr("modelCards"),
          aiFeatureSpecs: arr("aiFeatureSpecs"),
          aiSafetyChecklists: arr("aiSafetyChecklists"),
          modelMigrations: arr("modelMigrations"),
          threatModels: arr("threatModels"),
          vulnBurndowns: arr("vulnBurndowns"),
          controlMaps: arr("controlMaps"),
          a11yTrackers: arr("a11yTrackers"),
          testPyramids: arr("testPyramids"),
          flakyTestBoards: arr("flakyTestBoards"),
          codeReviewLogs: arr("codeReviewLogs"),
          doraScorecards: arr("doraScorecards"),
          healthDashboards: arr("healthDashboards"),
          featureFlags: arr("featureFlags"),
          sloBuilders: arr("sloBuilders"),
          spacePulses: arr("spacePulses"),
          devexSurveys: arr("devexSurveys"),
          platformMaturities: arr("platformMaturities"),
          workingAgreements: arr("workingAgreements"),
          liberatingStructures: arr("liberatingStructures"),
          designSprints: arr("designSprints"),
          riskiestAssumptions: arr("riskiestAssumptions"),
          wardleyMaps: arr("wardleyMaps"),
          epicRoadmaps: arr("epicRoadmaps"),
          hypothesisTrackers: arr("hypothesisTrackers"),
          userInterviewLogs: arr("userInterviewLogs"),
          runbookScorers: arr("runbookScorers"),
          releaseReadinesses: arr("releaseReadinesses"),
          oncallRosters: arr("oncallRosters"),
          incidentCommanders: arr("incidentCommanders"),
          postMortemLogs: arr("postMortemLogs"),
          psychSafetyLogs: arr("psychSafetyLogs"),
          maturityAssessments: arr("maturityAssessments"),
          healthChecks: arr("healthChecks"),
          skillsMatrices: arr("skillsMatrices"),
          pokerEstimationLogs: arr("pokerEstimationLogs"),
          pokerRounds: arr("pokerRounds"),
          // Phase 6 — Team & people
          definitionsOfDone: arr("definitionsOfDone"),
          raciMatrices: arr("raciMatrices"),
          adkarDocs: arr("adkarDocs"),
          moodTrackerDocs: arr("moodTrackerDocs"),
          moodPulses: arr("moodPulses"),
          opportunityTrees: arr("opportunityTrees"),
          // Phase 20
          prioritizations: arr("prioritizations"),
          // Phase 7 — Prioritize & decide
          allocationRounds: arr("allocationRounds"),
          buyAFeatureGames: arr("buyAFeatureGames"),
          weightedMatrices: arr("weightedMatrices"),
          // Phase 21
          daciDecisions: arr("daciDecisions"),
          rapidDecisions: arr("rapidDecisions"),
          weightedOptions: arr("weightedOptions"),
          weightedCriteria: arr("weightedCriteria"),
          sixHatsThoughts: arr("sixHatsThoughts"),
          sixHatsSessions: arr("sixHatsSessions"),
          oodaCycles: arr("oodaCycles"),
          cynefinItems: arr("cynefinItems"),
          staceyItems: arr("staceyItems"),
          polarities: arr("polarities"),
          polarityPoles: arr("polarityPoles"),
          sosEntries: arr("sosEntries"),
          asyncUpdates: arr("asyncUpdates"),
          standupEntries: arr("standupEntries"),
          sprintReviews: arr("sprintReviews"),
          retroBoards: arr("retroBoards"),
          sprintGoals: arr("sprintGoals"),
          jobStories: arr("jobStories"),
          capacityPlans: arr("capacityPlans"),
          storyMaps: arr("storyMaps"),
          backlogItems: arr("backlogItems"),
          npsResponses: arr("npsResponses"),
          moodEntries: arr("moodEntries"),
          kanbanBoards: arr("kanbanBoards"),
          dependencyMaps: arr("dependencyMaps"),
          valueStreamStages: arr("valueStreamStages"),
          // Phase 42 — the tools plan's phase 1
          parkingLotItems: arr("parkingLotItems"),
          rootCauseAnalyses: arr("rootCauseAnalyses"),
          productGoals: arr("productGoals"),
          interruptItems: arr("interruptItems"),
          notebookEntries: arr("notebookEntries"),
          meetingAudits: arr("meetingAudits"),
          // Phase 22 — Canvas
          whiteboards: arr("whiteboards"),
          whiteboardObjects: arr("whiteboardObjects"),
          whiteboardCommentThreads: arr("whiteboardCommentThreads"),
          whiteboardGroups: arr("whiteboardGroups"),
          // Phase 31 — saved templates. Pure array; nested objects keep
          // their original shape (we trust the export came from us).
          whiteboardSavedTemplates: arr("whiteboardSavedTemplates"),
          // Phase 32 — activity log. Validate per-entry: a malformed
          // export (or a buggy AI prompt that fed garbage into the
          // append action prior to validation) would otherwise pollute
          // the rolling ring. Caps mirror appendWhiteboardActivity().
          whiteboardActivityLog: Array.isArray(p.whiteboardActivityLog)
            ? (p.whiteboardActivityLog as unknown[])
                // Cap total imported events at the rolling-ring limit
                // (1000 global). A malicious export with 100k × 1000-char
                // summaries would otherwise blow ~100MB into memory and
                // localStorage. We slice BEFORE validation so the filter
                // doesn't waste cycles on dropped entries.
                .slice(-1000)
                .filter((e): e is import("./workspace-types").WhiteboardActivityEvent => {
                  if (!e || typeof e !== "object") return false;
                  const ev = e as Record<string, unknown>;
                  if (typeof ev.id !== "string" || ev.id.length > 100) return false;
                  if (typeof ev.boardId !== "string" || ev.boardId.length > 100) return false;
                  if (typeof ev.at !== "number" || !Number.isFinite(ev.at)) return false;
                  if (typeof ev.author !== "string" || ev.author.length > 200) return false;
                  if (typeof ev.kind !== "string" || ev.kind.length > 64) return false;
                  if (typeof ev.summary !== "string" || ev.summary.length > 1000) return false;
                  return true;
                })
            : undefined,
          // Kudos wall — same `parseKudos` the realtime + upsert paths
          // use, so a tampered export can't smuggle malformed entries
          // past the import boundary. Map-then-filter so v1 rows arrive
          // already upgraded to v2-stamped shape. Cap to the same 500
          // ceiling the live store enforces.
          kudos: Array.isArray(p.kudos)
            ? (p.kudos as unknown[])
                .slice(-500)
                .map((raw) => parseKudos(raw))
                .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
                .map((r) => r.kudos)
            : undefined,
        };
        // Drop undefined entries so emptyWorkspace defaults stand in for missing keys.
        for (const k of Object.keys(sanitized) as (keyof Workspace)[]) {
          if (sanitized[k] === undefined) delete sanitized[k];
        }
        set({ ...emptyWorkspace, ...sanitized });
      },
    }),
    {
      name: "agile-toolkit:workspace",
      // Phase 31/32 added `whiteboardSavedTemplates` and
      // `whiteboardActivityLog`. Zustand's default shallow merge fills
      // missing top-level keys from the initial state (emptyWorkspace
      // defaults to []), so existing v0 payloads load fine — but we
      // tag this as v1 explicitly so any FUTURE schema break can hook a
      // proper `migrate` here without a guessing game about which
      // shape a given persisted blob represents. `merge` is left at the
      // default; the migration runs only when the persisted version
      // is older than `version`.
      version: 1,
      migrate: (persistedState, fromVersion) => {
        // R9: previously MUTATED `persistedState` in place via
        // `p.whiteboardSavedTemplates = []`. Zustand persist's contract
        // treats migrate's input as immutable — any cached references
        // (e.g. zustand-devtools snapshot) could see the mutation.
        // Spread into a fresh object instead.
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState as Workspace & WorkspaceActions;
        }
        if (fromVersion < 1) {
          const p = persistedState as Record<string, unknown>;
          return {
            ...p,
            whiteboardSavedTemplates: Array.isArray(p.whiteboardSavedTemplates)
              ? p.whiteboardSavedTemplates
              : [],
            whiteboardActivityLog: Array.isArray(p.whiteboardActivityLog)
              ? p.whiteboardActivityLog
              : [],
          } as Workspace & WorkspaceActions;
        }
        return persistedState as Workspace & WorkspaceActions;
      },
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        // Wrap localStorage so a QuotaExceededError doesn't crash the
        // app. Image-heavy boards (Phase 25) can exceed the 5 MB
        // origin cap; on quota error we warn but keep the in-memory
        // state alive — the user can still export to JSON.
        //
        // We also guard getItem/removeItem: Safari in Private Browsing
        // mode (and certain corporate-managed Chromes) can throw
        // SecurityError on every localStorage access. Without the
        // try/catch, the persist middleware would surface that during
        // hydration and crash the page on load.
        return {
          getItem: (k: string) => {
            try {
              return localStorage.getItem(k);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                "[workspace-store] localStorage.getItem blocked — starting with empty workspace.",
                err
              );
              return null;
            }
          },
          setItem: (k: string, v: string) => {
            try {
              localStorage.setItem(k, v);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                "[workspace-store] localStorage quota exceeded — workspace held in memory only. Export to JSON to back it up.",
                err
              );
              reportStorageWriteFailure();
            }
          },
          removeItem: (k: string) => {
            try {
              localStorage.removeItem(k);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn("[workspace-store] localStorage.removeItem blocked.", err);
            }
          },
        };
      }),
      skipHydration: true,
    }
  )
);

// Kick off rehydration as soon as the module is loaded on the client. Without
// this, tools that read the workspace but don't mount InsightsEngine (e.g.
// burndown / velocity / capacity-planner) would render against an empty
// default workspace until something else triggers rehydrate.
//
// Consumers that need to render against the hydrated state on first paint
// should gate on `useWorkspaceStore.persist.hasHydrated()` to avoid a
// one-frame flash of empty defaults — see InsightsEngine for the pattern.
if (typeof window !== "undefined") {
  void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch(() => {
    /* corrupt persisted state — keep emptyWorkspace defaults */
  });

  // R11-fix: cross-tab synchronisation. Two tabs of the same browser
  // each load + mutate the workspace independently; the LAST tab to
  // persist wins, silently clobbering the OTHER tab's work on the
  // next reload. Now: listen to the `storage` event (only fires in
  // OTHER tabs when localStorage changes) and trigger a rehydrate
  // when the workspace key changes. The active tab's in-memory state
  // is replaced with the latest persisted snapshot — last write wins
  // semantics but at least both tabs converge live.
  //
  // We debounce because rapid mutations in one tab fire many storage
  // events; rehydrate is heavy (full state replace + every subscriber
  // re-renders). 250 ms feels live without thrashing.
  //
  // HMR safety: the prior version registered a fresh listener on every
  // module re-execution. After N dev reloads a single cross-tab write
  // fired N rehydrates. Guard with a module-scoped global flag (using
  // window so it survives module replacement, unlike a top-level let).
  type WindowWithFlag = Window & { __agileToolkitStorageListener?: boolean };
  const w = window as WindowWithFlag;
  if (!w.__agileToolkitStorageListener) {
    w.__agileToolkitStorageListener = true;
    let rehydrateTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener("storage", (e) => {
      if (e.key !== "agile-toolkit:workspace") return;
      if (e.newValue === null) return; // tab cleared storage — leave us alone
      if (rehydrateTimer !== null) clearTimeout(rehydrateTimer);
      rehydrateTimer = setTimeout(() => {
        rehydrateTimer = null;
        void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch(() => {});
      }, 250);
    });
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Cross-device cloud sync registrations
 *
 * Each entity collection is registered as a per-entity sync target so
 * a sprint created on Device A appears on Device B within ~1s via
 * Supabase Realtime. Scalars (teamName, maturityLevel) are bundled
 * into one blob slot.
 *
 * Echo suppression: the entity adapters internally flag remote-applied
 * writes to prevent the workspace subscribe handler from re-pushing
 * the same data we just received. Zustand subscribes fire synchronously
 * inside setState, so the suppression window is reliable.
 * ────────────────────────────────────────────────────────────────── */
if (typeof window !== "undefined") {
  // Dynamic-import the sync registry so this module stays usable in
  // server-side / test contexts where the sync engine isn't desired.
  void import("@/lib/sync/register").then(({ registerEntityCollection, registerBlobStore }) => {
    const registry = useWorkspaceStore;

    // ── Per-entity collections ────────────────────────────────────
    // Runtime-validated: each `slice` is a key on Workspace whose value
    // is an array of entities with `id`. TypeScript can't verify the
    // shape across the conditional / optional fields, so we erase the
    // generic and rely on the call-site list to keep things honest.
    const registerCollection = (
      kind: string,
      slice: keyof Workspace,
      pushIntervalMs?: number
    ): void => {
      registerEntityCollection({
        kind: `workspace:${kind}`,
        getEntities: () => {
          // BUG-W23: gate reads on hasHydrated. If a push is scheduled
          // before rehydrate resolves, the sync layer would upload the
          // EMPTY default workspace to Supabase, overwriting the user's
          // authoritative server data. Returning `[]` here keeps the
          // sync engine's push diff a no-op until hydration completes.
          if (!registry.persist.hasHydrated()) return [];
          const v = (registry.getState() as unknown as Record<string, unknown>)[slice as string];
          return (Array.isArray(v) ? v : []) as ReadonlyArray<{ id: string }>;
        },
        setEntities: (next) =>
          registry.setState({ [slice]: next } as unknown as Partial<Workspace>),
        subscribe: (onChange) =>
          registry.subscribe((curr, prev) => {
            // BUG-W23 (cont.): also suppress change notifications during
            // hydration. Otherwise the initial setState from rehydrate
            // would look like a user write and trigger a push.
            if (!registry.persist.hasHydrated()) return;
            const c = (curr as unknown as Record<string, unknown>)[slice as string];
            const p = (prev as unknown as Record<string, unknown>)[slice as string];
            if (c !== p) onChange();
          }),
        pushIntervalMs,
      });
    };

    registerCollection("teamMember", "teamMembers");
    registerCollection("sprint", "sprints");
    registerCollection("sprintSeries", "sprintSeries");
    registerCollection("ceremonyCadence", "ceremonyCadences");
    registerCollection("story", "stories");
    registerCollection("impediment", "impediments");
    registerCollection("risk", "risks");
    registerCollection("okr", "okrs");
    registerCollection("decision", "decisions");
    registerCollection("techDebt", "techDebt");
    // Phase 19 — AI/LLM PM
    registerCollection("llmEval", "llmEvals");
    registerCollection("prompt", "prompts");
    registerCollection("hallucination", "hallucinations");
    registerCollection("tokenSpend", "tokenSpend");
    registerCollection("model", "models");
    registerCollection("redTeamFinding", "redTeamFindings");
    registerCollection("agentWorkflow", "agentWorkflows");
    registerCollection("agentNode", "agentNodes");
    registerCollection("hitlReview", "hitlReviews");
    registerCollection("rlhfPair", "rlhfPairs");
    registerCollection("vectorCollection", "vectorCollections");
    registerCollection("modelCard", "modelCards");
    registerCollection("aiFeatureSpec", "aiFeatureSpecs");
    registerCollection("aiSafetyChecklist", "aiSafetyChecklists");
    registerCollection("modelMigration", "modelMigrations");
    registerCollection("threatModel", "threatModels");
    registerCollection("vulnBurndown", "vulnBurndowns");
    registerCollection("controlMap", "controlMaps");
    registerCollection("a11yTracker", "a11yTrackers");
    registerCollection("testPyramid", "testPyramids");
    registerCollection("flakyTestBoard", "flakyTestBoards");
    registerCollection("codeReviewLog", "codeReviewLogs");
    registerCollection("doraScorecard", "doraScorecards");
    registerCollection("healthDashboard", "healthDashboards");
    registerCollection("featureFlag", "featureFlags");
    registerCollection("sloBuilder", "sloBuilders");
    registerCollection("spacePulse", "spacePulses");
    registerCollection("devexSurvey", "devexSurveys");
    registerCollection("platformMaturity", "platformMaturities");
    registerCollection("workingAgreement", "workingAgreements");
    registerCollection("liberatingStructures", "liberatingStructures");
    registerCollection("designSprint", "designSprints");
    registerCollection("riskiestAssumption", "riskiestAssumptions");
    registerCollection("wardleyMap", "wardleyMaps");
    registerCollection("epicRoadmap", "epicRoadmaps");
    registerCollection("hypothesisTracker", "hypothesisTrackers");
    registerCollection("userInterviewLog", "userInterviewLogs");
    registerCollection("opportunityTree", "opportunityTrees");
    // S8 — Incidents & Reliability
    registerCollection("runbookScorer", "runbookScorers");
    registerCollection("releaseReadiness", "releaseReadinesses");
    registerCollection("oncallRoster", "oncallRosters");
    registerCollection("incidentCommander", "incidentCommanders");
    registerCollection("postMortem", "postMortemLogs");
    // S4 — Team Health & Maturity
    registerCollection("psychSafety", "psychSafetyLogs");
    registerCollection("maturityAssessment", "maturityAssessments");
    registerCollection("healthCheck", "healthChecks");
    registerCollection("skillsMatrix", "skillsMatrices");
    registerCollection("pokerEstimationLog", "pokerEstimationLogs");
    registerCollection("pokerRound", "pokerRounds");
    // Phase 6 — Team & people. Each kind is what kindFromToolId derives from
    // its workspace.* CRUD (workspace.definition_of_done → definitionOfDone,
    // workspace.mood_tracker_doc → moodTrackerDoc, …), so the agents' CRUD
    // needs no serverKind override. Server-side code names them by the
    // workspace-types constants DOD_KIND, RACI_KIND, ADKAR_KIND,
    // MOOD_TRACKER_KIND and MOOD_PULSE_KIND; a test keeps the three in step.
    registerCollection("definitionOfDone", "definitionsOfDone");
    registerCollection("raciMatrix", "raciMatrices");
    registerCollection("adkarDoc", "adkarDocs");
    registerCollection("moodTrackerDoc", "moodTrackerDocs");
    registerCollection("moodPulse", "moodPulses");
    // Phase 20 — Prioritization
    registerCollection("prioritization", "prioritizations");
    // Phase 7 — Prioritize & decide. As in Phase 6, each kind is what
    // kindFromToolId derives from its workspace.* CRUD (allocation_round,
    // buy_a_feature_game, weighted_matrix), and server-side code names them
    // by ALLOCATION_ROUND_KIND, BUY_A_FEATURE_KIND and WEIGHTED_MATRIX_KIND;
    // a test keeps the three in step.
    registerCollection("allocationRound", "allocationRounds");
    registerCollection("buyAFeatureGame", "buyAFeatureGames");
    registerCollection("weightedMatrix", "weightedMatrices");
    // Phase 21 — Decision frameworks
    registerCollection("daciDecision", "daciDecisions");
    registerCollection("rapidDecision", "rapidDecisions");
    registerCollection("weightedOption", "weightedOptions");
    registerCollection("weightedCriterion", "weightedCriteria");
    registerCollection("sixHatsThought", "sixHatsThoughts");
    registerCollection("sixHatsSession", "sixHatsSessions");
    registerCollection("oodaCycle", "oodaCycles");
    registerCollection("cynefinItem", "cynefinItems");
    registerCollection("staceyItem", "staceyItems");
    registerCollection("polarity", "polarities");
    registerCollection("polarityPole", "polarityPoles");
    registerCollection("sosEntry", "sosEntries");
    registerCollection("asyncUpdate", "asyncUpdates");
    registerCollection("standupEntry", "standupEntries");
    registerCollection("sprintReview", "sprintReviews");
    registerCollection("retroBoard", "retroBoards");
    registerCollection("sprintGoal", "sprintGoals");
    registerCollection("jobStory", "jobStories");
    registerCollection("capacityPlan", "capacityPlans");
    registerCollection("storyMap", "storyMaps");
    registerCollection("backlogItem", "backlogItems");
    registerCollection("npsResponse", "npsResponses");
    registerCollection("moodEntry", "moodEntries");
    registerCollection("kanbanBoard", "kanbanBoards");
    registerCollection("dependencyMap", "dependencyMaps");
    registerCollection("valueStreamStage", "valueStreamStages");
    // Phase 42 — the tools plan's phase 1. Each kind is what kindFromToolId
    // derives from its workspace.* CRUD (workspace.parking_lot_item →
    // parkingLotItem, …), and server-side code names them by the
    // workspace-types constants (PARKING_LOT_ITEM_KIND, …); a test keeps the
    // three in step.
    registerCollection("parkingLotItem", "parkingLotItems");
    registerCollection("rootCauseAnalysis", "rootCauseAnalyses");
    registerCollection("productGoal", "productGoals");
    registerCollection("interruptItem", "interruptItems");
    registerCollection("notebookEntry", "notebookEntries");
    registerCollection("meetingAudit", "meetingAudits");
    // Kudos wall — was localStorage-only + ephemeral realtime broadcast; now
    // also a per-entity synced collection so the agent (tool.kudos.*) can read
    // + post and the wall cloud-persists cross-device. The realtime broadcast
    // stays for instant live fan-out; upsertKudos is id-keyed so dual arrival
    // (broadcast + sync pull) is idempotent. No competing cloud path exists
    // (no monolithic workspace doc), so this does not double-write.
    registerCollection("kudos", "kudos");
    // Phase 22 — Canvas. Whiteboard objects are throttled to 2s pushes
    // because drag operations can dirty hundreds of them per second.
    registerCollection("whiteboard", "whiteboards");
    // 800ms throttle: a generous compromise between burning Supabase quota
    // during a drag and bounding the worst-case loss on tab close. Drags
    // commit position updates at 60Hz; we coalesce them into ≤2 pushes/sec.
    registerCollection("whiteboardObject", "whiteboardObjects", 800);
    registerCollection("whiteboardCommentThread", "whiteboardCommentThreads");
    registerCollection("whiteboardGroup", "whiteboardGroups");
    registerCollection("whiteboardSavedTemplate", "whiteboardSavedTemplates");
    registerCollection("whiteboardActivity", "whiteboardActivityLog");

    // ── Scalars (teamName, maturityLevel) as one blob ─────────────
    interface WorkspaceScalars {
      teamName?: string;
      /** null = unassessed. */
      maturityLevel?: number | null;
    }
    registerBlobStore({
      storeKey: "agile-toolkit:workspace:scalars",
      getSnapshot: (): WorkspaceScalars => {
        const s = registry.getState();
        // An unassessed team is sent as null, not left out: JSON drops an
        // undefined key, so clearing the level (the Maturity tool removing
        // its last assessment) never reached other devices or the agents.
        return { teamName: s.teamName, maturityLevel: s.maturityLevel ?? null };
      },
      setSnapshot: (next) => {
        // R12-fix: apply only keys PRESENT in the blob. The server-side
        // serverPatchWorkspaceBlob (MCP set_team_name / set_maturity_level)
        // first-touch-INSERTS a partial blob (e.g. only maturityLevel);
        // unconditionally writing both keys here set the missing one to
        // undefined — wiping the local teamName, which the subscribe below
        // then pushed back to the cloud, making the wipe permanent. Mirrors
        // the whitelist-merge in create-persisted-store's setSnapshot.
        const v = (next ?? {}) as WorkspaceScalars;
        const patch: Partial<Workspace> = {};
        if ("teamName" in v) patch.teamName = v.teamName;
        if ("maturityLevel" in v) {
          // null (unassessed) or anything outside the integer 1-5 band
          // clears the level, as importJSON reads it.
          patch.maturityLevel = isMaturityLevel(v.maturityLevel) ? v.maturityLevel : undefined;
        }
        if (Object.keys(patch).length > 0) registry.setState(patch);
      },
      subscribe: (onChange) =>
        registry.subscribe((curr, prev) => {
          if (curr.teamName !== prev.teamName || curr.maturityLevel !== prev.maturityLevel) {
            onChange();
          }
        }),
    });
  });
}

export function getWorkspaceSnapshot(): Workspace {
  const state = useWorkspaceStore.getState();
  // Consumers should treat the returned object as immutable — mutating the
  // arrays in-place bypasses Zustand and any time-travel snapshot.
  return {
    teamMembers: state.teamMembers,
    sprints: state.sprints,
    sprintSeries: state.sprintSeries,
    ceremonyCadences: state.ceremonyCadences,
    stories: state.stories,
    impediments: state.impediments,
    risks: state.risks,
    okrs: state.okrs,
    decisions: state.decisions,
    techDebt: state.techDebt,
    maturityLevel: state.maturityLevel,
    teamName: state.teamName,
    llmEvals: state.llmEvals,
    prompts: state.prompts,
    hallucinations: state.hallucinations,
    tokenSpend: state.tokenSpend,
    models: state.models,
    redTeamFindings: state.redTeamFindings,
    agentWorkflows: state.agentWorkflows,
    agentNodes: state.agentNodes,
    hitlReviews: state.hitlReviews,
    rlhfPairs: state.rlhfPairs,
    vectorCollections: state.vectorCollections,
    modelCards: state.modelCards,
    aiFeatureSpecs: state.aiFeatureSpecs,
    aiSafetyChecklists: state.aiSafetyChecklists,
    modelMigrations: state.modelMigrations,
    threatModels: state.threatModels,
    vulnBurndowns: state.vulnBurndowns,
    controlMaps: state.controlMaps,
    a11yTrackers: state.a11yTrackers,
    testPyramids: state.testPyramids,
    flakyTestBoards: state.flakyTestBoards,
    codeReviewLogs: state.codeReviewLogs,
    doraScorecards: state.doraScorecards,
    healthDashboards: state.healthDashboards,
    featureFlags: state.featureFlags,
    sloBuilders: state.sloBuilders,
    spacePulses: state.spacePulses,
    devexSurveys: state.devexSurveys,
    platformMaturities: state.platformMaturities,
    workingAgreements: state.workingAgreements,
    liberatingStructures: state.liberatingStructures,
    designSprints: state.designSprints,
    riskiestAssumptions: state.riskiestAssumptions,
    wardleyMaps: state.wardleyMaps,
    epicRoadmaps: state.epicRoadmaps,
    hypothesisTrackers: state.hypothesisTrackers,
    userInterviewLogs: state.userInterviewLogs,
    runbookScorers: state.runbookScorers,
    releaseReadinesses: state.releaseReadinesses,
    oncallRosters: state.oncallRosters,
    incidentCommanders: state.incidentCommanders,
    postMortemLogs: state.postMortemLogs,
    psychSafetyLogs: state.psychSafetyLogs,
    maturityAssessments: state.maturityAssessments,
    healthChecks: state.healthChecks,
    skillsMatrices: state.skillsMatrices,
    pokerEstimationLogs: state.pokerEstimationLogs,
    pokerRounds: state.pokerRounds,
    definitionsOfDone: state.definitionsOfDone,
    raciMatrices: state.raciMatrices,
    adkarDocs: state.adkarDocs,
    moodTrackerDocs: state.moodTrackerDocs,
    moodPulses: state.moodPulses,
    opportunityTrees: state.opportunityTrees,
    prioritizations: state.prioritizations,
    allocationRounds: state.allocationRounds,
    buyAFeatureGames: state.buyAFeatureGames,
    weightedMatrices: state.weightedMatrices,
    daciDecisions: state.daciDecisions,
    rapidDecisions: state.rapidDecisions,
    weightedOptions: state.weightedOptions,
    weightedCriteria: state.weightedCriteria,
    sixHatsThoughts: state.sixHatsThoughts,
    sixHatsSessions: state.sixHatsSessions,
    oodaCycles: state.oodaCycles,
    cynefinItems: state.cynefinItems,
    staceyItems: state.staceyItems,
    polarities: state.polarities,
    polarityPoles: state.polarityPoles,
    whiteboards: state.whiteboards,
    whiteboardObjects: state.whiteboardObjects,
    whiteboardCommentThreads: state.whiteboardCommentThreads,
    whiteboardGroups: state.whiteboardGroups,
    // Phase 31/32 — surfaced in snapshots so analytics / AI-prompt
    // builders see the same workspace the user does.
    whiteboardSavedTemplates: state.whiteboardSavedTemplates,
    whiteboardActivityLog: state.whiteboardActivityLog,
    kudos: state.kudos,
    sosEntries: state.sosEntries,
    asyncUpdates: state.asyncUpdates,
    standupEntries: state.standupEntries,
    sprintReviews: state.sprintReviews,
    retroBoards: state.retroBoards,
    sprintGoals: state.sprintGoals,
    jobStories: state.jobStories,
    capacityPlans: state.capacityPlans,
    storyMaps: state.storyMaps,
    backlogItems: state.backlogItems,
    npsResponses: state.npsResponses,
    moodEntries: state.moodEntries,
    kanbanBoards: state.kanbanBoards,
    dependencyMaps: state.dependencyMaps,
    valueStreamStages: state.valueStreamStages,
    parkingLotItems: state.parkingLotItems,
    rootCauseAnalyses: state.rootCauseAnalyses,
    productGoals: state.productGoals,
    interruptItems: state.interruptItems,
    notebookEntries: state.notebookEntries,
    meetingAudits: state.meetingAudits,
  };
}

// Pure, so they live in their own module (see sprint-selectors.ts).
export { selectActiveSprint, selectCompletedSprints } from "./sprint-selectors";

export function selectActiveImpediments(w: Workspace): Impediment[] {
  return w.impediments.filter((i) => !i.resolvedAt);
}

export function selectOpenRisks(w: Workspace): Risk[] {
  // "open" + "mitigating" are still actionable — "accepted" risks are
  // explicitly out-of-scope (team has decided not to mitigate them) and
  // "closed" are resolved. Consumers needing the broader set should call
  // a different selector.
  return w.risks.filter((r) => r.status === "open" || r.status === "mitigating");
}
