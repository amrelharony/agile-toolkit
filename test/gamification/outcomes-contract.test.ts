import { describe, expect, it } from "vitest";
import * as ACTIONS from "@/lib/history/event-actions";
import {
  OUTCOMES,
  OUTCOME_EVENTS,
  SECRET_EVENTS,
  matchEventOutcome,
  matchHistoryOutcome,
} from "@/lib/gamification/outcomes";
import { SECRET_ONCE_KEYS } from "@/lib/gamification/vdna-migrate";
import type { HistoryEvent } from "@/lib/history/types";
import { hasLiteral, scanEmissions } from "./emit-scan";

/**
 * The outcome table's shape: one matcher per row, no event or history
 * action claimed twice, every event matcher backed by a real emitter and
 * every history matcher by a real catalog action.
 */

const emitted = new Set(scanEmissions().map((e) => e.name));

/** Every action string in the history catalog (`*_ACTIONS` objects). */
const catalogActions = new Set(
  (Object.values(ACTIONS) as unknown[])
    .filter((v): v is Record<string, string> => !!v && typeof v === "object" && !Array.isArray(v))
    .flatMap((o) => Object.values(o))
    .filter((v): v is string => typeof v === "string")
);

/** The history catalog each tool logs from (its `useHistoryLogger` actions). */
const TOOL_CATALOGS: Record<string, Readonly<Record<string, string>>> = {
  retro: ACTIONS.RETRO_ACTIONS,
  "planning-poker": ACTIONS.PLANNING_POKER_ACTIONS,
  sprint: ACTIONS.SPRINT_COCKPIT_ACTIONS,
  velocity: ACTIONS.VELOCITY_ACTIONS,
  "sprint-metrics": ACTIONS.SPRINT_METRICS_ACTIONS,
  "risk-register": ACTIONS.RISK_ACTIONS,
  impediments: ACTIONS.IMPEDIMENT_ACTIONS,
  "tech-debt": ACTIONS.TECH_DEBT_ACTIONS,
  "incident-commander": ACTIONS.INCIDENT_ACTIONS,
  "vuln-burndown": ACTIONS.VULN_ACTIONS,
  "a11y-tracker": ACTIONS.A11Y_ACTIONS,
  "ai-red-team": ACTIONS.AI_RED_TEAM_ACTIONS,
  "hallucination-log": ACTIONS.HALLUCINATION_ACTIONS,
  "retro-actions": ACTIONS.RETRO_ACTIONS_ACTIONS,
  standup: ACTIONS.STANDUP_ACTIONS,
  "async-standup": ACTIONS.ASYNC_STANDUP_ACTIONS,
  "mood-tracker": ACTIONS.MOOD_ACTIONS,
  burndown: ACTIONS.BURNDOWN_ACTIONS,
  burnup: ACTIONS.BURNUP_ACTIONS,
  okrs: ACTIONS.OKR_ACTIONS,
};

function historyEvent(patch: Partial<HistoryEvent>): HistoryEvent {
  return {
    id: "ev1",
    clientEventId: "ev1",
    clientId: "c",
    toolRunId: "run-7",
    userId: null,
    toolId: "retro",
    action: "card_added",
    payload: {},
    isMilestone: false,
    occurredAt: new Date(2026, 10, 8, 10, 0).toISOString(),
    syncedAt: null,
    ...patch,
  };
}

describe("outcome table", () => {
  it("has unique ids and exactly one matcher per row", () => {
    const ids = OUTCOMES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of OUTCOMES) {
      const kinds = [o.event, o.history, o.direct].filter((m) => m !== undefined);
      expect(kinds, o.id).toHaveLength(1);
      expect(o.xp, o.id).toBeGreaterThan(0);
    }
  });

  it("never claims an event name or a history action in two rows", () => {
    const events = OUTCOMES.flatMap((o) => o.event ?? []);
    expect(new Set(events).size).toBe(events.length);
    const pairs = OUTCOMES.flatMap((o) => (o.history ?? []).map((m) => `${m.toolId}:${m.action}`));
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("doesn't match one piece of work through both an event and a history row", () => {
    // A tool whose finish is read from history must not also pay on its emit.
    const historyTools = new Set(OUTCOMES.flatMap((o) => (o.history ?? []).map((m) => m.toolId)));
    for (const name of Object.keys(OUTCOME_EVENTS)) {
      const tool = name.split(":")[1];
      if (!name.startsWith("tool:")) continue;
      // okrs pays daily-log from history and okr-achieved from its event:
      // different work, different rows.
      if (tool === "okrs") continue;
      expect(historyTools.has(tool), name).toBe(false);
    }
  });

  it("backs every event matcher with a literal emitter", () => {
    for (const name of Object.keys(OUTCOME_EVENTS)) {
      expect(emitted.has(name) || hasLiteral(name), name).toBe(true);
    }
  });

  it("backs every history matcher with an action from the history catalog", () => {
    for (const o of OUTCOMES) {
      for (const m of o.history ?? []) expect(catalogActions.has(m.action), m.action).toBe(true);
    }
  });

  it("takes every history action from that tool's own catalog", () => {
    // An action string living in some other tool's catalog never matches:
    // the async standup logs `update_posted`, not the sync page's `entry_added`.
    for (const o of OUTCOMES) {
      for (const m of o.history ?? []) {
        const pair = `${m.toolId}:${m.action}`;
        const catalog = TOOL_CATALOGS[m.toolId];
        expect(catalog, `no catalog mapped for ${m.toolId}`).toBeDefined();
        expect(Object.values(catalog ?? {}), pair).toContain(m.action);
      }
    }
  });

  it("pays every secret, keyed like the v1 migration's seeded onceKeys", () => {
    for (const key of Object.values(SECRET_ONCE_KEYS)) {
      expect(SECRET_EVENTS).toContain(key);
      expect(matchEventOutcome(key)).toEqual({ id: "secret", key });
    }
  });

  it("gives keyless event outcomes no idempotency key (the daily cap carries them)", () => {
    expect(matchEventOutcome("tool:kanban:card-done")).toEqual({ id: "card-done", key: undefined });
    expect(matchEventOutcome("tool:retro:card-add")).toBeNull();
    // A ceremony pays when its run ends, not on each segment's time-up.
    expect(matchEventOutcome("tool:ceremony-timer:complete")?.id).toBe("ceremony-finished");
    expect(matchEventOutcome("tool:ceremony-timer:finish")).toBeNull();
  });
});

describe("matchHistoryOutcome", () => {
  it.each([
    [
      "a retro reaching Actions, keyed by its run",
      { toolId: "retro", action: "phase_advanced", payload: { from: "discuss", to: "actions" } },
      { id: "retro-finished", key: "retro:run-7" },
    ],
    [
      "a retro board id when the payload has one",
      { toolId: "retro", action: "phase_advanced", payload: { to: "actions", boardId: "b1" } },
      { id: "retro-finished", key: "retro:b1" },
    ],
    [
      "a retro by the stable id the board logs",
      {
        toolId: "retro",
        action: "phase_advanced",
        payload: { from: "discuss", to: "actions", retroId: "sprint:sp4", boardId: "b1" },
      },
      { id: "retro-finished", key: "retro:sprint:sp4" },
    ],
    [
      "an estimate by story",
      { toolId: "planning-poker", action: "estimate_committed", payload: { storyId: "s1" } },
      { id: "estimate-committed", key: "estimate:s1" },
    ],
    [
      "a sprint closed in the cockpit",
      { toolId: "sprint", action: "sprint_closed", payload: { sprintId: "sp1" } },
      { id: "sprint-closed", key: "sprint:sp1" },
    ],
    [
      "the same sprint closed in velocity",
      { toolId: "velocity", action: "sprint_closed", payload: { sprintId: "sp1" } },
      { id: "sprint-closed", key: "sprint:sp1" },
    ],
    [
      "a closed risk",
      { toolId: "risk-register", action: "risk_updated", payload: { riskId: "r1", to: "closed" } },
      { id: "risk-closed", key: "risk:r1" },
    ],
    [
      "a resolved impediment",
      { toolId: "impediments", action: "impediment_resolved", payload: { id: "i1" } },
      { id: "impediment-resolved", key: "impediment:i1" },
    ],
    [
      "resolved tech debt",
      { toolId: "tech-debt", action: "item_resolved", payload: { itemId: "d1" } },
      { id: "debt-resolved", key: "debt:d1" },
    ],
    [
      "a resolved incident",
      { toolId: "incident-commander", action: "incident_resolved", payload: { incidentId: "x" } },
      { id: "other-resolved", key: "incident-commander:x" },
    ],
    [
      "a retro action done",
      { toolId: "retro-actions", action: "action_done", payload: { cardId: "c9" } },
      { id: "other-resolved", key: "retro-actions:c9" },
    ],
    [
      "a standup entry, once per tool per day",
      { toolId: "standup", action: "entry_added", payload: {} },
      { id: "daily-log", key: "daily-log:standup:2026-11-08" },
    ],
    [
      "an async standup update, once per day",
      { toolId: "async-standup", action: "update_posted", payload: {} },
      { id: "daily-log", key: "daily-log:async-standup:2026-11-08" },
    ],
    [
      "a burndown day logged in the Sprint Cockpit",
      { toolId: "sprint", action: "day_logged", payload: { sprintId: "sp1", day: 3 } },
      { id: "daily-log", key: "daily-log:sprint:2026-11-08" },
    ],
    [
      "an OKR check-in, once per tool per day",
      { toolId: "okrs", action: "check_in_recorded", payload: {} },
      { id: "daily-log", key: "daily-log:okrs:2026-11-08" },
    ],
  ] as const)("%s", (_label, patch, expected) => {
    expect(matchHistoryOutcome(historyEvent(patch))).toEqual(expected);
  });

  it.each([
    [
      "a retro moving to Vote",
      { toolId: "retro", action: "phase_advanced", payload: { to: "vote" } },
    ],
    [
      "a risk moved to mitigating",
      {
        toolId: "risk-register",
        action: "risk_updated",
        payload: { riskId: "r", to: "mitigating" },
      },
    ],
    ["a poker vote", { toolId: "planning-poker", action: "vote_cast", payload: {} }],
    ["a retro card", { toolId: "retro", action: "card_added", payload: {} }],
  ] as const)("ignores %s", (_label, patch) => {
    expect(matchHistoryOutcome(historyEvent(patch))).toBeNull();
  });
});
