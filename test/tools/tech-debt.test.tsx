import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";

/**
 * Tech debt core: adding / editing / removing items, the priority ranking
 * (impact × 4 − effort + interest × age ÷ 2, resolved last), the KPI tiles,
 * the impact × effort heatmap, the interest-rate input, workspace import /
 * push, the resolution survival panel and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const smart = vi.hoisted(() => ({ suggestion: 0.5 }));
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
vi.mock("@/components/shared/workspace-sync-button", () => ({
  WorkspaceSyncButton: ({
    onImport,
    onPush,
  }: {
    onImport?: () => number | void;
    onPush?: () => number | void;
  }) => (
    <>
      <button type="button" onClick={() => onImport?.()}>
        Import from workspace
      </button>
      <button type="button" onClick={() => onPush?.()}>
        Push to workspace
      </button>
    </>
  ),
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
// undo wrapper: run the change immediately
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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

import { TechDebtClient } from "@/app/(tools)/tech-debt/tech-debt-client";

const KEY = "agile-toolkit:tech-debt";
// Monday 19 Oct 2026, 12:00 local.
const NOW = new Date(2026, 9, 19, 12, 0);

const item = (
  id: string,
  title: string,
  impact: number,
  effort: number,
  extra: Partial<TechDebtItem> = {}
): TechDebtItem => ({
  id,
  title,
  impact: impact as TechDebtItem["impact"],
  effort: effort as TechDebtItem["effort"],
  interestRate: 0,
  raisedAt: "2026-10-19",
  ...extra,
});

function seed(items: TechDebtItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as TechDebtItem[];

/** The value (and hint) of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  const value = tile.parentElement!.nextElementSibling as HTMLElement;
  return { value: value.textContent, hint: value.nextElementSibling?.textContent };
};

/** Heatmap cell text for impact row `imp`, effort column `eff`. */
const heat = (imp: number, eff: number) => {
  let cell: Element | null = screen.getByText(`I${imp}`);
  for (let k = 0; k < eff; k++) cell = cell!.nextElementSibling;
  return cell!.textContent;
};

/** Item titles in rank order (from the per-row remove buttons). */
const order = () =>
  screen
    .getAllByRole("button", { name: /^Remove debt item: / })
    .map((b) => b.getAttribute("aria-label")!.replace("Remove debt item: ", ""));

/** The row card for one item. */
const row = (title: string) =>
  screen
    .getByRole("button", { name: `Remove debt item: ${title}` })
    .closest(".rounded-xl") as HTMLElement;

const score = (title: string) =>
  (within(row(title)).getByText("Score").nextElementSibling as HTMLElement).textContent;

function choose(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  smart.suggestion = 0.5;
  localStorage.removeItem(KEY);
  useWorkspaceStore.setState({ techDebt: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Tech debt — empty state", () => {
  it("shows the empty message, zeroed KPIs and an empty heatmap", () => {
    render(<TechDebtClient />);
    expect(screen.getByRole("status")).toHaveTextContent("No debt logged.");
    expect(kpi("Open Items").value).toBe("0");
    expect(kpi("Interest/Sprint").value).toBe("0.0");
    expect(kpi("Top Hotspot")).toEqual({ value: "—", hint: "Add areas to items" });
    expect(heat(3, 3)).toBe("");
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Tech debt — adding, editing, removing", () => {
  it("adds a blank item on top with impact 3, effort 3, interest 1, raised today", () => {
    seed([item("old", "Old ORM", 2, 2)]);
    render(<TechDebtClient />);
    fireEvent.click(screen.getByRole("button", { name: /New Debt/ }));

    const [first, second] = stored();
    expect(first).toMatchObject({
      title: "",
      impact: 3,
      effort: 3,
      interestRate: 1,
      raisedAt: "2026-10-19",
    });
    expect(first.id).toHaveLength(8);
    expect(second.id).toBe("old");
    expect(kpi("Open Items").value).toBe("2");
    expect(kpi("Interest/Sprint").value).toBe("1.0");
    expect(heat(3, 3)).toBe("1");
  });

  it("commits title and area edits on blur and relabels the row", () => {
    seed([item("a", "", 3, 3)]);
    render(<TechDebtClient />);
    const title = screen.getByRole("textbox", { name: "Debt item" });
    fireEvent.change(title, { target: { value: "Flaky deploy script" } });
    expect(stored()[0].title).toBe("");
    fireEvent.blur(title);
    expect(stored()[0].title).toBe("Flaky deploy script");

    const area = screen.getByRole("textbox", { name: "Area for Flaky deploy script" });
    fireEvent.change(area, { target: { value: "CI" } });
    fireEvent.keyDown(area, { key: "Enter" });
    fireEvent.blur(area);
    expect(stored()[0].area).toBe("CI");
    expect(kpi("Top Hotspot")).toEqual({ value: "CI", hint: "3 impact points" });
  });

  it("changes impact and effort from the dropdowns and moves the heatmap cell", () => {
    seed([item("a", "Old ORM", 3, 3)]);
    render(<TechDebtClient />);
    choose(screen.getByRole("combobox", { name: "Impact for Old ORM" }), "Impact 5");
    choose(screen.getByRole("combobox", { name: "Effort for Old ORM" }), "Effort 1");
    expect(stored()[0]).toMatchObject({ impact: 5, effort: 1 });
    expect(heat(3, 3)).toBe("");
    expect(heat(5, 1)).toBe("1");
    expect(score("Old ORM")).toBe("19");
  });

  it("saves a description on blur and stores a blank one as undefined", () => {
    seed([item("a", "Old ORM", 3, 3)]);
    render(<TechDebtClient />);
    const desc = screen.getByRole("textbox", { name: "Description for Old ORM" });
    fireEvent.change(desc, { target: { value: "Blocks the Postgres 16 upgrade" } });
    fireEvent.blur(desc);
    expect(stored()[0].description).toBe("Blocks the Postgres 16 upgrade");
    fireEvent.change(desc, { target: { value: "   " } });
    fireEvent.blur(desc);
    expect(stored()[0].description).toBeUndefined();
  });

  it("removes the item locally and from the workspace", () => {
    seed([item("a", "Old ORM", 3, 3), item("b", "Flaky deploy", 4, 2)]);
    useWorkspaceStore.setState({ techDebt: [item("a", "Old ORM", 3, 3)] });
    render(<TechDebtClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove debt item: Old ORM" }));
    expect(stored().map((i) => i.id)).toEqual(["b"]);
    expect(useWorkspaceStore.getState().techDebt).toEqual([]);
  });

  it("reopens a resolved item", () => {
    seed([item("a", "Old ORM", 3, 3, { resolvedAt: "2026-10-10" })]);
    render(<TechDebtClient />);
    expect(screen.getByText("Resolved 2026-10-10")).toBeInTheDocument();
    expect(kpi("Open Items").value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Reopen debt item: Old ORM" }));
    expect(stored()[0].resolvedAt).toBeUndefined();
    expect(kpi("Open Items").value).toBe("1");
  });

  // Bug: an agent-resolved item carries a full ISO timestamp, and the row
  // showed its UTC date (slice(0, 10)) — a day off near local midnight.
  it("shows the local resolution day for a timestamped (agent) resolution", () => {
    const east = new Date(2026, 9, 19, 0, 30).getTimezoneOffset() < 0;
    const at = east ? new Date(2026, 9, 19, 0, 30) : new Date(2026, 9, 19, 23, 30);
    seed([item("a", "Old ORM", 3, 3, { resolvedAt: at.toISOString() })]);
    render(<TechDebtClient />);
    expect(screen.getByText("Resolved 2026-10-19")).toBeInTheDocument();
  });

  it("resolves with today's local date", () => {
    seed([item("a", "Old ORM", 3, 3)]);
    render(<TechDebtClient />);
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved: Old ORM" }));
    expect(stored()[0].resolvedAt).toBe("2026-10-19");
  });
});

describe("Tech debt — ranking", () => {
  it("ranks open items by impact × 4 − effort + interest × age ÷ 2, resolved last", () => {
    seed([
      item("a", "High impact", 5, 2), // 20 − 2 = 18
      item("b", "Compounding", 2, 1, { interestRate: 2, raisedAt: "2026-09-19" }), // 8 − 1 + 2·30/2 = 37
      item("c", "Cheap", 3, 1), // 11
      item("d", "Done", 5, 1, { resolvedAt: "2026-10-01" }), // 19 but resolved
    ]);
    render(<TechDebtClient />);
    expect(order()).toEqual(["Compounding", "High impact", "Cheap", "Done"]);
    expect(score("Compounding")).toBe("37");
    expect(score("High impact")).toBe("18");
    // Sorting doesn't reorder what is stored.
    expect(stored().map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("treats a missing or unparseable raised date as zero days old", () => {
    seed([
      item("a", "No date", 3, 1, { interestRate: 4, raisedAt: "" }),
      item("b", "Bad date", 3, 1, { interestRate: 4, raisedAt: "soon" }),
    ]);
    render(<TechDebtClient />);
    expect(score("No date")).toBe("11");
    expect(score("Bad date")).toBe("11");
  });

  // Bug: a YYYY-MM-DD raised date parsed as UTC midnight, so the age ran on
  // UTC days — an item raised today read −1 days old (and scored lower)
  // just after local midnight east of UTC, or a day old by evening west of it.
  it("ages an item raised today as 0 days, whatever the time of day", () => {
    const east = new Date(2026, 9, 19, 0, 30).getTimezoneOffset() < 0;
    vi.setSystemTime(east ? new Date(2026, 9, 19, 0, 30) : new Date(2026, 9, 19, 23, 30));
    seed([item("a", "Fresh", 3, 1, { interestRate: 2, raisedAt: "2026-10-19" })]);
    render(<TechDebtClient />);
    expect(exported.csv?.rows[0][6]).toBe(0);
    expect(score("Fresh")).toBe("11");
  });
});

describe("Tech debt — KPIs and heatmap", () => {
  it("sums interest over open items only", () => {
    seed([
      item("a", "A", 3, 3, { interestRate: 1.5 }),
      item("b", "B", 3, 3, { interestRate: 2 }),
      item("c", "C", 3, 3, { interestRate: 10, resolvedAt: "2026-10-01" }),
      item("d", "D", 3, 3, { interestRate: undefined }),
    ]);
    render(<TechDebtClient />);
    expect(kpi("Open Items").value).toBe("3");
    expect(kpi("Interest/Sprint").value).toBe("3.5");
  });

  it("names the area with the most open impact as the top hotspot", () => {
    seed([
      item("a", "A", 3, 3, { area: "Payments" }),
      item("b", "B", 2, 3, { area: "Payments" }),
      item("c", "C", 4, 3, { area: "Search" }),
    ]);
    render(<TechDebtClient />);
    expect(kpi("Top Hotspot")).toEqual({ value: "Payments", hint: "5 impact points" });
  });

  // Bug: resolved items still added their impact to their area, so paid-off
  // debt kept an area at the top of "Top Hotspot".
  it("leaves resolved items out of the top hotspot", () => {
    seed([
      item("a", "A", 5, 3, { area: "Payments", resolvedAt: "2026-10-01" }),
      item("b", "B", 5, 3, { area: "Payments", resolvedAt: "2026-10-02" }),
      item("c", "C", 4, 3, { area: "Search" }),
    ]);
    render(<TechDebtClient />);
    expect(kpi("Top Hotspot")).toEqual({ value: "Search", hint: "4 impact points" });
  });

  it("counts open items per impact × effort cell, clamping odd stored values", () => {
    seed([
      item("a", "A", 5, 1),
      item("b", "B", 5, 1),
      item("c", "C", 5, 1, { resolvedAt: "2026-10-01" }),
      item("d", "D", 2.5, 9), // rounds to impact 3, clamps to effort 5
      item("e", "E", 3, 0), // clamps to effort 1
    ]);
    render(<TechDebtClient />);
    expect(heat(5, 1)).toBe("2");
    expect(heat(3, 5)).toBe("1");
    expect(heat(3, 1)).toBe("1");
  });
});

describe("Tech debt — interest rate input", () => {
  const field = (title: string) =>
    screen.getByRole("spinbutton", { name: `Interest per sprint for ${title}` });

  it("commits a typed rate on blur, and a cleared field as 0", () => {
    seed([item("a", "Old ORM", 3, 3, { interestRate: 1 })]);
    render(<TechDebtClient />);
    expect(field("Old ORM")).toHaveValue(1);
    fireEvent.change(field("Old ORM"), { target: { value: "2.5" } });
    fireEvent.blur(field("Old ORM"));
    expect(stored()[0].interestRate).toBe(2.5);
    expect(kpi("Interest/Sprint").value).toBe("2.5");

    fireEvent.change(field("Old ORM"), { target: { value: "" } });
    fireEvent.blur(field("Old ORM"));
    expect(stored()[0].interestRate).toBe(0);
    expect(screen.getByText("Suggested 0.5")).toBeInTheDocument();
  });

  it("takes the suggestion on Tab in an empty field", () => {
    seed([item("a", "Old ORM", 3, 3, { interestRate: 0 })]);
    render(<TechDebtClient />);
    expect(field("Old ORM")).toHaveValue(null);
    expect(field("Old ORM")).toHaveAttribute("placeholder", "0.5");
    fireEvent.keyDown(field("Old ORM"), { key: "Tab" });
    expect(stored()[0].interestRate).toBe(0.5);
    expect(field("Old ORM")).toHaveValue(0.5);
  });
});

describe("Tech debt — workspace sync", () => {
  it("imports workspace items: replaces matching ids in place and puts new ones first", () => {
    seed([item("a", "Local A", 2, 2), item("b", "Local B", 2, 2)]);
    useWorkspaceStore.setState({
      techDebt: [item("b", "Workspace B", 4, 1), item("w", "Workspace only", 3, 3)],
    });
    render(<TechDebtClient />);
    fireEvent.click(screen.getByRole("button", { name: "Import from workspace" }));
    expect(stored().map((i) => [i.id, i.title])).toEqual([
      ["w", "Workspace only"],
      ["a", "Local A"],
      ["b", "Workspace B"],
    ]);
  });

  it("pushes only titled items to the workspace", () => {
    seed([item("a", "Old ORM", 2, 2), item("blank", "   ", 2, 2)]);
    render(<TechDebtClient />);
    fireEvent.click(screen.getByRole("button", { name: "Push to workspace" }));
    expect(useWorkspaceStore.getState().techDebt.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("Tech debt — resolution survival", () => {
  const resolvedAfter = (id: string, days: number) =>
    item(id, `R${id}`, 3, 3, {
      raisedAt: "2026-09-01",
      resolvedAt: `2026-09-${String(1 + days).padStart(2, "0")}`,
    });

  it("needs four resolved items", () => {
    seed([resolvedAfter("1", 2), resolvedAfter("2", 4), resolvedAfter("3", 6)]);
    render(<TechDebtClient />);
    expect(screen.queryByText("Resolution survival curve")).toBeNull();
  });

  it("shows the median days to resolve over the resolved items", () => {
    seed([
      resolvedAfter("1", 2),
      resolvedAfter("2", 4),
      resolvedAfter("3", 6),
      resolvedAfter("4", 8),
    ]);
    render(<TechDebtClient />);
    expect(screen.getByText("Resolution survival curve")).toBeInTheDocument();
    expect(screen.getByText(/Median 4d · 95% CI \[\d+, \d+\]/)).toBeInTheDocument();
    expect(
      screen.getByText(/Kaplan-Meier estimate over 4 resolved item\s*s\./)
    ).toBeInTheDocument();
  });
});

describe("Tech debt — export", () => {
  it("exports the ranked items with age and score", () => {
    seed([
      item("a", "High impact", 5, 2, { area: "API", description: "slow" }),
      item("b", "Compounding", 2, 1, { interestRate: 2, raisedAt: "2026-09-19" }),
    ]);
    render(<TechDebtClient />);
    expect(exported.csv?.headers).toEqual([
      "Title",
      "Description",
      "Area",
      "Impact",
      "Effort",
      "Interest/Sprint",
      "Age (d)",
      "Score",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Compounding", "", "", 2, 1, 2, 30, "37.0"],
      ["High impact", "slow", "API", 5, 2, 0, 0, "18.0"],
    ]);
  });
});
