"use client";

import { useVDnaStore } from "@/lib/stores/vdna-store";
import { achievements, getAchievement } from "./achievements";
import {
  findDaily,
  findWeekly,
  pickDailies,
  pickWeeklies,
  todaySeedKey,
  weekSeedKey,
} from "./challenges";
import { awardingCrossesLevel, computeLevel, MAX_LEVEL } from "./xp-curve";
import type { Achievement, GamificationEvent, XpEvent, XpSource } from "./types";

// ──────────────────────────────────────────────────────────────────────────
// Combo timer
// ──────────────────────────────────────────────────────────────────────────

const COMBO_WINDOW_MS = 3000;
const COMBO_MULTIPLIERS = [1, 1.5, 2, 3, 5]; // index = depth (capped)

interface ComboState {
  depth: number;
  lastTs: number;
  multiplier: number;
}

const combo: ComboState = { depth: 0, lastTs: 0, multiplier: 1 };

function bumpCombo(now: number): ComboState {
  if (now - combo.lastTs > COMBO_WINDOW_MS) {
    combo.depth = 1;
  } else {
    combo.depth = Math.min(combo.depth + 1, COMBO_MULTIPLIERS.length - 1);
  }
  combo.lastTs = now;
  combo.multiplier = COMBO_MULTIPLIERS[Math.min(combo.depth, COMBO_MULTIPLIERS.length - 1)];
  return { ...combo };
}

export function getCombo(): Readonly<ComboState> {
  if (Date.now() - combo.lastTs > COMBO_WINDOW_MS) {
    combo.depth = 0;
    combo.multiplier = 1;
  }
  return combo;
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
  kind: "xp" | "level-up" | "achievement" | "challenge-complete" | "combo-peak" | "prestige";
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
 * unlock NOW.  Rules are evaluated only for still-locked achievements.
 */
type Rule = (
  eventName: string,
  meta: Record<string, unknown> | undefined,
  state: ReturnType<typeof useVDnaStore.getState>
) => boolean;

const rules: Partial<Record<string, Rule>> = {
  "first-click": (evt) => evt === "click",
  "tool-hop-5": (_e, _m, s) => s.toolsVisited.length >= 5,
  "tool-hop-20": (_e, _m, s) => s.toolsVisited.length >= 20,
  "tool-hop-42": (_e, _m, s) => s.toolsVisited.length >= 42,
  "scroll-floor": (evt) => evt === "scroll-floor",
  "hover-hundred": (_e, _m, s) => (s.counters["hover-total"] ?? 0) >= 100,
  "night-owl": () => {
    const h = new Date().getHours();
    return h >= 0 && h < 5;
  },
  "early-bird": () => {
    const h = new Date().getHours();
    return h < 6;
  },
  "poker-voter": (_e, _m, s) => (s.counters["tool:planning-poker:vote"] ?? 0) >= 10,
  "poker-reveal": (evt) => evt === "tool:planning-poker:reveal",
  "retro-one": (evt) => evt === "tool:retro:card-add",
  "retro-fifty": (_e, _m, s) => (s.counters["tool:retro:card-add"] ?? 0) >= 50,
  "retro-all-formats": (_e, _m, s) => (s.counters["retro-formats-used"] ?? 0) >= 3,
  "kanban-ten": (_e, _m, s) => (s.counters["tool:kanban:card-move"] ?? 0) >= 10,
  "kanban-done-ten": (_e, _m, s) => (s.counters["tool:kanban:card-done"] ?? 0) >= 10,
  "ceremony-finish": (evt) => evt === "tool:ceremony-timer:finish",
  "burndown-full": (_e, _m, s) => (s.counters["tool:burndown:day-logged"] ?? 0) >= 10,
  "velocity-five": (_e, _m, s) => (s.counters["tool:velocity:sprint-added"] ?? 0) >= 5,
  "risk-closer": (_e, _m, s) => (s.counters["tool:risk-register:close"] ?? 0) >= 5,
  "impediments-clear": (_e, _m, s) =>
    (s.counters["tool:impediments:impediment-resolved"] ?? 0) >= 10,
  "okr-complete": (evt) => evt === "tool:okrs:okr-achieved",
  "debt-paydown": (_e, _m, s) => (s.counters["tool:tech-debt:debt-resolved"] ?? 0) >= 5,
  "adr-writer": (_e, _m, s) => (s.counters["tool:decision-log:adr-new"] ?? 0) >= 5,
  "mood-streak": (_e, _m, s) => (s.counters["mood-streak-days"] ?? 0) >= 7,
  "room-join": (evt) => evt === "room-joined",
  "room-host": (evt) => evt === "invite-created",
  "sync-first": (evt) => evt === "rt:sync-remote",
  "party-of-four": (_e, m) => typeof m?.memberCount === "number" && m.memberCount >= 4,
  "workspace-share": (evt) => evt === "workspace-push",
  // depth→multiplier: COMBO_MULTIPLIERS[depth] = [1, 1.5, 2, 3, 5]. "On A
  // Roll" promises a x3 combo (depth 3); "Unstoppable" a x5 combo (depth 4).
  "combo-3": (_e, m) => typeof m?.comboDepth === "number" && m.comboDepth >= 3,
  "combo-5": (_e, m) => typeof m?.comboDepth === "number" && m.comboDepth >= 4,
  "marathon-30": (_e, _m, s) => (s.counters["session-minutes"] ?? 0) >= 30,
  "marathon-60": (_e, _m, s) => (s.counters["session-minutes"] ?? 0) >= 60,
  "daily-three": (_e, _m, s) =>
    s.dailyChallenges.length > 0 && s.dailyChallenges.every((c) => c.completed),
  "weekly-sweep": (_e, _m, s) =>
    s.weeklyChallenges.length > 0 && s.weeklyChallenges.every((c) => c.completed),
  "sprint-complete": (evt) => evt === "sprint-completed",
  "release-forecast": (evt) => evt === "tool:release-planner:simulate",
  "dependency-free": (_e, m) => evtFlag(m, "zeroCycles"),
  "flow-efficient": (_e, m) => typeof m?.flowEfficiency === "number" && m.flowEfficiency >= 0.4,
  "wip-disciplined": () => false, // advanced rule; can be wired later
  "hypothesis-valid": (evt) => evt === "tool:hypothesis-tracker:validated",
  "hypothesis-invalid": (evt) => evt === "tool:hypothesis-tracker:invalidated",
  "interview-ten": (_e, _m, s) => (s.counters["tool:user-interviews:interview-new"] ?? 0) >= 10,
  "opportunity-deep": (_e, m) => typeof m?.depth === "number" && m.depth >= 4,
  "premortem-complete": (evt) => evt === "tool:premortem:completed",
  "streak-3": (_e, _m, s) => s.streak >= 3,
  "streak-7": (_e, _m, s) => s.streak >= 7,
  "streak-30": (_e, _m, s) => s.streak >= 30,
  "streak-100": (_e, _m, s) => s.streak >= 100,
  "audio-on": (evt) => evt === "sonification-on",
  "audio-modes": (_e, _m, s) => (s.counters["audio-modes-used"] ?? 0) >= 3,
  "theme-toggle": (evt) => evt === "theme-toggle",
  "workspace-import": (evt) => evt === "workspace-import",
  "prompt-copier": (evt) => evt === "prompt-copied",
  "export-master": (_e, _m, s) =>
    (s.counters["export-png"] ?? 0) > 0 &&
    (s.counters["export-csv"] ?? 0) > 0 &&
    (s.counters["export-json"] ?? 0) > 0,
  "reduce-motion": (evt) => evt === "reduce-motion-on",
  "level-ten": (_e, _m, s) => s.level >= 10,
  konami: (evt) => evt === "secret:konami",
  // secrets.ts dispatches `logo-whispered` exactly when the hover count
  // reaches 10. The old rule read counters["logo-hover"], which dispatch()
  // never bumps (only tool:* / click / hover / export-* events bump
  // counters), so it could never unlock.
  "logo-whisperer": (evt) => evt === "logo-whispered",
  "triple-tap": (evt) => evt === "secret:triple-tap",
  "footer-click": (evt) => evt === "secret:footer-click",
  "type-agile": (evt) => evt === "secret:typed-agile",
  "type-scrum": (evt) => evt === "secret:typed-scrum",
  "silent-run": (_e, _m, s) => s.silentMode && (s.counters["session-minutes-silent"] ?? 0) >= 10,
  "midnight-commit": () => {
    const d = new Date();
    return d.getHours() === 0 && d.getMinutes() === 0;
  },
  "prestige-one": (_e, _m, s) => s.prestige >= 1,
  // ─── Recognition (Phase 2 kudos redesign) ────────────────────────────
  // Counters are bumped by the `tool:kudos:*` events forwarded from
  // emit(). `kudos-combo-5` reads `meta.comboDepth` (injected from the live
  // combo state in dispatch); `tool:kudos:sent` is a combo event, so rapid
  // sends inside the 3 s window build depth to the x5 cap (4) and unlock it.
  // The multi-recipient gate lives in the dispatch site that emits
  // `tool:kudos:squad-complete`.
  "generous-spirit-25": (_e, _m, s) => (s.counters["tool:kudos:sent"] ?? 0) >= 25,
  "receiver-10": (_e, _m, s) => (s.counters["tool:kudos:received"] ?? 0) >= 10,
  "squad-booster-all": (evt) => evt === "tool:kudos:squad-complete",
  "fair-witness": (evt, m) => evt === "tool:kudos:llm-suggested-pick" && Boolean(m?.suggested),
  "kudos-combo-5": (evt, m) =>
    evt === "tool:kudos:sent" && typeof m?.comboDepth === "number" && m.comboDepth >= 4,
};

function evtFlag(meta: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(meta?.[key]);
}

// ──────────────────────────────────────────────────────────────────────────
// XP source mapping for event names
// ──────────────────────────────────────────────────────────────────────────

function xpForEvent(name: string): { amount: number; source: XpSource } {
  if (name === "click") return { amount: 1, source: "click" };
  if (name === "hover") return { amount: 0.2, source: "hover" };
  if (name === "focus") return { amount: 0.5, source: "focus" };
  if (name === "key") return { amount: 1, source: "key" };
  if (name === "scroll-floor") return { amount: 5, source: "scroll" };
  if (name === "tool-visit") return { amount: 5, source: "tool-visit" };
  if (name === "theme-toggle") return { amount: 10, source: "theme-toggle" };
  if (name === "sonification-on") return { amount: 10, source: "sonification-toggle" };
  if (name === "workspace-push") return { amount: 10, source: "entity-added" };
  if (name === "export") return { amount: 5, source: "click" };
  if (name === "prompt-copied") return { amount: 10, source: "click" };
  if (name.startsWith("secret:")) return { amount: 100, source: "secret" };
  // Kudos redesign Phase 2 — recognition events have higher XP than
  // ordinary entity adds because they are social signals. Receive is
  // attributed to the viewer (signal-bridge fires the signal-side
  // kudos.received only when toProfileId matches the local viewer).
  // `llm-suggested-pick` rewards using the fairness recommendation
  // (Phase 3 wires the emit site).
  if (name === "tool:kudos:sent") return { amount: 25, source: "entity-added" };
  if (name === "tool:kudos:received") return { amount: 15, source: "entity-resolved" };
  if (name === "tool:kudos:reaction-added") return { amount: 5, source: "entity-added" };
  if (name === "tool:kudos:thread-reply") return { amount: 10, source: "entity-added" };
  if (name === "tool:kudos:llm-suggested-pick") return { amount: 30, source: "entity-added" };
  if (name.startsWith("tool:")) {
    // Tool-specific events: most are entity creation or state transitions.
    if (name.endsWith(":finish") || name.endsWith(":achieved"))
      return { amount: 50, source: "tool-completed" };
    if (name.endsWith(":resolved") || name.endsWith(":completed"))
      return { amount: 30, source: "entity-resolved" };
    return { amount: 5, source: "entity-added" };
  }
  return { amount: 1, source: "click" };
}

// ──────────────────────────────────────────────────────────────────────────
// Daily / weekly challenge advancement
// ──────────────────────────────────────────────────────────────────────────

function refreshChallengesIfStale() {
  const s = useVDnaStore.getState();
  const dayKey = todaySeedKey();
  const weekKey = weekSeedKey();
  let daily = s.dailyChallenges;
  let weekly = s.weeklyChallenges;
  let changed = false;
  if (daily.length === 0 || daily[0].seedDate !== dayKey) {
    daily = pickDailies();
    changed = true;
  }
  if (weekly.length === 0 || weekly[0].seedDate !== weekKey) {
    weekly = pickWeeklies();
    changed = true;
  }
  if (changed) {
    useVDnaStore.getState().setDailyChallenges(daily);
    useVDnaStore.getState().setWeeklyChallenges(weekly);
  }
}

function advanceChallenges(eventName: string, meta: Record<string, unknown> | undefined) {
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
      const newProgress = Math.min(c.goal, c.progress + 1);
      const justCompleted = newProgress >= c.goal && !c.completed;
      if (newProgress !== c.progress) mutated = true;
      return {
        ...c,
        progress: newProgress,
        completed: justCompleted ? true : c.completed,
        completedAt: justCompleted ? new Date().toISOString() : c.completedAt,
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
}

function registerToolVisit(toolId: string) {
  const s = useVDnaStore.getState();
  if (s.toolsVisited.includes(toolId)) return;
  useVDnaStore.getState().setToolsVisited([...s.toolsVisited, toolId]);
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
    const combos = getCombo();
    const effectiveAmount = Math.round(amount * combos.multiplier);
    // BUG-L6: a 0.2-XP hover event rounds to 0 at combo multiplier 1.
    // The legacy code still pushed a {amount: 0} XpEvent into the
    // events ring AND scheduled a Supabase profile sync AND fired the
    // OPFS-disk-write subscriber. Over a long session that's thousands
    // of useless writes per hour. Bail at 0 instead.
    if (effectiveAmount === 0) return;
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
      multiplier: combos.multiplier,
      comboDepth: combos.depth,
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
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/** Main entry point — dispatch a gamification event with optional meta. */
export function dispatch(event: GamificationEvent) {
  if (typeof window === "undefined") return;
  if (emitDepth >= MAX_EMIT_DEPTH) return;
  emitDepth++;
  try {
    refreshChallengesIfStale();
    const name = event.name;
    const meta = event.meta;

    // Tool-visit bookkeeping.
    if (name === "tool-visit" && typeof meta?.toolId === "string") {
      registerToolVisit(meta.toolId);
    }

    // Counter bumps for any tool:* or named event.
    if (
      name.startsWith("tool:") ||
      name === "click" ||
      name === "hover" ||
      name === "export-png" ||
      name === "export-csv" ||
      name === "export-json"
    ) {
      useVDnaStore.getState().bumpCounter(name, 1);
    }

    // R9: previously the `session-minute` event dispatched by
    // event-bridge.ts every 60s was never bumping any counter, leaving
    // the `marathon-30` / `marathon-60` / `silent-run` achievements
    // unreachable. Bump the plural-form counter so the achievement
    // thresholds (defined in plural) match. Silent variant is only
    // bumped when silentMode is on.
    if (name === "session-minute") {
      useVDnaStore.getState().bumpCounter("session-minutes", 1);
      if (useVDnaStore.getState().silentMode) {
        useVDnaStore.getState().bumpCounter("session-minutes-silent", 1);
      }
    }

    // Combo tick (only bump for "active" events, not passive hovers).
    // The combo-peak notification should only fire on the *transition* to max
    // multiplier, not on every subsequent event while the combo is sustained.
    // Otherwise a spam of rapid clicks produces a spam of peak toasts.
    const now = Date.now();
    if (name === "click" || name.startsWith("tool:") || name === "key") {
      const prevMultiplier = combo.multiplier;
      const c = bumpCombo(now);
      if (c.multiplier === 5 && prevMultiplier < 5) {
        notify({ kind: "combo-peak", payload: { depth: c.depth, multiplier: c.multiplier } });
      }
    }

    // Daily activity tracking.
    touchDailyActivity();

    // XP award.
    const { amount, source } = xpForEvent(name);
    if (amount > 0) awardXp(amount, source, safeMeta(meta));

    // Challenge advancement.
    advanceChallenges(name, meta);

    // Achievement evaluation. Inject the LIVE combo depth: the combo-based
    // rules (combo-3 / combo-5 / kudos-combo-5) read `meta.comboDepth`, but
    // the depth lives in the module-level combo state and is never present
    // on the raw event meta — so without this those achievements could never
    // unlock. getCombo() returns the depth just bumped above (or 0 if the
    // combo window has lapsed for a non-combo event).
    evaluateAchievements(name, { ...meta, comboDepth: getCombo().depth });
  } finally {
    emitDepth--;
  }
}

function safeMeta(
  m: Record<string, unknown> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!m) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
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

/** Expose to window for secret commands. */
export function installWindowBridge() {
  if (typeof window === "undefined") return;
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
