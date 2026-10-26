import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PSYCH_SAFETY_ID,
  type PsychSafetyCounts,
  type PsychSafetyLog,
  type PsychSafetyQuestionId,
  type PsychSafetyResponse,
  type PsychSafetyRound,
} from "@/lib/stores/workspace-types";
import { questionnaireProblem } from "@/lib/realtime/vote-room/protocol";
import {
  LEGACY_ROUND_ID,
  PSYCH_SAFETY_MIN_RESPONSES,
  PSYCH_SAFETY_QUESTIONS,
  PSYCH_SAFETY_SCALE,
  checkRoundCounts,
  compareRounds,
  countsFromAnswers,
  countsFromVoteResult,
  psychSafetyQuestionnaire,
  roundResult,
  roundsOf,
  withoutRound,
} from "@/lib/psych-safety/instrument";
import { registry } from "@/lib/actions/registry";

/**
 * Psych Safety, upgraded: rounds of counts instead of answers per person
 * (from the vote-room kit's live round or its count entry), results from
 * five responses, rounds compared statement by statement with the anomaly
 * per round, the older per-response list read as one read-only "legacy"
 * round, no benchmark, Undo on every delete, the agent reading the same
 * rounds, and an example that is a read-only preview.
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
  ExportButton: ({ markdown, csvData }: { markdown?: string; csvData?: unknown }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
    </>
  ),
}));

import { PsychSafetyClient } from "@/app/(tools)/psych-safety/psych-safety-client";
import { buildExample } from "@/app/(tools)/psych-safety/example";
import { toMarkdown } from "@/app/(tools)/psych-safety/markdown";
import { psychSafetyVerdict } from "@/app/(tools)/psych-safety/verdict";
import { validateRoundDetails } from "@/app/(tools)/psych-safety/details";
import { generatePsychSafetyPrompts } from "@/lib/ai-prompts/psych-safety";
import "@/lib/actions/tools/psych-safety";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const IDS = PSYCH_SAFETY_QUESTIONS.map((q) => q.id);
type Counts = Record<PsychSafetyQuestionId, PsychSafetyCounts>;

/** Every statement answered `point` by `n` people. */
const flat = (n: number, point = 4): Counts =>
  Object.fromEntries(
    IDS.map((id) => {
      const c: PsychSafetyCounts = [0, 0, 0, 0, 0];
      c[point - 1] = n;
      return [id, c];
    })
  ) as Counts;

const round = (
  id: string,
  date: string,
  counts: Counts,
  responses: number,
  over: Partial<PsychSafetyRound> = {}
): PsychSafetyRound => ({
  id,
  name: `Round ${id}`,
  date,
  source: "facilitator",
  responses,
  counts,
  createdAt: `${date}T10:00:00.000Z`,
  ...over,
});

const sheet = (id: string, ts: string, raw: number, respondent?: string): PsychSafetyResponse => ({
  id,
  ts,
  scores: Object.fromEntries(IDS.map((q) => [q, raw])) as Record<PsychSafetyQuestionId, number>,
  ...(respondent ? { respondent, description: `Notes by ${respondent}` } : {}),
});

const stored = () =>
  useWorkspaceStore.getState().psychSafetyLogs?.find((d) => d.id === PSYCH_SAFETY_ID);
const seed = (l: PsychSafetyLog) => useWorkspaceStore.setState({ psychSafetyLogs: [l] });

const renderPage = () =>
  render(
    <TooltipProvider>
      <PsychSafetyClient />
    </TooltipProvider>
  );

function undo(label: string) {
  const call = [...toastSpy.mock.calls].reverse().find(([l]) => l === label);
  if (!call) throw new Error(`no toast ${label}`);
  act(() => (call[1] as { action: { onClick: () => void } }).action.onClick());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({ psychSafetyLogs: [], sprints: [] });
});
afterEach(() => vi.useRealTimers());

/* ── The instrument ─────────────────────────────────────────────────── */

describe("the instrument", () => {
  it("is Edmondson's seven statements with q1, q3 and q5 reverse-scored, all required", () => {
    expect(PSYCH_SAFETY_QUESTIONS.filter((q) => q.reversed).map((q) => q.id)).toEqual([
      "q1",
      "q3",
      "q5",
    ]);
    const q = psychSafetyQuestionnaire();
    expect(questionnaireProblem(q)).toBeNull();
    expect(q.questions.some((x) => x.optional)).toBe(false);
    expect(PSYCH_SAFETY_SCALE.points.map((p) => p.value)).toEqual([1, 2, 3, 4, 5]);
    expect(PSYCH_SAFETY_MIN_RESPONSES).toBe(5);
  });

  it("scores a round from 5 responses, reverse-scoring the negative statements", () => {
    expect(roundResult(round("a", "2026-10-01", flat(4), 4))).toBeNull();
    const r = roundResult(round("a", "2026-10-01", flat(5, 4), 5))!;
    // Agreeing (4) with "mistakes are held against me" scores 2.
    expect(r.perQuestion.find((q) => q.id === "q1")).toMatchObject({ mean: 4, adjusted: 2 });
    expect(r.perQuestion.find((q) => q.id === "q2")).toMatchObject({ mean: 4, adjusted: 4 });
    expect(r.teamScore).toBeCloseTo((2 * 3 + 4 * 4) / 7);
    expect(["q1", "q3", "q5"]).toContain(r.lowest);
  });

  it("withholds a statement with fewer than 5 answers instead of reading it as zero", () => {
    const counts = { ...flat(6, 4), q7: [0, 0, 0, 3, 0] as PsychSafetyCounts };
    const r = roundResult(round("a", "2026-10-01", counts, 6))!;
    expect(r.withheld).toEqual(["q7"]);
    expect(r.perQuestion.find((q) => q.id === "q7")).toMatchObject({
      n: 3,
      mean: null,
      adjusted: null,
    });
    expect(r.teamScore).toBeCloseTo((2 * 3 + 4 * 3) / 6);
  });

  it("flags an anomaly per round: a statement falling by more than 0.5, both rounds from 5", () => {
    const ex = buildExample(new Date(2026, 9, 26)).rounds!;
    const cmp = compareRounds(ex[0], ex[1])!;
    expect(cmp.anomaly).toBe(true);
    expect(cmp.dropped).toEqual(["q1"]);
    expect(cmp.delta).toBeCloseTo(25.857142857 / 7 - 4);
    expect(compareRounds(round("a", "2026-10-01", flat(4), 4), ex[1])).toBeNull();
    const steady = compareRounds(
      round("a", "2026-10-01", flat(5), 5),
      round("b", "2026-10-08", flat(6), 6)
    )!;
    expect(steady).toMatchObject({ anomaly: false, dropped: [], delta: 0 });
  });

  it("folds the per-response list into one read-only legacy round, for the page and the agent alike", () => {
    const log: PsychSafetyLog = {
      id: PSYCH_SAFETY_ID,
      responses: [
        sheet("s1", "2026-09-01T09:00:00.000Z", 4, "Ana"),
        sheet("s2", "2026-09-02T09:00:00.000Z", 2.6, "Ben"),
      ],
      rounds: [round("r1", "2026-10-01", flat(5), 5)],
    };
    const rounds = roundsOf(log);
    expect(rounds.map((r) => r.id)).toEqual([LEGACY_ROUND_ID, "r1"]);
    expect(rounds[0]).toMatchObject({
      source: "legacy",
      responses: 2,
      date: "2026-09-02",
      name: "Earlier responses",
    });
    // Counts only: 2.6 rounds to 3, names and notes are never read.
    expect(rounds[0].counts.q1).toEqual([0, 0, 1, 1, 0]);
    expect(JSON.stringify(rounds[0])).not.toMatch(/Ana|Ben|Notes/);
    expect(countsFromAnswers([{ q1: 9 }, { q1: Number.NaN }]).q1).toEqual([0, 0, 0, 0, 1]);
    expect(withoutRound(log, LEGACY_ROUND_ID)?.responses).toEqual([]);
    expect(withoutRound(log, "nope")).toBeNull();
  });

  it("checks typed counts like the count entry: whole numbers, 5 people, no more answers than people", () => {
    expect(checkRoundCounts({ ...flat(5), q3: [1, 2] })).toMatchObject({ ok: false });
    expect(checkRoundCounts({ ...flat(5), q3: [1, 2, 0, 0, 1.5] })).toMatchObject({ ok: false });
    expect(checkRoundCounts(flat(4))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("at least 5 people"),
    });
    expect(checkRoundCounts(flat(6), 5)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("more answers"),
    });
    const ok = checkRoundCounts({ ...flat(6), q2: [0, 0, 2, 1, 0] });
    expect(ok).toMatchObject({ ok: true, responses: 6 });
    if (ok.ok) expect(ok.counts.q2).toEqual([0, 0, 0, 0, 0]);
  });

  it("reads a vote round's counts by each point's value, a withheld statement as unanswered", () => {
    const counts = countsFromVoteResult({
      scale: { id: "s", points: [...PSYCH_SAFETY_SCALE.points].reverse() },
      questions: [
        { id: "q1", text: "", responses: 5, distribution: [5, 0, 0, 0, 0] },
        { id: "q2", text: "", responses: 2, distribution: null },
      ],
    });
    expect(counts.q1).toEqual([0, 0, 0, 0, 5]);
    expect(counts.q2).toEqual([0, 0, 0, 0, 0]);
  });
});

/* ── Verdict, Markdown, prompts ─────────────────────────────────────── */

describe("the verdict, the export and the prompts", () => {
  const ex = buildExample(new Date(2026, 9, 26)).rounds!;

  it("say the score, its change and what fell most, with no benchmark", () => {
    expect(psychSafetyVerdict(ex)).toBe(
      "Team score 3.7/5 from 7 responses, down 0.3 since Spring check-in; “If I make a mistake on this team, it is held against me.” fell most."
    );
    expect(psychSafetyVerdict([round("a", "2026-10-01", flat(3), 3)])).toMatch(
      /results show from 5/
    );
    expect(psychSafetyVerdict([])).toMatch(/^No rounds yet/);
    const md = toMarkdown(ex, { now: new Date(2026, 9, 26) });
    expect(md).toContain("**Team score:** 3.69/5");
    expect(md).toContain("**Fell by more than 0.5 since Spring check-in:** Q1.");
    expect(md).toContain("| Spring check-in | 2026-09-14 | 6 | 4 |");
    expect(md).not.toMatch(/benchmark/i);
    const prompts = generatePsychSafetyPrompts(
      {
        roundName: "After",
        result: roundResult(ex[1]),
        previousName: "Spring",
        comparison: compareRounds(ex[0], ex[1]),
      },
      null
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[0].prompt).not.toMatch(/benchmark/i);
    expect(prompts[0].prompt).toContain('Change since "Spring": -0.31.');
  });

  it("validates a round's details, naming it Round N when left blank", () => {
    expect(
      validateRoundDetails({ name: " ", date: "2026-10-20" }, { today: "2026-10-26", log: null })
    ).toEqual({
      ok: true,
      values: { name: "Round 1", date: "2026-10-20" },
    });
    expect(
      validateRoundDetails({ name: "Q4", date: "2026-10-27" }, { today: "2026-10-26", log: null })
    ).toMatchObject({
      ok: false,
      errors: { date: "A round can't be dated in the future." },
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const tallyGroup = (n: number) =>
  within(screen.getByRole("group", { name: new RegExp(`^${n}\\. `) }));

describe("the page", () => {
  it("has no per-response form: no sliders, no respondent, nothing set by default", () => {
    renderPage();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Respondent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Submit response/ })).toBeNull();
    // The count entry starts blank.
    expect(tallyGroup(1).getByLabelText("Agree")).toHaveValue(null);
  });

  it("saves a round's counts from 5 responses, and Undo takes it out", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "October" } });
    fireEvent.change(screen.getByLabelText("Taken on"), { target: { value: "2026-10-20" } });
    for (let i = 1; i <= 7; i++)
      fireEvent.change(tallyGroup(i).getByLabelText("Agree"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Results show from 5 answers");
    for (let i = 1; i <= 7; i++)
      fireEvent.change(tallyGroup(i).getByLabelText("Agree"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));

    const saved = stored()!.rounds![0];
    expect(saved).toMatchObject({
      name: "October",
      date: "2026-10-20",
      source: "facilitator",
      responses: 5,
    });
    expect(saved.id).toMatch(/^psRound_/);
    expect(saved.counts.q1).toEqual([0, 0, 0, 5, 0]);
    expect(stored()!.responses).toEqual([]);
    expect(logs.find((l) => l.action === "assessment_saved")?.payload).toEqual({
      roundId: saved.id,
      responses: 5,
    });
    expect(screen.getByTestId("psych-safety-verdict")).toHaveTextContent(
      "Team score 3.1/5 from 5 responses"
    );

    undo("Saved the round");
    expect(stored()!.rounds).toEqual([]);
  });

  it("shows an older per-response list as the legacy round, without names, and deletes it with Undo", () => {
    seed({
      id: PSYCH_SAFETY_ID,
      responses: [1, 2, 3, 4, 5].map((i) =>
        sheet(`s${i}`, `2026-09-0${i}T09:00:00.000Z`, 4, `Person ${i}`)
      ),
    });
    renderPage();
    expect(screen.getAllByText("Earlier responses").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Person 1/)).toBeNull();
    expect(screen.getByTestId("export-markdown").textContent).not.toMatch(/Person|Notes by/);
    expect(screen.getByTestId("export-csv").textContent).not.toMatch(/Person|Notes by/);
    // Read-only: no name box for it.
    expect(
      screen.queryByRole("textbox", { name: /Name of the round Earlier responses/ })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete the round Earlier responses" }));
    expect(stored()!.responses).toEqual([]);
    // Its id only: nothing from the sheets.
    expect(logs.filter((l) => l.action === "round_removed")).toEqual([
      { action: "round_removed", payload: { roundId: LEGACY_ROUND_ID } },
    ]);
    undo("Deleted Earlier responses");
    expect(stored()!.responses).toHaveLength(5);
  });

  it("renames a round in place and deletes it with Undo", () => {
    seed({ id: PSYCH_SAFETY_ID, responses: [], rounds: [round("r1", "2026-10-01", flat(5), 5)] });
    renderPage();
    const name = screen.getByRole("textbox", { name: "Name of the round Round r1" });
    fireEvent.change(name, { target: { value: "Kick-off" } });
    fireEvent.blur(name);
    expect(stored()!.rounds![0].name).toBe("Kick-off");
    fireEvent.click(screen.getByRole("button", { name: "Delete the round Kick-off" }));
    expect(stored()!.rounds).toEqual([]);
    expect(logs.filter((l) => l.action === "round_removed")).toEqual([
      { action: "round_removed", payload: { roundId: "r1" } },
    ]);
    undo("Deleted Kick-off");
    expect(stored()!.rounds!.map((r) => r.id)).toEqual(["r1"]);
  });

  it("shows the example as a read-only preview, comparing its two rounds", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().psychSafetyLogs).toEqual([]);
    expect(screen.getByText(/One statement fell/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete the round After the incident" })
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Show totals" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("says a thin round needed more responses instead of showing a score", () => {
    seed({ id: PSYCH_SAFETY_ID, responses: [], rounds: [round("r1", "2026-10-01", flat(3), 3)] });
    renderPage();
    expect(screen.getByText(/needed 2 more responses to see its results/)).toBeInTheDocument();
  });
});

/* ── Agent actions ──────────────────────────────────────────────────── */

describe("tool.psych_safety", () => {
  const call = async <T,>(verb: string, params: Record<string, unknown> = {}) =>
    (await registry.get(`tool.psych_safety.${verb}`)!.handler(params, ctx())) as T;

  it("list_state returns rounds and comparisons, never answers per person or a benchmark", async () => {
    seed({
      id: PSYCH_SAFETY_ID,
      responses: [1, 2, 3, 4, 5].map((i) =>
        sheet(`s${i}`, `2026-09-0${i}T09:00:00.000Z`, 4, `Person ${i}`)
      ),
      rounds: buildExample(new Date(2026, 9, 26)).rounds,
    });
    const r = await call<
      Record<string, unknown> & {
        rounds: { id: string; source: string }[];
        comparison: { anomaly: boolean };
      }
    >("list_state");
    expect(r).not.toHaveProperty("responses");
    expect(r).not.toHaveProperty("benchmark");
    expect(JSON.stringify(r)).not.toMatch(/Person/);
    expect(r.rounds.map((x) => x.source)).toEqual(["legacy", "room", "room"]);
    expect(r.comparison.anomaly).toBe(true);
    expect(r.minResponses).toBe(5);
  });

  it("log_round validates like the page and saves counts only", async () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 1",
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          pointsPlanned: 0,
          pointsCompleted: 0,
          status: "completed",
        },
      ],
    });
    expect(await call("log_round", { name: "Q", counts: flat(4) })).toMatchObject({ added: false });
    expect(
      await call("log_round", { name: "Q", date: "2026-10-27", counts: flat(5) })
    ).toMatchObject({ added: false });
    expect(await call("log_round", { name: "Q", sprintId: "nope", counts: flat(5) })).toMatchObject(
      { added: false }
    );
    const ok = await call<{ added: boolean; id: string; teamScore: number }>("log_round", {
      name: "October",
      date: "2026-10-20",
      sprintId: "s1",
      counts: flat(5, 5),
    });
    expect(ok).toMatchObject({ added: true, teamScore: expect.any(Number) });
    expect(stored()!.rounds![0]).toMatchObject({
      name: "October",
      sprintId: "s1",
      source: "facilitator",
      responses: 5,
    });
    expect(await call("remove_round", { id: ok.id })).toEqual({ removed: true });
    expect(await call("remove_round", { id: ok.id })).toEqual({ removed: false });
  });

  it("log_response is refused toward log_round; remove_response still removes a legacy sheet", async () => {
    const r = await call<{ added: boolean; reason: string }>("log_response", {
      scores: Object.fromEntries(IDS.map((q) => [q, 3])),
    });
    expect(r.added).toBe(false);
    expect(r.reason).toContain("log_round");
    seed({ id: PSYCH_SAFETY_ID, responses: [sheet("s1", "2026-09-01T09:00:00.000Z", 4)] });
    expect(await call("remove_response", { id: "s1" })).toEqual({ removed: true });
    expect(stored()!.responses).toEqual([]);
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

/** Six statements from 5 people; q7 has 4 answers (one blank paper), so it is withheld. */
const sixShown = (point = 4): Counts => ({ ...flat(5, point), q7: [0, 0, 0, 4, 0] });

const csvRows = () =>
  (JSON.parse(screen.getByTestId("export-csv").textContent ?? "{}") as { rows: unknown[][] }).rows;

describe("review fixes", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  });

  it("the CSV withholds the counts the page withholds: a thin round, a thin statement", () => {
    seed({
      id: PSYCH_SAFETY_ID,
      // Two answer sheets from before rounds: their counts would be two people's answers.
      responses: [
        sheet("s1", "2026-09-01T09:00:00.000Z", 2),
        sheet("s2", "2026-09-02T09:00:00.000Z", 5),
      ],
      rounds: [round("r1", "2026-10-01", sixShown(), 5)],
    });
    renderPage();
    const rows = csvRows();
    const legacy = rows.filter((r) => r[0] === "Earlier responses");
    expect(legacy).toHaveLength(7);
    for (const r of legacy) expect(r.slice(5, 10)).toEqual(["—", "—", "—", "—", "—"]);
    const r1 = rows.filter((r) => r[0] === "Round r1");
    expect(r1[0].slice(5, 10)).toEqual([0, 0, 0, 5, 0]);
    // q7 had 4 answers: withheld, like its score.
    expect(r1[6].slice(5, 11)).toEqual(["—", "—", "—", "—", "—", "—"]);
  });

  it("scores the statements that show and says how many; compares over the shared ones", () => {
    const full = round("a", "2026-10-01", flat(5, 4), 5);
    const six = round("b", "2026-10-15", sixShown(3), 5);
    const res = roundResult(six)!;
    expect(res.covered).toBe(6);
    const cmp = compareRounds(full, six)!;
    expect(cmp.common).toEqual(IDS.slice(0, 6));
    // Each shared statement's change averaged: q1, q3, q5 reverse-scored go up by 1, the rest down by 1.
    const expected =
      cmp.perQuestion.filter((q) => q.delta !== null).reduce((s, q) => s + (q.delta as number), 0) /
      6;
    expect(cmp.delta).toBeCloseTo(expected);
    // All seven in both: exactly the change in team score.
    const both = compareRounds(full, round("c", "2026-10-20", flat(5, 5), 5))!;
    expect(both.delta).toBeCloseTo(
      roundResult(round("c", "2026-10-20", flat(5, 5), 5))!.teamScore! -
        roundResult(full)!.teamScore!
    );
    expect(both.common).toHaveLength(7);

    expect(psychSafetyVerdict([full, six])).toMatch(
      /^Team score [\d.]+\/5 \(6 of 7 statements\) from 5 responses, (down|up|level).* \(over the 6 statements both show\)/
    );
    seed({ id: PSYCH_SAFETY_ID, responses: [], rounds: [full, six] });
    renderPage();
    expect(screen.getByText("Over 6 of 7 statements; higher is safer")).toBeInTheDocument();
    expect(screen.getByText("Over the 6 statements both show")).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "over 6 of 7 statements: the others are withheld"
    );
  });

  it("sends a fall to the retro as a team-level topic, once", () => {
    const ex = buildExample(new Date(2026, 9, 26)).rounds!;
    seed({ id: PSYCH_SAFETY_ID, responses: [], rounds: ex });
    renderPage();
    const send = screen.getByRole("button", { name: /^Send to… Psych safety:/ });
    fireEvent.keyDown(send, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro topic (no names)" }));
    const cards = useWorkspaceStore.getState().retroBoards?.[0]?.cards ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0].text).toMatch(/^Psych safety: .* fell by more than 0\.5 since /);
    expect(cards[0].sourceRef).toMatchObject({ tool: "psych-safety", id: ex[ex.length - 1].id });
    const latest = stored()!.rounds!.find((r) => r.id === ex[ex.length - 1].id)!;
    expect(latest.sentTo).toHaveLength(1);
    expect(screen.getByRole("button", { name: /\(sent\)$/ })).toBeInTheDocument();
  });

  it("keeps a round's day as typed until the field is left, so the list doesn't move", () => {
    seed({
      id: PSYCH_SAFETY_ID,
      responses: [],
      rounds: [round("r1", "2026-10-01", flat(5), 5), round("r2", "2026-10-10", flat(5), 5)],
    });
    renderPage();
    const day = screen.getByLabelText(/Date of the round Round r1/);
    fireEvent.change(day, { target: { value: "2026-10-20" } });
    // Not stored while typing: the order stays.
    expect(stored()!.rounds!.find((r) => r.id === "r1")!.date).toBe("2026-10-01");
    fireEvent.blur(day);
    expect(stored()!.rounds!.find((r) => r.id === "r1")!.date).toBe("2026-10-20");
    const r2 = screen.getByLabelText(/Date of the round Round r2/);
    fireEvent.change(r2, { target: { value: "2026-11-02" } });
    fireEvent.keyDown(r2, { key: "Enter" });
    expect(stored()!.rounds!.find((r) => r.id === "r2")!.date).toBe("2026-10-10");
    expect(screen.getByText("A round can't be dated in the future.")).toBeInTheDocument();
  });

  it("says why a cleared round name isn't kept", () => {
    seed({ id: PSYCH_SAFETY_ID, responses: [], rounds: [round("r1", "2026-10-01", flat(5), 5)] });
    renderPage();
    const name = screen.getByRole("textbox", { name: "Name of the round Round r1" });
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(screen.getByText("Name the round.")).toBeInTheDocument();
    expect(stored()!.rounds![0].name).toBe("Round r1");
  });

  it("asks for a round to compare from when To is the first round", () => {
    seed({
      id: PSYCH_SAFETY_ID,
      responses: [],
      rounds: [round("r1", "2026-10-01", flat(5), 5), round("r2", "2026-10-10", flat(5), 5)],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "r1" } });
    expect(screen.getByText("Pick a round to compare from.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveDisplayValue("Pick a round");
  });

  it("a round's sprint can be cleared, and the next round starts without it", () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "s1",
          name: "Sprint 1",
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          pointsPlanned: 0,
          pointsCompleted: 0,
          status: "completed",
        },
      ],
    });
    renderPage();
    const pick = () => {
      fireEvent.pointerDown(screen.getByRole("combobox", { name: "Sprint (optional)" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
      fireEvent.click(
        within(screen.getByRole("listbox")).getByRole("option", { name: /^Sprint 1/ })
      );
    };
    pick();
    fireEvent.click(screen.getByRole("button", { name: "No sprint" }));
    expect(screen.queryByRole("button", { name: "No sprint" })).toBeNull();
    const picker = screen.getByRole("combobox", { name: "Sprint (optional)" });
    expect(picker).toHaveTextContent("Choose a sprint");
    expect(document.activeElement).toBe(picker);
    // The same sprint can be picked again.
    pick();
    expect(screen.getByRole("button", { name: "No sprint" })).toBeInTheDocument();
    for (let i = 1; i <= 7; i++)
      fireEvent.change(tallyGroup(i).getByLabelText("Agree"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(stored()!.rounds![0].sprintId).toBe("s1");
    expect(screen.queryByRole("button", { name: "No sprint" })).toBeNull();
  });

  it("puts focus on the next round after a delete", () => {
    seed({
      id: PSYCH_SAFETY_ID,
      responses: [],
      rounds: [round("r1", "2026-10-01", flat(5), 5), round("r2", "2026-10-10", flat(5), 5)],
    });
    renderPage();
    // Newest first: deleting r2 moves focus to r1's Delete; the last one to the round name.
    fireEvent.click(screen.getByRole("button", { name: "Delete the round Round r2" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete the round Round r1" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete the round Round r1" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Round name"));
  });

  it("keeps a round dated today on today past midnight", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 30));
    renderPage();
    expect(screen.getByLabelText("Taken on")).toHaveValue("2026-10-26");
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 27, 0, 0, 40));
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByLabelText("Taken on")).toHaveValue("2026-10-27");
  });

  it("refuses a round it can't save, says why, and keeps Save round available", () => {
    renderPage();
    for (let i = 1; i <= 7; i++)
      fireEvent.change(tallyGroup(i).getByLabelText("Agree"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    // The clock moved back a day: the round's day (today, as it was) is now in the future.
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(toastSpy.error).toHaveBeenCalledWith(
      "A round can't be dated in the future. Nothing was saved."
    );
    expect(stored()?.rounds ?? []).toEqual([]);
    expect(screen.queryByRole("button", { name: "Round saved" })).toBeNull();
    expect(toastSpy).not.toHaveBeenCalledWith("Saved the round", expect.anything());
    // Once the day is fine again, the same totals save.
    vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(stored()!.rounds).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Round saved" })).toBeDisabled();
  });
});
