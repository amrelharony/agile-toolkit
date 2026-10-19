import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * RICE: "Load an example" fills an empty calculator with a ranked set of
 * initiatives, "Clear example" removes only those rows, and the Markdown
 * export is a ranked table.
 */

const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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

import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";
import { toMarkdown } from "@/app/(tools)/rice-scoring/markdown";
import { buildExample } from "@/app/(tools)/rice-scoring/example";

const NOW = new Date(2026, 9, 18);

const item = (
  id: string,
  title: string,
  f: [number, number, number, number],
  framework: PrioritizationItem["framework"] = "rice"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score: (f[0] * f[1] * (f[2] / 100)) / f[3],
  fields: { reach: f[0], impact: f[1], confidence: f[2], effort: f[3] },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [] });
});

describe("RICE toMarkdown", () => {
  it("ranks initiatives in a table with the score columns", () => {
    const md = toMarkdown(
      [item("a", "Saved cards", [3000, 2, 80, 4]), item("b", "Guest checkout", [6000, 1, 100, 2])],
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# RICE Scoring — 18 Oct 2026");
    expect(lines).toContain("## Ranked initiatives");
    expect(lines).toContain("| # | Initiative | Reach | Impact | Confidence | Effort | RICE |");
    const first = lines.indexOf("| 1 | Guest checkout | 6000 | 1 | 100% | 2 | 3000.00 |");
    const second = lines.indexOf("| 2 | Saved cards | 3000 | 2 | 80% | 4 | 1200.00 |");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(lines).toContain("**Do first:** Guest checkout (RICE 3000.00)");
  });

  it("escapes pipes and collapses newlines in titles", () => {
    const md = toMarkdown([item("a", "Search | filters\r\nand sort", [100, 1, 100, 1])], NOW);
    expect(md).toContain("| 1 | Search \\| filters and sort | 100 |");
  });

  it("flags outlier scores for a re-check", () => {
    const md = toMarkdown(
      [
        item("a", "A", [100, 1, 100, 10]),
        item("b", "B", [110, 1, 100, 10]),
        item("c", "C", [120, 1, 100, 10]),
        item("d", "D", [130, 1, 100, 10]),
        item("e", "Typo", [100000, 3, 100, 1]),
      ],
      NOW
    );
    expect(md).toContain("| 1 | Typo (outlier) |");
    expect(md).toContain("re-check its inputs");
  });

  it("says there's nothing yet when empty", () => {
    expect(toMarkdown([], NOW)).toBe(
      "# RICE Scoring — 18 Oct 2026\n\nNo initiatives scored yet.\n"
    );
  });
});

describe("RICE example", () => {
  it("has a surprise winner and a tie", () => {
    const rows = buildExample(NOW);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.every((r) => r.id.startsWith("example-") && r.framework === "rice")).toBe(true);

    const byReach = [...rows].sort((a, b) => Number(b.fields!.reach) - Number(a.fields!.reach));
    const byScore = [...rows].sort((a, b) => b.score! - a.score!);
    // The biggest-reach initiative doesn't win.
    expect(byScore[0].id).not.toBe(byReach[0].id);
    const scores = rows.map((r) => r.score);
    expect(new Set(scores).size).toBeLessThan(scores.length);
  });

  it("loads into an empty calculator, then clears only the example rows", () => {
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    expect(
      screen.getByRole("button", { name: "Remove Clearer card-declined message" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain("| 1 | Clearer card-declined message |");

    fireEvent.change(screen.getByLabelText("Initiative title"), {
      target: { value: "Order tracking" },
    });
    fireEvent.change(screen.getByLabelText("Reach (people per quarter)"), {
      target: { value: "800" },
    });
    fireEvent.change(screen.getByLabelText("Impact (0.25–3)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const left = useWorkspaceStore.getState().prioritizations ?? [];
    expect(left.map((x) => x.title)).toEqual(["Order tracking"]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Order tracking" })).toBeInTheDocument();
  });

  it("isn't offered once the calculator has the user's own initiatives", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("r1", "Saved searches", [500, 2, 80, 3])],
    });
    render(<RiceScoringClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is still offered when only another framework has rows", () => {
    useWorkspaceStore.setState({
      prioritizations: [item("w1", "WSJF row", [1, 1, 100, 1], "wsjf")],
    });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect((useWorkspaceStore.getState().prioritizations ?? []).map((x) => x.id)).toEqual(["w1"]);
  });
});
