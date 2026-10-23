/**
 * The Definition of Ready checklist's store: the criteria, the earlier
 * checks saved by name, the draft of the next one, and the example session.
 * Kept out of the page so the Team charter can read it without the page's
 * components.
 *
 * Readiness of the workspace's own stories lives on the stories
 * (`Story.readiness`), not here: Sprint Planning, the cockpit and agents
 * read it there. This store keeps what only this page needs. Every field
 * added since the first version is optional or defaults on load, so a
 * browser's older saved state still opens.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import type { HandoffLink, Story } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface Criterion {
  id: string;
  label: string;
  description?: string;
}

export interface StoryCheck {
  criterionId: string;
  checked: boolean;
}

/**
 * A check saved by name: how stories were checked before the session read
 * the backlog, and still the way to check a story that isn't in it.
 */
export interface StorySave {
  id: string;
  storyName: string;
  description?: string;
  date: string; // "YYYY-MM-DD", local
  checks: StoryCheck[];
  totalCriteria: number;
  metCount: number;
  passRate: number; // 0-100
  /** Where this check was sent ("Add to backlog" makes a backlog story). */
  sentTo?: HandoffLink[];
}

/** A check by name, as the form hands it over. */
export interface CheckValues {
  storyName: string;
  description?: string;
  date: string;
  /** Ids of the criteria the story meets. */
  checked: string[];
}

type List<T> = (list: readonly T[]) => T[];

export interface RefinementStore {
  criteria: Criterion[];
  /** The next check-by-name, kept across reloads so a half-typed one isn't lost. */
  storyName: string;
  storyDescription: string;
  currentChecks: Record<string, boolean>;
  history: StorySave[];
  /**
   * The example session's stories ("example-" ids). They stay in this store
   * and never reach the workspace, so the user's backlog, Sprint Planning
   * and agents never see them.
   */
  exampleStories: Story[];

  setCriterion: (id: string, label: string) => void;
  setCriterionDescription: (id: string, description: string) => void;
  /** Adds a criterion and returns it. The label must already be checked. */
  addCriterion: (label: string, description?: string) => Criterion;
  removeCriterion: (id: string) => void;
  /** Functional update of the list (deletes with Undo restore positions). */
  updateCriteria: (update: List<Criterion>) => void;

  setDraft: (draft: {
    storyName: string;
    storyDescription: string;
    currentChecks: Record<string, boolean>;
  }) => void;
  /** Save a check by name against the current criteria; returns the saved row. */
  addCheck: (values: CheckValues) => StorySave;
  /** Rename, re-describe or re-date a saved check (its ticks stay as checked). */
  editCheck: (id: string, patch: Pick<StorySave, "storyName" | "description" | "date">) => void;
  setCheckLinks: (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  updateHistory: (update: List<StorySave>) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  resetCurrent: () => void;
  /** Criteria back to the defaults, earlier checks and the draft cleared. */
  reset: () => void;

  setExampleStories: (stories: Story[]) => void;
  /** Replace one example story (a check or "Mark ready" on the example). */
  putExampleStory: (story: Story) => void;
}

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                  */
/* -------------------------------------------------------------------------- */

export const DEFAULT_CRITERIA: Criterion[] = [
  { id: "d1", label: "User story written in correct format (As a / I want / So that)" },
  { id: "d2", label: "Acceptance criteria defined" },
  { id: "d3", label: "Estimated by team" },
  { id: "d4", label: "Dependencies identified" },
  { id: "d5", label: "No unresolved blockers" },
  { id: "d6", label: "UI/UX mockups attached (if applicable)" },
  { id: "d7", label: "Technical approach discussed" },
  { id: "d8", label: "Story fits within one sprint" },
];

/** Met, total and pass rate of `checked` against `criteria`. */
export function checkCounts(
  checked: readonly string[],
  criteria: readonly Criterion[]
): { metCount: number; totalCriteria: number; passRate: number } {
  const ticked = new Set(checked);
  const metCount = criteria.filter((c) => ticked.has(c.id)).length;
  const totalCriteria = criteria.length;
  const passRate = totalCriteria > 0 ? Math.round((metCount / totalCriteria) * 100) : 0;
  return { metCount, totalCriteria, passRate };
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

export const useRefinementStore = create<RefinementStore>()(
  persist(
    (set, get) => ({
      criteria: DEFAULT_CRITERIA,
      storyName: "",
      storyDescription: "",
      currentChecks: {},
      history: [],
      exampleStories: [],

      setCriterion: (id, label) =>
        set((s) => ({
          criteria: s.criteria.map((c) => (c.id === id ? { ...c, label } : c)),
        })),

      setCriterionDescription: (id, description) =>
        set((s) => ({
          criteria: s.criteria.map((c) =>
            c.id === id ? { ...c, description: description.trim() || undefined } : c
          ),
        })),

      addCriterion: (label, description) => {
        const criterion: Criterion = {
          id: crypto.randomUUID(),
          label: label.trim(),
          ...(description?.trim() ? { description: description.trim() } : {}),
        };
        set((s) => ({ criteria: [...s.criteria, criterion] }));
        return criterion;
      },

      removeCriterion: (id) =>
        set((s) => ({
          criteria: s.criteria.filter((c) => c.id !== id),
          currentChecks: Object.fromEntries(
            Object.entries(s.currentChecks).filter(([k]) => k !== id)
          ),
        })),

      updateCriteria: (update) => set((s) => ({ criteria: update(s.criteria) })),

      setDraft: ({ storyName, storyDescription, currentChecks }) =>
        set({ storyName, storyDescription, currentChecks }),

      addCheck: ({ storyName, description, date, checked }) => {
        const { criteria } = get();
        const ticked = new Set(checked);
        const save: StorySave = {
          id: crypto.randomUUID(),
          storyName: storyName.trim(),
          ...(description?.trim() ? { description: description.trim() } : {}),
          date: date || todayLocalISO(),
          checks: criteria.map((c) => ({ criterionId: c.id, checked: ticked.has(c.id) })),
          ...checkCounts(checked, criteria),
        };
        set((s) => ({ history: [save, ...s.history] }));
        return save;
      },

      editCheck: (id, patch) =>
        set((s) => ({
          history: s.history.map((h) => {
            if (h.id !== id) return h;
            const description = patch.description?.trim();
            const next: StorySave = { ...h, storyName: patch.storyName.trim(), date: patch.date };
            if (description) next.description = description;
            else delete next.description;
            return next;
          }),
        })),

      setCheckLinks: (id, update) =>
        set((s) => ({
          history: s.history.map((h) => (h.id === id ? { ...h, sentTo: update(h.sentTo) } : h)),
        })),

      updateHistory: (update) => set((s) => ({ history: update(s.history) })),

      removeHistory: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      clearHistory: () => set({ history: [] }),

      resetCurrent: () => set({ storyName: "", storyDescription: "", currentChecks: {} }),

      reset: () =>
        set({
          criteria: DEFAULT_CRITERIA,
          storyName: "",
          storyDescription: "",
          currentChecks: {},
          history: [],
        }),

      setExampleStories: (stories) => set({ exampleStories: stories }),

      putExampleStory: (story) =>
        set((s) => ({
          exampleStories: s.exampleStories.map((x) => (x.id === story.id ? story : x)),
        })),
    }),
    {
      name: "agile-toolkit:refinement",
      storage: safeJSONStorage("refinement"),
      // Saved state from older versions, or edited by hand, may miss fields
      // or carry the wrong types; load what's usable and default the rest.
      merge: (persisted, current) => {
        const p = (persisted && typeof persisted === "object" ? persisted : {}) as Partial<
          Record<keyof RefinementStore, unknown>
        >;
        return {
          ...current,
          ...(Array.isArray(p.criteria) ? { criteria: p.criteria as Criterion[] } : {}),
          ...(typeof p.storyName === "string" ? { storyName: p.storyName } : {}),
          ...(typeof p.storyDescription === "string"
            ? { storyDescription: p.storyDescription }
            : {}),
          ...(p.currentChecks && typeof p.currentChecks === "object"
            ? { currentChecks: p.currentChecks as Record<string, boolean> }
            : {}),
          ...(Array.isArray(p.history)
            ? {
                history: (p.history as StorySave[])
                  .filter((h) => h && typeof h === "object" && typeof h.id === "string")
                  .map((h) => ({ ...h, checks: Array.isArray(h.checks) ? h.checks : [] })),
              }
            : {}),
          ...(Array.isArray(p.exampleStories)
            ? { exampleStories: p.exampleStories as Story[] }
            : {}),
        };
      },
    }
  )
);
