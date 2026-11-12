"use client";

/**
 * "Is this really why?": the team's answer for each why after the first
 * (would fixing this one stop the one above it?), kept in this browser
 * (`agile-toolkit:root-cause-checks`, synced like other tool stores for the
 * signed-in owner). The analysis itself holds only the chain's text, so
 * these are notes beside it: an agent's new why starts unchecked.
 *
 * Read through `readChecks`, because a synced or hand-edited value can hold
 * anything. The page rehydrates it on mount.
 */

import { useMemo } from "react";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";

export type WhyCheck = "yes" | "no";

export interface RootCauseChecks {
  /** `${analysisId}:${whyId}` → the answer. */
  checks: Record<string, WhyCheck>;
}

/** Answers kept at most: older ones go first. */
export const CHECKS_MAX = 500;

export const useRootCauseChecks = createPersistedStore<RootCauseChecks>("root-cause-checks", {
  checks: {},
});

/** The answers that are answers, at most CHECKS_MAX. */
export function readChecks(raw: unknown): Record<string, WhyCheck> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (e): e is [string, WhyCheck] =>
      e[0].length <= 200 && e[0].includes(":") && (e[1] === "yes" || e[1] === "no")
  );
  return Object.fromEntries(entries.slice(-CHECKS_MAX));
}

const checkKey = (analysisId: string, whyId: string) => `${analysisId}:${whyId}`;

/** Record (or with null, clear) the answer for one why. */
export function setWhyCheck(analysisId: string, whyId: string, answer: WhyCheck | null): void {
  useRootCauseChecks.setState((s) => {
    const next = { ...readChecks(s.checks) };
    const key = checkKey(analysisId, whyId);
    delete next[key];
    if (answer) next[key] = answer;
    return { checks: readChecks(next) };
  });
}

/** The answers for one analysis, by why id. */
export function useWhyChecks(analysisId: string): Record<string, WhyCheck> {
  const raw = useRootCauseChecks((s) => s.checks);
  return useMemo(() => {
    const prefix = `${analysisId}:`;
    const out: Record<string, WhyCheck> = {};
    for (const [key, value] of Object.entries(readChecks(raw))) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
    return out;
  }, [raw, analysisId]);
}
