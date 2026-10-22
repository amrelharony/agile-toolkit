import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * ADKAR Change Tracker (localStorage-backed): adding initiatives, advancing
 * them through Awareness → Desire → Knowledge → Ability → Reinforcement,
 * the KPIs (per-stage counts, % at Reinforcement, avg days per stage), the
 * funnel data, removal and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: string[][] } | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: string[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// The funnel chart loads through next/dynamic; a placeholder exposes its data.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: Record<string, unknown>) {
      return <div data-testid="dynamic" data-props={JSON.stringify(props)} />;
    },
}));

import { AdkarClient } from "@/app/(tools)/adkar/adkar-client";

const KEY = "agile-toolkit:adkar";
const TODAY = "2026-10-18";
const STAGES = ["awareness", "desire", "knowledge", "ability", "reinforcement"] as const;
type Stage = (typeof STAGES)[number];

interface Initiative {
  id: string;
  name: string;
  currentStage: Stage;
  stagesCompleted: Stage[];
  stageHistory: { stage: Stage; enteredAt: string }[];
  owner?: string;
  startDate: string;
  description?: string;
}

const init = (id: string, over: Partial<Initiative> = {}): Initiative => ({
  id,
  name: `Initiative ${id}`,
  currentStage: "awareness",
  stagesCompleted: [],
  stageHistory: [{ stage: "awareness", enteredAt: "2026-01-01" }],
  startDate: "2026-01-01",
  ...over,
});

const seed = (list: unknown[]) => localStorage.setItem(KEY, JSON.stringify(list));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Initiative[];

const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;
const funnel = () =>
  JSON.parse(screen.getByTestId("dynamic").dataset.props!).data as {
    stage: string;
    count: number;
    color: string;
  }[];

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0));
  exported.csv = undefined;
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ADKAR: empty state", () => {
  it("shows zeroed KPIs and the empty message", () => {
    render(<AdkarClient />);
    expect(screen.getByText(/No initiatives yet/)).toBeInTheDocument();
    expect(card("Total initiatives")).toBe("Total initiatives0");
    expect(card("In Ability")).toBe("In Ability0");
    expect(card("At Reinforcement")).toBe("At Reinforcement0%0 initiatives");
    expect(card("Avg days / stage")).toBe("Avg days / stage—");
    expect(screen.getByLabelText("Start date")).toHaveValue(TODAY);
  });
});

describe("ADKAR: adding initiatives", () => {
  it("ignores a blank or whitespace-only name", () => {
    render(<AdkarClient />);
    add();
    type("Initiative", "   ");
    add();
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No initiatives yet/)).toBeInTheDocument();
  });

  it("adds a trimmed initiative at Awareness and clears the form", () => {
    render(<AdkarClient />);
    type("Initiative", "  Trunk-based dev  ");
    type("Owner", "  Ana  ");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    type("Description", "  Move off\nlong-lived branches  ");
    add();

    expect(stored()).toEqual([
      {
        id: expect.any(String),
        name: "Trunk-based dev",
        currentStage: "awareness",
        stagesCompleted: [],
        stageHistory: [{ stage: "awareness", enteredAt: TODAY }],
        owner: "Ana",
        startDate: "2026-10-01",
        description: "Move off\nlong-lived branches",
      },
    ]);
    expect(screen.getByText("Trunk-based dev")).toBeInTheDocument();
    expect(screen.getByText("Ana · started 2026-10-01")).toBeInTheDocument();
    expect(screen.getByText("1. Awareness")).toHaveAttribute("aria-current", "step");

    expect(screen.getByRole("textbox", { name: "Initiative" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Owner" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(screen.getByLabelText("Start date")).toHaveValue(TODAY);
    expect(card("Total initiatives")).toBe("Total initiatives1");
  });

  it("drops blank optional fields and falls back to today for a cleared start date", () => {
    render(<AdkarClient />);
    type("Initiative", "Pairing");
    type("Owner", "   ");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    add();
    const [i] = stored();
    expect(i.owner).toBeUndefined();
    expect(i.description).toBeUndefined();
    expect(i.startDate).toBe(TODAY);
    expect(screen.getByText(`started ${TODAY}`)).toBeInTheDocument();
  });

  it("puts the newest initiative first", () => {
    render(<AdkarClient />);
    type("Initiative", "First");
    add();
    type("Initiative", "Second");
    add();
    expect(stored().map((i) => i.name)).toEqual(["Second", "First"]);
  });
});

describe("ADKAR: advancing stages", () => {
  it("advances one stage at a time, recording completion and the entry date", () => {
    seed([init("a", { name: "Trunk" })]);
    render(<AdkarClient />);
    fireEvent.click(screen.getByRole("button", { name: "Advance stage" }));

    const [i] = stored();
    expect(i.currentStage).toBe("desire");
    expect(i.stagesCompleted).toEqual(["awareness"]);
    expect(i.stageHistory).toEqual([
      { stage: "awareness", enteredAt: "2026-01-01" },
      { stage: "desire", enteredAt: TODAY },
    ]);
    expect(screen.getByText("2. Desire")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("1. Awareness")).toHaveTextContent("(completed)");
    expect(screen.getByText("1. Awareness")).not.toHaveAttribute("aria-current");
  });

  it("credits Reinforcement on arrival and disables advancing past it", () => {
    seed([init("a", { name: "Trunk" })]);
    render(<AdkarClient />);
    for (let k = 0; k < 4; k++) {
      fireEvent.click(screen.getByRole("button", { name: "Advance stage" }));
    }
    const [i] = stored();
    expect(i.currentStage).toBe("reinforcement");
    expect(i.stagesCompleted).toEqual([...STAGES]);
    expect(i.stageHistory.map((h) => h.stage)).toEqual([...STAGES]);

    const done = screen.getByRole("button", { name: "At final stage" });
    expect(done).toBeDisabled();
    fireEvent.click(done);
    expect(stored()[0].stageHistory).toHaveLength(5);
    expect(card("At Reinforcement")).toBe("At Reinforcement100%1 initiative");
  });

  it("advances only the clicked initiative", () => {
    seed([init("a", { name: "Alpha" }), init("b", { name: "Beta" })]);
    render(<AdkarClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Advance stage" })[1]);
    expect(stored().map((i) => i.currentStage)).toEqual(["awareness", "desire"]);
  });
});

describe("ADKAR: KPIs and funnel", () => {
  it("counts initiatives per stage and the share at Reinforcement", () => {
    seed([
      init("a", { currentStage: "awareness" }),
      init("b", { currentStage: "ability" }),
      init("c", { currentStage: "ability" }),
      init("d", { currentStage: "reinforcement" }),
    ]);
    render(<AdkarClient />);
    expect(card("Total initiatives")).toBe("Total initiatives4");
    expect(card("In Ability")).toBe("In Ability2");
    expect(card("At Reinforcement")).toBe("At Reinforcement25%1 initiative");
    expect(funnel().map((f) => [f.stage, f.count])).toEqual([
      ["Awareness", 1],
      ["Desire", 0],
      ["Knowledge", 0],
      ["Ability", 2],
      ["Reinforcement", 1],
    ]);
  });

  it("averages the days between stage entries, skipping bad or backwards dates", () => {
    seed([
      // 10 days in Awareness, 4 in Desire.
      init("a", {
        currentStage: "knowledge",
        stageHistory: [
          { stage: "awareness", enteredAt: "2026-01-01" },
          { stage: "desire", enteredAt: "2026-01-11" },
          { stage: "knowledge", enteredAt: "2026-01-15" },
        ],
      }),
      // Advanced the same day: 0 days.
      init("b", {
        currentStage: "desire",
        stageHistory: [
          { stage: "awareness", enteredAt: "2026-02-01" },
          { stage: "desire", enteredAt: "2026-02-01" },
        ],
      }),
      // Backwards and unparseable deltas are ignored.
      init("c", {
        currentStage: "knowledge",
        stageHistory: [
          { stage: "desire", enteredAt: "2026-02-20" },
          { stage: "knowledge", enteredAt: "2026-02-10" },
        ],
      }),
      init("d", {
        currentStage: "desire",
        stageHistory: [
          { stage: "awareness", enteredAt: "someday" },
          { stage: "desire", enteredAt: "2026-02-10" },
        ],
      }),
    ]);
    render(<AdkarClient />);
    expect(card("Avg days / stage")).toBe(`Avg days / stage${(14 / 3).toFixed(1)}d`);
  });

  it("ignores an unknown stage instead of poisoning the KPIs with NaN", () => {
    seed([init("a", { currentStage: "bogus" as Stage }), init("b", { currentStage: "ability" })]);
    const { container } = render(<AdkarClient />);
    expect(card("Total initiatives")).toBe("Total initiatives2");
    expect(card("In Ability")).toBe("In Ability1");
    expect(card("At Reinforcement")).toBe("At Reinforcement0%0 initiatives");
    expect(funnel().every((f) => Number.isFinite(f.count))).toBe(true);
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe("ADKAR: removing and exporting", () => {
  it("removes exactly the clicked initiative", () => {
    seed([init("a", { name: "Alpha" }), init("b", { name: "Beta" })]);
    render(<AdkarClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(stored().map((i) => i.id)).toEqual(["b"]);
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("exports stages completed and a single-line description", () => {
    seed([
      init("a", {
        name: "Trunk",
        owner: "Ana",
        currentStage: "knowledge",
        stagesCompleted: ["awareness", "desire"],
        description: "Line one\nLine two",
      }),
      init("b", { name: "Pairing" }),
    ]);
    render(<AdkarClient />);
    expect(exported.csv).toEqual({
      headers: ["Name", "Current stage", "Owner", "Start date", "Stages completed", "Description"],
      rows: [
        ["Trunk", "knowledge", "Ana", "2026-01-01", "awareness; desire", "Line one Line two"],
        ["Pairing", "awareness", "", "2026-01-01", "", ""],
      ],
    });
  });
});
