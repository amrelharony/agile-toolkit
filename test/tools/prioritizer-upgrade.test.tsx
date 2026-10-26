import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
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
const announced = vi.hoisted(() => [] as string[]);
vi.mock("@/components/a11y/live-announcer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/a11y/live-announcer")>()),
  useAnnounce: () => (message: string) => announced.push(message),
}));
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
  consensusScore,
  groupReorder,
  moveTo,
  ordinal,
  placeText,
  savedOrder,
} from "@/app/(tools)/prioritizer/order";
import { usePrioritizerStore } from "@/app/(tools)/prioritizer/use-prioritizer-store";
import { scorePatch, validateNewItem, validateScores } from "@/app/(tools)/prioritizer/hub-form";
import { matrixPoints, matrixText, valueAt } from "@/app/(tools)/prioritizer/matrix";
import { itemName as shownName, methodText } from "@/app/(tools)/prioritizer/method-text";
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
  toastSpy.dismiss.mockReset();
  announced.length = 0;
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

  it("logs a score change only when a save changed something", () => {
    useWorkspaceStore.setState({ backlogItems: [item("b1", "Auth")] });
    renderHub();
    const saveMoscow = (bucket?: string) => {
      fireEvent.click(first("button", /^Edit MoSCoW for Auth/));
      const d = dialog("MoSCoW for Auth");
      if (bucket) fireEvent.click(within(d).getByRole("radio", { name: bucket }));
      fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    };
    const scoreLogs = () => logs.filter((l) => l.action === "score_updated");
    // Save on a method left blank: nothing changed, nothing logged.
    saveMoscow();
    expect(scoreLogs()).toEqual([]);
    expect(stored("b1")).toEqual(item("b1", "Auth"));
    expect(announced.at(-1)).toBe("No change: MoSCoW for “Auth” stays Not sorted yet.");
    saveMoscow("Could have");
    expect(scoreLogs()).toEqual([
      { action: "score_updated", data: { itemId: "b1", method: "moscow", fields: ["moscow"] } },
    ]);
    expect(announced.at(-1)).toBe("MoSCoW for “Auth”: Could have.");
    // Saved again as it is: still the one entry.
    saveMoscow();
    expect(scoreLogs()).toHaveLength(1);
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

  it("offers no Re-sort while unsorted, and a new sort uses the values as they are", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("a", "Alpha", { businessValue: 8, timeCriticality: 1, riskReduction: 1, jobSize: 1 }),
        item("b", "Beta", { businessValue: 3, timeCriticality: 1, riskReduction: 1, jobSize: 1 }),
      ],
    });
    renderHub();
    const table = screen.getByRole("table", { name: "Backlog items" });
    const names = () =>
      within(table)
        .getAllByRole("textbox", { name: /^Name of/ })
        .map((i) => (i as HTMLInputElement).value);
    fireEvent.click(within(table).getByRole("button", { name: /^Edit WSJF for Beta/ }));
    const d = dialog("WSJF for Beta");
    pick(d, "Business value", "20");
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    // Unsorted, the table keeps the decided order: nothing is out of date.
    expect(names()).toEqual(["Alpha", "Beta"]);
    expect(screen.queryByText(/changed since the last sort/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-sort" })).toBeNull();
    // A sort picked now sorts by the edited WSJF.
    fireEvent.click(within(table).getByRole("button", { name: /^WSJF, sort/ }));
    expect(names()).toEqual(["Beta", "Alpha"]);
    expect(screen.queryByRole("button", { name: "Re-sort" })).toBeNull();
    // Sorted by WSJF, a rename isn't a change to the sorted column.
    const alpha = within(table).getByRole("textbox", { name: "Name of Alpha" });
    fireEvent.change(alpha, { target: { value: "Aardvark" } });
    fireEvent.blur(alpha);
    expect(stored("a")?.name).toBe("Aardvark");
    expect(screen.queryByRole("button", { name: "Re-sort" })).toBeNull();
    // Sorted by name, it is, and the chip says what changed.
    fireEvent.click(within(table).getByRole("button", { name: /^Item, sort/ }));
    const beta = within(table).getByRole("textbox", { name: "Name of Beta" });
    fireEvent.change(beta, { target: { value: "Zebra" } });
    fireEvent.blur(beta);
    expect(screen.getByText(/^Names changed since the last sort/)).toBeInTheDocument();
  });

  it("moves focus to the next row's Delete after a delete", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Auth"), item("b2", "Search"), item("b3", "Billing")],
    });
    renderHub();
    const table = screen.getByRole("table", { name: "Backlog items" });
    fireEvent.click(within(table).getByRole("button", { name: "Delete Auth" }));
    expect(within(table).getByRole("button", { name: "Delete Search" })).toHaveFocus();
    // The last row: the one above it.
    fireEvent.click(within(table).getByRole("button", { name: "Delete Billing" }));
    expect(within(table).getByRole("button", { name: "Delete Search" })).toHaveFocus();
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

  const yourOrder = () => screen.getByRole("list", { name: "Your order" });
  const shownOrder = () =>
    within(yourOrder())
      .getAllByRole("button", { name: /^Reorder/ })
      .map((b) => b.getAttribute("aria-label")!.replace(/^Reorder “(.*)”, .*$/, "$1"));
  const grip = (name: string) =>
    within(yourOrder()).getByRole("button", { name: new RegExp(`^Reorder “${name}”`) });
  const chip = (name: RegExp) =>
    within(screen.getByRole("group", { name: "Methods in the consensus" })).getByRole("button", {
      name,
    });

  it("keeps the draft and the picked methods across a tab switch, and says it isn't saved", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    const before = shownOrder();
    fireEvent.click(within(yourOrder()).getByRole("button", { name: `Move “${before[1]}” up` }));
    fireEvent.click(chip(/^MoSCoW/));

    openTab("MoSCoW");
    expect(screen.queryByRole("list", { name: "Your order" })).toBeNull();
    // The tab says the order isn't saved.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Decide order, order not saved" }), {
      button: 0,
    });
    expect(shownOrder().slice(0, 2)).toEqual([before[1], before[0]]);
    expect(screen.getByRole("button", { name: "Save order" })).toBeInTheDocument();
    expect(chip(/^MoSCoW/)).toHaveAttribute("aria-pressed", "false");
    expect(items().every((i) => i.rank === undefined)).toBe(true);
  });

  it("moves focus to a row, the list or the step's first button when its control goes", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    const receipts = nameOfExample("receipts");
    fireEvent.click(screen.getByRole("button", { name: `Add “${receipts}” to the order` }));
    expect(grip(receipts)).toHaveFocus();

    const shown = shownOrder();
    // Taken out: the row that takes its place, or the one above it at the end.
    fireEvent.click(
      within(yourOrder()).getByRole("button", { name: `Take “${shown[0]}” out of the order` })
    );
    expect(grip(shown[1])).toHaveFocus();
    fireEvent.click(
      within(yourOrder()).getByRole("button", { name: `Take “${receipts}” out of the order` })
    );
    expect(grip(shown.at(-2)!)).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(screen.getByRole("button", { name: "Use the consensus" })).toHaveFocus();
    fireEvent.click(within(yourOrder()).getByRole("button", { name: `Move “${shown[2]}” up` }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: "Use the consensus" })).toHaveFocus();
  });

  it("puts focus on Not ordered yet when the last row is taken out", () => {
    const wsjf = (bv: number) => ({
      businessValue: bv,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
    });
    useWorkspaceStore.setState({
      backlogItems: [
        item("a", "A", { ...wsjf(8), rank: 1 }),
        item("b", "B", { ...wsjf(3), rank: 2 }),
      ],
    });
    renderHub();
    openTab("Decide order");
    fireEvent.click(within(yourOrder()).getByRole("button", { name: "Take “A” out of the order" }));
    expect(grip("B")).toHaveFocus();
    fireEvent.click(within(yourOrder()).getByRole("button", { name: "Take “B” out of the order" }));
    expect(screen.getByRole("heading", { name: "Not ordered yet (2)" })).toHaveFocus();
  });

  it("keeps focus in the step after Discard when Use the consensus is disabled", () => {
    // Ordered, but no method scores anything: there is no consensus to use.
    useWorkspaceStore.setState({
      backlogItems: [item("a", "A", { rank: 1 }), item("b", "B", { rank: 2 })],
    });
    renderHub();
    openTab("Decide order");
    expect(screen.getByRole("button", { name: "Use the consensus" })).toBeDisabled();
    fireEvent.click(within(yourOrder()).getByRole("button", { name: "Move “B” up" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(shownOrder()).toEqual(["A", "B"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(yourOrder());
  });

  it("says the saved order already matches when the consensus has nothing new", () => {
    load();
    renderHub();
    openTab("Decide order");
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    fireEvent.click(screen.getByRole("button", { name: "Use the consensus" }));
    expect(announced.at(-1)).toBe(
      "The saved order already matches the consensus: nothing to save."
    );
    expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
  });

  it("words the picked methods' verdict as what is picked, not what is scored", () => {
    load();
    renderHub();
    openTab("Decide order");
    for (const name of [/^MoSCoW/, /^RICE/, /^Value\/Effort/]) fireEvent.click(chip(name));
    expect(
      screen.getByText(
        "With WSJF: none of the 8 items is ordered yet; only WSJF is picked, so the consensus is its order."
      )
    ).toBeInTheDocument();
    fireEvent.click(chip(/^WSJF/));
    expect(
      screen.getByText(
        "With no method: none of the 8 items is ordered yet; pick a method to see a consensus."
      )
    ).toBeInTheDocument();
  });

  it("names its tables, and keeps the panel's id for its tab", () => {
    load();
    renderHub();
    expect(
      screen.getByRole("table", { name: "Each backlog item's score in every method" })
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Backlog items" })).toBeInTheDocument();
    openTab("Decide order");
    const tab = screen.getByRole("tab", { name: "Decide order" });
    const panel = document.getElementById(tab.getAttribute("aria-controls")!);
    expect(panel).toHaveAttribute("role", "tabpanel");
    // The link anchor is inside the panel.
    expect(panel!.querySelector("#decide-order")).not.toBeNull();
    expect(
      screen.getByRole("table", { name: "Each item's place in every method, and the consensus" })
    ).toBeInTheDocument();
    openTab("WSJF");
    expect(screen.getByRole("table", { name: "The backlog by WSJF" })).toBeInTheDocument();
    openTab("RICE");
    expect(screen.getByRole("table", { name: "The backlog by RICE" })).toBeInTheDocument();
  });
});

/* ── MoSCoW tab ───────────────────────────────────────────────────── */

describe("MoSCoW tab", () => {
  /** The example with the Musts and Shoulds ordered, and a third Must not ordered yet. */
  const partlyOrdered = () => {
    const rank: Record<string, number> = { declined: 1, rebuild: 2, wallet: 3, guest: 4 };
    return [
      ...buildExample(NOW).map((i) => {
        const r = rank[i.id.replace("example-backlog-", "")];
        return r === undefined ? i : { ...i, rank: r };
      }),
      item("fraud", "Fraud checks", { moscow: "must" }),
    ];
  };

  it("reorders a bucket's ordered items at once, with Undo, leaving the rest where they are", () => {
    useWorkspaceStore.setState({ backlogItems: partlyOrdered() });
    renderHub();
    openTab("MoSCoW");
    const must = screen.getByRole("list", { name: "Must have, in order" });
    expect(within(must).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(screen.getByRole("list", { name: "Must have, not ordered yet" })).getByText(
        "Fraud checks"
      )
    ).toBeInTheDocument();
    const guest = nameOfExample("guest");
    fireEvent.click(within(must).getByRole("button", { name: `Move “${guest}” up` }));
    // The two Musts swap the places they held (2 and 4); the Shoulds keep 1 and 3.
    expect(stored("example-backlog-guest")?.rank).toBe(2);
    expect(stored("example-backlog-rebuild")?.rank).toBe(4);
    expect(stored("example-backlog-declined")?.rank).toBe(1);
    expect(stored("example-backlog-wallet")?.rank).toBe(3);
    // The Must nobody placed stays Not ordered yet, and so does every other bucket.
    expect(stored("fraud")?.rank).toBeUndefined();
    expect(items().filter((i) => i.rank !== undefined)).toHaveLength(4);
    expect(lastToast()).toBe(`Moved “${guest}” to 1 of 2 in Must have`);
    undoLast();
    expect(stored("example-backlog-guest")?.rank).toBe(4);
    expect(stored("example-backlog-rebuild")?.rank).toBe(2);
  });

  it("never orders an item by a move: an unordered bucket is a list that leads to Decide order", () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });
    renderHub();
    openTab("MoSCoW");
    // Nothing is ordered: no bucket offers a move, so no Could can jump above the Musts.
    expect(screen.queryByRole("list", { name: "Could have, in order" })).toBeNull();
    const could = screen.getByRole("region", { name: "Could have" });
    expect(within(could).queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Could have, not ordered yet" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(2);
    fireEvent.click(within(could).getByRole("button", { name: "Decide order for Could have" }));
    const tab = screen.getByRole("tab", { name: "Decide order" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveFocus();
    expect(items().every((i) => i.rank === undefined)).toBe(true);
  });

  it("lists items without a bucket under Not sorted yet", () => {
    useWorkspaceStore.setState({ backlogItems: buildExample(NOW) });
    renderHub();
    openTab("MoSCoW");
    const unsorted = screen.getByRole("region", { name: "Not sorted yet" });
    expect(within(unsorted).getByText(nameOfExample("receipts"))).toBeInTheDocument();
  });

  it("groupReorder swaps a group's ordered items among their places and orders nothing new", () => {
    const xs = [
      item("a", "A", { rank: 1 }),
      item("b", "B", { rank: 2 }),
      item("c", "C", { rank: 3 }),
      item("d", "D"),
      item("e", "E"),
    ];
    // Group a, c: they swap places; b keeps 2; d and e stay unordered.
    expect(groupReorder(xs, ["c", "a"])).toEqual(["c", "b", "a"]);
    // An item not ordered yet can't get a place from a move: nothing changes.
    expect(groupReorder(xs, ["d", "a", "c"])).toEqual(["a", "b", "c"]);
    // A list naming an item that isn't there, or one twice, changes nothing.
    expect(groupReorder(xs, ["a", "zz"])).toEqual(["a", "b", "c"]);
    expect(groupReorder(xs, ["a", "a"])).toEqual(["a", "b", "c"]);
    // Nothing ordered (the example's start): a Could reorder ranks nothing,
    // so it can't land above the unordered Musts.
    const none = [
      item("m", "M", { moscow: "must" }),
      item("c1", "C1", { moscow: "could" }),
      item("c2", "C2", { moscow: "could" }),
    ];
    expect(groupReorder(none, ["c2", "c1"])).toEqual([]);
  });
});

describe("saving an order", () => {
  const ranks = () => Object.fromEntries(items().map((i) => [i.id, i.rank]));

  it("replaces the older order's Undo, and never undoes into two items on one rank", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("a", "A", { rank: 1 }),
        item("b", "B", { rank: 2 }),
        item("c", "C", { rank: 3 }),
      ],
    });
    const { result } = renderHook(() => usePrioritizerStore());
    toastSpy.mockReturnValueOnce("t1");
    act(() => result.current.saveOrder(["c", "a", "b"], "first"));
    expect(ranks()).toEqual({ c: 1, a: 2, b: 3 });
    toastSpy.mockReturnValueOnce("t2");
    act(() => result.current.saveOrder(["a", "c", "b"], "second"));
    expect(ranks()).toEqual({ a: 1, c: 2, b: 3 });
    // The newer order's toast replaces the older's...
    expect(toastSpy.dismiss).toHaveBeenCalledWith("t1");
    // ...and the older Undo, if still clicked, sees the change and does nothing.
    const firstUndo = toastSpy.mock.calls[0] as [string, { action: { onClick: () => void } }];
    act(() => firstUndo[1].action.onClick());
    expect(ranks()).toEqual({ a: 1, c: 2, b: 3 });
    expect(lastToast()).toMatch(/^Not undone: the order has changed since/);
    // The newer Undo puts its own save back.
    const secondUndo = toastSpy.mock.calls[1] as [string, { action: { onClick: () => void } }];
    act(() => secondUndo[1].action.onClick());
    expect(ranks()).toEqual({ c: 1, a: 2, b: 3 });
  });

  it("undoes around an item deleted since", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("a", "A"), item("b", "B"), item("c", "C")],
    });
    const { result } = renderHook(() => usePrioritizerStore());
    act(() => result.current.saveOrder(["b", "a", "c"], "saved"));
    act(() => useWorkspaceStore.getState().removeBacklogItem("c"));
    undoLast();
    expect(ranks()).toEqual({ a: undefined, b: undefined });
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
      // The number the page prints is the one the agent reports (one decimal place).
      expect(i.consensus).toBe(consensusScore(c.borda));
      expect(i.coverage).toBe(c.coverage);
    }
    renderHub();
    openTab("Decide order");
    const consensusColumn = 2 + page.used.length; // #, Item, a column per method, Consensus
    for (const i of state.items.filter((x) => x.consensus !== null)) {
      const name = shownName(items().find((x) => x.id === i.id)!.name);
      const row = within(consensusTable())
        .getAllByRole("row")
        .find((r) => within(r).queryByText(name))!;
      expect(within(row).getAllByRole("cell")[consensusColumn].textContent).toBe(
        String(i.consensus)
      );
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

  it("add_item refuses what the hub's Add item and editors refuse", async () => {
    const action = registry.get("tool.prioritizer.add_item")!;
    const add = (params: Record<string, unknown>) =>
      action.handler(params, makeContext("u", "agent"));
    // A name of spaces is no name, through the schema and without it.
    expect(action.paramsSchema.safeParse({ name: "   " }).success).toBe(false);
    await expect(add({ name: "   " })).rejects.toThrow(/needs a name/);
    expect(action.paramsSchema.safeParse({ name: "X", confidence: 0 }).success).toBe(false);
    // RICE's own rule: a confidence of 0 would score 0.
    await expect(
      add({ name: "X", reach: 100, impact: 1, confidence: 0, effort: 1 })
    ).rejects.toThrow(/confidence: Confidence runs from just above 0% to 100%/);
    await expect(add({ name: "X", matrixEffort: 11 })).rejects.toThrow(/matrixEffort/);
    expect(items()).toEqual([]);
    // Some of a method's inputs are fine: that method stays Not scored.
    const r = (await add({ name: "  Gift cards  ", reach: 100, matrixEffort: 3 })) as {
      id: string;
    };
    const added = stored(r.id)!;
    expect(added).toMatchObject({ name: "Gift cards", reach: 100, matrixEffort: 3 });
    expect(evaluateItemIn(added, [], "rice").sortKey).toBeNull();
    expect(evaluateItemIn(added, [], "value-effort").sortKey).toBeNull();
  });

  it("flags the same items as disagreeing as the agent, at the 0.5 boundary too", async () => {
    const wsjf = (bv: number) => ({
      businessValue: bv,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
    });
    const rice = (reach: number) => ({ reach, impact: 1, confidence: 100, effort: 1 });
    // WSJF: X, Z, Y. RICE: Y, X, Z. X and Z are 0.5 apart (not flagged); Y is 1 apart.
    const xs = [
      item("x", "X", { ...wsjf(8), ...rice(500) }),
      item("y", "Y", { ...wsjf(1), ...rice(1000) }),
      item("z", "Z", { ...wsjf(3), ...rice(100) }),
    ];
    useWorkspaceStore.setState({ backlogItems: xs });
    const page = analyseOrder(xs, []);
    expect(page.consensus.find((c) => c.itemId === "x")?.spread).toBe(0.5);
    expect(page.disagree.map((c) => c.itemId)).toEqual(["y"]);
    const ctx = makeContext("u", "agent");
    const decided = (await registry.get("tool.prioritizer.decide_order")!.handler({}, ctx)) as {
      consensus: { id: string; disagree: boolean }[];
    };
    const listed = (await registry.get("tool.prioritizer.list_state")!.handler({}, ctx)) as {
      items: { id: string; disagree: boolean }[];
    };
    expect(decided.consensus.filter((c) => c.disagree).map((c) => c.id)).toEqual(["y"]);
    expect(listed.items.filter((c) => c.disagree).map((c) => c.id)).toEqual(["y"]);
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

  it("claims agreement only when two methods scored the same item", () => {
    const wsjf = (bv: number) => ({
      businessValue: bv,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
    });
    const rice = (reach: number) => ({ reach, impact: 1, confidence: 100, effort: 1 });
    // A and B only in WSJF, C and D only in RICE: no spread, but nothing compared.
    const apart = [
      item("a", "A", wsjf(8)),
      item("b", "B", wsjf(3)),
      item("c", "C", rice(500)),
      item("d", "D", rice(100)),
    ];
    const a = analyseOrder(apart, []);
    expect(a.used.map((r) => r.method)).toEqual(["wsjf", "rice"]);
    expect(orderVerdict(a, names)).toBe(
      "None of the 4 items is ordered yet; WSJF and RICE haven't scored any item in common yet, so there's nothing to compare."
    );
  });

  it("words a picked analysis as what is picked", () => {
    const xs = buildExample(NOW);
    const name = (id: string) => xs.find((i) => i.id === id)!.name;
    expect(orderVerdict(analyseOrder(xs, [], ["wsjf"]), name, { picked: true })).toBe(
      "None of the 8 items is ordered yet; only WSJF is picked, so the consensus is its order."
    );
    expect(orderVerdict(analyseOrder(xs, [], []), name, { picked: true })).toBe(
      "None of the 8 items is ordered yet; pick a method to see a consensus."
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
    // Loading again adds nothing: the ids are already there.
    const { result } = renderHook(() => usePrioritizerStore());
    act(() => result.current.loadExample());
    expect(items()).toHaveLength(xs.length);
    // Clear example removes only the example's items.
    act(() => {
      useWorkspaceStore.getState().upsertBacklogItem(item("mine", "Mine"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(items().map((i) => i.id)).toEqual(["mine"]);
  });
});

function itemName(id: string) {
  return items().find((i) => i.id === id)?.name ?? id;
}
