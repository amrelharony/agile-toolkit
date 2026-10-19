import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";

/**
 * Standup: "Load an example" fills today's standup without counting as a
 * submitted standup, "Clear example" removes only those entries, and
 * today's standup exports as Markdown.
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  markdown: undefined as string | undefined,
}));
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
  ExportButton: ({ filename, markdown }: { filename: string; markdown?: string }) => {
    if (filename === "standup-all") spies.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));

import { StandupClient } from "@/app/(tools)/standup/standup-client";
import { toMarkdown } from "@/app/(tools)/standup/markdown";
import { buildExample } from "@/app/(tools)/standup/example";

const NOW = new Date(2026, 9, 18, 9, 30);

function entry(
  id: string,
  member: string,
  extra: Partial<StandupEntry> = {},
  timestamp = NOW.getTime()
): StandupEntry {
  return {
    id,
    member,
    date: "2026-10-18",
    yesterday: "y",
    today: "t",
    blockers: "",
    timestamp,
    ...extra,
  };
}

const entries = () => useWorkspaceStore.getState().standupEntries ?? [];

beforeEach(() => {
  spies.log.mockClear();
  spies.markdown = undefined;
  useWorkspaceStore.setState({ teamMembers: [], standupEntries: [] });
});

describe("standup toMarkdown", () => {
  it("puts today's blockers first, then each person's update", () => {
    const md = toMarkdown(
      [
        entry("b", "Lee (iOS)", { blockers: "Waiting on sandbox keys" }, 2),
        entry("a", "Priya (PM)", { yesterday: "Wrote criteria", today: "Plan release" }, 1),
        entry("c", "Ana (Backend)", { blockers: "DBA review", blockerResolved: true }, 3),
        entry("old", "Sam (QA)", { date: "2026-10-17", blockers: "Old blocker" }),
      ],
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Standup — 18 Oct 2026");
    expect(lines).toContain("3 updates, 1 open blocker.");
    expect(lines.indexOf("## Blockers")).toBeGreaterThan(0);
    expect(lines.indexOf("## Updates")).toBeGreaterThan(lines.indexOf("## Blockers"));
    expect(lines).toContain("- **Lee (iOS):** Waiting on sandbox keys");
    expect(lines).toContain("- **Ana (Backend):** ~~DBA review~~ (resolved)");
    // Speaking order: earliest timestamp first.
    expect(lines.indexOf("### Priya (PM)")).toBeLessThan(lines.indexOf("### Lee (iOS)"));
    expect(lines).toContain("- **Yesterday:** Wrote criteria");
    expect(lines).toContain("- **Today:** Plan release");
    // Another day's entries are left out.
    expect(md).not.toContain("Sam (QA)");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says when nobody is blocked", () => {
    const md = toMarkdown([entry("a", "Priya (PM)")], NOW);
    expect(md).toContain("1 update, 0 open blockers.");
    expect(md).toContain("## Blockers\n\nNo blockers.");
  });

  it("keeps each update on one line; pipes need no escaping outside a table", () => {
    const md = toMarkdown([entry("a", "Sam", { today: "Retest | sign\noff" })], NOW);
    expect(md.split("\n")).toContain("- **Today:** Retest | sign off");
  });

  it("says there is nothing yet when today has no entries", () => {
    const expected = "# Standup — 18 Oct 2026\n\nNo standup updates for today yet.\n";
    expect(toMarkdown([], NOW)).toBe(expected);
    expect(toMarkdown([entry("old", "Sam", { date: "2026-10-17" })], NOW)).toBe(expected);
  });
});

describe("standup buildExample", () => {
  it("dates four updates today, with example ids and a blocker or two", () => {
    const rows = buildExample(NOW);
    expect(rows).toHaveLength(4);
    expect(rows.every((e) => e.id.startsWith("example-") && e.date === "2026-10-18")).toBe(true);
    const blocked = rows.filter((e) => e.blockers.trim()).length;
    expect(blocked).toBeGreaterThanOrEqual(1);
    expect(blocked).toBeLessThanOrEqual(2);
  });
});

describe("standup example flow", () => {
  it("loads the example without logging it, then clears only the example entries", () => {
    render(<StandupClient />);
    expect(screen.queryByRole("button", { name: "Clear example" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(entries()).toHaveLength(4);
    expect(screen.getByText("Priya (PM)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear example" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    // Not a submitted standup: no history event (so no XP or streak).
    expect(spies.log).not.toHaveBeenCalled();
    // The shared roster is untouched.
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);
    expect(spies.markdown).toContain("## Blockers");
    expect(spies.markdown).toContain("### Lee (iOS)");

    fireEvent.change(screen.getByLabelText("Or type a team member name"), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
      target: { value: "Ship the fix" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    expect(entries()).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(entries().map((e) => e.member)).toEqual(["Alice"]);
    expect(screen.queryByText("Priya (PM)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear example" })).toBeNull();
  });

  it("doesn't offer the example once the user has entries", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("u1", "Alice")] });
    render(<StandupClient />);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
