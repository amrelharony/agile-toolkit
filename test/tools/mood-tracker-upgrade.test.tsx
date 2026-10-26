import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { MOOD_TRACKER_ID, type MoodEntry, type MoodPulse } from "@/lib/stores/workspace-types";
import { questionnaireProblem } from "@/lib/realtime/vote-room/protocol";
import {
  LOW_MOOD,
  LOW_MOOD_DAYS,
  MOOD_VOTE_SCALE,
  checkPulseCounts,
  dailyMood,
  lastDays,
  lowMoodStreak,
  moodDuring,
  moodMode,
  moodQuestionnaire,
  moodSummary,
  pulseCountsFromResult,
  savedStreakFor,
  streakKey,
  streakLinks,
  teamLevelDays,
  upsertCheckIn,
  withStreakLinks,
} from "@/lib/team/mood";
import { registry } from "@/lib/actions/registry";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";

/**
 * Mood Tracker, upgraded: one average everywhere (the page, its agent
 * actions, the retro and Sprint Comparison), "—" instead of 0.00 when
 * there is nothing to average, check-ins by name for any past day (never a
 * future one) or anonymous team pulses only, pulses from the vote-room kit
 * as counts, no stored placeholder rows, Undo on every delete, the
 * statistics behind their minimums, a low-mood streak raised at the retro
 * without naming anyone, and an example that is a read-only preview.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/app/(tools)/mood-tracker/charts", () => ({ DailyMoodChart: () => null }));

import { MoodTrackerClient } from "@/app/(tools)/mood-tracker/mood-tracker-client";
import { buildExample } from "@/app/(tools)/mood-tracker/example";
import { toMarkdown } from "@/app/(tools)/mood-tracker/markdown";
import { moodVerdict } from "@/app/(tools)/mood-tracker/verdict";
import { validateCheckIn, validateMember } from "@/app/(tools)/mood-tracker/check-in";
import { moodPromptData } from "@/app/(tools)/mood-tracker/prompt-data";
import "@/lib/actions/tools/mood-tracker";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-26";
const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const entry = (
  id: string,
  memberId: string,
  date: string,
  score: MoodEntry["score"],
  over: Partial<MoodEntry> = {}
): MoodEntry => ({
  id,
  memberId,
  date,
  score,
  ...over,
});
const pulse = (id: string, date: string, counts: Partial<MoodPulse["counts"]>): MoodPulse => ({
  id,
  date,
  counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...counts },
  source: "facilitator",
  createdAt: `${date}T09:00:00.000Z`,
});

/** The example's pulses as the team's own (no example ids). */
const ownPulses = () =>
  buildExample(new Date(2026, 9, 26)).map((p, i) => ({ ...p, id: `moodPulse_${i}` }));

const renderPage = () =>
  render(
    <TooltipProvider>
      <MoodTrackerClient />
    </TooltipProvider>
  );

function undo(label: string | RegExp) {
  const call = [...toastSpy.mock.calls]
    .reverse()
    .find(([l]) => (typeof label === "string" ? l === label : label.test(String(l))));
  if (!call) throw new Error(`no toast ${label}`);
  act(() => (call[1] as { action: { onClick: () => void } }).action.onClick());
}

const average = () => screen.getByText("14-day average").parentElement!.parentElement!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({
    teamMembers: [],
    moodEntries: [],
    moodPulses: [],
    moodTrackerDocs: [],
    retroBoards: [],
  });
});
afterEach(() => vi.useRealTimers());

/* ── The library ────────────────────────────────────────────────────── */

describe("mood, one number everywhere", () => {
  it("counts pulse answers as check-ins; `anonymous` only when there are some", () => {
    const entries = [entry("a", "m1", "2026-10-20", 4), entry("b", "m2", "2026-10-21", 2)];
    expect(moodDuring(entries, "2026-10-19", "2026-10-25")).toEqual({
      average: null,
      checkIns: 2,
      people: 2,
    });
    expect(
      moodDuring(entries, "2026-10-19", "2026-10-25", [pulse("p", "2026-10-22", { 5: 1, 3: 1 })])
    ).toEqual({
      average: 3.5,
      checkIns: 4,
      people: 2,
      anonymous: 2,
    });
  });

  it("the summary has no average below 3 check-ins, never a 0", () => {
    const empty = moodSummary([], [], "2026-10-13", TODAY);
    expect(empty).toMatchObject({ average: null, checkIns: 0, days: 0 });
    const s = moodSummary(
      [
        entry("a", "m1", "2026-10-20", 4),
        entry("p", "m1", "2026-10-21", 3, { isPlaceholder: true }),
      ],
      [pulse("q", "2026-10-22", { 1: 1, 5: 2 })],
      "2026-10-13",
      TODAY
    );
    expect(s).toMatchObject({
      average: 3.8,
      checkIns: 4,
      days: 2,
      distribution: { 1: 1, 4: 1, 5: 2 },
    });
  });

  it("averages each day over everyone who checked in", () => {
    const d = dailyMood(
      [entry("a", "m1", "2026-10-20", 4)],
      [pulse("q", "2026-10-20", { 2: 2 })],
      ["2026-10-20", "2026-10-21"]
    );
    expect(d).toEqual([
      { date: "2026-10-20", average: 8 / 3, n: 3 },
      { date: "2026-10-21", average: null, n: 0 },
    ]);
  });

  it("finds the team's current low run, skipping empty and thin days, never per person", () => {
    expect([LOW_MOOD, LOW_MOOD_DAYS]).toEqual([2.5, 3]);
    const streak = lowMoodStreak([], ownPulses(), TODAY)!;
    expect(streak).toEqual({
      start: "2026-10-24",
      end: TODAY,
      runStart: "2026-10-24",
      days: 3,
      average: 2.1,
      checkIns: 17,
    });
    // A day with only two check-ins doesn't count, either way.
    const thin = lowMoodStreak([], [...ownPulses(), pulse("x", "2026-10-23", { 5: 2 })], TODAY);
    expect(thin?.days).toBe(3);
    // A good latest day ends the run.
    const ended = lowMoodStreak([], [...ownPulses(), pulse("y", TODAY, { 5: 6 })], TODAY);
    expect(ended).toBeNull();
    // Below the minimum number of low days, no streak.
    expect(lowMoodStreak([], ownPulses().slice(-2), TODAY)).toBeNull();
  });

  it("keeps one check-in per person per day, stamping a backfilled one", () => {
    const first = upsertCheckIn(
      [],
      { memberId: "m1", date: "2026-10-24", score: 2, note: "  tired " },
      {
        id: "mood_a",
        today: TODAY,
        now: "2026-10-26T10:00:00.000Z",
      }
    );
    expect(first.entry).toEqual({
      id: "mood_a",
      memberId: "m1",
      date: "2026-10-24",
      score: 2,
      note: "tired",
      loggedAt: "2026-10-26T10:00:00.000Z",
    });
    const second = upsertCheckIn(
      first.entries,
      { memberId: "m1", date: "2026-10-24", score: 4 },
      {
        id: "mood_b",
        today: TODAY,
        now: "2026-10-26T10:05:00.000Z",
      }
    );
    expect(second.entries).toHaveLength(1);
    expect(second.entry.id).toBe("mood_a");
    expect(second.replaced?.score).toBe(2);
  });

  it("the questionnaire is one question on five faces; a withheld round keeps no pulse", () => {
    expect(questionnaireProblem(moodQuestionnaire())).toBeNull();
    expect(MOOD_VOTE_SCALE.points.map((p) => p.label)).toEqual([
      "Rough",
      "Low",
      "Neutral",
      "Good",
      "Great",
    ]);
    expect(
      pulseCountsFromResult({
        scale: MOOD_VOTE_SCALE,
        questions: [{ id: "mood", text: "", responses: 3, distribution: [0, 1, 0, 2, 0] }],
      })
    ).toEqual({ 1: 0, 2: 1, 3: 0, 4: 2, 5: 0 });
    expect(
      pulseCountsFromResult({
        scale: MOOD_VOTE_SCALE,
        questions: [{ id: "mood", text: "", responses: 2, distribution: null }],
      })
    ).toBeNull();
    expect(checkPulseCounts({ 4: 2 })).toMatchObject({ ok: false });
    expect(checkPulseCounts({ 4: 2, 2: 1.5 })).toMatchObject({ ok: false });
    expect(checkPulseCounts({ 4: 2, 2: 1 })).toMatchObject({ ok: true, total: 3 });
  });

  it("works with no settings saved as before (by name), and records streak links", () => {
    expect(moodMode(undefined)).toBe("named");
    const doc = withStreakLinks(undefined, { start: "2026-10-24", end: TODAY }, () => [
      { route: "retro-topic", targetId: "c", at: "2026-10-26T10:00:00.000Z" },
    ]);
    expect(doc).toMatchObject({
      id: MOOD_TRACKER_ID,
      mode: "named",
      streaks: [{ start: "2026-10-24", end: TODAY }],
    });
  });

  it("validates a check-in and a new team member", () => {
    expect(validateCheckIn({ score: null, note: "x" })).toMatchObject({
      ok: false,
      errors: { score: "Pick a face." },
    });
    expect(validateCheckIn({ score: 3, note: " ok " })).toEqual({
      ok: true,
      values: { score: 3, note: "ok" },
    });
    expect(validateMember([{ id: "m1", name: "Ana" }], { name: " ana " })).toMatchObject({
      ok: false,
      errors: { name: "Ana is already on the team." },
    });
  });
});

/* ── Verdict and Markdown ───────────────────────────────────────────── */

describe("the verdict and the export", () => {
  it("say the average, or the streak, team-level only", () => {
    const pulses = ownPulses();
    const days = lastDays(TODAY, 14);
    const summary = moodSummary([], pulses, days[0], TODAY);
    const streak = lowMoodStreak([], pulses, TODAY);
    expect(moodVerdict(summary, streak, { days: 14 })).toBe(
      "Team mood has been low for 3 check-in days (2.1 on average, 24–26 Oct): worth raising at the retro."
    );
    expect(moodVerdict(moodSummary([], [], days[0], TODAY), null, { days: 14 })).toMatch(
      /^No check-ins in the last 14 days/
    );
    const md = toMarkdown({
      summary,
      daily: dailyMood([], pulses, days),
      streak,
      mode: "anonymous",
      days: 14,
    });
    expect(md).toContain(
      "**Average:** 3 out of 5 over the last 14 days (59 check-ins, 59 of them anonymous;"
    );
    expect(md).toContain("**Low-mood streak:** 3 check-in days at 2.1 on average (24–26 Oct).");
    expect(md).toContain("| 2026-10-26 | 2 | 5 |");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("shows a dash, not 0.00, with nothing to average, and offers the example", () => {
    renderPage();
    expect(average()).toHaveTextContent("—");
    expect(average()).not.toHaveTextContent("0.00");
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("previews the example without writing anything, streak and all", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByText(/Low mood for 3 check-in days in a row/)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().moodPulses).toEqual([]);
    expect(screen.getByRole("button", { name: /^Send to…/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(average()).toHaveTextContent("—");
  });

  it("fills in a past day, never a future one, and clears a check-in with Undo", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    renderPage();
    const day = screen.getByLabelText("Check-ins for");
    fireEvent.change(day, { target: { value: "2026-10-27" } });
    expect(
      screen.getByText("A check-in can't be for a day that hasn't happened yet.")
    ).toBeInTheDocument();
    fireEvent.change(day, { target: { value: "2026-10-23" } });
    fireEvent.click(
      within(screen.getByRole("group", { name: /^Mood for Ana/ })).getByRole("button", {
        name: "Low",
      })
    );
    const saved = useWorkspaceStore.getState().moodEntries![0];
    expect(saved).toMatchObject({ memberId: "m1", date: "2026-10-23", score: 2 });
    expect(saved.loggedAt).toBeTruthy();
    expect(saved.id).toMatch(/^mood_/);
    // Logged for the Team Dashboard's timing signal: no name, no note.
    expect(logs.at(-1)).toEqual({ action: "mood_logged", payload: { date: "2026-10-23", n: 1 } });

    fireEvent.click(screen.getByRole("button", { name: "Clear Ana's check-in for 23 Oct" }));
    expect(useWorkspaceStore.getState().moodEntries).toEqual([]);
    expect(logs.at(-1)?.action).toBe("mood_removed");
    undo("Cleared Ana's check-in for 23 Oct");
    expect(useWorkspaceStore.getState().moodEntries).toHaveLength(1);
  });

  it("opens a person's day from the heatmap", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Ana, 20 Oct: no check-in" }));
    expect(screen.getByLabelText("Check-ins for")).toHaveValue("2026-10-20");
  });

  it("adds someone to the team only once", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    renderPage();
    const name = screen.getByRole("textbox", { name: "Add someone to the team" });
    fireEvent.change(name, { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(screen.getByText("Ana is already on the team.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(useWorkspaceStore.getState().teamMembers?.map((m) => m.name)).toEqual(["Ana", "Ben"]);
  });

  it("in the anonymous mode shows team pulses only, and saves a counted pulse with Undo", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Ana" }],
      moodEntries: [entry("e1", "m1", "2026-10-25", 5, { note: "Private" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Anonymous/ }));
    expect(useWorkspaceStore.getState().moodTrackerDocs?.[0]).toMatchObject({ mode: "anonymous" });
    expect(screen.queryByRole("group", { name: /^Mood for Ana/ })).toBeNull();
    expect(screen.queryByText("Private")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ana, / })).toBeNull();

    fireEvent.change(screen.getByLabelText("Pulse for"), { target: { value: "2026-10-24" } });
    const q = within(screen.getByRole("group", { name: /^1\. How are you today/ }));
    fireEvent.change(q.getByLabelText("Low"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Results show from 3 answers");
    fireEvent.change(q.getByLabelText("Good"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    const saved = useWorkspaceStore.getState().moodPulses![0];
    expect(saved).toMatchObject({
      date: "2026-10-24",
      source: "facilitator",
      counts: { 1: 0, 2: 2, 3: 0, 4: 1, 5: 0 },
    });
    expect(saved.id).toMatch(/^moodPulse_/);
    expect(logs.at(-1)).toEqual({ action: "mood_logged", payload: { date: "2026-10-24", n: 3 } });
    // Named and anonymous check-ins make one average: (5 + 2 + 2 + 4) / 4.
    expect(average()).toHaveTextContent("3.3");
    undo("Saved the round");
    expect(useWorkspaceStore.getState().moodPulses).toEqual([]);
  });

  it("raises a low-mood streak at the retro without naming anyone, once, with Undo", () => {
    useWorkspaceStore.setState({ moodPulses: ownPulses() });
    renderPage();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send to…/ }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro topic (no names)" }));
    const cards =
      useWorkspaceStore.getState().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID)?.cards ?? [];
    expect(cards.map((c) => c.text)).toEqual([
      "Team mood has been low for 3 check-in days (average 2.1, 24–26 Oct)",
    ]);
    expect(cards[0].sourceRef).toEqual({
      tool: "mood-tracker",
      id: "streak:2026-10-24",
      doc: MOOD_TRACKER_ID,
    });
    expect(useWorkspaceStore.getState().moodTrackerDocs?.[0].streaks?.[0].sentTo).toHaveLength(1);
    expect(screen.getByRole("button", { name: /\(sent\)$/ })).toBeInTheDocument();
    undo("Added to the retro");
    expect(useWorkspaceStore.getState().retroBoards ?? []).toHaveLength(0);
  });

  it("keeps the statistics behind their minimums", () => {
    useWorkspaceStore.setState({ moodPulses: ownPulses().slice(-3) });
    renderPage();
    expect(screen.getByText("Trend").parentElement!.parentElement!).toHaveTextContent(
      /Needs 6 days/
    );
    expect(screen.getByText(/to see sustained shifts \(CUSUM\)/)).toBeInTheDocument();
  });

  it("gives the page and the agent the same average", async () => {
    useWorkspaceStore.setState({ moodPulses: ownPulses() });
    renderPage();
    const r = (await registry.get("tool.mood_tracker.list_state")!.handler({}, ctx())) as {
      average: number;
      streak: { days: number };
    };
    expect(r.average).toBe(3);
    expect(average()).toHaveTextContent(/average\s*3\s*\/5/);
    expect(r.streak.days).toBe(3);
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

const LINK = { route: "retro-topic" as const, targetId: "c", at: "2026-10-26T10:00:00.000Z" };

describe("review fixes", () => {
  it("keeps one run one retro topic when a backfill or the window moves its start", () => {
    // Sent while the run was 24–26 Oct.
    const sent = withStreakLinks(undefined, { start: "2026-10-24", end: TODAY }, () => [LINK]);
    // A low day backfilled on the 23rd moves the start back: still the same run.
    const backfilled = lowMoodStreak(
      [],
      [...ownPulses(), pulse("x", "2026-10-23", { 2: 3 })],
      TODAY
    )!;
    expect(backfilled.start).toBe("2026-10-23");
    expect(savedStreakFor(sent, backfilled)?.sentTo).toEqual([LINK]);
    expect(streakLinks(sent, backfilled)).toEqual([LINK]);
    expect(streakKey(sent, backfilled)).toBe("2026-10-24");
    // Sending again stretches the saved run, keeping its earliest start.
    const again = withStreakLinks(sent, backfilled, (l) => [...(l ?? [])]);
    expect(again.streaks).toEqual([{ start: "2026-10-23", end: TODAY, sentTo: [LINK] }]);
    // A later run, after a better day, is a new one.
    expect(savedStreakFor(sent, { start: "2026-10-28", end: "2026-10-30" })).toBeUndefined();
  });

  it("follows a run back past the window, so it isn't new each day", () => {
    // Low every day from 1 Oct to 26 Oct, three answers a day.
    const days = lastDays(TODAY, 26);
    const pulses = days.map((d, i) => pulse(`l${i}`, d, { 2: 3 }));
    const streak = lowMoodStreak([], pulses, TODAY)!;
    expect(streak.start).toBe("2026-10-13");
    expect(streak.runStart).toBe("2026-10-01");
    // Sent on 5 Oct (the run was 1–5 Oct then): the same run three weeks on.
    const sent = withStreakLinks(undefined, { start: "2026-10-01", end: "2026-10-05" }, () => [
      LINK,
    ]);
    expect(streakLinks(sent, streak)).toEqual([LINK]);
  });

  it("the check-in and pulse days move on past midnight, unless one was picked", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 30));
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    renderPage();
    fireEvent.change(screen.getByLabelText("Pulse for"), { target: { value: "2026-10-20" } });
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 27, 0, 0, 40));
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByLabelText("Check-ins for")).toHaveValue("2026-10-27");
    // Picked by hand: it stays.
    expect(screen.getByLabelText("Pulse for")).toHaveValue("2026-10-20");
  });

  it("in the anonymous mode no day shows with fewer than 3 check-ins", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Ana" }],
      moodEntries: [entry("e1", "m1", "2026-10-22", 1)],
      moodPulses: [pulse("p1", "2026-10-25", { 4: 3 })],
      moodTrackerDocs: [{ id: MOOD_TRACKER_ID, mode: "anonymous" }],
    });
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("| 2026-10-25 | 4 | 3 |");
    expect(md).not.toContain("2026-10-22");
    expect(md).toContain("Days with fewer than 3 check-ins are left out");
    // The window's average still counts Ana's earlier check-in: (1 + 12) / 4.
    expect(md).toContain("**Average:** 3.3 out of 5");
    expect(
      teamLevelDays(dailyMood([entry("e1", "m1", "2026-10-22", 1)], [], ["2026-10-22"]))
    ).toEqual([]);
  });

  it("gives the AI prompt the headline's average, the window's check-ins, and no names when anonymous", () => {
    const days = lastDays(TODAY, 14);
    const named = [
      entry("e1", "m1", "2026-10-25", 2, { note: "Tired" }),
      entry("old", "m1", "2026-09-01", 5),
    ];
    const pulses = [pulse("p1", "2026-10-25", { 4: 2 }), pulse("p0", "2026-09-02", { 5: 3 })];
    const summary = moodSummary(named, pulses, days[0], TODAY);
    const byName = moodPromptData(named, pulses, days, summary, "named");
    expect(byName.overallAvg).toBe(summary.average);
    expect(byName.overallAvg).toBeCloseTo(3.3);
    // Only the window: the September rows are out.
    expect(byName.entries.map((e) => e.date)).toEqual(["2026-10-25", "2026-10-25", "2026-10-25"]);
    expect(byName.entries[0]).toMatchObject({ memberId: "m1", note: "Tired" });
    const anon = moodPromptData(named, pulses, days, summary, "anonymous");
    expect(anon.entries.every((e) => e.memberId === "team" && !("note" in e))).toBe(true);
    expect(anon.entries).toHaveLength(3);
    // Too few check-ins for an average: no prompt, as the page shows "—".
    const thin = moodSummary([named[0]], [], days[0], TODAY);
    expect(moodPromptData([named[0]], [], days, thin, "named").entries).toEqual([]);
  });

  it("puts focus back after a check-in is cleared and a pulse deleted", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Ana" }],
      moodEntries: [entry("e1", "m1", TODAY, 4)],
      moodPulses: [pulse("p1", "2026-10-24", { 4: 3 }), pulse("p2", "2026-10-25", { 3: 3 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear Ana's check-in for 26 Oct" }));
    const faces = screen.getByRole("group", { name: /^Mood for Ana/ });
    expect(document.activeElement).toBe(within(faces).getAllByRole("button")[0]);
    // Newest first: deleting the 25th's moves focus to the 24th's Delete.
    fireEvent.click(screen.getByRole("button", { name: /^Delete the pulse of 25 Oct/ }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Delete the pulse of 24 Oct/ })
    );
    fireEvent.click(screen.getByRole("button", { name: /^Delete the pulse of 24 Oct/ }));
    expect(document.activeElement).toBe(screen.getByLabelText("Pulse for"));
  });

  it("the pulse's day says which day it keeps while it shows an error", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Pulse for"), { target: { value: "2026-10-29" } });
    expect(screen.getByText("Keeps 26 Oct 2026 until a valid day is picked.")).toBeInTheDocument();
  });
});
