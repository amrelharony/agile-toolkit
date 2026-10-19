import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Burndown first run: the sprint starts today (not a fixed 2026-01-01), and
 * the KPIs say there's no data instead of "On track" until a second day is
 * logged.
 */

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

describe("Burndown first run", () => {
  it("starts the sprint today and shows no trend until two days are logged", () => {
    const { container } = render(<BurndownClient />);

    const startDate = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(startDate.value).toBe(todayLocalISO());

    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("On track")).toBeNull();
    // Variance and completion read "—" too.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);

    // Day 0 is pre-filled; logging day 1 gives a second point and a trend.
    const remaining = screen.getAllByPlaceholderText("— pts");
    fireEvent.change(remaining[1], { target: { value: "36" } });
    expect(screen.queryByText("No data yet")).toBeNull();
    expect(screen.getByText("On track")).toBeInTheDocument();
  });
});
