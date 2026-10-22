import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Cumulative Flow gap-filling: the chart-text edges, the store's rules
 * (colours, renames, same-day snapshots, clamped counts), and the client —
 * stats, snapshots (add / edit / note / remove), columns (add / rename /
 * describe / remove), the WIP limit, the WIP control chart gate and Reset.
 */

const toasts = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    warning: toasts.warning,
    info: () => "t",
    error: () => "t",
    success: () => "t",
    dismiss: () => {},
  }),
}));
// Recharts stand-ins: these tests read the page, not the SVG.
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Box,
    AreaChart: Box,
    LineChart: Box,
    CartesianGrid: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    Tooltip: Nothing,
    Line: Nothing,
    ReferenceDot: Nothing,
    Legend: Nothing,
    Area: Nothing,
    ReferenceLine: Nothing,
  };
});
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { CFDClient } from "@/app/(tools)/cumulative-flow/cfd-client";
import { useCFDStore } from "@/app/(tools)/cumulative-flow/use-cfd-store";
import {
  DEFAULT_COLORS,
  DEFAULT_COLUMNS,
  createEntry,
} from "@/app/(tools)/cumulative-flow/constants";
import { flowChartText, wipChartText } from "@/app/(tools)/cumulative-flow/chart-text";
import type { DataEntry } from "@/app/(tools)/cumulative-flow/types";

const counts = (todo: number, doing: number, review: number, done: number) => ({
  "col-1": todo,
  "col-2": doing,
  "col-3": review,
  "col-4": done,
});
const entry = (id: string, date: string, c: Record<string, number>): DataEntry => ({
  id,
  date,
  counts: c,
});

const state = () => useCFDStore.getState();
const names = () => state().columns.map((c) => c.name);
/** A stat tile's value and unit, found by its label. */
const stat = (label: string) =>
  screen.getByText(label, { selector: "p" }).nextElementSibling!.textContent;

function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

beforeEach(() => {
  toasts.warning.mockClear();
  useCFDStore.setState({ columns: DEFAULT_COLUMNS, entries: [], wipLimit: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cumulative flow chart text edges", () => {
  const columns = DEFAULT_COLUMNS;

  it("has nothing to say without snapshots or columns", () => {
    expect(flowChartText([], columns).summary).toBe("No snapshots yet.");
    expect(flowChartText([{ date: "2026-10-01" }], []).summary).toBe("No snapshots yet.");
    expect(wipChartText([], [], 5).summary).toBe("No snapshots yet.");
  });

  it("describes a single snapshot, counting a missing column as 0", () => {
    const text = flowChartText(
      [{ date: "2026-10-01", "To Do": 10, "In Progress": 3, Done: 2 }],
      columns
    );
    expect(text.summary).toBe(
      "One snapshot on 2026-10-01: 15 items, 2 in Done; 3 items in progress."
    );
    expect(text.table.rows).toEqual([["2026-10-01", 10, 3, 0, 2]]);
  });

  it("leaves out work in progress with fewer than three columns", () => {
    const two = [columns[0], columns[3]];
    expect(
      flowChartText(
        [
          { date: "2026-10-01", "To Do": 5, Done: 5 },
          { date: "2026-10-02", "To Do": 4, Done: 5 },
        ],
        two
      ).summary
    ).toBe("Done stayed at 5 items between 2026-10-01 and 2026-10-02.");
  });

  it("says when WIP never went over the limit, and skips the limit when there is none", () => {
    const series = [
      { date: "2026-10-01", value: 3 },
      { date: "2026-10-02", value: 3 },
    ];
    expect(wipChartText(series, [], 5).summary).toBe(
      "WIP stayed at 3 over 2 snapshots, ranging from 3 to 3; never above the WIP limit of 5."
    );
    expect(wipChartText(series.slice(0, 1), [], null).summary).toBe(
      "WIP stayed at 3 over 1 snapshot, ranging from 3 to 3."
    );
  });
});

describe("cumulative flow store", () => {
  it("gives new columns the next colour and a zero count in every snapshot", () => {
    useCFDStore.setState({ entries: [entry("a", "2026-10-01", counts(1, 2, 3, 4))] });
    state().addColumn("Blocked", "Waiting on others");
    const added = state().columns[4];
    expect(added).toMatchObject({
      name: "Blocked",
      description: "Waiting on others",
      color: DEFAULT_COLORS[4],
    });
    expect(state().entries[0].counts[added.id]).toBe(0);

    state().removeColumn("col-2");
    expect(names()).toEqual(["To Do", "In Review", "Done", "Blocked"]);
    expect("col-2" in state().entries[0].counts).toBe(false);
  });

  it("renames with a trim, but never to blank or another column's name", () => {
    state().renameColumn("col-3", "  Testing  ");
    expect(names()[2]).toBe("Testing");
    state().renameColumn("col-3", "   ");
    state().renameColumn("col-3", "DONE");
    expect(names()[2]).toBe("Testing");
    // A column may change its own case.
    state().renameColumn("col-4", "DONE");
    expect(names()[3]).toBe("DONE");
  });

  it("keeps one snapshot a day, and counts can't go negative", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 23, 30));
    state().addEntry();
    state().addEntry();
    expect(state().entries).toHaveLength(1);
    const [e] = state().entries;
    expect(e.date).toBe("2026-10-21");
    expect(e.counts).toEqual(counts(0, 0, 0, 0));
    state().updateEntryCount(e.id, "col-2", -4);
    expect(state().entries[0].counts["col-2"]).toBe(0);
    expect(createEntry(DEFAULT_COLUMNS.slice(0, 2)).counts).toEqual({ "col-1": 0, "col-2": 0 });
  });
});

describe("CFD client: stats and snapshots", () => {
  it("starts empty", () => {
    render(<CFDClient />);
    expect(stat("Total Items (latest)")).toBe("0");
    expect(stat("WIP Items")).toBe("0(0%)");
    expect(stat("Done share")).toBe("0%of all items");
    expect(screen.getByText("Add date entries below to see the chart")).toBeInTheDocument();
    expect(screen.getByText(/No entries yet\./)).toBeInTheDocument();
    expect(screen.queryByText("WIP control chart")).toBeNull();
  });

  it("reads the latest snapshot by date, whatever order they were entered in", () => {
    useCFDStore.setState({
      entries: [
        entry("b", "2026-10-02", counts(4, 5, 1, 10)),
        entry("a", "2026-10-01", counts(10, 3, 1, 2)),
      ],
    });
    render(<CFDClient />);
    // 4 + 5 + 1 + 10 = 20; WIP 6 = 30%; Done 10 = 50%.
    expect(stat("Total Items (latest)")).toBe("20");
    expect(stat("WIP Items")).toBe("6(30%)");
    expect(stat("Done Items")).toBe("10");
    expect(stat("Done share")).toBe("50%of all items");
    // The table lists them oldest first.
    expect(
      screen.getAllByLabelText("Snapshot date").map((el) => (el as HTMLInputElement).value)
    ).toEqual(["2026-10-01", "2026-10-02"]);
    expect(screen.getByText("WIP control chart")).toBeInTheDocument();
    expect(screen.getByText("Need 8+ data points for control limits")).toBeInTheDocument();
  });

  it("calls WIP n/a with fewer than three columns", () => {
    useCFDStore.setState({
      columns: [DEFAULT_COLUMNS[0], DEFAULT_COLUMNS[3]],
      entries: [entry("a", "2026-10-01", { "col-1": 3, "col-4": 1 })],
    });
    render(<CFDClient />);
    expect(stat("WIP Items")).toBe("0(n/a — add a middle column)");
    expect(stat("Done share")).toBe("25%of all items");
    // Two columns are the minimum: no remove buttons.
    expect(screen.queryByRole("button", { name: /^Remove column/ })).toBeNull();
  });

  it("adds today's snapshot once, and warns instead of duplicating it", () => {
    render(<CFDClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Date/ }));
    expect(state().entries.map((e) => e.date)).toEqual([today()]);
    fireEvent.click(screen.getByRole("button", { name: /Add Date/ }));
    expect(state().entries).toHaveLength(1);
    expect(toasts.warning).toHaveBeenCalledWith(
      "A snapshot for today already exists — edit it instead of duplicating."
    );
  });

  it("edits counts (never below 0), the date (never blank), the note, and removes", () => {
    useCFDStore.setState({ entries: [entry("a", "2026-10-01", counts(10, 3, 1, 2))] });
    render(<CFDClient />);
    const doing = screen.getByLabelText("In Progress count on 2026-10-01");
    fireEvent.change(doing, { target: { value: "7" } });
    expect(state().entries[0].counts["col-2"]).toBe(7);
    expect(stat("Total Items (latest)")).toBe("20");
    fireEvent.change(doing, { target: { value: "-2" } });
    expect(state().entries[0].counts["col-2"]).toBe(0);

    const date = screen.getByLabelText("Snapshot date");
    fireEvent.change(date, { target: { value: "" } });
    expect(state().entries[0].date).toBe("2026-10-01");
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    expect(state().entries[0].date).toBe("2026-10-05");

    const note = screen.getByRole("textbox", { name: "Note for 2026-10-05" });
    fireEvent.change(note, { target: { value: "Release freeze" } });
    fireEvent.blur(note);
    expect(state().entries[0].description).toBe("Release freeze");
    fireEvent.change(note, { target: { value: "  " } });
    fireEvent.blur(note);
    expect(state().entries[0].description).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove snapshot for 2026-10-05" }));
    expect(state().entries).toEqual([]);
  });

  it("Reset goes back to the default columns with no data", () => {
    useCFDStore.setState({
      columns: [...DEFAULT_COLUMNS, { id: "x", name: "Blocked", color: "#fff" }],
      entries: [entry("a", "2026-10-01", counts(1, 1, 1, 1))],
      wipLimit: 4,
    });
    render(<CFDClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(state()).toMatchObject({ columns: DEFAULT_COLUMNS, entries: [], wipLimit: null });
  });
});

describe("CFD client: columns", () => {
  it("adds a column by Enter or Ctrl+Enter, rejecting blanks and duplicates", () => {
    render(<CFDClient />);
    const name = screen.getByRole("textbox", { name: "New status name" });
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    fireEvent.change(name, { target: { value: "  done " } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(names()).toHaveLength(4);
    expect(toasts.warning).toHaveBeenCalledWith('A column named "done" already exists.');

    fireEvent.change(name, { target: { value: "  Blocked  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "New column description" }), {
      target: { value: "  Waiting on others  " },
    });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(state().columns[4]).toMatchObject({
      name: "Blocked",
      description: "Waiting on others",
    });
    expect(name).toHaveValue("");

    fireEvent.change(name, { target: { value: "Deployed" } });
    const description = screen.getByRole("textbox", { name: "New column description" });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(names()).toHaveLength(5);
    fireEvent.keyDown(description, { key: "Enter", ctrlKey: true });
    expect(names()).toEqual(["To Do", "In Progress", "In Review", "Done", "Blocked", "Deployed"]);
    expect(state().columns[5].description).toBeUndefined();
  });

  it("renames on blur and removes a column with its counts", () => {
    useCFDStore.setState({ entries: [entry("a", "2026-10-01", counts(1, 2, 3, 4))] });
    render(<CFDClient />);
    const third = screen.getByRole("textbox", { name: "Name for column 3" });
    fireEvent.change(third, { target: { value: "Testing " } });
    fireEvent.blur(third);
    expect(names()[2]).toBe("Testing");
    expect(screen.getByLabelText("Testing count on 2026-10-01")).toHaveValue(3);

    fireEvent.click(screen.getByRole("button", { name: "Remove column Testing" }));
    expect(names()).toEqual(["To Do", "In Progress", "Done"]);
    expect(state().entries[0].counts).toEqual({ "col-1": 1, "col-2": 2, "col-4": 4 });
  });

  // Bug: a rename the store refused (blank, or another column's name) left
  // the refused text in the name box while the column kept its old name
  // everywhere else.
  it("shows the column's real name again after a refused rename, and says why", () => {
    render(<CFDClient />);
    const third = () => screen.getByRole("textbox", { name: "Name for column 3" });
    fireEvent.change(third(), { target: { value: "done" } });
    fireEvent.blur(third());
    expect(names()[2]).toBe("In Review");
    expect(third()).toHaveValue("In Review");
    expect(toasts.warning).toHaveBeenCalledWith('A column named "done" already exists.');

    fireEvent.change(third(), { target: { value: "   " } });
    fireEvent.blur(third());
    expect(names()[2]).toBe("In Review");
    expect(third()).toHaveValue("In Review");
  });

  it("commits a column description on blur; blank removes it", () => {
    render(<CFDClient />);
    const description = screen.getByRole("textbox", { name: "Description for In Review" });
    fireEvent.change(description, { target: { value: "Code review and QA" } });
    fireEvent.blur(description);
    expect(state().columns[2].description).toBe("Code review and QA");
    fireEvent.change(description, { target: { value: " " } });
    fireEvent.blur(description);
    expect(state().columns[2].description).toBeUndefined();
  });
});

describe("CFD client: WIP limit", () => {
  it("applies a positive whole number, treats 0 or blank as none, and clears", () => {
    useCFDStore.setState({ entries: [entry("a", "2026-10-01", counts(1, 4, 3, 0))] });
    render(<CFDClient />);
    const box = screen.getByLabelText("Max WIP Items");
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(state().wipLimit).toBe(5);
    expect(
      screen.getByText(
        "WIP limit set at 5 items — it appears on the WIP control chart once you have two snapshots."
      )
    ).toBeInTheDocument();
    // 7 in progress > 5: the WIP tile turns to a warning.
    expect(
      within(screen.getByText("WIP Items", { selector: "p" }).parentElement!).getByText("7")
    ).toHaveClass("text-warning");

    fireEvent.change(box, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(state().wipLimit).toBeNull();

    fireEvent.change(box, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(state().wipLimit).toBeNull();
    expect(box).toHaveValue(null);
  });

  it("mentions the missing middle column when WIP can't be charted", () => {
    useCFDStore.setState({ columns: [DEFAULT_COLUMNS[0], DEFAULT_COLUMNS[3]], wipLimit: 3 });
    render(<CFDClient />);
    expect(screen.getByLabelText("Max WIP Items")).toHaveValue(3);
    expect(
      screen.getByText(
        "WIP limit set at 3 items — it appears on the WIP control chart once you have two snapshots and a middle column."
      )
    ).toBeInTheDocument();
  });
});
