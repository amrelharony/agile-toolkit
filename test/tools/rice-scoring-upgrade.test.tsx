import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * RICE on the method-tool shell (Phase 7): the reach period per initiative
 * (remembered, compared per quarter), the confidence rubric, the 0.5
 * effort minimum, the live binding to the backlog item both ways, unscored
 * rows last, the verdict, the chart and the outlier check behind Advanced
 * analysis, and the page and the agent reading the same numbers.
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

import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";
import { riceVerdict } from "@/app/(tools)/rice-scoring/verdict";
import { toMarkdown } from "@/app/(tools)/rice-scoring/markdown";
import { buildExample } from "@/app/(tools)/rice-scoring/example";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/rice-scoring";

const TITLE = /Initiative title/;
const REACH = /Reach \(people\)/;
const EFFORT = /Effort \(person-months\)/;

const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === "rice");
const stored = (id: string) => rows().find((r) => r.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const list = () => screen.getByRole("list", { name: "Initiatives, highest RICE first" });
const listItems = () => within(list()).getAllByRole("listitem");

const row = (
  id: string,
  title: string,
  fields: Record<string, number | string>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "rice",
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});

function scale(group: string, option: string, root: HTMLElement = document.body) {
  return within(within(root).getByRole("radiogroup", { name: group })).getByRole("radio", {
    name: option,
  });
}
const pick = (group: string, option: string, root?: HTMLElement) =>
  fireEvent.click(scale(group, option, root));
const type = (label: RegExp, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });
const editorOf = () => screen.getByRole("button", { name: "Save" }).closest("form")!;
const add = () => fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

beforeEach(() => {
  toastSpy.mockReset();
  exported.markdown = "";
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("RICE reach period", () => {
  it("counts reach per month as per quarter, and the next form starts on that period", () => {
    render(<RiceScoringClient />);
    // Shown from the start, never hidden: per quarter, what Reach always meant.
    expect(scale("Reach period", "per quarter")).toBeChecked();
    type(TITLE, "Push alerts");
    type(REACH, "1000");
    pick("Reach period", "per month");
    expect(screen.getByText("= 3,000 per quarter, what the score counts.")).toBeInTheDocument();
    pick("Impact", "1x Medium");
    pick("Confidence", "100% High");
    type(EFFORT, "1");
    add();

    expect(rows()[0]).toMatchObject({
      title: "Push alerts",
      fields: { reach: 1000, reachPeriod: "month", impact: 1, confidence: 100, effort: 1 },
      score: 3000,
    });
    // Remembered from the last initiative.
    expect(scale("Reach period", "per month")).toBeChecked();

    // 3,000 a quarter ties with 1,000 a month.
    type(TITLE, "Weekly digest");
    type(REACH, "3000");
    pick("Reach period", "per quarter");
    pick("Impact", "1x Medium");
    pick("Confidence", "100% High");
    type(EFFORT, "1");
    add();
    expect(
      screen.getByText("Do first: “Push alerts” and “Weekly digest” tie at RICE 3,000.")
    ).toBeInTheDocument();
  });

  it("reads a row saved before periods as per quarter", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("r1", "Old", { reach: 400, impact: 1, confidence: 100, effort: 1 })],
    });
    render(<RiceScoringClient />);
    expect(within(list()).getByText("400 per quarter")).toBeInTheDocument();
    expect(within(list()).getByText("400")).toBeInTheDocument();
  });

  it("explains confidence with examples and the moonshot line", () => {
    render(<RiceScoringClient />);
    expect(screen.getByText("How sure? See examples")).toBeInTheDocument();
    expect(
      screen.getByText(/Customer interviews or support tickets back one of the numbers/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Under 50% is a moonshot: test it first/).length).toBeGreaterThan(0);
  });
});

describe("RICE effort and unscored rows", () => {
  it("refuses an effort under 0.5 inline", () => {
    render(<RiceScoringClient />);
    type(TITLE, "Tiny fix");
    type(REACH, "100");
    pick("Impact", "1x Medium");
    pick("Confidence", "80% Medium");
    type(EFFORT, "0.4");
    add();
    expect(screen.getByRole("alert")).toHaveTextContent("Effort is at least 0.5 person-months.");
    expect(rows()).toEqual([]);
  });

  it("scores a legacy effort below 0.5 as 0.5 and says so", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("r1", "Legacy", { reach: 100, impact: 1, confidence: 100, effort: 0.25 }),
      ],
    });
    render(<RiceScoringClient />);
    expect(
      screen.getByText("Effort 0.25 is below the 0.5 minimum and counts as 0.5. Edit it.")
    ).toBeInTheDocument();
    expect(within(list()).getByText("200")).toBeInTheDocument();
  });

  it("lists an effort of 0 or a missing input as Not scored, last, never 0", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("z", "Zero effort", { reach: 100, impact: 1, confidence: 100, effort: 0 }),
        row("m", "Missing", {}),
        row("a", "Scored", { reach: 100, impact: 1, confidence: 100, effort: 1 }),
      ],
    });
    render(<RiceScoringClient />);
    const items = listItems();
    expect(items[0]).toHaveTextContent("Scored");
    expect(items[1]).toHaveTextContent("Not scored");
    expect(items[2]).toHaveTextContent("Not scored");
    expect(within(list()).getAllByLabelText("Not ranked")).toHaveLength(2);
    expect(
      screen.getByText("Do first: “Scored” (RICE 100). 2 initiatives not scored yet.")
    ).toBeInTheDocument();
  });
});

describe("RICE live binding", () => {
  const item: BacklogItem = {
    id: "b1",
    name: "Saved searches",
    reach: 500,
    reachPeriod: "month",
    impact: 2,
    confidence: 80,
    effort: 2,
    updatedAt: "2026-10-20T09:00:00.000Z",
  };
  // The row's own copy is stale: the item owns the inputs.
  const linked = row(
    "r1",
    "Saved searches",
    { reach: 100, impact: 1, confidence: 50, effort: 5 },
    { backlogItemId: "b1", score: 10 }
  );

  it("reads a linked row through to its backlog item, and a hub edit shows at once", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<RiceScoringClient />);
    // 500 a month = 1,500 a quarter × 2 × 80% ÷ 2.
    expect(within(list()).getByText("500 per month")).toBeInTheDocument();
    expect(within(list()).getByText("1,200")).toBeInTheDocument();

    act(() => state().upsertBacklogItem({ ...item, reach: 1000 }));
    expect(within(list()).getByText("2,400")).toBeInTheDocument();
  });

  it("writes an edit through to the item, with Undo", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Saved searches" }));
    pick("Impact", "3x Massive", editorOf());
    fireEvent.click(within(editorOf()).getByRole("button", { name: "Save" }));

    expect(storedItem("b1")).toMatchObject({ impact: 3, reach: 500, reachPeriod: "month" });
    expect(stored("r1")!.fields).toMatchObject({ reach: 500, reachPeriod: "month", impact: 3 });
    expect(stored("r1")!.score).toBeCloseTo((1500 * 3 * 0.8) / 2);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Updated “Saved searches” in the backlog");
    act(() => opts.action.onClick());
    expect(storedItem("b1")?.impact).toBe(2);
  });

  it("renames the backlog item with the row", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Saved searches" }));
    fireEvent.change(within(editorOf()).getByLabelText(TITLE), {
      target: { value: "Saved filters" },
    });
    fireEvent.click(within(editorOf()).getByRole("button", { name: "Save" }));
    expect(stored("r1")?.title).toBe("Saved filters");
    expect(storedItem("b1")?.name).toBe("Saved filters");
  });

  it("opens the row's editor when an already-scored item is imported", async () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<RiceScoringClient />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Import from backlog" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Saved searches.*Already scored/ })
    );
    expect(within(editorOf()).getByLabelText(TITLE)).toHaveValue("Saved searches");
    expect(rows()).toHaveLength(1);
  });
});

describe("RICE results", () => {
  const scored = (id: string, title: string, reach: number, confidence = 100) =>
    row(id, title, { reach, impact: 1, confidence, effort: 1 });

  it("warns when the front-runner rests on low confidence", () => {
    expect(riceVerdict(rankMethodRows("rice", []))).toBe("No initiatives scored yet.");
    expect(
      riceVerdict(rankMethodRows("rice", [scored("a", "A", 2000, 50), scored("b", "B", 300)]))
    ).toBe("Do first: “A” (RICE 1,000). Confidence is only 50%, so test it before building.");
    expect(riceVerdict(rankMethodRows("rice", [row("m", "M", {})]))).toBe(
      "None of the 1 initiative is scored yet."
    );
  });

  it("charts the top initiatives with a summary, and keeps outliers behind the minimum", () => {
    useWorkspaceStore.setState({
      prioritizations: [scored("a", "Alpha", 300), scored("b", "Beta", 200), scored("c", "C", 100)],
    });
    render(<RiceScoringClient />);
    const figure = screen.getByRole("figure", { name: "Top 10 by RICE" });
    expect(figure).toHaveTextContent("“Alpha” leads at RICE 300; “Beta” follows at 200.");
    // Three scores are too few for an outlier check (five make a spread).
    expect(
      screen.getByText("Score 2 more scored initiatives to see which scores sit far from the rest.")
    ).toBeInTheDocument();
  });

  it("names an outlier once there are enough scores", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        scored("a", "A", 100),
        scored("b", "B", 110),
        scored("c", "C", 120),
        scored("d", "D", 130),
        scored("e", "Typo", 100000),
      ],
    });
    render(<RiceScoringClient />);
    expect(screen.getByText(/This score sits far from the rest/)).toBeInTheDocument();
    expect(exported.markdown).toContain("| 1 | Typo (outlier) |");
  });

  it("exports the period, the registry's score and the verdict", () => {
    const md = toMarkdown(rankMethodRows("rice", buildExample()), new Date(2026, 9, 18));
    expect(md).toContain(
      "| 1 | Clearer card-declined message | 2500 | per quarter | 1 | 80% | 0.5 | 4,000 |"
    );
    expect(md).toContain("| Guest checkout without an account | 2000 | per month |");
    expect(md).toContain("**Do first: “Clearer card-declined message” (RICE 4,000).**");
  });
});

describe("RICE page and agent agree", () => {
  it("list_scored has the page's order, scores and ranks", async () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Linked",
      reach: 100,
      reachPeriod: "week",
      impact: 1,
      confidence: 100,
      effort: 1,
      updatedAt: "2026-10-20T09:00:00.000Z",
    };
    const items = [
      row("m", "Monthly", {
        reach: 1000,
        reachPeriod: "month",
        impact: 1,
        confidence: 100,
        effort: 2,
      }),
      row(
        "l",
        "Linked",
        { reach: 1, impact: 1, confidence: 100, effort: 1 },
        { backlogItemId: "b1" }
      ),
      row("z", "Zero", { reach: 1000, impact: 1, confidence: 100, effort: 0 }),
      row("q", "Quarterly", {
        reach: 1800,
        impact: 1,
        confidence: 100,
        effort: 1,
        confidencePct: 50,
      }),
    ];
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: items });
    render(<RiceScoringClient />);
    const listed = (await registry
      .get("tool.rice_scoring.list_scored")!
      .handler({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
      items: { id: string; score: number | null; rank: number | null }[];
    };
    const page = rankMethodRows("rice", items, [item]);
    expect(listed.items.map((i) => [i.id, i.score, i.rank])).toEqual(
      page.map((r) => [r.row.id, r.result.score, r.rank])
    );
    // The linked row reads 100 a week = 1,300 a quarter from its item.
    expect(listed.items.map((i) => i.id)).toEqual(["q", "m", "l", "z"]);
    const names = listItems().map((li) =>
      ["Quarterly", "Monthly", "Linked", "Zero"].find((n) => li.textContent?.includes(n))
    );
    expect(names).toEqual(["Quarterly", "Monthly", "Linked", "Zero"]);
  });

  it("compute_score normalises the period as the page does", async () => {
    const r = (await registry
      .get("tool.rice_scoring.compute_score")!
      .handler(
        { reach: 1000, reachPeriod: "month", impact: 1, confidencePct: 100, effort: 1 },
        { userId: "u", source: "agent", squadProfileIds: [] }
      )) as { score: number; reachPerQuarter: number };
    expect(r).toMatchObject({ score: 3000, reachPerQuarter: 3000 });
  });
});
