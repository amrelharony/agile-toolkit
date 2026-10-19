import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * On-call roster: the burnout heatmap coloured each shift by its raw page
 * count, so 4 pages looked the same on a 1-day shift and a 14-day one. It
 * now colours by pages per 7 days on call.
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { OncallRosterClient } from "@/app/(tools)/oncall-roster/oncall-roster-client";

const pages = (shiftId: string, n: number, day: string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${shiftId}-p${i}`,
    shiftId,
    ts: `${day}T1${i % 10}:00:00`,
    severity: "sev3",
  }));

beforeEach(() => {
  // Local noon on 2026-10-19, after every shift below has ended.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 19, 12));
  useWorkspaceStore.setState({
    oncallRosters: [
      {
        id: "oncallRoster:current",
        shifts: [
          // 4 pages in 1 day = 28 / 7 days: red.
          { id: "short", person: "ana", startDate: "2026-10-01", endDate: "2026-10-01" },
          // 4 pages in 14 days = 2 / 7 days: green (was amber on the raw count).
          { id: "long", person: "ben", startDate: "2026-10-02", endDate: "2026-10-15" },
        ],
        pages: [...pages("short", 4, "2026-10-01"), ...pages("long", 4, "2026-10-05")],
      },
    ] as never,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("On-call burnout heatmap", () => {
  it("colours by pages per 7 days on call, not raw count", () => {
    render(<OncallRosterClient />);
    const short = screen.getByTestId("shift-short");
    const long = screen.getByTestId("shift-long");

    expect(short.className).toMatch(/text-danger/);
    expect(short).toHaveTextContent("28.0 / 7 days");
    expect(long.className).toMatch(/text-success/);
    expect(long).toHaveTextContent("2.0 / 7 days");
    expect(screen.getByText(/colored by pages per 7 days on call/)).toBeInTheDocument();
  });
});
