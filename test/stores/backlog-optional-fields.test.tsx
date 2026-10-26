/**
 * Phase 7 made every BacklogItem method input optional, and the method
 * engine reads a missing input as Not scored (the data layer's stopgap,
 * withBacklogDefaults, is gone): an item with every method field missing
 * loads, and every surface (the hub's table and tabs, its CSV and prompts,
 * Sprint Planning, tool.prioritizer.list_state) shows it unscored, never
 * at a mid-range default. Looking at a bare item writes nothing; an edit
 * writes the field edited (and the engine's save stamp).
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
import { createBacklogItem } from "@/lib/prioritization/frameworks";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import { backlogRice, backlogWsjf, frameworkScores } from "@/lib/prioritization/scores";
import { priorityScore, storyFromBacklogItem } from "@/app/(tools)/sprint-planning/view";
import { PrioritizerClient } from "@/app/(tools)/prioritizer/prioritizer-client";
import { RICETab } from "@/app/(tools)/prioritizer/components/rice-tab";
import { BACKLOG_BARE, BACKLOG_FULL } from "./phase7-fixtures";

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

  it("reads as itself: nothing filled in, every method Not scored", () => {
    expect(readBacklogItem(BACKLOG_BARE)).toBe(BACKLOG_BARE);
    expect(backlogWsjf(BACKLOG_BARE)).toBeNull();
    expect(backlogRice(BACKLOG_BARE)).toBeNull();
    expect(frameworkScores(BACKLOG_BARE, [])).toEqual({
      moscow: undefined,
      wsjf: null,
      rice: null,
      valueEffort: null,
      ice: null,
      kano: null,
      costOfDelay: null,
      cd3: null,
      urgency: null,
    });
    // A new item has no defaults either.
    const fresh = createBacklogItem("New", {}, "n");
    expect(fresh).toEqual({ id: "n", name: "New", updatedAt: fresh.updatedAt });
  });

  it("scores an item with every input as before", () => {
    expect(backlogWsjf(BACKLOG_FULL)).not.toBeNull();
    expect(backlogRice(BACKLOG_FULL)).not.toBeNull();
    expect(frameworkScores(BACKLOG_FULL, []).moscow).toBe(BACKLOG_FULL.moscow);
  });

  it("reads the legacy matrix value only as the one value field's fallback", () => {
    const onlyLegacy: BacklogItem = { id: "l", name: "L", value: 8, matrixEffort: 3 };
    expect(frameworkScores(onlyLegacy, []).valueEffort).toEqual({
      value: 8,
      effort: 3,
      quadrant: "quick_wins",
    });
    expect(backlogWsjf(onlyLegacy)).toBeNull(); // the other WSJF parts are missing
  });

  it("has no priority in Sprint Planning, and its story is left unscored", () => {
    expect(priorityScore(BACKLOG_BARE)).toBeNull();
    const story = storyFromBacklogItem(BACKLOG_BARE, "s1");
    expect(story.priorityScore).toBeUndefined();
    expect(story.sourceRef).toEqual({ tool: "prioritizer", id: BACKLOG_BARE.id });
  });

  it("tool.prioritizer.list_state counts it in no bucket and scores it null", async () => {
    useWorkspaceStore.setState({ backlogItems: [BACKLOG_BARE], prioritizations: [] });
    const r = (await registry
      .get("tool.prioritizer.list_state")!
      .handler({}, makeContext("u", "agent"))) as {
      total: number;
      byMoscow: Record<string, number>;
      items: { id: string; moscow?: string; wsjf: number | null; rice: number | null }[];
    };
    expect(r.total).toBe(1);
    expect(r.byMoscow).toEqual({ must: 0, should: 0, could: 0, wont: 0 });
    expect(r.items).toMatchObject([{ id: BACKLOG_BARE.id, wsjf: null, rice: null }]);
    expect(r.items[0].moscow).toBeUndefined();
  });
});

describe("the hub shows a bare item as Not scored", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ backlogItems: [BACKLOG_BARE], prioritizations: [] });
  });

  it("shows every input blank and every method unscored", () => {
    render(<PrioritizerClient />);
    expect(screen.getByLabelText("Value (Fibonacci 1–20) for Bare")).toHaveValue(null);
    expect(screen.getByLabelText("Job size for Bare")).toHaveValue(null);
    expect(screen.getByLabelText("Effort (1–10) for Bare")).toHaveValue(null);
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
      "Score with WSJF: Bare",
      "Score with RICE: Bare",
      "Score with Value/Effort: Bare",
    ]);
    // Nothing was written back.
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
  });

  it("writes nothing when a cell is focused and left without an edit", () => {
    render(<PrioritizerClient />);
    for (const label of [
      "Value (Fibonacci 1–20) for Bare",
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

  it("still saves an edit, and only the field edited (stamped as saved by the engine)", () => {
    render(<PrioritizerClient />);
    const reach = screen.getByLabelText("Reach for Bare");
    fireEvent.change(reach, { target: { value: "250" } });
    fireEvent.blur(reach);
    const [saved] = useWorkspaceStore.getState().backlogItems ?? [];
    expect(saved).toEqual({ ...BACKLOG_BARE, reach: 250, updatedAt: saved.updatedAt });
    expect(saved.updatedAt).toBeTruthy();
  });

  it("the CSV, the prompts and the RICE tab agree with the table", () => {
    render(<PrioritizerClient />);
    const csv = captured.csv!;
    const row = Object.fromEntries(csv.headers.map((h, n) => [h, csv.rows[0][n]]));
    expect(row).toMatchObject({
      Name: "Bare",
      MoSCoW: "",
      "Business Value": "",
      "Job Size": "",
      WSJF: "",
      Reach: "",
      Impact: "",
      "Confidence %": "",
      "Effort (pm)": "",
      RICE: "",
      "Matrix Value": "",
      "Matrix Effort": "",
    });
    // Order | Item | MoSCoW | WSJF | RICE | Value/Effort | Effort (pm) | Description
    expect(captured.prompts[0].prompt).toContain(
      "| — | Bare | Not sorted yet | Not scored | Not scored | Not scored | — | — |"
    );

    render(<RICETab items={[BACKLOG_BARE]} />);
    const rice = screen.getAllByRole("row").find((r) => r.textContent?.includes("#1"))!;
    expect(within(rice).getAllByRole("cell").at(-1)).toHaveTextContent(/^Not scored$/);
  });
});
