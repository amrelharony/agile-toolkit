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
      removeStory: (id) => set({ stories: get().stories.filter((x) => x.id !== id) }),
      upsertImpediment: (i) => set({ impediments: replaceById(get().impediments, i) }),
      removeImpediment: (id) => set({ impediments: get().impediments.filter((x) => x.id !== id) }),
      upsertRisk: (r) => set({ risks: replaceById(get().risks, r) }),
      removeRisk: (id) => set({ risks: get().risks.filter((x) => x.id !== id) }),
      upsertOkr: (o) => set({ okrs: replaceById(get().okrs, o) }),
      removeOkr: (id) => set({ okrs: get().okrs.filter((x) => x.id !== id) }),
      upsertDecision: (d) => set({ decisions: replaceById(get().decisions, d) }),
      removeDecision: (id) => set({ decisions: get().decisions.filter((x) => x.id !== id) }),
      upsertTechDebt: (t) => set({ techDebt: replaceById(get().techDebt, t) }),
      removeTechDebt: (id) => set({ techDebt: get().techDebt.filter((x) => x.id !== id) }),
      setMaturityLevel: (level) => set({ maturityLevel: level }),
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
        if (typeof window !== "undefined") return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
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
