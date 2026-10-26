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
