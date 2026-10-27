import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { registry } from "@/lib/actions/registry";

/**
 * The Value vs Effort review fixes: sending a linked item to "Not placed
 * yet" clears only its effort on the backlog item (its value is WSJF's
 * business value too), from an import's title-only add, from the editor
 * (which says so before Save) and from the agent's set_position alike; a
 * value read from the old 1–10 value says so; the verdict is one sentence;
 * an edit that moves a row is announced; focus comes back to the row.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";
import { veVerdict } from "@/app/(tools)/value-effort-matrix/verdict";
import { legacyValueNote, trayDraft, trayNote } from "@/app/(tools)/value-effort-matrix/model";
import "@/lib/actions/tools/value-effort-matrix";

const FW = "value-effort" as const;
const STAMP = "2026-10-20T09:00:00.000Z";
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === FW);
const stored = (id: string) => rows().find((r) => r.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const ranked = () => rankMethodRows(FW, state().prioritizations ?? [], state().backlogItems ?? []);

const row = (
  id: string,
  title: string,
  fields: Record<string, number | string> = {},
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: FW,
  title,
  fields,
  status: "scored",
  updatedAt: STAMP,
  ...extra,
});
const item = (id: string, name: string, partial: Partial<BacklogItem> = {}): BacklogItem =>
  ({ id, name, createdAt: STAMP, ...partial }) as BacklogItem;
const agent = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ValueEffortMatrixClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const list = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const listed = (label: string) =>
  within(list(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const pick = (scope: HTMLElement, group: string, value: string) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return (call[1] as { action: { onClick: () => void } }).action.onClick;
};

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("Value vs Effort fixes: the tray never wipes WSJF's value", () => {
  it("leaves a blank value out of a linked tray save, and nothing else", () => {
    const blank = { title: "A", value: undefined, effort: undefined };
    expect(trayDraft(blank, true)).toEqual({ title: "A", effort: undefined });
    expect("value" in trayDraft(blank, true)).toBe(false);
    // Unlinked rows own both; a placing draft goes as it is.
    expect(trayDraft(blank, false)).toBe(blank);
    const placing = { title: "A", value: 8, effort: 3 };
    expect(trayDraft(placing, true)).toBe(placing);
  });

  it("adds an imported item to the tray without clearing its business value", () => {
    const wsjf = item("b1", "Passkeys", { businessValue: 13, updatedAt: STAMP });
    useWorkspaceStore.setState({ backlogItems: [wsjf] });
    window.history.replaceState({}, "", "/value-effort-matrix?backlogItem=b1");
    renderPage();
    const form = screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
    // The import prefilled Value 13 only; the user follows the hint and clears it.
    fireEvent.click(within(form).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ backlogItemId: "b1" });
    expect(storedItem("b1")).toEqual(wsjf);
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Passkeys")]);
  });

  it("says what the editor's tray save does to a linked item, clears only its effort, with Undo", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Passkeys", { businessValue: 13, matrixEffort: 3 })],
      prioritizations: [
        row("a", "Passkeys", { businessValue: 13, effort: 3 }, { backlogItemId: "b1" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    const note = within(editor).getByRole("status");
    expect(note).toHaveTextContent("");
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Effort" }));
    expect(note).toHaveTextContent(
      "Saving clears its effort on the backlog item “Passkeys” and moves it to Not placed yet. Its value 13 stays on the item: WSJF's business value is the same field."
    );
    fireEvent.submit(editor);
    expect(storedItem("b1")?.businessValue).toBe(13);
    expect(storedItem("b1")?.matrixEffort).toBeUndefined();
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Passkeys")]);
    expect(toastSpy).toHaveBeenCalledWith("Updated “Passkeys” in the backlog", expect.anything());
    act(() => lastUndo()());
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 3 });
  });

  it("un-places a linked item the same way on the page and for the agent", async () => {
    const start = () =>
      useWorkspaceStore.setState({
        backlogItems: [item("b1", "Passkeys", { businessValue: 8, matrixEffort: 7 })],
        prioritizations: [
          row("a", "Passkeys", { businessValue: 8, effort: 7 }, { backlogItemId: "b1" }),
        ],
      });
    start();
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Effort" }));
    fireEvent.submit(editor);
    const page = { item: storedItem("b1"), fields: stored("a")?.fields };
    unmount();
    start();
    await registry
      .get("tool.value_effort_matrix.set_position")!
      .handler({ id: "a", value: null, effort: null } as never, agent());
    const strip = (b?: BacklogItem) => ({ ...b, updatedAt: undefined });
    expect(strip(storedItem("b1"))).toEqual(strip(page.item));
    expect(stored("a")?.fields).toEqual(page.fields);
    expect(page.item).toMatchObject({ businessValue: 8 });
  });

  it("words the note for what the item holds", () => {
    expect(trayNote("Passkeys", { value: null, effort: 4 })).toBe(
      "Saving clears its effort on the backlog item “Passkeys” and moves it to Not placed yet."
    );
    expect(trayNote("Passkeys", { value: 5, effort: null })).toBe(
      "Saving moves it to Not placed yet. Its value 5 stays on the item: WSJF's business value is the same field."
    );
  });
});

describe("Value vs Effort fixes: Place in… keeps what the item already holds", () => {
  const wsjf = (businessValue: number): Partial<BacklogItem> => ({
    businessValue,
    timeCriticality: 8,
    riskReduction: 3,
    jobSize: 5,
    updatedAt: STAMP,
  });
  const placeIn = (name: string, quadrant: string) =>
    fireEvent.change(screen.getByLabelText(`Place ${name} in`), { target: { value: quadrant } });
  const polite = () => screen.getByTestId("live-polite");

  it("keeps a linked item's business value that already lands in the picked quadrant", async () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Export", wsjf(20))],
      prioritizations: [row("a", "Export", {}, { backlogItemId: "b1" })],
    });
    renderPage();
    placeIn("Export", "big_bets");
    // Only the effort moves: WSJF's business value 20 is already high.
    expect(storedItem("b1")).toMatchObject({
      ...wsjf(20),
      matrixEffort: 8,
      updatedAt: expect.any(String),
    });
    expect(listed("Big Bets")).toEqual([expect.stringContaining("Export")]);
    await waitFor(() => expect(polite()).toHaveTextContent("Export: value 20, effort 8, Big Bets"));
  });

  it("keeps a low value picked into a low quadrant, and an effort on the picked side", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Export", wsjf(5)),
        item("b2", "Audit log", { matrixEffort: 4, updatedAt: STAMP }),
      ],
      prioritizations: [
        row("a", "Export", {}, { backlogItemId: "b1" }),
        row("b", "Audit log", {}, { backlogItemId: "b2" }),
        row("c", "Own value", { businessValue: 2 }),
      ],
    });
    renderPage();
    placeIn("Export", "fill_ins");
    expect(storedItem("b1")).toMatchObject({ businessValue: 5, matrixEffort: 3 });
    placeIn("Audit log", "quick_wins");
    expect(storedItem("b2")).toMatchObject({ businessValue: 13, matrixEffort: 4 });
    placeIn("Own value", "time_wasters");
    expect(stored("c")?.fields).toEqual({ businessValue: 2, effort: 8 });
  });

  it("changes a value on the other side of the line, and says WSJF's value changes with it", async () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Export", wsjf(5))],
      prioritizations: [row("a", "Export", {}, { backlogItemId: "b1" })],
    });
    renderPage();
    placeIn("Export", "big_bets");
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 8 });
    await waitFor(() =>
      expect(polite()).toHaveTextContent(
        "Export: value 13, effort 8, Big Bets. Its value went from 5 to 13 on the backlog item: WSJF's business value is the same field."
      )
    );
    act(() => lastUndo()());
    expect(storedItem("b1")).toEqual(item("b1", "Export", wsjf(5)));
  });
});

describe("Value vs Effort fixes: a tray row that kept its value can be edited", () => {
  const editor = () => screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
  const rename = (from: string, to: string) => {
    fireEvent.click(screen.getByRole("button", { name: `Edit ${from}` }));
    fireEvent.change(within(editor()).getByLabelText(/Item title/), { target: { value: to } });
    fireEvent.submit(editor());
  };

  it("renames a linked row whose item holds a value and no effort, keeping the value", () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", "Passkeys", { businessValue: 13, updatedAt: STAMP })],
      prioritizations: [row("a", "Passkeys", {}, { backlogItemId: "b1" })],
    });
    renderPage();
    rename("Passkeys", "Passkeys for admins");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(stored("a")?.title).toBe("Passkeys for admins");
    expect(storedItem("b1")).toMatchObject({ name: "Passkeys for admins", businessValue: 13 });
    expect(storedItem("b1")?.matrixEffort).toBeUndefined();
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Passkeys for admins")]);
  });

  it("renames an unlinked row that holds a value and no effort, keeping its value", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Old row", { businessValue: 8 })],
    });
    renderPage();
    rename("Old row", "Old row, renamed");
    expect(stored("a")).toMatchObject({ title: "Old row, renamed", fields: { businessValue: 8 } });
  });

  it("still asks for an effort when the value changes, or when a placed row loses only its effort", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Passkeys", { businessValue: 13, updatedAt: STAMP }),
        item("b2", "Audit log", { businessValue: 8, matrixEffort: 3, updatedAt: STAMP }),
      ],
      prioritizations: [
        row("a", "Passkeys", {}, { backlogItemId: "b1" }),
        row("b", "Audit log", {}, { backlogItemId: "b2" }),
      ],
    });
    renderPage();
    const effortError = "Pick an effort too, or leave both empty and place it on the matrix later.";
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    pick(editor(), "Value", "20");
    fireEvent.submit(editor());
    expect(within(editor()).getByText(effortError)).toBeInTheDocument();
    expect(storedItem("b1")?.businessValue).toBe(13);
    fireEvent.click(within(editor()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Audit log" }));
    fireEvent.click(within(editor()).getByRole("button", { name: "Clear Effort" }));
    fireEvent.submit(editor());
    expect(within(editor()).getByText(effortError)).toBeInTheDocument();
    expect(storedItem("b2")?.matrixEffort).toBe(3);
  });
});

describe("Value vs Effort fixes: a value from the old 1–10 value says so", () => {
  it("names the old value on a row and on a linked item, and nowhere else", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        item("b1", "Legacy item", { value: 6, matrixEffort: 2, updatedAt: STAMP }),
        // The old "Add item" defaults: no value at all, so nothing to explain.
        item("b2", "Default item", { value: 5, matrixEffort: 5 }),
      ],
      prioritizations: [
        row("old", "Old row", { value: 4, effort: 2 }),
        row("new", "New row", { businessValue: 8, effort: 2 }),
        row("lk", "Legacy item", {}, { backlogItemId: "b1" }),
        row("df", "Default item", {}, { backlogItemId: "b2" }),
      ],
    });
    const items = state().backlogItems ?? [];
    const note = (id: string) => legacyValueNote(ranked().find((r) => r.row.id === id)!, items);
    expect(note("old")).toBe(
      "Value 5 is read from the old 1–10 value 4: edit and save to keep it, or pick another."
    );
    expect(note("lk")).toBe("Value 8 is read from the backlog item's old 1–10 value 6.");
    expect(note("new")).toBeNull();
    expect(note("df")).toBeNull();
    renderPage();
    expect(listed("Fill-Ins")).toEqual([expect.stringContaining("read from the old 1–10 value 4")]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Old row" }));
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement);
    expect(stored("old")?.fields).toEqual({ businessValue: 5, effort: 2 });
    expect(listed("Fill-Ins").join(" ")).not.toContain("old 1–10 value 4");
  });
});

describe("Value vs Effort fixes: one-sentence verdict", () => {
  it("joins its parts with semicolons", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Big", { businessValue: 13, effort: 9 }),
        row("b", "Bigger", { businessValue: 20, effort: 8 }),
        row("c", "Small", { businessValue: 2, effort: 2 }),
      ],
    });
    const v = veVerdict(ranked());
    expect(v).toBe(
      "No Quick Wins yet: split a Big Bet into smaller pieces; 2 Big Bets to plan and 1 Fill-In for spare time."
    );
    expect(v.match(/\.(\s|$)/g)).toHaveLength(1);
  });
});

describe("Value vs Effort fixes: a row linked before Phase 7 asks which values stay", () => {
  // Never saved by the new code: the item got WSJF's 13 and a matrix effort
  // of 3; the row was moved on the old matrix afterwards, which wrote only it.
  const legacyItem = item("b1", "Checkout", {
    businessValue: 13,
    timeCriticality: 8,
    riskReduction: 3,
    jobSize: 5,
    matrixEffort: 3,
  });
  const legacyRow = row("v1", "Checkout", { value: 3, effort: 2 }, { backlogItemId: "b1" });
  const note = () => within(list("Quick Wins")).getByRole("note");
  const editButton = () => screen.getByRole("button", { name: "Edit Checkout" });

  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [legacyItem], prioritizations: [legacyRow] });
  });

  it("shows the item's values and asks once; this row's moves it, with Undo", async () => {
    renderPage();
    expect(note()).toHaveTextContent(
      "this row and “Checkout” disagree: Value 3 here, 13 on the backlog item; Effort 2 here, 3 on the backlog item."
    );
    fireEvent.click(
      within(note()).getByRole("button", {
        name: "Use this row's Value/Effort values for Checkout",
      })
    );
    expect(storedItem("b1")).toMatchObject({ businessValue: 3, matrixEffort: 2 });
    expect(listed("Fill-Ins")).toEqual([expect.stringContaining("Checkout")]);
    expect(within(list("Fill-Ins")).queryByRole("note")).toBeNull();
    expect(document.activeElement).toBe(editButton());
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Kept this row's Value/Effort values for “Checkout”. Its value went from 13 to 3 on the backlog item: WSJF's business value is the same field. Moved to Fill-Ins."
      )
    );
    act(() => lastUndo()());
    expect(storedItem("b1")).toEqual(legacyItem);
    expect(note()).toBeInTheDocument();
  });

  it("or the backlog item's, copied into the row, with Undo", () => {
    renderPage();
    fireEvent.click(
      within(note()).getByRole("button", {
        name: "Keep the backlog item's Value/Effort values for Checkout",
      })
    );
    expect(stored("v1")?.fields).toEqual({ businessValue: 13, effort: 3 });
    expect(storedItem("b1")).toEqual(legacyItem);
    expect(within(list("Quick Wins")).queryByRole("note")).toBeNull();
    expect(document.activeElement).toBe(editButton());
    act(() => lastUndo()());
    expect(stored("v1")?.fields).toEqual({ value: 3, effort: 2 });
    expect(note()).toBeInTheDocument();
  });
});

describe("Value vs Effort fixes: announcements and focus", () => {
  it("announces where an edit moved the row and puts focus back on its Edit button", async () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Dark mode", { businessValue: 2, effort: 2 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    let editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    pick(editor, "Value", "13");
    fireEvent.submit(editor);
    expect(listed("Quick Wins")).toEqual([expect.stringContaining("Dark mode")]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Dark mode" }));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Dark mode moved to Quick Wins")
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Dark mode" }));
  });
});
