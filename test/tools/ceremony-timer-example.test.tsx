import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Ceremony Timer: "Load an example" sets up a five-speaker standup on a blank
 * timer, "Clear example" removes only the example speakers, and the agenda
 * exports as Markdown.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import { buildExample } from "@/app/(tools)/ceremony-timer/example";
import { toMarkdown } from "@/app/(tools)/ceremony-timer/markdown";

const NOW = new Date(2026, 9, 18);
const speakers = () =>
  screen
    .queryAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")?.replace(/^Remove /, ""));
const notice = () => screen.queryByText("Example data.");
const people = (...names: string[]) => names.map((name, i) => ({ id: `p${i}`, name }));

describe("Ceremony Timer Markdown", () => {
  it("lists the speaking order with each slot's start and length", () => {
    const { participants } = buildExample();
    const md = toMarkdown(
      { ceremony: "Standup", totalSeconds: 900, rotationMode: true, participants },
      NOW
    );
    expect(md).toMatch(/^# Ceremony Timer — 18 Oct 2026\n/);
    expect(md).toContain("**Standup:** 15:00 time-box");
    expect(md).toContain("## Speaking order (03:00 each)");
    expect(md).toContain("| # | Speaker | Starts at | Time |");
    expect(md).toContain("| 1 | Priya (PM) | 00:00 | 03:00 |");
    expect(md).toContain("| 5 | Amara (QA) | 12:00 | 03:00 |");
  });

  it("gives the last speaker the seconds that don't divide evenly", () => {
    const md = toMarkdown(
      {
        totalSeconds: 600,
        rotationMode: true,
        participants: people("A", "B", "C", "D", "E", "F", "G"),
      },
      NOW
    );
    expect(md).toContain("**Custom:** 10:00 time-box");
    expect(md).toContain("| 6 | F | 07:05 | 01:25 |");
    expect(md).toContain("| 7 | G | 08:30 | 01:30 |");
  });

  it("escapes pipes in names", () => {
    const md = toMarkdown(
      { totalSeconds: 120, rotationMode: true, participants: people("Ann | lead", "Bo") },
      NOW
    );
    expect(md).toContain("| 1 | Ann \\| lead | 00:00 | 01:00 |");
  });

  it("notes a shared time-box without rotation, and nothing on a blank timer", () => {
    expect(
      toMarkdown(
        { ceremony: "Retro", totalSeconds: 5400, rotationMode: false, participants: [] },
        NOW
      )
    ).toContain("**Retro:** 1:30:00 time-box\n\nOne shared time-box, no speaker rotation.");
    expect(toMarkdown({ totalSeconds: 0, rotationMode: false, participants: [] }, NOW)).toBe(
      "# Ceremony Timer — 18 Oct 2026\n\nNo ceremony set up yet.\n"
    );
  });
});

describe("Ceremony Timer example", () => {
  it("loads a standup and clears only the example speakers", () => {
    render(<CeremonyTimerClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Rotation mode" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(speakers()).toEqual([
      "Priya (PM)",
      "Diego (iOS)",
      "Mei (Android)",
      "Sam (Backend)",
      "Amara (QA)",
    ]);
    expect(buildExample().participants.every((p) => p.id.startsWith("example-"))).toBe(true);
    expect(notice()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user adds a speaker of their own.
    fireEvent.change(screen.getByRole("textbox", { name: "Participant name" }), {
      target: { value: "Lee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add participant" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(speakers()).toEqual(["Lee"]);
    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("goes back to the blank timer when only example speakers were there", () => {
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Rotation mode" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("doesn't offer the example once a ceremony is picked", () => {
    render(<CeremonyTimerClient />);
    fireEvent.click(screen.getByRole("button", { name: /^Retro/ }));
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});
