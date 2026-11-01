import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr } from "@/lib/stores/workspace-types";

/**
 * OKRs: "Load an example" fills an empty tracker with two objectives,
 * "Clear example" removes only those, and the Markdown export shows each
 * objective's progress with a key-result table.
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

import { OkrsClient } from "@/app/(tools)/okrs/okrs-client";
import { toMarkdown } from "@/app/(tools)/okrs/markdown";
import { buildExample } from "@/app/(tools)/okrs/example";

const NOW = new Date(2026, 9, 18);

const kr = (id: string, title: string, current: number, target: number): KeyResult => ({
  id,
  title,
  current,
  target,
  confidence: 7,
});
const okr = (id: string, objective: string, keyResults: KeyResult[]): Okr => ({
  id,
  objective,
  keyResults,
  quarter: "2026 Q4",
});

const objectives = () => useWorkspaceStore.getState().okrs.map((o) => o.objective);

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ okrs: [] });
});

describe("OKRs toMarkdown", () => {
  it("lists each objective with its progress and a key-result table", () => {
    const md = toMarkdown(
      [
        okr("o1", "Delight new users", [
          kr("k1", "Activation to 60%", 30, 60),
          kr("k2", "NPS above 40", 40, 40),
        ]),
        {
          ...okr("o2", "Cut support load", [kr("k3", "Tickets under 50 a week", 0, 50)]),
          owner: "Sam (QA)",
        },
      ],
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# OKRs — 18 Oct 2026");
    expect(lines).toContain("**38% average progress** across 2 objectives and 3 key results.");
    expect(lines).toContain("## Delight new users (2026 Q4) — 75%");
    // Phase 8: each key result reads from its start (no baseline: counted from 0).
    expect(lines).toContain(
      "| Key result | Start → target | Now | Progress | Confidence | Last check-in |"
    );
    expect(lines).toContain(
      "| Activation to 60% | ↑ to 60 (no baseline) | 30 of 60 | 50% | 7/10 (On track) | None yet |"
    );
    expect(lines).toContain(
      "| NPS above 40 | ↑ to 40 (no baseline) | 40 of 40 | 100% | 7/10 (On track) | None yet |"
    );
    expect(lines).toContain("## Cut support load (2026 Q4) — 0%");
    expect(lines).toContain("Owner: Sam (QA)");
  });

  it("escapes pipes and collapses newlines in key results", () => {
    const md = toMarkdown([okr("o1", "Ship it", [kr("k1", "API | web\nparity", 1, 2)])], NOW);
    expect(md).toContain(
      "| API \\| web parity | ↑ to 2 (no baseline) | 1 of 2 | 50% | 7/10 (On track) |"
    );
  });

  it("says there's nothing yet when empty", () => {
    expect(toMarkdown([], NOW)).toBe("# OKRs — 18 Oct 2026\n\nNo objectives yet.\n");
  });
});

describe("OKRs example", () => {
  it("uses example ids all the way down", () => {
    const okrs = buildExample(NOW);
    expect(okrs.length).toBeGreaterThan(0);
    for (const o of okrs) {
      expect(o.id.startsWith("example-")).toBe(true);
      expect(o.quarter).toBe("2026 Q4");
      for (const k of o.keyResults) expect(k.id.startsWith("example-")).toBe(true);
    }
  });

  it("loads into an empty tracker, then clears only the example objectives", () => {
    render(<OkrsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Make checkout effortless on mobile" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain("## Make checkout effortless on mobile");

    useWorkspaceStore.getState().upsertOkr(okr("mine", "Grow repeat orders", []));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(objectives()).toEqual(["Grow repeat orders"]);
    expect(screen.queryByText(/Example data\./)).toBeNull();
    expect(screen.getByRole("heading", { name: "Grow repeat orders" })).toBeInTheDocument();
  });

  it("isn't offered once the tracker has the user's own objectives", () => {
    useWorkspaceStore.setState({ okrs: [okr("o1", "Delight new users", [])] });
    render(<OkrsClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });
});
