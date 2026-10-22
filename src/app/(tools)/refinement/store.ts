/**
 * The Definition of Ready checklist's store: the criteria, the story being
 * checked and the saved checks. Kept out of the page so the Team charter can
 * read it without the page's components.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
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

export interface StorySave {
  id: string;
  storyName: string;
  description?: string;
  date: string; // ISO date string
  checks: StoryCheck[];
  totalCriteria: number;
  metCount: number;
  passRate: number; // 0-100
}

export interface RefinementStore {
  criteria: Criterion[];
  storyName: string;
  storyDescription: string;
  currentChecks: Record<string, boolean>;
  history: StorySave[];

  setCriterion: (id: string, label: string) => void;
  setCriterionDescription: (id: string, description: string) => void;
  addCriterion: () => void;
  removeCriterion: (id: string) => void;

  setStoryName: (v: string) => void;
  setStoryDescription: (v: string) => void;
  toggleCheck: (criterionId: string) => void;
  saveStory: () => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  resetCurrent: () => void;
  reset: () => void;
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

      addCriterion: () =>
        set((s) => ({
          criteria: [...s.criteria, { id: crypto.randomUUID(), label: "New criterion" }],
        })),

      removeCriterion: (id) =>
        set((s) => ({
          criteria: s.criteria.filter((c) => c.id !== id),
          currentChecks: Object.fromEntries(
            Object.entries(s.currentChecks).filter(([k]) => k !== id)
          ),
        })),

      setStoryName: (v) => set({ storyName: v }),
      setStoryDescription: (v) => set({ storyDescription: v }),

      toggleCheck: (criterionId) =>
        set((s) => ({
          currentChecks: {
            ...s.currentChecks,
            [criterionId]: !s.currentChecks[criterionId],
          },
        })),

      saveStory: () => {
        const { criteria, storyName, storyDescription, currentChecks } = get();
        if (!storyName.trim()) return;
        const metCount = criteria.filter((c) => currentChecks[c.id]).length;
        const passRate = criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 0;

        const save: StorySave = {
          id: crypto.randomUUID(),
          storyName: storyName.trim(),
          description: storyDescription.trim() || undefined,
          date: todayLocalISO(),
          checks: criteria.map((c) => ({
            criterionId: c.id,
            checked: !!currentChecks[c.id],
          })),
          totalCriteria: criteria.length,
          metCount,
          passRate,
        };

        set((s) => ({
          history: [save, ...s.history],
          storyName: "",
          storyDescription: "",
          currentChecks: {},
        }));
      },

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
    }),
    { name: "agile-toolkit:refinement", storage: safeJSONStorage("refinement") }
  )
);
