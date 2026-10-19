import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Onboarding Tracker:
 *   - "at risk" means more than half the target time has passed, and the
 *     callout says so (it used to claim "more than 50% past their target");
 *   - overdue milestones are counted apart from at-risk ones;
 *   - "Active onboardees" leaves out people who finished every milestone.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { OnboardingTrackerClient } from "@/app/(tools)/onboarding-tracker/onboarding-tracker-client";

function localISO(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const start = localISO(10); // Day 10
const done = localISO(5);

beforeEach(() => {
  localStorage.setItem(
    "agile-toolkit:onboarding-tracker",
    JSON.stringify([
      {
        id: "p-ana",
        name: "Ana",
        startDate: start,
        milestones: [
          { id: "a1", name: "First commit", targetDays: 3 }, // overdue (10 > 3)
          { id: "a2", name: "First merge", targetDays: 14 }, // at risk (10 > 7)
          { id: "a3", name: "First production deploy", targetDays: 30 }, // on track
          { id: "a4", name: "First PR", targetDays: 7, completedAt: done },
        ],
      },
      {
        id: "p-ben",
        name: "Ben",
        startDate: start,
        milestones: [
          { id: "b1", name: "First commit", targetDays: 3, completedAt: done },
          { id: "b2", name: "First PR", targetDays: 7, completedAt: done },
        ],
      },
    ])
  );
});

/** Text of the compact StatCard whose label is `label`. */
const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

describe("Onboarding Tracker risk and activity counts", () => {
  it("counts overdue and at-risk milestones separately", () => {
    render(<OnboardingTrackerClient />);
    expect(card("Overdue / at-risk milestones")).toContain("1 / 1");
  });

  it("describes at-risk as more than half the target time, and overdue on its own", () => {
    render(<OnboardingTrackerClient />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "1 milestone is overdue: past the target day without completion. 1 milestone is at risk: more than half the target time has passed without completion."
    );
    expect(text).not.toContain("50% past their target");
  });

  it("marks each milestone with the same status the counts use", () => {
    render(<OnboardingTrackerClient />);
    expect(screen.getAllByText("overdue")).toHaveLength(1);
    expect(screen.getAllByText("at risk")).toHaveLength(1);
  });

  it("leaves people who finished every milestone out of Active onboardees", () => {
    render(<OnboardingTrackerClient />);
    const active = card("Active onboardees");
    expect(active).toMatch(/^Active onboardees1/);
    expect(active).toContain("1 finished");
  });
});
