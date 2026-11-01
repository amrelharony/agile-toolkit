import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Assumption, Hypothesis } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import { RA_ID, rankAssumptions } from "@/lib/assumptions/model";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { registry } from "@/lib/actions/registry";
import { LEGACY_RISKIEST, RISKIEST } from "../stores/phase8-fixtures";

/**
 * Riskiest Assumption, upgraded (Phase 8): ratings start unset, and an
 * unrated assumption waits under "Not rated" (never ranked or placed);
 * the ranking and the matrix come from lib/assumptions, the same as the
 * agent's; a tested assumption leaves the ranking (an inconclusive test
 * keeps it there); "Test" makes a linked hypothesis, and its result is
 * offered as one click, never applied on its own; the ranking holds still
 * while ratings change; delete with Undo; an example and a Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
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

import { RiskiestAssumptionClient } from "@/app/(tools)/riskiest-assumption/riskiest-assumption-client";
import { buildExample } from "@/app/(tools)/riskiest-assumption/example";
import { assumptionsToMarkdown } from "@/app/(tools)/riskiest-assumption/markdown";
import {
  applyAssumptionValues,
  emptyAssumptionDraft,
  validateAssumption,
} from "@/app/(tools)/riskiest-assumption/form";
import {
  assumptionsVerdict,
  canvasView,
  offeredStatus,
} from "@/app/(tools)/riskiest-assumption/view";
import "@/lib/actions/tools/riskiest-assumption";

const TODAY = todayLocalISO();

const as = (id: string, statement: string, over: Partial<Assumption> = {}): Assumption => ({
  id,
  statement,
  status: "untested",
  ...over,
});
const hyp = (id: string, status: Hypothesis["status"]): Hypothesis => ({
  id,
  believe: "b",
  willDo: "w",
  toLearn: "l",
  successMetric: "s",
  status,
  raisedAt: TODAY,
});
const link = (targetId: string) => [{ route: "hypothesis" as const, targetId, at: "2026-10-20" }];

const ws = () => useWorkspaceStore.getState();
const stored = () =>
  (ws().riskiestAssumptions ?? []).find((d) => d.id === RA_ID)?.assumptions ?? [];
const one = (id: string) => stored().find((a) => a.id === id);
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const seed = (list: Assumption[], hs: Hypothesis[] = []) =>
  useWorkspaceStore.setState({
    riskiestAssumptions: list.length > 0 ? [{ id: RA_ID, assumptions: list }] : [],
    hypothesisTrackers: hs.length > 0 ? [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: hs }] : [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RiskiestAssumptionClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (statement: string) => screen.getByRole("article", { name: statement });
const section = (name: string) => screen.getByRole("list", { name });
const rankedTitles = () =>
  within(section("Ranked assumptions, test the first one first"))
    .getAllByRole("article")
    .map((a) => a.querySelector("h3")?.textContent);
const pick = (scope: HTMLElement, scale: "Risk" | "Evidence", value: number) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: scale })).getByRole("radio", {
      name: String(value),
    })
  );
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.riskiest_assumption.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  seed([]);
});

/* ── The rules ──────────────────────────────────────────────────────── */

describe("the form and the reading of the canvas", () => {
  it("starts unrated and saves unrated, never a 3", () => {
    expect(emptyAssumptionDraft()).toMatchObject({ riskLevel: null, evidenceLevel: null });
    const v = validateAssumption({ ...emptyAssumptionDraft(), statement: " Users read docs " });
    expect(v).toEqual({
      ok: true,
      values: {
        statement: "Users read docs",
        riskLevel: undefined,
        evidenceLevel: undefined,
        testIdea: undefined,
        description: undefined,
      },
    });
    const a = applyAssumptionValues(as("x", ""), v.ok ? v.values : ({} as never));
    expect(a).not.toHaveProperty("riskLevel");
    expect(validateAssumption(emptyAssumptionDraft()).ok).toBe(false);
  });

  it("ranks by risk × (6 − evidence), ties to higher risk, then lower evidence", () => {
    const view = canvasView(
      [
        as("a", "A", { riskLevel: 4, evidenceLevel: 2 }), // 16
        as("b", "B", { riskLevel: 5, evidenceLevel: 3 }), // 15
        as("c", "C", { riskLevel: 2, evidenceLevel: 1 }), // 10
        as("d", "D", { riskLevel: 5, evidenceLevel: 4 }), // 10, higher risk
        as("u", "U", { riskLevel: 5 }),
      ],
      []
    );
    expect(view.ranked.map((r) => [r.assumption.id, r.score])).toEqual([
      ["a", 16],
      ["b", 15],
      ["d", 10],
      ["c", 10],
    ]);
    expect(view.unrated.map((a) => a.id)).toEqual(["u"]);
    expect(view.quadrants["test-first"].map((a) => a.id)).toEqual(["a", "b"]);
    expect(view.quadrants.monitor.map((a) => a.id)).toEqual(["d"]);
    expect(view.quadrants.defer.map((a) => a.id)).toEqual(["c"]);
    expect(assumptionsVerdict(view)).toBe(
      "Test “A” first: risk 4, evidence 2, score 16. 1 assumption isn't rated yet."
    );
  });

  it("takes a tested assumption out of the ranking, but not an inconclusive one", () => {
    const list = [
      as("own", "Own status", { riskLevel: 5, evidenceLevel: 1, status: "validated" }),
      as("hyp", "By hypothesis", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") }),
      as("inc", "Inconclusive", { riskLevel: 3, evidenceLevel: 3, sentTo: link("h2") }),
    ];
    const hs = [hyp("h1", "invalidated"), hyp("h2", "inconclusive")];
    const view = canvasView(list, hs);
    expect(view.ranked.map((r) => r.assumption.id)).toEqual(["inc"]);
    expect(view.tested.map((a) => a.id)).toEqual(["own", "hyp"]);
    // The hypothesis's result is offered, never written.
    expect(offeredStatus(list[1], hs)).toBe("invalidated");
    expect(offeredStatus(list[0], hs)).toBeNull();
    expect(offeredStatus(list[2], hs)).toBeNull();
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("adding and rating", () => {
  it("adds an unrated assumption to Not rated, out of the ranking and the matrix", () => {
    seed([as("r", "Rated one", { riskLevel: 4, evidenceLevel: 2 })]);
    renderPage();
    const form = screen.getByLabelText(/^Assumption/).closest("form")!;
    fireEvent.click(within(form).getByRole("button", { name: "Add assumption" }));
    expect(stored()).toHaveLength(1);
    fireEvent.change(within(form).getByLabelText(/^Assumption/), {
      target: { value: "Admins want SSO" },
    });
    fireEvent.submit(form);
    expect(one(stored()[1].id)).not.toHaveProperty("riskLevel");
    expect(
      within(section("Assumptions not rated yet")).getByRole("article", { name: "Admins want SSO" })
    ).toBeInTheDocument();
    expect(rankedTitles()).toEqual(["Rated one"]);
    expect(screen.queryByRole("region", { name: /Test first/ })?.textContent ?? "").not.toContain(
      "Admins want SSO"
    );
  });

  it("adds a rated one with the ratings picked, and Clear sends it back to Not rated", () => {
    renderPage();
    const form = screen.getByLabelText(/^Assumption/).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Assumption/), {
      target: { value: "Teams pay" },
    });
    pick(form, "Risk", 5);
    pick(form, "Evidence", 1);
    fireEvent.click(within(form).getByRole("button", { name: "Add assumption" }));
    const a = stored()[0];
    expect(a).toMatchObject({ riskLevel: 5, evidenceLevel: 1, status: "untested" });
    expect(within(card("Teams pay")).getByText("#1 · score 25")).toBeInTheDocument();
    fireEvent.click(within(card("Teams pay")).getByRole("button", { name: "Clear Risk" }));
    expect(one(a.id)).not.toHaveProperty("riskLevel");
    expect(
      within(card("Teams pay")).getByText("Not rated", { selector: "span" })
    ).toBeInTheDocument();
  });

  it("holds the ranking still while a rating changes, until Re-sort", () => {
    seed([
      as("a", "First", { riskLevel: 5, evidenceLevel: 1 }),
      as("b", "Second", { riskLevel: 3, evidenceLevel: 3 }),
    ]);
    renderPage();
    expect(rankedTitles()).toEqual(["First", "Second"]);
    pick(card("First"), "Risk", 1);
    expect(one("a")?.riskLevel).toBe(1);
    expect(rankedTitles()).toEqual(["First", "Second"]);
    expect(within(card("First")).getByText("#2 · score 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(rankedTitles()).toEqual(["Second", "First"]);
  });

  it("edits the words in place and keeps a statement from being cleared", () => {
    seed([as("a", "Users read docs", { riskLevel: 7 as never, evidenceLevel: 2 })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Users read docs" }));
    const input = screen
      .getAllByLabelText(/^Assumption/)
      .find((el) => (el as HTMLInputElement).value === "Users read docs")!;
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(one("a")?.statement).toBe("Users read docs");
    fireEvent.change(input, { target: { value: "Users read the changelog" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // The off-scale legacy rating stays as stored; the words changed.
    expect(one("a")).toMatchObject({ statement: "Users read the changelog", riskLevel: 7 });
    expect(
      within(card("Users read the changelog")).getByText(/Stored as 7: ranked as 5/)
    ).toBeInTheDocument();
  });

  it("keeps a legacy pair of 3s rated, and the fixture's unrated row unranked", () => {
    seed([...LEGACY_RISKIEST.assumptions, ...RISKIEST.assumptions], []);
    renderPage();
    expect(rankedTitles()).toEqual([
      "Teams will pay for a second seat",
      "Users read the changelog",
    ]);
    expect(
      within(section("Assumptions not rated yet")).getByRole("article", {
        name: "Admins want SSO on day one",
      })
    ).toBeInTheDocument();
  });
});

describe("testing an assumption", () => {
  it("makes one drafted hypothesis with the mapping and a link; Undo takes both back", () => {
    seed([
      as("a", "We believe teams will pay", {
        riskLevel: 5,
        evidenceLevel: 1,
        testIdea: "A fake-door button",
        description: "Pricing interviews split",
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Test We believe teams will pay" }));
    expect(hypotheses()).toHaveLength(1);
    const h = hypotheses()[0];
    expect(h).toMatchObject({
      status: "drafted",
      believe: "teams will pay",
      willDo: "A fake-door button",
      toLearn: "Pricing interviews split",
      successMetric: "",
      sourceRef: { tool: "riskiest-assumption", id: "a", doc: RA_ID },
    });
    expect(one("a")).toMatchObject({
      status: "untested",
      sentTo: [expect.objectContaining({ targetId: h.id })],
    });
    // Sent once: the button gives way to the link.
    expect(screen.queryByRole("button", { name: /^Test We believe/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: /Testing \(drafted\) · Open hypothesis/ })
    ).toHaveAttribute("href", "/hypothesis-tracker");
    undoLast();
    expect(hypotheses()).toHaveLength(0);
    expect(one("a")?.sentTo ?? []).toEqual([]);
    expect(screen.getByRole("button", { name: "Test We believe teams will pay" })).toBeEnabled();
  });

  it("offers the hypothesis's result as one click, and only then leaves the status changed", () => {
    seed(
      [as("a", "Teams will pay", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") })],
      [hyp("h1", "running")]
    );
    renderPage();
    expect(rankedTitles()).toEqual(["Teams will pay"]);
    act(() => {
      ws().upsertHypothesisTracker({
        id: HYPOTHESIS_TRACKER_ID,
        hypotheses: [{ ...hyp("h1", "validated"), resolvedAt: TODAY }],
      });
    });
    // Tested by its hypothesis: out of the ranking, status untouched.
    expect(
      within(section("Tested assumptions")).getByRole("article", { name: "Teams will pay" })
    ).toBeInTheDocument();
    expect(one("a")?.status).toBe("untested");
    fireEvent.click(screen.getByRole("button", { name: "Mark validated: “Teams will pay”" }));
    expect(one("a")?.status).toBe("validated");
    expect(screen.queryByRole("button", { name: /^Mark validated/ })).toBeNull();
  });

  it("keeps an inconclusive test in the ranking with a note to test again", () => {
    seed(
      [as("a", "Teams will pay", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") })],
      [hyp("h1", "inconclusive")]
    );
    renderPage();
    expect(rankedTitles()).toEqual(["Teams will pay"]);
    expect(
      within(card("Teams will pay")).getByRole("link", { name: /Inconclusive: test again/ })
    ).toBeInTheDocument();
  });

  it("the agent ranks the (5,3) / (4,2) pair as the page does", async () => {
    seed([
      as("p", "Five-three", { riskLevel: 5, evidenceLevel: 3 }),
      as("q", "Four-two", { riskLevel: 4, evidenceLevel: 2 }),
    ]);
    const agent = await run<{ riskiest: { id: string; score: number } | null }>("list_state");
    expect(agent.riskiest).toMatchObject({ id: "q", score: 16 });
    renderPage();
    expect(rankedTitles()[0]).toBe("Four-two");
    expect(rankAssumptions(stored()).ranked[0].assumption.id).toBe(agent.riskiest?.id);
  });

  it("the agent's test makes the hypothesis the page would, and then the page shows it sent", async () => {
    seed([as("a", "Teams will pay", { riskLevel: 5, evidenceLevel: 1, testIdea: "Fake door" })]);
    const sent = await run<{ sent: boolean; hypothesisId: string }>("test_assumption", {
      assumptionId: "a",
    });
    expect(sent.sent).toBe(true);
    expect(hypotheses()[0]).toMatchObject({
      believe: "Teams will pay",
      willDo: "Fake door",
      sourceRef: { tool: "riskiest-assumption", id: "a", doc: RA_ID },
    });
    renderPage();
    expect(screen.queryByRole("button", { name: "Test Teams will pay" })).toBeNull();
    expect(await run<{ reason: string }>("test_assumption", { assumptionId: "a" })).toMatchObject({
      reason: "already_sent",
    });
  });
});

describe("delete, example and export", () => {
  it("deletes with Undo, back in its place", () => {
    seed([
      as("a", "One", { riskLevel: 5, evidenceLevel: 1 }),
      as("b", "Two", { riskLevel: 4, evidenceLevel: 1 }),
      as("c", "Three"),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Two" }));
    expect(stored().map((a) => a.id)).toEqual(["a", "c"]);
    undoLast();
    expect(stored().map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("offers the example from the empty state; its items can't be tested; it clears alone", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored()).toHaveLength(6);
    expect(stored().every((a) => isExampleId(a.id))).toBe(true);
    expect(rankedTitles()).toHaveLength(4);
    expect(within(section("Assumptions not rated yet")).getAllByRole("article")).toHaveLength(1);
    expect(within(section("Tested assumptions")).getAllByRole("article")).toHaveLength(1);
    for (const b of screen.getAllByRole("button", { name: /^Test / })) expect(b).toBeDisabled();
    act(() => {
      ws().upsertRiskiestAssumption({ id: RA_ID, assumptions: [...stored(), as("mine", "Mine")] });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((a) => a.id)).toEqual(["mine"]);
  });

  it("the example fills every quadrant", () => {
    const view = canvasView(buildExample(), []);
    for (const q of ["test-first", "monitor", "defer", "solid"] as const) {
      expect(view.quadrants[q], q).toHaveLength(1);
    }
  });

  it("exports Markdown with the verdict, the ranking, Not rated and Tested", () => {
    const list = [
      as("a", "Teams pay", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") }),
      as("u", "Admins want SSO"),
      as("v", "Trials needed", { status: "validated" }),
    ];
    const md = assumptionsToMarkdown(list, [hyp("h1", "running")]);
    expect(md).toContain("# Riskiest assumptions");
    expect(md).toContain(
      "> Test “Teams pay” first: risk 5, evidence 1, score 25. 1 assumption isn't rated yet."
    );
    expect(md).toContain("| 1 | Teams pay | 5 | 1 | 25 | Untested | testing (running) |");
    expect(md).toContain("## Not rated\n\n- Admins want SSO");
    expect(md).toContain("## Tested\n\n- Trials needed: validated");
    expect(assumptionsToMarkdown([], [])).toContain("No assumptions yet.");
  });
});

describe("after review", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  });
  afterEach(() => vi.unstubAllGlobals());
  /** Runs the frames the page asked for, after React has rendered. */
  const nextFrame = () => act(() => frames.splice(0).forEach((f) => f(0)));
  const radio = (scope: HTMLElement, scale: "Risk" | "Evidence", value: number) =>
    within(within(scope).getByRole("radiogroup", { name: scale })).getByRole("radio", {
      name: String(value),
    });

  it("ranks the team's rows apart from the example, as the agent does", async () => {
    seed([
      ...buildExample(),
      as("mine", "Our buyers read the changelog", { riskLevel: 3, evidenceLevel: 2 }),
    ]);
    const agent = await run<{ riskiest: { id: string } | null; ranking: { id: string }[] }>(
      "list_state"
    );
    renderPage();
    expect(agent.riskiest?.id).toBe("mine");
    expect(rankedTitles()).toEqual(["Our buyers read the changelog"]);
    expect(screen.getByText(/^Test “Our buyers read the changelog” first/)).toBeInTheDocument();
    expect(
      within(card("Our buyers read the changelog")).getByText("#1 · score 12")
    ).toBeInTheDocument();
    // The example sits apart, ranked among itself, and counts for nothing above.
    const examples = within(section("Example assumptions, not counted")).getAllByRole("article");
    expect(examples).toHaveLength(6);
    expect(screen.queryByText("(the example)")).toBeNull();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("_The example's 6 assumptions are left out._");
    expect(md).toContain("| 1 | Our buyers read the changelog |");
    expect(agent.ranking.map((r) => r.id)).toEqual(["mine"]);
  });

  it("ranks the example while it is alone, and says the numbers are the example's", () => {
    seed(buildExample());
    renderPage();
    expect(screen.getByText("(the example)")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Example assumptions, not counted" })).toBeNull();
  });

  it("doesn't count an assumption its hypothesis is testing as untested", () => {
    const list = [
      as("a", "Being tested", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") }),
      as("b", "Not tested", { riskLevel: 4, evidenceLevel: 2 }),
    ];
    expect(canvasView(list, [hyp("h1", "running")]).untestedRisky).toBe(1);
    expect(canvasView(list, []).untestedRisky).toBe(2);
  });

  it("follows a card into Ranked with focus when its second rating is picked", () => {
    seed([as("u", "Admins want SSO", { riskLevel: 4 })]);
    renderPage();
    const five = radio(card("Admins want SSO"), "Evidence", 2);
    five.focus();
    fireEvent.click(five);
    nextFrame();
    const moved = within(section("Ranked assumptions, test the first one first")).getByRole(
      "article",
      { name: "Admins want SSO" }
    );
    expect(document.activeElement).toBe(radio(moved, "Evidence", 2));
  });

  it("follows a card back to Not rated when a rating is cleared", () => {
    seed([as("r", "Teams pay", { riskLevel: 5, evidenceLevel: 1 })]);
    renderPage();
    fireEvent.click(within(card("Teams pay")).getByRole("button", { name: "Clear Risk" }));
    nextFrame();
    const moved = within(section("Assumptions not rated yet")).getByRole("article", {
      name: "Teams pay",
    });
    expect(document.activeElement).toBe(
      within(within(moved).getByRole("radiogroup", { name: "Risk" })).getAllByRole("radio")[0]
    );
  });

  it("follows a card into Tested with focus on its status, and after Mark", () => {
    seed(
      [
        as("a", "Teams will pay", { riskLevel: 5, evidenceLevel: 1, sentTo: link("h1") }),
        as("b", "Admins want SSO", { riskLevel: 4, evidenceLevel: 2 }),
      ],
      [{ ...hyp("h1", "validated"), resolvedAt: TODAY }]
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Mark validated: “Teams will pay”" }));
    nextFrame();
    expect(document.activeElement).toBe(
      within(card("Teams will pay")).getByLabelText("Status of Teams will pay")
    );
    // The select being changed has focus, and goes with the card's old place.
    const select = within(card("Admins want SSO")).getByLabelText("Status of Admins want SSO");
    select.focus();
    fireEvent.change(select, { target: { value: "invalidated" } });
    nextFrame();
    const tested = within(section("Tested assumptions")).getByRole("article", {
      name: "Admins want SSO",
    });
    expect(document.activeElement).toBe(within(tested).getByLabelText("Status of Admins want SSO"));
  });

  it("moves focus to the hypothesis link once Test makes one", () => {
    seed([as("a", "Teams will pay", { riskLevel: 5, evidenceLevel: 1 })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Test Teams will pay" }));
    nextFrame();
    expect(document.activeElement).toBe(
      within(card("Teams will pay")).getByRole("link", { name: /Testing \(drafted\)/ })
    );
  });

  it("moves focus to the next card after a delete, and to the form after the last", () => {
    seed([
      as("a", "One", { riskLevel: 5, evidenceLevel: 1 }),
      as("b", "Two", { riskLevel: 4, evidenceLevel: 1 }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete One" }));
    nextFrame();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Two" }));
    nextFrame();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Assumption/));
  });

  it("leaves focus alone when the control that had it is still there", () => {
    seed([
      as("a", "One", { riskLevel: 3, evidenceLevel: 3 }),
      as("b", "Two", { riskLevel: 2, evidenceLevel: 2 }),
    ]);
    renderPage();
    const other = screen.getByRole("button", { name: "Edit Two" });
    other.focus();
    fireEvent.click(radio(card("One"), "Risk", 4));
    nextFrame();
    expect(document.activeElement).toBe(other);
  });
});
