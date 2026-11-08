"use client";

/**
 * Silent celebrations: every reward the engine or the ledger reports becomes
 * a row in the Activity inbox. Nothing here shows a toast, and nothing is
 * dropped — quiet routes, presenting and silent mode only matter for the
 * moments with Amr (PR I), which read the rarity set here.
 *
 * - **Same-action merge.** A level-up, badge or prestige reported within
 *   1.5 s of the first one came from the same action (an outcome that
 *   unlocks a badge whose XP crosses a level): they become one row headed
 *   by the rarest item, the rest as its children. The timer runs only while
 *   something waits.
 * - **Challenges** completed on the same local day group into one row.
 * - **Kudos received** get a row per kudos id.
 * - **"Today's XP is full"** once per day, when the ledger reports the cap.
 * - **"Your progress carried over"** once ever, for someone who already
 *   had a level or badges before the inbox existed.
 *
 * `NEXT_PUBLIC_CELEBRATIONS=legacy` (build-time) keeps the old toasts
 * instead (see provider.tsx).
 */

import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useInboxStore, withInbox } from "@/lib/notify/inbox-store";
import {
  maxRarity,
  rarityRank,
  type InboxInput,
  type InboxItem,
  type Rarity,
} from "@/lib/notify/inbox";
import {
  CARRIED_OVER_TITLE,
  KUDOS_RECEIVED_TITLE,
  PRESTIGE_BODY,
  XP_CAP_BODY,
  XP_CAP_TITLE,
  carriedOverBody,
  challengeTitle,
  challengesGroupTitle,
  levelBody,
  levelTitle,
  prestigeTitle,
  xpLine,
} from "@/lib/notify/copy";
import { subscribe, type GamificationSideEffect } from "./engine";
import { subscribeOutcomes, type OutcomeRecord } from "./ledger";
import { getAchievement } from "./achievements";
import { findDaily, findWeekly } from "./challenges";
import { localDateOf } from "./outcomes";
import type { Achievement } from "./types";

/** Effects this close together came from one action and share a row. */
export const SAME_ACTION_MERGE_MS = 1500;

/** Whether the build-time kill switch restores the old celebration toasts. */
export function isLegacyCelebrations(): boolean {
  return process.env.NEXT_PUBLIC_CELEBRATIONS === "legacy";
}

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

export function achievementRarity(
  ach: Pick<Achievement, "xp" | "hidden" | "category"> | undefined,
  xp: number
): Rarity {
  if (ach && (ach.hidden || ach.category === "secret")) return "epic";
  const value = ach?.xp ?? xp;
  if (value >= 300) return "epic";
  if (value >= 100) return "rare";
  return "common";
}

export function levelRarity(level: number): Rarity {
  return level % 5 === 0 ? "epic" : "rare";
}

export function challengeRarity(kind: unknown): Rarity {
  return kind === "weekly" ? "rare" : "common";
}

// ---------------------------------------------------------------------------
// Listeners (the moment scheduler, PR I)
// ---------------------------------------------------------------------------

type CelebrationListener = (item: InboxItem) => void;
const listeners = new Set<CelebrationListener>();

/** Hear every inbox row a celebration adds or updates. */
export function subscribeCelebrations(fn: CelebrationListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function addRow(input: InboxInput): void {
  withInbox(() => {
    const item = useInboxStore.getState().add(input);
    listeners.forEach((fn) => {
      try {
        fn(item);
      } catch {
        /* a listener never breaks the inbox */
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Same-action batch
// ---------------------------------------------------------------------------

interface BatchEntry {
  kind: "level-up" | "achievement" | "prestige";
  title: string;
  body?: string;
  xp?: number;
  icon: string;
  rarity: Rarity;
}

let batch: BatchEntry[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function queue(entry: BatchEntry): void {
  batch.push(entry);
  if (batchTimer === null) {
    batchTimer = setTimeout(flushCelebrations, SAME_ACTION_MERGE_MS);
  }
}

/** Write what the current 1.5 s window collected (also called by tests). */
export function flushCelebrations(): void {
  if (batchTimer !== null) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (batch.length === 0) return;
  const entries = batch;
  batch = [];
  // The rarest leads (the first of equals); the rest ride along as children.
  let head = entries[0];
  for (const e of entries) if (rarityRank(e.rarity) > rarityRank(head.rarity)) head = e;
  const rest = entries.filter((e) => e !== head);
  const xp = entries.reduce((sum, e) => sum + (e.xp ?? 0), 0);
  const rarity = entries.reduce<Rarity>((r, e) => maxRarity(r, e.rarity), "common");
  addRow({
    kind: head.kind,
    title: head.title,
    body: head.body,
    ...(xp > 0 ? { xp } : {}),
    icon: head.icon,
    rarity,
    gamification: true,
    ...(rest.length > 0
      ? {
          children: rest.map((e) => ({
            title: e.title,
            ...(e.xp !== undefined ? { xp: e.xp } : {}),
            icon: e.icon,
            kind: e.kind,
          })),
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function recentOutcomeIds(): string[] {
  const events = useVDnaStore.getState().recentEvents ?? [];
  const ids: string[] = [];
  for (const e of events.slice(0, 20)) {
    const id = e.meta?.outcomeId;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/** Turn one engine effect into inbox work. XP effects are not celebrations. */
export function handleEffect(effect: GamificationSideEffect): void {
  const p = (effect.payload ?? {}) as Record<string, unknown>;
  switch (effect.kind) {
    case "level-up": {
      const level = typeof p.level === "number" ? p.level : useVDnaStore.getState().level;
      queue({
        kind: "level-up",
        title: levelTitle(level),
        body: levelBody(recentOutcomeIds()),
        icon: "TrendingUp",
        rarity: levelRarity(level),
      });
      return;
    }
    case "achievement": {
      const id = typeof p.id === "string" ? p.id : "";
      const ach = getAchievement(id);
      const xp = typeof p.xp === "number" ? p.xp : (ach?.xp ?? 0);
      queue({
        kind: "achievement",
        title: (typeof p.title === "string" && p.title) || ach?.title || "New badge",
        body: ach?.description,
        xp,
        icon: ach?.icon ?? "Award",
        rarity: achievementRarity(ach, xp),
      });
      return;
    }
    case "prestige": {
      const n = typeof p.prestige === "number" ? p.prestige : useVDnaStore.getState().prestige;
      queue({
        kind: "prestige",
        title: prestigeTitle(n),
        body: PRESTIGE_BODY,
        icon: "Crown",
        rarity: "legendary",
      });
      return;
    }
    case "challenge-complete": {
      const id = typeof p.id === "string" ? p.id : "";
      const def = p.kind === "weekly" ? findWeekly(id) : (findDaily(id) ?? findWeekly(id));
      const xp = typeof p.xp === "number" ? p.xp : (def?.xp ?? 0);
      addRow({
        kind: "challenge",
        title: challengeTitle(def?.title),
        body: xpLine(xp),
        xp,
        icon: "Flag",
        rarity: challengeRarity(p.kind),
        mergeKey: `challenge:${localDateOf(new Date())}`,
        groupTitle: challengesGroupTitle,
        gamification: true,
      });
      return;
    }
    default:
      return;
  }
}

/** Turn a recorded outcome into inbox work (kudos received, the daily cap). */
export function handleOutcome(record: OutcomeRecord): void {
  if (record.id === "kudos-received") {
    const kudosId = record.key?.startsWith("kudos-in:") ? record.key.slice(9) : record.key;
    addRow({
      kind: "kudos",
      title: KUDOS_RECEIVED_TITLE,
      ...(record.xp > 0 ? { body: xpLine(record.xp), xp: record.xp } : {}),
      icon: "Heart",
      rarity: "common",
      at: record.at,
      href: "/kudos",
      ...(kudosId ? { mergeKey: `kudos:${kudosId}`, merge: "replace" as const } : {}),
    });
  }
  if (record.capReached) {
    addRow({
      kind: "xp-cap",
      title: XP_CAP_TITLE,
      body: XP_CAP_BODY,
      icon: "Gauge",
      rarity: "common",
      mergeKey: `xp-cap:${localDateOf(record.at)}`,
      merge: "replace",
      gamification: true,
    });
  }
}

/**
 * The one-off "Your progress carried over: Level N, M badges" row, for a
 * profile that already had progress when the inbox arrived. Call once both
 * the profile and the inbox have been read from storage.
 */
export function seedCarriedOver(): void {
  const inbox = useInboxStore.getState();
  if (inbox.seeded) return;
  const { level, unlocked, xp } = useVDnaStore.getState();
  const badges = unlocked.length;
  if (level > 1 || badges > 0 || xp > 0) {
    inbox.add({
      kind: "carried-over",
      title: CARRIED_OVER_TITLE,
      body: carriedOverBody(level, badges),
      icon: "Sparkles",
      rarity: "common",
      gamification: true,
    });
  }
  useInboxStore.getState().setSeeded();
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/** Route engine and ledger rewards into the inbox. Returns a detach function. */
export function installCelebrations(): () => void {
  const offEffects = subscribe(handleEffect);
  const offOutcomes = subscribeOutcomes(handleOutcome);
  return () => {
    offEffects();
    offOutcomes();
    // Don't lose what the window collected.
    flushCelebrations();
  };
}

/** Test-only: forget the pending batch and listeners. */
export function __resetCelebrationsForTests(): void {
  if (batchTimer !== null) clearTimeout(batchTimer);
  batchTimer = null;
  batch = [];
  listeners.clear();
}
