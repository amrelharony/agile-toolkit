import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Impediment Tracker: the pure helpers (workspace projection, age, average
 * and series of resolution days, weekly buckets), the store's actions, and
 * the client (stats, sorting, filters, escalate / resolve / delete, the log
 * form, Reset, and the one-way bridge into workspace.impediments).
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { ImpedimentsClient } from "@/app/(tools)/impediments/impediments-client";
import { useImpedimentStore } from "@/app/(tools)/impediments/use-impediment-store";
import {
  avgResolutionDays,
  buildWeeklyImpedimentSeries,
  daysSince,
  resolutionDaysSeries,
  sameWorkspaceImpediment,
  toWorkspaceImpediment,
} from "@/app/(tools)/impediments/helpers";
import type { Impediment } from "@/app/(tools)/impediments/types";

const imp = (id: string, title: string, extra: Partial<Impediment> = {}): Impediment => ({
  id,
  title,
  description: "",
  category: "Technical",
  severity: "Medium",
  raisedBy: "",
  assignedTo: "",
  status: "Open",
  raisedDate: "2026-10-10",
  ...extra,
});

const local = () => useImpedimentStore.getState().impediments;
const byId = (id: string) => local().find((i) => i.id === id);
const shared = () => useWorkspaceStore.getState().impediments ?? [];

/** Wed 21 Oct 2026, noon local. */
const WED = new Date(2026, 9, 21, 12);
function at(d: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(d);
}

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

/** Titles in the order the list shows them. */
const listed = () =>
  screen
    .queryAllByRole("button", { name: /^Delete / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Delete /, ""));

const stat = (label: string) =>
  screen.getByText(label, { selector: "p" }).nextElementSibling!.textContent;

beforeEach(() => {
  useImpedimentStore.setState({ impediments: [] });
  useWorkspaceStore.setState({ impediments: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("impediment helpers: workspace projection", () => {
  it("maps severity, owner, dates and where it came from", () => {
    expect(
      toWorkspaceImpediment(
        imp("a", "Flaky CI", {
          severity: "Critical",
          assignedTo: "Sam",
          status: "Resolved",
          resolvedDate: "2026-10-12",
        })
      )
    ).toEqual({
      id: "a",
      title: "Flaky CI",
      severity: "critical",
      raisedAt: "2026-10-10",
      resolvedAt: "2026-10-12",
      owner: "Sam",
      source: "manual",
      sourceRef: undefined,
    });
    const fromRetro = toWorkspaceImpediment(
      imp("b", "No test env", { source: "retro", sourceRef: { tool: "retro", id: "c1" } })
    );
    expect(fromRetro).toMatchObject({ owner: undefined, source: "retro" });
    expect(fromRetro.sourceRef).toEqual({ tool: "retro", id: "c1" });
  });

  it("compares rows field by field, treating a missing source as manual", () => {
    const row = toWorkspaceImpediment(imp("a", "Flaky CI", { assignedTo: "Sam" }));
    expect(sameWorkspaceImpediment(row, { ...row })).toBe(true);
    expect(sameWorkspaceImpediment({ ...row, source: undefined }, row)).toBe(true);
    expect(sameWorkspaceImpediment(row, { ...row, owner: "Ana" })).toBe(false);
    expect(sameWorkspaceImpediment(row, { ...row, resolvedAt: "2026-10-12" })).toBe(false);
    expect(sameWorkspaceImpediment(row, { ...row, severity: "high" })).toBe(false);
    expect(
      sameWorkspaceImpediment(
        { ...row, sourceRef: { tool: "retro", id: "c1", doc: "r1" } },
        { ...row, sourceRef: { tool: "retro", id: "c1", doc: "r2" } }
      )
    ).toBe(false);
  });
});

describe("impediment helpers: age", () => {
  it("counts whole days, and is 0 for a bad or future date", () => {
    at(WED);
    expect(daysSince("2026-10-21")).toBe(0);
    expect(daysSince("2026-10-14")).toBe(7);
    expect(daysSince("garbage")).toBe(0);
    expect(daysSince("2026-11-01")).toBe(0);
  });

  // Bug: the stored date (a local calendar day) was read as UTC midnight, so
  // east of UTC an impediment raised yesterday read "0d" just after midnight,
  // and west of UTC one raised today read "1d" in the evening.
  it("counts local calendar days, whatever the time of day", () => {
    at(new Date(2026, 9, 19, 0, 30));
    expect(daysSince("2026-10-18")).toBe(1);
    at(new Date(2026, 9, 18, 23, 30));
    expect(daysSince("2026-10-18")).toBe(0);
    at(new Date(2026, 9, 25, 23, 59));
    expect(daysSince("2026-10-18")).toBe(7);
  });
});

describe("impediment helpers: resolution days", () => {
  it("averages resolved ones only, skipping bad rows and clamping negatives", () => {
    const list = [
      imp("a", "A", { raisedDate: "2026-10-01", resolvedDate: "2026-10-05", status: "Resolved" }),
      imp("b", "B", { raisedDate: "2026-10-02", resolvedDate: "2026-10-04", status: "Resolved" }),
      // Bad dates: skipped, not NaN.
      imp("c", "C", { raisedDate: "nope", resolvedDate: "2026-10-04", status: "Resolved" }),
      // Resolved "before" it was raised: 0, not negative.
      imp("d", "D", { raisedDate: "2026-10-09", resolvedDate: "2026-10-08", status: "Resolved" }),
      // A date on an unresolved one doesn't count.
      imp("e", "E", { raisedDate: "2026-09-01", resolvedDate: "2026-10-01", status: "Open" }),
      // Resolved without a date doesn't count.
      imp("f", "F", { status: "Resolved" }),
    ];
    expect(resolutionDaysSeries(list)).toEqual([4, 2, 0]);
    // (4 + 2 + 0) / 3 = 2.
    expect(avgResolutionDays(list)).toBe(2);
    expect(avgResolutionDays([])).toBe(0);
    expect(avgResolutionDays([list[2]])).toBe(0);
  });

  it("rounds the average to whole days", () => {
    const list = [
      imp("a", "A", { raisedDate: "2026-10-01", resolvedDate: "2026-10-02", status: "Resolved" }),
      imp("b", "B", { raisedDate: "2026-10-01", resolvedDate: "2026-10-03", status: "Resolved" }),
    ];
    expect(avgResolutionDays(list)).toBe(2); // 1.5 → 2
  });
});

describe("impediment helpers: weekly series", () => {
  it("is empty with nothing, or nothing dated", () => {
    expect(buildWeeklyImpedimentSeries([])).toEqual({ raisedPerWeek: [], openAtWeek: [] });
    expect(buildWeeklyImpedimentSeries([imp("a", "A", { raisedDate: "soon" })])).toEqual({
      raisedPerWeek: [],
      openAtWeek: [],
    });
  });

  // Bug: the week count used Math.ceil(...) + 1, so on any day but Sunday the
  // series ran one week past today's, ending on an empty future week that
  // pulled the trend test and CUSUM toward "down".
  it("buckets by Sunday-start week, ending at this week", () => {
    at(WED);
    const series = buildWeeklyImpedimentSeries([
      imp("a", "A", { raisedDate: "2026-10-04", resolvedDate: "2026-10-13", status: "Resolved" }),
      imp("b", "B", { raisedDate: "2026-10-14" }),
      imp("c", "C", { raisedDate: "2026-10-20" }),
    ]);
    // Weeks of 4, 11 and 18 Oct.
    expect(series.raisedPerWeek).toEqual([1, 1, 1]);
    expect(series.openAtWeek).toEqual([1, 1, 2]);
  });

  // Bug: "today" was the UTC day, so just after local midnight east of UTC a
  // Sunday's new impediment fell outside every bucket.
  it("counts today's impediments in this week, just after local midnight", () => {
    at(new Date(2026, 9, 18, 1, 0)); // Sunday 18 Oct, 01:00 local
    const series = buildWeeklyImpedimentSeries([
      imp("a", "A", { raisedDate: "2026-10-04" }),
      imp("b", "B", { raisedDate: "2026-10-18" }),
    ]);
    expect(series.raisedPerWeek).toEqual([1, 0, 1]);
    expect(series.openAtWeek).toEqual([1, 1, 2]);
  });

  it("keeps the most recent 26 weeks of a long-running tracker", () => {
    at(WED);
    const series = buildWeeklyImpedimentSeries([
      imp("old", "Old", { raisedDate: "2025-10-05" }),
      imp("new", "New", { raisedDate: "2026-10-21" }),
    ]);
    expect(series.raisedPerWeek).toHaveLength(26);
    // The old one was raised before the window: open throughout, never "raised".
    expect(series.raisedPerWeek.slice(0, 25).every((n) => n === 0)).toBe(true);
    expect(series.raisedPerWeek[25]).toBe(1);
    expect(series.openAtWeek[0]).toBe(1);
    expect(series.openAtWeek[25]).toBe(2);
  });
});

describe("impediment store", () => {
  it("adds newest first as Open, raised today; Resolved stamps today unless given a date", () => {
    at(WED);
    const s = useImpedimentStore.getState();
    s.addImpediment({
      title: "A",
      description: "",
      category: "Process",
      severity: "Low",
      raisedBy: "",
      assignedTo: "",
    });
    s.addImpediment({
      title: "B",
      description: "",
      category: "External",
      severity: "High",
      raisedBy: "",
      assignedTo: "",
    });
    expect(local().map((i) => [i.title, i.status, i.raisedDate])).toEqual([
      ["B", "Open", "2026-10-21"],
      ["A", "Open", "2026-10-21"],
    ]);
    const [b, a] = local();
    s.updateStatus(a.id, "Resolved");
    s.updateStatus(b.id, "Resolved", "2026-10-20");
    expect(byId(a.id)?.resolvedDate).toBe("2026-10-21");
    expect(byId(b.id)?.resolvedDate).toBe("2026-10-20");
    s.remove(a.id);
    expect(local().map((i) => i.title)).toEqual(["B"]);
    s.reset();
    expect(local()).toEqual([]);
  });

  it("imports a hand-off once, keeping its id", () => {
    const s = useImpedimentStore.getState();
    s.importImpediment(imp("x", "From retro"));
    s.importImpediment(imp("x", "Sent again"));
    expect(local().map((i) => [i.id, i.title])).toEqual([["x", "From retro"]]);
  });
});

describe("Impediment Tracker: dashboard and list", () => {
  it("shows an empty state with zeroed stats", () => {
    render(<ImpedimentsClient />);
    expect(
      screen.getByText('No impediments logged. Click "Log Impediment" to add one.')
    ).toBeInTheDocument();
    expect(stat("Total Open")).toBe("0");
    expect(stat("Escalated")).toBe("0");
    expect(stat("Avg Resolution")).toBe("0days");
    expect(screen.getByText("None open")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("counts open and escalated, averages resolution, and lists open ones by category", () => {
    at(WED);
    useImpedimentStore.setState({
      impediments: [
        imp("a", "No staging", { category: "Technical" }),
        imp("b", "Waiting on legal", { category: "Process" }),
        imp("c", "Vendor API down", { category: "Technical", status: "Escalated" }),
        imp("d", "Old one", {
          category: "External",
          status: "Resolved",
          raisedDate: "2026-10-01",
          resolvedDate: "2026-10-05",
        }),
        imp("e", "Older", {
          category: "External",
          status: "Resolved",
          raisedDate: "2026-10-02",
          resolvedDate: "2026-10-04",
        }),
      ],
    });
    render(<ImpedimentsClient />);
    expect(stat("Total Open")).toBe("2");
    expect(stat("Escalated")).toBe("1");
    expect(stat("Avg Resolution")).toBe("3days");
    const byCategory = screen.getByText("Open by Category").parentElement!;
    expect(byCategory).toHaveTextContent("Technical2");
    expect(byCategory).toHaveTextContent("Process1");
    // Resolved ones aren't open.
    expect(byCategory).not.toHaveTextContent("External");
    expect(screen.getByText("Showing 5 of 5 impediments")).toBeInTheDocument();
  });

  it("switches to the median with a CI once three are resolved", () => {
    useImpedimentStore.setState({
      impediments: [2, 4, 6].map((d, i) =>
        imp(`r${i}`, `R${i}`, {
          status: "Resolved",
          raisedDate: "2026-10-01",
          resolvedDate: `2026-10-0${1 + d}`,
        })
      ),
    });
    render(<ImpedimentsClient />);
    expect(screen.queryByText("Avg Resolution")).toBeNull();
    expect(screen.getByText("Median Resolution")).toBeInTheDocument();
    expect(screen.getByText(/95% CI \[/)).toBeInTheDocument();
  });

  it("sorts open before escalated before resolved, then by severity, then oldest first", () => {
    at(WED);
    useImpedimentStore.setState({
      impediments: [
        imp("1", "Resolved critical", { status: "Resolved", severity: "Critical" }),
        imp("2", "Escalated low", { status: "Escalated", severity: "Low" }),
        imp("3", "Open low", { severity: "Low" }),
        imp("4", "Open critical new", { severity: "Critical", raisedDate: "2026-10-20" }),
        imp("5", "Open critical old", { severity: "Critical", raisedDate: "2026-10-01" }),
        imp("6", "Open high", { severity: "High" }),
      ],
    });
    render(<ImpedimentsClient />);
    expect(listed()).toEqual([
      "Open critical old",
      "Open critical new",
      "Open high",
      "Open low",
      "Escalated low",
      "Resolved critical",
    ]);
    // Sorting must not reorder the store.
    expect(local().map((i) => i.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("filters by status, category and severity, and Clear shows everything again", () => {
    useImpedimentStore.setState({
      impediments: [
        imp("a", "No staging", { severity: "High" }),
        imp("b", "Waiting on legal", { category: "Process" }),
        imp("c", "Vendor API down", { status: "Escalated", severity: "High" }),
      ],
    });
    render(<ImpedimentsClient />);
    choose("Filter by severity", "High");
    expect(listed()).toEqual(["No staging", "Vendor API down"]);
    expect(screen.getByText("Showing 2 of 3 impediments")).toBeInTheDocument();
    choose("Filter by status", "Escalated");
    expect(listed()).toEqual(["Vendor API down"]);
    choose("Filter by category", "External");
    expect(listed()).toEqual([]);
    expect(screen.getByText("No impediments match the current filters.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(listed()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("Impediment Tracker: card actions", () => {
  it("escalates, sends back to open, and resolves with today's date", () => {
    at(WED);
    useImpedimentStore.setState({ impediments: [imp("a", "No staging")] });
    render(<ImpedimentsClient />);
    expect(screen.getByText("11d")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Escalate/ }));
    expect(byId("a")?.status).toBe("Escalated");
    expect(screen.queryByRole("button", { name: /Escalate/ })).toBeNull();

    choose("Status for No staging", "Open");
    expect(byId("a")?.status).toBe("Open");

    choose("Status for No staging", "Resolved");
    expect(byId("a")).toMatchObject({ status: "Resolved", resolvedDate: "2026-10-21" });
    expect(screen.getByText("Resolved 2026-10-21")).toBeInTheDocument();
    // No status controls or age once resolved.
    expect(screen.queryByRole("combobox", { name: "Status for No staging" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
    expect(screen.queryByText("11d")).toBeNull();
  });

  it("the Resolve button resolves, and Delete removes only that one", () => {
    at(WED);
    useImpedimentStore.setState({ impediments: [imp("a", "No staging"), imp("b", "Flaky CI")] });
    render(<ImpedimentsClient />);
    fireEvent.click(within(cardOf("Flaky CI")).getByRole("button", { name: /Resolve/ }));
    expect(byId("b")).toMatchObject({ status: "Resolved", resolvedDate: "2026-10-21" });
    expect(byId("a")?.status).toBe("Open");

    fireEvent.click(screen.getByRole("button", { name: "Delete No staging" }));
    expect(local().map((i) => i.id)).toEqual(["b"]);
  });

  it("Reset clears the tracker", () => {
    useImpedimentStore.setState({ impediments: [imp("a", "No staging")] });
    render(<ImpedimentsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(local()).toEqual([]);
    expect(
      screen.getByText('No impediments logged. Click "Log Impediment" to add one.')
    ).toBeInTheDocument();
  });
});

/** The card holding `title`: its Delete button sits in the card's top row. */
function cardOf(title: string): HTMLElement {
  return screen.getByRole("button", { name: `Delete ${title}` }).parentElement!.parentElement!;
}

describe("Impediment Tracker: log form", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Log Impediment" }));
  // While the form is open, its submit button is the only "Log Impediment".
  const submit = () => screen.getByRole("button", { name: "Log Impediment" });

  it("can't log without a title", () => {
    render(<ImpedimentsClient />);
    open();
    const button = screen.getByRole("button", { name: "Log Impediment" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "   " } });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(local()).toEqual([]);
  });

  // Bug: the title (and names) were stored as typed, spaces and all, though
  // the form checks and logs the trimmed title.
  it("logs a trimmed impediment with the chosen category and severity", () => {
    at(WED);
    render(<ImpedimentsClient />);
    open();
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "  Flaky CI  " } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Fails one run in five" },
    });
    choose("Category", "Process");
    choose("Severity", "Critical");
    fireEvent.change(screen.getByLabelText("Raised By"), { target: { value: " Ana " } });
    fireEvent.change(screen.getByLabelText("Assigned To"), { target: { value: " Sam " } });
    fireEvent.change(screen.getByLabelText("Expected Resolution (days)"), {
      target: { value: "4" },
    });
    fireEvent.click(submit());

    expect(local()).toHaveLength(1);
    expect(local()[0]).toMatchObject({
      title: "Flaky CI",
      description: "Fails one run in five",
      category: "Process",
      severity: "Critical",
      raisedBy: "Ana",
      assignedTo: "Sam",
      expectedResolutionDays: 4,
      status: "Open",
      raisedDate: "2026-10-21",
    });
    // The form closes and the list shows it.
    expect(screen.queryByLabelText("Title *")).toBeNull();
    expect(listed()).toEqual(["Flaky CI"]);
    // Mirrored into the workspace with the trimmed owner.
    expect(shared()).toEqual([
      expect.objectContaining({ title: "Flaky CI", severity: "critical", owner: "Sam" }),
    ]);
  });

  it("keeps expected days between 1 and 3650, and blank means not set", () => {
    render(<ImpedimentsClient />);
    open();
    const days = screen.getByLabelText("Expected Resolution (days)");
    fireEvent.change(days, { target: { value: "0" } });
    expect(days).toHaveValue(1);
    fireEvent.change(days, { target: { value: "99999" } });
    expect(days).toHaveValue(3650);
    fireEvent.change(days, { target: { value: "" } });
    expect(days).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "No staging" } });
    fireEvent.click(submit());
    expect(local()[0].expectedResolutionDays).toBeUndefined();
  });

  it("Cancel discards the draft", () => {
    render(<ImpedimentsClient />);
    open();
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Half typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(local()).toEqual([]);
    open();
    expect(screen.getByLabelText("Title *")).toHaveValue("");
  });
});

describe("Impediment Tracker: workspace bridge", () => {
  it("mirrors local impediments and removes only the rows it owns", () => {
    useWorkspaceStore.setState({
      impediments: [
        { id: "other", title: "From elsewhere", severity: "low", raisedAt: "2026-10-01" },
      ],
    });
    useImpedimentStore.setState({
      impediments: [imp("a", "No staging", { severity: "High", assignedTo: "Sam" })],
    });
    render(<ImpedimentsClient />);
    expect(
      shared()
        .map((i) => i.id)
        .sort()
    ).toEqual(["a", "other"]);
    expect(shared().find((i) => i.id === "a")).toMatchObject({
      severity: "high",
      owner: "Sam",
      source: "manual",
    });

    fireEvent.click(screen.getByRole("button", { name: /Escalate/ }));
    fireEvent.click(screen.getByRole("button", { name: /Resolve/ }));
    expect(shared().find((i) => i.id === "a")?.resolvedAt).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete No staging" }));
    expect(shared().map((i) => i.id)).toEqual(["other"]);
  });
});
