import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Backlog Prioritizer, the Phase 7 hub, against the tool UX contract:
 * "Add item" leaves every method unscored; the items table edits each
 * method in place through the method registry (WSJF Fibonacci to 20, no
 * clamp; a blank is Not scored, never 0) and writes the backlog item the
 * method tools' rows read through; Decide order shows each method's places
 * and the Borda consensus, then saves the team's order (drag, keyboard) as
 * BacklogItem.rank in one undoable; the MoSCoW tab reorders a bucket;
 * Sprint Planning imports in that order; the verdict, the Markdown export
 * and the agent's list_state / decide_order read the same numbers.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; data: unknown }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string, data: unknown) => logs.push({ action, data }) }),
}));
const exported = vi.hoisted(() => ({
  markdown: "" as string | undefined,
  csv: undefined as unknown,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, csvData }: { markdown?: string; csvData?: unknown }) => {
    exported.markdown = markdown;
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { PrioritizerClient } from "@/app/(tools)/prioritizer/prioritizer-client";
import { buildExample } from "@/app/(tools)/prioritizer/example";
import { toMarkdown } from "@/app/(tools)/prioritizer/markdown";
import {
  DISAGREE_SPREAD,
  analyseOrder,
  methodsVerdict,
  orderVerdict,
} from "@/app/(tools)/prioritizer/verdict";
import {
  consensusPlaces,
  groupReorder,
  moveTo,
  ordinal,
  placeText,
  savedOrder,
} from "@/app/(tools)/prioritizer/order";
import { scorePatch, validateNewItem, validateScores } from "@/app/(tools)/prioritizer/hub-form";
import { matrixPoints, matrixText, valueAt } from "@/app/(tools)/prioritizer/matrix";
import { methodText } from "@/app/(tools)/prioritizer/method-text";
import { evaluateItemIn, evaluateRow } from "@/lib/prioritization/methods";
import { bordaConsensus, rankByMethod, rankMethodRows } from "@/lib/prioritization/rank";
import { importCandidates, storyFromBacklogItem } from "@/app/(tools)/sprint-planning/view";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import "@/lib/actions/tools/prioritizer";

const NOW = "2026-10-26T09:00:00.000Z";
const state = () => useWorkspaceStore.getState();
const items = () => state().backlogItems ?? [];
const stored = (id: string) => items().find((b) => b.id === id);
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);

const item = (id: string, name: string, extra: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  name,
  updatedAt: NOW,
  ...extra,
});

/** The last Undo toast's action. */
function undoLast() {
  const call = toastSpy.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];
  act(() => call[1].action.onClick());
}
const lastToast = () => (toastSpy.mock.calls.at(-1) as [string] | undefined)?.[0];

const renderHub = () =>
  render(
    <TooltipProvider>
      <PrioritizerClient />
    </TooltipProvider>
  );

const openTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

/** The desktop table's control (the phone cards hold a second copy). */
const first = (role: string, name: string | RegExp) => screen.getAllByRole(role, { name })[0];

/** The Decide order step's consensus table (the desktop copy). */
const consensusTable = () =>
  screen
    .getAllByRole("table")
    .find((t) => within(t).queryByRole("columnheader", { name: /Consensus/ }))!;

const nameOfExample = (key: string) =>
  buildExample(NOW).find((i) => i.id === `example-backlog-${key}`)!.name;

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  exported.markdown = undefined;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [], stories: [] });
});

/* ── Add item ─────────────────────────────────────────────────────── */

describe("Add item", () => {
  it("refuses a blank name inline and saves nothing", () => {
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByText("Enter the item's name.")).toBeInTheDocument();
    expect(items()).toEqual([]);
  });

  it("adds the name and nothing else: every method Not scored, not ordered", () => {
    renderHub();
    fireEvent.change(screen.getByRole("textbox", { name: /^Item/ }), {
      target: { value: "  Passkey   sign-in " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const [added] = items();
    expect(Object.keys(added).sort()).toEqual(["id", "name", "updatedAt"]);
    expect(added.name).toBe("Passkey sign-in");
    expect(first("button", /^Edit MoSCoW for Passkey sign-in \(Not sorted yet\)/)).toHaveFocus();
    expect(first("button", /^Edit WSJF for Passkey sign-in \(Not scored\)/)).toBeInTheDocument();
    expect(first("button", /^Edit RICE for Passkey sign-in \(Not scored\)/)).toBeInTheDocument();
    expect(
      first("button", /^Edit Value\/Effort for Passkey sign-in \(Not placed yet\)/)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not ordered yet").length).toBeGreaterThan(0);
    expect(logs.map((l) => l.action)).toEqual(["item_added"]);
  });

  it("notes a name the backlog already has, without refusing it", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Dark mode")] });
    renderHub();
    fireEvent.change(screen.getByRole("textbox", { name: /^Item/ }), {
      target: { value: "dark  MODE" },
    });
    expect(screen.getByText(/“Dark mode” is already on the backlog/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(items()).toHaveLength(2);
  });

  it("checks the name's length and keeps the description", () => {
    expect(validateNewItem({ name: "x".repeat(201), description: "" })).toMatchObject({
      ok: false,
      errors: { name: expect.stringMatching(/200 characters/) },
    });
    expect(validateNewItem({ name: "A", description: "  why  " })).toEqual({
      ok: true,
      values: { name: "A", description: "why" },
    });
  });
});

/* ── Scores edited in place ───────────────────────────────────────── */

const dialog = (name: string) => screen.getByRole("dialog", { name });
const pick = (scope: HTMLElement, group: string, value: string) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );

describe("scores edited in place", () => {
  it("keeps WSJF's Fibonacci 13 and 20 (no clamp to 10) and shows the engine's score", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Auth")] });
    renderHub();
    fireEvent.click(first("button", /^Edit WSJF for Auth/));
    const d = dialog("WSJF for Auth");
    pick(d, "Business value", "13");
    pick(d, "Time criticality", "20");
    pick(d, "Risk reduction / opportunity enablement", "1");
    pick(d, "Job size", "2");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")).toMatchObject({
      businessValue: 13,
      timeCriticality: 20,
      riskReduction: 1,
      jobSize: 2,
    });
    expect(first("button", /^Edit WSJF for Auth \(17\.00\)/)).toBeInTheDocument();
    expect(logs.at(-1)).toMatchObject({ action: "score_updated", data: { method: "wsjf" } });
  });

  it("refuses a partly scored method inline, and Clear all saves it Not scored", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Auth", { businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 2 }),
      ],
    });
    renderHub();
    fireEvent.click(first("button", /^Edit WSJF for Auth/));
    let d = dialog("WSJF for Auth");
    fireEvent.click(within(d).getByRole("button", { name: "Clear Job size" }));
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByText("Pick a job size.")).toBeInTheDocument();
    expect(stored("b1")?.jobSize).toBe(2);

    fireEvent.click(within(d).getByRole("button", { name: "Clear all" }));
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    const saved = stored("b1")!;
    expect(saved.businessValue).toBeUndefined();
    expect(saved.jobSize).toBeUndefined();
    expect(first("button", /^Edit WSJF for Auth \(Not scored\)/)).toBeInTheDocument();
    d = screen.queryByRole("dialog") as HTMLElement;
    expect(d).toBeNull();
  });

  it("keeps a legacy off-scale part as Custom when it isn't touched", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Auth", { businessValue: 4, timeCriticality: 5, riskReduction: 3, jobSize: 2 }),
      ],
    });
    renderHub();
    fireEvent.click(first("button", /^Edit WSJF for Auth/));
    const d = dialog("WSJF for Auth");
    expect(within(d).getByRole("radio", { name: "Custom: 4" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    pick(d, "Job size", "3");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")).toMatchObject({ businessValue: 4, jobSize: 3 });
  });

  it("RICE: refuses an effort under 0.5, keeps the reach period, scores per quarter", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Search")] });
    renderHub();
    fireEvent.click(first("button", /^Edit RICE for Search/));
    const d = dialog("RICE for Search");
    fireEvent.change(within(d).getByRole("spinbutton", { name: /Reach/ }), {
      target: { value: "100" },
    });
    pick(d, "Reach period", "per month");
    pick(d, "Impact", "2x High");
    pick(d, "Confidence", "50% Low");
    fireEvent.change(within(d).getByRole("spinbutton", { name: /Effort/ }), {
      target: { value: "0.25" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByText("Effort is at least 0.5 person-months.")).toBeInTheDocument();
    expect(stored("b1")?.reach).toBeUndefined();

    fireEvent.change(within(d).getByRole("spinbutton", { name: /Effort/ }), {
      target: { value: "1" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")).toMatchObject({
      reach: 100,
      reachPeriod: "month",
      impact: 2,
      confidence: 50,
      effort: 1,
    });
    // 100 a month = 300 a quarter × 2 × 50% ÷ 1.
    expect(first("button", /^Edit RICE for Search \(300\)/)).toBeInTheDocument();
  });

  it("Value/Effort: both or neither, and Clear all keeps the value WSJF uses", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Auth", { businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 2 }),
      ],
    });
    renderHub();
    fireEvent.click(first("button", /^Edit Value\/Effort for Auth \(Not placed yet\)/));
    let d = dialog("Value/Effort for Auth");
    // The value is the one value field: WSJF's 8 is already there.
    expect(
      within(within(d).getByRole("radiogroup", { name: "Value" })).getByRole("radio", { name: "8" })
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByText(/Pick an effort too/)).toBeInTheDocument();
    pick(d, "Effort", "3");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")?.matrixEffort).toBe(3);
    expect(
      first("button", /^Edit Value\/Effort for Auth \(Quick Wins \(value 8, effort 3\)\)/)
    ).toBeInTheDocument();

    fireEvent.click(first("button", /^Edit Value\/Effort for Auth/));
    d = dialog("Value/Effort for Auth");
    fireEvent.click(within(d).getByRole("button", { name: "Clear all" }));
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")?.matrixEffort).toBeUndefined();
    expect(stored("b1")?.businessValue).toBe(8);
    expect(evaluateItemIn(stored("b1")!, [], "wsjf").score).toBeCloseTo(8);
  });

  it("MoSCoW: a bucket is picked, never defaulted", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Auth")] });
    renderHub();
    fireEvent.click(first("button", /^Edit MoSCoW for Auth \(Not sorted yet\)/));
    const d = dialog("MoSCoW for Auth");
    // Nothing is checked until picked.
    expect(
      within(d)
        .getAllByRole("radio")
        .every((r) => r.getAttribute("aria-checked") === "false")
    ).toBe(true);
    pick(d, "Bucket", "Must have");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(stored("b1")?.moscow).toBe("must");
  });

  it("reads an old 'Add item' default as Not scored and writes nothing on view", () => {
    const legacy: BacklogItem = {
      id: "old",
      name: "Legacy",
      moscow: "should",
      businessValue: 5,
      timeCriticality: 5,
      riskReduction: 5,
      jobSize: 5,
      reach: 100,
      impact: 1,
      confidence: 80,
      effort: 1,
      value: 5,
      matrixEffort: 5,
    };
    useWorkspaceStore.setState({ backlogItems: [legacy] });
    renderHub();
    expect(first("button", /^Edit MoSCoW for Legacy \(Not sorted yet\)/)).toBeInTheDocument();
    expect(first("button", /^Edit WSJF for Legacy \(Not scored\)/)).toBeInTheDocument();
    expect(first("button", /^Edit RICE for Legacy \(Not scored\)/)).toBeInTheDocument();
    expect(items()).toEqual([legacy]);
  });

  it("writes through to the item, which the linked method rows read (no fan-out)", () => {
    const row: PrioritizationItem = {
      id: "r1",
      framework: "rice",
      title: "Search",
      fields: { reach: 10, reachPeriod: "quarter", impact: 1, confidence: 100, effort: 1 },
      score: 10,
      status: "scored",
      backlogItemId: "b1",
      updatedAt: NOW,
    };
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Search", { reach: 10, impact: 1, confidence: 100, effort: 1 })],
      prioritizations: [row],
    });
    renderHub();
    fireEvent.click(first("button", /^Edit RICE for Search/));
    const d = dialog("RICE for Search");
    fireEvent.change(within(d).getByRole("spinbutton", { name: /Reach/ }), {
      target: { value: "500" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    // The row itself is untouched; read through, it scores the hub's 500.
    expect(storedRow("r1")).toEqual(row);
    expect(evaluateRow(storedRow("r1")!, stored("b1")).score).toBe(500);
    expect(rankMethodRows("rice", [row], items())[0].values.reach).toBe(500);
  });

  it("scorePatch clears the blanks it names and leaves the shared value to the other method", () => {
    const both = item("b1", "A", { businessValue: 8, matrixEffort: 3, jobSize: 2 });
    expect(scorePatch("wsjf", {}, both)).toEqual({
      timeCriticality: undefined,
      riskReduction: undefined,
      jobSize: undefined,
    });
    expect(scorePatch("wsjf", {}, item("b2", "B", { businessValue: 8 }))).toHaveProperty(
      "businessValue",
      undefined
    );
    expect(
      scorePatch("rice", {}, item("b3", "C", { reachPeriod: "week", reach: 4 }))
    ).not.toHaveProperty("reachPeriod");
    expect(validateScores("rice", { reachPeriod: "month" })).toEqual({ ok: true, values: {} });
    expect(
      validateScores("wsjf", { businessValue: 7, timeCriticality: 1, rrOe: 1, jobSize: 1 })
    ).toMatchObject({ ok: false });
  });
});

/* ── The name and delete ──────────────────────────────────────────── */

describe("the items table", () => {
  it("refuses an empty name and keeps the old one", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Auth")] });
    renderHub();
    const input = first("textbox", "Name of Auth");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(stored("b1")?.name).toBe("Auth");
    expect(input).toHaveValue("Auth");
    expect(screen.getByText("A name can't be empty, so it was kept.")).toBeInTheDocument();
  });

  it("deletes with Undo, which restores the item and its links", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Auth"), item("b2", "Search")],
      prioritizations: [
        {
          id: "r1",
          framework: "rice",
          title: "Auth",
          status: "open",
          backlogItemId: "b1",
          updatedAt: NOW,
        },
      ],
    });
    renderHub();
    fireEvent.click(first("button", "Delete Auth"));
    expect(items().map((i) => i.id)).toEqual(["b2"]);
    expect(storedRow("r1")?.backlogItemId).toBeUndefined();
    expect(lastToast()).toBe("Deleted “Auth”");
    undoLast();
    expect(
      items()
        .map((i) => i.id)
        .sort()
    ).toEqual(["b1", "b2"]);
    expect(storedRow("r1")?.backlogItemId).toBe("b1");
  });

  it("holds a sorted table still while scores change, until Re-sort", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("a", "Alpha", { businessValue: 8, timeCriticality: 1, riskReduction: 1, jobSize: 1 }),
        item("b", "Beta", { businessValue: 3, timeCriticality: 1, riskReduction: 1, jobSize: 1 }),
      ],
    });
    renderHub();
    const table = screen.getAllByRole("table")[0];
    fireEvent.click(within(table).getByRole("button", { name: /^WSJF, sort/ }));
    const names = () =>
      within(table)
        .getAllByRole("textbox", { name: /^Name of/ })
        .map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual(["Alpha", "Beta"]);
    fireEvent.click(within(table).getByRole("button", { name: /^Edit WSJF for Beta/ }));
    const d = dialog("WSJF for Beta");
    pick(d, "Business value", "20");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(names()).toEqual(["Alpha", "Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(names()).toEqual(["Beta", "Alpha"]);
  });

  it("gives every item a phone card with the same in-place editors", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Auth")] });
    renderHub();
    const cards = document.querySelector("ul.md\\:hidden") as HTMLElement;
    expect(cards).not.toBeNull();
    const card = within(cards).getAllByRole("listitem")[0];
    for (const label of ["MoSCoW", "WSJF", "RICE", "Value/Effort"]) {
      expect(
        within(card).getByRole("button", {
          name: new RegExp(`^Edit ${label.replace("/", "\\/")} for Auth`),
        })
      ).toBeInTheDocument();
    }
    expect(within(card).getByRole("button", { name: "Delete Auth" })).toBeInTheDocument();
  });
});

/* ── Decide order ─────────────────────────────────────────────────── */

describe("Decide order", () => {
  const load = () => useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });

  it("shows each method's places with ties, the consensus and the unscored items", () => {
    load();
    renderHub();
    openTab("Decide order");
    const all = analyseOrder(items(), []);
    expect(all.used.map((r) => r.method)).toEqual(["moscow", "wsjf", "rice", "value-effort"]);
    // RICE ties the rebuild and address autocomplete (1,250 each).
    const rice = all.used.find((r) => r.method === "rice")!;
    expect(placeText(rice, "example-backlog-rebuild")).toBe("tied 4–5");
    expect(placeText(rice, "example-backlog-autocomplete")).toBe("tied 4–5");
    expect(screen.getAllByText("tied 4–5").length).toBeGreaterThanOrEqual(2);
    // The rebuild: a Must, near the bottom on WSJF.
    expect(within(consensusTable()).getAllByText("Methods disagree").length).toBe(
      all.disagree.length
    );
    const unscored = screen.getByText(
      /Not scored by any method in the consensus \(1\)/
    ).parentElement!;
    expect(within(unscored).getByText(nameOfExample("receipts"))).toBeInTheDocument();
    expect(
      within(unscored).getByRole("link", { name: `WSJF: ${nameOfExample("receipts")}` })
    ).toHaveAttribute("href", "/wsjf?backlogItem=example-backlog-receipts");
    expect(
      screen.getAllByText(
        /^None of the 8 items is ordered yet; the methods disagree on “Rebuild checkout/
      ).length
    ).toBeGreaterThan(0);
  });

  it("fills from the consensus and saves rank 1..N in one undoable; Undo puts it back", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    const list = screen.getByRole("list", { name: "Your order" });
    const consensus = bordaConsensus(items(), [])
      .filter((c) => c.borda !== null)
      .map((c) => c.itemId);
    const shown = within(list)
      .getAllByRole("listitem")
      .map((li) =>
        within(li)
          .getByRole("button", { name: /^Reorder/ })
          .getAttribute("aria-label")
      );
    expect(shown).toHaveLength(consensus.length);
    expect(shown[0]).toContain(itemName(consensus[0]));
    // Nothing is saved until Save order.
    expect(items().every((i) => i.rank === undefined)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(lastToast()).toBe("Saved the order of 7 items");
    expect(savedOrder(items())).toEqual(consensus);
    expect(stored("example-backlog-receipts")?.rank).toBeUndefined();
    expect(logs.at(-1)).toMatchObject({ action: "order_saved", data: { ranked: 7 } });

    undoLast();
    expect(items().every((i) => i.rank === undefined)).toBe(true);
  });

  it("moves with the keyboard and the buttons, says so, and keeps focus on the row", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    const list = () => screen.getByRole("list", { name: "Your order" });
    const order = () =>
      within(list())
        .getAllByRole("button", { name: /^Reorder/ })
        .map((b) => b.getAttribute("aria-label")!.replace(/^Reorder “(.*)”, .*$/, "$1"));
    const before = order();
    const grip = within(list()).getByRole("button", {
      name: new RegExp(`^Reorder “${before[1]}”`),
    });
    grip.focus();
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(order().slice(0, 2)).toEqual([before[1], before[0]]);
    expect(screen.getByText(`Moved “${before[1]}” to 1 of ${before.length}.`)).toBeInTheDocument();
    expect(
      within(list()).getByRole("button", { name: new RegExp(`^Reorder “${before[1]}”, 1 of`) })
    ).toHaveFocus();

    fireEvent.keyDown(
      within(list()).getByRole("button", { name: new RegExp(`^Reorder “${before[1]}”`) }),
      { key: "End" }
    );
    expect(order().at(-1)).toBe(before[1]);

    fireEvent.click(within(list()).getByRole("button", { name: `Move “${before[0]}” down` }));
    expect(order()[1]).toBe(before[0]);

    fireEvent.change(within(list()).getByRole("combobox", { name: `Position of “${before[2]}”` }), {
      target: { value: "0" },
    });
    expect(order()[0]).toBe(before[2]);
  });

  it("takes an item out, adds one in, and saves the rest unranked", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    const receipts = nameOfExample("receipts");
    fireEvent.click(screen.getByRole("button", { name: `Add “${receipts}” to the order` }));
    const list = screen.getByRole("list", { name: "Your order" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    const ar = nameOfExample("ar");
    fireEvent.click(within(list).getByRole("button", { name: `Take “${ar}” out of the order` }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(stored("example-backlog-receipts")?.rank).toBe(7);
    expect(stored("example-backlog-ar")?.rank).toBeUndefined();
    expect(
      within(screen.getByRole("list", { name: "Not ordered yet" })).getByText(ar)
    ).toBeInTheDocument();
  });

  it("keeps a new item Not ordered yet after a save", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Item/ }), {
      target: { value: "Gift cards" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const added = items().find((i) => i.name === "Gift cards")!;
    expect(added.rank).toBeUndefined();
    expect(
      within(screen.getByRole("list", { name: "Not ordered yet" })).getByText("Gift cards")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/^7 of 9 items are ordered/).length).toBeGreaterThan(0);
  });

  it("drops a method from the consensus when its chip is turned off", () => {
    load();
    renderHub();
    openTab("Decide order");
    const chip = within(screen.getByRole("group", { name: "Methods in the consensus" })).getByRole(
      "button",
      { name: /^MoSCoW/ }
    );
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    const noMoscow = analyseOrder(items(), [], ["wsjf", "rice", "value-effort"]);
    expect(within(consensusTable()).queryAllByText("Methods disagree").length).toBe(
      noMoscow.disagree.length
    );
    expect(within(consensusTable()).queryByRole("columnheader", { name: /MoSCoW/ })).toBeNull();
  });
});

/* ── MoSCoW tab ───────────────────────────────────────────────────── */

describe("MoSCoW tab", () => {
  it("reorders a bucket at once, with Undo, leaving the other buckets where they are", () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });
    renderHub();
    openTab("MoSCoW");
    const must = screen.getByRole("list", { name: "Must have, in order" });
    const guest = nameOfExample("guest");
    fireEvent.click(within(must).getByRole("button", { name: `Move “${guest}” up` }));
    expect(stored("example-backlog-guest")?.rank).toBe(1);
    expect(stored("example-backlog-rebuild")?.rank).toBe(2);
    // Only the bucket's items were ordered by the move.
    expect(items().filter((i) => i.rank !== undefined)).toHaveLength(2);
    expect(lastToast()).toBe(`Moved “${guest}” to 1 of 2 in Must have`);
    undoLast();
    expect(items().every((i) => i.rank === undefined)).toBe(true);
  });

  it("lists items without a bucket under Not sorted yet", () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });
    renderHub();
    openTab("MoSCoW");
    const unsorted = screen.getByRole("region", { name: "Not sorted yet" });
    expect(within(unsorted).getByText(nameOfExample("receipts"))).toBeInTheDocument();
  });

  it("groupReorder swaps a group among its own places and orders its members", () => {
    const xs = [
      item("a", "A", { rank: 1 }),
      item("b", "B", { rank: 2 }),
      item("c", "C", { rank: 3 }),
      item("d", "D"),
      item("e", "E"),
    ];
    // Group a, c, d: d to the top takes a's place; b keeps 2; e stays unordered.
    expect(groupReorder(xs, ["d", "a", "c"])).toEqual(["d", "b", "a", "c"]);
    // A pair is a group too: d and a swap places.
    expect(groupReorder(xs, ["d", "a"])).toEqual(["d", "b", "c", "a"]);
    // A list naming an item that isn't there, or one twice, changes nothing.
    expect(groupReorder(xs, ["d", "zz"])).toEqual(["a", "b", "c"]);
    expect(groupReorder(xs, ["a", "a"])).toEqual(["a", "b", "c"]);
  });
});

/* ── Sprint Planning, export, verdict, agent parity ───────────────── */

describe("the order elsewhere", () => {
  it("is the order Sprint Planning imports in, with the rank on the story", () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    const order = savedOrder(items());
    expect(
      importCandidates(items(), [])
        .map((i) => i.id)
        .slice(0, order.length)
    ).toEqual(order);
    const story = storyFromBacklogItem(stored(order[0])!, "s1");
    expect(story).toMatchObject({
      backlogRank: 1,
      sourceRef: { tool: "prioritizer", id: order[0] },
    });
  });

  it("exports Markdown with the order and each method's places", () => {
    const xs = buildExample(NOW).map((i, n) => (n < 2 ? { ...i, rank: n + 1 } : i));
    useWorkspaceStore.setState({ backlogItems: xs });
    renderHub();
    const md = exported.markdown!;
    expect(md).toContain("## Decided order");
    expect(md).toContain(`| 1 | ${xs[0].name} | Must have |`);
    expect(md).toContain("## Not ordered yet");
    expect(md).toContain("## Rank per method");
    expect(md).toContain(
      "Combined: MoSCoW, WSJF, RICE and Value/Effort. Left out: ICE (no item scored), Kano (no item scored) and Cost of Delay (no item scored)."
    );
    expect(md).toMatch(/\| Address autocomplete \| tied 5–6 \| \d(\.\d)? \| tied 4–5 \|/);
    expect(md).toContain(
      "Not scored by any of these methods (1 item): Email receipts in dark mode."
    );
    // A pipe in a name can't break the table.
    expect(
      toMarkdown({
        items: [item("p", "A | B", { rank: 1 })],
        rows: [],
        analysis: analyseOrder([item("p", "A | B", { rank: 1 })], []),
        verdict: "v",
      })
    ).toContain("A \\| B");
  });

  it("the agent's list_state and decide_order read the page's places and consensus", async () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW), prioritizations: [] });
    const ctx = makeContext("u", "agent");
    const state = (await registry.get("tool.prioritizer.list_state")!.handler({}, ctx)) as {
      items: {
        id: string;
        methodRanks: Record<string, number>;
        consensus: number | null;
        coverage: number;
        disagree: boolean;
      }[];
      rankedMethods: string[];
    };
    const decided = (await registry.get("tool.prioritizer.decide_order")!.handler({}, ctx)) as {
      suggestedOrder: string[];
      consensus: { id: string; disagree: boolean }[];
    };
    const page = analyseOrder(items(), []);
    expect(state.rankedMethods).toEqual(page.used.map((r) => r.method));
    for (const r of page.used) {
      for (const i of state.items) {
        expect(i.methodRanks[r.method]).toBe(r.position.get(i.id));
      }
    }
    const byId = new Map(page.consensus.map((c) => [c.itemId, c]));
    for (const i of state.items) {
      const c = byId.get(i.id)!;
      expect(i.consensus).toBe(c.borda === null ? null : Math.round(c.borda * 1000) / 10);
      expect(i.coverage).toBe(c.coverage);
    }
    const flagged = (xs: { id: string; disagree: boolean }[]) =>
      xs
        .filter((x) => x.disagree)
        .map((x) => x.id)
        .sort();
    expect(flagged(state.items)).toEqual(page.disagree.map((c) => c.itemId).sort());
    expect(flagged(decided.consensus)).toEqual(page.disagree.map((c) => c.itemId).sort());
    // "Use the consensus" fills what decide_order suggests.
    expect(
      consensusPlaces(page.consensus)
        .filter((p) => p.place !== null)
        .map((p) => p.row.itemId)
    ).toEqual(decided.suggestedOrder);
  });

  it("add_item creates an item every surface reads as unscored and unordered", async () => {
    const r = (await registry
      .get("tool.prioritizer.add_item")!
      .handler({ name: "Gift cards" }, makeContext("u", "agent"))) as { id: string };
    const added = stored(r.id)!;
    expect(added.rank).toBeUndefined();
    for (const id of ["moscow", "wsjf", "rice", "value-effort"] as const) {
      expect(evaluateItemIn(added, [], id).sortKey).toBeNull();
    }
    await expect(
      registry
        .get("tool.prioritizer.add_item")!
        .handler({ name: "X", jobSize: 4 }, makeContext("u", "agent"))
    ).rejects.toThrow(/Fibonacci|one of/);
  });
});

describe("verdicts", () => {
  const names = (id: string) => id.toUpperCase();
  it("says when there is nothing to order or too little scored", () => {
    expect(orderVerdict(analyseOrder([], []), names)).toBe(
      "Nothing to order yet: add an item to the backlog first."
    );
    expect(orderVerdict(analyseOrder([item("a", "A")], []), names)).toBe(
      "The item isn't ordered yet; score 2 or more items in one method to see what the methods say."
    );
  });

  it("names the one method when only one can rank, and agreement when they agree", () => {
    const wsjf = (bv: number) => ({
      businessValue: bv,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
    });
    const one = [item("a", "A", wsjf(8)), item("b", "B", wsjf(3))];
    expect(orderVerdict(analyseOrder(one, []), names)).toBe(
      "None of the 2 items is ordered yet; only WSJF has 2 or more items scored, so the consensus is its order."
    );
    const agree = [
      item("a", "A", { ...wsjf(8), moscow: "must", rank: 1 }),
      item("b", "B", { ...wsjf(3), moscow: "could" }),
    ];
    expect(orderVerdict(analyseOrder(agree, []), names)).toBe(
      "1 of 2 items are ordered; MoSCoW and WSJF broadly agree."
    );
  });

  it("names the item the methods split on most, with its places", () => {
    const xs = buildExample(NOW);
    const a = analyseOrder(xs, []);
    expect(a.disagree.length).toBeGreaterThan(0);
    expect(a.disagree.every((c) => (c.spread as number) > DISAGREE_SPREAD)).toBe(true);
    const v = orderVerdict(a, (id) => xs.find((i) => i.id === id)!.name);
    expect(v).toBe(
      "None of the 8 items is ordered yet; the methods disagree on “Rebuild checkout on the new payments platform” (joint 1st in MoSCoW, 6th in WSJF)."
    );
  });

  it("All methods: the item first in two or more methods, and the unscored count", () => {
    const xs = buildExample(NOW);
    expect(methodsVerdict(xs, [])).toBe(
      "“Clearer card-declined message” comes first in WSJF, RICE and Value/Effort; 1 item isn't scored in any method yet."
    );
    expect(methodsVerdict([], [])).toBe("Add backlog items to compare the methods.");
    expect(methodsVerdict([item("a", "A")], [])).toBe(
      "No method has 2 or more items scored yet; 1 item isn't scored in any method yet."
    );
  });
});

describe("pure helpers", () => {
  it("moveTo clamps and returns the same list for a no-op", () => {
    const ids = ["a", "b", "c"];
    expect(moveTo(ids, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTo(ids, "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTo(ids, "b", 1)).toBe(ids);
    expect(moveTo(ids, "zz", 0)).toBe(ids);
  });

  it("consensus places share a tie and leave the unscored without one", () => {
    const places = consensusPlaces([
      { itemId: "a", borda: 1, coverage: 2, spread: 0, perMethod: {} },
      { itemId: "b", borda: 0.5, coverage: 2, spread: 0, perMethod: {} },
      { itemId: "c", borda: 0.5, coverage: 2, spread: 0, perMethod: {} },
      { itemId: "d", borda: null, coverage: 0, spread: null, perMethod: {} },
    ]);
    expect(places.map((p) => [p.place, p.tied])).toEqual([
      [1, false],
      [2, true],
      [2, true],
      [null, false],
    ]);
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(23)).toBe("23rd");
  });

  it("the matrix: Fibonacci value axis, quadrants from the registry, a summary and a table", () => {
    expect(valueAt(1)).toBe(0);
    expect(valueAt(8)).toBe(4);
    expect(valueAt(4)).toBeCloseTo(2.5);
    const { points, unplaced } = matrixPoints(buildExample(NOW));
    expect(unplaced.map((i) => i.id)).toEqual([
      "example-backlog-saved-cards",
      "example-backlog-receipts",
    ]);
    expect(points[0].quadrant).toBe("quick_wins");
    const text = matrixText(points, unplaced.length);
    expect(text.summary).toBe(
      "6 items placed: 3 Quick Wins, 1 Big Bets, 1 Fill-Ins and 1 Time Wasters; do first: “Clearer card-declined message” (value 8, effort 2); 2 items not placed yet."
    );
    expect(text.table.columns).toEqual(["Item", "Value", "Effort", "Quadrant"]);
    expect(text.table.rows).toHaveLength(6);
  });

  it("methodText says each method's result or its own not-yet", () => {
    const x = item("a", "A", { moscow: "wont" });
    expect(methodText("moscow", evaluateItemIn(x, [], "moscow"))).toBe("Won't have (this time)");
    expect(methodText("wsjf", evaluateItemIn(x, [], "wsjf"))).toBe("Not scored");
    expect(methodText("value-effort", evaluateItemIn(x, [], "value-effort"))).toBe(
      "Not placed yet"
    );
    expect(rankByMethod([x], [], "moscow")).toBeNull();
  });
});

describe("the example", () => {
  it("is on the Fibonacci scale, unordered, unevenly scored, and loads once", () => {
    const xs = buildExample(NOW);
    expect(xs.every((i) => i.id.startsWith("example-"))).toBe(true);
    expect(xs.every((i) => i.rank === undefined && i.value === undefined)).toBe(true);
    const parts = xs.flatMap((r) => [
      r.businessValue,
      r.timeCriticality,
      r.riskReduction,
      r.jobSize,
    ]);
    expect(
      parts
        .filter((n) => n !== undefined)
        .every((n) => [1, 2, 3, 5, 8, 13, 20].includes(n as number))
    ).toBe(true);
    expect(
      evaluateItemIn(xs.find((i) => i.id === "example-backlog-ar")!, [], "rice").score
    ).toBeNull();

    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(items()).toHaveLength(xs.length);
    act(() => {
      // Loading again adds nothing (the ids are already there).
      useWorkspaceStore.getState().upsertBacklogItem(item("mine", "Mine"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(items().map((i) => i.id)).toEqual(["mine"]);
  });
});

function itemName(id: string) {
  return items().find((i) => i.id === id)?.name ?? id;
}
