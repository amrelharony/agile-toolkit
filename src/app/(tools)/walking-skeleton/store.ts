"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import type { HandoffLink } from "@/lib/stores/workspace-types";

/** The architecture layers a walking skeleton should pass through. */
export type Layer = "ui" | "api" | "data" | "infra";

export interface SkeletonStep {
  id: string;
  /** One of `Layer`; an older or hand-edited store may hold anything, kept as is. */
  layer: Layer;
  text: string;
  done: boolean;
  /** Where the step was sent (the backlog). Additive: older steps have none. */
  sentTo?: HandoffLink[];
}

export interface SkeletonData {
  goal: string;
  steps: SkeletonStep[];
}

interface SkeletonState extends SkeletonData {
  setGoal: (v: string) => void;
  /** Append a step; returns its id. */
  add: (text: string, layer: Layer) => string;
  update: (id: string, patch: Partial<Omit<SkeletonStep, "id">>) => void;
  toggle: (id: string) => void;
  /** Replace the step list (moves, Undo of a delete). */
  setSteps: (fn: (steps: readonly SkeletonStep[]) => SkeletonStep[]) => void;
  /** Replace everything (load or clear the example, reset and its Undo). */
  replace: (data: SkeletonData) => void;
}

/**
 * Steps as stored, made safe to render: a step missing its text or done
 * flag (hand-edited storage) gets an empty text and "not done" instead of
 * crashing the list. Ids, order and unknown layers are kept.
 */
export function normalizeSkeleton(raw: unknown): SkeletonData {
  const r = (raw ?? {}) as Partial<Record<keyof SkeletonData, unknown>>;
  const steps = Array.isArray(r.steps) ? r.steps : [];
  return {
    goal: typeof r.goal === "string" ? r.goal : "",
    steps: steps
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
      .map((s, i) => ({
        ...(s as unknown as SkeletonStep),
        id: typeof s.id === "string" && s.id ? s.id : `step-${i + 1}`,
        text: typeof s.text === "string" ? s.text : "",
        done: s.done === true,
      })),
  };
}

/**
 * The walking skeleton's own persisted store (it stays tool-local: no other
 * tool or agent reads it). Same key and shape as before; `sentTo` is new
 * and optional, so earlier saves load unchanged.
 */
export const useWalkingSkeletonStore = create<SkeletonState>()(
  persist(
    (set) => ({
      goal: "",
      steps: [],
      setGoal: (v) => set({ goal: v }),
      add: (text, layer) => {
        const id = crypto.randomUUID();
        set((s) => ({ steps: [...s.steps, { id, text, layer, done: false }] }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({ steps: s.steps.map((st) => (st.id === id ? { ...st, ...patch } : st)) })),
      toggle: (id) =>
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, done: !st.done } : st)),
        })),
      setSteps: (fn) => set((s) => ({ steps: fn(s.steps) })),
      replace: (data) => set({ goal: data.goal, steps: data.steps }),
    }),
    {
      name: "agile-toolkit:walking-skeleton",
      storage: safeJSONStorage("walking-skeleton"),
      merge: (persisted, current) => ({ ...current, ...normalizeSkeleton(persisted) }),
    }
  )
);
