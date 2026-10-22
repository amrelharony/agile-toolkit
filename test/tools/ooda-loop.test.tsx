import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { OODACycle } from "@/lib/stores/workspace-types";

/**
 * OODA Loop Tracker: starting a cycle, the per-stage commit-on-blur
 * textareas, completing and removing cycles, ordering, the start-time stamp
 * and the CSV export.
 */

type Csv = { headers: string[]; rows: unknown[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));

// A zone well away from UTC (no DST), so a UTC-vs-local mix-up shows on any
// machine, including a CI box that runs in UTC.
beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Tokyo");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

import { OodaLoopClient } from "@/app/(tools)/ooda-loop/ooda-loop-client";
import { OODA_ACTIONS } from "@/lib/history/event-actions";

const cycle = (id: string, topic: string, over: Partial<OODACycle> = {}): OODACycle => ({
  id,
  topic,
  startedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const stored = () => useWorkspaceStore.getState().oodaCycles ?? [];
const byId = (id: string) => stored().find((c) => c.id === id);

/** The card for a cycle topic. */
const card = (topic: string) => screen.getByText(topic, { selector: "span" }).closest("li")!;

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  useWorkspaceStore.setState({ oodaCycles: [], whiteboardObjects: [] });
});

describe("OODA — starting a cycle", () => {
  it("shows only the start form when there are no cycles", () => {
    render(<OodaLoopClient />);
    expect(screen.getByLabelText("Topic / situation")).toHaveValue("");
    expect(screen.queryByText(/^Cycles \(/)).not.toBeInTheDocument();
  });

  it("ignores Start with a blank or whitespace-only topic", () => {
    render(<OodaLoopClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.change(screen.getByLabelText("Topic / situation"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(stored()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("starts a cycle with a trimmed topic and clears the input", () => {
    render(<OodaLoopClient />);
    fireEvent.change(screen.getByLabelText("Topic / situation"), {
      target: { value: "  Competitor price cut  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(stored()).toHaveLength(1);
    const c = stored()[0];
    expect(c.topic).toBe("Competitor price cut");
    expect(c.completedAt).toBeUndefined();
    expect(Number.isNaN(Date.parse(c.startedAt))).toBe(false);
    expect(screen.getByLabelText("Topic / situation")).toHaveValue("");
    expect(screen.getByText("Cycles (1)")).toBeInTheDocument();
    expect(card("Competitor price cut")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(OODA_ACTIONS.CYCLE_STARTED, {
      topic: "Competitor price cut",
    });
  });
});

describe("OODA — cycles list", () => {
  it("lists cycles newest first without reordering the store", () => {
    useWorkspaceStore.setState({
      oodaCycles: [
        cycle("old", "Oldest", { startedAt: "2026-09-01T09:00:00.000Z" }),
        cycle("new", "Newest", { startedAt: "2026-10-05T09:00:00.000Z" }),
        cycle("mid", "Middle", { startedAt: "2026-09-20T09:00:00.000Z" }),
      ],
    });
    render(<OodaLoopClient />);
    const topics = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("span")?.textContent);
    expect(topics).toEqual(["Newest", "Middle", "Oldest"]);
    expect(stored().map((c) => c.id)).toEqual(["old", "new", "mid"]);
  });

  // Bug: the stamp was `startedAt.slice(0, 16)` — the UTC clock time,
  // unlabeled, so it was hours off for anyone outside UTC.
  it("shows the start time in local time", () => {
    useWorkspaceStore.setState({
      oodaCycles: [cycle("c1", "Outage", { startedAt: "2026-10-18T23:30:00.000Z" })],
    });
    render(<OodaLoopClient />);
    // 23:30 UTC is 08:30 the next day in Tokyo.
    expect(within(card("Outage")).getByText("2026-10-19 08:30")).toBeInTheDocument();
  });

  it("renders a cycle with a missing start time without crashing", () => {
    useWorkspaceStore.setState({
      oodaCycles: [cycle("c1", "Legacy", { startedAt: undefined as unknown as string })],
    });
    render(<OodaLoopClient />);
    expect(card("Legacy")).toBeInTheDocument();
  });

  it("shows each stage's saved text", () => {
    useWorkspaceStore.setState({
      oodaCycles: [
        cycle("c1", "Outage", {
          observe: "p95 latency up 3x",
          orient: "Cache eviction storm",
          decide: "Roll back",
          act: "Rolled back at 10:05",
        }),
      ],
    });
    render(<OodaLoopClient />);
    const c = card("Outage");
    expect(within(c).getByLabelText("Observe")).toHaveValue("p95 latency up 3x");
    expect(within(c).getByLabelText("Orient")).toHaveValue("Cache eviction storm");
    expect(within(c).getByLabelText("Decide")).toHaveValue("Roll back");
    expect(within(c).getByLabelText("Act")).toHaveValue("Rolled back at 10:05");
  });
});

describe("OODA — stage editing", () => {
  it("commits a stage on blur, not on every keystroke", () => {
    useWorkspaceStore.setState({ oodaCycles: [cycle("c1", "Outage")] });
    render(<OodaLoopClient />);
    const observe = within(card("Outage")).getByLabelText("Observe");
    fireEvent.change(observe, { target: { value: "Errors" } });
    fireEvent.change(observe, { target: { value: "Errors spiking" } });
    expect(byId("c1")?.observe).toBeUndefined();
    expect(history.log).not.toHaveBeenCalled();
    fireEvent.blur(observe);
    expect(byId("c1")?.observe).toBe("Errors spiking");
    expect(history.log).toHaveBeenCalledTimes(1);
    expect(history.log).toHaveBeenCalledWith(OODA_ACTIONS.STAGE_UPDATED, {
      id: "c1",
      field: "observe",
    });
  });

  it("doesn't write when a stage is blurred unchanged", () => {
    useWorkspaceStore.setState({ oodaCycles: [cycle("c1", "Outage", { orient: "Known" })] });
    render(<OodaLoopClient />);
    const before = stored();
    fireEvent.blur(within(card("Outage")).getByLabelText("Orient"));
    expect(stored()).toBe(before);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("committing a second stage keeps the first (no stale-closure revert)", () => {
    useWorkspaceStore.setState({ oodaCycles: [cycle("c1", "Outage")] });
    render(<OodaLoopClient />);
    const c = card("Outage");
    fireEvent.change(within(c).getByLabelText("Observe"), { target: { value: "Errors up" } });
    fireEvent.change(within(c).getByLabelText("Orient"), { target: { value: "Bad deploy" } });
    fireEvent.blur(within(c).getByLabelText("Observe"));
    fireEvent.blur(within(c).getByLabelText("Orient"));
    expect(byId("c1")).toMatchObject({ observe: "Errors up", orient: "Bad deploy" });
  });

  it("lets a stage be cleared", () => {
    useWorkspaceStore.setState({ oodaCycles: [cycle("c1", "Outage", { decide: "Roll back" })] });
    render(<OodaLoopClient />);
    const decide = within(card("Outage")).getByLabelText("Decide");
    fireEvent.change(decide, { target: { value: "" } });
    fireEvent.blur(decide);
    expect(byId("c1")?.decide).toBe("");
    expect(decide).toHaveValue("");
  });

  it("edits only the cycle whose stage changed", () => {
    useWorkspaceStore.setState({
      oodaCycles: [
        cycle("a", "Alpha", { startedAt: "2026-10-02T09:00:00.000Z" }),
        cycle("b", "Bravo", { startedAt: "2026-10-01T09:00:00.000Z" }),
      ],
    });
    render(<OodaLoopClient />);
    const act = within(card("Bravo")).getByLabelText("Act");
    fireEvent.change(act, { target: { value: "Shipped fix" } });
    fireEvent.blur(act);
    expect(byId("b")?.act).toBe("Shipped fix");
    expect(byId("a")?.act).toBeUndefined();
  });

  it("refreshes a stage when the stored value changes from elsewhere", () => {
    useWorkspaceStore.setState({ oodaCycles: [cycle("c1", "Outage", { observe: "v1" })] });
    render(<OodaLoopClient />);
    const observe = within(card("Outage")).getByLabelText("Observe");
    expect(observe).toHaveValue("v1");
    // e.g. an agent's advance_phase or a synced edit from another tab
    act(() => {
      useWorkspaceStore.getState().upsertOODACycle({ ...byId("c1")!, observe: "v2 from agent" });
    });
    expect(observe).toHaveValue("v2 from agent");
  });
});

describe("OODA — complete and remove", () => {
  it("completing a cycle stamps completedAt, keeps its stages and hides the button", () => {
    useWorkspaceStore.setState({
      oodaCycles: [cycle("c1", "Outage", { observe: "Errors" }), cycle("c2", "Pricing")],
    });
    render(<OodaLoopClient />);
    fireEvent.click(screen.getByRole("button", { name: "Mark cycle complete: Outage" }));

    const done = byId("c1")!;
    expect(Number.isNaN(Date.parse(done.completedAt!))).toBe(false);
    expect(done.observe).toBe("Errors");
    expect(byId("c2")?.completedAt).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Mark cycle complete: Outage" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark cycle complete: Pricing" })).toBeVisible();
    expect(history.log).toHaveBeenCalledWith(OODA_ACTIONS.CYCLE_COMPLETED, { topic: "Outage" });
    expect(signals.emit).toHaveBeenCalledWith({
      kind: "ooda.cycleCompleted",
      at: done.completedAt,
      toolId: "ooda-loop",
      payload: done,
    });
  });

  it("removes only the clicked cycle", () => {
    useWorkspaceStore.setState({
      oodaCycles: [cycle("c1", "Outage"), cycle("c2", "Pricing")],
    });
    render(<OodaLoopClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove cycle: Outage" }));
    expect(stored().map((c) => c.id)).toEqual(["c2"]);
    expect(screen.getByText("Cycles (1)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(OODA_ACTIONS.CYCLE_REMOVED, { id: "c1" });
  });
});

describe("OODA — CSV export", () => {
  it("exports one row per cycle with blanks for unfilled stages", () => {
    useWorkspaceStore.setState({
      oodaCycles: [
        cycle("c1", "Outage", {
          observe: "Errors",
          orient: "Bad deploy",
          decide: "Roll back",
          act: "Done",
          completedAt: "2026-10-01T10:00:00.000Z",
        }),
        cycle("c2", "Pricing"),
      ],
    });
    render(<OodaLoopClient />);
    expect(exported.csv?.headers).toEqual([
      "Topic",
      "Started",
      "Observe",
      "Orient",
      "Decide",
      "Act",
      "Completed",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "Outage",
        "2026-10-01T09:00:00.000Z",
        "Errors",
        "Bad deploy",
        "Roll back",
        "Done",
        "2026-10-01T10:00:00.000Z",
      ],
      ["Pricing", "2026-10-01T09:00:00.000Z", "", "", "", "", ""],
    ]);
  });
});
