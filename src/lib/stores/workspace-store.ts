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
      removeTeamMember: (id) => set({ teamMembers: get().teamMembers.filter((x) => x.id !== id) }),
      upsertSprint: (s) => set({ sprints: replaceById(get().sprints, s) }),
      removeSprint: (id) => set({ sprints: get().sprints.filter((x) => x.id !== id) }),
      upsertStory: (s) => set({ stories: replaceById(get().stories, s) }),
      removeStory: (id) => set((s) => ({
        stories: s.stories.filter((x) => x.id !== id),
        // Phase 26 cascade: any canvas Card pinned to this Story via
        // sourceRef now points at nothing. Strip the sourceRef so the
        // card becomes a standalone snapshot; without this, future
        // sync attempts against the dead id would silently fail and
        // the link badge ("↳ backlog") would be misleading.
        whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
          o.type === "card" && o.sourceRef?.tool === "backlog" && o.sourceRef.entityId === id
            ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
            : o,
        ),
      })),
      upsertImpediment: (i) => set({ impediments: replaceById(get().impediments, i) }),
      removeImpediment: (id) => set({ impediments: get().impediments.filter((x) => x.id !== id) }),
      upsertRisk: (r) => set({ risks: replaceById(get().risks, r) }),
      removeRisk: (id) => set((s) => ({
        risks: s.risks.filter((x) => x.id !== id),
        // Same Phase 26 cascade for risks imported as cards.
        whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
          o.type === "card" && o.sourceRef?.tool === "risk" && o.sourceRef.entityId === id
            ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
            : o,
        ),
      })),
      upsertOkr: (o) => set({ okrs: replaceById(get().okrs, o) }),
      removeOkr: (id) => set((s) => ({
        okrs: s.okrs.filter((x) => x.id !== id),
        whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
          o.type === "card" && o.sourceRef?.tool === "okr" && o.sourceRef.entityId === id
            ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
            : o,
        ),
      })),
      upsertDecision: (d) => set({ decisions: replaceById(get().decisions, d) }),
      removeDecision: (id) => set((s) => ({
        decisions: s.decisions.filter((x) => x.id !== id),
        whiteboardObjects: (s.whiteboardObjects ?? []).map((o) =>
          o.type === "card" && o.sourceRef?.tool === "decision" && o.sourceRef.entityId === id
            ? { ...o, sourceRef: undefined, version: o.version + 1, updatedAt: new Date().toISOString() }
            : o,
        ),
      })),
      upsertTechDebt: (t) => set({ techDebt: replaceById(get().techDebt, t) }),
      removeTechDebt: (id) => set({ techDebt: get().techDebt.filter((x) => x.id !== id) }),
      setMaturityLevel: (level) => set({ maturityLevel: level }),
      // Phase 19 — AI/LLM PM
      upsertLLMEval: (x) => set({ llmEvals: replaceById(get().llmEvals ?? [], x) }),
      removeLLMEval: (id) => set({ llmEvals: (get().llmEvals ?? []).filter((y) => y.id !== id) }),
      upsertPrompt: (x) => set({ prompts: replaceById(get().prompts ?? [], x) }),
      removePrompt: (id) => set({ prompts: (get().prompts ?? []).filter((y) => y.id !== id) }),
      upsertHallucination: (x) => set({ hallucinations: replaceById(get().hallucinations ?? [], x) }),
      removeHallucination: (id) => set({ hallucinations: (get().hallucinations ?? []).filter((y) => y.id !== id) }),
      upsertTokenSpend: (x) => set({ tokenSpend: replaceById(get().tokenSpend ?? [], x) }),
      removeTokenSpend: (id) => set({ tokenSpend: (get().tokenSpend ?? []).filter((y) => y.id !== id) }),
      upsertModel: (x) => set({ models: replaceById(get().models ?? [], x) }),
      removeModel: (id) => set({ models: (get().models ?? []).filter((y) => y.id !== id) }),
      upsertRedTeamFinding: (x) => set({ redTeamFindings: replaceById(get().redTeamFindings ?? [], x) }),
      removeRedTeamFinding: (id) => set({ redTeamFindings: (get().redTeamFindings ?? []).filter((y) => y.id !== id) }),
      upsertAgentWorkflow: (x) => set({ agentWorkflows: replaceById(get().agentWorkflows ?? [], x) }),
      removeAgentWorkflow: (id) => set({
        agentWorkflows: (get().agentWorkflows ?? []).filter((y) => y.id !== id),
        agentNodes: (get().agentNodes ?? []).filter((n) => n.workflowId !== id),
      }),
      upsertAgentNode: (x) => set({ agentNodes: replaceById(get().agentNodes ?? [], x) }),
      removeAgentNode: (id) => set({ agentNodes: (get().agentNodes ?? []).filter((y) => y.id !== id) }),
      upsertHitlReview: (x) => set({ hitlReviews: replaceById(get().hitlReviews ?? [], x) }),
      removeHitlReview: (id) => set({ hitlReviews: (get().hitlReviews ?? []).filter((y) => y.id !== id) }),
      upsertRlhfPair: (x) => set({ rlhfPairs: replaceById(get().rlhfPairs ?? [], x) }),
      removeRlhfPair: (id) => set({ rlhfPairs: (get().rlhfPairs ?? []).filter((y) => y.id !== id) }),
      upsertVectorCollection: (x) => set({ vectorCollections: replaceById(get().vectorCollections ?? [], x) }),
      removeVectorCollection: (id) => set({ vectorCollections: (get().vectorCollections ?? []).filter((y) => y.id !== id) }),
      upsertModelCard: (x) => set({ modelCards: replaceById(get().modelCards ?? [], x) }),
      removeModelCard: (id) => set({ modelCards: (get().modelCards ?? []).filter((y) => y.id !== id) }),
      // Phase 20 — Prioritization
      upsertPrioritization: (x) => set({ prioritizations: replaceById(get().prioritizations ?? [], x) }),
      removePrioritization: (id) => set({ prioritizations: (get().prioritizations ?? []).filter((y) => y.id !== id) }),
      // Phase 21 — Decision Frameworks
      upsertDACIDecision: (x) => set({ daciDecisions: replaceById(get().daciDecisions ?? [], x) }),
      removeDACIDecision: (id) => set({ daciDecisions: (get().daciDecisions ?? []).filter((y) => y.id !== id) }),
      upsertRAPIDDecision: (x) => set({ rapidDecisions: replaceById(get().rapidDecisions ?? [], x) }),
      removeRAPIDDecision: (id) => set({ rapidDecisions: (get().rapidDecisions ?? []).filter((y) => y.id !== id) }),
      upsertWeightedOption: (x) => set({ weightedOptions: replaceById(get().weightedOptions ?? [], x) }),
      removeWeightedOption: (id) => set({ weightedOptions: (get().weightedOptions ?? []).filter((y) => y.id !== id) }),
      upsertWeightedCriterion: (x) => set({ weightedCriteria: replaceById(get().weightedCriteria ?? [], x) }),
      removeWeightedCriterion: (id) => set({ weightedCriteria: (get().weightedCriteria ?? []).filter((y) => y.id !== id) }),
      upsertSixHatsThought: (x) => set({ sixHatsThoughts: replaceById(get().sixHatsThoughts ?? [], x) }),
      removeSixHatsThought: (id) => set({ sixHatsThoughts: (get().sixHatsThoughts ?? []).filter((y) => y.id !== id) }),
      upsertOODACycle: (x) => set({ oodaCycles: replaceById(get().oodaCycles ?? [], x) }),
      removeOODACycle: (id) => set({ oodaCycles: (get().oodaCycles ?? []).filter((y) => y.id !== id) }),
      upsertCynefinItem: (x) => set({ cynefinItems: replaceById(get().cynefinItems ?? [], x) }),
      removeCynefinItem: (id) => set({ cynefinItems: (get().cynefinItems ?? []).filter((y) => y.id !== id) }),
      upsertStaceyItem: (x) => set({ staceyItems: replaceById(get().staceyItems ?? [], x) }),
      removeStaceyItem: (id) => set({ staceyItems: (get().staceyItems ?? []).filter((y) => y.id !== id) }),
      upsertPolarity: (x) => set({ polarities: replaceById(get().polarities ?? [], x) }),
      removePolarity: (id) => set({
        polarities: (get().polarities ?? []).filter((y) => y.id !== id),
        polarityPoles: (get().polarityPoles ?? []).filter((p) => p.polarityId !== id),
      }),
      upsertPolarityPole: (x) => set({ polarityPoles: replaceById(get().polarityPoles ?? [], x) }),
      removePolarityPole: (id) => set({ polarityPoles: (get().polarityPoles ?? []).filter((y) => y.id !== id) }),
      // Phase 22 — Canvas. Deleting a board cascades to all its objects,
      // comments, and groups so we never leak orphan rows.
      upsertWhiteboard: (x) => set({ whiteboards: replaceById(get().whiteboards ?? [], x) }),
      removeWhiteboard: (id) => set({
        whiteboards: (get().whiteboards ?? []).filter((y) => y.id !== id),
        whiteboardObjects: (get().whiteboardObjects ?? []).filter((o) => o.boardId !== id),
        whiteboardCommentThreads: (get().whiteboardCommentThreads ?? []).filter((c) => c.boardId !== id),
        whiteboardGroups: (get().whiteboardGroups ?? []).filter((g) => g.boardId !== id),
      }),
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
          const nextObjects: WhiteboardObject[] = [];
          for (const y of objects) {
            if (removeSet.has(y.id)) continue;
            if (y.type === "connector" && (removeSet.has(y.fromId) || removeSet.has(y.toId))) continue;
            // Clear frameId if its frame is being deleted in this batch.
            if (y.frameId && removeSet.has(y.frameId)) {
              nextObjects.push({ ...y, frameId: undefined });
              continue;
            }
            nextObjects.push(y);
          }
          return {
            whiteboardObjects: nextObjects,
            // Keep threads where (a) the thread isn't pinned to an object,
            // or (b) the pinned object is not being removed. The previous
            // implementation looked OK at a glance but used OR over the
            // boolean negations; rewrote as an explicit predicate for
            // clarity.
            whiteboardCommentThreads: (s.whiteboardCommentThreads ?? []).filter(
              (t) => !t.objectId || !removeSet.has(t.objectId),
            ),
          };
        });
      },
      upsertWhiteboardCommentThread: (x) => set({ whiteboardCommentThreads: replaceById(get().whiteboardCommentThreads ?? [], x) }),
      removeWhiteboardCommentThread: (id) => set({ whiteboardCommentThreads: (get().whiteboardCommentThreads ?? []).filter((y) => y.id !== id) }),
      upsertWhiteboardGroup: (x) => set({ whiteboardGroups: replaceById(get().whiteboardGroups ?? [], x) }),
      removeWhiteboardGroup: (id) => set({
        whiteboardGroups: (get().whiteboardGroups ?? []).filter((y) => y.id !== id),
        // Disassociate any objects that were in this group.
        whiteboardObjects: (get().whiteboardObjects ?? []).map((o) => o.groupId === id ? { ...o, groupId: undefined } : o),
      }),
      upsertWhiteboardSavedTemplate: (x) => set({
        whiteboardSavedTemplates: replaceById(get().whiteboardSavedTemplates ?? [], x),
      }),
      removeWhiteboardSavedTemplate: (id) => set({
        whiteboardSavedTemplates: (get().whiteboardSavedTemplates ?? []).filter((y) => y.id !== id),
      }),
      appendWhiteboardActivity: (ev) => set((s) => {
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
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        // Wrap localStorage so a QuotaExceededError doesn't crash the
        // app. Image-heavy boards (Phase 25) can exceed the 5 MB
        // origin cap; on quota error we warn but keep the in-memory
        // state alive — the user can still export to JSON.
        return {
          getItem: (k: string) => localStorage.getItem(k),
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
          removeItem: (k: string) => localStorage.removeItem(k),
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
