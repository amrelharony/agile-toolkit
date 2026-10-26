import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Scale } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The shared method-tool shell: the add form checks the method's inputs
 * (blanks are errors), rows read through to their backlog items and list
 * unscored last, an import of an item this method already scored opens
 * that row for editing, an edit writes the row and its item, delete has
 * Undo, and the example loads and clears.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { MethodTool, type MethodToolConfig } from "@/components/prioritization/method-tool";
import { TooltipProvider } from "@/components/ui/tooltip";

const STAMP = "2026-10-20T09:00:00.000Z";
const CONFIG: MethodToolConfig = {
  methodId: "wsjf",
  toolId: "wsjf",
  title: "WSJF Calculator",
  description: "Weighted Shortest Job First.",
  icon: Scale,
  noun: { one: "feature", many: "features" },
  titleLabel: "Feature title",
  listLabel: "Features, highest WSJF first",
  emptyText: "No features yet.",
  history: { ITEM_ADDED: "added", ITEM_UPDATED: "updated", ITEM_REMOVED: "removed" },
  buildExample: () => [
    {
      id: "example-w1",
      framework: "wsjf",
      title: "Example fix",
      fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
      score: 4,
      status: "scored",
      updatedAt: STAMP,
    },
  ],
  toMarkdown: (rows) =>
    rows.map((r) => `${r.row.title}: ${r.result.score ?? "Not scored"}`).join("\n"),
};

const state = () => useWorkspaceStore.getState();
const rows = () => state().prioritizations ?? [];
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);

const renderTool = (config: MethodToolConfig = CONFIG) =>
  render(
    <TooltipProvider>
      <MethodTool config={config} />
    </TooltipProvider>
  );

const pick = (label: string, value: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: value })
  );

beforeEach(() => {
  undo.last = null;
  window.history.replaceState({}, "", "/wsjf");
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("MethodTool", () => {
  it("refuses a blank add with each missing input named, then adds a scored row", () => {
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()).toEqual([]);
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Pick a job size.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Feature title/)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/Feature title/), {
      target: { value: "Guest checkout" },
    });
    pick("Business value", "8");
    pick("Time criticality", "5");
    pick("Risk reduction / opportunity enablement", "3");
    pick("Job size", "2");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ title: "Guest checkout", score: 8, status: "scored" });
    const list = screen.getByRole("list", { name: "Features, highest WSJF first" });
    expect(within(list).getByText("8.00")).toBeInTheDocument();
  });

  it("lists rows read through to their items, unscored last as Not scored", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Item",
      businessValue: 20,
      timeCriticality: 20,
      riskReduction: 20,
      jobSize: 1,
      updatedAt: STAMP,
    };
    useWorkspaceStore.setState({
      backlogItems: [item],
      prioritizations: [
        {
          id: "x",
          framework: "wsjf",
          title: "Title only",
          fields: {},
          status: "open",
          updatedAt: STAMP,
        },
        {
          id: "y",
          framework: "wsjf",
          title: "Linked",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    renderTool();
    const items = within(screen.getByRole("list", { name: /Features/ })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Linked");
    expect(items[0]).toHaveTextContent("60.00");
    expect(items[1]).toHaveTextContent("Title only");
    expect(items[1]).toHaveTextContent("Not scored");
  });

  it("opens the existing row instead of a duplicate for an item already scored here", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Passkeys",
      businessValue: 3,
      timeCriticality: 3,
      riskReduction: 3,
      jobSize: 3,
      updatedAt: STAMP,
    };
    useWorkspaceStore.setState({
      backlogItems: [item],
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "Passkeys",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    window.history.replaceState({}, "", "/wsjf?backlogItem=b1");
    renderTool();
    // The row's editor is open (a Save button), not a second linked row.
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    expect(within(editor).getByLabelText(/Feature title/)).toHaveValue("Passkeys");
    fireEvent.click(
      within(within(editor).getByRole("radiogroup", { name: "Job size" })).getByRole("radio", {
        name: "1",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()).toHaveLength(1);
    // The edit wrote through to the backlog item, in one undoable.
    expect(storedItem("b1")?.jobSize).toBe(1);
    expect(undo.last?.label).toBe("Updated “Passkeys” in the backlog");
    act(() => undo.last!.revert());
    expect(storedItem("b1")?.jobSize).toBe(3);
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "Fix",
          fields: { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1 },
          score: 3,
          updatedAt: STAMP,
        },
      ],
    });
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: "Delete Fix" }));
    expect(rows()).toEqual([]);
    expect(undo.last?.label).toBe("Deleted “Fix”");
    act(() => undo.last!.revert());
    expect(rows()).toHaveLength(1);
  });

  it("starts empty with an example to load and clear", () => {
    renderTool();
    expect(screen.getByText("No features yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows().map((r) => r.id)).toEqual(["example-w1"]);
    expect(screen.getByTestId("markdown")).toHaveTextContent("Example fix: 4");
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(rows()).toEqual([]);
  });

  it("clears an optional input in the editor, never bringing the old value back", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "m1",
          framework: "moscow",
          title: "Passkeys",
          fields: { bucket: "must", effort: 3 },
          updatedAt: STAMP,
        },
      ],
    });
    renderTool({ ...CONFIG, methodId: "moscow", toolId: "moscow", listLabel: "Items" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.change(within(editor).getByLabelText(/^Effort/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()[0].fields).toEqual({ bucket: "must" });
  });

  it("clears both Value/Effort inputs on a linked row: back to Not placed yet, item too", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        { id: "b1", name: "Dark mode", businessValue: 13, matrixEffort: 2, updatedAt: STAMP },
      ],
      prioritizations: [
        {
          id: "v1",
          framework: "value-effort",
          title: "Dark mode",
          fields: { businessValue: 5, effort: 2 },
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    renderTool({
      ...CONFIG,
      methodId: "value-effort",
      toolId: "value-effort-matrix",
      listLabel: "Items",
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Effort" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storedItem("b1")).not.toHaveProperty("businessValue");
    expect(storedItem("b1")).not.toHaveProperty("matrixEffort");
    expect(rows()[0].fields).toEqual({});
    const list = screen.getByRole("list", { name: "Items" });
    expect(within(list).getByText("Not scored")).toBeInTheDocument();
    act(() => undo.last!.revert());
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 2 });
  });

  it("saves a title-only row when the tool allows it", () => {
    renderTool({ ...CONFIG, allowTitleOnly: true });
    fireEvent.change(screen.getByLabelText(/Feature title/), { target: { value: "Later" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0]).toMatchObject({ title: "Later", status: "open", fields: {} });
    expect((rows()[0] as PrioritizationItem).score).toBeUndefined();
  });
});
