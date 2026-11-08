"use client";
import { safeJSONStorage } from "./safe-storage";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { VDna, XpEvent, ChallengeProgress } from "@/lib/gamification/types";
import {
  EMPTY_XP_DAY,
  ensureVDnaShape,
  migrateVDna,
  VDNA_SCHEMA_VERSION,
} from "@/lib/gamification/vdna-migrate";
import { mergePersisted } from "./persist-migrate";

/**
 * Persisted schema version of `agile-toolkit:vdna`.
 * v0: original shape. v1: XP ledger fields (`xpDay`, `claims`, `onceKeys`),
 * secrets seeded as paid, `level` recomputed. v2: `silentMode` dropped and
 * the input-only counters stripped (lib/gamification/vdna-migrate.ts).
 */
export const VDNA_PERSIST_VERSION = VDNA_SCHEMA_VERSION;

/**
 * v2 drops `silentMode`, but an older payload's silent mode still has to be
 * mapped onto the celebration level once (notification-prefs-store's
 * `adoptSilentMode`). The persist hooks note it here before the field goes,
 * and the provider reads it once both stores have loaded.
 */
let legacySilentModeSeen = false;

function noteLegacySilentMode(persisted: unknown): void {
  if (
    persisted &&
    typeof persisted === "object" &&
    (persisted as { silentMode?: unknown }).silentMode === true
  ) {
    legacySilentModeSeen = true;
  }
}

/** True when a stored profile loaded in this page still had the old silent mode on. */
export function hadLegacySilentMode(): boolean {
  return legacySilentModeSeen;
}

/** Tests only. */
export function __resetLegacySilentModeForTests(): void {
  legacySilentModeSeen = false;
}

/**
 * Generate a fresh visitor id. The id is stored INSIDE the persisted payload
 * (`agile-toolkit:vdna`), not in a separate localStorage key. Earlier
 * versions kept a parallel `agile-toolkit:vdna-id` key which survived
 * "reset workspace" actions and confused identity tracking. With persistence
 * keyed by the single canonical name, clearing the storage cleanly resets
 * the visitor.
 */
function seedVisitorId(): string {
  if (typeof window === "undefined") return "ssr";
  return nanoid(12);
}

const initial: VDna = {
  visitorId: "pending",
  displayName: undefined,
  lifetimeXp: 0,
  xp: 0,
  level: 1,
  prestige: 0,
  unlocked: [],
  toolsVisited: [],
  lastActiveDate: "",
  streak: 0,
  longestStreak: 0,
  dailyChallenges: [],
  weeklyChallenges: [],
  recentEvents: [],
  shareOnLeaderboard: false,
  counters: {},
  xpDay: EMPTY_XP_DAY,
  claims: {},
  onceKeys: [],
};

interface VDnaActions {
  /** Replace the entire state (used by engine on mutations). */
  apply: (patch: Partial<VDna>) => void;
  /** Push a new XP event, trims to last 50. */
  pushEvent: (e: XpEvent) => void;
  /** Replace tools visited. */
  setToolsVisited: (list: string[]) => void;
  /** Replace unlocked achievements. */
  setUnlocked: (list: string[]) => void;
  /** Replace daily challenges. */
  setDailyChallenges: (list: ChallengeProgress[]) => void;
  /** Replace weekly challenges. */
  setWeeklyChallenges: (list: ChallengeProgress[]) => void;
  /** Increment a named counter. */
  bumpCounter: (key: string, by?: number) => number;
  /**
   * Reset for prestige (keeps visitorId, lifetimeXp, unlocked, streak, and
   * the ledger's `xpDay` / `claims` / `onceKeys` so a prestige can't reopen
   * caps or once-only rewards).
   */
  prestigeReset: () => void;
  /** Settings toggles. */
  setDisplayName: (name: string | undefined) => void;
  setShareOnLeaderboard: (v: boolean) => void;
}

export const useVDnaStore = create<VDna & VDnaActions>()(
  persist(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (set, _get) => ({
      ...initial,
      apply: (patch) => set(patch),
      pushEvent: (e) =>
        set((s) => {
          // Dedupe: rapid identical events (same source+amount) fired within a
          // 2-second window collapse to a single head entry. Without this, a
          // buggy emitter or hot-loop fills `recentEvents` with 50 copies of
          // the same line, drowning real signal and blowing localStorage.
          // We compare against the head only because the stack is LIFO; a
          // duplicate further back is intentional history we want to keep.
          const head = s.recentEvents[0];
          if (head && head.source === e.source && head.amount === e.amount) {
            const tDelta = Math.abs(
              new Date(e.at ?? "").getTime() - new Date(head.at ?? "").getTime()
            );
            if (Number.isFinite(tDelta) && tDelta < 2000) {
              return { recentEvents: [{ ...e }, ...s.recentEvents.slice(1)].slice(0, 50) };
            }
          }
          return { recentEvents: [e, ...s.recentEvents].slice(0, 50) };
        }),
      setToolsVisited: (list) => set({ toolsVisited: list }),
      setUnlocked: (list) => set({ unlocked: list }),
      setDailyChallenges: (list) => set({ dailyChallenges: list }),
      setWeeklyChallenges: (list) => set({ weeklyChallenges: list }),
      bumpCounter: (key, by = 1) => {
        // R5: previously used sequential `get()` reads — two concurrent
        // `bumpCounter("xp")` calls each saw the SAME pre-state and the
        // second clobbered the first (lost increment). Compute INSIDE
        // the functional updater so both reads share one snapshot —
        // critical for the gamification path which fires bursts of XP
        // events synchronously after a tool action.
        let nextVal = 0;
        set((s) => {
          const cur = s.counters[key] ?? 0;
          nextVal = cur + by;
          return { counters: { ...s.counters, [key]: nextVal } };
        });
        return nextVal;
      },
      prestigeReset: () =>
        set((s) => ({
          xp: 0,
          level: 1,
          prestige: s.prestige + 1,
          dailyChallenges: [],
          weeklyChallenges: [],
          counters: {}, // reset per-run counters
        })),
      setDisplayName: (name) => set({ displayName: name }),
      setShareOnLeaderboard: (v) => set({ shareOnLeaderboard: v }),
    }),
    {
      name: "agile-toolkit:vdna",
      storage: safeJSONStorage("vdna"),
      skipHydration: true,
      // Rollback safety. zustand's persist drops a stored payload whose
      // version differs from `version` unless `migrate` is given. migrateVDna
      // brings older payloads up to v2 and passes newer ones through whole
      // (unknown fields included). Older builds re-stamp what they write
      // with their own version, so every step detects shape rather than
      // trusting the version: idempotent, fill-if-absent, keeps unknown fields.
      version: VDNA_PERSIST_VERSION,
      migrate: (persisted, version) => {
        noteLegacySilentMode(persisted);
        return migrateVDna(persisted, version);
      },
      // An unstamped legacy payload never reaches `migrate`; upgrade it here
      // by shape (a no-op for payloads already in v2 shape).
      merge: (persisted, current) => {
        noteLegacySilentMode(persisted);
        return mergePersisted(ensureVDnaShape(persisted), current);
      },
      onRehydrateStorage: () => (state) => {
        // Seed the visitor id once at rehydrate time if it's missing or
        // still the "pending" sentinel. On first-ever visit the persisted
        // state is absent, so the merged state still has visitorId="pending"
        // (from `initial`). Subsequent loads pick up the persisted id.
        if (state && (state.visitorId === "pending" || !state.visitorId)) {
          state.visitorId = seedVisitorId();
        }
      },
    }
  )
);

export function getVDnaSnapshot(): VDna {
  const s = useVDnaStore.getState();
  return {
    visitorId: s.visitorId,
    displayName: s.displayName,
    lifetimeXp: s.lifetimeXp,
    xp: s.xp,
    level: s.level,
    prestige: s.prestige,
    unlocked: s.unlocked,
    toolsVisited: s.toolsVisited,
    lastActiveDate: s.lastActiveDate,
    streak: s.streak,
    longestStreak: s.longestStreak,
    dailyChallenges: s.dailyChallenges,
    weeklyChallenges: s.weeklyChallenges,
    recentEvents: s.recentEvents,
    shareOnLeaderboard: s.shareOnLeaderboard,
    counters: s.counters,
    xpDay: s.xpDay,
    claims: s.claims,
    onceKeys: s.onceKeys,
  };
}
