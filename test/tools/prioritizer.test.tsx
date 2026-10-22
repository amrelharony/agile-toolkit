import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";

/**
 * Backlog Prioritizer core: the example backlog, the score helpers, the
 * editable items table (numeric cells, selects, text), the MoSCoW / WSJF /
 * RICE / matrix tabs and the CSV export. The shared-backlog hub behaviour
 * (no seed, example load/clear, All methods tab, rename + undo) is in
 * prioritizer-hub.test.tsx.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = p.csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// undo wrapper: run the change immediately
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { PrioritizerClient } from "@/app/(tools)/prioritizer/prioritizer-client";
import { buildExample, isExampleBacklogId } from "@/app/(tools)/prioritizer/example";
import { matrixQuadrant, riceScore, wsjfScore } from "@/app/(tools)/prioritizer/scoring";
import { createDefaultItem, MOSCOW_CONFIG } from "@/app/(tools)/prioritizer/constants";
import { IMPACT_VALUES } from "@/app/(tools)/prioritizer/types";
import { usePrioritizerStore } from "@/app/(tools)/prioritizer/use-prioritizer-store";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";

const backlogItem = (
  id: string,
  name: string,
  partial: Partial<BacklogItem> = {}
): BacklogItem => ({
  id,
  name,
  moscow: "should",
  businessValue: 5,
  timeCriticality: 5,
  riskReduction: 5,
  jobSize: 5,
  reach: 100,
  impact: 1,
  confidence: 80,
  effort: 1,
  value: 5,
  matrixEffort: 5,
  ...partial,
});

const items = () => useWorkspaceStore.getState().backlogItems ?? [];
const stored = (id: string) => items().find((i) => i.id === id)!;
const openTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

function commit(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

function choose(triggerName: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: triggerName }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

const panel = () => within(screen.getByRole("tabpanel"));

/** [rank, name, score] for each row of the open tab's ranked table. */
function rankedRows() {
  return within(panel().getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((tr) => {
      const cells = within(tr).getAllByRole("cell");
      return [
        cells[0].textContent,
        cells[1].firstChild?.textContent,
        cells[cells.length - 1].textContent,
      ];
    });
}

beforeEach(() => {
  exported.csv = undefined;
  window.history.replaceState({}, "", "/prioritizer");
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("Prioritizer: score helpers", () => {
  it("WSJF is (value + time criticality + risk reduction) ÷ job size, to 2 decimals", () => {
    expect(
      wsjfScore(
        backlogItem("a", "A", {
          businessValue: 9,
          timeCriticality: 8,
          riskReduction: 7,
          jobSize: 3,
        })
      )
    ).toBe(8);
    expect(wsjfScore(backlogItem("a", "A", { jobSize: 9 }))).toBe(1.67);
    // A job size below 1 counts as 1 instead of inflating (or dividing by 0).
    expect(wsjfScore(backlogItem("a", "A", { jobSize: 0 }))).toBe(15);
    expect(wsjfScore(backlogItem("a", "A", { jobSize: -4 }))).toBe(15);
  });

  it("RICE is reach × impact × confidence% ÷ effort, to 1 decimal", () => {
    expect(
      riceScore(backlogItem("a", "A", { reach: 500, impact: 2, confidence: 90, effort: 2 }))
    ).toBe(450);
    expect(
      riceScore(backlogItem("a", "A", { reach: 4000, impact: 2, confidence: 80, effort: 3 }))
    ).toBe(2133.3);
    // Effort is floored at 0.1 person-months.
    expect(
      riceScore(backlogItem("a", "A", { reach: 10, impact: 1, confidence: 100, effort: 0 }))
    ).toBe(100);
  });

  it("RICE treats a legacy row's missing input as 0 (effort 1) instead of NaN", () => {
    const legacy = { ...backlogItem("a", "A"), reach: undefined } as unknown as BacklogItem;
    expect(riceScore(legacy)).toBe(0);
    const noEffort = { ...backlogItem("a", "A"), effort: Number.NaN };
    expect(riceScore(noEffort)).toBe(80);
  });

  it("puts value above 5 high and effort of 5 or less low", () => {
    expect(matrixQuadrant(6, 5)).toBe("Quick Wins");
    expect(matrixQuadrant(6, 6)).toBe("Major Projects");
    expect(matrixQuadrant(5, 5)).toBe("Fill-ins");
    expect(matrixQuadrant(5, 6)).toBe("Time Sinks");
    expect(matrixQuadrant(10, 1)).toBe("Quick Wins");
    expect(matrixQuadrant(1, 10)).toBe("Time Sinks");
  });
});

describe("Prioritizer: defaults and the example", () => {
  it("a new item is 'New Item' with mid defaults and a fresh id", () => {
    const a = createDefaultItem();
    const b = createDefaultItem();
    expect(a).toMatchObject({
      name: "New Item",
      moscow: "should",
      businessValue: 5,
      value: 5,
      matrixEffort: 5,
      effort: 1,
      impact: 1,
    });
    expect(a.id).not.toBe(b.id);
    expect(isExampleBacklogId(a.id)).toBe(false);
  });

  it("has a label for every MoSCoW bucket", () => {
    expect(Object.values(MOSCOW_CONFIG).map((c) => c.label)).toEqual([
      "Must Have",
      "Should Have",
      "Could Have",
      "Won't Have",
    ]);
  });

  it("recognises example ids and the legacy seed only", () => {
    expect(isExampleBacklogId("example-backlog-rebuild")).toBe(true);
    expect(isExampleBacklogId("default:item-auth")).toBe(true);
    expect(isExampleBacklogId("default:role-po")).toBe(false);
    expect(isExampleBacklogId("my-example-item")).toBe(false);
    expect(isExampleBacklogId(undefined)).toBe(false);
    expect(isExampleBacklogId(null)).toBe(false);
    expect(isExampleBacklogId("")).toBe(false);
  });

  it("builds a valid backlog whose matrix value matches business value", () => {
    const rows = buildExample();
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.value).toBe(r.businessValue);
      expect(IMPACT_VALUES).toContain(r.impact);
      for (const k of [
        "businessValue",
        "timeCriticality",
        "riskReduction",
        "jobSize",
        "matrixEffort",
      ] as const) {
        expect(r[k]).toBeGreaterThanOrEqual(1);
        expect(r[k]).toBeLessThanOrEqual(10);
      }
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("makes the methods disagree, as its comment promises", () => {
    const rows = buildExample();
    const byWsjf = [...rows].sort((a, b) => wsjfScore(b) - wsjfScore(a)).map((r) => r.id);
    const byReach = [...rows].sort((a, b) => b.reach - a.reach).map((r) => r.id);
    // The card-declined fix wins WSJF and is a quick win on the matrix...
    expect(byWsjf[0]).toBe("example-backlog-declined");
    const declined = rows.find((r) => r.id === "example-backlog-declined")!;
    expect(matrixQuadrant(declined.value, declined.matrixEffort)).toBe("Quick Wins");
    // ...while the rebuild is a Must with the most reach, yet near the bottom on WSJF.
    expect(byReach[0]).toBe("example-backlog-rebuild");
    expect(rows.find((r) => r.id === "example-backlog-rebuild")?.moscow).toBe("must");
    expect(byWsjf.indexOf("example-backlog-rebuild")).toBeGreaterThanOrEqual(rows.length - 3);
  });

  it("loading again only re-adds missing example rows, keeping edits and user rows", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("mine", "My item")] });
    const { result } = renderHook(() => usePrioritizerStore());
    act(() => result.current.loadExample());
    expect(items()).toHaveLength(buildExample().length + 1);

    act(() => result.current.updateItem("example-backlog-guest", { businessValue: 2 }));
    useWorkspaceStore.setState({
      backlogItems: items().filter((i) => i.id !== "example-backlog-ar"),
    });
    act(() => result.current.loadExample());
    expect(items()).toHaveLength(buildExample().length + 1);
    expect(new Set(items().map((i) => i.id)).size).toBe(items().length);
    expect(stored("example-backlog-guest").businessValue).toBe(2);

    act(() => result.current.clearExample());
    expect(items().map((i) => i.id)).toEqual(["mine"]);
  });

  it("updating an unknown id writes nothing", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("b1", "Auth")] });
    const before = items();
    const { result } = renderHook(() => usePrioritizerStore());
    act(() => result.current.updateItem("nope", { name: "Ghost" }));
    expect(items()).toBe(before);
  });
});

describe("Prioritizer: the items table", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      backlogItems: [
        backlogItem("b1", "Auth"),
        backlogItem("b2", "Search", { businessValue: 10, value: 10 }),
      ],
    });
  });

  it("Add Item appends a default row", () => {
    render(<PrioritizerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    expect(items()).toHaveLength(3);
    expect(items()[2].name).toBe("New Item");
    expect(screen.getAllByRole("textbox", { name: "Item name" })).toHaveLength(3);
  });

  it("Value edits both WSJF business value and the matrix value", () => {
    render(<PrioritizerClient />);
    commit("Value (1–10) for Auth", "8");
    expect(stored("b1")).toMatchObject({ businessValue: 8, value: 8 });
    // Search is untouched.
    expect(stored("b2")).toMatchObject({ businessValue: 10, value: 10 });
  });

  it("each numeric cell writes its own field", () => {
    render(<PrioritizerClient />);
    commit("Effort (1–10) for Auth", "7");
    commit("Time criticality for Auth", "9");
    commit("Risk reduction for Auth", "2");
    commit("Job size for Auth", "3");
    commit("Reach for Auth", "2500");
    commit("Confidence % for Auth", "60");
    commit("RICE effort (person-months) for Auth", "0.5");
    expect(stored("b1")).toMatchObject({
      matrixEffort: 7,
      timeCriticality: 9,
      riskReduction: 2,
      jobSize: 3,
      reach: 2500,
      confidence: 60,
      effort: 0.5,
    });
  });

  it("clamps a numeric cell to its range", () => {
    render(<PrioritizerClient />);
    commit("Value (1–10) for Auth", "0");
    expect(stored("b1").businessValue).toBe(1);
    commit("Confidence % for Auth", "150");
    expect(stored("b1").confidence).toBe(100);
    commit("RICE effort (person-months) for Auth", "0");
    expect(stored("b1").effort).toBe(0.1);
    commit("Reach for Auth", "-50");
    expect(stored("b1").reach).toBe(1);
  });

  // Bug: NumCell re-synced its draft only when the stored value changed. A
  // value already at the bound (Search's Value is 10) clamped back to the same
  // number, so typing 15 saved 10 but the cell went on showing 15.
  it("shows the clamped value even when it equals the stored one", () => {
    render(<PrioritizerClient />);
    const input = commit("Value (1–10) for Search", "15");
    expect(stored("b2").businessValue).toBe(10);
    expect(input).toHaveValue(10);
  });

  // Bug: a number input reports "" for a cleared field, and Number("") is 0,
  // so clearing a cell committed the minimum (Reach 100 became 1) instead of
  // taking the "not a number, put the old value back" branch.
  it("clearing a numeric cell restores its value instead of saving the minimum", () => {
    render(<PrioritizerClient />);
    const reach = commit("Reach for Auth", "");
    expect(stored("b1").reach).toBe(100);
    expect(reach).toHaveValue(100);
    const jobSize = commit("Job size for Auth", "   ");
    expect(stored("b1").jobSize).toBe(5);
    expect(jobSize).toHaveValue(5);
  });

  it("Enter commits a numeric cell", () => {
    render(<PrioritizerClient />);
    const input = screen.getByLabelText("Time criticality for Auth");
    input.focus();
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored("b1").timeCriticality).toBe(4);
  });

  it("the MoSCoW and Impact pickers write their fields", () => {
    render(<PrioritizerClient />);
    choose("MoSCoW for Auth", "Won't Have");
    expect(stored("b1").moscow).toBe("wont");
    choose("Impact for Auth", "0.25");
    expect(stored("b1").impact).toBe(0.25);
    expect(screen.getByRole("combobox", { name: "Impact for Auth" })).toHaveTextContent("0.25");
  });

  it("a blank description is stored as undefined", () => {
    useWorkspaceStore.setState({
      backlogItems: [backlogItem("b1", "Auth", { description: "Old" })],
    });
    render(<PrioritizerClient />);
    commit("Description for Auth", "   ");
    expect(stored("b1").description).toBeUndefined();
    commit("Description for Auth", "Passkeys first");
    expect(stored("b1").description).toBe("Passkeys first");
  });

  it("labels an unnamed item's controls", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("b1", "")] });
    render(<PrioritizerClient />);
    expect(screen.getByRole("button", { name: "Remove unnamed item" })).toBeInTheDocument();
    expect(screen.getByLabelText("Reach for unnamed item")).toHaveValue(100);
  });
});

describe("Prioritizer: method tabs", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: buildExample() });
  });

  it("MoSCoW groups items by bucket", () => {
    render(<PrioritizerClient />);
    openTab("MoSCoW");
    const bucket = (label: string) =>
      panel().getByText(label).closest("div.rounded-xl") as HTMLElement;
    expect(bucket("Must Have")).toHaveTextContent("2 items");
    expect(
      within(bucket("Must Have")).getByText("Guest checkout without an account")
    ).toBeInTheDocument();
    expect(bucket("Won't Have")).toHaveTextContent("1 item");
    expect(bucket("Won't Have")).not.toHaveTextContent("1 items");
  });

  it("MoSCoW says when a bucket is empty", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("b1", "Only should")] });
    render(<PrioritizerClient />);
    openTab("MoSCoW");
    expect(panel().getAllByText("No items in this category")).toHaveLength(3);
  });

  it("WSJF ranks by WSJF, showing the cost of delay", () => {
    render(<PrioritizerClient />);
    openTab("WSJF");
    const rows = rankedRows();
    expect(rows.map((r) => r[1])).toEqual([
      "Clearer card-declined message",
      "Guest checkout without an account",
      "One-tap wallet checkout",
      "Address autocomplete",
      "Rebuild checkout on the new payments platform",
      "Saved cards for returning shoppers",
      "AR try-on for product photos",
    ]);
    expect(rows[0]).toEqual(["#1", "Clearer card-declined message", "8.5"]);
    const declined = panel().getByText("Clearer card-declined message").closest("tr")!;
    // CoD = 6 + 8 + 3.
    expect(within(declined).getByText("17")).toBeInTheDocument();
  });

  it("RICE ranks by RICE, ties keeping backlog order", () => {
    render(<PrioritizerClient />);
    openTab("RICE");
    const rows = rankedRows();
    expect(rows.map((r) => r[2])).toEqual([
      "4000",
      "3000",
      "2133.3",
      "1250",
      "1250",
      "1200",
      "150",
    ]);
    expect(rows[3][1]).toBe("Rebuild checkout on the new payments platform");
    expect(rows[4][1]).toBe("Address autocomplete");
    const wallet = panel().getByText("One-tap wallet checkout").closest("tr")!;
    expect(wallet).toHaveTextContent("2x");
    expect(wallet).toHaveTextContent("80%");
    expect(wallet).toHaveTextContent("3 pm");
  });

  it("the matrix lists each item with its value and effort", () => {
    render(<PrioritizerClient />);
    openTab("Value vs Effort");
    for (const q of ["Quick Wins", "Major Projects", "Fill-ins", "Time Sinks"]) {
      expect(panel().getByText(q)).toBeInTheDocument();
    }
    const declined = panel().getByText("Clearer card-declined message").parentElement!;
    expect(declined).toHaveTextContent("V:6 / E:2");
  });

  it("a description shows under the item in the ranked tabs", () => {
    useWorkspaceStore.setState({
      backlogItems: [backlogItem("b1", "Auth", { description: "Passkeys first" })],
    });
    render(<PrioritizerClient />);
    openTab("WSJF");
    expect(panel().getByText("Auth").closest("td")).toHaveTextContent("Passkeys first");
  });
});

describe("Prioritizer: CSV export", () => {
  it("exports every input and both computed scores", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        backlogItem("b1", "Auth", {
          description: "Passkeys",
          moscow: "must",
          businessValue: 9,
          timeCriticality: 8,
          riskReduction: 7,
          jobSize: 3,
          reach: 500,
          impact: 2,
          confidence: 90,
          effort: 2,
          value: 9,
          matrixEffort: 3,
        }),
      ],
    });
    render(<PrioritizerClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Description",
      "MoSCoW",
      "Business Value",
      "Time Criticality",
      "Risk Reduction",
      "Job Size",
      "WSJF",
      "Reach",
      "Impact",
      "Confidence %",
      "Effort (pm)",
      "RICE",
      "Matrix Value",
      "Matrix Effort",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Auth", "Passkeys", "Must Have", 9, 8, 7, 3, 8, 500, 2, 90, 2, 450, 9, 3],
    ]);
  });
});

describe("Prioritizer: AI prompt", () => {
  it("has no prompt for an empty backlog", () => {
    expect(generatePrioritizerPrompts({ items: [] })).toEqual([]);
  });

  it("tabulates each item and counts the Must and Won't haves", () => {
    const [prompt] = generatePrioritizerPrompts({ items: buildExample() });
    expect(prompt.prompt).toContain("| Item | MoSCoW | WSJF | RICE | Effort | Description |");
    expect(prompt.prompt).toContain("Must-haves: 2 | Won't-haves: 1 | Total items: 7");
  });

  // Bug: the prompt rounded WSJF to 1 decimal and scored RICE as 0 when effort
  // was 0, while the page (and its comment: "matches the figure the user sees
  // in the UI") shows WSJF to 2 decimals and floors effort at 0.1.
  it("gives the same WSJF and RICE as the page", () => {
    const rebuild = buildExample().find((r) => r.id === "example-backlog-rebuild")!;
    const zeroEffort = backlogItem("z", "Zero effort", {
      reach: 10,
      impact: 1,
      confidence: 100,
      effort: 0,
    });
    const [prompt] = generatePrioritizerPrompts({ items: [rebuild, zeroEffort] });
    const lines = prompt.prompt.split("\n");
    const rebuildLine = lines.find((l) => l.startsWith("| Rebuild checkout"))!;
    expect(rebuildLine).toContain(`| ${wsjfScore(rebuild)} | ${riceScore(rebuild)} |`);
    expect(wsjfScore(rebuild)).toBe(2.56);
    const zeroLine = lines.find((l) => l.startsWith("| Zero effort"))!;
    expect(zeroLine).toContain(`| ${wsjfScore(zeroEffort)} | ${riceScore(zeroEffort)} |`);
    expect(riceScore(zeroEffort)).toBe(100);
  });
});
