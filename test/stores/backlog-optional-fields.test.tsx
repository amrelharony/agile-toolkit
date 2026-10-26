/**
 * Phase 7 made every BacklogItem method input optional. Until the method
 * engine shows a missing input as Not scored, nothing may score or show
 * differently: an item with every method field missing loads, and one rule
 * decides what every surface shows for it. The inputs whose scorers had no
 * rule for a missing one (WSJF's parts, the Value/Effort pair) read as the
 * value the item would have been saved with (withBacklogDefaults), and the
 * hub shows those numbers; the ones that had a rule keep it (RICE scores 0,
 * an item with no bucket is counted in none), and the hub shows them blank.
 * Items saved with every input score as before, and looking at a bare item
 * writes nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/** What the page handed the export and the prompt generator. */
const captured = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
  prompts: [] as { prompt: string }[],
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { prompt: string }[] } }) => {
    captured.prompts = config.prompts;
    return null;
  },
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof captured.csv }) => {
    captured.csv = csvData;
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

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import "@/lib/actions/tools/prioritizer";
import {
  BACKLOG_DEFAULTS,
  createBacklogItem,
  withBacklogDefaults,
} from "@/lib/prioritization/frameworks";
import { backlogRice, backlogWsjf, frameworkScores } from "@/lib/prioritization/scores";
import { priorityScore, storyFromBacklogItem } from "@/app/(tools)/sprint-planning/view";
import { PrioritizerClient } from "@/app/(tools)/prioritizer/prioritizer-client";
import { RICETab } from "@/app/(tools)/prioritizer/components/rice-tab";
import { BACKLOG_BARE, BACKLOG_FULL } from "./phase7-fixtures";

/** The inputs withBacklogDefaults fills, at their "Add item" defaults. */
const WSJF_AND_MATRIX = {
  businessValue: BACKLOG_DEFAULTS.businessValue,
  timeCriticality: BACKLOG_DEFAULTS.timeCriticality,
  riskReduction: BACKLOG_DEFAULTS.riskReduction,
  jobSize: BACKLOG_DEFAULTS.jobSize,
  value: BACKLOG_DEFAULTS.value,
  matrixEffort: BACKLOG_DEFAULTS.matrixEffort,
};

/** The bare item as it was always saved: with the "Add item" defaults. */
const DEFAULTED: BacklogItem = { ...BACKLOG_DEFAULTS, ...BACKLOG_BARE };

const pickFilled = (i: BacklogItem) => ({
  businessValue: i.businessValue,
  timeCriticality: i.timeCriticality,
  riskReduction: i.riskReduction,
  jobSize: i.jobSize,
  value: i.value,
  matrixEffort: i.matrixEffort,
});

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  captured.csv = undefined;
  captured.prompts = [];
});

describe("an item with every method input missing", () => {
  it("loads through import, untouched", () => {
    const json = JSON.stringify({ teamMembers: [], backlogItems: [BACKLOG_BARE] });
    useWorkspaceStore.getState().importJSON(json);
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
  });

  it("reads a missing WSJF part or Value/Effort input as its old default, and nothing else", () => {
    expect(withBacklogDefaults(BACKLOG_BARE)).toEqual({ ...BACKLOG_BARE, ...WSJF_AND_MATRIX });
    const partial: BacklogItem = { id: "p", name: "P", jobSize: 13, moscow: "wont", reach: 40 };
    expect(withBacklogDefaults(partial)).toEqual({ ...WSJF_AND_MATRIX, ...partial });
    // An item with every input is returned as is.
    expect(withBacklogDefaults(BACKLOG_FULL)).toBe(BACKLOG_FULL);
    // A new item still starts from the defaults.
    expect(createBacklogItem("New", {}, "n")).toEqual({
      ...BACKLOG_DEFAULTS,
      id: "n",
      name: "New",
    });
  });

  it("fills businessValue and value from each other, as createBacklogItem stored them", () => {
    const onlyValue: BacklogItem = { id: "v", name: "V", businessValue: 13, matrixEffort: 3 };
    expect(withBacklogDefaults(onlyValue)).toMatchObject({ businessValue: 13, value: 10 });
    expect(frameworkScores(onlyValue, []).valueEffort).toEqual({
      value: 10,
      effort: 3,
      quadrant: "Quick Wins",
    });
    const onlyLegacy: BacklogItem = { id: "l", name: "L", value: 8 };
    expect(withBacklogDefaults(onlyLegacy)).toMatchObject({ businessValue: 8, value: 8 });
    expect(backlogWsjf(onlyLegacy)).toBe(3.6);
    // The same numbers the old "Add item" path would have saved.
    for (const patch of [{ businessValue: 13, matrixEffort: 3 }, { value: 8 }, { jobSize: 2 }]) {
      expect(pickFilled(withBacklogDefaults({ id: "x", name: "X", ...patch }))).toEqual(
        pickFilled(createBacklogItem("X", patch, "x"))
      );
    }
  });

  it("scores as the defaulted item in WSJF and Value/Effort, and RICE keeps its zero rule", () => {
    expect(backlogWsjf(BACKLOG_BARE)).toBe(backlogWsjf(DEFAULTED));
    expect(backlogWsjf(BACKLOG_BARE)).toBe(3);
    expect(backlogRice(BACKLOG_BARE)).toBe(0);

    const scores = frameworkScores(BACKLOG_BARE, []);
    expect(scores).toEqual({
      ...frameworkScores(DEFAULTED, []),
      moscow: undefined,
      rice: 0,
    });
    expect(scores.valueEffort).toEqual({ value: 5, effort: 5, quadrant: "Fill-ins" });
  });

  it("gets the defaulted item's priority in Sprint Planning", () => {
    expect(priorityScore(BACKLOG_BARE)).toBe(priorityScore(DEFAULTED));
    expect(storyFromBacklogItem(BACKLOG_BARE, "s1").priorityScore).toBe(3);
  });

  it("tool.prioritizer.list_state counts it in no bucket and scores it as before", async () => {
    useWorkspaceStore.setState({ backlogItems: [BACKLOG_BARE], prioritizations: [] });
    const r = (await registry
      .get("tool.prioritizer.list_state")!
      .handler({}, makeContext("u", "agent"))) as {
      total: number;
      byMoscow: Record<string, number>;
      items: { id: string; moscow?: string; wsjf: number; rice: number }[];
    };
    expect(r.total).toBe(1);
    expect(r.byMoscow).toEqual({ must: 0, should: 0, could: 0, wont: 0 });
    expect(r.items).toMatchObject([{ id: BACKLOG_BARE.id, wsjf: 3, rice: 0 }]);
    expect(r.items[0].moscow).toBeUndefined();
  });
});

describe("the hub shows a bare item by the same rule its scores use", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [BACKLOG_BARE], prioritizations: [] });
  });

  it("shows the WSJF and matrix numbers it scores with, and RICE inputs and the bucket blank", () => {
    render(<PrioritizerClient />);
    expect(screen.getByLabelText("Value (1–10) for Bare")).toHaveValue(5);
    expect(screen.getByLabelText("Job size for Bare")).toHaveValue(5);
    expect(screen.getByLabelText("Effort (1–10) for Bare")).toHaveValue(5);
    // A number input showing nothing has the value null.
    expect(screen.getByLabelText("Reach for Bare")).toHaveValue(null);
    expect(screen.getByLabelText("Confidence % for Bare")).toHaveValue(null);
    expect(screen.getByLabelText("RICE effort (person-months) for Bare")).toHaveValue(null);
    expect(screen.getByLabelText("MoSCoW for Bare")).toHaveTextContent("Not sorted yet");
    expect(screen.getByLabelText("Impact for Bare")).not.toHaveTextContent(/\d/);

    const table = screen.getByRole("table", { name: /score in every method/ });
    const row = within(table).getByRole("row", { name: /^Bare/ });
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual([
      "Score with MoSCoW: Bare",
      "3.00",
      "0",
      "Fill-insValue 5 · Effort 5",
    ]);
    // Nothing was written back.
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
  });

  it("writes nothing when a cell is focused and left without an edit", () => {
    render(<PrioritizerClient />);
    for (const label of [
      "Value (1–10) for Bare",
      "Effort (1–10) for Bare",
      "Time criticality for Bare",
      "Risk reduction for Bare",
      "Job size for Bare",
      "Reach for Bare",
      "Confidence % for Bare",
      "RICE effort (person-months) for Bare",
    ]) {
      const cell = screen.getByLabelText(label);
      fireEvent.focus(cell);
      fireEvent.blur(cell);
    }
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
  });

  it("still saves an edit, and only the field edited", () => {
    render(<PrioritizerClient />);
    const reach = screen.getByLabelText("Reach for Bare");
    fireEvent.change(reach, { target: { value: "250" } });
    fireEvent.blur(reach);
    expect(useWorkspaceStore.getState().backlogItems).toEqual([{ ...BACKLOG_BARE, reach: 250 }]);
  });

  it("the CSV, the prompts and the RICE tab agree with the table", () => {
    render(<PrioritizerClient />);
    const csv = captured.csv!;
    const row = Object.fromEntries(csv.headers.map((h, n) => [h, csv.rows[0][n]]));
    expect(row).toMatchObject({
      Name: "Bare",
      MoSCoW: "",
      "Business Value": 5,
      "Job Size": 5,
      WSJF: 3,
      Reach: "",
      Impact: "",
      "Confidence %": "",
      "Effort (pm)": "",
      RICE: 0,
      "Matrix Value": 5,
      "Matrix Effort": 5,
    });
    // Item | MoSCoW | WSJF | RICE | Effort | Description
    expect(captured.prompts[0].prompt).toContain("| Bare | NOT SORTED | 3 | 0 | 1 | — |");

    render(<RICETab items={[BACKLOG_BARE]} />);
    const rice = screen.getAllByRole("row").find((r) => r.textContent?.includes("#1"))!;
    expect(within(rice).getAllByRole("cell").at(-1)).toHaveTextContent(/^0$/);
  });
});
