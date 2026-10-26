import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { registry } from "@/lib/actions/registry";

/**
 * Value vs Effort on the shared DragMatrix: value on the Fibonacci steps
 * (8+ high), effort 1–10 (6+ high), the quadrant derived live and never
 * stored, a title-only item waiting in "Not placed yet", drags and arrow
 * keys that write back (through to a linked backlog item), delete and
 * reset with Undo, the example, the verdict and the Markdown, and the
 * agent's list reading what the page shows.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: Record<string, unknown>) => {
    exported.props = p;
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";
import { buildExample } from "@/app/(tools)/value-effort-matrix/example";
import { toMarkdown } from "@/app/(tools)/value-effort-matrix/markdown";
import { veVerdict } from "@/app/(tools)/value-effort-matrix/verdict";
import { offScaleNote, positionText, toCsv } from "@/app/(tools)/value-effort-matrix/model";
import "@/lib/actions/tools/value-effort-matrix";

const FW = "value-effort" as const;
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === FW);
const stored = (id: string) => rows().find((r) => r.id === id);
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
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ValueEffortMatrixClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const addForm = () => screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
const pick = (scope: HTMLElement, group: string, value: string) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
// A list is named by its heading with the count ("Quick Wins (2)"); the
// matrix's own tray is "Not placed yet" alone.
const list = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const listed = (label: string) =>
  within(list(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const map = () => screen.getByRole("group", { name: "Value × Effort matrix" });
const rect = (el: HTMLElement, size: number) => {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: size,
      height: size,
      right: size,
      bottom: size,
      x: 0,
      y: 0,
    }) as DOMRect;
};
const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return (call[1] as { action: { onClick: () => void } }).action.onClick;
};

beforeEach(() => {
  toastSpy.mockReset();
  exported.props = null;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("Value vs Effort: adding", () => {
  it("refuses one score without the other, with the message on the missing one and focus there", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Item title/), { target: { value: "Dark mode" } });
    pick(addForm(), "Value", "8");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(
      screen.getByText("Pick an effort too, or leave both empty and place it on the matrix later.")
    ).toBeInTheDocument();
    // The effort picker is the first invalid control: its selected (or first) option has focus.
    const effort = within(addForm()).getByRole("radiogroup", { name: "Effort" });
    expect(effort.contains(document.activeElement)).toBe(true);
  });

  it("refuses a blank title", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Item title/)).toHaveFocus();
  });

  it("adds a title alone to Not placed yet: no score, no quadrant, not a default spot", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Item title/), { target: { value: "Slack digest" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(1);
    const [r] = rows();
    expect(r.fields).toEqual({});
    expect(r.score).toBeUndefined();
    expect(r.status).toBe("open");
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Slack digest")]);
    // It's a chip in the tray, not a dot on the map.
    expect(
      screen.getByRole("button", { name: /^Slack digest: not placed yet/ })
    ).toBeInTheDocument();
    expect(within(map()).queryByRole("button")).toBeNull();
  });

  it("places an item with both, storing value and effort but never the quadrant", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Item title/), { target: { value: "Dark mode" } });
    pick(addForm(), "Value", "8");
    pick(addForm(), "Effort", "2");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const [r] = rows();
    expect(r.fields).toEqual({ businessValue: 8, effort: 2 });
    expect(r.score).toBe(4);
    expect(listed("Quick Wins")).toEqual([expect.stringContaining("Dark mode")]);
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Added “Dark mode”: value 8, effort 2, Quick Wins"
      )
    );
  });
});

describe("Value vs Effort: the quadrant is derived", () => {
  it("splits at value 8 and effort 6", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Five-five", { businessValue: 5, effort: 5 }),
        row("b", "Eight-five", { businessValue: 8, effort: 5 }),
        row("c", "Eight-six", { businessValue: 8, effort: 6 }),
        row("d", "Five-six", { businessValue: 5, effort: 6 }),
      ],
    });
    renderPage();
    expect(listed("Fill-Ins")).toEqual([expect.stringContaining("Five-five")]);
    expect(listed("Quick Wins")).toEqual([expect.stringContaining("Eight-five")]);
    expect(listed("Big Bets")).toEqual([expect.stringContaining("Eight-six")]);
    expect(listed("Time Wasters")).toEqual([expect.stringContaining("Five-six")]);
  });

  it("lists legacy rows by their value and effort, ignoring any stored quadrant", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        // An old agent row: snake_case quadrant, the 1–10 value (7 reads as 8).
        row("mcp", "Agent row", { value: 7, effort: 2, quadrant: "time_wasters" }),
        // An old page row: display-cased and stale.
        row("old", "Old page row", { value: 3, effort: 9, quadrant: "Quick Wins" }),
      ],
    });
    renderPage();
    expect(listed("Quick Wins")).toEqual([expect.stringContaining("Agent row")]);
    expect(listed("Time Wasters")).toEqual([expect.stringContaining("Old page row")]);
  });

  it("flags an off-scale value instead of rewriting it", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("x", "Odd effort", { businessValue: 13, effort: 0.5 })],
    });
    renderPage();
    expect(screen.getByText("Effort 0.5 is off the 1–10 scale. Edit to fix.")).toBeInTheDocument();
    expect(stored("x")?.fields).toEqual({ businessValue: 13, effort: 0.5 });
    expect(offScaleNote({ values: { value: 4, effort: 3 } })).toBe(
      "Value 4 is off the scale (1, 2, 3, 5, 8, 13 or 20). Edit to fix."
    );
  });
});

describe("Value vs Effort: moving on the matrix", () => {
  it("drags a dot and saves once on release", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Saved filters", { businessValue: 2, effort: 2 })],
    });
    renderPage();
    const grid = map();
    rect(grid, 200);
    const spy = vi.spyOn(state(), "upsertPrioritization");
    const dot = within(grid).getByRole("button", { name: /^Saved filters:/ });
    expect(dot).toHaveAccessibleName("Saved filters: value 2, effort 2, Fill-Ins");
    fireEvent.pointerDown(dot, { pointerId: 1, button: 0, clientX: 40, clientY: 160 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 160, clientY: 40 });
    expect(stored("a")?.fields).toEqual({ businessValue: 2, effort: 2 });
    fireEvent.pointerUp(dot, { pointerId: 1, clientX: 160, clientY: 40 });
    // x 0.8 of effort 1–10 → 8; y 0.8 up the seven Fibonacci steps → 13.
    expect(stored("a")?.fields).toEqual({ businessValue: 13, effort: 8 });
    expect(stored("a")?.score).toBeCloseTo(13 / 8);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(listed("Big Bets")).toEqual([expect.stringContaining("Saved filters")]);
  });

  it("moves a dot with the arrow keys on the Fibonacci steps and saves on blur", async () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Triage keys", { businessValue: 5, effort: 3 })],
    });
    renderPage();
    const dot = within(map()).getByRole("button", { name: /^Triage keys:/ });
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: "ArrowUp" });
    fireEvent.keyDown(dot, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Triage keys: value 8, effort 2, Quick Wins"
      )
    );
    expect(stored("a")?.fields).toEqual({ businessValue: 5, effort: 3 });
    fireEvent.blur(dot);
    expect(stored("a")?.fields).toEqual({ businessValue: 8, effort: 2 });
  });

  it("drags a tray chip onto the matrix", () => {
    useWorkspaceStore.setState({ prioritizations: [row("t", "Slack digest")] });
    renderPage();
    const grid = map();
    rect(grid, 100);
    const chip = screen.getByRole("button", { name: /^Slack digest: not placed yet/ });
    fireEvent.pointerDown(chip, { pointerId: 2, button: 0, clientX: -50, clientY: -50 });
    fireEvent.pointerMove(chip, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 2, clientX: 10, clientY: 10 });
    // x 0.1 → effort 2; y 0.9 up → round(5.4) = step 5 → 13.
    expect(stored("t")?.fields).toEqual({ businessValue: 13, effort: 2 });
  });

  it("places a tray item with Place in…, at the quadrant's middle", async () => {
    useWorkspaceStore.setState({ prioritizations: [row("t", "Slack digest")] });
    renderPage();
    fireEvent.change(screen.getByLabelText("Place Slack digest in"), {
      target: { value: "big_bets" },
    });
    expect(stored("t")?.fields).toEqual({ businessValue: 13, effort: 8 });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Slack digest: value 13, effort 8, Big Bets"
      )
    );
  });

  it("writes a linked row's move through to its backlog item, with Undo", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Passkeys",
      businessValue: 3,
      matrixEffort: 4,
      createdAt: "2026-10-01T00:00:00.000Z",
    } as BacklogItem;
    useWorkspaceStore.setState({
      backlogItems: [item],
      // The row's own copy is stale: it reads through to the item.
      prioritizations: [
        row("a", "Passkeys", { businessValue: 20, effort: 9 }, { backlogItemId: "b1" }),
      ],
    });
    renderPage();
    expect(listed("Fill-Ins")).toEqual([expect.stringContaining("Passkeys")]);
    const dot = within(map()).getByRole("button", { name: /^Passkeys:/ });
    expect(dot).toHaveAccessibleName("Passkeys: value 3, effort 4, Fill-Ins");
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(dot, { key: "Enter" });
    const saved = state().backlogItems?.find((b) => b.id === "b1");
    expect(saved).toMatchObject({ businessValue: 13, matrixEffort: 4 });
    expect(saved?.updatedAt).toBeTruthy();
    expect(toastSpy).toHaveBeenCalledWith("Updated “Passkeys” in the backlog", expect.anything());
    act(() => lastUndo()());
    expect(state().backlogItems?.find((b) => b.id === "b1")).toMatchObject({
      businessValue: 3,
      matrixEffort: 4,
    });
  });
});

describe("Value vs Effort: edit, delete and reset", () => {
  it("edits in place: Enter saves and the row moves to its new quadrant", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Dark mode", { businessValue: 2, effort: 2 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    pick(editor, "Value", "13");
    fireEvent.submit(editor);
    expect(stored("a")?.fields).toEqual({ businessValue: 13, effort: 2 });
    expect(listed("Quick Wins")).toEqual([expect.stringContaining("Dark mode")]);
  });

  it("sends an item back to the tray when both are cleared", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Dark mode", { businessValue: 2, effort: 2 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Effort" }));
    fireEvent.submit(editor);
    expect(stored("a")?.fields).toEqual({});
    expect(stored("a")?.score).toBeUndefined();
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Dark mode")]);
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Dark mode", { businessValue: 2, effort: 2 })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Dark mode" }));
    expect(rows()).toHaveLength(0);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “Dark mode”");
    act(() => lastUndo()());
    expect(stored("a")?.fields).toEqual({ businessValue: 2, effort: 2 });
  });

  it("clears the matrix after a confirm, with Undo, and leaves other methods alone", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Dark mode", { businessValue: 2, effort: 2 }),
        row("b", "Tray item"),
        { ...row("ice", "An ICE idea"), framework: "ice" },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear matrix" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear matrix" }));
    expect(rows()).toHaveLength(0);
    expect(state().prioritizations?.map((r) => r.id)).toEqual(["ice"]);
    act(() => lastUndo()());
    expect(
      rows()
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
  });
});

describe("Value vs Effort: first run, verdict and export", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderPage();
    expect(screen.getByText(/No items yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(8);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Start with “Saved filters on the board” and “Keyboard shortcuts for triage”, your 2 Quick Wins; 2 Big Bets to plan, 1 Fill-In for spare time, 2 Time Wasters to drop and 1 not placed yet."
      )
    ).toBeInTheDocument();
    useWorkspaceStore
      .getState()
      .upsertPrioritization(row("mine", "Mine", { businessValue: 1, effort: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows().map((r) => r.id)).toEqual(["mine"]);
  });

  it("covers every quadrant and the tray in the example, with example ids", () => {
    const ex = buildExample(new Date("2026-10-26T09:00:00Z"));
    expect(ex.every((r) => r.id.startsWith("example-ve-"))).toBe(true);
    useWorkspaceStore.setState({ prioritizations: ex });
    const buckets = ranked().map((r) => r.result.bucket);
    for (const q of ["quick_wins", "big_bets", "fill_ins", "time_wasters", null]) {
      expect(buckets).toContain(q);
    }
    expect(ex.every((r) => !("quadrant" in (r.fields ?? {})))).toBe(true);
  });

  it("says what to do when nothing or no Quick Win is placed", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "One"), row("b", "Two")] });
    expect(veVerdict(ranked())).toBe("Place the 2 items on the matrix to see where to start.");
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Big", { businessValue: 13, effort: 9 })],
    });
    // One sentence, as the contract asks.
    expect(veVerdict(ranked())).toBe(
      "No Quick Wins yet: split a Big Bet into smaller pieces; 1 Big Bet to plan."
    );
    expect(veVerdict([])).toBe("No items yet.");
  });

  it("exports Markdown per quadrant, CSV with the derived quadrant, and JSON as shown", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Dark | mode", { businessValue: 8, effort: 2, quadrant: "Time Wasters" }),
        row("b", "Later"),
      ],
    });
    renderPage();
    const md = toMarkdown(ranked(), new Date("2026-10-26T09:00:00Z"));
    expect(md).toContain("# Value vs Effort — 26 Oct 2026");
    expect(md).toContain("## Quick Wins (1)");
    expect(md).toContain("| Dark \\| mode | 8 | 2 | 4 |");
    expect(md).toContain(
      "## Time Wasters (0)\n\nLow value, high effort: drop or rethink them.\n\nNone."
    );
    expect(md).toContain("## Not placed yet (1)\n\n- Later");
    expect(md).toMatch(/\*\*Start with “Dark \| mode”, your one Quick Win; 1 not placed yet\.\*\*/);
    expect(exported.props?.markdown).toContain("# Value vs Effort");
    expect(toCsv(ranked()).rows).toEqual([
      ["Dark | mode", 8, 2, "Quick Wins", "4"],
      ["Later", "", "", "Not placed yet", ""],
    ]);
    const json = exported.props?.jsonData as PrioritizationItem[];
    expect(json[0].fields).toEqual({ businessValue: 8, effort: 2 });
  });
});

describe("Value vs Effort: the agent reads what the page shows", () => {
  it("list_items groups the same rows into the same quadrants with the same values", async () => {
    useWorkspaceStore.setState({
      backlogItems: [
        {
          id: "b1",
          name: "Passkeys",
          businessValue: 13,
          matrixEffort: 3,
          createdAt: "x",
        } as BacklogItem,
      ],
      prioritizations: [
        row("mcp", "Agent row", { value: 7, effort: 2, quadrant: "time_wasters" }),
        row("linked", "Passkeys", { businessValue: 1, effort: 9 }, { backlogItemId: "b1" }),
        row("tray", "Later"),
      ],
    });
    const out = (await registry.get("tool.value_effort_matrix.list_items")!.handler!({}, {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    } as never)) as {
      groups: Record<string, { id: string; value: number; effort: number }[]>;
      unplaced: { id: string }[];
    };
    renderPage();
    expect(out.groups.quick_wins.map((r) => r.id).sort()).toEqual(["linked", "mcp"]);
    expect(listed("Quick Wins")).toHaveLength(2);
    expect(out.groups.quick_wins.find((r) => r.id === "linked")).toMatchObject({
      value: 13,
      effort: 3,
    });
    expect(out.unplaced.map((r) => r.id)).toEqual(["tray"]);
    expect(listed("Not placed yet")).toEqual([expect.stringContaining("Later")]);
  });

  it("names a position the way the dots do", () => {
    expect(positionText({ value: 8, effort: 3 })).toBe("value 8, effort 3, Quick Wins");
    expect(positionText({ value: null, effort: null })).toBe("not placed yet");
  });
});

describe("Value vs Effort: theme tokens only", () => {
  it("has no hex colours in its sources", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/value-effort-matrix");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
