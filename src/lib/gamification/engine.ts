"use client";

import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { isFocusActive } from "@/lib/notify/prefs";
import { achievements, getAchievement } from "./achievements";
import {
  findDaily,
  findWeekly,
  pickDailies,
  pickWeeklies,
  sanitizeChallenges,
  todaySeedKey,
  weekSeedKey,
} from "./challenges";
import { isWorkOutcome, outcomeToolId } from "./outcomes";
import { awardingCrossesLevel, computeLevel, MAX_LEVEL } from "./xp-curve";
import type { Achievement, GamificationEvent, XpEvent, XpSource } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Which events the engine looks at
// ──────────────────────────────────────────────────────────────────────────

/**
 * Event names the engine acts on. Anything else (clicks, hovers, keys,
 * scrolling, session minutes, settings toggles) returns from dispatch()
 * before touching the store: no badge, challenge or counter reads raw
 * input any more.
 */
const RELEVANT_PREFIXES = ["tool:", "outcome:", "secret:"] as const;
const RELEVANT_EVENTS: ReadonlySet<string> = new Set([
  "tool-visit",
  "logo-whispered",
  "export-png",
  "export-csv",
  "export-json",
  "export-markdown",
  "room-joined",
  "room-members",
  "invite-created",
  "sync-remote",
  "workspace-import",
  "backup-downloaded",
  "retro-format-used",
  "prestige-completed",
]);

export function isRelevantEvent(name: string): boolean {
  return RELEVANT_EVENTS.has(name) || RELEVANT_PREFIXES.some((p) => name.startsWith(p));
}

// ──────────────────────────────────────────────────────────────────────────
// Re-entrancy guard
// ──────────────────────────────────────────────────────────────────────────

let emitDepth = 0;
const MAX_EMIT_DEPTH = 5;

// ──────────────────────────────────────────────────────────────────────────
// Subscribers
// ──────────────────────────────────────────────────────────────────────────

type SubFn = (evt: GamificationSideEffect) => void;
const subscribers = new Set<SubFn>();

export interface GamificationSideEffect {
  kind: "xp" | "level-up" | "achievement" | "challenge-complete" | "prestige";
  payload: Record<string, unknown>;
}

export function subscribe(fn: SubFn): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function notify(effect: GamificationSideEffect) {
  subscribers.forEach((fn) => {
    try {
      fn(effect);
    } catch {
      /* never let a subscriber crash the engine */
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Achievement rules — evaluate after every event
// ──────────────────────────────────────────────────────────────────────────

/**
 * Rule: given event name + current VDna, return true if the achievement should
 * unlock NOW.  Rules are evaluated only for still-locked, non-retired
 * achievements.
 */
type Rule = (
  eventName: string,
  meta: Record<string, unknown> | undefined,
  state: ReturnType<typeof useVDnaStore.getState>
) => boolean;

const count = (s: { counters: Record<string, number> }, key: string) => s.counters[key] ?? 0;

/** An `outcome:<id>` event for finished work (not a first visit or a secret). */
function isWorkOutcomeEvent(evt: string): boolean {
  return evt.startsWith("outcome:") && isWorkOutcome(evt.slice("outcome:".length));
}

const rules: Partial<Record<string, Rule>> = {
  "tool-hop-5": (_e, _m, s) => s.toolsVisited.length >= 5,
  "tool-hop-20": (_e, _m, s) => s.toolsVisited.length >= 20,
  "tool-hop-42": (_e, _m, s) => s.toolsVisited.length >= 42,
  // The comic: the story page dispatches tool:comics:completed once per story
  // (lib/comics/reading), with the reader's week streak in its meta.
  // The meta's total is this browser's reading record, which a prestige reset
  // leaves alone; the counter it clears is only a second way in.
  "first-story": (e, _m, s) =>
    e === "tool:comics:completed" || count(s, "tool:comics:completed") >= 1,
  "ten-stories": (e, m, s) =>
    (e === "tool:comics:completed" && Number(m?.total) >= 10) ||
    count(s, "tool:comics:completed") >= 10,
  "weekly-reader": (e, m) => e === "tool:comics:completed" && Number(m?.weekStreak) >= 4,
  "squad-question": (_e, _m, s) => count(s, "tool:comics:retro-question") >= 1,
  // Time-of-day badges read the time finished work happened, not a click.
  "night-owl": (e) => isWorkOutcomeEvent(e) && new Date().getHours() < 5,
  "early-bird": (e) => {
    if (!isWorkOutcomeEvent(e)) return false;
    const h = new Date().getHours();
    return h >= 5 && h < 7;
  },
  "poker-voter": (_e, _m, s) => count(s, "outcome:estimate-committed") >= 10,
  "poker-reveal": (evt) => evt === "tool:planning-poker:reveal",
  "retro-one": (_e, _m, s) => count(s, "outcome:retro-finished") >= 1,
  "retro-fifty": (_e, _m, s) => count(s, "outcome:retro-finished") >= 10,
  "retro-all-formats": (_e, _m, s) => count(s, "retro-formats-used") >= 3,
  "kanban-ten": (_e, _m, s) => count(s, "outcome:card-done") >= 1,
  "kanban-done-ten": (_e, _m, s) => count(s, "tool:kanban:card-done") >= 10,
  "ceremony-finish": (evt) => evt === "tool:ceremony-timer:finish",
  "burndown-full": (_e, _m, s) => count(s, "tool:burndown:day-logged") >= 10,
  "velocity-five": (_e, _m, s) => count(s, "tool:velocity:sprint-added") >= 5,
  "risk-closer": (_e, _m, s) => count(s, "outcome:risk-closed") >= 5,
  "impediments-clear": (_e, _m, s) => count(s, "outcome:impediment-resolved") >= 10,
  "okr-complete": (evt) => evt === "tool:okrs:okr-achieved",
  "debt-paydown": (_e, _m, s) => count(s, "outcome:debt-resolved") >= 5,
  "adr-writer": (_e, _m, s) => count(s, "tool:decision-log:adr-new") >= 5,
  "mood-streak": (_e, _m, s) => count(s, "mood-streak-days") >= 7,
  // Real signals from lib/realtime/use-room.ts and the invite dialog
  // (lib/gamification/signal.ts).
  "room-join": (evt) => evt === "room-joined",
  "room-host": (evt) => evt === "invite-created",
  // emitRtEvent("sync-remote") reaches the engine as the bare name: rt
  // events lose their surface prefix in emit(), so `rt:sync-remote` never
  // matched.
  "sync-first": (evt) => evt === "sync-remote",
  "party-of-four": (evt, m) =>
    evt === "room-members" && typeof m?.memberCount === "number" && m.memberCount >= 4,
  "daily-three": (_e, _m, s) =>
    s.dailyChallenges.length > 0 && s.dailyChallenges.every((c) => c.completed),
  "weekly-sweep": (_e, _m, s) =>
    s.weeklyChallenges.length > 0 && s.weeklyChallenges.every((c) => c.completed),
  "sprint-complete": (evt) => evt === "outcome:sprint-closed",
  "release-forecast": (evt) => evt === "tool:release-planner:simulate",
  "dependency-free": (_e, m) => Boolean(m?.zeroCycles),
  "flow-efficient": (_e, m) => typeof m?.flowEfficiency === "number" && m.flowEfficiency >= 0.4,
  "hypothesis-valid": (evt) => evt === "tool:hypothesis-tracker:validated",
  "hypothesis-invalid": (evt) => evt === "tool:hypothesis-tracker:invalidated",
  "interview-ten": (_e, _m, s) => count(s, "tool:user-interviews:interview-new") >= 10,
  "opportunity-deep": (_e, m) => typeof m?.depth === "number" && m.depth >= 4,
  "premortem-complete": (evt) => evt === "tool:premortem:completed",
  "streak-3": (_e, _m, s) => s.streak >= 3,
  "streak-7": (_e, _m, s) => s.streak >= 7,
  "streak-30": (_e, _m, s) => s.streak >= 30,
  "streak-100": (_e, _m, s) => s.streak >= 100,
  // A successful import of workspace data onto a canvas.
  "workspace-import": (evt) => evt === "workspace-import",
  "export-master": (_e, _m, s) =>
    count(s, "export-png") > 0 && count(s, "export-csv") > 0 && count(s, "export-json") > 0,
  "level-ten": (_e, _m, s) => s.level >= 10,
  // ─── Outcomes (counters kept by recordOutcomeStats) ──────────────────
  "first-win": (_e, _m, s) => count(s, "outcomes-total") >= 1,
  "busy-day": (_e, _m, s) => count(s, "outcome-day-count") >= 5,
  "big-day": (_e, _m, s) => count(s, "outcome-day-count") >= 10,
  "steady-week": (_e, _m, s) => count(s, "outcome-week-days") >= 3,
  "steady-month": (_e, _m, s) => count(s, "outcome-week-streak") >= 4,
  "five-tool-finisher": (_e, _m, s) => count(s, "outcome-tools") >= 5,
  "ten-tool-finisher": (_e, _m, s) => count(s, "outcome-tools") >= 10,
  "kudos-week": (_e, _m, s) => count(s, "kudos-week-days") >= 3,
  "deep-focus": (_e, _m, s) => count(s, "outcome-focus") >= 1,
  "full-ceremony": (_e, _m, s) => count(s, "outcome:ceremony-finished") >= 3,
  unblocker: (_e, _m, s) => count(s, "outcome:impediment-resolved") >= 3,
  "safe-keeper": (evt) => evt === "backup-downloaded",
  // ─── Secrets (each pays its outcome XP once ever; see secrets.ts) ────
  konami: (evt) => evt === "secret:konami",
  // secrets.ts dispatches `logo-whispered` exactly when the hover count
  // reaches 10.
  "logo-whisperer": (evt) => evt === "logo-whispered",
  "triple-tap": (evt) => evt === "secret:triple-tap",
  "footer-click": (evt) => evt === "secret:footer-click",
  "type-agile": (evt) => evt === "secret:typed-agile",
  "type-scrum": (evt) => evt === "secret:typed-scrum",
  "midnight-commit": (e) => {
    if (!isWorkOutcomeEvent(e)) return false;
    const d = new Date();
    return d.getHours() === 0 && d.getMinutes() === 0;
  },
  "prestige-one": (_e, _m, s) => s.prestige >= 1,
  // ─── Recognition ─────────────────────────────────────────────────────
  // Counters are bumped by the `tool:kudos:*` events forwarded from emit().
  // The multi-recipient gate lives in the dispatch site that emits
  // `tool:kudos:squad-complete`.
  "generous-spirit-25": (_e, _m, s) => count(s, "tool:kudos:sent") >= 25,
  "receiver-10": (_e, _m, s) => count(s, "tool:kudos:received") >= 10,
  "squad-booster-all": (evt) => evt === "tool:kudos:squad-complete",
  "fair-witness": (evt, m) => evt === "tool:kudos:llm-suggested-pick" && Boolean(m?.suggested),
};

/** The rule table, for contract tests. */
export const ACHIEVEMENT_RULE_IDS: readonly string[] = Object.keys(rules);

/**
 * Local-calendar day ordinal (days since epoch in the user's timezone).
 * Built from Y/M/D parts via Date.UTC so a DST shift can't produce the
 * off-by-one days that flooring a raw epoch-ms value would — consecutive
 * local days always differ by exactly 1.
 */
function localDayOrdinal(d: Date = new Date()): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Day ordinal of the Monday that starts `d`'s week. */
function localWeekOrdinal(d: Date = new Date()): number {
  return localDayOrdinal(d) - ((d.getDay() + 6) % 7);
}

/**
 * Set a counter to an absolute value via bumpCounter's functional updater
 * (the store exposes no setter, and `apply({ counters })` would reintroduce
 * the read-then-clobber race bumpCounter's R5 fix closed).
 */
function setCounter(key: string, value: number) {
  const cur = useVDnaStore.getState().counters[key] ?? 0;
  if (cur !== value) useVDnaStore.getState().bumpCounter(key, value - cur);
}

/**
 * Days-in-a-week bookkeeping for one kind of activity, in place on `c`:
 * `<prefix>-day` (last day seen), `<prefix>-week` (its week) and
 * `<prefix>-week-days` (distinct days in that week). Returns true on the
 * first activity of a new week, with `prevWeek` the week before it.
 */
function markDay(
  c: Record<string, number>,
  prefix: string,
  today: number,
  week: number
): { newWeek: boolean; prevWeek: number | undefined } | null {
  if (c[`${prefix}-day`] === today) return null;
  c[`${prefix}-day`] = today;
  const prevWeek = c[`${prefix}-week`];
  if (prevWeek === week) {
    c[`${prefix}-week-days`] = (c[`${prefix}-week-days`] ?? 0) + 1;
    return { newWeek: false, prevWeek };
  }
  c[`${prefix}-week`] = week;
  c[`${prefix}-week-days`] = 1;
  return { newWeek: true, prevWeek };
}

/**
 * Counters behind the outcome badges, updated in one functional write for
 * every outcome that counts as work (also past a daily XP cap):
 *   - `outcomes-total`;
 *   - `outcome-day-count` for the current local day (`outcome-day`);
 *   - `outcome-week-days` and `outcome-week-streak` (weeks in a row);
 *   - `outcome-tool:<toolId>` markers and their count `outcome-tools`;
 *   - `kudos-week-days` for kudos sent (received ones: recordKudosDay);
 *   - `outcome-focus` for outcomes finished during Focus time.
 */
function recordOutcomeStats(outcomeId: string, toolId: string | undefined) {
  const now = new Date();
  const today = localDayOrdinal(now);
  const week = localWeekOrdinal(now);
  let focus = false;
  try {
    focus = isFocusActive(useNotificationPrefsStore.getState(), now.getTime());
  } catch {
    /* prefs unreadable — not in Focus */
  }
  useVDnaStore.setState((s) => {
    const c: Record<string, number> = { ...s.counters };
    c["outcomes-total"] = (c["outcomes-total"] ?? 0) + 1;
    if (c["outcome-day"] !== today) c["outcome-day-count"] = 0;
    c["outcome-day-count"] = (c["outcome-day-count"] ?? 0) + 1;
    const day = markDay(c, "outcome", today, week);
    if (day?.newWeek) {
      c["outcome-week-streak"] =
        day.prevWeek === week - 7 ? (c["outcome-week-streak"] ?? 0) + 1 : 1;
    }
    if (toolId && !c[`outcome-tool:${toolId}`]) {
      c[`outcome-tool:${toolId}`] = 1;
      c["outcome-tools"] = (c["outcome-tools"] ?? 0) + 1;
    }
    if (outcomeId === "kudos-sent") markDay(c, "kudos", today, week);
    if (focus) c["outcome-focus"] = (c["outcome-focus"] ?? 0) + 1;
    return { counters: c };
  });
}

/**
 * A received kudos isn't finished work (it lands whenever a teammate sends
 * it), so it skips recordOutcomeStats; it only marks the day for "Thankful
 * Week" (kudos sent or received on 3 days of one week).
 */
function recordKudosDay() {
  const now = new Date();
  const today = localDayOrdinal(now);
  const week = localWeekOrdinal(now);
  useVDnaStore.setState((s) => {
    if (s.counters["kudos-day"] === today) return {};
    const c: Record<string, number> = { ...s.counters };
    markDay(c, "kudos", today, week);
    return { counters: c };
  });
}

// XP comes only from the outcome ledger (ledger.ts / outcomes.ts) plus the
// achievement and challenge rewards below. dispatch() itself never pays XP:
// clicks, hovers, route changes and exports used to, and could be farmed.

// ──────────────────────────────────────────────────────────────────────────
// Daily / weekly challenge advancement
// ──────────────────────────────────────────────────────────────────────────

/**
 * New period: pick a fresh set. Same period: sanitise the stored set
 * against the current pools (see sanitizeChallenges), so pool edits need
 * no store version bump.
 */
function refreshChallengesIfStale() {
  const s = useVDnaStore.getState();
  const dayKey = todaySeedKey();
  const weekKey = weekSeedKey();
  let daily = s.dailyChallenges;
  let weekly = s.weeklyChallenges;
  daily =
    daily.length === 0 || daily[0].seedDate !== dayKey
      ? pickDailies()
      : sanitizeChallenges(daily, "daily");
  weekly =
    weekly.length === 0 || weekly[0].seedDate !== weekKey
      ? pickWeeklies()
      : sanitizeChallenges(weekly, "weekly");
  if (daily !== s.dailyChallenges) useVDnaStore.getState().setDailyChallenges(daily);
  if (weekly !== s.weeklyChallenges) useVDnaStore.getState().setWeeklyChallenges(weekly);
}

function advanceChallenges(
  eventName: string,
  meta: Record<string, unknown> | undefined,
  increment = 1
) {
  const state = useVDnaStore.getState();
  const mutate = (
    list: typeof state.dailyChallenges,
    defLookup: (id: string) => ReturnType<typeof findDaily>
  ) => {
    let mutated = false;
    const next = list.map((c) => {
      if (c.completed) return c;
      const def = defLookup(c.id);
      if (!def) return c;
      if (def.trigger !== eventName) return c;
      if (def.match && !def.match(meta)) return c;
      let seen = c.seen;
      if (def.distinctBy) {
        const value = def.distinctBy(meta);
        if (!value || c.seen?.includes(value)) return c;
        seen = [...(c.seen ?? []), value];
      }
      const newProgress = Math.min(c.goal, c.progress + increment);
      const justCompleted = newProgress >= c.goal && !c.completed;
      if (newProgress !== c.progress) mutated = true;
      return {
        ...c,
        progress: newProgress,
        completed: justCompleted ? true : c.completed,
        completedAt: justCompleted ? new Date().toISOString() : c.completedAt,
        ...(seen ? { seen } : {}),
      };
    });
    return { next, mutated };
  };
  const daily = mutate(state.dailyChallenges, findDaily);
  const weekly = mutate(state.weeklyChallenges, findWeekly);
  if (daily.mutated) useVDnaStore.getState().setDailyChallenges(daily.next);
  if (weekly.mutated) useVDnaStore.getState().setWeeklyChallenges(weekly.next);

  // Fire XP rewards for newly completed challenges (re-entrant-safe).
  [...daily.next, ...weekly.next].forEach((c) => {
    if (c.completed && c.completedAt) {
      const prev =
        state.dailyChallenges.find((x) => x.id === c.id) ??
        state.weeklyChallenges.find((x) => x.id === c.id);
      if (prev && !prev.completed) {
        notify({ kind: "challenge-complete", payload: { id: c.id, kind: c.kind, xp: c.xp } });
        awardXp(c.xp, c.kind === "daily" ? "daily-challenge" : "weekly-challenge", {
          challengeId: c.id,
        });
      }
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Tool visit + streak tracking
// ──────────────────────────────────────────────────────────────────────────

function touchDailyActivity() {
  const s = useVDnaStore.getState();
  const today = todaySeedKey();
  if (s.lastActiveDate === today) return; // already counted today
  // Determine streak continuation.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = todaySeedKey(yesterday);
  const newStreak = s.lastActiveDate === yesterdayKey ? s.streak + 1 : 1;
  const longest = Math.max(s.longestStreak, newStreak);
  useVDnaStore.getState().apply({
    lastActiveDate: today,
    streak: newStreak,
    longestStreak: longest,
  });
  // Wire w-streak-7 ("use the toolkit every day this week"): one tick the
  // first time we register activity on a given local day. The early-return
  // above guarantees this fires at most once per day.
  advanceChallenges("daily-active", undefined);
}

function registerToolVisit(toolId: string) {
  const s = useVDnaStore.getState();
  if (s.toolsVisited.includes(toolId)) return;
  useVDnaStore.getState().setToolsVisited([...s.toolsVisited, toolId]);
}

/**
 * Per-ISO-week distinct-tool tracking for w-sprint-cycle ("Use Sprint Goal,
 * Burndown and Retro this week"). Raw `tool-visit` fires on every pathname
 * change, so mark one counter per (week, tool) and tick only on a tool's
 * first sighting within the current week.
 */
function registerWeeklyToolVisit(toolId: string) {
  const prefix = `week-tool:${weekSeedKey()}:`;
  const key = `${prefix}${toolId}`;
  if ((useVDnaStore.getState().counters[key] ?? 0) > 0) return;
  // Mark + prune in ONE functional update: the marker write must not race
  // (same reason bumpCounter is functional), and last week's markers have
  // to be dropped or the persisted counters map grows without bound.
  useVDnaStore.setState((s) => {
    const counters: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.counters)) {
      if (k.startsWith("week-tool:") && !k.startsWith(prefix)) continue;
      counters[k] = v;
    }
    counters[key] = 1;
    return { counters };
  });
  advanceChallenges("tool-visit-week-unique", { toolId });
}

// ──────────────────────────────────────────────────────────────────────────
// XP award + level handling
// ──────────────────────────────────────────────────────────────────────────

function awardXp(
  amount: number,
  source: XpSource,
  meta?: Record<string, string | number | boolean>
) {
  if (amount <= 0) return;
  if (emitDepth >= MAX_EMIT_DEPTH) return; // re-entrant circuit breaker
  emitDepth++;
  try {
    // R9: two concurrent awardXp() calls previously both read the SAME
    // `s.xp` via `getState()` then computed `nextXp = s.xp + amount`;
    // the second `apply()` clobbered the first → silently lost XP.
    // Mirror the bumpCounter fix: compute INSIDE the functional setState
    // so both reads share one snapshot.
    // There is no combo multiplier: rapid tool events used to multiply
    // outcome, achievement and challenge rewards up to x5.
    const effectiveAmount = Math.round(amount);
    if (effectiveAmount <= 0) return;
    let nextXp = 0;
    let nextLevel = 1;
    let leveledUp = false;
    let prestigeAtTime = 0;
    useVDnaStore.setState((s) => {
      nextXp = s.xp + effectiveAmount;
      leveledUp = awardingCrossesLevel(s.xp, effectiveAmount, s.prestige);
      nextLevel = computeLevel(nextXp, s.prestige).level;
      prestigeAtTime = s.prestige;
      return {
        xp: nextXp,
        lifetimeXp: s.lifetimeXp + effectiveAmount,
        level: nextLevel,
      };
    });
    const evt: XpEvent = {
      amount: effectiveAmount,
      source,
      multiplier: 1,
      comboDepth: 0,
      total: nextXp,
      at: new Date().toISOString(),
      meta,
    };
    useVDnaStore.getState().pushEvent(evt);
    notify({ kind: "xp", payload: { ...evt } });
    if (leveledUp) {
      notify({
        kind: "level-up",
        payload: { level: nextLevel, xp: nextXp, prestige: prestigeAtTime },
      });
    }
    // Wire w-xp-600 ("Earn N XP this week"): advance by the XP actually
    // awarded (not +1). Safe against the mutual advanceChallenges→awardXp
    // recursion: a challenge short-circuits once `completed`, and awardXp's
    // emitDepth circuit-breaker caps nesting.
    advanceChallenges("xp-earned", undefined, effectiveAmount);
  } finally {
    emitDepth--;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Achievement evaluation
// ──────────────────────────────────────────────────────────────────────────

function evaluateAchievements(eventName: string, meta: Record<string, unknown> | undefined) {
  const s = useVDnaStore.getState();
  const unlocked = new Set(s.unlocked);
  const newlyUnlocked: Achievement[] = [];
  for (const ach of achievements) {
    // Retired badges are never awarded again (and never revoked).
    if (ach.retired) continue;
    if (unlocked.has(ach.id)) continue;
    const rule = rules[ach.id];
    if (!rule) continue;
    if (rule(eventName, meta, s)) {
      unlocked.add(ach.id);
      newlyUnlocked.push(ach);
    }
  }
  if (newlyUnlocked.length > 0) {
    useVDnaStore.getState().setUnlocked(Array.from(unlocked));
    for (const ach of newlyUnlocked) {
      notify({ kind: "achievement", payload: { id: ach.id, title: ach.title, xp: ach.xp } });
      awardXp(ach.xp, "achievement", { achievementId: ach.id });
      // Wire w-achievements-5 ("Unlock 5 achievements"): one tick per unlock.
      advanceChallenges("achievement-unlocked", { achievementId: ach.id });
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/** Main entry point — dispatch a gamification event with optional meta. */
export function dispatch(event: GamificationEvent) {
  if (typeof window === "undefined") return;
  const name = event.name;
  // persist writes on every setState, hydrated or not. Until the profile is
  // read from storage (a bare /guest route mounts no GamificationProvider),
  // a counter bump would save the empty in-memory profile over it.
  if (!useVDnaStore.persist.hasHydrated()) return;
  // The day streak ticks on any interaction, a click on the home page
  // included: it returns at once when today is already counted, so it costs
  // nothing on the hot path. Everything else only looks at relevant events.
  if (!isRelevantEvent(name)) {
    if (emitDepth < MAX_EMIT_DEPTH && useVDnaStore.getState().lastActiveDate !== todaySeedKey()) {
      emitDepth++;
      try {
        refreshChallengesIfStale();
        touchDailyActivity();
      } finally {
        emitDepth--;
      }
    }
    return;
  }
  if (emitDepth >= MAX_EMIT_DEPTH) return;
  emitDepth++;
  try {
    refreshChallengesIfStale();
    const meta = event.meta;

    // Tool-visit bookkeeping.
    if (name === "tool-visit" && typeof meta?.toolId === "string") {
      registerToolVisit(meta.toolId);
      registerWeeklyToolVisit(meta.toolId);
    }

    const isExport =
      name === "export-png" ||
      name === "export-csv" ||
      name === "export-json" ||
      name === "export-markdown";

    // Counter bumps for tool events, outcomes and exports.
    if (name.startsWith("tool:") || name.startsWith("outcome:") || isExport) {
      useVDnaStore.getState().bumpCounter(name, 1);
    }

    // Finished work: the outcome badges' counters, and the meta the
    // synthetic `outcome` challenge trigger reads.
    let outcomeMeta: Record<string, unknown> | null = null;
    if (isWorkOutcomeEvent(name)) {
      const outcomeId = name.slice("outcome:".length);
      const toolId = outcomeToolId(outcomeId, meta);
      recordOutcomeStats(outcomeId, toolId);
      outcomeMeta = { ...meta, outcomeId, toolId };
    } else if (name === "outcome:kudos-received") {
      recordKudosDay();
    }

    // Daily activity tracking.
    touchDailyActivity();

    // Challenge advancement.
    advanceChallenges(name, meta);
    if (outcomeMeta) advanceChallenges("outcome", outcomeMeta);
    // Wire d-export ("Export anything"): utils/export.ts dispatches the
    // format-specific names (so `export-master` can count per-format), but
    // the challenge trigger is the bare `export`.
    if (isExport) advanceChallenges("export", meta);
    // Wire the mood-log day streak: `mood-streak` reads
    // counters["mood-streak-days"]. The mood tool emits per-score events
    // (tool:mood-tracker:mood-great etc.), never a bare "logged" — derive
    // the consecutive-day streak here, at most one step per local day. The
    // same once-per-day gate also bridges the d-mood / w-mood-5 challenge
    // trigger `tool:mood-tracker:logged`, so w-mood-5 ("log mood 5 DAYS
    // this week") counts days, not raw logs.
    if (name.startsWith("tool:mood-tracker:mood-")) {
      const s = useVDnaStore.getState();
      const today = localDayOrdinal();
      const lastDay = s.counters["mood-last-log-day"] ?? 0;
      if (lastDay !== today) {
        const streak = lastDay === today - 1 ? (s.counters["mood-streak-days"] ?? 0) + 1 : 1;
        setCounter("mood-last-log-day", today);
        setCounter("mood-streak-days", streak);
        advanceChallenges("tool:mood-tracker:logged", meta);
      }
    }

    // Achievement evaluation.
    evaluateAchievements(name, meta);
  } finally {
    emitDepth--;
  }
}

/** Trigger a prestige reset. */
export function prestige() {
  const s = useVDnaStore.getState();
  if (s.level < MAX_LEVEL) return false;
  useVDnaStore.getState().prestigeReset();
  notify({ kind: "prestige", payload: { prestige: s.prestige + 1 } });
  dispatch({ name: "prestige-completed" });
  return true;
}

/** Expose `window.VDna` for poking at the engine — development builds only. */
export function installWindowBridge() {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).VDna = {
    addXp: (n: number) => awardXp(n, "secret", {}),
    unlock: (id: string) => {
      const ach = getAchievement(id);
      if (!ach) return false;
      const s = useVDnaStore.getState();
      if (s.unlocked.includes(id)) return false;
      useVDnaStore.getState().setUnlocked([...s.unlocked, id]);
      notify({ kind: "achievement", payload: { id: ach.id, title: ach.title, xp: ach.xp } });
      awardXp(ach.xp, "achievement", { achievementId: ach.id });
      return true;
    },
    dispatch: (name: string, meta?: Record<string, unknown>) => dispatch({ name, meta }),
    snapshot: () => useVDnaStore.getState(),
  };
}

export { awardXp };
