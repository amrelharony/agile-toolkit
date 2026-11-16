"use client";

/**
 * "Is this really why?": the team's answer for each why after the first
 * (would fixing this one stop the one above it?), kept in this browser
 * (`agile-toolkit:root-cause-checks`, synced like other tool stores for the
 * signed-in owner). The analysis itself holds only the chain's text, so
 * these are notes beside it: an agent's new why starts unchecked.
 *
 * The same store keeps, per analysis, the fishbone's starting categories
 * the team renamed or removed (`hiddenCategories`): a category is only the
 * name on its causes, so an empty default would otherwise come back.
 *
 * Read through `readChecks` and `readHidden`, because a synced or
 * hand-edited value can hold anything. The page rehydrates it on mount.
 */

import { useMemo } from "react";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { DEFAULT_CATEGORIES } from "@/lib/root-cause/model";

export type WhyCheck = "yes" | "no";

export interface RootCauseChecks {
  /** `${analysisId}:${whyId}` → the answer. */
  checks: Record<string, WhyCheck>;
  /** Analysis id → the default fishbone categories renamed or removed there. */
  hiddenCategories: Record<string, string[]>;
}

/** Answers kept at most: older ones go first. */
export const CHECKS_MAX = 500;
/** Analyses with hidden categories kept at most: older ones go first. */
export const HIDDEN_MAX = 200;

export const useRootCauseChecks = createPersistedStore<RootCauseChecks>("root-cause-checks", {
  checks: {},
  hiddenCategories: {},
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

/** Hidden default categories that are default categories, per analysis, at most HIDDEN_MAX analyses. */
export function readHidden(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const defaults = new Map(DEFAULT_CATEGORIES.map((c) => [c.toLowerCase(), c]));
  const out: [string, string[]][] = [];
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length > 200 || !Array.isArray(list)) continue;
    const names = Array.from(
      new Set(
        list.flatMap((n) =>
          typeof n === "string" && defaults.has(n.trim().toLowerCase())
            ? [defaults.get(n.trim().toLowerCase()) as string]
            : []
        )
      )
    );
    if (names.length > 0) out.push([id, names]);
  }
  return Object.fromEntries(out.slice(-HIDDEN_MAX));
}

/** Hide (or with `hidden` false, show again) a default category on one analysis. */
export function setCategoryHidden(analysisId: string, name: string, hidden: boolean): void {
  useRootCauseChecks.setState((s) => {
    const all = readHidden(s.hiddenCategories);
    const key = name.trim().toLowerCase();
    const rest = (all[analysisId] ?? []).filter((n) => n.toLowerCase() !== key);
    const next = { ...all };
    delete next[analysisId];
    const list = hidden ? [...rest, name] : rest;
    if (list.length > 0) next[analysisId] = list;
    return { hiddenCategories: readHidden(next) };
  });
}

/** The default categories hidden on one analysis. */
export function useHiddenCategories(analysisId: string): string[] {
  const raw = useRootCauseChecks((s) => s.hiddenCategories);
  return useMemo(() => readHidden(raw)[analysisId] ?? [], [raw, analysisId]);
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
