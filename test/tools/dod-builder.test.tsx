import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DOD_STORAGE_KEY, EMPTY_DOD, normalizeDod } from "@/app/(tools)/dod-builder/summary";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Definition of Done builder: the starter list, adding / toggling / removing
 * criteria per category, the per-sprint done checkboxes, the sprint
 * snapshot into history, the adherence card, the p-chart limits and trend,
 * and the stored-blob normaliser the Team charter reads.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);

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
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
// The adherence chart loads through next/dynamic; a placeholder exposes its props.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: Record<string, unknown>) {
      return <div data-testid="adherence-chart" data-props={JSON.stringify(props)} />;
    },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { DodBuilderClient } from "@/app/(tools)/dod-builder/dod-builder-client";

interface StoredItem {
  id: string;
  label: string;
  description?: string;
  category: string;
  required: boolean;
  done?: boolean;
}
interface StoredHistory {
  sprintName: string;
  totalRequired: number;
  completed: number;
  ts: string;
}

const stored = () =>
  JSON.parse(localStorage.getItem(DOD_STORAGE_KEY) ?? "null") as {
    items: StoredItem[];
    history: StoredHistory[];
  };

const seed = (items: StoredItem[], history: StoredHistory[] = []) =>
  localStorage.setItem(DOD_STORAGE_KEY, JSON.stringify({ items, history }));

const item = (id: string, label: string, extra: Partial<StoredItem> = {}): StoredItem => ({
  id,
  label,
  category: "code",
  required: true,
  ...extra,
});

const sprint = (name: string, completed: number, totalRequired = 4): StoredHistory => ({
  sprintName: name,
  totalRequired,
  completed,
  ts: "2026-10-01",
});

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const openTab = (name: string) => fireEvent.mouseDown(tab(name), { button: 0 });
const chartProps = () =>
  JSON.parse(screen.getByTestId("adherence-chart").getAttribute("data-props") ?? "{}") as {
    data: { sprintName: string; adherencePct: number }[];
    control: { centerLinePct: number; uclPct: number; lclPct: number };
  };

beforeEach(() => {
  localStorage.clear();
  logs.length = 0;
  exported.csv = undefined;
});

describe("normalizeDod", () => {
  it("turns a missing or garbage blob into an empty DoD", () => {
    expect(normalizeDod(undefined)).toEqual(EMPTY_DOD);
    expect(normalizeDod(null)).toEqual(EMPTY_DOD);
    expect(normalizeDod("oops")).toEqual(EMPTY_DOD);
    expect(normalizeDod(42)).toEqual(EMPTY_DOD);
    expect(normalizeDod({ items: "nope", history: {} })).toEqual(EMPTY_DOD);
  });

  it("keeps well-formed items and history and drops the rest", () => {
    const good = item("a", "Reviewed");
    const snap = sprint("S1", 2);
    expect(
      normalizeDod({
        items: [good, null, { id: "x" }, { label: 7 }, "str"],
        history: [snap, null, { sprintName: 3 }, {}],
      })
    ).toEqual({ items: [good], history: [snap] });
  });

  it("keeps an item whose label is an empty string (it is still a string)", () => {
    expect(normalizeDod({ items: [item("a", "")] }).items).toHaveLength(1);
  });
});

describe("DoD builder: starter list", () => {
  it("starts from the six starter criteria, three of them required", () => {
    render(<DodBuilderClient />);
    expect(tab("Code")).toHaveTextContent("Code1");
    expect(tab("Testing")).toHaveTextContent("Testing2");
    expect(tab("Docs")).toHaveTextContent("Docs1");
    expect(tab("Performance")).toHaveTextContent("Performance1");
    expect(tab("Security")).toHaveTextContent("Security1");
    expect(tab("Other")).toHaveTextContent("Other0");
    expect(screen.getByText("Code reviewed by peer")).toBeInTheDocument();
    expect(screen.getByText(/required done/).parentElement).toHaveTextContent(
      "0 / 3 required done"
    );
    // No sprint snapshotted yet, so no adherence card and no chart.
    expect(screen.queryByText("Last sprint DoD adherence")).toBeNull();
    expect(screen.queryByTestId("adherence-chart")).toBeNull();
  });

  it("saves the starter list with the first edit", () => {
    render(<DodBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Required: Code reviewed by peer" }));
    expect(stored().items).toHaveLength(6);
    expect(stored().items[0]).toMatchObject({ id: "seed-code-review", required: false });
  });

  it("shows the saved list instead of the starter one", () => {
    seed([item("a", "Demoed to the PO", { category: "other", required: false })]);
    render(<DodBuilderClient />);
    expect(tab("Other")).toHaveTextContent("Other1");
    expect(tab("Code")).toHaveTextContent("Code0");
    expect(screen.queryByText("Code reviewed by peer")).toBeNull();
  });

  it("exports one CSV row per criterion", () => {
    seed([
      item("a", "Reviewed", { description: "By a peer" }),
      item("b", "Docs", { category: "docs", required: false }),
    ]);
    render(<DodBuilderClient />);
    expect(exported.csv?.headers).toEqual(["Category", "Item", "Description", "Required"]);
    expect(exported.csv?.rows).toEqual([
      ["code", "Reviewed", "By a peer", "Yes"],
      ["docs", "Docs", "", "No"],
    ]);
  });
});

describe("DoD builder: editing criteria", () => {
  beforeEach(() => seed([item("a", "Code reviewed by peer")]));

  it("adds a trimmed criterion to the open category, optional by default", () => {
    render(<DodBuilderClient />);
    fireEvent.change(screen.getByLabelText("New code item"), {
      target: { value: "  Linted clean  " },
    });
    fireEvent.change(screen.getByLabelText("New DoD item description"), {
      target: { value: "  eslint + prettier  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const added = stored().items[1];
    expect(added).toMatchObject({
      label: "Linted clean",
      description: "eslint + prettier",
      category: "code",
      required: false,
    });
    expect(screen.getByText("Linted clean")).toBeInTheDocument();
    expect(screen.getByLabelText("New code item")).toHaveValue("");
    expect(screen.getByLabelText("New DoD item description")).toHaveValue("");
    expect(tab("Code")).toHaveTextContent("Code2");
    expect(logs.map((l) => l.action)).toContain("criterion_added");
  });

  it("stores no description when it is blank", () => {
    render(<DodBuilderClient />);
    fireEvent.change(screen.getByLabelText("New code item"), { target: { value: "Merged" } });
    fireEvent.change(screen.getByLabelText("New DoD item description"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(stored().items[1].description).toBeUndefined();
  });

  it("ignores a blank label", () => {
    render(<DodBuilderClient />);
    fireEvent.change(screen.getByLabelText("New code item"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.keyDown(screen.getByLabelText("New code item"), { key: "Enter" });
    expect(stored().items).toHaveLength(1);
  });

  it("adds on Enter in the label and on Ctrl+Enter in the description", () => {
    render(<DodBuilderClient />);
    const label = screen.getByLabelText("New code item");
    fireEvent.change(label, { target: { value: "First" } });
    fireEvent.keyDown(label, { key: "Enter" });
    fireEvent.change(label, { target: { value: "Second" } });
    const desc = screen.getByLabelText("New DoD item description");
    // A plain Enter in the description is a newline, not a submit.
    fireEvent.keyDown(desc, { key: "Enter" });
    expect(stored().items.map((i) => i.label)).toEqual(["Code reviewed by peer", "First"]);
    fireEvent.keyDown(desc, { key: "Enter", ctrlKey: true });
    expect(stored().items.map((i) => i.label)).toEqual([
      "Code reviewed by peer",
      "First",
      "Second",
    ]);
  });

  it("adds to whichever category tab is open", () => {
    render(<DodBuilderClient />);
    openTab("Security");
    fireEvent.change(screen.getByLabelText("New security item"), {
      target: { value: "Secrets scanned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(stored().items[1]).toMatchObject({ label: "Secrets scanned", category: "security" });
    expect(tab("Security")).toHaveTextContent("Security1");
  });

  it("toggles a criterion between Required and Optional", () => {
    render(<DodBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Required: Code reviewed by peer" }));
    expect(stored().items[0].required).toBe(false);
    expect(screen.getByRole("button", { name: "Optional: Code reviewed by peer" })).toBeTruthy();
    expect(logs.at(-1)).toMatchObject({
      action: "criterion_toggled",
      payload: { itemId: "a", required: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Optional: Code reviewed by peer" }));
    expect(stored().items[0].required).toBe(true);
  });

  it("removes only the chosen criterion", () => {
    seed([item("a", "Reviewed"), item("b", "Tested")]);
    render(<DodBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Reviewed" }));
    expect(stored().items.map((i) => i.id)).toEqual(["b"]);
    expect(screen.queryByText("Reviewed")).toBeNull();
    expect(screen.getByText("Tested")).toBeInTheDocument();
  });
});

describe("DoD builder: done checkboxes and the sprint snapshot", () => {
  beforeEach(() =>
    seed([
      item("r1", "Reviewed"),
      item("r2", "Tested"),
      item("r3", "Deployed"),
      item("o1", "Docs", { required: false }),
    ])
  );

  const counter = () => screen.getByText(/required done/).parentElement;

  // Bug: the checkbox had no aria-checked until first ticked (role=checkbox needs one).
  it("exposes each done box as an unchecked checkbox until it is ticked", () => {
    render(<DodBuilderClient />);
    const box = screen.getByRole("checkbox", { name: "Done: Reviewed" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(stored().items[0].done).toBe(true);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("counts only required criteria in the done counter", () => {
    render(<DodBuilderClient />);
    expect(counter()).toHaveTextContent("0 / 3 required done");
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Reviewed" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Docs" }));
    expect(counter()).toHaveTextContent("1 / 3 required done");
  });

  it("needs a sprint name and at least one required criterion to snapshot", () => {
    render(<DodBuilderClient />);
    const snap = screen.getByRole("button", { name: /Snapshot this sprint/ });
    expect(snap).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sprint name"), { target: { value: "   " } });
    expect(snap).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sprint name"), { target: { value: "Sprint 1" } });
    expect(snap).toBeEnabled();
    for (const label of ["Reviewed", "Tested", "Deployed"]) {
      fireEvent.click(screen.getByRole("button", { name: `Required: ${label}` }));
    }
    expect(snap).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Sprint name"), { key: "Enter" });
    expect(stored().history).toEqual([]);
  });

  it("snapshots required-done into history, clears every done box and the name", () => {
    render(<DodBuilderClient />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Reviewed" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Tested" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Docs" }));
    fireEvent.change(screen.getByLabelText("Sprint name"), { target: { value: "  Sprint 42 " } });
    fireEvent.click(screen.getByRole("button", { name: /Snapshot this sprint/ }));

    expect(stored().history).toEqual([
      { sprintName: "Sprint 42", totalRequired: 3, completed: 2, ts: todayLocalISO() },
    ]);
    expect(stored().items.every((i) => i.done === false)).toBe(true);
    expect(screen.getByLabelText("Sprint name")).toHaveValue("");
    expect(counter()).toHaveTextContent("0 / 3 required done");
    // 2 of 3 → 67%
    expect(screen.getByText("Last sprint DoD adherence").parentElement).toHaveTextContent("67%");
    expect(screen.getByRole("progressbar", { name: "Last sprint DoD adherence" })).toBeTruthy();
    expect(logs.at(-1)).toMatchObject({
      action: "dod_reset",
      payload: { sprintName: "Sprint 42", totalRequired: 3, completed: 2 },
    });
  });

  it("snapshots on Enter in the sprint name", () => {
    render(<DodBuilderClient />);
    const name = screen.getByLabelText("Sprint name");
    fireEvent.change(name, { target: { value: "S1" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(stored().history).toHaveLength(1);
    expect(stored().history[0]).toMatchObject({ sprintName: "S1", completed: 0 });
    expect(screen.getByText("Last sprint DoD adherence").parentElement).toHaveTextContent("0%");
  });
});

describe("DoD builder: adherence history", () => {
  beforeEach(() => seed([item("r1", "Reviewed")]));

  it("shows the latest sprint's adherence", () => {
    seed([item("r1", "Reviewed")], [sprint("S1", 4), sprint("S2", 1)]);
    render(<DodBuilderClient />);
    expect(screen.getByText("Last sprint DoD adherence").parentElement).toHaveTextContent("25%");
  });

  it("reads a snapshot with zero required criteria as 0%, not NaN", () => {
    seed([item("r1", "Reviewed")], [sprint("S1", 0, 0)]);
    render(<DodBuilderClient />);
    const card = screen.getByText("Last sprint DoD adherence").parentElement!;
    expect(card).toHaveTextContent("0%");
    expect(card).not.toHaveTextContent("NaN");
  });

  it("draws no chart below four sprints", () => {
    seed([item("r1", "Reviewed")], [sprint("S1", 2), sprint("S2", 3), sprint("S3", 4)]);
    render(<DodBuilderClient />);
    expect(screen.queryByTestId("adherence-chart")).toBeNull();
    expect(screen.queryByText(/DoD adherence — last/)).toBeNull();
  });

  it("draws the p-chart with its centre line and 3σ limits from four sprints", () => {
    seed(
      [item("r1", "Reviewed")],
      [sprint("S1", 2), sprint("S2", 3), sprint("S3", 4), sprint("S4", 3)]
    );
    render(<DodBuilderClient />);
    expect(screen.getByText("DoD adherence — last 4 sprints")).toBeInTheDocument();
    const { data, control } = chartProps();
    expect(data.map((d) => d.adherencePct)).toEqual([50, 75, 100, 75]);
    // p̄ = 12/16 = 0.75, n̄ = 4, σ = √(0.75·0.25/4) ≈ 0.2165
    expect(control.centerLinePct).toBeCloseTo(75, 5);
    expect(control.uclPct).toBeCloseTo(100, 5); // clamped at 1
    expect(control.lclPct).toBeCloseTo((0.75 - 3 * Math.sqrt(0.046875)) * 100, 5);
  });

  it("plots only the trailing 20 sprints", () => {
    const history = Array.from({ length: 25 }, (_, i) => sprint(`S${i + 1}`, 2));
    seed([item("r1", "Reviewed")], history);
    render(<DodBuilderClient />);
    expect(screen.getByText("DoD adherence — last 20 sprints")).toBeInTheDocument();
    const { data } = chartProps();
    expect(data).toHaveLength(20);
    expect(data[0].sprintName).toBe("S6");
    expect(data[19].sprintName).toBe("S25");
  });

  it("flags a rising adherence trend over ten sprints", () => {
    const history = Array.from({ length: 10 }, (_, i) => sprint(`S${i + 1}`, i + 1, 10));
    seed([item("r1", "Reviewed")], history);
    render(<DodBuilderClient />);
    expect(screen.getByText(/adherence trend/)).toHaveTextContent("↗ adherence trend");
  });

  it("flags a falling adherence trend over ten sprints", () => {
    const history = Array.from({ length: 10 }, (_, i) => sprint(`S${i + 1}`, 10 - i, 10));
    seed([item("r1", "Reviewed")], history);
    render(<DodBuilderClient />);
    expect(screen.getByText(/adherence trend/)).toHaveTextContent("↘ adherence trend");
  });

  it("shows no trend chip for a flat series", () => {
    const history = Array.from({ length: 10 }, (_, i) => sprint(`S${i + 1}`, 3));
    seed([item("r1", "Reviewed")], history);
    render(<DodBuilderClient />);
    expect(screen.getByText("DoD adherence — last 10 sprints")).toBeInTheDocument();
    expect(screen.queryByText(/adherence trend/)).toBeNull();
  });
});
