import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Risk Register: "Load an example" fills an empty register, "Clear example"
 * removes only the example risks, and the register exports as Markdown.
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
vi.mock("@/components/shared/workspace-sync-button", () => ({
  WorkspaceSyncButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";
import { buildExample } from "@/app/(tools)/risk-register/example";
import { toMarkdown } from "@/app/(tools)/risk-register/markdown";
import type { Risk } from "@/lib/stores/workspace-types";

const KEY = "agile-toolkit:risk-register";
const NOW = new Date(2026, 9, 18);
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Risk[];
const notice = () => screen.queryByText("Example data.");

beforeEach(() => {
  localStorage.removeItem(KEY);
});

describe("Risk Register Markdown", () => {
  it("ranks risks by score, ties sharing a rank", () => {
    const md = toMarkdown(buildExample(NOW), NOW);
    expect(md).toMatch(/^# Risk Register — 18 Oct 2026\n/);
    expect(md).toContain("7 risks: 2 open, 2 mitigating, 1 accepted, 2 closed.");
    expect(md).toContain("## Risks by score");
    expect(md).toContain("| # | Risk | P × I | Score | Status | Mitigation | Due |");
    expect(md).toContain(
      "| 1 | Payment provider sandbox outages block wallet testing | 4 × 4 | 16 | Open | Record provider responses"
    );
    expect(md).toContain("weekly call. | 2026-10-23 |");
    expect(md).toContain(
      "| 2 | Only one developer knows the checkout service | 3 × 5 | 15 | Mitigating |"
    );
    expect(md).toContain("| 4 | Flaky login test hides real failures | 4 × 2 | 8 | Closed |");
    expect(md).toContain("| 4 | Holiday traffic spike slows checkout | 2 × 4 | 8 | Mitigating |");
    expect(md).toContain(
      "| 7 | Analytics update breaks checkout funnel events | 1 × 3 | 3 | Closed |"
    );
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const md = toMarkdown(
      [
        {
          id: "r1",
          title: "Vendor | lock-in",
          probability: 2,
          impact: 3,
          status: "open",
          raisedAt: "2026-10-01",
          mitigation: "Abstract the API\nbehind a port",
        },
      ],
      NOW
    );
    expect(md).toContain(
      "| 1 | Vendor \\| lock-in | 2 × 3 | 6 | Open | Abstract the API behind a port |  |"
    );
  });

  it("says no risks are logged on an empty register", () => {
    expect(toMarkdown([], NOW)).toBe("# Risk Register — 18 Oct 2026\n\nNo risks logged yet.\n");
  });
});

describe("Risk Register example", () => {
  it("loads into an empty register and clears only the example risks", () => {
    render(<RiskRegisterClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(notice()).toBeInTheDocument();
    expect(stored()).toHaveLength(7);
    expect(stored().every((r) => r.id.startsWith("example-"))).toBe(true);
    expect(
      screen.getByRole("button", { name: "Remove Only one developer knows the checkout service" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user logs a risk of their own.
    fireEvent.click(screen.getByRole("button", { name: "New Risk" }));
    const mine = stored().find((r) => !r.id.startsWith("example-"))!;

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((r) => r.id)).toEqual([mine.id]);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("doesn't offer the example once the register has the user's risks", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          id: "r1",
          title: "Vendor lock-in",
          probability: 3,
          impact: 3,
          status: "open",
          raisedAt: "2026-10-01",
        },
      ])
    );
    render(<RiskRegisterClient />);
    expect(screen.getByRole("button", { name: "Remove Vendor lock-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(notice()).toBeNull();
  });
});
