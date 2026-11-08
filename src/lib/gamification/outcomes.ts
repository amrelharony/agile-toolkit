/**
 * The XP outcome table: what pays XP, how much, how often, and how a repeat
 * is recognised. Pure data and free of "use client", so the ledger, the
 * history bridge, contract tests and any server code can read it.
 *
 * XP rewards finished work, never raw input. Each row has exactly one
 * matcher:
 *   - `event`   — a gamification event name (a tool's `emit()` or a secret);
 *   - `history` — a history-log action, with an optional payload predicate;
 *   - `direct`  — called straight from the code that knows the entity id
 *                 (kudos sent and received, a story read, a first tool visit).
 *
 * Idempotency: a row's key names the thing that was finished (a risk, a
 * sprint, a kudos). A key already claimed never pays again. `once` rows
 * remember their keys forever (`onceKeys`); the rest remember them for 45
 * days (`claims`). Rows without a key (`event` rows such as a finished
 * ceremony) rely on their daily cap alone.
 */

import type { HistoryEvent } from "@/lib/history/types";

/** Outcome XP a user can earn per local day. Achievement and challenge rewards are exempt. */
export const GLOBAL_DAILY_XP_CAP = 300;

/** Days a non-`once` claim is remembered. */
export const CLAIM_RETENTION_DAYS = 45;

export type OutcomeId =
  | "retro-finished"
  | "ceremony-finished"
  | "estimate-committed"
  | "sprint-closed"
  | "risk-closed"
  | "impediment-resolved"
  | "debt-resolved"
  | "other-resolved"
  | "okr-achieved"
  | "hypothesis-decided"
  | "premortem-completed"
  | "card-done"
  | "daily-log"
  | "kudos-sent"
  | "kudos-received"
  | "story-read"
  | "first-tool"
  | "secret";

type Payload = Record<string, unknown>;

/** One history action an outcome listens to. */
export interface HistoryMatch {
  toolId: string;
  action: string;
  /** Payload predicate; the action counts only when it holds. */
  where?: (payload: Payload) => boolean;
  /** Idempotency key for the event; `h:<event id>` when absent or empty. */
  key?: (event: HistoryEvent) => string | undefined;
}

interface OutcomeBase {
  id: OutcomeId;
  /** Base XP. */
  xp: number;
  /** Extra XP read from the caller's meta (e.g. a suggested kudos). */
  bonusXp?: (meta: Payload | undefined) => number;
  /** How many of this outcome pay per local day. Absent: no per-outcome cap. */
  capPerDay?: number;
  /** True when a claimed key pays once ever rather than once per 45 days. */
  once?: boolean;
  /** Short line for the Activity inbox and the trophy case. */
  label: string;
  /**
   * The tool a `direct` outcome belongs to, for "outcomes in N tools"
   * badges. Event and history outcomes carry their tool on the meta.
   */
  tool?: string;
}

export interface EventOutcome extends OutcomeBase {
  /** Gamification event names (canonical, e.g. `tool:kanban:card-done`). */
  event: readonly string[];
  /** Idempotency key for an event; absent means the daily cap carries the load. */
  eventKey?: (name: string) => string | undefined;
  history?: never;
  direct?: never;
}

export interface HistoryOutcome extends OutcomeBase {
  history: readonly HistoryMatch[];
  event?: never;
  direct?: never;
}

export interface DirectOutcome extends OutcomeBase {
  direct: true;
  event?: never;
  history?: never;
}

export type OutcomeDef = EventOutcome | HistoryOutcome | DirectOutcome;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** `<prefix>:<payload[field]>`, or undefined when the payload lacks the id. */
function payloadKey(prefix: string, field: string) {
  return (e: HistoryEvent): string | undefined => {
    const id = str((e.payload as Payload | undefined)?.[field]);
    return id ? `${prefix}:${id}` : undefined;
  };
}

/** Local calendar day "YYYY-MM-DD" of an ISO timestamp (today when unparseable). */
export function localDateOf(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  const safe = Number.isFinite(d.getTime()) ? d : new Date();
  const y = safe.getFullYear();
  const m = String(safe.getMonth() + 1).padStart(2, "0");
  const day = String(safe.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** One daily-log outcome per tool per local day. */
function dailyKey(e: HistoryEvent): string {
  return `daily-log:${e.toolId}:${localDateOf(e.occurredAt)}`;
}

/** Secret events, each paying once ever. Keys match `SECRET_ONCE_KEYS` in vdna-migrate.ts. */
export const SECRET_EVENTS = [
  "secret:konami",
  "secret:triple-tap",
  "secret:footer-click",
  "secret:typed-agile",
  "secret:typed-scrum",
  "secret:typed-kanban",
  "secret:typed-ship",
  "logo-whispered",
] as const;

const other = (toolId: string, action: string, field: string): HistoryMatch => ({
  toolId,
  action,
  key: payloadKey(toolId, field),
});

const daily = (toolId: string, action: string): HistoryMatch => ({
  toolId,
  action,
  key: dailyKey,
});

export const OUTCOMES: readonly OutcomeDef[] = [
  {
    id: "retro-finished",
    label: "Finished a retro",
    xp: 40,
    capPerDay: 2,
    // The board logs a stable `retroId` (its sprint, else its first card);
    // older events without one fall back to the run of the board.
    history: [
      {
        toolId: "retro",
        action: "phase_advanced",
        where: (p) => p.to === "actions",
        key: (e) => {
          const p = e.payload as Payload;
          return `retro:${str(p.retroId) ?? str(p.boardId) ?? e.toolRunId}`;
        },
      },
    ],
  },
  {
    id: "ceremony-finished",
    label: "Ran a ceremony to time",
    xp: 25,
    capPerDay: 3,
    // Once per run when its last segment ends, not each segment's time-up.
    event: ["tool:ceremony-timer:complete"],
  },
  {
    id: "estimate-committed",
    label: "Committed an estimate",
    xp: 10,
    capPerDay: 10,
    // A 45-day claim, not once-ever: story ids are unique, and a busy poker
    // room would otherwise fill `onceKeys` with estimate keys.
    history: [
      {
        toolId: "planning-poker",
        action: "estimate_committed",
        key: payloadKey("estimate", "storyId"),
      },
    ],
  },
  {
    id: "sprint-closed",
    label: "Closed a sprint",
    xp: 75,
    capPerDay: 1,
    once: true,
    history: ["sprint", "velocity", "sprint-metrics"].map((toolId) => ({
      toolId,
      action: "sprint_closed",
      key: payloadKey("sprint", "sprintId"),
    })),
  },
  {
    id: "risk-closed",
    label: "Closed a risk",
    xp: 30,
    capPerDay: 5,
    once: true,
    history: [
      {
        toolId: "risk-register",
        action: "risk_updated",
        where: (p) => p.to === "closed",
        key: payloadKey("risk", "riskId"),
      },
    ],
  },
  {
    id: "impediment-resolved",
    label: "Resolved an impediment",
    xp: 30,
    capPerDay: 5,
    once: true,
    history: [
      {
        toolId: "impediments",
        action: "impediment_resolved",
        key: payloadKey("impediment", "id"),
      },
    ],
  },
  {
    id: "debt-resolved",
    label: "Paid down tech debt",
    xp: 25,
    capPerDay: 5,
    once: true,
    history: [{ toolId: "tech-debt", action: "item_resolved", key: payloadKey("debt", "itemId") }],
  },
  {
    id: "other-resolved",
    label: "Resolved an item",
    xp: 20,
    capPerDay: 6,
    history: [
      other("incident-commander", "incident_resolved", "incidentId"),
      other("vuln-burndown", "vuln_resolved", "vulnId"),
      other("a11y-tracker", "issue_resolved", "issueId"),
      other("ai-red-team", "finding_resolved", "id"),
      other("hallucination-log", "hallucination_resolved", "id"),
      other("retro-actions", "action_done", "cardId"),
    ],
  },
  {
    id: "okr-achieved",
    label: "Achieved an objective",
    xp: 50,
    capPerDay: 2,
    event: ["tool:okrs:okr-achieved"],
  },
  {
    id: "hypothesis-decided",
    label: "Decided a hypothesis",
    xp: 30,
    capPerDay: 3,
    event: ["tool:hypothesis-tracker:validated", "tool:hypothesis-tracker:invalidated"],
  },
  {
    id: "premortem-completed",
    label: "Completed a pre-mortem",
    xp: 40,
    capPerDay: 2,
    event: ["tool:premortem:completed"],
  },
  {
    id: "card-done",
    label: "Moved a card to done",
    xp: 10,
    capPerDay: 5,
    event: ["tool:kanban:card-done"],
  },
  {
    id: "daily-log",
    label: "Kept a daily log",
    xp: 5,
    history: [
      daily("standup", "entry_added"),
      daily("async-standup", "update_posted"),
      daily("mood-tracker", "mood_logged"),
      daily("burndown", "day_logged"),
      daily("burnup", "day_logged"),
      daily("sprint", "day_logged"),
      daily("okrs", "progress_updated"),
      daily("okrs", "check_in_recorded"),
    ],
  },
  {
    id: "kudos-sent",
    tool: "kudos",
    label: "Sent kudos",
    xp: 20,
    bonusXp: (meta) => (meta?.suggested === true ? 10 : 0),
    capPerDay: 4,
    direct: true,
  },
  {
    id: "kudos-received",
    tool: "kudos",
    label: "Received kudos",
    xp: 10,
    capPerDay: 5,
    direct: true,
  },
  {
    id: "story-read",
    tool: "comics",
    label: "Read a story",
    xp: 15,
    capPerDay: 2,
    once: true,
    direct: true,
  },
  {
    id: "first-tool",
    label: "Tried a new tool",
    xp: 5,
    once: true,
    direct: true,
  },
  {
    id: "secret",
    label: "Found a secret",
    xp: 100,
    once: true,
    event: SECRET_EVENTS,
    eventKey: (name) => name,
  },
];

const BY_ID = new Map<OutcomeId, OutcomeDef>(OUTCOMES.map((o) => [o.id, o]));

export function getOutcome(id: string): OutcomeDef | undefined {
  return BY_ID.get(id as OutcomeId);
}

/**
 * Outcomes that are not finished work: a first visit to a tool and a found
 * secret still pay XP, but don't count toward the outcome badges and
 * challenges ("first win", "busy day", "outcomes in 5 tools"...).
 */
export const NON_WORK_OUTCOMES: readonly OutcomeId[] = ["first-tool", "secret"];

/** True for an outcome that counts as finished work. */
export function isWorkOutcome(id: string): boolean {
  return BY_ID.has(id as OutcomeId) && !NON_WORK_OUTCOMES.includes(id as OutcomeId);
}

/** Outcomes that resolve or close something (a risk, an impediment, debt...). */
export const RESOLVED_OUTCOMES: readonly OutcomeId[] = [
  "risk-closed",
  "impediment-resolved",
  "debt-resolved",
  "other-resolved",
];

/** The tool an outcome happened in: the meta's `toolId`, else the row's own tool. */
export function outcomeToolId(id: string, meta?: Record<string, unknown>): string | undefined {
  const fromMeta = meta?.toolId;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return BY_ID.get(id as OutcomeId)?.tool;
}

/** Event name → the outcome it records. */
export const OUTCOME_EVENTS: Readonly<Record<string, OutcomeId>> = Object.freeze(
  Object.fromEntries(OUTCOMES.flatMap((o) => (o.event ?? []).map((name) => [name, o.id])))
);

/** The outcome (and its idempotency key) an event name records, if any. */
export function matchEventOutcome(name: string): { id: OutcomeId; key?: string } | null {
  const id = OUTCOME_EVENTS[name];
  if (!id) return null;
  const def = BY_ID.get(id) as EventOutcome;
  return { id, key: def.eventKey?.(name) };
}

/** The outcome a history event records, with its idempotency key, if any. */
export function matchHistoryOutcome(event: HistoryEvent): { id: OutcomeId; key: string } | null {
  for (const def of OUTCOMES) {
    if (!def.history) continue;
    for (const m of def.history) {
      if (m.toolId !== event.toolId || m.action !== event.action) continue;
      const payload = (event.payload ?? {}) as Payload;
      if (m.where && !m.where(payload)) continue;
      return { id: def.id, key: m.key?.(event) || `h:${event.id}` };
    }
  }
  return null;
}

/**
 * Literal tool events that deliberately pay no XP. Every literal
 * `emit(tool, event)` / tool `dispatch` in the app is either an outcome event
 * above or listed here (test/gamification/xp-rules-coverage.test.ts), so a new
 * emit forces a decision about its XP. Events from the `ui`, `rt` and
 * `mascot` surfaces never pay and are covered by `ZERO_XP_PREFIXES`.
 */
export const ZERO_XP_EVENTS: readonly string[] = [
  // Repeat work and steps along the way.
  "tool:burndown:day-logged",
  "tool:burndown:scope-change",
  "tool:burnup:day-logged",
  "tool:burnup:scope-increase",
  "tool:ceremony-timer:finish",
  "tool:ceremony-timer:minute-mark",
  "tool:ceremony-timer:rotate",
  "tool:ceremony-timer:start",
  "tool:ceremony-timer:ten-seconds",
  "tool:comics:completed",
  "tool:comics:retro-question",
  "tool:hypothesis-tracker:status-change",
  "tool:impediments:impediment-raised",
  "tool:impediments:impediment-resolved",
  "tool:kanban:card-add",
  "tool:kanban:card-move",
  "tool:kudos:fairness-alert",
  "tool:kudos:llm-suggested-pick",
  "tool:kudos:reaction-added",
  "tool:kudos:received",
  "tool:kudos:sent",
  "tool:nps-csat:score-detractor",
  "tool:nps-csat:score-passive",
  "tool:nps-csat:score-promoter",
  "tool:okrs:kr-updated",
  "tool:planning-poker:reveal",
  "tool:planning-poker:vote",
  "tool:premortem:cause-added",
  "tool:retro:card-add",
  "tool:retro:phase-advance",
  "tool:retro:vote",
  "tool:risk-register:risk-added",
];

/** Canonical-name prefixes of surfaces that never pay XP. */
export const ZERO_XP_PREFIXES: readonly string[] = ["ui:", "rt:", "mascot:", "toast-"];
