import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Cost of Delay on the method-tool shell (Phase 7): CD3 = cost of delay
 * per week ÷ duration (floor half a week), required inputs with no zero
 * coercion, the urgency profile and its lanes (expedite, fixed date by
 * latest start, standard and intangible by CD3), the fixed date and when
 * it's late, rows from before CD3 as "Not scored: add a duration", Undo,
 * the example, the Markdown, the hub's CD3, and the page and the agent
 * reading the same order.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" as string | undefined }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { markdown?: string }) => {
    exported.markdown = p.markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { CostOfDelayClient } from "@/app/(tools)/cost-of-delay/cost-of-delay-client";
import { buildExample } from "@/app/(tools)/cost-of-delay/example";
import { toMarkdown } from "@/app/(tools)/cost-of-delay/markdown";
import { codVerdict } from "@/app/(tools)/cost-of-delay/verdict";
import { codGroups } from "@/app/(tools)/cost-of-delay/lanes";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { frameworkScores } from "@/lib/prioritization/scores";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/cost-of-delay";

// A fixed "today" so dates read the same on every run: Tue 27 Oct 2026.
const NOW = new Date(2026, 9, 27, 12);
const TODAY = "2026-10-27";

const TITLE = /Initiative title/;
const COST = /Cost of delay/;
const DURATION = /Duration/;
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === "cost-of-delay");
const stored = (id: string) => rows().find((r) => r.id === id);
const lane = (label: string | RegExp) => screen.getByRole("region", { name: label });

const row = (
  id: string,
  title: string,
  fields: Record<string, number | string>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "cost-of-delay",
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});
const scored = (
  id: string,
  perWeekUsd: number,
  durationWeeks: number,
  urgency: string,
  fixedDate?: string
) =>
  row(id, `Item ${id}`, {
    perWeekUsd,
    durationWeeks,
    urgency,
    ...(fixedDate ? { fixedDate } : {}),
  });

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  toastSpy.mockReset();
  exported.markdown = "";
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Cost of Delay form", () => {
  it("names every blank input and adds nothing, never a silent 0", () => {
    render(<CostOfDelayClient />);
    add();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter a title.",
      "Enter the cost of delay per week.",
      "Enter the duration.",
      "Pick an urgency profile.",
    ]);
    expect(rows()).toEqual([]);
  });

  it("scores CD3 = cost per week ÷ duration, and spells it out while typing", () => {
    render(<CostOfDelayClient />);
    type(TITLE, "Wallet checkout");
    type(COST, "12000");
    type(DURATION, "3");
    expect(
      screen.getByText("CD3 = 4,000: the cost of each week of waiting, per week of work.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    expect(screen.getByText(/The cost grows steadily/)).toBeInTheDocument();
    // No fixed date asked for unless the profile is a fixed date.
    expect(screen.queryByLabelText(/Date it must land by/)).toBeNull();
    add();
    expect(rows()[0]).toMatchObject({
      title: "Wallet checkout",
      fields: { perWeekUsd: 12000, durationWeeks: 3, urgency: "standard" },
      score: 4000,
      status: "scored",
    });
  });

  it("refuses a duration under half a week", () => {
    render(<CostOfDelayClient />);
    type(TITLE, "Tiny");
    type(COST, "100");
    type(DURATION, "0.4");
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    add();
    expect(screen.getByRole("alert")).toHaveTextContent(/0\.5 or more|at least half a week/);
    expect(rows()).toEqual([]);
  });

  it("asks for the date a fixed date must land by, and drops it for another profile", () => {
    render(<CostOfDelayClient />);
    type(TITLE, "Accessibility deadline");
    type(COST, "25000");
    type(DURATION, "4");
    fireEvent.click(screen.getByRole("radio", { name: "Fixed date" }));
    add();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the date it must land by.");
    type(/Date it must land by/, "2026-12-08");
    add();
    expect(rows()[0].fields).toMatchObject({ urgency: "fixed_date", fixedDate: "2026-12-08" });
    // 8 Dec less 4 weeks: start by 10 Nov.
    expect(
      within(lane(/Fixed date/)).getByText("Start by 10 Nov to land by 8 Dec")
    ).toBeInTheDocument();
  });
});

describe("Cost of Delay lanes", () => {
  it("orders expedite, fixed date by latest start, standard by CD3, no profile, intangible, then unscored", () => {
    const list = [
      scored("i", 50000, 1, "intangible"),
      scored("s1", 1000, 1, "standard"),
      scored("f-late", 1000, 2, "fixed_date", "2026-12-31"),
      scored("s2", 9000, 1, "standard"),
      row("n", "No profile", { perWeekUsd: 3000, durationWeeks: 1 }),
      scored("f-soon", 1000, 4, "fixed_date", "2026-11-30"),
      scored("e", 10, 1, "expedite"),
      row("old", "Old", { perWeekUsd: 500, weeksDelayed: 4, totalCost: 2000 }),
    ];
    const groups = codGroups(rankMethodRows("cost-of-delay", list));
    expect(groups.map((g) => [g.id, g.rows.map((r) => r.row.id)])).toEqual([
      ["expedite", ["e"]],
      ["fixed_date", ["f-soon", "f-late"]],
      ["standard", ["s2", "s1"]],
      ["none", ["n"]],
      ["intangible", ["i"]],
      ["unscored", ["old"]],
    ]);
    expect(codVerdict(rankMethodRows("cost-of-delay", list), TODAY)).toBe(
      "Expedite “Item e” now. “Item f-soon” must start by 2 Nov to land by 30 Nov. Of the rest, do “Item s2” first (CD3 9,000). 1 initiative has no urgency profile yet. 1 initiative not scored yet: add a duration."
    );
  });

  it("marks a fixed date whose latest start has passed as late", () => {
    useWorkspaceStore.setState({
      prioritizations: [scored("f", 2000, 4, "fixed_date", "2026-11-10")],
    });
    render(<CostOfDelayClient />);
    const late = within(lane(/Fixed date/)).getByText(
      "Late: it had to start by 13 Oct to land by 10 Nov"
    );
    expect(late).toHaveClass("text-danger");
    expect(
      screen.getByText("“Item f” is late: it had to start by 13 Oct to land by 10 Nov.")
    ).toBeInTheDocument();
  });

  it("counts a legacy duration under half a week as 0.5, says so, and scores a zero cost as 0", () => {
    useWorkspaceStore.setState({
      prioritizations: [scored("h", 1000, 0.25, "standard"), scored("z", 0, 2, "standard")],
    });
    render(<CostOfDelayClient />);
    expect(
      screen.getByText("Duration 0.25 is below half a week and counts as 0.5. Edit it.")
    ).toBeInTheDocument();
    const standard = within(lane(/^Standard/)).getAllByRole("listitem");
    expect(standard[0]).toHaveTextContent("2,000");
    // A cost of 0 is a real CD3 of 0, not "Not scored".
    expect(standard[1]).toHaveTextContent("0");
    expect(standard[1]).not.toHaveTextContent("Not scored");
  });

  it("formats huge values without breaking", () => {
    const md = toMarkdown(
      rankMethodRows("cost-of-delay", [scored("x", 1e9, 0.5, "standard")]),
      NOW
    );
    expect(md).toContain("| 1 | Item x | $1,000,000,000 | 0.5 | 2,000,000,000 |");
  });
});

describe("Cost of Delay rows from before CD3", () => {
  const legacy = row(
    "old",
    "Checkout redesign",
    { perWeekUsd: 3000, weeksDelayed: 6, totalCost: 18000 },
    { score: 18000 }
  );

  it("reads as Not scored with the old total, and scores once a duration is added", () => {
    useWorkspaceStore.setState({ prioritizations: [legacy] });
    render(<CostOfDelayClient />);
    const waiting = lane("Not scored: add a duration");
    expect(within(waiting).getByText("Checkout redesign")).toBeInTheDocument();
    expect(
      within(waiting).getByText(
        "Add a duration to score it (old total $18,000, per week × weeks delayed)."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Checkout redesign" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    // The cost per week comes across; the duration and profile are new.
    expect(within(editor).getByLabelText(COST)).toHaveValue(3000);
    fireEvent.change(within(editor).getByLabelText(DURATION), { target: { value: "2" } });
    fireEvent.click(within(editor).getByRole("radio", { name: "Standard" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(stored("old")).toMatchObject({
      score: 1500,
      status: "scored",
      // The old figures stay for reference.
      fields: { perWeekUsd: 3000, durationWeeks: 2, urgency: "standard", weeksDelayed: 6 },
    });
    expect(within(lane(/^Standard/)).getByText("Checkout redesign")).toBeInTheDocument();
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({ prioritizations: [legacy] });
    render(<CostOfDelayClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Checkout redesign" }));
    expect(rows()).toEqual([]);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted “Checkout redesign”");
    act(() => opts.action.onClick());
    expect(rows().map((r) => r.id)).toEqual(["old"]);
  });
});

describe("Cost of Delay example, export and the hub", () => {
  it("loads every profile from the empty state, says what to do first, and clears", () => {
    render(<CostOfDelayClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(6);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Expedite “Fix the double-charge bug” now. “Meet the accessibility deadline” must start by 10 Nov to land by 8 Dec. Of the rest, do “Saved cards for returning shoppers” first (CD3 4,500)."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/per week across 6 scored initiatives/)).toHaveTextContent(
      "Waiting costs $91,000 per week across 6 scored initiatives."
    );
    expect(screen.getByRole("figure", { name: "Top 10 by CD3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows()).toEqual([]);
  });

  it("exports the lanes, CD3, starts and the verdict", () => {
    const md = toMarkdown(rankMethodRows("cost-of-delay", buildExample(NOW)), NOW);
    expect(md).toContain("# Cost of Delay — 27 Oct 2026");
    expect(md).toContain("## Expedite: do now (1)");
    expect(md).toContain(
      "| 2 | Meet the accessibility deadline | $25,000 | 4 | 6,250 | Start by 10 Nov to land by 8 Dec |"
    );
    expect(md).toContain("## Intangible: by CD3 (1)");
    expect(md).toContain("Waiting costs $91,000 per week across 6 scored initiatives.");
    expect(md).toContain("**Expedite “Fix the double-charge bug” now.");
  });

  it("gives the hub the row's CD3 and lane for a linked item", () => {
    const item: BacklogItem = { id: "b1", name: "Linked", updatedAt: "2026-10-20T09:00:00.000Z" };
    const linked = { ...scored("l", 6000, 3, "standard"), backlogItemId: "b1" };
    expect(frameworkScores(item, [linked])).toMatchObject({ cd3: 2000, urgency: "standard" });
  });
});

describe("Cost of Delay page and agent agree", () => {
  it("list_scored has the page's order, CD3 and lanes", async () => {
    const list = [
      scored("s", 9000, 3, "standard"),
      scored("e", 100, 1, "expedite"),
      row("old", "Old", { perWeekUsd: 500, weeksDelayed: 4, totalCost: 2000 }),
      scored("f", 1000, 1, "fixed_date", "2026-11-20"),
    ];
    useWorkspaceStore.setState({ prioritizations: list });
    render(<CostOfDelayClient />);
    const listed = (await registry
      .get("tool.cost_of_delay.list_scored")!
      .handler({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
      items: { id: string; score: number | null; rank: number | null; bucket: string | null }[];
    };
    const page = rankMethodRows("cost-of-delay", list);
    expect(listed.items.map((i) => [i.id, i.score, i.rank, i.bucket])).toEqual(
      page.map((r) => [r.row.id, r.result.score, r.rank, r.result.bucket])
    );
    expect(listed.items.map((i) => i.id)).toEqual(["e", "f", "s", "old"]);
  });
});
