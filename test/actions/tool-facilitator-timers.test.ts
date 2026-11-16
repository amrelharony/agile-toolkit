/**
 * tool.facilitator_timers.* — Amr's verbs for Facilitator Timers.
 *
 *   1. registration: list_state (read), start_timer (write, no room so
 *      visitors may use it, no confirm), meeting_cost (pure read).
 *   2. list_state: the saved lengths, the timer on in this tab, the cost
 *      ticker's people and time but never its rate; over MCP the synced
 *      settings row only.
 *   3. start_timer: Pomodoro, a break (minutes or "10:45") and Crazy 8s on
 *      the docked timer; never another page's clock; a timer that's on is
 *      replaced only on `replace`; over MCP nothing starts.
 *   4. meeting_cost: people × rate × minutes, per minute and person-hours.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ value: null as unknown, keys: [] as string[] }));
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetUserStateBlob: async (_user: string, key: string) => {
      blob.keys.push(key);
      return blob.value;
    },
  };
});

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/facilitator-timers";
import { runFromParams } from "@/lib/actions/tools/facilitator-timers";
import {
  COST_INITIAL,
  FT_SETTINGS_INITIAL,
  useCostTicker,
  useFacilitatorSettings,
  useFtSession,
} from "@/lib/facilitator-timers/store";
import { countdown, useDockTimer } from "@/lib/timer/dock-timer";

const T0 = new Date(2026, 10, 12, 10, 0, 0).getTime();
const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u1",
  source,
  squadProfileIds: [] as string[],
});
const action = (name: string) => registry.get(`tool.facilitator_timers.${name}`)!;
const run = (name: string, params: unknown) =>
  action(name).handler(action(name).paramsSchema.parse(params), ctx()) as Promise<
    Record<string, unknown>
  >;
const runMcp = (name: string, params: unknown) =>
  action(name).mcpHandler!(action(name).paramsSchema.parse(params), ctx("mcp")) as Promise<
    Record<string, unknown>
  >;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  sessionStorage.clear();
  blob.value = null;
  blob.keys = [];
  useDockTimer.setState({ timer: null });
  useFtSession.setState({ run: null });
  useCostTicker.setState({ ...COST_INITIAL });
  useFacilitatorSettings.setState({ ...FT_SETTINGS_INITIAL });
});

describe("registration", () => {
  it("registers the three verbs with their flags", () => {
    expect(action("list_state")).toMatchObject({ category: "read" });
    expect(action("list_state").mcpHandler).toBeDefined();
    expect(action("start_timer")).toMatchObject({
      category: "write",
      requiresConfirmation: false,
      visitor: true,
    });
    expect(action("meeting_cost")).toMatchObject({ category: "read" });
    expect(action("meeting_cost").mcpHandler).toBeUndefined();
  });
});

describe("list_state", () => {
  it("returns the saved lengths, and no timer or ticker before any run", async () => {
    const state = await run("list_state", {});
    expect(state).toMatchObject({
      pomodoro: { workMinutes: 25, breakMinutes: 5, rounds: 4 },
      breakMinutes: 10,
      crazy8s: { rounds: 8, roundSeconds: 60 },
      chime: false,
      running: null,
      costTicker: null,
    });
  });

  it("reports the timer on and the ticker's people and time, never its rate", async () => {
    await run("start_timer", { kind: "pomodoro" });
    useCostTicker.setState({
      attendees: 6,
      hourlyRate: 75,
      currency: "EUR",
      clock: { baseMs: 0, since: T0 },
    });
    vi.setSystemTime(T0 + 90_000);
    const state = await run("list_state", {});
    expect(state.running).toMatchObject({
      kind: "pomodoro",
      step: "Focus 1 of 4",
      steps: 7,
      remainingSeconds: 1410,
      paused: false,
    });
    expect(state.costTicker).toEqual({ running: true, attendees: 6, elapsedSeconds: 90 });
    expect(JSON.stringify(state)).not.toMatch(/75|EUR|hourlyRate/);
  });

  it("reports a paused break by its clock: the time left holds and the return time moves", async () => {
    await run("start_timer", { kind: "break", minutes: 10 });
    vi.setSystemTime(T0 + 60_000);
    useDockTimer.getState().pause();
    vi.setSystemTime(T0 + 180_000);
    expect((await run("list_state", {})).running).toMatchObject({
      kind: "break",
      remainingSeconds: 540,
      paused: true,
      backAt: "10:12",
    });
  });

  it("reads the synced settings over MCP, with no tab to run anything in", async () => {
    blob.value = { pomodoro: { workMinutes: 50, breakMinutes: 10, rounds: 2 }, chime: true };
    const state = await runMcp("list_state", {});
    expect(blob.keys).toEqual(["agile-toolkit:facilitator-timers"]);
    expect(state).toMatchObject({
      pomodoro: { workMinutes: 50, breakMinutes: 10, rounds: 2 },
      chime: true,
      running: null,
      costTicker: null,
    });
    blob.value = { state: { breakMinutes: 15 }, version: 0 };
    expect(await runMcp("list_state", {})).toMatchObject({ breakMinutes: 15 });
  });
});

describe("start_timer", () => {
  it("starts a Pomodoro on the dock with the given or saved lengths", async () => {
    const out = await run("start_timer", { kind: "pomodoro", workMinutes: 50, rounds: 2 });
    expect(out).toMatchObject({
      started: true,
      kind: "pomodoro",
      steps: 3,
      firstStep: { label: "Focus 1 of 2", seconds: 3000 },
      totalSeconds: 6300,
    });
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Pomodoro · Focus 1 of 2",
      href: "/facilitator-timers",
    });
  });

  it("starts a break by minutes or by the time to be back", async () => {
    expect(await run("start_timer", { kind: "break", minutes: 15 })).toMatchObject({
      started: true,
      backAt: "10:15",
    });
    expect(
      await run("start_timer", { kind: "break", backAt: "10:45", replace: true })
    ).toMatchObject({
      started: true,
      backAt: "10:45",
      totalSeconds: 2700,
    });
    expect(
      await run("start_timer", { kind: "break", backAt: "09:00", replace: true })
    ).toMatchObject({ started: false, reason: "09:00 has passed. Enter a time later today." });
  });

  it("starts Crazy 8s", async () => {
    expect(await run("start_timer", { kind: "crazy-8s", secondsPerSketch: 45 })).toMatchObject({
      started: true,
      steps: 8,
      firstStep: { label: "Sketch 1 of 8", seconds: 45 },
    });
  });

  it("replaces a timer that's on only when asked to", async () => {
    await run("start_timer", { kind: "pomodoro" });
    expect(await run("start_timer", { kind: "crazy-8s" })).toEqual({
      started: false,
      reason: "Pomodoro is on. Pass replace: true to start another instead.",
    });
    expect(await run("start_timer", { kind: "crazy-8s", replace: true })).toMatchObject({
      started: true,
      kind: "crazy-8s",
    });
    expect(useDockTimer.getState().timer?.label).toBe("Crazy 8s · Sketch 1 of 8");
  });

  it("never takes the dock from a ceremony", async () => {
    const ceremony = { ...countdown("Retro", "/ceremony-timer", 900), endsAt: T0 + 900_000 };
    useDockTimer.setState({ timer: ceremony });
    expect(await run("start_timer", { kind: "pomodoro", replace: true })).toEqual({
      started: false,
      reason: "“Retro” holds the docked timer. Stop or finish it first.",
    });
    expect(useDockTimer.getState().timer).toBe(ceremony);
  });

  it("refuses lengths out of range and starts nothing over MCP", async () => {
    expect(
      action("start_timer").paramsSchema.safeParse({ kind: "pomodoro", rounds: 99 }).success
    ).toBe(false);
    expect(action("start_timer").paramsSchema.safeParse({ kind: "lunch" }).success).toBe(false);
    expect(await runMcp("start_timer", { kind: "pomodoro" })).toMatchObject({ started: false });
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("builds runs from the saved lengths when the params leave them out", () => {
    const built = runFromParams({ kind: "crazy-8s" }, FT_SETTINGS_INITIAL, T0);
    expect(built.ok && built.run.steps.map((s) => s.seconds)).toEqual(Array(8).fill(60));
    const brk = runFromParams({ kind: "break" }, { ...FT_SETTINGS_INITIAL, breakMinutes: 20 }, T0);
    expect(brk.ok && brk.run.backAt).toBe(T0 + 20 * 60_000);
  });
});

describe("meeting_cost", () => {
  it("works out the cost, per minute and in person-hours, storing nothing", async () => {
    const out = await run("meeting_cost", {
      attendees: 6,
      hourlyRate: 60,
      minutes: 45,
      currency: "EUR",
    });
    expect(out).toEqual({
      cost: 270,
      perMinute: 6,
      personHours: 4.5,
      text: "6 people for 45 min: €270.00 (€6.00 a minute, 4.5 person-hours).",
    });
    expect(useCostTicker.getState()).toMatchObject(COST_INITIAL);
    expect(JSON.stringify(useFacilitatorSettings.getState())).not.toContain("270");
    expect(
      action("meeting_cost").paramsSchema.safeParse({ attendees: 0, hourlyRate: 10, minutes: 5 })
        .success
    ).toBe(false);
  });
});
