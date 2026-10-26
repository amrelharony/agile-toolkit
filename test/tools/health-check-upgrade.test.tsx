import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS,
  HEALTH_CHECK_ID,
  type HealthCheck,
  type HealthCheckEntry,
  type HealthDimension,
  type HealthDimensionScore,
  type HealthTrafficLight,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { questionnaireProblem } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import {
  activeDimensions,
  applyHealthRound,
  draftLight,
  draftShare,
  emptyHealthCheck,
  entryShare,
  healthCheckFor,
  healthQuestionnaire,
  isRated,
  isSplit,
  lightFromVotes,
  previousSavedCheck,
  ratedKeys,
  redDimensions,
  redTopicTitle,
  revertHealthRound,
  saveDraft,
  trendFor,
  votesFromDistribution,
  withCustomDimension,
  withDimensionPatch,
  withEntryLinks,
  withNote,
  withRating,
  withSprint,
  withVotes,
  HEALTH_VOTE_SCALE,
} from "@/lib/health-check/score";
import { registry } from "@/lib/actions/registry";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";

/**
 * Squad Health Check, upgraded: yellow counts half everywhere (the page,
 * its agent actions and the Team Dashboard read one number), the trend is
 * derived from the previous saved check, ratings are stored with the
 * draft instead of in memory, a check is saved for a shared sprint and a
 * backdatable day and is refused while a dimension is unrated, anonymous
 * votes come in through the vote-room kit as counts only, notes and the
 * team's own dimensions, reds go to the retro once, deletes and resets
 * have Undo, and the example is a read-only preview.
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
vi.mock("@/app/(tools)/health-check/charts", () => ({ HealthTrendChart: () => null }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";
import { buildExample } from "@/app/(tools)/health-check/example";
import { toMarkdown } from "@/app/(tools)/health-check/markdown";
import { healthVerdict } from "@/app/(tools)/health-check/verdict";
import { validateDimension } from "@/app/(tools)/health-check/dimension-form";
import "@/lib/actions/tools/health-check";
import "@/lib/actions/workspace";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const D = HEALTH_CHECK_DIMENSIONS;
const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const scores = (
  set: Partial<Record<HealthDimension, HealthTrafficLight>> = {},
  fill: HealthTrafficLight = "green"
): Record<HealthDimension, HealthDimensionScore> =>
  Object.fromEntries(D.map((d) => [d, { light: set[d] ?? fill, trend: "same" }])) as Record<
    HealthDimension,
    HealthDimensionScore
  >;

const entry = (
  id: string,
  date: string,
  set: Partial<Record<HealthDimension, HealthTrafficLight>> = {},
  over: Partial<HealthCheckEntry> = {}
): HealthCheckEntry => ({ id, sprintName: `Check ${id}`, date, scores: scores(set), ...over });

const doc = (over: Partial<HealthCheck> = {}): HealthCheck => ({ ...emptyHealthCheck(), ...over });

const sprint = (id: string, name: string, start: string, end: string): Sprint => ({
  id,
  name,
  startDate: start,
  endDate: end,
  pointsPlanned: 10,
  pointsCompleted: 8,
  status: "completed",
});

const stored = () =>
  useWorkspaceStore.getState().healthChecks?.find((d) => d.id === HEALTH_CHECK_ID);
const seed = (d: HealthCheck) => useWorkspaceStore.setState({ healthChecks: [d] });

const renderPage = () =>
  render(
    <TooltipProvider>
      <HealthCheckClient />
    </TooltipProvider>
  );

/** Click the toast's Undo for the newest toast labelled `label`. */
function undo(label: string | RegExp) {
  const call = [...toastSpy.mock.calls]
    .reverse()
    .find(([l]) => (typeof label === "string" ? l === label : label.test(String(l))));
  if (!call) throw new Error(`no toast ${label}`);
  act(() => (call[1] as { action: { onClick: () => void } }).action.onClick());
}

const score = () => screen.getByTestId("health-check-score");
const lightButton = (dim: string, light: string) =>
  within(screen.getByRole("group", { name: new RegExp(`^${dim} status`) })).getByRole("button", {
    name: light,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({ healthChecks: [], sprints: [], retroBoards: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

/* ── The score ──────────────────────────────────────────────────────── */

describe("one score, yellow counting half", () => {
  it("counts rated built-in and custom dimensions, yellow as half", () => {
    const e = entry("a", "2026-10-01", { Fun: "yellow", Speed: "red" });
    // 6 green + ½ + 0 over 8.
    expect(entryShare(e)).toBeCloseTo(6.5 / 8);
    const withCustom = {
      ...e,
      customScores: { "custom-x": { light: "yellow" as const, trend: "same" as const } },
    };
    expect(entryShare(withCustom)).toBeCloseTo(7 / 9);
    expect(entryShare(undefined)).toBeNull();
  });

  it("reads a blank draft as unrated, never as the placeholder greens' 100%", () => {
    const d = doc();
    expect(draftShare(d)).toBeNull();
    expect(ratedKeys(d)).toEqual([]);
    const two = withRating(withRating(d, "Fun", "green"), "Speed", "yellow");
    expect(ratedKeys(two)).toEqual(["Fun", "Speed"]);
    expect(draftShare(two)).toBeCloseTo(0.75);
  });

  it("reads an older draft without `rated` as before: yellow and red rated, green not", () => {
    const legacy = doc({
      current: { sprintName: "", scores: scores({ Fun: "red", Speed: "yellow" }) },
    });
    expect(isRated(legacy.current, "Fun")).toBe(true);
    expect(isRated(legacy.current, "Teamwork")).toBe(false);
    // The first edit carries those over into `rated`.
    const next = withRating(legacy, "Teamwork", "green");
    expect(next.current.rated?.sort()).toEqual(["Fun", "Speed", "Teamwork"]);
  });

  it("the Team Dashboard's team health is the same number", async () => {
    const { dashboardKpis } = await import("@/lib/health-dashboard/kpis");
    const d = doc({
      history: [
        entry(
          "a",
          "2026-10-01",
          { Fun: "yellow" },
          { customScores: { "custom-x": { light: "red", trend: "same" } } }
        ),
      ],
    });
    const kpi = dashboardKpis({ healthChecks: [d], today: "2026-10-26" }).find(
      (k) => k.id === "team-health"
    );
    expect(kpi?.value).toBe(Math.round(entryShare(d.history[0])! * 100));
    expect(kpi?.n).toBe(9);
  });
});

/* ── Trends, votes, saving ──────────────────────────────────────────── */

describe("the trend comes from history", () => {
  it("compares a light with the previous saved check's", () => {
    expect(trendFor("red", "green")).toBe("up");
    expect(trendFor("green", "yellow")).toBe("down");
    expect(trendFor(undefined, "green")).toBe("same");
    expect(trendFor("yellow", null)).toBe("same");
  });

  it("finds the previous saved check by date, examples left out", () => {
    const d = doc({
      history: [
        entry("b", "2026-10-15"),
        entry("a", "2026-10-01"),
        entry("example-c", "2026-10-20"),
      ],
    });
    expect(previousSavedCheck(d, { date: "2026-10-26" })?.id).toBe("b");
    expect(previousSavedCheck(d, { date: "2026-10-10" })?.id).toBe("a");
    expect(previousSavedCheck(d, { date: "2026-10-15", id: "b" })?.id).toBe("a");
    expect(previousSavedCheck(d, { date: "2026-10-26" }, { includeExamples: true })?.id).toBe(
      "example-c"
    );
  });
});

describe("votes", () => {
  it("give a light from the minimum: mostly green is green, mostly red is red", () => {
    expect(lightFromVotes({ green: 5, yellow: 1, red: 0 })).toBe("green");
    expect(lightFromVotes({ green: 0, yellow: 1, red: 4 })).toBe("red");
    expect(lightFromVotes({ green: 2, yellow: 2, red: 2 })).toBe("yellow");
    expect(lightFromVotes({ green: 2, yellow: 0, red: 0 })).toBeNull();
    expect(lightFromVotes(undefined)).toBeNull();
    expect(isSplit({ green: 3, yellow: 0, red: 2 })).toBe(true);
    expect(isSplit({ green: 3, yellow: 2, red: 0 })).toBe(false);
  });

  it("set the light and rate the dimension from 3 votes; below that they wait", () => {
    const few = withVotes(doc(), "Fun", { green: 1, yellow: 1, red: 0 });
    expect(draftLight(few.current, "Fun")).toBeNull();
    expect(few.current.scores.Fun.votes).toEqual({ green: 1, yellow: 1, red: 0 });
    const enough = withVotes(doc(), "Fun", { green: 0, yellow: 1, red: 3 });
    expect(draftLight(enough.current, "Fun")).toBe("red");
  });

  it("the questionnaire is one optional question per active dimension, on red/yellow/green", () => {
    const d = withCustomDimension(doc(), {
      id: "custom-abc12345",
      name: "On-call load",
      description: "Nights stay bearable.",
    });
    const q = healthQuestionnaire(d)!;
    expect(questionnaireProblem(q)).toBeNull();
    expect(q.questions).toHaveLength(9);
    expect(q.questions.every((x) => x.optional)).toBe(true);
    expect(q.questions[1]).toMatchObject({ id: "easy-to-release", text: "Easy to Release" });
    expect(q.questions[8]).toMatchObject({ id: "custom-abc12345", hint: "Nights stay bearable." });
    expect(q.scale.points.map((p) => [p.value, p.label])).toEqual([
      [0, "Red"],
      [1, "Yellow"],
      [2, "Green"],
    ]);
    const archived = withDimensionPatch(d, "custom-abc12345", { archived: true })!;
    expect(healthQuestionnaire(archived)!.questions).toHaveLength(8);
  });

  it("a saved round sets votes for the questions it shows and leaves withheld ones alone", () => {
    const d = withRating(doc(), "Speed", "green");
    const result: VoteRoundResult = {
      roundId: "r",
      tool: "health-check",
      questionnaireId: "health-check",
      title: "Squad health check",
      scale: HEALTH_VOTE_SCALE,
      closedAt: "2026-10-26T10:00:00.000Z",
      minN: 3,
      ballots: 4,
      source: "live",
      questions: [
        { id: "fun", text: "Fun", responses: 4, distribution: [3, 1, 0] },
        { id: "speed", text: "Speed", responses: 2, distribution: null },
      ],
    };
    expect(votesFromDistribution([3, 1, 0], HEALTH_VOTE_SCALE)).toEqual({
      red: 3,
      yellow: 1,
      green: 0,
    });
    const { doc: next, keys } = applyHealthRound(d, result);
    expect(keys).toEqual(["Fun"]);
    expect(next.current.scores.Fun).toMatchObject({
      light: "red",
      votes: { red: 3, yellow: 1, green: 0 },
    });
    expect(draftLight(next.current, "Speed")).toBe("green");
    expect(next.current.scores.Speed.votes).toBeUndefined();
    expect(next.current).toMatchObject({ source: "room", responses: 4 });
    const back = revertHealthRound(next, d.current, keys);
    expect(back.current.scores.Fun).toEqual(d.current.scores.Fun);
    expect(isRated(back.current, "Fun")).toBe(false);
    expect(back.current.source).toBeUndefined();
  });
});

describe("saving a check", () => {
  const all = (d: HealthCheck, set: Partial<Record<HealthDimension, HealthTrafficLight>> = {}) =>
    D.reduce((x, k) => withRating(x, k, set[k] ?? "green"), d);

  it("refuses an unrated draft and a future day", () => {
    const r = saveDraft(withRating(doc(), "Fun", "red"), { id: "x", today: "2026-10-26" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unrated.map((d) => d.name)).toHaveLength(7);
    const future = saveDraft(
      { ...all(doc()), current: { ...all(doc()).current, date: "2026-10-27" } },
      { id: "x", today: "2026-10-26" }
    );
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.dateProblem).toBe("A check can't be dated in the future.");
  });

  it("saves the sprint, the backdated day and trends against the check before", () => {
    const s = sprint("s7", "Sprint 7", "2026-10-05", "2026-10-16");
    const before = doc({ history: [entry("a", "2026-10-01", { Fun: "red" })] });
    const d = withSprint(
      {
        ...all(before, { Speed: "yellow" }),
        current: { ...all(before, { Speed: "yellow" }).current, date: "2026-10-20" },
      },
      s
    );
    const r = saveDraft(d, { id: "new", today: "2026-10-26", sprints: [s] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toMatchObject({
      id: "new",
      sprintId: "s7",
      sprintName: "Sprint 7",
      date: "2026-10-20",
    });
    expect(r.entry.scores.Fun.trend).toBe("up");
    expect(r.entry.scores.Speed.trend).toBe("down");
    expect(r.doc.current.rated).toEqual([]);
    expect(healthCheckFor(r.doc, s, [s])?.id).toBe("new");
  });

  it("matches a sprint by its id before any name or date", () => {
    const s1 = sprint("s1", "Sprint 1", "2026-09-21", "2026-10-02");
    const s2 = sprint("s2", "Sprint 2", "2026-10-05", "2026-10-16");
    const d = doc({
      history: [
        entry("named", "2026-10-03", {}, { sprintName: "Sprint 2" }),
        entry("tagged", "2026-10-01", {}, { sprintId: "s2", sprintName: "Renamed" }),
        entry("other", "2026-10-17", {}, { sprintId: "s1" }),
      ],
    });
    expect(healthCheckFor(d, s2, [s1, s2])?.id).toBe("tagged");
    // A check saved for another sprint never matches by date.
    expect(healthCheckFor(d, s1, [s1, s2])?.id).toBe("other");
  });

  it("names a red's retro topic with the sprint and the note", () => {
    expect(
      redTopicTitle(
        { sprintName: "Sprint 7", date: "2026-10-20" },
        { name: "Speed" },
        "Waiting on QA"
      )
    ).toBe("Health check: Speed is red (Sprint 7) — Waiting on QA");
    const d = doc({ history: [entry("a", "2026-10-01", { Fun: "red", Speed: "red" })] });
    expect(redDimensions(d.history[0], d).map((x) => x.key)).toEqual(["Fun", "Speed"]);
    const linked = withEntryLinks(d, "a", "Fun", () => [
      { route: "retro-topic", targetId: "card", at: "2026-10-26T10:00:00.000Z" },
    ])!;
    expect(linked.history[0].scores.Fun.sentTo).toHaveLength(1);
  });
});

describe("custom dimensions", () => {
  it("need a name no other dimension has, archived ones included", () => {
    const d = withCustomDimension(doc(), { id: "custom-a", name: "On-call load", archived: true });
    expect(validateDimension(d, { name: " ", description: "" })).toMatchObject({ ok: false });
    expect(validateDimension(d, { name: "fun", description: "" })).toMatchObject({
      ok: false,
      errors: { name: "“Fun” is already a dimension." },
    });
    expect(validateDimension(d, { name: "on-call LOAD", description: "" })).toMatchObject({
      ok: false,
      errors: { name: "“On-call load” is an archived dimension. Restore it instead." },
    });
    expect(validateDimension(d, { name: "Pairing", description: " Often " })).toEqual({
      ok: true,
      values: { name: "Pairing", description: "Often" },
    });
    expect(activeDimensions(d)).toHaveLength(8);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts unrated and says what to rate when Save is pressed, focusing the first", () => {
    renderPage();
    expect(score()).toHaveTextContent("Health: —");
    expect(
      screen.queryAllByRole("button", { pressed: true, name: /^(Green|Yellow|Red)$/ })
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save check" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Rate these 8 dimensions before saving");
    expect(lightButton("Delivering Value", "Green")).toHaveFocus();
    expect(stored()?.history ?? []).toHaveLength(0);
  });

  it("keeps ratings in the stored draft, counts yellow as half and saves with derived trends", () => {
    seed(doc({ history: [entry("prev", "2026-10-12", { Fun: "red" })] }));
    renderPage();
    fireEvent.click(lightButton("Fun", "Green"));
    fireEvent.click(lightButton("Speed", "Yellow"));
    expect(score()).toHaveTextContent("75%");
    expect(stored()?.current.rated).toEqual(["Fun", "Speed"]);
    // The trend is read, not picked.
    expect(screen.queryByRole("button", { name: "Same" })).toBeNull();
    expect(screen.getAllByText(/since Check prev/).length).toBeGreaterThan(0);

    for (const d of D) {
      if (d !== "Fun" && d !== "Speed") fireEvent.click(lightButton(d, "Green"));
    }
    fireEvent.click(screen.getByRole("button", { name: "Save check" }));
    const saved = stored()!.history.find((e) => e.id !== "prev")!;
    expect(saved.date).toBe("2026-10-26");
    expect(saved.scores.Fun.trend).toBe("up");
    expect(saved.scores.Speed.trend).toBe("down");
    expect(score()).toHaveTextContent("Health: —");
    expect(logs.find((l) => l.action === "check_saved")?.payload).toMatchObject({ health: 94 });
  });

  it("backdates the check, refusing a future day inline", () => {
    renderPage();
    const day = screen.getByLabelText("Taken on");
    fireEvent.change(day, { target: { value: "2026-10-30" } });
    expect(screen.getByText("A check can't be dated in the future.")).toBeInTheDocument();
    expect(stored()?.current.date).toBeUndefined();
    fireEvent.change(day, { target: { value: "2026-10-20" } });
    expect(stored()?.current.date).toBe("2026-10-20");
  });

  it("offers the shared sprints, and a free name only without them", () => {
    const { unmount } = renderPage();
    expect(screen.getByLabelText("Check name")).toBeInTheDocument();
    unmount();
    useWorkspaceStore.setState({ sprints: [sprint("s1", "Sprint 1", "2026-10-12", "2026-10-23")] });
    renderPage();
    expect(screen.queryByLabelText("Check name")).toBeNull();
    expect(screen.getByText("Sprint this check is for")).toBeInTheDocument();
  });

  it("keeps a note per dimension", () => {
    renderPage();
    const note = screen.getByRole("textbox", { name: "Note on Speed" });
    fireEvent.change(note, { target: { value: "Waiting on QA" } });
    fireEvent.blur(note);
    expect(stored()?.current.scores.Speed.note).toBe("Waiting on QA");
    // A note isn't a rating.
    expect(isRated(stored()?.current, "Speed")).toBe(false);
  });

  it("takes an anonymous round's counts (no room here: the count entry), with Undo", () => {
    renderPage();
    const q = within(screen.getByRole("group", { name: /^\d+\. Fun/ }));
    fireEvent.change(q.getByLabelText("Red"), { target: { value: "1" } });
    fireEvent.change(q.getByLabelText("Green"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(stored()?.current.scores.Fun).toMatchObject({
      light: "green",
      votes: { red: 1, yellow: 0, green: 4 },
    });
    expect(stored()?.current).toMatchObject({ source: "facilitator", responses: 5 });
    expect(screen.getByText(/4 green · 0 yellow · 1 red/)).toBeInTheDocument();
    expect(screen.getByText("Split view")).toBeInTheDocument();
    // Counts only in the log.
    expect(logs.find((l) => l.action === "round_saved")?.payload).toEqual({
      ballots: 5,
      dimensions: 1,
      source: "facilitator",
    });
    undo("Saved the round");
    expect(isRated(stored()?.current, "Fun")).toBe(false);
    expect(stored()?.current.scores.Fun.votes).toBeUndefined();
  });

  it("sends a check's reds to the retro once, with Undo", () => {
    seed(
      doc({
        history: [
          entry("a", "2026-10-20", { Fun: "red", Speed: "red" }, { sprintName: "Sprint 7" }),
        ],
      })
    );
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /Send 2 red dimensions/ })[0]);
    const board = () =>
      useWorkspaceStore.getState().retroBoards?.find((b) => b.id === RETRO_CURRENT_ID);
    expect(board()?.cards.map((c) => c.text)).toEqual([
      "Health check: Fun is red (Sprint 7)",
      "Health check: Speed is red (Sprint 7)",
    ]);
    expect(board()?.cards[0].sourceRef).toEqual({
      tool: "health-check",
      id: "a:Fun",
      doc: HEALTH_CHECK_ID,
    });
    expect(stored()?.history[0].scores.Fun.sentTo).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /Send 2 red dimensions/ })).toHaveLength(0);
    expect(screen.getAllByText("Sent · Open retro").length).toBeGreaterThan(0);
    undo("Sent 2 red dimensions to the retro");
    expect(board()?.cards ?? []).toHaveLength(0);
    expect(stored()?.history[0].scores.Fun.sentTo).toBeUndefined();
  });

  it("deletes a saved check with Undo", () => {
    seed(doc({ history: [entry("a", "2026-10-01"), entry("b", "2026-10-15")] }));
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete the check Check a" })[0]);
    expect(stored()?.history.map((e) => e.id)).toEqual(["b"]);
    expect(logs.at(-1)).toEqual({ action: "check_removed", payload: { checkId: "a" } });
    undo("Deleted the check Check a");
    expect(stored()?.history.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("adds, renames and archives a custom dimension; saved checks keep its light", () => {
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: "Dimension" }), {
      target: { value: "fun" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add dimension" }));
    expect(screen.getByText("“Fun” is already a dimension.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Dimension" }), {
      target: { value: "On-call load" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add dimension" }));
    const dim = stored()!.customDimensions![0];
    expect(dim).toMatchObject({ name: "On-call load" });
    expect(dim.id).toMatch(/^custom-/);

    const name = screen.getByDisplayValue("On-call load");
    fireEvent.change(name, { target: { value: "Teamwork" } });
    fireEvent.blur(name);
    expect(screen.getByText("“Teamwork” is already a dimension.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "On-call" } });
    fireEvent.blur(name);
    expect(stored()!.customDimensions![0].name).toBe("On-call");

    fireEvent.click(lightButton("On-call", "Red"));
    fireEvent.click(screen.getByRole("button", { name: "Archive On-call" }));
    expect(stored()!.customDimensions![0].archived).toBe(true);
    expect(screen.queryByRole("group", { name: /^On-call status/ })).toBeNull();
    undo("Archived “On-call”");
    expect(stored()!.customDimensions![0].archived).toBeUndefined();
  });

  it("clears every saved check after a confirm, with Undo, keeping the team's dimensions", () => {
    const d = withCustomDimension(doc({ history: [entry("a", "2026-10-01")] }), {
      id: "custom-x",
      name: "Pairing",
    });
    seed(d);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete all 1 saved health check?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(stored()?.history).toHaveLength(0);
    expect(stored()?.customDimensions).toHaveLength(1);
    undo("Cleared 1 saved health check");
    expect(stored()?.history).toHaveLength(1);
  });

  it("shows the example as a read-only preview that never reaches the workspace", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().healthChecks).toEqual([]);
    expect(screen.getByRole("button", { name: "Save check" })).toBeDisabled();
    expect(screen.getByTestId("health-check-verdict").textContent).toMatch(
      /Health of Codebase is red/
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText("Example data.")).toBeNull();
    expect(score()).toHaveTextContent("Health: —");
  });

  it("gives the page and the agent the same health for the same draft", async () => {
    seed(
      withRating(withRating(withRating(doc(), "Fun", "yellow"), "Speed", "red"), "Mission", "green")
    );
    renderPage();
    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      currentHealth: number | null;
    };
    expect(r.currentHealth).toBe(50);
    expect(score()).toHaveTextContent("50%");
  });
});

/* ── Markdown and verdict ───────────────────────────────────────────── */

describe("Markdown and the verdict", () => {
  it("say how health is counted, with votes and notes, and the history", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    const md = toMarkdown(ex, { now: new Date(2026, 9, 26), includeExamples: true });
    expect(md).toContain("green 1, yellow ½, red 0");
    expect(md).toContain("7 people voted anonymously.");
    expect(md).toMatch(
      /\| Health of Codebase \| 🔴 Red \| → Same \| 1\/1\/5 \(split\) \| Flaky checkout tests/
    );
    expect(md).toContain("| Speed | 🟡 Yellow | ↑ Up | 2/3/2 (split) |");
    expect(md).toContain("| On-call load |");
    expect(md).toContain("## History");
    expect(toMarkdown(doc(), { now: new Date(2026, 9, 26) })).toContain("No health checks yet.");
  });

  it("names what is red and what moved", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    expect(healthVerdict(ex, { today: "2026-10-26", includeExamples: true })).toBe(
      "Health 72% (yellow counts half): Health of Codebase is red; Delivering Value, Easy to Release, Speed and On-call load improved since Sprint 14."
    );
    expect(healthVerdict(doc(), { today: "2026-10-26" })).toMatch(/^No health check yet/);
  });
});

/* ── Agent actions ──────────────────────────────────────────────────── */

describe("tool.health_check", () => {
  const call = async <T,>(verb: string, params: Record<string, unknown> = {}) =>
    (await registry.get(`tool.health_check.${verb}`)!.handler(params, ctx())) as T;

  it("reads a blank draft as unrated", async () => {
    const r = await call<{ currentHealth: number | null; unrated: string[]; ratedCount: number }>(
      "list_state"
    );
    expect(r.currentHealth).toBeNull();
    expect(r.unrated).toHaveLength(8);
    expect(r.ratedCount).toBe(0);
  });

  it("set_dimension takes custom dimensions, notes and votes, and ignores a trend", async () => {
    await call("add_dimension", { name: "Pairing" });
    const set = await call<{ set: boolean; key: string; trendIgnored?: boolean }>("set_dimension", {
      dimension: "pairing",
      light: "yellow",
      note: "Rarely",
      trend: "up",
    });
    expect(set).toMatchObject({ set: true, trendIgnored: true });
    expect(set.key).toMatch(/^custom-/);
    expect(
      await call("set_dimension", { dimension: "Fun", votes: { green: 1, yellow: 0, red: 1 } })
    ).toMatchObject({ set: false });
    expect(
      await call("set_dimension", { dimension: "Fun", votes: { green: 3, yellow: 0, red: 1 } })
    ).toMatchObject({ set: true, light: "green" });
    expect(await call("set_dimension", { dimension: "Nope", light: "red" })).toMatchObject({
      set: false,
    });
    const r = await call<{
      lights: Record<string, string | null>;
      notes: Record<string, string>;
      currentHealth: number;
    }>("list_state");
    expect(r.lights[set.key]).toBe("yellow");
    expect(r.notes[set.key]).toBe("Rarely");
    expect(r.currentHealth).toBe(75);
  });

  it("save_check refuses an unrated draft, then saves with a date and derived trends", async () => {
    expect(await call("save_check")).toMatchObject({
      saved: false,
      unrated: expect.arrayContaining(["Fun"]),
    });
    for (const d of D)
      await call("set_dimension", { dimension: d, light: d === "Fun" ? "red" : "green" });
    expect(await call("save_check", { date: "2026-10-30" })).toMatchObject({
      saved: false,
      reason: "A check can't be dated in the future.",
    });
    const r = await call<{ saved: boolean; health: number; date: string }>("save_check", {
      date: "2026-10-20",
    });
    expect(r).toMatchObject({ saved: true, health: 88, date: "2026-10-20" });
    expect(stored()?.history[0].scores.Fun.trend).toBe("same");
  });

  it("set_sprint checks the sprint; remove_check and archive_dimension do what they say", async () => {
    useWorkspaceStore.setState({ sprints: [sprint("s1", "Sprint 1", "2026-10-12", "2026-10-23")] });
    expect(await call("set_sprint", { sprintId: "nope" })).toMatchObject({ set: false });
    expect(await call("set_sprint", { sprintId: "s1" })).toMatchObject({
      set: true,
      sprintName: "Sprint 1",
    });
    expect(stored()?.current).toMatchObject({ sprintId: "s1", sprintName: "Sprint 1" });
    seed({ ...stored()!, history: [entry("a", "2026-10-01")] });
    expect(await call("remove_check", { id: "a" })).toMatchObject({ removed: true, checkCount: 0 });
    expect(await call("remove_check", { id: "a" })).toEqual({ removed: false });
    expect(await call("archive_dimension", { id: "Fun" })).toMatchObject({ archived: false });
    const added = await call<{ id: string }>("add_dimension", { name: "Pairing" });
    expect(await call("add_dimension", { name: "pairing" })).toMatchObject({ added: false });
    expect(await call("archive_dimension", { id: added.id })).toEqual({
      archived: true,
      id: added.id,
    });
    expect(await call("add_dimension", { name: "Pairing" })).toEqual({
      added: true,
      id: added.id,
      restored: true,
    });
  });

  it("reset asks for confirmation and keeps the team's dimensions", async () => {
    expect(registry.get("tool.health_check.reset")?.requiresConfirmation).toBe(true);
    await call("add_dimension", { name: "Pairing" });
    seed({ ...stored()!, history: [entry("a", "2026-10-01")] });
    await call("reset");
    expect(stored()?.history).toHaveLength(0);
    expect(stored()?.customDimensions).toHaveLength(1);
  });

  it("workspace.health_check.update keeps notes, votes, links and custom dimensions", async () => {
    let d = withCustomDimension(doc(), { id: "custom-x", name: "Pairing", description: "Often" });
    d = withNote(withVotes(d, "Fun", { green: 3, yellow: 0, red: 0 }), "Fun", "Good");
    d = {
      ...d,
      history: [
        entry("a", "2026-10-01", { Fun: "red" }, { sprintId: "s1", source: "room", responses: 4 }),
      ],
    };
    d = withEntryLinks(d, "a", "Fun", () => [
      { route: "retro-topic", targetId: "c", at: "2026-10-26T10:00:00.000Z" },
    ])!;
    seed(d);
    await registry
      .get("workspace.health_check.update")!
      .handler({ id: HEALTH_CHECK_ID, patch: {} }, ctx());
    expect(stored()).toEqual(d);
  });
});
