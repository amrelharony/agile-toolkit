import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DesignSprintDay,
  DesignSprintDayNumber,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";

/**
 * Design Sprint Tracker: a synced singleton holding one 5-day GV sprint.
 * Covers starting a sprint (validation, default tasks, date fallback), the
 * KPI strip, switching days, tasks (toggle / add / remove / owner),
 * artifacts, the Decider / Facilitator roles, completing, resetting and the
 * CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof exported.csv }) => {
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

import { DesignSprintClient } from "@/app/(tools)/design-sprint/design-sprint-client";

const DS_ID = "designSprint:current";
const NAMES = ["Map", "Sketch", "Decide", "Prototype", "Test"] as const;

function day(n: DesignSprintDayNumber, tasks: string[] = [], artifacts: string[] = []) {
  const d: DesignSprintDay = {
    day: n,
    dayName: NAMES[n - 1],
    tasks: tasks.map((text, i) => ({ id: `d${n}t${i}`, text, done: false })),
    artifacts,
  };
  return d;
}

function plan(over: Partial<DesignSprintPlan> = {}): DesignSprintPlan {
  return {
    id: "s1",
    name: "Onboarding redesign",
    startDate: "2026-10-12",
    currentDay: 1,
    days: [day(1, ["Set the goal", "Map the journey"]), day(2, ["Sketch"]), day(3), day(4), day(5)],
    ...over,
  };
}

const seed = (sprint: DesignSprintPlan | null) =>
  useWorkspaceStore.setState({ designSprints: [{ id: DS_ID, sprint }] });
const sprint = () =>
  (useWorkspaceStore.getState().designSprints ?? []).find((d) => d.id === DS_ID)?.sprint ?? null;

function kpi(label: string): { value: string; hint: string } {
  const el = screen.getByText(label, { selector: "span" });
  const content = el.parentElement!.parentElement!;
  return {
    value: content.children[1].textContent ?? "",
    hint: content.children[2]?.textContent ?? "",
  };
}

function chooseOwner(task: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: `Owner for ${task}` }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  history.log.mockClear();
  exported.csv = undefined;
  useWorkspaceStore.setState({ designSprints: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Design Sprint: starting", () => {
  it("offers a start form whose button needs a non-blank name", () => {
    render(<DesignSprintClient />);
    const start = screen.getByRole("button", { name: /Start sprint/ });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sprint name"), { target: { value: "   " } });
    expect(start).toBeDisabled();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-18");
  });

  it("starts a sprint with the five GV days and their default tasks", () => {
    render(<DesignSprintClient />);
    fireEvent.change(screen.getByLabelText("Sprint name"), {
      target: { value: "  Checkout  " },
    });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-19" } });
    fireEvent.change(screen.getByLabelText("Sprint description"), {
      target: { value: "  Cut drop-off  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start sprint/ }));

    const s = sprint()!;
    expect(s).toMatchObject({
      name: "Checkout",
      startDate: "2026-10-19",
      currentDay: 1,
      description: "Cut drop-off",
    });
    expect(s.days.map((d) => d.dayName)).toEqual([...NAMES]);
    expect(s.days.map((d) => d.tasks.length)).toEqual([6, 4, 5, 4, 4]);
    expect(s.days.every((d) => d.tasks.every((t) => !t.done))).toBe(true);
    expect(new Set(s.days.flatMap((d) => d.tasks.map((t) => t.id))).size).toBe(23);
    expect(history.log).toHaveBeenCalledWith(
      "sprint_started",
      expect.objectContaining({ name: "Checkout", startDate: "2026-10-19" })
    );
    expect(screen.getByText("Started 2026-10-19")).toBeInTheDocument();
    expect(screen.getByText("Cut drop-off")).toBeInTheDocument();
  });

  it("falls back to today when the date field was cleared", () => {
    render(<DesignSprintClient />);
    fireEvent.change(screen.getByLabelText("Sprint name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Start sprint/ }));
    expect(sprint()!.startDate).toBe("2026-10-18");
    expect(sprint()!.description).toBeUndefined();
  });
});

describe("Design Sprint: KPIs and days", () => {
  it("summarises the current day, task completion, days left and status", () => {
    seed(plan());
    render(<DesignSprintClient />);
    expect(kpi("Current day")).toEqual({ value: "1 / 5", hint: "Map" });
    expect(kpi("Tasks done")).toEqual({ value: "0%", hint: "0/3" });
    expect(kpi("Days remaining")).toEqual({ value: "5", hint: "incl. today" });
    expect(kpi("Status").value).toBe("Active");
    expect(screen.getByText("Day 1 — Map")).toBeInTheDocument();
  });

  it("switches the visible day and the day-based KPIs", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.click(screen.getByRole("button", { name: /^Day 3/ }));
    expect(sprint()!.currentDay).toBe(3);
    expect(screen.getByRole("button", { name: /^Day 3/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Day 1/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Day 3 — Decide")).toBeInTheDocument();
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
    expect(kpi("Current day")).toEqual({ value: "3 / 5", hint: "Decide" });
    expect(kpi("Days remaining").value).toBe("3");
  });

  it("shows 0% done for a day with no tasks, never NaN", () => {
    seed(plan());
    render(<DesignSprintClient />);
    expect(screen.getByRole("button", { name: /^Day 4/ })).toHaveTextContent("0% done");
  });
});

describe("Design Sprint: tasks", () => {
  it("toggles a task and updates the day and sprint completion", () => {
    seed(plan());
    render(<DesignSprintClient />);
    const box = screen.getByRole("checkbox", { name: "Set the goal" });
    fireEvent.click(box);
    expect(sprint()!.days[0].tasks[0].done).toBe(true);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(kpi("Tasks done")).toEqual({ value: "33%", hint: "1/3" });
    expect(screen.getByRole("button", { name: /^Day 1/ })).toHaveTextContent("50% done");
    expect(history.log).toHaveBeenLastCalledWith(
      "task_toggled",
      expect.objectContaining({ day: 1, taskId: "d1t0", done: true })
    );

    fireEvent.click(box);
    expect(sprint()!.days[0].tasks[0].done).toBe(false);
    expect(history.log).toHaveBeenLastCalledWith(
      "task_toggled",
      expect.objectContaining({ done: false })
    );
  });

  it("adds a trimmed task with the button or Enter, ignoring blanks", () => {
    seed(plan());
    render(<DesignSprintClient />);
    const input = screen.getByLabelText("New task");
    fireEvent.change(input, { target: { value: "  Book the room  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.change(input, { target: { value: "Order snacks" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(sprint()!.days[0].tasks.map((t) => t.text)).toEqual([
      "Set the goal",
      "Map the journey",
      "Book the room",
      "Order snacks",
    ]);
    expect(input).toHaveValue("   ");
  });

  it("caps a pasted task at 500 characters", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.change(screen.getByLabelText("New task"), { target: { value: "t".repeat(800) } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(sprint()!.days[0].tasks.at(-1)!.text).toHaveLength(500);
  });

  it("removes exactly the clicked task", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove task Set the goal" }));
    expect(sprint()!.days[0].tasks.map((t) => t.text)).toEqual(["Map the journey"]);
    expect(sprint()!.days[1].tasks).toHaveLength(1);
  });

  it("assigns an owner from the Decider / Facilitator and clears it again", () => {
    seed(plan({ decider: "Dana", facilitator: "Faye" }));
    render(<DesignSprintClient />);
    chooseOwner("Set the goal", "Faye");
    expect(sprint()!.days[0].tasks[0].owner).toBe("Faye");
    expect(history.log).toHaveBeenCalledWith(
      "task_owner_assigned",
      expect.objectContaining({ taskId: "d1t0", owner: "Faye" })
    );
    chooseOwner("Set the goal", "No owner");
    expect(sprint()!.days[0].tasks[0].owner).toBeUndefined();
  });

  it("lists one option when the Decider is also the Facilitator", () => {
    seed(plan({ decider: "Dana", facilitator: "Dana" }));
    render(<DesignSprintClient />);
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Owner for Set the goal" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["No owner", "Dana"]);
  });

  it("keeps an owner who is no longer a role-holder visible as orphaned", () => {
    const p = plan({ decider: "Dana" });
    p.days[0].tasks[0].owner = "Old Lead";
    seed(p);
    render(<DesignSprintClient />);
    fireEvent.pointerDown(screen.getByRole("combobox", { name: "Owner for Set the goal" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Old Lead (no longer on team)",
      })
    ).toBeInTheDocument();
  });
});

describe("Design Sprint: artifacts and roles", () => {
  it("logs trimmed artifacts and removes the clicked one by position", () => {
    seed(plan());
    render(<DesignSprintClient />);
    expect(screen.getByText("No artifacts logged yet.")).toBeInTheDocument();
    const input = screen.getByLabelText("New artifact");
    fireEvent.change(input, { target: { value: "  https://miro.test/map  " } });
    fireEvent.click(screen.getByRole("button", { name: "Log artifact" }));
    fireEvent.change(input, { target: { value: "HMW notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sprint()!.days[0].artifacts).toEqual(["https://miro.test/map", "HMW notes"]);
    expect(history.log).toHaveBeenCalledWith(
      "artifact_logged",
      expect.objectContaining({ day: 1, artifact: "https://miro.test/map" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove artifact https://miro.test/map" }));
    expect(sprint()!.days[0].artifacts).toEqual(["HMW notes"]);
  });

  it("ignores a blank artifact", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.change(screen.getByLabelText("New artifact"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Log artifact" }));
    expect(sprint()!.days[0].artifacts).toEqual([]);
  });

  it("commits trimmed role names on blur and clears them when blank", () => {
    seed(plan());
    render(<DesignSprintClient />);
    const decider = screen.getByLabelText("Decider name");
    fireEvent.change(decider, { target: { value: "  Dana  " } });
    expect(sprint()!.decider).toBeUndefined();
    fireEvent.blur(decider);
    expect(sprint()!.decider).toBe("Dana");
    fireEvent.change(screen.getByLabelText("Facilitator name"), { target: { value: "Faye" } });
    fireEvent.blur(screen.getByLabelText("Facilitator name"));
    expect(sprint()!.facilitator).toBe("Faye");
    const roles = screen.getByText(/Decider:/);
    expect(roles).toHaveTextContent("Decider: Dana");
    expect(roles).toHaveTextContent("Facilitator: Faye");

    fireEvent.change(decider, { target: { value: "   " } });
    fireEvent.blur(decider);
    expect(sprint()!.decider).toBeUndefined();
  });
});

describe("Design Sprint: complete and reset", () => {
  it("completes the sprint and reflects it in the KPIs", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.click(screen.getByRole("button", { name: /Complete sprint/ }));
    expect(sprint()!.completedAt).toBe(new Date(2026, 9, 18, 10, 0).toISOString());
    expect(kpi("Status").value).toBe("Done");
    expect(kpi("Days remaining")).toEqual({ value: "0", hint: "completed" });
    expect(screen.getByText("Sprint completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete sprint/ })).toBeNull();
    expect(history.log).toHaveBeenCalledWith(
      "sprint_completed",
      expect.objectContaining({ sprintId: "s1" })
    );
  });

  it("resets back to the start form", () => {
    seed(plan());
    render(<DesignSprintClient />);
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(sprint()).toBeNull();
    expect(screen.getByRole("button", { name: /Start sprint/ })).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith("sprint_reset", {
      sprintId: "s1",
      name: "Onboarding redesign",
    });
  });

  it("exports one CSV row per task with the description on one line", () => {
    const p = plan({ description: "Line 1\nLine 2" });
    p.days[0].tasks[0] = { ...p.days[0].tasks[0], done: true, owner: "Dana" };
    seed(p);
    render(<DesignSprintClient />);
    expect(exported.csv?.rows).toEqual([
      ["Line 1 Line 2", "Day 1", "Map", "Set the goal", "Yes", "Dana"],
      ["Line 1 Line 2", "Day 1", "Map", "Map the journey", "No", ""],
      ["Line 1 Line 2", "Day 2", "Sketch", "Sketch", "No", ""],
    ]);
  });
});
