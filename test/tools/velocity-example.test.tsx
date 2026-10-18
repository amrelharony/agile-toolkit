import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Velocity: the three default sprints are the example (ids `example-…`),
 * "Clear example" removes only them, "Load an example" brings them back when
 * there are no sprints, they never reach the workspace while untouched, and
 * the sprints export as Markdown.
 */

// Rows saved before the example ids existed, still untouched.
vi.hoisted(() => {
  localStorage.setItem(
    "agile-toolkit:velocity",
    JSON.stringify({
      state: {
        sprints: [
          { id: "default:sprint-1", name: "Sprint 1", committed: 34, completed: 28 },
          { id: "default:sprint-2", name: "Sprint 2", committed: 30, completed: 32 },
          { id: "default:sprint-3", name: "Sprint 3", committed: 36, completed: 35 },
        ],
      },
      version: 0,
    })
  );
});
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

import { VelocityClient } from "@/app/(tools)/velocity/velocity-client";
import { buildExampleSprints } from "@/app/(tools)/velocity/example";
import { toMarkdown } from "@/app/(tools)/velocity/markdown";

const NOW = new Date(2026, 9, 18);
const sprintNames = () =>
  screen
    .queryAllByRole("textbox", { name: "Sprint name" })
    .map((i) => (i as HTMLInputElement).value);
const notice = () => screen.queryByText("Example data.");
const workspaceIds = () => (useWorkspaceStore.getState().sprints ?? []).map((s) => s.id);

describe("Velocity Markdown", () => {
  it("reports average and predictability, then every sprint", () => {
    const md = toMarkdown(
      [
        ...buildExampleSprints(),
        { id: "p", name: "Sprint 4", committed: 33, completed: 0, description: "Wallet launch" },
      ],
      NOW
    );
    expect(md).toMatch(/^# Velocity — 18 Oct 2026\n/);
    expect(md).toContain("**Average velocity:** 31.7 points over 3 finished sprints");
    expect(md).toContain("**Predictability:** 1 of 3 met their commitment (33%)");
    expect(md).toContain("**Spread:** ±2.9 points (standard deviation)");
    expect(md).toContain("| Sprint | Committed | Completed | Met commitment | Notes |");
    expect(md).toContain("| Sprint 1 | 34 | 28 | No (82%) |  |");
    expect(md).toContain("| Sprint 2 | 30 | 32 | Yes (107%) |  |");
    expect(md).toContain("| Sprint 4 | 33 | — | Planned | Wallet launch |");
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const md = toMarkdown(
      [{ id: "a", name: "Sprint 5 | hotfix", committed: 10, completed: 12, description: "a\nb" }],
      NOW
    );
    expect(md).toContain("| Sprint 5 \\| hotfix | 10 | 12 | Yes (120%) | a b |");
  });

  it("says there are no sprints yet", () => {
    expect(toMarkdown([], NOW)).toBe("# Velocity — 18 Oct 2026\n\nNo sprints yet.\n");
  });
});

describe("Velocity example", () => {
  it("keeps saved seed rows as they were, and loads and clears the example", () => {
    render(<VelocityClient />);

    // Seed rows saved under the old ids: not the example, still not bridged.
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
    expect(notice()).toBeNull();
    expect(workspaceIds()).not.toContain("default:sprint-1");

    // Reset swaps them (untouched, so no confirm) for the example rows.
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(notice()).toBeInTheDocument();
    expect(buildExampleSprints().every((s) => s.id.startsWith("example-"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(sprintNames()).toEqual([]);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
    expect(notice()).toBeInTheDocument();
    expect(workspaceIds().some((id) => id.startsWith("example-"))).toBe(false);

    // A sprint of the user's own survives the clear.
    fireEvent.click(screen.getByRole("button", { name: "Add Sprint" }));
    expect(sprintNames()).toEqual(["Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(sprintNames()).toEqual(["Sprint 4"]);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
