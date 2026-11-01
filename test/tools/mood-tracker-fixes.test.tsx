import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Mood Tracker note-only entries: a note typed before a face is a draft,
 * never a stored check-in with a stand-in score. A note-first placeholder
 * an older build saved (score 3, isPlaceholder) must still render as "no
 * mood", not as Neutral, on the heatmap and the face buttons, and must not
 * count as a check-in; picking a face makes it the real check-in.
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
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/app/(tools)/mood-tracker/charts", () => ({ DailyMoodChart: () => null }));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { MoodTrackerClient } from "@/app/(tools)/mood-tracker/mood-tracker-client";

const today = todayLocalISO();
const renderPage = () =>
  render(
    <TooltipProvider>
      <MoodTrackerClient />
    </TooltipProvider>
  );
const faces = () => within(screen.getByRole("group", { name: /^Mood for Ana/ }));
const checkIns = () => screen.getByText("Check-ins").parentElement!.parentElement!.textContent;

beforeEach(() => {
  useWorkspaceStore.setState({
    teamMembers: [{ id: "m1", name: "Ana" }],
    moodEntries: [],
    moodPulses: [],
    moodTrackerDocs: [],
  });
});

describe("Mood Tracker note-only entries", () => {
  it("keeps a note typed before a face as a draft, storing nothing", () => {
    renderPage();
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    fireEvent.change(note, { target: { value: "Slept badly" } });
    fireEvent.blur(note);
    expect(useWorkspaceStore.getState().moodEntries ?? []).toHaveLength(0);
    expect(screen.getByText(/Pick a face to save the note with Ana's mood/)).toBeInTheDocument();
  });

  it("saves the note with the face once one is picked", () => {
    renderPage();
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    fireEvent.change(note, { target: { value: "Slept badly" } });
    fireEvent.blur(note);
    fireEvent.click(faces().getByRole("button", { name: "Good" }));

    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ memberId: "m1", date: today, score: 4, note: "Slept badly" });
    expect(stored[0].isPlaceholder).toBeUndefined();
    expect(checkIns()).toMatch(/^Check-ins1/);
  });

  it("shows an older build's note-only placeholder as no mood, not Neutral, and doesn't count it", () => {
    useWorkspaceStore.setState({
      moodEntries: [
        {
          id: "p1",
          memberId: "m1",
          date: today,
          score: 3,
          note: "Slept badly",
          isPlaceholder: true,
        },
      ],
    });
    renderPage();
    expect(faces().getByRole("button", { name: "Neutral" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    const cells = screen.getAllByRole("button", { name: /^Ana, / });
    const cell = cells[cells.length - 1];
    expect(cell.getAttribute("data-mood")).toBe("note-only");
    expect(cell).toHaveAccessibleName(/note only$/);
    expect(checkIns()).toMatch(/^Check-ins0/);

    // Picking a face makes it the real check-in, under the same id.
    fireEvent.click(faces().getByRole("button", { name: "Low" }));
    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "p1", score: 2, note: "Slept badly" });
    expect(stored[0].isPlaceholder).toBeUndefined();
  });
});
