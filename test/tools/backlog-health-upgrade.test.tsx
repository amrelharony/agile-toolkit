/**
 * Backlog Health against the tool UX contract: an empty state with an
 * in-memory example; the DEEP scan of the workspace's backlog with plain
 * reasons; per-story flags with fixes in place (points, criteria both
 * ways, splits) and Drop with Undo; the review without AI, each suggestion
 * added through the story with Undo; the settings checked first; the export
 * holding both kinds of criteria; and the history it logs.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/backlog-health",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    markdown,
    csvData,
  }: {
    markdown?: string;
    csvData?: { headers: string[]; rows: unknown[][] };
  }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
    </>
  ),
}));

import { BacklogHealthClient } from "@/app/(tools)/backlog-health/backlog-health-client";
import { buildExample } from "@/app/(tools)/backlog-health/example";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  useBacklogHealthSettings,
  validatePoints,
  validateSettings,
} from "@/app/(tools)/backlog-health/store";
import { BACKLOG_HEALTH_ACTIONS } from "@/lib/history/event-actions";
import { backlogForHealth, backlogHealth } from "@/lib/backlog/health";

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  points: 3,
  acceptanceCriteria: "Charged once.",
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  backlogRank: 1,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const find = (id: string) => ws().stories.find((s) => s.id === id);
const seed = (stories: Story[]) => useWorkspaceStore.setState({ stories, backlogItems: [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <BacklogHealthClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const row = (id: string) => document.querySelector(`[data-story="${id}"]`) as HTMLElement;

const BIG = () =>
  story({ id: "big", title: "Import orders from CSV and Excel files", points: 21, backlogRank: 2 });
const VAGUE = () =>
  story({
    id: "vague",
    title: "Reports",
    points: undefined,
    acceptanceCriteria: undefined,
    backlogRank: 3,
  });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  localStorage.clear();
  useBacklogHealthSettings.setState(DEFAULT_SETTINGS);
  seed([]);
});

describe("empty state and example", () => {
  it("says there is nothing to check and offers an example in memory", async () => {
    renderPage();
    expect(await screen.findByText(/The backlog is empty/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example backlog" }));
    expect(screen.getByText(/The example backlog stays on this page/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "The four DEEP checks" })).toBeInTheDocument();
    // A fix in the example stays in it.
    const reports = document.querySelector('[data-story="example-reports"]') as HTMLElement;
    fireEvent.click(within(reports).getByRole("button", { name: /^Drop/ }));
    expect(ws().stories).toEqual([]);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(await screen.findByText(/The backlog is empty/)).toBeInTheDocument();
  });

  it("offers to add stories in Sprint Planning when the backlog is empty", async () => {
    renderPage();
    expect(
      await screen.findByRole("link", { name: "Add stories in Sprint Planning" })
    ).toHaveAttribute("href", "/sprint-planning");
  });

  it("keeps the review and its fixes in the example", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "See an example backlog" }));
    fireEvent.click(screen.getByRole("button", { name: "Review by the rules" }));
    const list = screen.getByRole("region", { name: "Splits and scenarios to add" });
    fireEvent.click(within(list).getAllByRole("button", { name: /^Add:/ })[0]);
    expect(ws().stories).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("builds a backlog with every kind of flag", () => {
    const stories = buildExample(new Date("2026-11-12T00:00:00Z"));
    const h = backlogHealth(backlogForHealth(stories, [], { withExamples: true }), {
      today: "2026-11-12",
    });
    const flags = new Set(h.stories.flatMap((s) => s.flags.map((f) => f.id)));
    expect(Array.from(flags).sort()).toEqual([
      "no-criteria",
      "no-points",
      "stale",
      "too-big",
      "vague",
    ]);
    expect(stories.every((s) => s.id.startsWith("example-"))).toBe(true);
  });
});

describe("the scan", () => {
  it("reads the workspace's backlog and shows the score, the checks and the reasons", async () => {
    seed([
      story(),
      BIG(),
      VAGUE(),
      story({ id: "planned", sprintId: "s1", status: "todo", title: "Fix" }),
    ]);
    renderPage();
    const checks = await screen.findByRole("list", { name: "The four DEEP checks" });
    expect(
      Array.from(checks.querySelectorAll(":scope > li")).map((li) => li.getAttribute("data-check"))
    ).toEqual(["detailed", "estimated", "emergent", "prioritized"]);
    expect(within(checks).getByText("1 has no points yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /DEEP score \d+%/ })).toBeInTheDocument();
    // Only backlog stories: the planned one isn't flagged here.
    expect(row("planned")).toBeNull();
    expect(logs[0]).toMatchObject({ action: BACKLOG_HEALTH_ACTIONS.SCAN_RAN });
    expect(logs[0].payload).toMatchObject({ flagged: 2 });
  });

  it("shows each story's place in the backlog order, and the top the settings give", async () => {
    useBacklogHealthSettings.setState({ topN: 5, tooBigPoints: 13, staleWeeks: 8 });
    seed([story(), VAGUE()]);
    renderPage();
    expect(await within(row("vague")).findByText("2")).toBeInTheDocument();
    expect(within(row("vague")).getByText("Place")).toHaveClass("sr-only");
    expect(
      screen.getByText(/Only the top 5 need acceptance criteria and points/)
    ).toBeInTheDocument();
  });

  it("lists flagged stories, with every story one click away", async () => {
    seed([story(), BIG(), VAGUE()]);
    renderPage();
    await screen.findByText("Stories to look at");
    expect(row("st1")).toBeNull();
    expect(within(row("vague")).getByText("Vague title")).toBeInTheDocument();
    expect(within(row("big")).getByText("Too big")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All 3 stories" }));
    expect(row("st1")).not.toBeNull();
    expect(within(row("st1")).getByText("No flags.")).toBeInTheDocument();
  });
});

describe("fixing a story", () => {
  it("gives it points, saying what is wrong with a bad value", async () => {
    seed([VAGUE()]);
    renderPage();
    const input = await screen.findByLabelText("Points for Reports");
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.blur(input);
    expect(screen.getByText("Points are a number from 0 to 1,000.")).toBeInTheDocument();
    expect(find("vague")?.points).toBeUndefined();
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(find("vague")?.points).toBe(5);
    expect(logs.at(-1)).toMatchObject({ action: BACKLOG_HEALTH_ACTIONS.STORY_UPDATED });
  });

  it("writes Given/When/Then on it beside the free text", async () => {
    seed([VAGUE()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Criteria and details" }));
    fireEvent.click(screen.getByRole("button", { name: /Add a scenario/ }));
    fireEvent.change(screen.getByLabelText("Given"), {
      target: { value: "a shop with sales this month" },
    });
    fireEvent.change(screen.getByLabelText("When"), {
      target: { value: "the owner opens Reports" },
    });
    fireEvent.change(screen.getByLabelText("Then"), {
      target: { value: "they see takings by day" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(find("vague")?.gwt).toEqual([
      expect.objectContaining({
        given: "a shop with sales this month",
        then: "they see takings by day",
      }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: BACKLOG_HEALTH_ACTIONS.CRITERIA_ADDED,
      payload: { storyId: "vague", count: 1 },
    });
  });

  it("keeps a story whose last flag was fixed in the list, with focus where it was", async () => {
    // Only flag: no criteria (it has points, a clear title and is new).
    seed([story({ acceptanceCriteria: undefined })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Criteria and details" }));
    fireEvent.click(screen.getByRole("button", { name: /Add a scenario/ }));
    fireEvent.change(screen.getByLabelText("Given"), { target: { value: "a saved card" } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "I pay" } });
    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "I'm charged once" } });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(find("st1")?.gwt).toHaveLength(1);
    // The row stays, now with no flags, and its panel is still open.
    expect(within(row("st1")).getByText("No flags.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(row("st1")).getByRole("button", { name: /Add a scenario/ })).toHaveFocus()
    );
    expect(screen.queryByText("No story is flagged.")).toBeNull();
    // Changing the filter lets it go.
    fireEvent.click(screen.getByRole("button", { name: "All 1 stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Only flagged stories" }));
    expect(row("st1")).toBeNull();
    expect(screen.getByText("No story is flagged.")).toBeInTheDocument();
  });

  it("keeps a story listed when Enter saves the points it lacked", async () => {
    seed([story({ points: undefined })]);
    renderPage();
    const input = await screen.findByLabelText("Points for Pay with a saved card");
    input.focus();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(find("st1")?.points).toBe(3);
    expect(within(row("st1")).getByText("No flags.")).toBeInTheDocument();
    expect(screen.getByLabelText("Points for Pay with a saved card")).toHaveFocus();
  });

  it("keeps a story listed when its free-text criteria are saved", async () => {
    seed([story({ acceptanceCriteria: undefined })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Criteria and details" }));
    fireEvent.click(within(row("st1")).getByRole("button", { name: /^Add details/ }));
    fireEvent.change(within(row("st1")).getByLabelText("Acceptance criteria"), {
      target: { value: "Charged once." },
    });
    fireEvent.click(within(row("st1")).getByRole("button", { name: "Save details" }));
    expect(find("st1")?.acceptanceCriteria).toBe("Charged once.");
    expect(within(row("st1")).getByText("No flags.")).toBeInTheDocument();
    expect(within(row("st1")).getByRole("button", { name: /^Edit details/ })).toHaveFocus();
  });

  it("offers a split only for a story that is too big", async () => {
    seed([BIG(), VAGUE()]);
    renderPage();
    await screen.findByText("Stories to look at");
    expect(within(row("big")).getByRole("button", { name: "Split it" })).toBeInTheDocument();
    expect(within(row("vague")).queryByRole("button", { name: "Split it" })).toBeNull();
  });

  it("says a stale story needs Refinement's check, not just an edit here", async () => {
    seed([story({ createdAt: new Date(Date.now() - 20 * 7 * 86_400_000).toISOString() })]);
    renderPage();
    expect(
      await within(await screen.findByRole("list", { name: "Backlog stories" })).findByText(
        /No status change, sprint move or ready check for 20 weeks\. Walk it through Refinement/
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("What counts as the top, too big and stale"));
    expect(screen.getByText(/Points and criteria fixed here don.t reset it/)).toBeInTheDocument();
  });

  it("splits a big one by a pattern, with Undo, keeping the original", async () => {
    seed([BIG()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Split it" }));
    const suggestions = screen.getAllByTestId("ai-suggestions")[0];
    fireEvent.click(within(suggestions).getByRole("button", { name: /^Add all/ }));
    const made = ws().stories.filter((s) => s.id !== "big");
    expect(made.map((s) => s.title)).toEqual([
      "Import orders from CSV and Excel files: the main path only",
      "Import orders from CSV and Excel files: errors and rare cases",
    ]);
    expect(find("big")).toBeTruthy();
    expect(logs.at(-1)).toMatchObject({ action: BACKLOG_HEALTH_ACTIONS.STORY_SPLIT });
    undoLast();
    expect(ws().stories.map((s) => s.id)).toEqual(["big"]);
  });

  it("drops a story with Undo back to its place", async () => {
    seed([story(), VAGUE()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Drop “Reports”" }));
    expect(find("vague")).toBeUndefined();
    expect(logs.at(-1)).toMatchObject({ action: BACKLOG_HEALTH_ACTIONS.STORY_DROPPED });
    undoLast();
    expect(ws().stories.map((s) => s.id)).toEqual(["st1", "vague"]);
  });

  it("puts focus on the score's heading after a drop", async () => {
    seed([story(), VAGUE()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Drop “Reports”" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: /DEEP score/ })).toHaveFocus()
    );
  });
});

describe("the review without AI", () => {
  it("notes what the rules found and adds each suggestion through the story, with Undo", async () => {
    seed([story(), VAGUE()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review by the rules" }));
    expect(screen.getByText(/What the rules noticed/)).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Splits and scenarios to add" });
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    fireEvent.click(within(list).getAllByRole("button", { name: /^Add: Given/ })[0]);
    expect(find("vague")?.gwt).toHaveLength(1);
    expect(find("vague")?.gwt?.[0].when).toBe("someone uses “Reports”");
    undoLast();
    expect(find("vague")?.gwt).toBeUndefined();
  });
});

describe("the review follows the page's settings", () => {
  // 11 points, below the top: too big at 8, and no criteria is fine down there.
  const REFUND = () =>
    story({
      id: "refund",
      title: "Refund a payment from the phone",
      points: 11,
      acceptanceCriteria: undefined,
      backlogRank: 2,
    });

  it("flags what the page flags: missing criteria near the top only, too big by its limit", async () => {
    useBacklogHealthSettings.setState({ topN: 1, tooBigPoints: 8, staleWeeks: 8 });
    seed([story(), REFUND()]);
    renderPage();
    expect(await within(row("refund")).findByText("Too big")).toBeInTheDocument();
    expect(within(row("refund")).queryByText("No acceptance criteria")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review by the rules" }));
    const noticed = screen.getByText(/What the rules noticed/).parentElement as HTMLElement;
    expect(within(noticed).getByText(/Too big:/)).toBeInTheDocument();
    expect(within(noticed).queryByText(/No acceptance criteria/)).toBeNull();
    // Its split titles are offered, no scenarios for missing criteria.
    const list = screen.getByRole("region", { name: "Splits and scenarios to add" });
    expect(
      within(list).getAllByRole("button", { name: /^Add: New story:/ }).length
    ).toBeGreaterThan(0);
    expect(within(list).queryByRole("button", { name: /^Add: Given/ })).toBeNull();
  });

  it("adds a suggested split as a backlog story, with Undo", async () => {
    seed([BIG()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review by the rules" }));
    const list = screen.getByRole("region", { name: "Splits and scenarios to add" });
    fireEvent.click(within(list).getAllByRole("button", { name: /^Add: New story:/ })[0]);
    expect(ws().stories).toHaveLength(2);
    expect(ws().stories[1]).toMatchObject({ status: "backlog" });
    expect(logs.at(-1)).toMatchObject({ action: BACKLOG_HEALTH_ACTIONS.STORY_SPLIT });
    undoLast();
    expect(ws().stories.map((s) => s.id)).toEqual(["big"]);
  });

  it("says so when there is nothing to suggest", async () => {
    seed([story()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Review by the rules" }));
    expect(
      await screen.findByText("Nothing to suggest: every story looks fine.")
    ).toBeInTheDocument();
  });

  it("flags the stories again when the settings change", async () => {
    seed([story(), REFUND()]);
    renderPage();
    expect(await within(row("refund")).findByText("No acceptance criteria")).toBeInTheDocument();
    expect(within(row("refund")).queryByText("Too big")).toBeNull();
    fireEvent.click(screen.getByText("What counts as the top, too big and stale"));
    fireEvent.change(screen.getByLabelText("Too big above"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the settings" }));
    expect(within(row("refund")).getByText("Too big")).toBeInTheDocument();
  });
});

describe("settings and export", () => {
  it("checks the settings before saving them", async () => {
    seed([story()]);
    renderPage();
    fireEvent.click(await screen.findByText("What counts as the top, too big and stale"));
    fireEvent.change(screen.getByLabelText("Too big above"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the settings" }));
    expect(screen.getByText("Too big above: a whole number from 1 to 100.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Too big above"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the settings" }));
    expect(useBacklogHealthSettings.getState().tooBigPoints).toBe(8);
    expect(normalizeSettings({ topN: 999, staleWeeks: 4 })).toEqual({
      ...DEFAULT_SETTINGS,
      staleWeeks: 4,
    });
    expect(validateSettings({ topN: "2.5", tooBigPoints: "13", staleWeeks: "8" }).ok).toBe(false);
    expect(validatePoints("")).toEqual({ ok: true, values: undefined });
  });

  it("exports the checks, the flags and both kinds of criteria", async () => {
    seed([
      story({
        gwt: [{ id: "g1", given: "a saved card", when: "I pay", then: "I'm charged once" }],
      }),
      VAGUE(),
    ]);
    renderPage();
    await screen.findByText("Stories to look at");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("## The four checks");
    expect(md).toContain("- 2. Reports: Vague title, No acceptance criteria, No points");
    expect(md).toContain(
      "Charged once.\n\n```gherkin\nGiven a saved card\nWhen I pay\nThen I'm charged once\n```"
    );
    const csv = JSON.parse(screen.getByTestId("export-csv").textContent ?? "{}");
    expect(csv.headers).toContain("Given / When / Then");
    expect(csv.rows[0]).toEqual([
      1,
      "Pay with a saved card",
      3,
      "",
      "Charged once.",
      "Given a saved card, when I pay, then I'm charged once.",
      expect.any(String),
    ]);
  });
});
