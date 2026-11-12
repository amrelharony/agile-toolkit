"use client";

/**
 * The "Surprise me" plan a retro was started with: its opening and closing
 * activities (and Amr's reason, when he gave one), kept in this browser
 * (`agile-toolkit:retro-plan`) so the board can show them while it runs.
 * Shown only on a board in the plan's format, for a day after the plan was
 * picked; New Retro clears it. The board itself holds no plan: it's the
 * same RetroBoard the room and the agent read.
 */

import { useEffect, useMemo } from "react";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { retroActivity, type RetroActivity } from "@/lib/retro/surprise";

export interface SavedRetroPlan {
  formatId: string;
  openingId: string;
  closingId: string;
  /** Why the format fits the sprint (Amr's, or the fallback's). */
  why?: string;
  /** When it was picked (ISO). */
  at: string;
}

export interface RetroPlanSettings {
  plan: SavedRetroPlan | null;
}

/** A plan shows for this long after it was picked. */
export const PLAN_SHOWN_MS = 24 * 60 * 60 * 1000;

export const useRetroPlanStore = createPersistedStore<RetroPlanSettings>("retro-plan", {
  plan: null,
});

/** A stored plan that is a plan, or null. */
export function readPlan(raw: unknown): SavedRetroPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  const formatId = str(r.formatId, 64);
  const openingId = str(r.openingId, 16);
  const closingId = str(r.closingId, 16);
  const at = str(r.at, 40);
  if (!formatId || !openingId || !closingId || !at) return null;
  const why = str(r.why, 600);
  return { formatId, openingId, closingId, at, ...(why ? { why } : {}) };
}

export function savePlan(plan: SavedRetroPlan): void {
  useRetroPlanStore.setState({ plan });
}

export function clearPlan(): void {
  useRetroPlanStore.setState({ plan: null });
}

export interface ShownPlan {
  opening: RetroActivity;
  closing: RetroActivity;
  why?: string;
}

/** The plan for a board in `formatId`, picked within the last day; else null. */
export function planFor(
  raw: unknown,
  formatId: string,
  now: number = Date.now()
): ShownPlan | null {
  const plan = readPlan(raw);
  if (!plan || plan.formatId !== formatId) return null;
  const at = Date.parse(plan.at);
  if (!Number.isFinite(at) || now - at > PLAN_SHOWN_MS || at - now > PLAN_SHOWN_MS) return null;
  const opening = retroActivity(plan.openingId, "opening");
  const closing = retroActivity(plan.closingId, "closing");
  if (!opening || !closing) return null;
  return { opening, closing, ...(plan.why ? { why: plan.why } : {}) };
}

/** The plan the board in `formatId` was started with, if it's still today's. */
export function useShownPlan(formatId: string): ShownPlan | null {
  useEffect(() => {
    const { persist } = useRetroPlanStore;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: no plan shows */
    });
  }, []);
  const raw = useRetroPlanStore((s) => s.plan);
  return useMemo(() => planFor(raw, formatId), [raw, formatId]);
}
