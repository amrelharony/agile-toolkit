import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { retroFormats } from "@/lib/constants/retro-formats";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry, RetroBoard, RetroCard, Sprint } from "@/lib/stores/workspace-types";

/**
 * The Emotional Seismograph on the Retro board: the format's three bands,
 * the view only on this format, a day set per card (logged), what it
 * leaves off the chart (cards a live room hides, a sent retro action), the
 * team's mood strip and its toggle, and the days in the exports.
 */

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log, toolRunId: "test-run" }),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "", json: null as unknown }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, jsonData }: { markdown?: string; jsonData?: unknown }) => {
    exported.markdown = markdown ?? "";
    exported.json = jsonData ?? null;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: vi.fn(),
}));
// Recharts has nothing to measure in jsdom: the sentences and tables are tested.
vi.mock("@/app/(tools)/retro/components/seismograph-chart", () => ({
  SeismographChart: () => null,
  MoodStripChart: () => null,
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { RetroClient } from "@/app/(tools)/retro/retro-client";
import { SeismographView } from "@/app/(tools)/retro/components/seismograph-view";
import { blankRetroBoard } from "@/lib/retro/board";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import { seismographDays } from "@/lib/retro/seismograph";

const SEISMO = retroFormats.find((f) => f.id === "seismograph")!;

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 12",
  startDate: "2026-11-09",
  endDate: "2026-11-20",
  pointsPlanned: 20,
  status: "completed",
};

let n = 0;
function card(over: Partial<RetroCard> = {}): RetroCard {
  n += 1;
  return {
    id: `c${n}`,
    columnKey: "lows",
    text: `Card ${n}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...over,
  };
}

const board = (cards: RetroCard[], over: Partial<RetroBoard> = {}): RetroBoard => ({
  ...blankRetroBoard(SEISMO),
  cards,
  ...over,
});

const wrap = (ui: ReactNode) =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>
    </TooltipProvider>
  );

const current = () =>
  (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === "retro:current");
const view = () =>
  screen.findByRole("heading", { name: "Emotional seismograph" }, { timeout: 3000 });

beforeEach(() => {
  history.log.mockClear();
  exported.markdown = "";
  exported.json = null;
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    retroBoards: [],
    sprints: [],
    moodEntries: [],
    moodPulses: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the format on the board", () => {
  it("has Highs, Steady and Lows, and starts from the format picker", async () => {
    wrap(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: /Emotional Seismograph/ }));
    expect(current()?.format.id).toBe("seismograph");
    for (const label of ["Highs", "Steady", "Lows"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    await view();
  });

  it("shows the view only on this format", async () => {
    useWorkspaceStore.setState({
      retroBoards: [{ ...blankRetroBoard(retroFormats[0]), cards: [card({ columnKey: "stop" })] }],
    });
    wrap(<RetroClient />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("heading", { name: "Emotional seismograph" })).toBeNull();
  });
});

describe("placing the cards", () => {
  it("says to pick the sprint, then draws its days with dates once it has one", async () => {
    useWorkspaceStore.setState({ retroBoards: [board([card({ text: "Outage" })])] });
    wrap(<RetroClient />);
    await view();
    expect(
      screen.getByText("Pick the sprint to draw its days and the team's mood.")
    ).toBeInTheDocument();
    const select = screen.getByLabelText(/Outage/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      "No day",
      ...seismographDays(null).map((d) => d.label),
    ]);
    cleanup();
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      retroBoards: [board([card({ text: "Outage" })], { sprintId: "s1" })],
    });
    wrap(<RetroClient />);
    await view();
    expect(screen.queryByText(/Pick the sprint to draw/)).toBeNull();
    const dated = screen.getByLabelText(/Outage/) as HTMLSelectElement;
    expect(Array.from(dated.options).map((o) => o.text)).toContain("Day 3 · Thu 12 Nov");
  });

  it("sets a card's day, logged, and charts it", async () => {
    const outage = card({ text: "Outage" });
    useWorkspaceStore.setState({ retroBoards: [board([outage, card({ text: "Late" })])] });
    wrap(<RetroClient />);
    await view();
    expect(screen.getByText("2 cards have no day yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Outage/), { target: { value: "4" } });
    expect(current()?.cards.find((c) => c.id === outage.id)?.day).toBe(4);
    expect(history.log).toHaveBeenCalledWith(RETRO_ACTIONS.CARD_EDITED, {
      cardId: outage.id,
      field: "day",
      day: 4,
    });
    const figure = screen.getByRole("figure", { name: "The sprint's highs and lows by day" });
    expect(within(figure).getByText("1 of 2 cards are on a day.")).toBeInTheDocument();
    fireEvent.click(within(figure).getByRole("button", { name: /View as table/ }));
    const rows = within(within(figure).getByRole("table")).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toContain("Day 4LowOutage0");
    // "No day" takes it away again.
    fireEvent.change(screen.getByLabelText(/Outage/), { target: { value: "" } });
    expect("day" in (current()?.cards.find((c) => c.id === outage.id) ?? {})).toBe(false);
  });

  it("keeps a day past the sprint's end as no day on the chart, and shows it in its select", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      retroBoards: [board([card({ text: "Late one", day: 20 })], { sprintId: "s1" })],
    });
    wrap(<RetroClient />);
    await view();
    const select = screen.getByLabelText(/Late one/) as HTMLSelectElement;
    expect(select.value).toBe("20");
    expect(screen.getByRole("option", { name: "Day 20 (past this sprint)" })).toBeInTheDocument();
    expect(current()?.cards[0].day).toBe(20);
  });

  it("hides the day selects in the Actions phase, the chart stays", async () => {
    useWorkspaceStore.setState({
      retroBoards: [board([card({ text: "Outage" })], { phase: "actions" })],
    });
    wrap(<RetroClient />);
    await view();
    expect(screen.queryByLabelText(/Outage/)).toBeNull();
    expect(
      screen.getByRole("figure", { name: "The sprint's highs and lows by day" })
    ).toBeInTheDocument();
    expect(screen.getByText(/1 card has no day, so it isn't on the chart/)).toBeInTheDocument();
  });
});

describe("what the chart leaves out", () => {
  const renderView = (cards: RetroCard[], shown: RetroCard[] = cards) => {
    const onUpdate = vi.fn();
    wrap(
      <SeismographView
        state={{ phase: "write" }}
        shownCards={shown}
        days={seismographDays(null)}
        mood={[]}
        hasSprint={false}
        example={false}
        onUpdate={onUpdate}
        log={vi.fn()}
      />
    );
    return onUpdate;
  };

  it("never charts a card a live room hides from this screen", () => {
    const mine = card({ text: "Host's own" });
    const hidden = card({ text: "Someone's hidden card" });
    renderView([mine, hidden], [mine]);
    expect(screen.getByLabelText(/Host's own/)).toBeInTheDocument();
    expect(screen.queryByText(/Someone's hidden card/)).toBeNull();
  });

  it("leaves out a retro action sent from another tool, and the action items", () => {
    renderView([
      card({ text: "Ours" }),
      card({
        text: "Sent countermeasure",
        isActionItem: true,
        sourceRef: { tool: "root-cause", id: "rca_1" },
      }),
      card({ text: "Kudos seed", columnKey: "highs", sourceRef: { tool: "kudos", id: "k1" } }),
      card({ text: "Our action", isActionItem: true }),
    ]);
    expect(screen.getByLabelText(/Ours/)).toBeInTheDocument();
    for (const text of ["Sent countermeasure", "Kudos seed", "Our action"]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});

describe("the team's mood", () => {
  const entry = (date: string, score: MoodEntry["score"], i: number): MoodEntry => ({
    id: `m${date}${i}`,
    memberId: `p${i}`,
    date,
    score,
  });

  it("draws a strip on its own 1–5 scale for days with 3 check-ins, with a toggle", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      moodEntries: [
        entry("2026-11-15", 2, 1),
        entry("2026-11-15", 2, 2),
        entry("2026-11-15", 2, 3),
        entry("2026-11-16", 5, 1),
      ],
      retroBoards: [board([card({ text: "Outage", day: 2 })], { sprintId: "s1" })],
    });
    wrap(<RetroClient />);
    await view();
    const strip = screen.getByRole("figure", { name: "Team mood, 1–5" });
    expect(
      within(strip).getByText("Team mood, 1–5, on 1 day with at least 3 check-ins.")
    ).toBeInTheDocument();
    // The day the mood dipped with no card on it is named in the read.
    expect(
      screen.getByText(/The team's mood dipped on day 6 and no card says why: ask about it\./)
    ).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Team mood" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("figure", { name: "Team mood, 1–5" })).toBeNull();
  });

  it("says when no day has enough check-ins, and shows none on a board with no sprint", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      moodEntries: [entry("2026-11-15", 2, 1)],
      retroBoards: [board([card()], { sprintId: "s1" })],
    });
    wrap(<RetroClient />);
    await view();
    expect(screen.getByText(/none has that many yet/)).toBeInTheDocument();
    cleanup();
    useWorkspaceStore.setState({ retroBoards: [board([card()])] });
    wrap(<RetroClient />);
    await view();
    expect(screen.queryByRole("button", { name: "Team mood" })).toBeNull();
  });
});

describe("the exports", () => {
  it("carry the days in the Markdown and the JSON on this board", async () => {
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      retroBoards: [
        board([card({ text: "Outage", day: 3, votes: 2 }), card({ text: "Waiting" })], {
          sprintId: "s1",
        }),
      ],
    });
    wrap(<RetroClient />);
    await view();
    await waitFor(() => expect(exported.markdown).toContain("## Seismograph"));
    expect(exported.markdown).toContain("- Day 3 (Thu 12 Nov): ▼ Outage (2 votes)");
    expect(exported.markdown).toContain("No day: ▼ Waiting");
    const json = exported.json as { columns: { label: string; cards: { day?: number }[] }[] };
    expect(json.columns.find((c) => c.label === "Lows")?.cards.map((c) => c.day)).toEqual([
      3,
      undefined,
    ]);
  });

  it("leave days out on any other board", async () => {
    useWorkspaceStore.setState({
      retroBoards: [
        { ...blankRetroBoard(retroFormats[0]), cards: [card({ columnKey: "stop", day: 3 })] },
      ],
    });
    wrap(<RetroClient />);
    await waitFor(() => expect(exported.markdown).toContain("## Stop"));
    expect(exported.markdown).not.toContain("Seismograph");
    const json = exported.json as { columns: { cards: object[] }[] };
    expect(json.columns[1].cards[0]).not.toHaveProperty("day");
  });
});
