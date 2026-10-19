import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * WSJF: "Load an example" fills an empty calculator with a ranked backlog,
 * "Clear example" removes only those rows, and the Markdown export is a
 * ranked table.
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

import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";
import { toMarkdown } from "@/app/(tools)/wsjf/markdown";
import { buildExample } from "@/app/(tools)/wsjf/example";

const NOW = new Date(2026, 9, 18);

const item = (
  id: string,
  title: string,
  f: [number, number, number, number],
  framework: PrioritizationItem["framework"] = "wsjf"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score: (f[0] + f[1] + f[2]) / f[3],
  fields: { businessValue: f[0], timeCriticality: f[1], rrOe: f[2], jobSize: f[3] },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const ids = () => (useWorkspaceStore.getState().prioritizations ?? []).map((x) => x.id);

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [] });
});

describe("WSJF toMarkdown", () => {
  it("ranks features in a table with the score columns", () => {
    const md = toMarkdown(
      [item("a", "Saved cards", [13, 3, 8, 8]), item("b", "Fix declined copy", [8, 13, 3, 2])],
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# WSJF — 18 Oct 2026");
    expect(lines).toContain("## Ranked features");
    expect(lines).toContain("| # | Feature | BV | TC | RR/OE | Size | WSJF |");
    const rowA = lines.indexOf("| 1 | Fix declined copy | 8 | 13 | 3 | 2 | 12.00 |");
    const rowB = lines.indexOf("| 2 | Saved cards | 13 | 3 | 8 | 8 | 3.00 |");
    expect(rowA).toBeGreaterThan(0);
    expect(rowB).toBeGreaterThan(rowA);
    expect(lines).toContain("**Do first:** Fix declined copy (WSJF 12.00)");
  });

  it("gives tied features the same rank", () => {
    const md = toMarkdown(
      [item("a", "Saved cards", [13, 3, 8, 8]), item("b", "Autocomplete", [8, 5, 2, 5])],
      NOW
    );
    expect(md).toContain("| 1 | Saved cards |");
    expect(md).toContain("| 1 | Autocomplete |");
  });

  it("escapes pipes and collapses newlines in titles", () => {
    const md = toMarkdown([item("a", "Search | filters\nand sort", [5, 5, 5, 5])], NOW);
    expect(md).toContain("| 1 | Search \\| filters and sort | 5 |");
  });

  it("says there's nothing yet when empty", () => {
    expect(toMarkdown([], NOW)).toBe("# WSJF — 18 Oct 2026\n\nNo features scored yet.\n");
  });
});

describe("WSJF example", () => {
  it("is a small backlog where small and urgent beats the big rebuild", () => {
    const rows = buildExample(NOW);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.every((r) => r.id.startsWith("example-") && r.framework === "wsjf")).toBe(true);

    const byValue = [...rows].sort(
      (a, b) => Number(b.fields!.businessValue) - Number(a.fields!.businessValue)
    );
    const byScore = [...rows].sort((a, b) => b.score! - a.score!);
    expect(byScore[0].id).not.toBe(byValue[0].id);
    expect(byScore.at(-1)!.id).toBe(byValue[0].id);
    // At least one tie, so the dense ranking shows.
    const scores = rows.map((r) => r.score);
    expect(new Set(scores).size).toBeLessThan(scores.length);
  });

  it("loads into an empty calculator, then clears only the example rows", () => {
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    expect(
      screen.getByRole("button", { name: "Remove Rebuild checkout on the new payments platform" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain(
      "| 1 | Fix card-declined message before the holiday sale |"
    );

    // The user adds their own feature alongside the example.
    fireEvent.change(screen.getByLabelText("Feature title"), { target: { value: "Gift cards" } });
    const pick = (group: string, option: string) =>
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option })
      );
    pick("Business value", "5");
    pick("Time criticality", "3");
    pick("Risk reduction / opportunity enablement", "1");
    pick("Job size", "3");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const left = useWorkspaceStore.getState().prioritizations ?? [];
    expect(left.map((x) => x.title)).toEqual(["Gift cards"]);
    expect(left.some((x) => x.id.startsWith("example-"))).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Gift cards" })).toBeInTheDocument();
  });

  it("leaves other frameworks' rows alone", () => {
    const rice = item("r1", "Rice row", [1, 1, 1, 1], "rice");
    useWorkspaceStore.setState({ prioritizations: [rice] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ids()).toEqual(["r1"]);
  });

  it("isn't offered once the calculator has the user's own features", () => {
    useWorkspaceStore.setState({ prioritizations: [item("w1", "Single sign-on", [8, 5, 3, 2])] });
    render(<WsjfClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
