/**
 * Phase 7 made every BacklogItem method input optional. Until the method
 * engine shows a missing input as Not scored, nothing may score or show
 * differently: an item with every method field missing loads, and the hub,
 * Sprint Planning and tool.prioritizer read a missing number as its old
 * "Add item" default (BACKLOG_DEFAULTS), while the code that already had a
 * rule for a missing input keeps it (RICE scores 0, an item with no bucket
 * is counted in none). Items saved with every input score as before.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
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
import { BACKLOG_BARE, BACKLOG_FULL } from "./phase7-fixtures";

/** The bare item as it was always saved: with the "Add item" defaults. */
const DEFAULTED: BacklogItem = { ...BACKLOG_DEFAULTS, ...BACKLOG_BARE };

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
});

describe("an item with every method input missing", () => {
  it("loads through import, untouched", () => {
    const json = JSON.stringify({ teamMembers: [], backlogItems: [BACKLOG_BARE] });
    useWorkspaceStore.getState().importJSON(json);
    expect(useWorkspaceStore.getState().backlogItems).toEqual([BACKLOG_BARE]);
  });

  it("reads each missing input as its old default, and keeps the ones it has", () => {
    expect(withBacklogDefaults(BACKLOG_BARE)).toEqual(DEFAULTED);
    const partial: BacklogItem = { id: "p", name: "P", jobSize: 13, moscow: "wont" };
    expect(withBacklogDefaults(partial)).toEqual({ ...BACKLOG_DEFAULTS, ...partial });
    // An item with every input is returned as is.
    expect(withBacklogDefaults(BACKLOG_FULL)).toBe(BACKLOG_FULL);
    // A new item still starts from the defaults.
    expect(createBacklogItem("New", {}, "n")).toEqual({
      ...BACKLOG_DEFAULTS,
      id: "n",
      name: "New",
    });
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

  it("shows in the hub with the old defaults in its cells", () => {
    useWorkspaceStore.setState({ backlogItems: [BACKLOG_BARE], prioritizations: [] });
    render(<PrioritizerClient />);
    expect(screen.getByLabelText("Value (1–10) for Bare")).toHaveValue(5);
    expect(screen.getByLabelText("Job size for Bare")).toHaveValue(5);
    expect(screen.getByLabelText("Reach for Bare")).toHaveValue(100);
    expect(screen.getByLabelText("Confidence % for Bare")).toHaveValue(80);

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
});
