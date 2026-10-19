import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Mood Tracker: typing a note before picking a face saves a placeholder
 * entry with a stand-in score of 3. It must render as "no mood", not as
 * Neutral (yellow) on the heatmap, the face buttons or Recent Notes, and
 * must not count as a check-in.
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
const todayCell = (container: HTMLElement) =>
  container.querySelector(`[title^="Ana — ${today}"]`) as HTMLElement;
const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

beforeEach(() => {
  useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }], moodEntries: [] });
});

describe("Mood Tracker note-only entries", () => {
  it("shows a note typed before a face as no mood, not Neutral", () => {
    const { container } = render(<MoodTrackerClient />);
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    fireEvent.change(note, { target: { value: "Slept badly" } });
    fireEvent.blur(note);

    // The note is kept, as a placeholder…
    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ note: "Slept badly", isPlaceholder: true });

    // …but nothing reads it as Neutral.
    expect(screen.getByRole("button", { name: "Neutral" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    const cell = todayCell(container);
    expect(cell.getAttribute("data-mood")).toBe("note-only");
    expect(cell.style.background).toBe("transparent");
    expect(cell.title).toContain("no mood picked");
    expect(cell.title).not.toContain("3/5");

    const recent = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Slept badly"))!;
    expect(recent.textContent).toContain("No mood");
    expect(recent.textContent).not.toContain("Neutral");

    expect(card("Check-ins")).toBe("Check-ins0");
    expect(screen.getByText(/Pick a face to log Ana's mood for today/)).toBeInTheDocument();
  });

  it("logs the real mood once a face is picked, keeping the note", () => {
    const { container } = render(<MoodTrackerClient />);
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    fireEvent.change(note, { target: { value: "Slept badly" } });
    fireEvent.blur(note);
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    const stored = useWorkspaceStore.getState().moodEntries ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ score: 4, note: "Slept badly", isPlaceholder: false });
    expect(todayCell(container).getAttribute("data-mood")).toBe("4");
    expect(card("Check-ins")).toBe("Check-ins1");
  });

  it("drops a note-only entry when its note is cleared", () => {
    render(<MoodTrackerClient />);
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    fireEvent.change(note, { target: { value: "Slept badly" } });
    fireEvent.blur(note);
    fireEvent.change(note, { target: { value: "" } });
    fireEvent.blur(note);
    expect(useWorkspaceStore.getState().moodEntries ?? []).toHaveLength(0);
  });
});
