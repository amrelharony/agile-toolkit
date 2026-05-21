"use client";

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
  /** Batch upsert. Use this for bulk imports — single-item upserts are O(n)
   *  each (find + copy), so calling N times is O(n²). */
  bulkUpsertStories: (items: Story[]) => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
}

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const replaceById = <T extends { id: string }>(arr: T[], item: T): T[] => {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...arr, item];
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
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    typeof (v as { id?: unknown }).id === "string";
}

function sanitizeArray<T extends { id: string }>(raw: unknown): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRecordWithId) as T[];
}

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
      bulkUpsertStories: (items) =>
        set({ stories: batchUpsertById(get().stories, items) }),
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
        const sanitized: Partial<Workspace> = {
          teamMembers: sanitizeArray<TeamMember>(p.teamMembers),
          sprints: sanitizeArray<Sprint>(p.sprints),
          stories: sanitizeArray<Story>(p.stories),
          impediments: sanitizeArray<Impediment>(p.impediments),
          risks: sanitizeArray<Risk>(p.risks),
          okrs: sanitizeArray<Okr>(p.okrs),
          decisions: sanitizeArray<Decision>(p.decisions),
          techDebt: sanitizeArray<TechDebtItem>(p.techDebt),
          // Require integer in [1,5]; `typeof x === "number"` lets through
          // floats and NaN, so check both. `Number.isInteger(NaN)` is false.
          maturityLevel:
            Number.isInteger(p.maturityLevel) &&
            (p.maturityLevel as number) >= 1 &&
            (p.maturityLevel as number) <= 5
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
//
// Consumers that need to render against the hydrated state on first paint
// should gate on `useWorkspaceStore.persist.hasHydrated()` to avoid a
// one-frame flash of empty defaults — see InsightsEngine for the pattern.
if (typeof window !== "undefined") {
  void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch(() => {
    /* corrupt persisted state — keep emptyWorkspace defaults */
  });
}

export function getWorkspaceSnapshot(): Workspace {
  const state = useWorkspaceStore.getState();
  // Consumers should treat the returned object as immutable — mutating the
  // arrays in-place bypasses Zustand and any time-travel snapshot.
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
  // If multiple sprints are marked active (invariant violation), prefer the
  // one with the most recent start date so the UI surfaces the most
  // contextually-relevant sprint rather than the first by array order.
  const active = w.sprints.filter((s) => s.status === "active");
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return active.slice().sort(
    (a, b) => parseDateSafe(b.startDate) - parseDateSafe(a.startDate)
  )[0];
}

function parseDateSafe(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function selectCompletedSprints(w: Workspace): Sprint[] {
  // Cache the parsed timestamp once per sprint so the sort comparator runs
  // O(n log n) Date constructions instead of O(n log n × 2). Invalid dates
  // sort to the front (timestamp 0) so they're visible to the user rather
  // than silently dropping into an unstable middle.
  return w.sprints
    .filter((s) => s.status === "completed" && typeof s.pointsCompleted === "number")
    .map((s) => [s, parseDateSafe(s.startDate)] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}

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
