"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { icebreakers } from "@/lib/constants/icebreakers";

/**
 * The Icebreaker's two stores.
 *
 * - Settings (`agile-toolkit:icebreaker`, synced like other tool stores):
 *   favourites, the activities the team has used and when, and whether the
 *   page hides the recent ones. Favourites used to sit in a raw localStorage
 *   key that never synced (moved once by ./migrate.ts). Every field is
 *   normalised on the way out, because a synced or hand-edited value can
 *   hold anything.
 * - Session (sessionStorage, per tab like the docked timer): the activity
 *   on screen and the one whose timer is running, so going to the retro
 *   board and back keeps the pick and its clock together.
 *
 * Both skip hydration at load and are rehydrated by the page on mount, so
 * the server render and the first client render agree.
 */

export interface IcebreakerUse {
  id: string;
  /** A catalog id (src/lib/constants/icebreakers.ts). */
  icebreakerId: string;
  /** When it was run, ISO. Backdatable. */
  usedAt: string;
  /** How long it was timed for. */
  minutes: number;
}

export interface IcebreakerSettings {
  /** Catalog ids, each once. */
  favorites: string[];
  used: IcebreakerUse[];
  /** Leave out activities used in the last two weeks. Off until the team turns it on. */
  hideRecent: boolean;
}

export const SETTINGS_INITIAL: IcebreakerSettings = { favorites: [], used: [], hideRecent: false };

export const useIcebreakerSettings = createPersistedStore<IcebreakerSettings>(
  "icebreaker",
  SETTINGS_INITIAL
);

/** The most uses kept: years of weekly retros, without growing forever. */
export const MAX_USES = 200;

const CATALOG_IDS = new Set(icebreakers.map((ib) => ib.id));

export const isIcebreakerId = (id: unknown): id is string =>
  typeof id === "string" && CATALOG_IDS.has(id);

/** Catalog ids only, each once, in the order given. */
export function normalizeFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter(isIcebreakerId)));
}

function normalizeUse(raw: unknown): IcebreakerUse | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.id !== "string" || !u.id || !isIcebreakerId(u.icebreakerId)) return null;
  if (typeof u.usedAt !== "string" || Number.isNaN(Date.parse(u.usedAt))) return null;
  const minutes = typeof u.minutes === "number" && Number.isFinite(u.minutes) ? u.minutes : 0;
  return {
    id: u.id,
    icebreakerId: u.icebreakerId,
    usedAt: u.usedAt,
    minutes: Math.max(0, minutes),
  };
}

/**
 * Valid uses of catalog activities, each id once, newest first, capped at
 * MAX_USES (the oldest go).
 */
export function normalizeUses(raw: unknown): IcebreakerUse[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IcebreakerUse[] = [];
  for (const row of raw) {
    const use = normalizeUse(row);
    if (!use || seen.has(use.id)) continue;
    seen.add(use.id);
    out.push(use);
  }
  out.sort((a, b) => Date.parse(b.usedAt) - Date.parse(a.usedAt));
  return out.slice(0, MAX_USES);
}

export function normalizeSettings(raw: unknown): IcebreakerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    favorites: normalizeFavorites(r.favorites),
    used: normalizeUses(r.used),
    hideRecent: r.hideRecent === true,
  };
}

/** Change the favourites, starting from the clean list. */
export function updateFavorites(fn: (list: readonly string[]) => string[]): void {
  useIcebreakerSettings.setState((s) => ({
    favorites: normalizeFavorites(fn(normalizeFavorites(s.favorites))),
  }));
}

/** Change the uses, starting from the clean list. */
export function updateUses(fn: (list: readonly IcebreakerUse[]) => IcebreakerUse[]): void {
  useIcebreakerSettings.setState((s) => ({ used: normalizeUses(fn(normalizeUses(s.used))) }));
}

/* -------------------------------------------------------------------------- */
/*  Session                                                                    */
/* -------------------------------------------------------------------------- */

export interface IcebreakerSession {
  /** The activity on screen. */
  selectedId: string | null;
  /** The activity the docked timer is timing, while it is ours. */
  runningId: string | null;
}

export const SESSION_KEY = "agile-toolkit:icebreaker:session";

export function normalizeSession(raw: unknown): IcebreakerSession {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    selectedId: isIcebreakerId(r.selectedId) ? r.selectedId : null,
    runningId: isIcebreakerId(r.runningId) ? r.runningId : null,
  };
}

export const useIcebreakerSession = create<IcebreakerSession>()(
  persist((): IcebreakerSession => ({ selectedId: null, runningId: null }), {
    name: SESSION_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    // Nothing stored (a new tab) keeps what's there.
    merge: (persisted, current) =>
      persisted ? { ...current, ...normalizeSession(persisted) } : current,
  })
);
