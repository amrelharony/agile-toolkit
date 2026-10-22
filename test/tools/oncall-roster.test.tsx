import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OncallPage, OncallShift } from "@/lib/stores/workspace-types";

/**
 * On-call roster core: adding / removing shifts, the active-shift logic
 * (inclusive end day, newest start wins on hand-over days), logging and
 * removing pages, the KPI tiles, per-person stats, the weekly paging trend,
 * the expected-pages input and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const smart = vi.hoisted(() => ({ suggestion: 4 }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/components/shared/smart-input", () => ({
  SmartInput: ({
    onAccept,
    render,
  }: {
    onAccept: (v: number) => void;
    render: (api: {
      ghost?: string;
      accept: () => void;
      chip: ReactNode;
      isAccepting: boolean;
    }) => ReactNode;
  }) =>
    render({
      ghost: String(smart.suggestion),
      accept: () => onAccept(smart.suggestion),
      chip: <span>Suggested {smart.suggestion}</span>,
      isAccepting: false,
    }),
}));
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

import { OncallRosterClient } from "@/app/(tools)/oncall-roster/oncall-roster-client";

const OR_ID = "oncallRoster:current";
// Monday 19 Oct 2026, 12:00 local.
const NOW = new Date(2026, 9, 19, 12, 0);

const shift = (
  id: string,
  person: string,
  startDate: string,
  endDate: string,
  description?: string
): OncallShift => ({ id, person, startDate, endDate, ...(description ? { description } : {}) });

const page = (
  id: string,
  shiftId: string,
  ts: Date,
  severity: OncallPage["severity"] = "sev3",
  description?: string
): OncallPage => ({
  id,
  shiftId,
  ts: ts.toISOString(),
  severity,
  ...(description ? { description } : {}),
});

function seed(shifts: OncallShift[], pages: OncallPage[] = [], expectedPagesPerWeek?: number) {
  useWorkspaceStore.setState({
    oncallRosters: [{ id: OR_ID, shifts, pages, expectedPagesPerWeek }],
  });
}

const roster = () => (useWorkspaceStore.getState().oncallRosters ?? []).find((d) => d.id === OR_ID);

/** The value (and hint) of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  const value = tile.parentElement!.nextElementSibling as HTMLElement;
  return { value: value.textContent, hint: value.nextElementSibling?.textContent };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  smart.suggestion = 4;
  useWorkspaceStore.setState({ oncallRosters: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("On-call roster — empty state", () => {
  it("shows no coverage, zeroed KPIs and the empty message", () => {
    render(<OncallRosterClient />);
    expect(screen.getByRole("status")).toHaveTextContent(/No shifts yet\./);
    expect(kpi("Active shift")).toEqual({ value: "—", hint: "no coverage" });
    expect(kpi("Pages (30d)").value).toBe("0");
    expect(kpi("Avg pages / shift").value).toBe("0.0");
    expect(kpi("Top-paged person")).toEqual({ value: "—", hint: "no pages logged" });
    expect(screen.getByText(/No active shift covers right now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Log page/ })).toBeNull();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-19");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-10-19");
  });
});

describe("On-call roster — adding and removing shifts", () => {
  it("adds a trimmed shift and resets the form", () => {
    render(<OncallRosterClient />);
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "  @ana  " } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-18" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-24" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  Holiday cover  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add shift/ }));

    expect(roster()?.shifts).toEqual([
      expect.objectContaining({
        person: "@ana",
        startDate: "2026-10-18",
        endDate: "2026-10-24",
        description: "Holiday cover",
      }),
    ]);
    expect(screen.getByLabelText("Person")).toHaveValue("");
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-19");
    expect(
      screen.getByLabelText("Description (optional)", { selector: "#oc-shift-desc" })
    ).toHaveValue("");
    expect(kpi("Active shift")).toEqual({ value: "@ana", hint: "2026-10-18 → 2026-10-24" });
  });

  it("refuses a blank person, a missing date or an end before the start", () => {
    render(<OncallRosterClient />);
    const add = () => fireEvent.click(screen.getByRole("button", { name: /Add shift/ }));
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "   " } });
    add();
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "" } });
    add();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-19" } });
    add();
    expect(useWorkspaceStore.getState().oncallRosters).toEqual([]);

    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-20" } });
    add();
    expect(roster()?.shifts).toHaveLength(1);
  });

  it("removes a shift and cascades its pages only", () => {
    seed(
      [
        shift("a", "ana", "2026-10-12", "2026-10-18"),
        shift("b", "ben", "2026-10-19", "2026-10-25"),
      ],
      [page("pa", "a", new Date(2026, 9, 13, 3)), page("pb", "b", new Date(2026, 9, 19, 9))]
    );
    render(<OncallRosterClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove shift for ana" }));
    expect(roster()?.shifts.map((s) => s.id)).toEqual(["b"]);
    expect(roster()?.pages.map((p) => p.id)).toEqual(["pb"]);
  });
});

describe("On-call roster — active shift", () => {
  it("covers the whole end day and marks the shift ACTIVE", () => {
    seed([shift("a", "ana", "2026-10-13", "2026-10-19")]);
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59));
    render(<OncallRosterClient />);
    expect(kpi("Active shift").value).toBe("ana");
    expect(within(screen.getByTestId("shift-a")).getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText(/Page will be assigned to/)).toHaveTextContent(
      "Page will be assigned to ana (2026-10-13 → 2026-10-19)."
    );
  });

  it("hands over to the newest start on an overlapping day", () => {
    seed([
      shift("a", "ana", "2026-10-12", "2026-10-19"),
      shift("b", "ben", "2026-10-19", "2026-10-25"),
    ]);
    render(<OncallRosterClient />);
    expect(kpi("Active shift").value).toBe("ben");
    expect(within(screen.getByTestId("shift-a")).queryByText("ACTIVE")).toBeNull();
  });

  it("re-evaluates coverage every minute", () => {
    seed([shift("a", "ana", "2026-10-13", "2026-10-19")]);
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 30));
    render(<OncallRosterClient />);
    expect(kpi("Active shift").value).toBe("ana");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(kpi("Active shift")).toEqual({ value: "—", hint: "no coverage" });
    expect(screen.getByText(/No active shift covers right now/)).toBeInTheDocument();
  });

  it("does not count a future shift as active", () => {
    seed([shift("a", "ana", "2026-10-20", "2026-10-26")]);
    render(<OncallRosterClient />);
    expect(kpi("Active shift").value).toBe("—");
  });
});

describe("On-call roster — logging pages", () => {
  it("logs a page against the active shift at the current time and resets the form", () => {
    seed([shift("a", "ana", "2026-10-18", "2026-10-24")]);
    render(<OncallRosterClient />);
    const trigger = screen.getByRole("combobox", { name: "Severity" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "SEV-1" }));
    fireEvent.change(
      screen.getByLabelText("Description (optional)", { selector: "#oc-page-desc" }),
      {
        target: { value: "  Disk full  " },
      }
    );
    fireEvent.click(screen.getByRole("button", { name: /Log page/ }));

    expect(roster()?.pages).toEqual([
      expect.objectContaining({
        shiftId: "a",
        ts: NOW.toISOString(),
        severity: "sev1",
        description: "Disk full",
      }),
    ]);
    expect(screen.getByRole("combobox", { name: "Severity" })).toHaveTextContent("SEV-3");
    expect(
      screen.getByLabelText("Description (optional)", { selector: "#oc-page-desc" })
    ).toHaveValue("");
    expect(kpi("Pages (30d)").value).toBe("1");
    expect(kpi("Top-paged person")).toEqual({ value: "ana", hint: "1 pages" });
  });

  it("lists recent pages newest first and removes one", () => {
    seed(
      [shift("a", "ana", "2026-10-12", "2026-10-25")],
      [
        page("old", "a", new Date(2026, 9, 13, 3), "sev2", "Old one"),
        page("new", "a", new Date(2026, 9, 18, 3), "sev4", "New one"),
      ]
    );
    render(<OncallRosterClient />);
    const removeButtons = screen.getAllByRole("button", { name: "Remove page" });
    const items = removeButtons.map((b) => b.closest("li")!.textContent);
    expect(items[0]).toMatch(/SEV-4.*New one/);
    expect(items[1]).toMatch(/SEV-2.*Old one/);

    fireEvent.click(removeButtons[0]);
    expect(roster()?.pages.map((p) => p.id)).toEqual(["old"]);
  });

  it("keeps the 30 newest pages in the recent list", () => {
    seed(
      [shift("a", "ana", "2026-09-01", "2026-10-25")],
      Array.from({ length: 35 }, (_, i) => page(`p${i}`, "a", new Date(2026, 9, 18, 0, i)))
    );
    render(<OncallRosterClient />);
    expect(screen.getAllByRole("button", { name: "Remove page" })).toHaveLength(30);
  });
});

describe("On-call roster — KPIs and per-person stats", () => {
  it("counts pages in the last 30 days and averages pages per shift", () => {
    seed(
      [
        shift("a", "ana", "2026-09-01", "2026-09-14"),
        shift("b", "ben", "2026-10-12", "2026-10-25"),
      ],
      [
        page("old", "a", new Date(2026, 8, 5, 3)),
        page("p1", "b", new Date(2026, 9, 13, 3)),
        page("p2", "b", new Date(2026, 9, 14, 3)),
      ]
    );
    render(<OncallRosterClient />);
    expect(kpi("Pages (30d)").value).toBe("2");
    expect(kpi("Avg pages / shift").value).toBe("1.5");
    expect(kpi("Top-paged person")).toEqual({ value: "ben", hint: "2 pages" });
  });

  // Bug: with shifts but no pages, the first rostered person was named the
  // "Top-paged person" with "0 pages".
  it("names nobody as top-paged until someone has been paged", () => {
    seed([
      shift("a", "ana", "2026-10-12", "2026-10-18"),
      shift("b", "ben", "2026-10-19", "2026-10-25"),
    ]);
    render(<OncallRosterClient />);
    expect(kpi("Top-paged person")).toEqual({ value: "—", hint: "no pages logged" });
  });

  it("aggregates shifts per person, most-paged first", () => {
    seed(
      [
        shift("a1", "ana", "2026-10-01", "2026-10-07"), // 7 days, 1 page
        shift("b1", "ben", "2026-10-08", "2026-10-14"), // 7 days, 2 pages
        shift("a2", "ana", "2026-10-15", "2026-10-21"), // running: 15..19 = 5 days, 2 pages
      ],
      [
        page("1", "a1", new Date(2026, 9, 2, 3)),
        page("2", "b1", new Date(2026, 9, 9, 3)),
        page("3", "b1", new Date(2026, 9, 10, 3)),
        page("4", "a2", new Date(2026, 9, 16, 3)),
        page("5", "a2", new Date(2026, 9, 17, 3)),
      ]
    );
    render(<OncallRosterClient />);
    const table = screen.getByRole("table");
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((tr) =>
        within(tr)
          .getAllByRole("cell")
          .map((td) => td.textContent)
      );
    // ana: 3 pages over 2 shifts and 12 days → 1.50 / shift, 1.75 / 7 days.
    expect(rows).toEqual([
      ["ana", "2", "3", "1.50", "1.75"],
      ["ben", "1", "2", "2.00", "2.00"],
    ]);
    expect(screen.getByTestId("shift-a2")).toHaveTextContent("2.8 / 7 days");
  });
});

describe("On-call roster — weekly paging trend", () => {
  /** `n` pages on the Monday `weeksBack` weeks before this one (local). */
  const weekPages = (weeksBack: number, n: number) =>
    Array.from({ length: n }, (_, j) =>
      page(`w${weeksBack}-${j}`, "a", new Date(2026, 9, 19 - 7 * weeksBack, 1, j))
    );

  beforeEach(() => {
    vi.setSystemTime(NOW);
  });

  it("stays hidden with under five weeks of paging", () => {
    seed([shift("a", "ana", "2026-01-01", "2026-12-31")], [...weekPages(3, 2), ...weekPages(0, 2)]);
    render(<OncallRosterClient />);
    expect(screen.queryByText(/Weekly paging/)).toBeNull();
  });

  it("reads a flat rate since adoption as no change, ignoring weeks before the first page", () => {
    seed(
      [shift("a", "ana", "2026-01-01", "2026-12-31")],
      [7, 6, 5, 4, 3, 2, 1, 0].flatMap((w) => weekPages(w, 2))
    );
    render(<OncallRosterClient />);
    expect(screen.getByText("Weekly paging trend: no significant change")).toBeInTheDocument();
    expect(screen.queryByText(/detected \(CUSUM\)/)).toBeNull();
    expect(screen.getByText("Paging frequency by week")).toBeInTheDocument();
  });

  it("flags a steadily rising weekly count", () => {
    seed(
      [shift("a", "ana", "2026-01-01", "2026-12-31")],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].flatMap((w) => weekPages(w, 10 - w))
    );
    render(<OncallRosterClient />);
    expect(screen.getByText(/Weekly paging volume trending up significantly/)).toBeInTheDocument();
  });

  it("ignores pages older than the 26-week window", () => {
    seed([shift("a", "ana", "2025-01-01", "2026-12-31")], [...weekPages(40, 3)]);
    render(<OncallRosterClient />);
    expect(screen.queryByText("Paging frequency by week")).toBeNull();
    expect(screen.queryByText(/Weekly paging/)).toBeNull();
  });
});

describe("On-call roster — expected pages per week", () => {
  const input = () => screen.getByRole("spinbutton", { name: "Expected pages per week" });

  it("commits a typed value on blur and clears it back to unset", () => {
    render(<OncallRosterClient />);
    fireEvent.change(input(), { target: { value: "7" } });
    expect(roster()).toBeUndefined();
    fireEvent.blur(input());
    expect(roster()?.expectedPagesPerWeek).toBe(7);
    expect(screen.queryByText("Suggested 4")).toBeNull();

    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.blur(input());
    expect(roster()?.expectedPagesPerWeek).toBeUndefined();
    expect(screen.getByText("Suggested 4")).toBeInTheDocument();
  });

  it("accepts 0 as a real value", () => {
    render(<OncallRosterClient />);
    fireEvent.change(input(), { target: { value: "0" } });
    fireEvent.blur(input());
    expect(roster()?.expectedPagesPerWeek).toBe(0);
  });

  it("takes the suggestion on Tab in an empty field", () => {
    render(<OncallRosterClient />);
    expect(input()).toHaveAttribute("placeholder", "4");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(roster()?.expectedPagesPerWeek).toBe(4);
    expect(input()).toHaveValue(4);
  });

  it("shows a stored value and keeps the existing roster when it changes", () => {
    seed([shift("a", "ana", "2026-10-18", "2026-10-24")], [], 3);
    render(<OncallRosterClient />);
    expect(input()).toHaveValue(3);
    fireEvent.change(input(), { target: { value: "6" } });
    fireEvent.blur(input());
    expect(roster()?.expectedPagesPerWeek).toBe(6);
    expect(roster()?.shifts).toHaveLength(1);
  });

  // Bug: the field is min=0 (and the agent action rejects negatives), but a
  // typed negative number was committed as the expected paging load.
  it("refuses a negative value and restores the committed one", () => {
    seed([], [], 3);
    render(<OncallRosterClient />);
    fireEvent.change(input(), { target: { value: "-2" } });
    fireEvent.blur(input());
    expect(roster()?.expectedPagesPerWeek).toBe(3);
    expect(input()).toHaveValue(3);
  });
});

describe("On-call roster — export", () => {
  it("exports one CSV row per shift in start-date order with its page count", () => {
    seed(
      [
        shift("b", "ben", "2026-10-19", "2026-10-25"),
        shift("a", "ana", "2026-10-12", "2026-10-18", "Holiday cover"),
      ],
      [page("1", "a", new Date(2026, 9, 13, 3)), page("2", "a", new Date(2026, 9, 14, 3))]
    );
    render(<OncallRosterClient />);
    expect(exported.csv?.headers).toEqual(["Person", "Start", "End", "Pages", "Description"]);
    expect(exported.csv?.rows).toEqual([
      ["ana", "2026-10-12", "2026-10-18", 2, "Holiday cover"],
      ["ben", "2026-10-19", "2026-10-25", 0, ""],
    ]);
  });
});
