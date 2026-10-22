import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * 1:1 Meeting Tracker: starting a meeting, the rolling agenda (add, status
 * cycle, action fields, remove), notes committed on blur, the past-meeting
 * list, the four KPIs and the carry-over rules beyond the basic case.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as string[]);

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action) }),
}));

import { OneOnOneClient } from "@/app/(tools)/one-on-one/one-on-one-client";

const KEY = "agile-toolkit:one-on-one";
const TODAY = "2026-10-18";

type Status = "open" | "discussed" | "action_required";
interface Item {
  id: string;
  text: string;
  status: Status;
  action?: string;
  owner?: string;
  dueDate?: string;
  carriedFrom?: string;
}
interface Meeting {
  id: string;
  manager: string;
  report: string;
  date: string;
  agenda: Item[];
  notes?: string;
  description?: string;
}

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Meeting[];
const seed = (meetings: Meeting[]) => localStorage.setItem(KEY, JSON.stringify(meetings));
const meeting = (id: string, date: string, agenda: Item[] = [], extra: Partial<Meeting> = {}) => ({
  id,
  manager: "Mia",
  report: "Raj",
  date,
  agenda,
  ...extra,
});
const item = (id: string, text: string, status: Status = "open", extra: Partial<Item> = {}) => ({
  id,
  text,
  status,
  ...extra,
});

const kpi = (label: string) =>
  screen.getByText(label).parentElement!.parentElement!.textContent ?? "";

function start(manager: string, report: string, date?: string, description?: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Manager" }), {
    target: { value: manager },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Report" }), { target: { value: report } });
  if (date !== undefined) {
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
  }
  if (description !== undefined) {
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: description } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
}

const newest = () => stored().find((m) => !["m1", "m2", "m3", "m4"].includes(m.id))!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0, 0));
  localStorage.clear();
  logs.length = 0;
  exported.csv = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1:1 tracker: starting a meeting", () => {
  it("shows the empty state with zeroed KPIs", () => {
    render(<OneOnOneClient />);
    expect(screen.getByText(/No 1:1s yet/)).toBeInTheDocument();
    expect(kpi("Meetings this month")).toBe("Meetings this month0");
    expect(kpi("Action items overdue")).toBe("Action items overdue0");
    expect(kpi("Addressed")).toContain("0%");
    expect(kpi("Growth themes")).toContain("0");
  });

  it("needs both a manager and a report", () => {
    render(<OneOnOneClient />);
    const button = screen.getByRole("button", { name: "Start meeting" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Manager" }), {
      target: { value: "Mia" },
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Report" }), {
      target: { value: "   " },
    });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Report" }), {
      target: { value: "Raj" },
    });
    expect(button).toBeEnabled();
  });

  it("starts a trimmed meeting, opens it and resets the form", () => {
    render(<OneOnOneClient />);
    expect(screen.getByLabelText("Date")).toHaveValue(TODAY);
    start("  Mia ", " Raj  ", "2026-10-16", "  Quarterly check-in ");
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      manager: "Mia",
      report: "Raj",
      date: "2026-10-16",
      agenda: [],
      description: "Quarterly check-in",
    });
    expect(screen.getByText("Active 1:1")).toBeInTheDocument();
    expect(screen.getByText("Mia ↔ Raj · 2026-10-16")).toBeInTheDocument();
    expect(screen.getByText(/No agenda items yet/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Manager" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Report" })).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(logs).toContain("meeting_logged");
    expect(kpi("Meetings this month")).toBe("Meetings this month1");
  });

  it("stores no description when it is blank", () => {
    render(<OneOnOneClient />);
    start("Mia", "Raj", undefined, "   ");
    expect(stored()[0].description).toBeUndefined();
  });

  // Bug: clearing the date field started a meeting with an empty date.
  it("holds the meeting today when the date field was cleared", () => {
    render(<OneOnOneClient />);
    start("Mia", "Raj", "");
    expect(stored()[0].date).toBe(TODAY);
    expect(screen.getByText(`Mia ↔ Raj · ${TODAY}`)).toBeInTheDocument();
    expect(kpi("Meetings this month")).toBe("Meetings this month1");
  });
});

describe("1:1 tracker: the agenda", () => {
  beforeEach(() => {
    seed([]);
  });

  const open = () => {
    render(<OneOnOneClient />);
    start("Mia", "Raj");
  };
  const agendaOf = () => stored()[0].agenda;

  it("adds a trimmed agenda item as Open, on Add or Enter, and ignores blanks", () => {
    open();
    const input = screen.getByLabelText("New agenda item");
    fireEvent.change(input, { target: { value: "  Career goals " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(input, { target: { value: "Feedback" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(agendaOf().map((a) => [a.text, a.status])).toEqual([
      ["Career goals", "open"],
      ["Feedback", "open"],
    ]);
    expect(input).toHaveValue("   ");
    expect(logs.filter((l) => l === "agenda_item_added")).toHaveLength(2);
  });

  it("cycles an item's status Open → Discussed → Action → Open", () => {
    open();
    fireEvent.change(screen.getByLabelText("New agenda item"), { target: { value: "Promo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Open: change status of Promo" }));
    expect(agendaOf()[0].status).toBe("discussed");
    expect(screen.queryByRole("textbox", { name: "Action" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Discussed: change status of Promo" }));
    expect(agendaOf()[0].status).toBe("action_required");
    expect(screen.getByRole("textbox", { name: "Action" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Action: change status of Promo" }));
    expect(agendaOf()[0].status).toBe("open");
    expect(logs.filter((l) => l === "action_toggled")).toHaveLength(3);
  });

  it("saves an action's text and owner on blur, and its due date as picked", () => {
    open();
    fireEvent.change(screen.getByLabelText("New agenda item"), { target: { value: "CI" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Open: change status of CI" }));
    fireEvent.click(screen.getByRole("button", { name: "Discussed: change status of CI" }));

    const action = screen.getByRole("textbox", { name: "Action" });
    fireEvent.change(action, { target: { value: "Fix flaky tests" } });
    expect(agendaOf()[0].action).toBeUndefined();
    fireEvent.blur(action);
    const owner = screen.getByRole("textbox", { name: "Owner" });
    fireEvent.change(owner, { target: { value: "Raj" } });
    fireEvent.keyDown(owner, { key: "Enter" });
    fireEvent.blur(owner);
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-25" } });
    expect(agendaOf()[0]).toMatchObject({
      action: "Fix flaky tests",
      owner: "Raj",
      dueDate: "2026-10-25",
    });

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "" } });
    expect(agendaOf()[0].dueDate).toBeUndefined();
  });

  it("removes only the chosen agenda item", () => {
    open();
    const input = screen.getByLabelText("New agenda item");
    for (const text of ["One", "Two", "Three"]) {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    fireEvent.click(screen.getAllByRole("button", { name: "Remove agenda item" })[1]);
    expect(agendaOf().map((a) => a.text)).toEqual(["One", "Three"]);
  });

  it("commits notes on blur only", () => {
    open();
    const notes = screen.getByLabelText("Meeting notes");
    fireEvent.change(notes, { target: { value: "Raj wants to lead the next epic" } });
    expect(stored()[0].notes).toBeUndefined();
    fireEvent.blur(notes);
    expect(stored()[0].notes).toBe("Raj wants to lead the next epic");
    expect(notes).toHaveValue("Raj wants to lead the next epic");
  });
});

describe("1:1 tracker: past meetings", () => {
  beforeEach(() =>
    seed([
      meeting(
        "m1",
        "2026-09-02",
        [
          item("a", "Holiday", "discussed"),
          item("b", "CI", "action_required", {
            action: "Fix flaky tests",
            owner: "Raj",
            dueDate: "2026-09-10",
          }),
        ],
        { notes: "Good chat", description: "Monthly" }
      ),
      meeting("m2", "2026-10-07", [], { notes: "October notes" }),
    ])
  );

  it("lists past meetings newest first, collapsed", () => {
    render(<OneOnOneClient />);
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.map((r) => r.textContent)).toEqual([
      "2026-10-07 · Mia ↔ Raj0 items",
      "2026-09-02 · Mia ↔ Raj2 items",
    ]);
    expect(screen.queryByText("Good chat")).toBeNull();
  });

  it("expands a past meeting to show its description, agenda, action and notes", () => {
    render(<OneOnOneClient />);
    fireEvent.click(screen.getByRole("button", { name: /2026-09-02 · Mia ↔ Raj/ }));
    expect(screen.getByRole("button", { name: /2026-09-02 · Mia ↔ Raj/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("→ Fix flaky tests (Raj) · due 2026-09-10")).toBeInTheDocument();
    expect(screen.getByText("Good chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026-09-02 · Mia ↔ Raj/ }));
    expect(screen.queryByText("Good chat")).toBeNull();
  });

  it("opens a past meeting as the active one, with its notes, and closes it", () => {
    render(<OneOnOneClient />);
    fireEvent.click(screen.getByRole("button", { name: "Open 1:1 from 2026-09-02" }));
    expect(screen.getByText("Mia ↔ Raj · 2026-09-02")).toBeInTheDocument();
    expect(screen.getByLabelText("Meeting notes")).toHaveValue("Good chat");
    // The active meeting leaves the past list.
    expect(screen.queryByRole("button", { name: "Open 1:1 from 2026-09-02" })).toBeNull();

    // Opening another meeting loads its notes.
    fireEvent.click(screen.getByRole("button", { name: "Open 1:1 from 2026-10-07" }));
    expect(screen.getByLabelText("Meeting notes")).toHaveValue("October notes");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Active 1:1")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Open 1:1 from/ })).toHaveLength(2);
  });

  it("removes a past meeting", () => {
    render(<OneOnOneClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove 1:1 from 2026-09-02" }));
    expect(stored().map((m) => m.id)).toEqual(["m2"]);
    expect(logs).toContain("meeting_removed");
  });

  it("exports one CSV row per agenda item, and one blank row for an empty meeting", () => {
    render(<OneOnOneClient />);
    expect(exported.csv?.rows).toEqual([
      ["2026-09-02", "Mia", "Raj", "Holiday", "discussed", "", "", ""],
      ["2026-09-02", "Mia", "Raj", "CI", "action_required", "Fix flaky tests", "Raj", "2026-09-10"],
      ["2026-10-07", "Mia", "Raj", "", "", "", "", ""],
    ]);
  });
});

describe("1:1 tracker: KPIs", () => {
  it("counts meetings in the current calendar month only", () => {
    seed([
      meeting("m1", "2026-10-01"),
      meeting("m2", "2026-10-31"),
      meeting("m3", "2026-09-30"),
      meeting("m4", "2025-10-18"),
    ]);
    render(<OneOnOneClient />);
    expect(kpi("Meetings this month")).toBe("Meetings this month2");
  });

  it("counts open actions due before today as overdue", () => {
    seed([
      meeting("m1", "2026-10-01", [
        item("a", "Past due", "action_required", { dueDate: "2026-10-17" }),
        item("b", "Due today", "action_required", { dueDate: TODAY }),
        item("c", "No due date", "action_required"),
        item("d", "Discussed, past due", "discussed", { dueDate: "2026-10-01" }),
        item("e", "Open, past due", "open", { dueDate: "2026-10-01" }),
      ]),
    ]);
    render(<OneOnOneClient />);
    expect(kpi("Action items overdue")).toBe("Action items overdue1");
  });

  it("rates Addressed as discussed or action items over all items", () => {
    seed([
      meeting("m1", "2026-10-01", [
        item("a", "A", "discussed"),
        item("b", "B", "action_required"),
        item("c", "C", "open"),
      ]),
    ]);
    render(<OneOnOneClient />);
    expect(kpi("Addressed")).toContain("67%");
  });

  // Bug: "growth-hacking", one of the false positives the word-boundary fix names, still counted.
  it("counts growth themes as a whole word, once per meeting note and once per item", () => {
    seed([
      meeting(
        "m1",
        "2026-10-01",
        [
          item("a", "Growth plan"),
          item("b", "Regrowth of the lawn"),
          item("c", "Tooling", "action_required", { action: "Book a growth session" }),
          item("d", "growth-hacking"),
        ],
        { notes: "Talked growth", description: "Growth focus" }
      ),
      meeting("m2", "2026-10-08", [], { description: "Outgrowth only" }),
    ]);
    render(<OneOnOneClient />);
    // m1 notes/description: 1, "Growth plan": 1, the action: 1. "Regrowth", "Outgrowth"
    // and "growth-hacking" aren't about anyone's growth.
    expect(kpi("Growth themes")).toBe('Growth themes3items mentioning "growth"');
  });
});

describe("1:1 tracker: carry-over rules", () => {
  it("matches the pair case-insensitively and ignores other pairs", () => {
    seed([
      meeting("m1", "2026-10-01", [item("a", "Career goals")]),
      meeting("m2", "2026-10-02", [item("b", "Someone else's topic")], {
        manager: "Mia",
        report: "Sol",
      }),
    ]);
    render(<OneOnOneClient />);
    start("MIA", "raj");
    expect(newest().agenda.map((a) => [a.text, a.carriedFrom])).toEqual([["Career goals", "a"]]);
    expect(screen.queryByText("Someone else's topic")).toBeNull();
  });

  it("never inherits from a meeting later than the new one", () => {
    seed([
      meeting("m1", "2026-10-01", [item("a", "Older topic")]),
      meeting("m2", "2026-10-15", [item("b", "Future topic")]),
    ]);
    render(<OneOnOneClient />);
    start("Mia", "Raj", "2026-10-08");
    expect(newest().agenda.map((a) => a.text)).toEqual(["Older topic"]);
  });

  it("prefers the latest meeting with an agenda over a newer empty one", () => {
    seed([meeting("m1", "2026-10-01", [item("a", "Still open")]), meeting("m2", "2026-10-10", [])]);
    render(<OneOnOneClient />);
    start("Mia", "Raj");
    expect(newest().agenda.map((a) => a.text)).toEqual(["Still open"]);
  });

  it("leaves Discussed items behind and gives carried items new ids", () => {
    seed([
      meeting("m1", "2026-10-01", [
        item("a", "Done talking", "discussed"),
        item("b", "Keep talking"),
      ]),
    ]);
    render(<OneOnOneClient />);
    start("Mia", "Raj");
    const carried = newest().agenda;
    expect(carried.map((a) => a.text)).toEqual(["Keep talking"]);
    expect(carried[0].id).not.toBe("b");
    expect(carried[0].status).toBe("open");
    // The new meeting shows the carried item; the old one keeps its own.
    expect(stored().find((m) => m.id === "m1")!.agenda).toHaveLength(2);
    expect(screen.getByText("Keep talking")).toBeInTheDocument();
  });

  it("carries nothing for a first meeting with a new pair", () => {
    seed([meeting("m1", "2026-10-01", [item("a", "Mia and Raj topic")])]);
    render(<OneOnOneClient />);
    start("Mia", "Noor");
    expect(newest().agenda).toEqual([]);
  });
});
