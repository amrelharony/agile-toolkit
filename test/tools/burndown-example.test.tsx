import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Burndown: "Load an example" fills a blank sprint with six logged days,
 * "Clear example" removes only those days, and the sprint exports as Markdown.
 */

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
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { BurndownClient } from "@/app/(tools)/burndown/burndown-client";
import { buildExample } from "@/app/(tools)/burndown/example";
import { toMarkdown } from "@/app/(tools)/burndown/markdown";

const NOW = new Date(2026, 9, 18);

describe("Burndown Markdown", () => {
  it("reports the sprint against the ideal line, then every day", () => {
    const md = toMarkdown(buildExample(NOW), NOW);
    expect(md).toMatch(/^# Burndown — 18 Oct 2026\n/);
    expect(md).toContain("**Sprint:** 40 points over 10 days, starting 12 Oct 2026");
    expect(md).toContain("**Day 6:** 26 points left, ideal 16: 10 points behind ideal (35% done)");
    expect(md).toContain("## Scope changes");
    expect(md).toContain("- Day 4: Pulled in the card-declined fix for the holiday sale (+8 pts)");
    expect(md).toContain("| Day | Ideal | Remaining | Scope change | Note |");
    expect(md).toContain("| 4 | 24 | 36 | Yes | Pulled in the card-declined fix");
    expect(md).toContain("| 6 | 16 | 26 |  | Saved cards done |");
    expect(md).toContain("| 7 | 12 | — |  |  |");
  });

  it("escapes pipes and collapses newlines in notes", () => {
    const md = toMarkdown(
      {
        config: { totalPoints: 10, sprintDays: 2, sprintStartDate: "2026-10-16" },
        entries: [
          { id: "a", day: 0, remaining: 10, scopeChange: false },
          { id: "b", day: 1, remaining: 6, scopeChange: false, description: "API | DB\nmigrated" },
        ],
      },
      NOW
    );
    expect(md).toContain("| 1 | 5 | 6 |  | API \\| DB migrated |");
  });

  it("says nothing is logged on a blank sprint", () => {
    const md = toMarkdown(
      {
        config: { totalPoints: 40, sprintDays: 2, sprintStartDate: "2026-10-18" },
        entries: [0, 1, 2].map((day) => ({
          id: `d${day}`,
          day,
          remaining: day === 0 ? 40 : null,
          scopeChange: false,
        })),
      },
      NOW
    );
    expect(md).toBe("# Burndown — 18 Oct 2026\n\nNo days logged yet.\n");
  });
});

describe("Burndown example", () => {
  it("every example day is marked as example data", () => {
    expect(buildExample(NOW).entries.every((e) => e.id.startsWith("example-"))).toBe(true);
  });

  it("loads into a blank sprint and clears only the example days", () => {
    render(<BurndownClient />);
    const remaining = (day: number) =>
      screen.getByRole("spinbutton", { name: `Remaining points on day ${day}` });
    expect(screen.queryByText("Example data.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(remaining(6)).toHaveValue(26);
    expect(screen.getByRole("textbox", { name: "Note for day 4" })).toHaveValue(
      "Pulled in the card-declined fix for the holiday sale (+8 pts)"
    );
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user logs a day of their own.
    fireEvent.click(screen.getByRole("button", { name: "Add Day" }));
    fireEvent.change(remaining(11), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText("Example data.")).toBeNull();
    expect(remaining(0)).toHaveValue(40);
    expect(remaining(6)).toHaveValue(null);
    expect(screen.getByRole("textbox", { name: "Note for day 4" })).toHaveValue("");
    expect(remaining(11)).toHaveValue(20);
    const startDate = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(startDate.value).toBe(todayLocalISO());

    // A logged day of the user's own: no example offered.
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
