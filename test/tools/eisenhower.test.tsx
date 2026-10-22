import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Eisenhower Matrix: adding a task to a quadrant, the four quadrant columns
 * (only framework="eisenhower" rows), moving and removing tasks, items
 * persisted by the MCP actions, and the CSV export.
 */

type Csv = { headers: string[]; rows: unknown[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { EisenhowerClient } from "@/app/(tools)/eisenhower/eisenhower-client";
import { EISENHOWER_ACTIONS } from "@/lib/history/event-actions";

const QUADRANTS = ["Do", "Schedule", "Delegate", "Delete"];

const task = (
  id: string,
  title: string,
  quadrant: string | undefined,
  over: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "eisenhower",
  title,
  fields: quadrant === undefined ? undefined : { quadrant },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const all = () => useWorkspaceStore.getState().prioritizations ?? [];
const byId = (id: string) => all().find((x) => x.id === id);

/** A quadrant column ("Do", "Schedule", …), found by its heading. */
function column(label: string): HTMLElement {
  const heading = screen.getAllByText(label).find((e) => e.className.includes("uppercase"));
  if (!heading) throw new Error(`no column ${label}`);
  return heading.parentElement!.parentElement!;
}
const count = (label: string) =>
  within(column(label)).getByText(/^\d+$/, { selector: "span.text-xs" }).textContent;

function choose(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

function add(title: string) {
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [], whiteboardObjects: [] });
});

describe("Eisenhower — empty state and validation", () => {
  it("shows four empty quadrants and defaults the new task to Do", () => {
    render(<EisenhowerClient />);
    expect(screen.getByText("Quadrants (0 tasks)")).toBeInTheDocument();
    for (const q of QUADRANTS) expect(count(q)).toBe("0");
    expect(screen.getByRole("combobox", { name: "Quadrant" })).toHaveTextContent(
      "Do — Urgent + Important"
    );
  });

  it("ignores Add with a blank or whitespace-only task", () => {
    render(<EisenhowerClient />);
    add("");
    add("   ");
    expect(all()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("Eisenhower — adding tasks", () => {
  it("adds a trimmed task to Do by default and clears the input", () => {
    render(<EisenhowerClient />);
    add("  Fix prod outage  ");

    expect(all()).toHaveLength(1);
    const t = all()[0];
    expect(t).toMatchObject({
      framework: "eisenhower",
      title: "Fix prod outage",
      fields: { quadrant: "do" },
      status: "scored",
    });
    expect(Number.isNaN(Date.parse(t.updatedAt))).toBe(false);
    expect(screen.getByLabelText("Task")).toHaveValue("");
    expect(count("Do")).toBe("1");
    expect(within(column("Do")).getByText("Fix prod outage")).toBeInTheDocument();
    expect(screen.getByText("Quadrants (1 tasks)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(EISENHOWER_ACTIONS.TASK_ADDED, {
      title: "Fix prod outage",
      quadrant: "do",
    });
  });

  it("adds to the chosen quadrant, which stays chosen for the next task", () => {
    render(<EisenhowerClient />);
    choose(screen.getByRole("combobox", { name: "Quadrant" }), "Schedule — Important, not urgent");
    add("Write the Q1 plan");
    add("Mentor new hire");
    expect(all().map((x) => x.fields?.quadrant)).toEqual(["schedule", "schedule"]);
    expect(count("Schedule")).toBe("2");
    expect(count("Do")).toBe("0");
  });

  it("caps a very long title at 240 characters", () => {
    render(<EisenhowerClient />);
    add("x".repeat(300));
    expect(all()[0].title).toHaveLength(240);
  });
});

describe("Eisenhower — the matrix", () => {
  it("shows only Eisenhower rows from the shared prioritization store", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("e1", "Fix outage", "do"),
        task("w1", "WSJF feature", undefined, { framework: "wsjf" }),
        task("e2", "Plan Q1", "schedule"),
        task("e3", "Book travel", "delegate"),
        task("e4", "Old newsletter", "delete"),
      ],
    });
    render(<EisenhowerClient />);
    expect(screen.getByText("Quadrants (4 tasks)")).toBeInTheDocument();
    for (const q of QUADRANTS) expect(count(q)).toBe("1");
    expect(screen.queryByText("WSJF feature")).not.toBeInTheDocument();
    expect(within(column("Delegate")).getByText("Book travel")).toBeInTheDocument();
    expect(exported.csv?.rows).toHaveLength(4);
  });

  it("moves a task between quadrants, keeping its other fields", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("e1", "Answer RFP", "do", {
          score: 4,
          description: "Due Friday",
          fields: { quadrant: "do", urgent: "true", important: "true" },
        }),
        task("e2", "Plan Q1", "schedule"),
      ],
    });
    render(<EisenhowerClient />);
    choose(screen.getByRole("combobox", { name: "Quadrant for Answer RFP" }), "Delegate");

    const moved = byId("e1")!;
    expect(moved.fields?.quadrant).toBe("delegate");
    expect(moved).toMatchObject({ title: "Answer RFP", description: "Due Friday" });
    expect(moved.updatedAt).not.toBe("2026-10-01T09:00:00.000Z");
    expect(byId("e2")?.fields?.quadrant).toBe("schedule");
    expect(count("Do")).toBe("0");
    expect(within(column("Delegate")).getByText("Answer RFP")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(EISENHOWER_ACTIONS.TASK_MOVED, {
      id: "e1",
      quadrant: "delegate",
    });
  });

  it("files a task with a missing or unknown quadrant under Do without crashing", () => {
    useWorkspaceStore.setState({
      prioritizations: [task("e1", "No fields", undefined), task("e2", "Stale id", "do_first")],
    });
    render(<EisenhowerClient />);
    expect(count("Do")).toBe("2");
    expect(within(column("Do")).getByText("No fields")).toBeInTheDocument();
    expect(within(column("Do")).getByText("Stale id")).toBeInTheDocument();
  });

  // Bug: a task with a stale quadrant id sat in the Do column, but its own
  // dropdown was blank and its CSV row carried the stale id (or "").
  it("shows and exports Do for a task that the board files under Do", () => {
    useWorkspaceStore.setState({
      prioritizations: [task("e1", "No fields", undefined), task("e2", "Stale id", "do_first")],
    });
    render(<EisenhowerClient />);
    expect(screen.getByRole("combobox", { name: "Quadrant for Stale id" })).toHaveTextContent("Do");
    expect(screen.getByRole("combobox", { name: "Quadrant for No fields" })).toHaveTextContent(
      "Do"
    );
    expect(exported.csv?.rows).toEqual([
      ["do", "No fields"],
      ["do", "Stale id"],
    ]);
  });

  it("renders a task persisted by the MCP classify action in its quadrant", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("prio_1", "Agent task", undefined, {
          score: 3,
          fields: { urgent: "false", important: "true", quadrant: "schedule" },
        }),
      ],
    });
    render(<EisenhowerClient />);
    expect(within(column("Schedule")).getByText("Agent task")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Quadrant for Agent task" })).toHaveTextContent(
      "Schedule"
    );
  });

  it("removes only the clicked task and leaves other frameworks alone", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("e1", "Fix outage", "do"),
        task("e2", "Plan Q1", "schedule"),
        task("w1", "WSJF feature", undefined, { framework: "wsjf" }),
      ],
    });
    render(<EisenhowerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove task: Fix outage" }));
    expect(all().map((x) => x.id)).toEqual(["e2", "w1"]);
    expect(count("Do")).toBe("0");
    expect(screen.getByText("Quadrants (1 tasks)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(EISENHOWER_ACTIONS.TASK_REMOVED, { id: "e1" });
  });

  it("exports quadrant and title to CSV", () => {
    useWorkspaceStore.setState({
      prioritizations: [task("e1", "Fix outage", "do"), task("e2", "Plan Q1", "schedule")],
    });
    render(<EisenhowerClient />);
    expect(exported.csv?.headers).toEqual(["Quadrant", "Title"]);
    expect(exported.csv?.rows).toEqual([
      ["do", "Fix outage"],
      ["schedule", "Plan Q1"],
    ]);
  });
});
