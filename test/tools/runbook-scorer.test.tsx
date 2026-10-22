import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Runbook, ScoreValue } from "@/lib/stores/workspace-types";

/**
 * Runbook scorer core: adding / removing runbooks, the hygiene index and KPI
 * tiles, sorting, the tested toggle, the per-runbook editor (sliders,
 * description, review date → suggested freshness), the trend chip and the
 * CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
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
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { RunbookScorerClient } from "@/app/(tools)/runbook-scorer/runbook-scorer-client";

const RS_ID = "runbookScorer:current";

const rb = (
  id: string,
  name: string,
  freshness: number,
  completeness: number,
  testedRecently: boolean,
  extra: Partial<Runbook> = {}
): Runbook => ({
  id,
  name,
  freshness: freshness as ScoreValue,
  completeness: completeness as ScoreValue,
  testedRecently,
  ...extra,
});

function seed(runbooks: Runbook[]) {
  useWorkspaceStore.setState({ runbookScorers: [{ id: RS_ID, runbooks }] });
}

const runbooks = () =>
  (useWorkspaceStore.getState().runbookScorers ?? []).find((d) => d.id === RS_ID)?.runbooks ?? [];

/** The value of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  return (tile.parentElement!.nextElementSibling as HTMLElement).textContent;
};

/** Runbook names in table order. */
const tableOrder = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelector("td")!.textContent);

function setReviewed(date: string) {
  const input = screen.getByLabelText("Last reviewed");
  fireEvent.change(input, { target: { value: date } });
  fireEvent.blur(input);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12));
  exported.csv = undefined;
  useWorkspaceStore.setState({ runbookScorers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Runbook scorer — empty state", () => {
  it("shows the empty message and neutral KPIs", () => {
    render(<RunbookScorerClient />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No runbooks yet. Add one above to start scoring hygiene."
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(kpi("Runbooks")).toBe("0");
    expect(kpi("Avg hygiene")).toBe("—");
    expect(kpi("Stale (freshness <3)")).toBe("0");
    expect(kpi("Untested")).toBe("0");
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Runbook scorer — adding", () => {
  it("adds a trimmed runbook with default scores, newest first, and clears the form", () => {
    seed([rb("old", "Old one", 4, 4, true)]);
    render(<RunbookScorerClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  DB failover  " } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "  Ana " } });
    fireEvent.change(screen.getAllByLabelText("Description (optional)")[0], {
      target: { value: "  Primary → replica  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add runbook/ }));

    expect(runbooks()).toHaveLength(2);
    expect(runbooks()[0]).toMatchObject({
      name: "DB failover",
      owner: "Ana",
      description: "Primary → replica",
      freshness: 3,
      completeness: 3,
      testedRecently: false,
    });
    expect(runbooks()[0].lastReviewedAt).toBeUndefined();
    expect(runbooks()[1].id).toBe("old");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Owner")).toHaveValue("");
    expect(screen.getAllByLabelText("Description (optional)")[0]).toHaveValue("");
  });

  it("stores a blank owner and description as undefined", () => {
    render(<RunbookScorerClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cache purge" } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Add runbook/ }));
    expect(runbooks()[0].owner).toBeUndefined();
    expect(runbooks()[0].description).toBeUndefined();
    // The table shows a dash for a missing owner.
    expect(within(screen.getByRole("table")).getAllByRole("cell")[1]).toHaveTextContent("—");
  });

  it("adds on Enter in the name field", () => {
    render(<RunbookScorerClient />);
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Deploy rollback" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(runbooks().map((r) => r.name)).toEqual(["Deploy rollback"]);
  });

  it("ignores a blank or whitespace name", () => {
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add runbook/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Add runbook/ }));
    expect(useWorkspaceStore.getState().runbookScorers).toEqual([]);
  });
});

describe("Runbook scorer — hygiene and KPIs", () => {
  it("averages (freshness + completeness + tested 5 / untested 1) / 3", () => {
    seed([
      rb("a", "Perfect", 5, 5, true), // 5.00
      rb("b", "Neglected", 1, 1, false), // 1.00
      rb("c", "Middling", 2, 4, true), // 3.67
    ]);
    render(<RunbookScorerClient />);
    expect(kpi("Runbooks")).toBe("3");
    expect(kpi("Avg hygiene")).toBe("3.22");
    expect(kpi("Stale (freshness <3)")).toBe("2");
    expect(kpi("Untested")).toBe("1");

    const table = within(screen.getByRole("table"));
    expect(table.getByText("5.00")).toBeInTheDocument();
    expect(table.getByText("1.00")).toBeInTheDocument();
    expect(table.getByText("3.67")).toBeInTheDocument();
    expect(screen.getByText("Hygiene 3.67")).toBeInTheDocument();
  });

  it("counts freshness 3 as not stale", () => {
    seed([rb("a", "Edge", 3, 1, true)]);
    render(<RunbookScorerClient />);
    expect(kpi("Stale (freshness <3)")).toBe("0");
    expect(kpi("Untested")).toBe("0");
  });
});

describe("Runbook scorer — sorting", () => {
  beforeEach(() =>
    seed([
      rb("b", "Bravo", 4, 4, true), // 4.33
      rb("a", "Alpha", 1, 2, false), // 1.33
      rb("c", "Charlie", 3, 5, false), // 3.00
    ])
  );

  it("lists worst hygiene first by default", () => {
    render(<RunbookScorerClient />);
    expect(tableOrder()).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(
      screen.getByRole("button", { name: "Sort by hygiene (asc)" }).closest("th")
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("flips direction on a second click of the active column", () => {
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by hygiene (asc)" }));
    expect(tableOrder()).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(
      screen.getByRole("button", { name: "Sort by hygiene (desc)" }).closest("th")
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts by name and by freshness, starting ascending", () => {
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by name (asc)" }));
    expect(tableOrder()).toEqual(["Alpha", "Bravo", "Charlie"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by name (asc)" }));
    expect(tableOrder()).toEqual(["Charlie", "Bravo", "Alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by freshness (asc)" }));
    expect(tableOrder()).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(
      screen.getByRole("button", { name: "Sort by name (asc)" }).closest("th")
    ).not.toHaveAttribute("aria-sort");
  });

  it("does not reorder the stored runbooks", () => {
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by name (asc)" }));
    expect(runbooks().map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});

describe("Runbook scorer — editing and removing", () => {
  it("toggles tested-recently from the table and re-scores", () => {
    seed([rb("a", "DB failover", 3, 3, false)]);
    render(<RunbookScorerClient />);
    expect(screen.getByText("Hygiene 2.33")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch", { name: "Tested recently for DB failover" })[0]);
    expect(runbooks()[0].testedRecently).toBe(true);
    expect(screen.getByText("Hygiene 3.67")).toBeInTheDocument();
    expect(kpi("Untested")).toBe("0");
  });

  it("removes only the runbook whose button was clicked", () => {
    seed([rb("a", "Alpha", 3, 3, false), rb("b", "Bravo", 3, 3, false)]);
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bravo" }));
    expect(runbooks().map((r) => r.id)).toEqual(["a"]);
    expect(screen.queryByText("Bravo")).toBeNull();
  });

  it("returns to the empty state once the last runbook is removed", () => {
    seed([rb("a", "Alpha", 3, 3, false)]);
    render(<RunbookScorerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(runbooks()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent(/No runbooks yet/);
  });

  it("moves completeness with the slider and keeps it within 1..5", () => {
    seed([rb("a", "Alpha", 3, 5, false)]);
    render(<RunbookScorerClient />);
    const slider = screen.getByRole("slider", { name: "Completeness for Alpha" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(runbooks()[0].completeness).toBe(5);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(runbooks()[0].completeness).toBe(1);
    expect(screen.getByText("Completeness (1 / 5)")).toBeInTheDocument();
  });

  it("saves a trimmed description on blur and clears it to undefined", () => {
    seed([rb("a", "Alpha", 3, 3, false)]);
    render(<RunbookScorerClient />);
    const desc = screen.getAllByLabelText("Description (optional)")[1];
    fireEvent.change(desc, { target: { value: "  Run from the bastion  " } });
    expect(runbooks()[0].description).toBeUndefined(); // not until blur
    fireEvent.blur(desc);
    expect(runbooks()[0].description).toBe("Run from the bastion");

    fireEvent.change(desc, { target: { value: "" } });
    fireEvent.blur(desc);
    expect(runbooks()[0].description).toBeUndefined();
  });

  it("shows the owner in the editor header", () => {
    seed([rb("a", "Alpha", 3, 3, false, { owner: "SRE" })]);
    render(<RunbookScorerClient />);
    expect(within(screen.getByRole("table")).getByText("SRE")).toBeInTheDocument();
    expect(screen.getAllByText("SRE")).toHaveLength(2);
  });
});

describe("Runbook scorer — review date and suggested freshness", () => {
  beforeEach(() => seed([rb("a", "Alpha", 3, 3, false)]));

  it.each([
    ["2026-09-19", 30, 5],
    ["2026-09-18", 31, 4],
    ["2026-07-21", 90, 4],
    ["2026-07-20", 91, 3],
    ["2026-04-22", 180, 3],
    ["2026-04-21", 181, 2],
    ["2025-10-19", 365, 2],
    ["2025-10-18", 366, 1],
  ])("a review on %s (%i days ago) suggests freshness %i", (date, days, freshness) => {
    render(<RunbookScorerClient />);
    setReviewed(date);
    expect(runbooks()[0].freshness).toBe(freshness);
    expect(screen.getByRole("slider", { name: "Freshness for Alpha" })).toHaveAccessibleDescription(
      `Suggested ${freshness} from Last reviewed ${days} days ago. Move the slider to override.`
    );
  });

  it("says 'day' for a one-day-old review", () => {
    render(<RunbookScorerClient />);
    setReviewed("2026-10-18");
    expect(screen.getByRole("slider", { name: "Freshness for Alpha" })).toHaveAccessibleDescription(
      "Suggested 5 from Last reviewed 1 day ago. Move the slider to override."
    );
  });

  it("treats a future review date as reviewed today", () => {
    render(<RunbookScorerClient />);
    setReviewed("2026-12-01");
    expect(runbooks()[0].freshness).toBe(5);
    expect(screen.getByRole("slider", { name: "Freshness for Alpha" })).toHaveAccessibleDescription(
      "Suggested 5 from Last reviewed 0 days ago. Move the slider to override."
    );
  });

  it("clears the review date without touching freshness", () => {
    seed([rb("a", "Alpha", 2, 3, false, { lastReviewedAt: "2026-01-01" })]);
    render(<RunbookScorerClient />);
    setReviewed("");
    expect(runbooks()[0].lastReviewedAt).toBeUndefined();
    expect(runbooks()[0].freshness).toBe(2);
    expect(screen.getByText("Set Last reviewed to get a suggested freshness.")).toBeInTheDocument();
  });

  it("does not re-derive freshness when the date is unchanged on blur", () => {
    seed([rb("a", "Alpha", 2, 3, false, { lastReviewedAt: "2026-10-18" })]);
    render(<RunbookScorerClient />);
    fireEvent.blur(screen.getByLabelText("Last reviewed"));
    // The suggestion would be 5; the user's slider choice of 2 stands.
    expect(runbooks()[0].freshness).toBe(2);
  });

  it("shows the review date in the table", () => {
    render(<RunbookScorerClient />);
    setReviewed("2026-10-01");
    expect(within(screen.getByRole("table")).getByText("2026-10-01")).toBeInTheDocument();
  });
});

describe("Runbook scorer — hygiene trend chip", () => {
  const reviewed = (scores: [number, number, boolean][]) =>
    scores.map(([f, c, t], i) =>
      rb(`r${i}`, `RB ${i}`, f, c, t, {
        lastReviewedAt: `2026-0${Math.floor(i / 9) + 1}-${String((i % 9) + 10)}`,
      })
    );

  it("stays hidden below ten reviewed runbooks", () => {
    seed(
      reviewed([
        [1, 1, false],
        [2, 2, false],
        [3, 3, false],
        [4, 4, false],
        [5, 5, true],
      ])
    );
    render(<RunbookScorerClient />);
    expect(screen.queryByText(/hygiene index trending/)).toBeNull();
  });

  it("shows an upward chip when hygiene climbs with each review", () => {
    seed(
      reviewed([
        [1, 1, false],
        [1, 2, false],
        [2, 2, false],
        [2, 3, false],
        [3, 3, false],
        [3, 4, false],
        [4, 4, false],
        [4, 5, false],
        [5, 5, false],
        [5, 5, true],
      ])
    );
    render(<RunbookScorerClient />);
    const chip = screen.getByText(/hygiene index trending/);
    expect(chip).toHaveTextContent("↗ hygiene index trending");
    expect(chip.getAttribute("title")).toMatch(/across 10 reviewed runbooks$/);
  });

  it("orders by review date, not by list position", () => {
    // Same climbing scores, stored newest-review-first.
    seed(
      reviewed([
        [1, 1, false],
        [1, 2, false],
        [2, 2, false],
        [2, 3, false],
        [3, 3, false],
        [3, 4, false],
        [4, 4, false],
        [4, 5, false],
        [5, 5, false],
        [5, 5, true],
      ]).reverse()
    );
    render(<RunbookScorerClient />);
    expect(screen.getByText(/hygiene index trending/)).toHaveTextContent("↗");
  });
});

describe("Runbook scorer — export", () => {
  it("exports one CSV row per runbook with its hygiene", () => {
    seed([
      rb("a", "Alpha", 5, 4, true, {
        owner: "SRE",
        lastReviewedAt: "2026-10-01",
        description: "notes",
      }),
      rb("b", "Bravo", 1, 2, false),
    ]);
    render(<RunbookScorerClient />);
    expect(exported.csv?.headers).toEqual([
      "Runbook",
      "Owner",
      "Freshness",
      "Completeness",
      "Tested recently",
      "Last reviewed",
      "Hygiene",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Alpha", "SRE", 5, 4, "yes", "2026-10-01", "4.67", "notes"],
      ["Bravo", "", 1, 2, "no", "", "1.33", ""],
    ]);
  });
});
