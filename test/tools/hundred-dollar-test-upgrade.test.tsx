import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ALLOCATION_ROUND_KIND,
  type AllocationRound,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import {
  addAllocation,
  emptyAllocationTally,
  revealAllocation,
  toAllocationResult,
} from "@/lib/realtime/vote-room/allocation";
import {
  allocationOf,
  allocationRoundFrom,
  capAllocation,
  compareSplit,
  dollars,
  hundredDollarSheet,
  hundredDollarVerdict,
  kitResultOf,
  spreadKnownOf,
  spreadReason,
  splitSummary,
  teamAverages,
} from "@/lib/hundred-dollar/allocation";
import { registry } from "@/lib/actions/registry";
import { exampleId } from "@/lib/utils/example-id";

/**
 * The $100 Test, upgraded: the agreed split saves when its box is left
 * (never per keystroke), in whole dollars, capped and said so; the list
 * doesn't move while it's edited; items are added through a validated
 * form, renamed in place and deleted with Undo; "Clear all amounts" asks
 * and offers Undo. Team rounds run through the vote-room kit (paper
 * splits here, with live rooms off) and keep only per-item totals, who
 * backed what and the spread bands (from 5); the results put the team's
 * averages beside the agreed split. The agent actions read the same rows
 * through the same library and give the same numbers.
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
// The MCP path reads and writes an in-memory list per kind.
const server = vi.hoisted(() => new Map<string, Map<string, { id: string }>>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const kind = (k: string) => {
    if (!server.has(k)) server.set(k, new Map());
    return server.get(k) as Map<string, { id: string }>;
  };
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, k: string) => Array.from(kind(k).values())),
    serverGetEntity: vi.fn(async (_u: string, k: string, id: string) => kind(k).get(id) ?? null),
    serverUpsertEntity: vi.fn(async (_u: string, k: string, e: { id: string }) => {
      kind(k).set(e.id, e);
    }),
    serverDeleteEntity: vi.fn(async (_u: string, k: string, id: string) => {
      kind(k).delete(id);
    }),
  };
});

import { HundredDollarTestClient } from "@/app/(tools)/hundred-dollar-test/hundred-dollar-test-client";
import { buildExample } from "@/app/(tools)/hundred-dollar-test/example";
import { toMarkdown } from "@/app/(tools)/hundred-dollar-test/markdown";
import { validateItem } from "@/app/(tools)/hundred-dollar-test/add-item-form";
import "@/lib/actions/tools/hundred-dollar-test";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const row = (id: string, title: string, allocation?: number | string): PrioritizationItem => ({
  id,
  framework: "hundred-dollar",
  title,
  ...(allocation === undefined ? {} : { score: Number(allocation) }),
  fields: allocation === undefined ? {} : { allocation },
  status: "open",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const rowsInStore = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter(
    (x) => x.framework === "hundred-dollar"
  );
const amountOf = (id: string) => allocationOf(rowsInStore().find((x) => x.id === id));
const roundsInStore = () => useWorkspaceStore.getState().allocationRounds ?? [];

function renderPage() {
  return render(
    <TooltipProvider>
      <HundredDollarTestClient />
    </TooltipProvider>
  );
}

const box = (title: string) => screen.getByLabelText(`Dollars allocated to ${title}`);
const commit = (title: string, value: string) => {
  fireEvent.change(box(title), { target: { value } });
  fireEvent.blur(box(title));
};
const shownOrder = () =>
  screen
    .getAllByLabelText(/^Dollars allocated to /)
    .map((el) => el.getAttribute("aria-label")?.replace("Dollars allocated to ", ""));

/** Click Undo on the toast labelled `label` (the latest one). */
function undo(label: string) {
  const call = [...toastSpy.mock.calls].reverse().find(([l]) => l === label) as
    | [string, { action: { onClick: () => void } }]
    | undefined;
  expect(call, `toast "${label}"`).toBeDefined();
  call?.[1].action.onClick();
}

/** A round folded from whole splits by the kit's own counting, as a live room would. */
function foldedRound(
  rows: PrioritizationItem[],
  splits: number[][],
  id = "allocationRound_test0001"
): AllocationRound {
  const sheet = hundredDollarSheet(rows);
  if (!sheet) throw new Error("no sheet");
  let t = emptyAllocationTally("t", sheet);
  for (const s of splits) {
    const next = addAllocation(t, s, sheet);
    if (!next) throw new Error(`bad split ${s.join(",")}`);
    t = next;
  }
  const revealed = revealAllocation(t, 3);
  const result = toAllocationResult(sheet, revealed ?? [], {
    tool: "hundred-dollar-test",
    roundId: "round-abc",
    closedAt: "2026-10-20T10:00:00.000Z",
    minN: 3,
    ballots: splits.length,
    source: "live",
  });
  if (!result) throw new Error("no result");
  return allocationRoundFrom(result, { id, date: "2026-10-20" });
}

const SPLITS = [
  [50, 30, 20],
  [40, 40, 20],
  [60, 20, 20],
  [30, 30, 40],
  [20, 50, 30],
];

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  server.clear();
  vi.unstubAllEnvs();
  useWorkspaceStore.setState({ prioritizations: [], allocationRounds: [] });
});

/* ── The library ────────────────────────────────────────────────────── */

describe("the agreed split's rules (lib/hundred-dollar/allocation)", () => {
  const rows = [row("a", "Search", 70), row("b", "Exports", 0), row("c", "Themes")];

  it("caps an amount at what's left, in whole dollars, and says why", () => {
    expect(capAllocation(rows, "b", 30)).toEqual({ saved: 30, note: null });
    expect(capAllocation(rows, "b", 50).note).toBe(
      "Only $30 was left, so Exports got $30, not $50. Lower another item first to move money here."
    );
    expect(capAllocation(rows, "b", -5)).toEqual({
      saved: 0,
      note: "Amounts can't be negative, so Exports is set to $0.",
    });
    expect(capAllocation(rows, "b", 12.4)).toEqual({
      saved: 12,
      note: "Whole dollars only, so Exports got $12, not $12.40.",
    });
    expect(capAllocation([row("a", "Search")], "a", 250).note).toBe(
      "The whole budget is $100, so Search got $100, not $250."
    );
  });

  it("leaves only whole dollars when a legacy item holds cents", () => {
    const legacy = [row("a", "Search", 33.33), row("b", "Exports", 33.33), row("c", "Themes")];
    // 100 − 66.66 = 33.34 left: the whole dollars of it.
    expect(capAllocation(legacy, "c", 40).saved).toBe(33);
    expect(splitSummary(legacy)).toMatchObject({ total: 66.66, remaining: 33.34, full: false });
    expect(dollars(33.33)).toBe("$33.33");
  });

  it("tells no amount from a deliberate $0, and counts neither as money", () => {
    expect(allocationOf(rows[1])).toBe(0);
    expect(allocationOf(rows[2])).toBeNull();
    expect(splitSummary(rows)).toEqual({ total: 70, remaining: 30, full: false, given: 2 });
    expect(splitSummary([])).toEqual({ total: 0, remaining: 100, full: false, given: 0 });
  });

  it("says when a split an agent or an old build saved is over $100", () => {
    const over = [row("a", "Search", 90), row("b", "Exports", 60)];
    expect(splitSummary(over)).toMatchObject({ total: 150, remaining: -50, full: false });
    expect(hundredDollarVerdict(over)).toBe("The split is $50 over the $100: lower an item.");
    // Nothing is left for either until the other comes down.
    expect(capAllocation(over, "b", 60).saved).toBe(10);
    expect(capAllocation([row("a", "A", "abc")], "a", 5)).toEqual({ saved: 5, note: null });
  });

  it("offers a round from two items, $100 each, given out in full", () => {
    expect(hundredDollarSheet([row("a", "Search")])).toBeNull();
    const sheet = hundredDollarSheet(rows);
    expect(sheet).toMatchObject({ budget: 100, unit: "$", spendAll: true });
    expect(sheet?.items.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("averages each item as total ÷ people, the spread only from 5", () => {
    const three = [row("a", "Search"), row("b", "Exports"), row("c", "Themes")];
    const full = foldedRound(three, SPLITS);
    const avgs = teamAverages(full);
    expect(avgs.map((a) => a.total)).toEqual([200, 170, 130]);
    expect(avgs.map((a) => a.mean)).toEqual([40, 34, 26]);
    expect(avgs[0].bands).toEqual([0, 0, 1, 3, 1]);
    expect(avgs[0].backers).toBe(5);
    expect(avgs[0].middleHalf).toBe("$26–$50");

    const four = foldedRound(three, SPLITS.slice(0, 4));
    expect(four.items.every((x) => x.bands === null && x.backers === null)).toBe(true);
    expect(spreadKnownOf(four)).toBe(true);
    expect(spreadReason(four)).toBe("The spread shows from 5 answers; this round had 4.");
    expect(teamAverages(four)[0].mean).toBe(45);
  });

  it("reads typed totals' rounds as a spread nobody knows, at any count", () => {
    const typed: AllocationRound = {
      ...foldedRound(
        [row("a", "A"), row("b", "B")],
        [
          [50, 50],
          [50, 50],
          [50, 50],
        ]
      ),
      ballots: 6,
      items: [
        { itemId: "a", text: "A", total: 300, backers: null, bands: null },
        { itemId: "b", text: "B", total: 300, backers: null, bands: null },
      ],
    };
    expect(spreadKnownOf(typed)).toBe(false);
    expect(kitResultOf(typed).spreadKnown).toBe(false);
    expect(spreadReason(typed)).toBe(
      "The totals were typed in, so how the amounts were spread isn't known."
    );
  });

  it("keeps nothing per person in a saved round", () => {
    const r = foldedRound([row("a", "Search"), row("b", "Exports"), row("c", "Themes")], SPLITS);
    expect(Object.keys(r).sort()).toEqual(
      [
        "ballots",
        "bandEdges",
        "budget",
        "closedAt",
        "date",
        "id",
        "items",
        "minN",
        "roundId",
        "source",
        "spendAll",
        "title",
        "tool",
        "unit",
      ].sort()
    );
    for (const item of r.items) {
      expect(Object.keys(item).sort()).toEqual(["backers", "bands", "itemId", "text", "total"]);
    }
  });

  it("puts the team's averages beside the agreed split, keeping deleted items' lines", () => {
    const three = [row("a", "Search", 50), row("b", "Exports", 30), row("c", "Themes", 20)];
    const r = foldedRound(three, SPLITS);
    const now = [three[0], three[2], row("d", "Dark mode")];
    expect(compareSplit(now, r)).toEqual([
      expect.objectContaining({ itemId: "a", agreed: 50, mean: 40, current: true }),
      expect.objectContaining({
        itemId: "b",
        text: "Exports",
        agreed: null,
        mean: 34,
        current: false,
      }),
      expect.objectContaining({ itemId: "c", agreed: 20, mean: 26, current: true }),
      expect.objectContaining({ itemId: "d", agreed: null, mean: null, current: true }),
    ]);
  });

  it("says in one sentence who leads, with the team or the agreed split", () => {
    expect(hundredDollarVerdict([])).toBe("No items yet.");
    expect(hundredDollarVerdict([row("a", "A"), row("b", "B")])).toBe(
      "Split the $100 across the 2 items, or ask the team in a round."
    );
    expect(hundredDollarVerdict([row("a", "A", 60), row("b", "B", 20)])).toBe(
      "$20 of the $100 is still to give out."
    );
    expect(hundredDollarVerdict([row("a", "A", 60), row("b", "B", 40)])).toBe(
      "Agreed split: A leads with $60."
    );
    const three = [row("a", "Search"), row("b", "Exports"), row("c", "Themes")];
    expect(hundredDollarVerdict(three, foldedRound(three, SPLITS))).toBe(
      "5 people split $100 each: Search leads with $40 on average, and the team mostly agrees on it."
    );
    const agree = foldedRound(three, [
      [40, 30, 30],
      [45, 30, 25],
      [40, 35, 25],
      [50, 25, 25],
      [30, 40, 30],
    ]);
    expect(hundredDollarVerdict(three, agree)).toBe(
      "5 people split $100 each: Search leads with $41 on average, and the team mostly agrees on it."
    );
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("$100 Test page: the agreed split", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Search", 40), row("b", "Exports", 20), row("c", "Themes", 10)],
    });
  });

  it("saves once when the box is left, never per keystroke", () => {
    renderPage();
    fireEvent.change(box("Themes"), { target: { value: "2" } });
    fireEvent.change(box("Themes"), { target: { value: "25" } });
    expect(amountOf("c")).toBe(10);
    expect(logs.filter((l) => l.action === "allocation_changed")).toHaveLength(0);
    fireEvent.blur(box("Themes"));
    expect(amountOf("c")).toBe(25);
    expect(logs.filter((l) => l.action === "allocation_changed")).toHaveLength(1);
  });

  it("saves on Enter, and a cleared box goes back instead of writing $0", () => {
    renderPage();
    fireEvent.change(box("Themes"), { target: { value: "15" } });
    fireEvent.keyDown(box("Themes"), { key: "Enter" });
    expect(amountOf("c")).toBe(15);
    fireEvent.change(box("Themes"), { target: { value: "" } });
    fireEvent.blur(box("Themes"));
    expect(amountOf("c")).toBe(15);
    expect(box("Themes")).toHaveValue(15);
  });

  it("rounds a legacy amount in cents to whole dollars when it's edited, and says so", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Search", 33.33), row("b", "Exports")],
    });
    renderPage();
    expect(box("Search")).toHaveValue(33.33);
    commit("Search", "40.6");
    expect(amountOf("a")).toBe(41);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Whole dollars only, so Search got $41, not $40.60."
    );
  });

  it("keeps the rows in place while amounts change, until Re-sort", () => {
    renderPage();
    expect(shownOrder()).toEqual(["Search", "Exports", "Themes"]);
    commit("Themes", "40");
    expect(amountOf("c")).toBe(40);
    expect(shownOrder()).toEqual(["Search", "Exports", "Themes"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(shownOrder()).toEqual(["Search", "Themes", "Exports"]);
  });

  it("deletes an item with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Exports" }));
    expect(rowsInStore().map((x) => x.id)).toEqual(["a", "c"]);
    expect(logs.at(-1)?.action).toBe("item_removed");
    undo("Deleted “Exports”");
    expect(
      rowsInStore()
        .map((x) => x.id)
        .sort()
    ).toEqual(["a", "b", "c"]);
  });

  it("renames an item in place", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Exports/ }));
    const field = screen.getByLabelText("Item");
    fireEvent.change(field, { target: { value: "CSV exports" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(rowsInStore().find((x) => x.id === "b")?.title).toBe("CSV exports");
  });

  it("clears every amount after asking, with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all amounts" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear amounts" }));
    expect(rowsInStore().map((x) => allocationOf(x))).toEqual([null, null, null]);
    expect(logs.at(-1)?.action).toBe("test_reset");
    undo("Cleared the agreed split");
    expect(rowsInStore().map((x) => allocationOf(x))).toEqual([40, 20, 10]);
  });
});

describe("$100 Test page: adding items", () => {
  it("adds nothing for a blank or overlong title, saying why", () => {
    expect(validateItem({ title: "  " })).toEqual({
      ok: false,
      errors: { title: "Enter the item to vote on." },
    });
    expect(validateItem({ title: "x".repeat(201) }).ok).toBe(false);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByText("Enter the item to vote on.")).toBeInTheDocument();
    expect(rowsInStore()).toHaveLength(0);
  });

  it("adds an item with no amount (not a silent $0) on Enter", () => {
    renderPage();
    const field = screen.getByLabelText("Item to vote on");
    fireEvent.change(field, { target: { value: "Offline mode" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    const [added] = rowsInStore();
    expect(added).toMatchObject({ title: "Offline mode", fields: {} });
    expect(added.score).toBeUndefined();
    expect(allocationOf(added)).toBeNull();
    expect(box("Offline mode")).toHaveValue(null);
  });
});

describe("$100 Test page: team rounds", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Search", 50), row("b", "Exports", 30), row("c", "Themes", 20)],
    });
  });

  /** Paper splits, through the kit's count entry (live rooms are off in tests). */
  function enterSplits(splits: number[][]) {
    const titles = ["Search", "Exports", "Themes"];
    for (const s of splits) {
      s.forEach((n, i) =>
        fireEvent.change(screen.getByLabelText(`${i + 1}. ${titles[i]}`), {
          target: { value: String(n) },
        })
      );
      fireEvent.click(screen.getByRole("button", { name: "Add split" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
  }

  it("saves a round of totals and bands only, then shows it beside the agreed split", () => {
    renderPage();
    expect(screen.getByText(/Live rounds are off on this site/)).toBeInTheDocument();
    enterSplits(SPLITS);
    const [saved] = roundsInStore();
    expect(saved).toMatchObject({ tool: "hundred-dollar-test", ballots: 5, source: "facilitator" });
    expect(saved.id).toMatch(/^allocationRound_/);
    expect(saved.items.map((x) => x.total)).toEqual([200, 170, 130]);
    expect(saved.items[0].bands).toEqual([0, 0, 1, 3, 1]);
    // Nobody's split: only these keys, and no amount list of five.
    for (const item of saved.items) {
      expect(Object.keys(item).sort()).toEqual(["backers", "bands", "itemId", "text", "total"]);
    }
    expect(JSON.stringify(saved)).not.toContain("50,30,20");
    expect(screen.getByText("Team results")).toBeInTheDocument();
    expect(screen.getAllByText("$40 average · agreed $50").length).toBe(1);
    expect(screen.getAllByText("The middle half gave $26–$50.")).toHaveLength(2);
    expect(screen.getByText("The middle half gave $11–$25 to $26–$50.")).toBeInTheDocument();
    // The kit's Undo takes the round out again.
    undo("Saved the round");
    expect(roundsInStore()).toHaveLength(0);
  });

  it("withholds who backed what and the spread below 5 answers", () => {
    renderPage();
    enterSplits(SPLITS.slice(0, 4));
    const [saved] = roundsInStore();
    expect(saved.items.every((x) => x.bands === null && x.backers === null)).toBe(true);
    expect(
      screen.getAllByText("It needed 1 more answer to see how the amounts were spread.").length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/The middle half gave/)).toBeNull();
  });

  it("deletes a saved round with Undo", () => {
    const r = foldedRound(rowsInStore(), SPLITS);
    useWorkspaceStore.setState({ allocationRounds: [r] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete the round of/ }));
    expect(roundsInStore()).toHaveLength(0);
    undo(`Deleted the round of 20 Oct 2026 · 5 people · live`);
    expect(roundsInStore()).toHaveLength(1);
  });

  it("holds the round back with fewer than two items", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Search")] });
    renderPage();
    expect(
      screen.getByText("Add at least two items to split between first, then run a round.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add split" })).toBeNull();
  });
});

describe("$100 Test page: first run and the example", () => {
  it("shows an empty state with an example that never reaches the workspace", () => {
    renderPage();
    expect(screen.getByText(/No items yet\. Add two or more above/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(box("Faster search")).toBeDisabled();
    expect(
      screen.getByText("Clear the example to run a round with your team.")
    ).toBeInTheDocument();
    expect(screen.getByText("Team results")).toBeInTheDocument();
    expect(rowsInStore()).toHaveLength(0);
    expect(roundsInStore()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No items yet\. Add two or more above/)).toBeInTheDocument();
  });

  it("builds an example round the kit's counting agrees with", () => {
    const ex = buildExample(new Date("2026-10-26T12:00:00"));
    expect(ex.rows.every((r) => r.id.startsWith("example-"))).toBe(true);
    expect(splitSummary(ex.rows).full).toBe(true);
    const splits = [
      [40, 30, 20, 10, 0],
      [30, 20, 30, 20, 0],
      [50, 10, 20, 10, 10],
      [20, 40, 10, 30, 0],
      [35, 25, 25, 15, 0],
      [30, 30, 15, 10, 15],
    ];
    const folded = foldedRound(ex.rows, splits);
    const [round] = ex.rounds;
    expect(round.id).toBe(exampleId("hundred-round-1"));
    expect(round.date).toBe("2026-10-25");
    expect(round.items.map(({ total, bands, backers }) => ({ total, bands, backers }))).toEqual(
      folded.items.map(({ total, bands, backers }) => ({ total, bands, backers }))
    );
  });
});

describe("$100 Test: Markdown", () => {
  it("exports the verdict, the agreed split and the latest round beside it", () => {
    const rows = [row("a", "Search", 50), row("b", "Exports", 30), row("c", "Themes", 20)];
    const r = foldedRound(rows, SPLITS);
    const md = toMarkdown(rows, [r], new Date("2026-10-26T12:00:00"));
    expect(md).toContain("# $100 Test — 26 Oct 2026");
    expect(md).toContain(
      "> 5 people split $100 each: Search leads with $40 on average, and the team mostly agrees on it."
    );
    expect(md).toContain("| Search | $50 |");
    expect(md).toContain("All $100 is given out.");
    expect(md).toContain("## Team round: $100 Test");
    expect(md).toContain("| Search | $50 | $40 |");
    expect(toMarkdown([], [])).toContain("No items yet.");
  });

  it("is what the page exports", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Search", 60), row("b", "B", 40)] });
    renderPage();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "> Agreed split: Search leads with $60."
    );
  });
});

/* ── Agent actions ──────────────────────────────────────────────────── */

describe("tool.hundred_dollar_test", () => {
  const call = (verb: string, params: Record<string, unknown> = {}) =>
    registry.get(`tool.hundred_dollar_test.${verb}`)?.handler(params, ctx()) as Promise<
      Record<string, unknown>
    >;
  const callServer = (verb: string, params: Record<string, unknown> = {}) =>
    registry.get(`tool.hundred_dollar_test.${verb}`)?.mcpHandler?.(params, ctx()) as Promise<
      Record<string, unknown>
    >;

  it("registers a read and write verbs, each with a server handler", () => {
    expect(registry.get("tool.hundred_dollar_test.list_state")?.category).toBe("read");
    for (const verb of ["add_item", "set_allocation", "record_round", "remove_round"]) {
      expect(registry.get(`tool.hundred_dollar_test.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.hundred_dollar_test.${verb}`)?.mcpHandler).toBeTypeOf("function");
    }
  });

  it("adds items and caps an amount like the page", async () => {
    const a = await call("add_item", { title: "Search" });
    const b = await call("add_item", { title: "Exports" });
    expect(rowsInStore().map((x) => x.fields)).toEqual([{}, {}]);
    await call("set_allocation", { id: a.id, amount: 70 });
    const r = await call("set_allocation", { id: b.id, amount: 50 });
    expect(r).toEqual({
      set: true,
      saved: 30,
      note: "Only $30 was left, so Exports got $30, not $50. Lower another item first to move money here.",
      remaining: 0,
    });
    expect(await call("set_allocation", { id: "nope", amount: 5 })).toMatchObject({ set: false });
  });

  it("records paper splits as totals and bands, refusing what can't be a round", async () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Search"), row("b", "Exports"), row("c", "Themes")],
    });
    const asSplits = (s: number[][]) => s.map(([a, b, c]) => ({ a, b, c }));
    expect(await call("record_round", { splits: asSplits(SPLITS.slice(0, 2)) })).toMatchObject({
      saved: false,
      reason: "A round needs 3 people, so no one's split shows.",
    });
    expect(
      await call("record_round", { splits: [{ a: 50, b: 30 }, ...asSplits(SPLITS)] })
    ).toMatchObject({
      saved: false,
      reason: "Split 1 gives $80: each person gives out exactly $100.",
    });
    expect(await call("record_round", { splits: [{ z: 100 }] })).toMatchObject({
      saved: false,
      reason: "Unknown items: z.",
    });
    const saved = await call("record_round", { splits: asSplits(SPLITS), date: "2026-10-20" });
    expect(saved).toMatchObject({ saved: true, ballots: 5, date: "2026-10-20", spreadKnown: true });
    const [stored] = roundsInStore();
    expect(stored.items.map((x) => x.total)).toEqual([200, 170, 130]);
    expect(stored.items[0].bands).toEqual([0, 0, 1, 3, 1]);

    const typed = await call("record_round", { totals: { a: 300, b: 200, c: 100 }, people: 6 });
    expect(typed).toMatchObject({ saved: true, ballots: 6, spreadKnown: false });
    expect(
      await call("record_round", { totals: { a: 300, b: 200, c: 50 }, people: 6 })
    ).toMatchObject({ saved: false });
    expect(roundsInStore()).toHaveLength(2);
    const removed = await call("remove_round", { id: stored.id });
    expect(removed).toEqual({ removed: true });
    expect(roundsInStore()).toHaveLength(1);
  });

  it("gives the page's numbers for the same data", async () => {
    const rows = [row("a", "Search", 50), row("b", "Exports", 25), row("c", "Themes")];
    const r = foldedRound(rows, SPLITS);
    useWorkspaceStore.setState({ prioritizations: rows, allocationRounds: [r] });
    renderPage();
    const state = (await call("list_state")) as {
      split: { total: number; remaining: number };
      verdict: string;
      rounds: { items: { average: number }[] }[];
      latestBesideSplit: { agreed: number | null; teamAverage: number | null }[];
    };
    expect(screen.getByTestId("hundred-dollar-verdict")).toHaveTextContent(state.verdict);
    expect(screen.getByText("Given out").nextSibling).toHaveTextContent(dollars(state.split.total));
    expect(screen.getByText("Left to give").nextSibling).toHaveTextContent(
      dollars(state.split.remaining)
    );
    expect(state.rounds[0].items.map((x) => x.average)).toEqual([40, 34, 26]);
    expect(state.latestBesideSplit.map((x) => [x.agreed, x.teamAverage])).toEqual([
      [50, 40],
      [25, 34],
      [null, 26],
    ]);
  });

  it("reads and writes the user's rows on the server the same way", async () => {
    const rows = [row("a", "Search", 50), row("b", "Exports", 25)];
    const prio = new Map(rows.map((r) => [r.id, r]));
    server.set("workspace:prioritization", prio);
    const browser = await (async () => {
      useWorkspaceStore.setState({ prioritizations: rows });
      return call("list_state");
    })();
    const onServer = await callServer("list_state");
    expect(onServer).toEqual(browser);
    const r = await callServer("set_allocation", { id: "b", amount: 60 });
    expect(r).toMatchObject({ saved: 50 });
    expect(allocationOf(prio.get("b") as PrioritizationItem)).toBe(50);
    const saved = await callServer("record_round", {
      totals: { a: 150, b: 150 },
      people: 3,
    });
    expect(saved).toMatchObject({ saved: true });
    expect(server.get(ALLOCATION_ROUND_KIND)?.size).toBe(1);
    const id = (saved as { id: string }).id;
    expect(await callServer("remove_round", { id })).toEqual({ removed: true });
    expect(server.get(ALLOCATION_ROUND_KIND)?.size).toBe(0);
  });
});

/* ── On the server ──────────────────────────────────────────────────── */

const ROOT = process.cwd();

function valueImports(src: string): string[] {
  const from = Array.from(
    src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm)
  ).map((m) => m[1]);
  const bare = Array.from(src.matchAll(/^import\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  return [...from, ...bare];
}

function resolve(spec: string, importer: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(importer), spec)
      : null;
  if (base === null) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  throw new Error(`${importer} imports ${spec}, which doesn't resolve`);
}

describe("the libraries the agent actions use", () => {
  it.each(["src/lib/hundred-dollar/allocation.ts", "src/lib/buy-a-feature/game.ts"])(
    "%s imports no client module, React or the store, however deep",
    (entry) => {
      const seen = new Set<string>();
      const packages = new Set<string>();
      const queue = [path.join(ROOT, entry)];
      while (queue.length) {
        const file = queue.pop() as string;
        if (seen.has(file)) continue;
        seen.add(file);
        const src = readFileSync(file, "utf8");
        const rel = path.relative(ROOT, file);
        expect(/^\s*["']use client["']/.test(src), `${rel} is a "use client" module`).toBe(false);
        for (const spec of valueImports(src)) {
          const next = resolve(spec, file);
          if (next) queue.push(next);
          else packages.add(spec);
          expect(spec, `${rel} imports the store`).not.toMatch(/stores\/workspace-store/);
        }
      }
      expect(seen.size).toBeGreaterThan(3);
      for (const banned of ["react", "react-dom", "zustand", "lucide-react"]) {
        expect(Array.from(packages)).not.toContain(banned);
      }
    }
  );
});
