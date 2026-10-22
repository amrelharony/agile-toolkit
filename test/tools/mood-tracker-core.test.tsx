import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import { MOOD_ACTIONS } from "@/lib/history/event-actions";

/**
 * Mood Tracker gap-filling: the chart text's edge cases, adding members,
 * logging and changing a mood, a note attached to a mood, the KPIs, Recent
 * Notes, the heatmap and the CSV. (Note-only placeholder entries are
 * covered by mood-tracker-fixes.test.tsx.)
 */

type MoodRow = {
  id: string;
  memberId: string;
  date: string;
  score: 1 | 2 | 3 | 4 | 5;
  note?: string;
  isPlaceholder?: boolean;
};

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  sonify: vi.fn(),
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof spies.csv }) => {
    spies.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: spies.sonify }));
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
import { dailyMoodText } from "@/app/(tools)/mood-tracker/chart-text";

const TODAY = todayLocalISO();
const daysAgo = (n: number) => {
  const d = new Date();
  return todayLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
};
const moods = () => (useWorkspaceStore.getState().moodEntries ?? []) as MoodRow[];
const face = (member: string, label: string) =>
  within(screen.getByRole("group", { name: `Mood for ${member}` })).getByRole("button", {
    name: label,
  });
/** A KPI tile's value, found by its label. */
const kpi = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent!;

beforeEach(() => {
  spies.log.mockClear();
  spies.sonify.mockClear();
  spies.csv = undefined;
  useWorkspaceStore.setState({ teamMembers: [], moodEntries: [] });
});

describe("mood chart text", () => {
  it("says nothing is logged for an empty chart", () => {
    const text = dailyMoodText([]);
    expect(text.summary).toBe("No moods logged yet.");
    expect(text.table.rows).toEqual([]);
  });

  it("describes a single day and rounds table cells to two decimals", () => {
    const text = dailyMoodText([{ date: "2026-10-01", avg: 3.456 }]);
    expect(text.summary).toBe("Average mood was 3.5 out of 5 on 2026-10-01.");
    expect(text.table.rows).toEqual([["2026-10-01", 3.46]]);
  });

  it("says a flat run stayed put", () => {
    const text = dailyMoodText([
      { date: "2026-10-01", avg: 4 },
      { date: "2026-10-02", avg: 4 },
    ]);
    expect(text.summary).toBe(
      "Daily average mood stayed at 4 out of 5 over 2 days with entries, from 2026-10-01 to 2026-10-02; lowest 4, highest 4."
    );
  });
});

describe("Mood Tracker members", () => {
  it("asks for a member first, ignores a blank name and adds a trimmed one", () => {
    render(<MoodTrackerClient />);
    expect(screen.getByText("Add a team member to see the heatmap.")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Team member name" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);

    fireEvent.change(input, { target: { value: "  Ana  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(useWorkspaceStore.getState().teamMembers.map((m) => m.name)).toEqual(["Ana"]);
    expect(screen.getByRole("group", { name: "Mood for Ana" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add another team member...")).toHaveValue("");
  });
});

describe("Mood Tracker check-in", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Bo" },
      ],
    });
  });

  it("logs today's mood, and a second pick replaces it rather than adding one", () => {
    render(<MoodTrackerClient />);
    fireEvent.click(face("Ana", "Good"));
    expect(moods()).toEqual([
      expect.objectContaining({ memberId: "m1", date: TODAY, score: 4, note: undefined }),
    ]);
    expect(face("Ana", "Good")).toHaveAttribute("aria-pressed", "true");
    expect(spies.sonify).toHaveBeenCalledWith("mood-tracker", "mood-good");
    expect(spies.log).toHaveBeenCalledWith(MOOD_ACTIONS.MOOD_LOGGED, {
      memberId: "m1",
      score: 4,
      date: TODAY,
      note: undefined,
    });

    fireEvent.click(face("Ana", "Rough"));
    expect(moods()).toHaveLength(1);
    expect(moods()[0].score).toBe(1);
    expect(face("Ana", "Rough")).toHaveAttribute("aria-pressed", "true");
    expect(face("Ana", "Good")).toHaveAttribute("aria-pressed", "false");
    expect(kpi("Check-ins")).toContain("1");
    expect(kpi("14-day Average")).toContain("1.00");
  });

  it("attaches a typed note to the mood picked next, then clears the draft", () => {
    render(<MoodTrackerClient />);
    const note = screen.getByRole("textbox", { name: "Note for Bo" });
    fireEvent.change(note, { target: { value: "  Shipped it!  " } });
    fireEvent.click(face("Bo", "Great"));
    expect(moods()).toEqual([
      expect.objectContaining({ memberId: "m2", score: 5, note: "Shipped it!" }),
    ]);
    // The box now shows the saved note, not a separate draft.
    expect(note).toHaveValue("Shipped it!");
    expect(screen.getByText("Recent Notes")).toBeInTheDocument();
  });

  it("edits the note of a logged mood on blur", () => {
    useWorkspaceStore.setState({
      moodEntries: [{ id: "e1", memberId: "m1", date: TODAY, score: 3, note: "Meh" }],
    });
    render(<MoodTrackerClient />);
    const note = screen.getByRole("textbox", { name: "Note for Ana" });
    expect(note).toHaveValue("Meh");
    fireEvent.change(note, { target: { value: "   " } });
    fireEvent.blur(note);
    expect(moods()[0]).toMatchObject({ id: "e1", score: 3, note: undefined });
  });
});

describe("Mood Tracker analytics", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Bo" },
      ],
    });
  });

  it("averages the daily averages of the last 14 days and reads the trend", () => {
    useWorkspaceStore.setState({
      moodEntries: [
        // Outside the 14-day window: ignored.
        { id: "old", memberId: "m1", date: daysAgo(20), score: 1 },
        { id: "a", memberId: "m1", date: daysAgo(3), score: 2 },
        { id: "b", memberId: "m2", date: daysAgo(3), score: 4 },
        { id: "c", memberId: "m1", date: daysAgo(2), score: 4 },
        { id: "d", memberId: "m2", date: daysAgo(1), score: 5 },
        // A note-only placeholder never counts.
        { id: "p", memberId: "m1", date: TODAY, score: 3, isPlaceholder: true, note: "x" },
      ],
    });
    render(<MoodTrackerClient />);
    // Daily averages 3, 4, 5 → 4.00, rising.
    expect(kpi("14-day Average")).toContain("4.00");
    expect(kpi("Trend")).toContain("rising");
    expect(kpi("Check-ins")).toContain("5");
    expect(
      screen.getByText(/^Daily average mood rose from 3 to 5 out of 5 over 3 days/)
    ).toBeInTheDocument();
  });

  it("shows zero and flat with no moods yet", () => {
    render(<MoodTrackerClient />);
    expect(kpi("14-day Average")).toContain("0.00");
    expect(kpi("Trend")).toContain("flat");
    expect(screen.queryByText("Daily-average mood")).toBeNull();
    expect(screen.queryByText("Recent Notes")).toBeNull();
  });

  it("lists the five newest notes, newest first", () => {
    useWorkspaceStore.setState({
      moodEntries: Array.from({ length: 7 }, (_, i) => ({
        id: `n${i}`,
        memberId: i % 2 ? "m2" : "m1",
        date: daysAgo(i),
        score: 4 as const,
        note: `Note ${i}`,
      })),
    });
    render(<MoodTrackerClient />);
    const list = screen.getByText("Recent Notes").closest("div")!.parentElement!;
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.lastElementChild?.textContent)).toEqual([
      "Note 0",
      "Note 1",
      "Note 2",
      "Note 3",
      "Note 4",
    ]);
    expect(items[1]).toHaveTextContent(`Good·Bo·${daysAgo(1)}`);
  });

  it("draws a 14-day heatmap row per member, coloured by mood", () => {
    useWorkspaceStore.setState({
      moodEntries: [
        { id: "a", memberId: "m1", date: TODAY, score: 2, note: "Tired" },
        { id: "b", memberId: "m2", date: daysAgo(13), score: 5 },
        { id: "c", memberId: "m2", date: daysAgo(14), score: 1 },
      ],
    });
    const { container } = render(<MoodTrackerClient />);
    const cells = container.querySelectorAll("[data-mood]");
    expect(cells).toHaveLength(28);
    expect(screen.getByText(TODAY.slice(5))).toBeInTheDocument();
    expect(screen.getByText(daysAgo(13).slice(5))).toBeInTheDocument();
    expect(screen.queryByText(daysAgo(14).slice(5))).toBeNull();

    const ana = container.querySelector(`[title^="Ana — ${TODAY}"]`)!;
    expect(ana).toHaveAttribute("data-mood", "2");
    expect(ana.getAttribute("title")).toBe(`Ana — ${TODAY} — 2/5\nTired`);
    expect(container.querySelector(`[title^="Bo — ${daysAgo(13)}"]`)).toHaveAttribute(
      "data-mood",
      "5"
    );
    expect(container.querySelectorAll('[data-mood="none"]')).toHaveLength(26);
  });

  it("exports every entry as CSV with member names, placeholders without a score", () => {
    useWorkspaceStore.setState({
      moodEntries: [
        { id: "a", memberId: "m1", date: TODAY, score: 2, note: "Tired" },
        { id: "p", memberId: "m2", date: TODAY, score: 3, isPlaceholder: true, note: "Later" },
        { id: "x", memberId: "gone", date: TODAY, score: 5 },
      ],
    });
    render(<MoodTrackerClient />);
    expect(spies.csv).toEqual({
      headers: ["Date", "Member", "Score", "Note"],
      rows: [
        [TODAY, "Ana", 2, "Tired"],
        [TODAY, "Bo", "", "Later"],
        [TODAY, "gone", 5, ""],
      ],
    });
  });
});
