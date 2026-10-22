import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import type { Epic } from "@/lib/stores/workspace-types";

/**
 * Epic Roadmap: a synced singleton of epics drawn on a quarter grid. Covers
 * the quarter range parser (Q4 year boundary, invalid / reversed ranges, the
 * 40-quarter cap), bar placement, adding / editing / removing epics, the
 * progress cell's clamp-and-revert rules, the linear "next epic" projection,
 * the colour whitelist, the cross-tool callout and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof exported.csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { EpicRoadmapClient } from "@/app/(tools)/epic-roadmap/epic-roadmap-client";

const ER_ID = "epicRoadmap:current";

const epic = (id: string, over: Partial<Epic> = {}): Epic => ({
  id,
  title: `Epic ${id}`,
  startQuarter: "2026 Q1",
  endQuarter: "2026 Q4",
  progress: 0,
  color: "#a855f7",
  ...over,
});

const seed = (epics: Epic[]) =>
  useWorkspaceStore.setState({ epicRoadmaps: [{ id: ER_ID, epics }] });
const epics = () =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];

const headers = () =>
  Array.from(document.querySelectorAll(".font-data.uppercase.tracking-wider")).map(
    (el) => el.textContent
  );

/** Number of grid cells an epic's bar covers. */
function barCells(container: HTMLElement): number {
  return container.querySelectorAll(".py-3 > .h-4").length;
}

function setRange(from: string, to: string) {
  fireEvent.change(screen.getByLabelText("View from"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("View to"), { target: { value: to } });
}

function sprintEvent(id: string, daysAgo: number): HistoryEvent {
  return {
    id,
    clientEventId: id,
    clientId: "c",
    toolRunId: "r",
    userId: null,
    toolId: "velocity",
    action: "sprint_added",
    payload: {},
    occurredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  } as HistoryEvent;
}

beforeEach(() => {
  history.log.mockClear();
  exported.csv = undefined;
  useWorkspaceStore.setState({ epicRoadmaps: [] });
  useHistoryStore.setState({ events: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Epic Roadmap: quarter range", () => {
  it("defaults to this year's four quarters with an empty prompt", () => {
    render(<EpicRoadmapClient />);
    expect(screen.getByLabelText("View from")).toHaveValue("2026 Q1");
    expect(screen.getByLabelText("View to")).toHaveValue("2026 Q4");
    expect(headers()).toEqual(["2026 Q1", "2026 Q2", "2026 Q3", "2026 Q4"]);
    expect(screen.getByText("Add epics to populate the roadmap.")).toBeInTheDocument();
  });

  it("keeps Q4 in its own year when the range crosses a year boundary", () => {
    render(<EpicRoadmapClient />);
    setRange("2026 Q3", "2027 q2");
    expect(headers()).toEqual(["2026 Q3", "2026 Q4", "2027 Q1", "2027 Q2"]);
  });

  it.each([
    ["an unparsable quarter", "2026 Q5", "2026 Q4"],
    ["a reversed range", "2027 Q1", "2026 Q4"],
    ["a year before 1900", "1899 Q1", "1899 Q4"],
    ["a year after 2200", "2201 Q1", "2201 Q2"],
  ])("shows the range hint for %s", (_label, from, to) => {
    render(<EpicRoadmapClient />);
    setRange(from, to);
    expect(screen.getByText(/Set a valid quarter range/)).toBeInTheDocument();
    expect(headers()).toEqual([]);
  });

  it("caps the grid at 40 quarters and says so", () => {
    render(<EpicRoadmapClient />);
    setRange("2026 Q1", "2040 Q4");
    const h = headers();
    expect(h).toHaveLength(40);
    expect(h.at(-1)).toBe("2035 Q4");
    expect(screen.getByText(/Showing the first 40 quarters of 60 requested/)).toBeInTheDocument();
  });
});

describe("Epic Roadmap: bars", () => {
  it("spans the epic's quarters and labels its progress in the middle cell", () => {
    seed([epic("a", { startQuarter: "2026 Q2", endQuarter: "2026 Q3", progress: 50 })]);
    const { container } = render(<EpicRoadmapClient />);
    expect(barCells(container)).toBe(2);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("clips an epic that starts before the view to the visible quarters", () => {
    seed([epic("a", { startQuarter: "2025 Q3", endQuarter: "2026 Q2" })]);
    const { container } = render(<EpicRoadmapClient />);
    expect(barCells(container)).toBe(2);
  });

  it("draws nothing for an epic outside the view or with an unparsable quarter", () => {
    seed([
      epic("past", { startQuarter: "2025 Q1", endQuarter: "2025 Q2" }),
      epic("tbd", { startQuarter: "TBD", endQuarter: "2026 Q2" }),
    ]);
    const { container } = render(<EpicRoadmapClient />);
    expect(barCells(container)).toBe(0);
    expect(screen.getAllByLabelText("Epic title")).toHaveLength(2);
  });

  it("falls back to the accent colour for a colour outside the whitelist", () => {
    seed([epic("a", { color: "red;background:url(https://x.test/a.png)" })]);
    const { container } = render(<EpicRoadmapClient />);
    const dot = container.querySelector(".w-2.h-2.rounded-full") as HTMLElement;
    expect(dot.style.background).toMatch(/#00f0ff|rgb\(0, 240, 255\)/i);
  });
});

describe("Epic Roadmap: editing", () => {
  it("adds epics over the current view with rotating colours", () => {
    render(<EpicRoadmapClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Epic/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Epic/ }));
    const list = epics();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      title: "New epic",
      startQuarter: "2026 Q1",
      endQuarter: "2026 Q4",
      progress: 0,
      color: "#00f0ff",
    });
    expect(list[1].color).toBe("#a855f7");
    expect(history.log).toHaveBeenCalledWith(
      "epic_added",
      expect.objectContaining({ title: "New epic" })
    );
    expect(screen.queryByText("Add epics to populate the roadmap.")).toBeNull();
  });

  it("commits a title on blur and logs it once", () => {
    seed([epic("a", { title: "Billing" })]);
    render(<EpicRoadmapClient />);
    const title = screen.getByLabelText("Epic title");
    fireEvent.change(title, { target: { value: "Billing v2" } });
    expect(epics()[0].title).toBe("Billing");
    fireEvent.blur(title);
    expect(epics()[0].title).toBe("Billing v2");
    expect(history.log).toHaveBeenCalledWith("epic_updated", { epicId: "a", fields: ["title"] });
    history.log.mockClear();
    fireEvent.blur(title);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("stores a whitespace-only description as undefined", () => {
    seed([epic("a", { description: "Old notes" })]);
    render(<EpicRoadmapClient />);
    const desc = screen.getByLabelText("Epic description");
    expect(desc).toHaveValue("Old notes");
    fireEvent.change(desc, { target: { value: "   " } });
    fireEvent.blur(desc);
    expect(epics()[0].description).toBeUndefined();
    expect(history.log).toHaveBeenCalledWith("epic_updated", {
      epicId: "a",
      fields: ["description"],
    });
  });

  it("clamps progress to 0..100 on blur", () => {
    seed([epic("a", { title: "Billing", progress: 40 })]);
    render(<EpicRoadmapClient />);
    const cell = screen.getByLabelText("Progress % for Billing");
    fireEvent.change(cell, { target: { value: "150" } });
    fireEvent.blur(cell);
    expect(epics()[0].progress).toBe(100);
    expect(cell).toHaveValue(100);
    fireEvent.change(cell, { target: { value: "-5" } });
    fireEvent.blur(cell);
    expect(epics()[0].progress).toBe(0);
    expect(history.log).toHaveBeenCalledWith("epic_updated", {
      epicId: "a",
      fields: ["progress"],
    });
  });

  it("commits progress on Enter", () => {
    seed([epic("a", { title: "Billing", progress: 40 })]);
    render(<EpicRoadmapClient />);
    const cell = screen.getByLabelText("Progress % for Billing");
    cell.focus();
    fireEvent.change(cell, { target: { value: "65" } });
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(epics()[0].progress).toBe(65);
  });

  // Bug: Number("") is 0, so clearing the field and tabbing away silently
  // zeroed the epic's progress instead of restoring it.
  it("restores the saved progress when the field is left empty", () => {
    seed([epic("a", { title: "Billing", progress: 40 })]);
    render(<EpicRoadmapClient />);
    const cell = screen.getByLabelText("Progress % for Billing");
    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);
    expect(epics()[0].progress).toBe(40);
    expect(cell).toHaveValue(40);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("removes exactly the clicked epic", () => {
    seed([epic("a", { title: "Keep" }), epic("b", { title: "Drop" })]);
    render(<EpicRoadmapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Drop" }));
    expect(epics().map((e) => e.id)).toEqual(["a"]);
    expect(history.log).toHaveBeenCalledWith("epic_removed", { epicId: "b", title: "Drop" });
  });
});

describe("Epic Roadmap: projection, callout and export", () => {
  const projection = () => screen.queryByText(/Projected progress of next epic/);

  it("needs two dated epics before projecting", () => {
    seed([epic("a", { progress: 70 }), epic("b", { startQuarter: "someday", progress: 10 })]);
    render(<EpicRoadmapClient />);
    expect(projection()).toBeNull();
  });

  it("projects one quarter past the last epic on the quarter axis", () => {
    seed([
      epic("a", { startQuarter: "2026 Q2", progress: 50 }),
      epic("b", { startQuarter: "2026 Q1", progress: 70 }),
    ]);
    render(<EpicRoadmapClient />);
    expect(projection()!.textContent).toMatch(/: 30%$/);
  });

  it("clamps the projection to 100%", () => {
    seed([
      epic("a", { startQuarter: "2026 Q1", progress: 0 }),
      epic("b", { startQuarter: "2026 Q2", progress: 80 }),
    ]);
    render(<EpicRoadmapClient />);
    expect(projection()!.textContent).toMatch(/: 100%$/);
  });

  it("flags recent sprint and OKR activity", () => {
    useHistoryStore.setState({ events: [sprintEvent("s1", 3), sprintEvent("s2", 20)] });
    render(<EpicRoadmapClient />);
    expect(screen.getByText(/^1 sprint added, 0 OKR updates in last 14 days/)).toBeInTheDocument();
  });

  it("exports one CSV row per epic", () => {
    seed([
      epic("a", {
        title: "Billing",
        description: "Invoices",
        startQuarter: "2026 Q2",
        endQuarter: "2026 Q3",
        progress: 35,
        owner: "Ana",
      }),
    ]);
    render(<EpicRoadmapClient />);
    expect(exported.csv?.rows).toEqual([
      ["Billing", "Invoices", "2026 Q2", "2026 Q3", "35%", "Ana"],
    ]);
  });
});
