import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Premortem: "Load an example" fills a blank premortem, "Clear example"
 * removes only the example causes (and the example scenario, unless edited),
 * and the premortem exports as Markdown.
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

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";
import { EXAMPLE_SCENARIO, buildExample } from "@/app/(tools)/premortem/example";
import { toMarkdown } from "@/app/(tools)/premortem/markdown";

const KEY = "agile-toolkit:premortem";
const NOW = new Date(2026, 9, 18);
const stored = () =>
  JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
    scenario: string;
    causes: { id: string; text: string }[];
  };
const notice = () => screen.queryByText("Example data.");
const scenario = () => screen.getByRole("textbox", { name: "Imagined failure scenario" });

beforeEach(() => {
  localStorage.removeItem(KEY);
});

describe("Premortem Markdown", () => {
  it("lists the scenario, the causes in order and the actions with owners", () => {
    const md = toMarkdown(buildExample(), NOW);
    expect(md).toMatch(/^# Premortem — 18 Oct 2026\n/);
    expect(md).toContain(`## Imagined failure\n\n${EXAMPLE_SCENARIO}`);
    expect(md).toContain("| # | Cause | Likelihood | Impact | Score | Preventive action | Owner |");
    expect(md).toContain(
      "| 1 | Payment provider integration took far longer than estimated — Nobody on the team has built a wallet integration before. | 4 | 4 | 16 | Spike the wallet integration in sprint 1 and get sandbox access this week. | Diego (iOS) |"
    );
    expect(md).toContain("| 15 | Quarantine a flaky test within a day");
    expect(md).toContain("## Preventive actions");
    expect(md).toContain("- [ ] Book the legal review for sprint 3. — **Priya (PM)**");
  });

  it("escapes pipes and collapses newlines in table cells", () => {
    const md = toMarkdown(
      {
        scenario: "It failed.",
        causes: [
          {
            id: "c1",
            text: "Scope | creep",
            likelihood: 2,
            impact: 3,
            preventiveAction: "Say\nno",
            owner: "PO",
          },
        ],
      },
      NOW
    );
    expect(md).toContain("| 1 | Scope \\| creep | 2 | 3 | 6 | Say no | PO |");
  });

  it("says there are no causes yet on a blank premortem", () => {
    expect(toMarkdown({ scenario: "", causes: [] }, NOW)).toBe(
      "# Premortem — 18 Oct 2026\n\nNo failure causes yet.\n"
    );
  });
});

describe("Premortem example", () => {
  it("loads into a blank premortem and clears only the example", () => {
    render(<PremortemClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    expect(scenario()).toHaveValue(EXAMPLE_SCENARIO);
    expect(stored().causes).toHaveLength(6);
    expect(stored().causes.every((c) => c.id.startsWith("example-"))).toBe(true);
    expect(screen.getByRole("textbox", { name: "Cause of failure 2" })).toHaveValue(
      "Flaky end-to-end tests taught everyone to ignore red builds"
    );

    // The user adds a cause of their own.
    fireEvent.click(screen.getByRole("button", { name: "Add Cause" }));
    const mine = stored().causes.find((c) => !c.id.startsWith("example-"))!;

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().causes.map((c) => c.id)).toEqual([mine.id]);
    expect(scenario()).toHaveValue("");
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("keeps an edited scenario when clearing", () => {
    render(<PremortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.change(scenario(), { target: { value: "Our launch slipped a quarter." } });
    fireEvent.blur(scenario());

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored()).toEqual({ scenario: "Our launch slipped a quarter.", causes: [] });
  });

  it("doesn't offer the example once the user has written a scenario", () => {
    localStorage.setItem(KEY, JSON.stringify({ scenario: "We missed the date.", causes: [] }));
    render(<PremortemClient />);
    expect(screen.getByText(/No causes yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
