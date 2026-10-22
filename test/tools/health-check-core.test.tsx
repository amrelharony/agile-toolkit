import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthCheckEntry,
  type HealthDimension,
  type HealthDimensionScore,
  type HealthTrafficLight,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_ACTIONS } from "@/lib/history/event-actions";

/**
 * Health check gap-filling: Markdown history window and fallbacks, the
 * trend-chart text, the example's derived trends, and on the page the
 * sprint name, trend buttons, saving a nameless check, the history table and
 * the CSV. (Unrated drafts, Clear All + Undo and the example flow are
 * covered by the other health-check tests.)
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof spies.csv }) => {
    spies.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
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

import { HealthCheckClient } from "@/app/(tools)/health-check/health-check-client";
import { buildExample } from "@/app/(tools)/health-check/example";
import { toMarkdown } from "@/app/(tools)/health-check/markdown";
import { healthTrendText } from "@/app/(tools)/health-check/chart-text";
import type { HealthTrendRow } from "@/app/(tools)/health-check/charts";

const NOW = new Date(2026, 9, 18);
const DIMS = HEALTH_CHECK_DIMENSIONS;

function scores(
  lights: HealthTrafficLight[] | HealthTrafficLight
): Record<HealthDimension, HealthDimensionScore> {
  return Object.fromEntries(
    DIMS.map((d, i) => [
      d,
      { light: Array.isArray(lights) ? lights[i] : lights, trend: "same" as const },
    ])
  ) as Record<HealthDimension, HealthDimensionScore>;
}

function check(id: string, sprintName: string, s = scores("green"), date = "2026-10-01") {
  return { id, sprintName, date, scores: s } satisfies HealthCheckEntry;
}

const doc = () =>
  useWorkspaceStore.getState().healthChecks?.find((d) => d.id === "healthCheck:current");

function seed(history: HealthCheckEntry[], sprintName = "") {
  useWorkspaceStore.setState({
    healthChecks: [
      { id: "healthCheck:current", current: { sprintName, scores: scores("green") }, history },
    ],
  });
}

beforeEach(() => {
  spies.log.mockClear();
  spies.csv = undefined;
  useWorkspaceStore.setState({ healthChecks: [] });
});

describe("health check toMarkdown", () => {
  it("keeps the last six saved checks side by side and says how many there are", () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      check(`h${i + 1}`, `S${i + 1}`, scores("green"), `2026-0${i + 1}-01`)
    );
    const md = toMarkdown({ current: { sprintName: "S9", scores: scores("green") }, history }, NOW);
    expect(md).toContain("## History (last 6 of 8)");
    const header = md.split("\n").find((l) => l.startsWith("| Dimension | S3"))!;
    expect(header).toBe(
      "| Dimension | S3 (2026-03-01) | S4 (2026-04-01) | S5 (2026-05-01) | S6 (2026-06-01) | S7 (2026-07-01) | S8 (2026-08-01) |"
    );
    expect(md).toContain("|---|---|---|---|---|---|---|");
  });

  it("counts every stored light as rated when the page's lights aren't passed", () => {
    const md = toMarkdown(
      {
        current: { sprintName: "", scores: scores(["green", "red", ...Array(6).fill("green")]) },
        history: [],
      },
      NOW
    );
    expect(md).toContain("## Current check\n");
    expect(md).toContain("**Health:** 88% (7 of 8 dimensions green)");
    expect(md).toContain("| Easy to Release | 🔴 Red | → Same |");
  });

  it("says the current check isn't rated yet, and shows gaps in old checks as dashes", () => {
    const lights = Object.fromEntries(DIMS.map((d) => [d, null])) as Record<
      HealthDimension,
      HealthTrafficLight | null
    >;
    const partial = { Fun: { light: "red", trend: "down" } } as unknown as Record<
      HealthDimension,
      HealthDimensionScore
    >;
    const md = toMarkdown(
      {
        current: { sprintName: "S3", scores: scores("green") },
        history: [check("h1", "", partial, "2026-10-01")],
        lights,
      },
      NOW
    );
    expect(md).toContain("## Current check: S3\n\n_Not rated yet._");
    expect(md).toContain("| Dimension | — (2026-10-01) |");
    expect(md).toContain("| Fun | 🔴 Red |");
    expect(md).toContain("| Teamwork | — |");
    expect(md).toContain("| **Health** | **0%** |");
  });
});

describe("health check chart text", () => {
  it("says there are no checks for an empty chart", () => {
    const text = healthTrendText([]);
    expect(text.summary).toBe("No checks saved yet.");
    expect(text.table.columns).toEqual(["Check", ...DIMS]);
    expect(text.table.rows).toEqual([]);
  });

  it("describes a single check and reads anything but 2 or 1 as red", () => {
    const row = { name: "Sprint 1", "Delivering Value": 2, "Easy to Release": 1 } as HealthTrendRow;
    const text = healthTrendText([row]);
    expect(text.summary).toBe(
      "One check (Sprint 1) with 1 green, 1 yellow and 6 red of 8 dimensions."
    );
    expect(text.table.rows[0]).toEqual(["Sprint 1", "Green", "Yellow", ...Array(6).fill("Red")]);
  });
});

describe("health check example", () => {
  it("derives each saved check's trend from the check before, a fortnight apart", () => {
    const { current, history } = buildExample(NOW);
    expect(history.map((h) => h.date)).toEqual(["2026-09-06", "2026-09-20", "2026-10-04"]);
    expect(DIMS.every((d) => history[0].scores[d].trend === "same")).toBe(true);
    // Sprint 13 against Sprint 12: Fun green→yellow, Learning yellow→green.
    expect(history[1].scores.Fun).toEqual({ light: "yellow", trend: "down" });
    expect(history[1].scores.Learning).toEqual({ light: "green", trend: "up" });
    expect(history[1].scores.Teamwork).toEqual({ light: "green", trend: "same" });
    expect(DIMS.every((d) => current.scores[d].light)).toBe(true);
  });
});

describe("Health check page", () => {
  it("commits the sprint name on blur and sets a dimension's trend", () => {
    render(<HealthCheckClient />);
    const name = screen.getByLabelText("Sprint name");
    fireEvent.change(name, { target: { value: "Sprint 42" } });
    expect(doc()).toBeUndefined();
    fireEvent.blur(name);
    expect(doc()?.current.sprintName).toBe("Sprint 42");

    const funTrend = screen.getByRole("group", { name: "Fun trend" });
    fireEvent.click(within(funTrend).getByRole("button", { name: /Up/ }));
    expect(doc()?.current.scores.Fun.trend).toBe("up");
    expect(within(funTrend).getByRole("button", { name: /Up/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(funTrend).getByRole("button", { name: /Same/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    // A trend is not a rating.
    expect(screen.getByTestId("health-check-score")).toHaveTextContent("Health: —");
  });

  it("saves a nameless check as the next 'Check N' and lists it first with its health", () => {
    seed([check("h1", "S1", scores("green"), "2026-10-01")]);
    render(<HealthCheckClient />);
    for (const d of DIMS) {
      const group = screen.getByRole("group", { name: `${d} status` });
      fireEvent.click(within(group).getByRole("button", { name: d === "Fun" ? /Red/ : /Green/ }));
    }
    expect(screen.getByTestId("health-check-score")).toHaveTextContent("88%");
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));

    const history = doc()!.history;
    expect(history.map((h) => h.sprintName)).toEqual(["S1", "Check 2"]);
    expect(history[1].scores.Fun.light).toBe("red");
    expect(spies.log).toHaveBeenCalledWith(
      HEALTH_CHECK_ACTIONS.CHECK_SAVED,
      expect.objectContaining({ sprintName: "" })
    );

    const table = screen.getByText("History").closest(".rounded-xl") as HTMLElement;
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/^Check 2/);
    expect(rows[0]).toHaveTextContent("88%");
    expect(rows[1]).toHaveTextContent(/^S1/);
    expect(rows[1]).toHaveTextContent("100%");
    expect(screen.getByText(/^2 checks from S1 to Check 2/)).toBeInTheDocument();
  });

  it("exports one CSV row per saved check with each light and the health", () => {
    const partial = { ...scores("yellow"), Fun: { light: "green" as const, trend: "up" as const } };
    delete (partial as Partial<typeof partial>).Teamwork;
    seed([
      check(
        "h1",
        "S1",
        scores(["green", "green", "red", "red", "green", "green", "yellow", "green"])
      ),
      check("h2", "S2", partial, "2026-10-15"),
    ]);
    render(<HealthCheckClient />);
    expect(spies.csv?.headers).toEqual(["Sprint", "Date", ...DIMS, "Overall Health %"]);
    expect(spies.csv?.rows).toEqual([
      ["S1", "2026-10-01", "green", "green", "red", "red", "green", "green", "yellow", "green", 63],
      [
        "S2",
        "2026-10-15",
        "yellow",
        "yellow",
        "green",
        "yellow",
        "yellow",
        "yellow",
        "yellow",
        "—",
        13,
      ],
    ]);
  });
});
