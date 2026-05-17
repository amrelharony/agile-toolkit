import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Workspace,
  TeamMember,
  Sprint,
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
  // Phase 20
  PrioritizationItem,
  // Phase 21
  DACIDecision,
  RAPIDDecision,
  WeightedOption,
  WeightedCriterion,
  SixHatsThought,
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
} from "./workspace-types";
import { emptyWorkspace } from "./workspace-types";

interface WorkspaceActions {
  setTeamName: (name: string) => void;
  upsertTeamMember: (m: TeamMember) => void;
  removeTeamMember: (id: string) => void;
  upsertSprint: (s: Sprint) => void;
  removeSprint: (id: string) => void;
  upsertStory: (s: Story) => void;
  removeStory: (id: string) => void;
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
  // Phase 20 — Prioritization
  upsertPrioritization: (x: PrioritizationItem) => void;
  removePrioritization: (id: string) => void;
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
  replaceWorkspace: (w: Partial<Workspace>) => void;
  resetWorkspace: () => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
}

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

export const useWorkspaceStore = create<Workspace & WorkspaceActions>()(
  persist(
    (set, get) => ({
      ...emptyWorkspace,
      setTeamName: (name) => set({ teamName: name }),
      upsertTeamMember: (m) => set({ teamMembers: replaceById(get().teamMembers, m) }),
      removeTeamMember: (id) => set((s) => {
        // Stories whose `owner` pointed at this member, OKRs whose
        // `owner` did, and canvas cards whose `assignee` referenced
        // this member id should all clear the reference. The data
        // model uses `owner` / `assignee` fields as opaque strings —
        // they might be display names OR ids — so we only strip when
        // the field exactly matches the deleted member's id.
        const storiesAffected = s.stories.some((st) => st.owner === id);
        const okrsAffected = (s.okrs ?? []).some((o) => o.owner === id);
        const cardsAffected = (s.whiteboardObjects ?? []).some(
          (o) => o.type === "card" && o.assignee === id,
        );
        const next: Partial<Workspace> = {
          teamMembers: s.teamMembers.filter((x) => x.id !== id),
        };
        if (storiesAffected) {
          next.stories = s.stories.map((st) =>
            st.owner === id ? { ...st, owner: undefined } : st,
          );
        }
        if (okrsAffected) {
          next.okrs = s.okrs.map((o) =>
            o.owner === id ? { ...o, owner: undefined } : o,
          );
        }
        if (cardsAffected) {
          const now = new Date().toISOString();
          next.whiteboardObjects = (s.whiteboardObjects ?? []).map((o) =>
            o.type === "card" && o.assignee === id
              ? { ...o, assignee: undefined, version: o.version + 1, updatedAt: now }
              : o,
          );
        }
        return next;
      }),
      upsertSprint: (s) => set({ sprints: replaceById(get().sprints, s) }),
      removeSprint: (id) => set((s) => {
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
        if (storyAffected) {
          next.stories = s.stories.map((st) =>
            st.sprintId === id ? { ...st, sprintId: undefined } : st,
          );
        }
        if (wbAffected) {
          next.whiteboardObjects = (s.whiteboardObjects ?? []).map((o) =>
            isWbLink(o)
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          );
        }
        return next;
      }),
      upsertStory: (s) => set({ stories: replaceById(get().stories, s) }),
      removeStory: (id) => set((s) => {
        // Phase 26 cascade: any canvas object pinned to this Story via
        // sourceRef now points at nothing. Strip the sourceRef so the
        // object becomes a standalone snapshot; without this, future
        // sync attempts against the dead id would silently fail and
        // the link badge ("↳ backlog") would be misleading.
        //
        // Two tool labels are in the wild: cards added via the canvas
        // wizard use `tool: "backlog"`, while `importFromStories` in
        // cross-tool-import.ts emits `tool: "story"`. Match both, and
        // include ALL object kinds (sticky/card) — `importFromStories`
        // produces stickies, not just cards.
        //
        // Pre-check so the common case (zero refs) doesn't allocate
        // a fresh whiteboardObjects array via .map().
        const isStoryLink = (o: WhiteboardObject) =>
          (o.sourceRef?.tool === "backlog" || o.sourceRef?.tool === "story") &&
          o.sourceRef.entityId === id;
        // R5: WhiteboardVoting can pin to a story via `storyId` (Phase 27);
        // clear that too so the voting widget doesn't keep a dead link
        // that would cause confusing UI ("anchored to a story that no
        // longer exists").
        const isVotingLink = (o: WhiteboardObject) =>
          o.type === "voting" && o.storyId === id;
        const affected = (s.whiteboardObjects ?? []).some(
          (o) => isStoryLink(o) || isVotingLink(o),
        );
        if (!affected) return { stories: s.stories.filter((x) => x.id !== id) };
        const now = new Date().toISOString();
        return {
          stories: s.stories.filter((x) => x.id !== id),
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
      }),
      upsertImpediment: (i) => set({ impediments: replaceById(get().impediments, i) }),
      removeImpediment: (id) => set((s) => {
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
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          ),
        };
      }),
      upsertRisk: (r) => set({ risks: replaceById(get().risks, r) }),
      removeRisk: (id) => set((s) => {
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
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          ),
        };
      }),
      upsertOkr: (o) => set({ okrs: replaceById(get().okrs, o) }),
      removeOkr: (id) => set((s) => {
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
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          ),
        };
      }),
      upsertDecision: (d) => set({ decisions: replaceById(get().decisions, d) }),
      removeDecision: (id) => set((s) => {
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
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          ),
        };
      }),
      upsertTechDebt: (t) => set({ techDebt: replaceById(get().techDebt, t) }),
      removeTechDebt: (id) => set((s) => {
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
              ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
              : o,
          ),
        };
      }),
      setMaturityLevel: (level) => set({ maturityLevel: level }),
      // Phase 19 — AI/LLM PM
      upsertLLMEval: (x) => set({ llmEvals: replaceById(get().llmEvals ?? [], x) }),
      removeLLMEval: (id) => set({ llmEvals: (get().llmEvals ?? []).filter((y) => y.id !== id) }),
      upsertPrompt: (x) => set({ prompts: replaceById(get().prompts ?? [], x) }),
      removePrompt: (id) => set({ prompts: (get().prompts ?? []).filter((y) => y.id !== id) }),
      upsertHallucination: (x) => set({ hallucinations: replaceById(get().hallucinations ?? [], x) }),
      removeHallucination: (id) => set({ hallucinations: (get().hallucinations ?? []).filter((y) => y.id !== id) }),
      upsertTokenSpend: (x) => set({ tokenSpend: replaceById(get().tokenSpend ?? [], x) }),
      // R5: extend the cascade pattern from removeTechDebt — canvas stickies
      // imported from this tool would otherwise dangle.
      removeTokenSpend: (id) => set((s) => {
        const isLink = (o: WhiteboardObject) =>
          o.sourceRef?.tool === "tokenSpend" && o.sourceRef.entityId === id;
        const affected = (s.whiteboardObjects ?? []).some(isLink);
        if (!affected) return { tokenSpend: (s.tokenSpend ?? []).filter((y) => y.id !== id) };
        const now = new Date().toISOString();
        return {
          tokenSpend: (s.tokenSpend ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
            isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o,
          ),
        };
      }),
      upsertModel: (x) => set({ models: replaceById(get().models ?? [], x) }),
      removeModel: (id) => set({ models: (get().models ?? []).filter((y) => y.id !== id) }),
      upsertRedTeamFinding: (x) => set({ redTeamFindings: replaceById(get().redTeamFindings ?? [], x) }),
      removeRedTeamFinding: (id) => set({ redTeamFindings: (get().redTeamFindings ?? []).filter((y) => y.id !== id) }),
      upsertAgentWorkflow: (x) => set({ agentWorkflows: replaceById(get().agentWorkflows ?? [], x) }),
      // R5: use functional updater so both reads share one snapshot.
      // The previous dual `get()` could tear under interleaved actions.
      removeAgentWorkflow: (id) => set((s) => ({
        agentWorkflows: (s.agentWorkflows ?? []).filter((y) => y.id !== id),
        agentNodes: (s.agentNodes ?? []).filter((n) => n.workflowId !== id),
      })),
      upsertAgentNode: (x) => set({ agentNodes: replaceById(get().agentNodes ?? [], x) }),
      // R5: also strip the deleted node from other nodes' `next: string[]`
      // arrays so the workflow graph doesn't keep dangling references.
      removeAgentNode: (id) => set((s) => ({
        agentNodes: (s.agentNodes ?? [])
          .filter((y) => y.id !== id)
          .map((n) => (n.next?.includes(id) ? { ...n, next: n.next.filter((x) => x !== id) } : n)),
      })),
      upsertHitlReview: (x) => set({ hitlReviews: replaceById(get().hitlReviews ?? [], x) }),
      removeHitlReview: (id) => set({ hitlReviews: (get().hitlReviews ?? []).filter((y) => y.id !== id) }),
      upsertRlhfPair: (x) => set({ rlhfPairs: replaceById(get().rlhfPairs ?? [], x) }),
      removeRlhfPair: (id) => set({ rlhfPairs: (get().rlhfPairs ?? []).filter((y) => y.id !== id) }),
      upsertVectorCollection: (x) => set({ vectorCollections: replaceById(get().vectorCollections ?? [], x) }),
      // R5: canvas sticky cascade.
      removeVectorCollection: (id) => set((s) => {
        const isLink = (o: WhiteboardObject) =>
          o.sourceRef?.tool === "vectorCollections" && o.sourceRef.entityId === id;
        const affected = (s.whiteboardObjects ?? []).some(isLink);
        if (!affected) return { vectorCollections: (s.vectorCollections ?? []).filter((y) => y.id !== id) };
        const now = new Date().toISOString();
        return {
          vectorCollections: (s.vectorCollections ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
            isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o,
          ),
        };
      }),
      upsertModelCard: (x) => set({ modelCards: replaceById(get().modelCards ?? [], x) }),
      removeModelCard: (id) => set({ modelCards: (get().modelCards ?? []).filter((y) => y.id !== id) }),
      // Phase 20 — Prioritization
      upsertPrioritization: (x) => set({ prioritizations: replaceById(get().prioritizations ?? [], x) }),
      // R5: canvas sticky cascade.
      removePrioritization: (id) => set((s) => {
        const isLink = (o: WhiteboardObject) =>
          o.sourceRef?.tool === "prioritizations" && o.sourceRef.entityId === id;
        const affected = (s.whiteboardObjects ?? []).some(isLink);
        if (!affected) return { prioritizations: (s.prioritizations ?? []).filter((y) => y.id !== id) };
        const now = new Date().toISOString();
        return {
          prioritizations: (s.prioritizations ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
            isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o,
          ),
        };
      }),
      // Phase 21 — Decision Frameworks
      upsertDACIDecision: (x) => set({ daciDecisions: replaceById(get().daciDecisions ?? [], x) }),
      removeDACIDecision: (id) => set({ daciDecisions: (get().daciDecisions ?? []).filter((y) => y.id !== id) }),
      upsertRAPIDDecision: (x) => set({ rapidDecisions: replaceById(get().rapidDecisions ?? [], x) }),
      removeRAPIDDecision: (id) => set({ rapidDecisions: (get().rapidDecisions ?? []).filter((y) => y.id !== id) }),
      upsertWeightedOption: (x) => set({ weightedOptions: replaceById(get().weightedOptions ?? [], x) }),
      removeWeightedOption: (id) => set({ weightedOptions: (get().weightedOptions ?? []).filter((y) => y.id !== id) }),
      upsertWeightedCriterion: (x) => set({ weightedCriteria: replaceById(get().weightedCriteria ?? [], x) }),
      // R5: also strip the stale criterion key from every WeightedOption's
      // `scores` map. Previously the option kept the score for a deleted
      // criterion, biasing future weightedScore re-computations.
      removeWeightedCriterion: (id) => set((s) => ({
        weightedCriteria: (s.weightedCriteria ?? []).filter((y) => y.id !== id),
        weightedOptions: (s.weightedOptions ?? []).map((o) => {
          if (!o.scores || !(id in o.scores)) return o;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _drop, ...rest } = o.scores;
          return { ...o, scores: rest };
        }),
      })),
      upsertSixHatsThought: (x) => set({ sixHatsThoughts: replaceById(get().sixHatsThoughts ?? [], x) }),
      removeSixHatsThought: (id) => set({ sixHatsThoughts: (get().sixHatsThoughts ?? []).filter((y) => y.id !== id) }),
      upsertOODACycle: (x) => set({ oodaCycles: replaceById(get().oodaCycles ?? [], x) }),
      removeOODACycle: (id) => set({ oodaCycles: (get().oodaCycles ?? []).filter((y) => y.id !== id) }),
      upsertCynefinItem: (x) => set({ cynefinItems: replaceById(get().cynefinItems ?? [], x) }),
      removeCynefinItem: (id) => set({ cynefinItems: (get().cynefinItems ?? []).filter((y) => y.id !== id) }),
      upsertStaceyItem: (x) => set({ staceyItems: replaceById(get().staceyItems ?? [], x) }),
      // R5: canvas sticky cascade.
      removeStaceyItem: (id) => set((s) => {
        const isLink = (o: WhiteboardObject) =>
          o.sourceRef?.tool === "staceyItems" && o.sourceRef.entityId === id;
        const affected = (s.whiteboardObjects ?? []).some(isLink);
        if (!affected) return { staceyItems: (s.staceyItems ?? []).filter((y) => y.id !== id) };
        const now = new Date().toISOString();
        return {
          staceyItems: (s.staceyItems ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
            isLink(o) ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: now } : o,
          ),
        };
      }),
      upsertPolarity: (x) => set({ polarities: replaceById(get().polarities ?? [], x) }),
      // R5: functional updater so the polarity + its poles share one snapshot.
      removePolarity: (id) => set((s) => ({
        polarities: (s.polarities ?? []).filter((y) => y.id !== id),
        polarityPoles: (s.polarityPoles ?? []).filter((p) => p.polarityId !== id),
      })),
      upsertPolarityPole: (x) => set({ polarityPoles: replaceById(get().polarityPoles ?? [], x) }),
      removePolarityPole: (id) => set({ polarityPoles: (get().polarityPoles ?? []).filter((y) => y.id !== id) }),
      // Phase 22 — Canvas. Deleting a board cascades to all its objects,
      // comments, and groups so we never leak orphan rows.
      upsertWhiteboard: (x) => set({ whiteboards: replaceById(get().whiteboards ?? [], x) }),
      // R5: functional updater so all four cascades share one snapshot —
      // the prior FOUR `get()` calls could race with concurrent activity.
      // ALSO cascade `whiteboardActivityLog` (previously leaked forever
      // after board delete — entries accumulated invisibly in storage).
      removeWhiteboard: (id) => set((s) => ({
        whiteboards: (s.whiteboards ?? []).filter((y) => y.id !== id),
        whiteboardObjects: (s.whiteboardObjects ?? []).filter((o) => o.boardId !== id),
        whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter((c) => c.boardId !== id),
        whiteboardGroups: (s.whiteboardGroups ?? []).filter((g) => g.boardId !== id),
        whiteboardActivityLog: (s.whiteboardActivityLog ?? []).filter((e) => e.boardId !== id),
      })),
      upsertWhiteboardObject: (x) => set({ whiteboardObjects: replaceById(get().whiteboardObjects ?? [], x) }),
      // Bulk upsert — used by templates, paste, cross-tool import, and the
      // diff-sync receiver. Single set() to avoid N re-renders for N objects.
      upsertWhiteboardObjects: (xs) => set((s) => {
        const list = s.whiteboardObjects ?? [];
        const map = new Map(list.map((o) => [o.id, o]));
        for (const x of xs) map.set(x.id, x);
        return { whiteboardObjects: Array.from(map.values()) };
      }),
      removeWhiteboardObject: (id) => set((s) => {
        // Cascade in one pass: drop the object AND any connector pinned to
        // it, AND clear `frameId` on any object that was contained in this
        // frame (so the contained objects don't keep a dangling reference
        // that would resurface if the id were ever reused).
        const objects = s.whiteboardObjects ?? [];
        const nextObjects: WhiteboardObject[] = [];
        for (const y of objects) {
          if (y.id === id) continue; // drop the target itself
          if (y.type === "connector" && (y.fromId === id || y.toId === id)) continue; // drop dangling connectors
          if (y.frameId === id) {
            nextObjects.push({ ...y, frameId: undefined });
            continue;
          }
          nextObjects.push(y);
        }
        return {
          whiteboardObjects: nextObjects,
          // Also drop comment threads pinned to the deleted object —
          // orphaned threads would otherwise pile up invisibly
          // (CommentPins filters by objectId so the UI doesn't render
          // them, but the store keeps growing indefinitely and they'd
          // resurface if the object id were ever reused).
          whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter(
            (t) => t.objectId !== id,
          ),
        };
      }),
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
              nextObjects.push({ ...y, frameId: undefined, version: y.version + 1, updatedAt: now });
              continue;
            }
            nextObjects.push(y);
          }
          return {
            whiteboardObjects: nextObjects,
            // Keep threads where (a) the thread isn't pinned to an object,
            // or (b) the pinned object is not being removed.
            whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter(
              (t) => !t.objectId || !removeSet.has(t.objectId),
            ),
          };
        });
      },
      upsertWhiteboardCommentThread: (x) => set({ whiteboardCommentThreads: replaceById(get().whiteboardCommentThreads ?? [], x) }),
      removeWhiteboardCommentThread: (id) => set({ whiteboardCommentThreads: (get().whiteboardCommentThreads ?? []).filter((y) => y.id !== id) }),
      upsertWhiteboardGroup: (x) => set({ whiteboardGroups: replaceById(get().whiteboardGroups ?? [], x) }),
      // R5: functional updater so both reads share one snapshot. Also bump
      // version+updatedAt on any object whose `groupId` we clear so a
      // stale peer broadcast doesn't revive the dead group reference.
      removeWhiteboardGroup: (id) => set((s) => {
        const now = new Date().toISOString();
        return {
          whiteboardGroups: (s.whiteboardGroups ?? []).filter((y) => y.id !== id),
          whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
            o.groupId === id
              ? { ...o, groupId: undefined, version: o.version + 1, updatedAt: now }
              : o,
          ),
        };
      }),
      upsertWhiteboardSavedTemplate: (x) => set({
        whiteboardSavedTemplates: replaceById(get().whiteboardSavedTemplates ?? [], x),
      }),
      removeWhiteboardSavedTemplate: (id) => set({
        whiteboardSavedTemplates: (get().whiteboardSavedTemplates ?? []).filter((y) => y.id !== id),
      }),
      appendWhiteboardActivity: (ev) => set((s) => {
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
      // Merge with emptyWorkspace first so "replace" truly replaces — unset
      // keys revert to their default rather than silently keeping prior state.
      replaceWorkspace: (w) => set({ ...emptyWorkspace, ...w }),
      resetWorkspace: () => set({ ...emptyWorkspace }),
      exportJSON: () => {
        const s = get();
        const data: Workspace = {
          teamMembers: s.teamMembers,
          sprints: s.sprints,
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
          // Phase 20
          prioritizations: s.prioritizations,
          // Phase 21
          daciDecisions: s.daciDecisions,
          rapidDecisions: s.rapidDecisions,
          weightedOptions: s.weightedOptions,
          weightedCriteria: s.weightedCriteria,
          sixHatsThoughts: s.sixHatsThoughts,
          oodaCycles: s.oodaCycles,
          cynefinItems: s.cynefinItems,
          staceyItems: s.staceyItems,
          polarities: s.polarities,
          polarityPoles: s.polarityPoles,
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
        };
        return JSON.stringify(data, null, 2);
      },
      importJSON: (json) => {
        // Validate shape before mutating state. Dropping unknown keys (and any
        // function-valued ones) prevents a malformed/stale export from
        // overwriting action methods or smuggling extra fields into the store.
        const parsed: unknown = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Import payload must be a JSON object");
        }
        const p = parsed as Record<string, unknown>;
        const arr = <K extends keyof Workspace>(k: K): Workspace[K] | undefined =>
          Array.isArray(p[k]) ? (p[k] as Workspace[K]) : undefined;
        const sanitized: Partial<Workspace> = {
          teamMembers: arr("teamMembers"),
          sprints: arr("sprints"),
          stories: arr("stories"),
          impediments: arr("impediments"),
          risks: arr("risks"),
          okrs: arr("okrs"),
          decisions: arr("decisions"),
          techDebt: arr("techDebt"),
          maturityLevel:
            typeof p.maturityLevel === "number" && p.maturityLevel >= 1 && p.maturityLevel <= 5
              ? (p.maturityLevel as Workspace["maturityLevel"])
              : undefined,
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
          // Phase 20
          prioritizations: arr("prioritizations"),
          // Phase 21
          daciDecisions: arr("daciDecisions"),
          rapidDecisions: arr("rapidDecisions"),
          weightedOptions: arr("weightedOptions"),
          weightedCriteria: arr("weightedCriteria"),
          sixHatsThoughts: arr("sixHatsThoughts"),
          oodaCycles: arr("oodaCycles"),
          cynefinItems: arr("cynefinItems"),
          staceyItems: arr("staceyItems"),
          polarities: arr("polarities"),
          polarityPoles: arr("polarityPoles"),
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
        // v0 → v1: ensure the new array slices exist. Default merge
        // already handles this via initial state, but pre-loading the
        // defaults defensively avoids a transient render with the
        // arrays as `undefined` if a consumer reads them before the
        // store fully resolves.
        if (fromVersion < 1 && persistedState && typeof persistedState === "object") {
          const p = persistedState as Record<string, unknown>;
          if (!Array.isArray(p.whiteboardSavedTemplates)) p.whiteboardSavedTemplates = [];
          if (!Array.isArray(p.whiteboardActivityLog)) p.whiteboardActivityLog = [];
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
                err,
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
                err,
              );
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
if (typeof window !== "undefined") {
  void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch(() => {
    /* corrupt persisted state — keep emptyWorkspace defaults */
  });
}

export function getWorkspaceSnapshot(): Workspace {
  const state = useWorkspaceStore.getState();
  return {
    teamMembers: state.teamMembers,
    sprints: state.sprints,
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
    prioritizations: state.prioritizations,
    daciDecisions: state.daciDecisions,
    rapidDecisions: state.rapidDecisions,
    weightedOptions: state.weightedOptions,
    weightedCriteria: state.weightedCriteria,
    sixHatsThoughts: state.sixHatsThoughts,
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
  };
}

export function selectActiveSprint(w: Workspace): Sprint | undefined {
  return w.sprints.find((s) => s.status === "active");
}

export function selectCompletedSprints(w: Workspace): Sprint[] {
  return w.sprints
    .filter((s) => s.status === "completed" && typeof s.pointsCompleted === "number")
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
}

export function selectActiveImpediments(w: Workspace): Impediment[] {
  return w.impediments.filter((i) => !i.resolvedAt);
}

export function selectOpenRisks(w: Workspace): Risk[] {
  return w.risks.filter((r) => r.status === "open" || r.status === "mitigating");
}
