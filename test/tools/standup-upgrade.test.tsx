import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AsyncUpdate,
  Sprint,
  StandupEntry,
  StandupMode,
  Story,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import { fromAsyncUpdate } from "@/lib/standup/entries";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * Standup + Async standup, merged in Phase 3 (Run the sprint): one entity
 * (StandupEntry with `mode`), /standup in live mode walking the sprint
 * board person by person, /async-standup showing who hasn't posted and the
 * digest. Old AsyncUpdate rows show alongside and edit into entries;
 * taking someone out of today's standup never touches the team.
 */

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn<(label: string, opts?: ToastOptions) => string>(() => "toast-1"),
    { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }
  )
);
const clip = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<boolean>>(async () => true),
}));
const exported = vi.hoisted(() => ({ byName: new Map<string, string | undefined>() }));
const history = vi.hoisted(() => ({ log: vi.fn(), toolIds: [] as string[] }));

vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  copyToClipboard: clip.copy,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ filename, markdown }: { filename: string; markdown?: string }) => {
    exported.byName.set(filename, markdown);
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: (toolId: string) => {
    history.toolIds.push(toolId);
    return { log: history.log };
  },
}));

import { StandupClient, AWAY_KEY } from "@/app/(tools)/standup/standup-client";
import { buildExample, buildExampleBoard, EXAMPLE_MEMBERS } from "@/app/(tools)/standup/example";
import { toMarkdown, weeklyMarkdown } from "@/app/(tools)/standup/markdown";
import { standupVerdict } from "@/app/(tools)/standup/verdict";
import {
  ageLabel,
  ageTone,
  awayOn,
  blockerAgeDays,
  csvRows,
  editedEntry,
  emptyDraft,
  openBlockers,
  participation,
  postedEntry,
  sameEntryText,
  speakingOrder,
  validateEntry,
  withAway,
  ENTRY_TEXT_MAX,
} from "@/app/(tools)/standup/model";
import {
  autoTurnSeconds,
  dropSpeaker,
  nextInLine,
  nextSpeaker,
  pauseTurn,
  resetStandupWalk,
  resumeTurn,
  skipSpeaker,
  startWalk,
  stopOrphanedTurn,
  takeTurn,
  turnClock,
  turnRemaining,
  turnState,
  useStandupWalk,
  withDockState,
} from "@/app/(tools)/standup/walk";
import { participationText } from "@/app/(tools)/standup/participation-chart";
import { MODE_HREF } from "@/app/(tools)/standup/mode-switch";

const TODAY = todayLocalISO();
const day = (n: number) => addDays(TODAY, n);

function entry(
  id: string,
  member: string,
  extra: Partial<StandupEntry> = {},
  date = TODAY
): StandupEntry {
  return {
    id,
    member,
    date,
    yesterday: "y",
    today: "t",
    blockers: "",
    timestamp: Date.now(),
    ...extra,
  };
}

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().standupEntries ?? [];
const byId = (id: string) => stored().find((e) => e.id === id);

function renderStandup(mode: StandupMode = "live") {
  return render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <StandupClient mode={mode} />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
}

const memberInput = () => screen.getByLabelText(/^Team member/);
const todayInput = () => screen.getByPlaceholderText("What will you work on today?");
const yesterdayInput = () => screen.getByPlaceholderText("What did you complete yesterday?");
const speakingOrderList = () => screen.getByRole("list", { name: "Speaking order" });
const card = (member: string) => screen.getByRole("article", { name: `${member}'s update` });
const announced = () => screen.getByTestId("live-polite").textContent ?? "";

/** Click the Undo on the latest toast. */
function undoLast() {
  const opts = toastSpy.mock.calls.at(-1)?.[1];
  act(() => opts?.action?.onClick());
}

function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

beforeEach(() => {
  toastSpy.mockClear();
  clip.copy.mockClear();
  history.log.mockClear();
  history.toolIds = [];
  exported.byName.clear();
  localStorage.clear();
  sessionStorage.clear();
  resetSelectedSprint();
  resetStandupWalk();
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({
    teamMembers: [],
    standupEntries: [],
    asyncUpdates: [],
    sprints: [],
    stories: [],
    impediments: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/*  The form's model                                                          */
/* -------------------------------------------------------------------------- */

describe("validateEntry", () => {
  it("needs a person and today's plan; never a silent default", () => {
    const r = validateEntry(emptyDraft(TODAY), TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      member: "Pick a team member or type a name.",
      today: "Say what's planned for today.",
    });
  });

  it("accepts a backdated day but not a future one or a broken one", () => {
    const base = { ...emptyDraft(day(-2), " Alice "), today: " Fix it " };
    const ok = validateEntry(base, TODAY);
    expect(ok).toEqual({
      ok: true,
      values: {
        member: "Alice",
        date: day(-2),
        yesterday: "",
        today: "Fix it",
        blockers: "",
        notes: "",
      },
    });
    const future = validateEntry({ ...base, date: day(1) }, TODAY);
    expect(!future.ok && future.errors.date).toBe("Pick today or an earlier day.");
    const broken = validateEntry({ ...base, date: "" }, TODAY);
    expect(!broken.ok && broken.errors.date).toBe("Pick the day this update is for.");
  });

  it("caps each field at what the agent actions accept", () => {
    const huge = "x".repeat(ENTRY_TEXT_MAX + 1);
    const r = validateEntry({ ...emptyDraft(TODAY, "Al"), today: "ok", notes: huge }, TODAY);
    expect(!r.ok && r.errors.notes).toMatch(/under 4000/);
  });
});

describe("postedEntry and editedEntry", () => {
  const values = {
    member: "Alice",
    date: TODAY,
    yesterday: "y2",
    today: "t2",
    blockers: "Waiting on keys",
    notes: "",
  };

  it("posts a new entry with its mode, and no empty notes", () => {
    const e = postedEntry(values, "async", undefined, 1000, () => "new-id");
    expect(e).toEqual({
      id: "new-id",
      member: "Alice",
      date: TODAY,
      yesterday: "y2",
      today: "t2",
      blockers: "Waiting on keys",
      timestamp: 1000,
      mode: "async",
    });
  });

  it("replacing keeps the id, first timestamp, and the blocker's state while it is the same blocker", () => {
    const link = { route: "impediment" as const, targetId: "imp-1", at: "2026-10-19T09:00:00Z" };
    const existing = entry("e1", "Alice", {
      blockers: "  Waiting on keys ",
      blockerResolved: true,
      sentTo: [link],
      timestamp: 5,
    });
    const same = postedEntry(values, "live", existing, 9000);
    expect(same).toMatchObject({ id: "e1", timestamp: 5, blockerResolved: true, sentTo: [link] });
    const changed = postedEntry({ ...values, blockers: "Build is red" }, "async", existing, 9000);
    expect(changed).toMatchObject({ id: "e1", timestamp: 5, mode: "async" });
    expect(changed.blockerResolved).toBeUndefined();
    expect(changed.sentTo).toBeUndefined();
  });

  it("edits in place keep id, mode and timestamp; a blank note is dropped", () => {
    const legacy = fromAsyncUpdate({
      id: "au1",
      member: "Bo",
      date: day(-1),
      yesterday: "a",
      today: "b",
      description: "old note",
    });
    const next = editedEntry(legacy, { ...values, member: "Bo", notes: "" });
    expect(next).toMatchObject({ id: "au1", mode: "async", date: day(-1), today: "t2" });
    expect(next.timestamp).toBe(legacy.timestamp);
    expect(next.description).toBeUndefined();
    expect(sameEntryText(next, { ...values, member: "Bo" })).toBe(true);
  });
});

describe("blockers, people and participation", () => {
  it("lists open blockers oldest first, aged by the entry's day", () => {
    const list = [
      entry("a", "A", { blockers: "new" }),
      entry("b", "B", { blockers: "old" }, day(-3)),
      entry("c", "C", { blockers: "done", blockerResolved: true }, day(-5)),
      entry("d", "D", { blockers: "  " }),
    ];
    expect(openBlockers(list).map((e) => e.id)).toEqual(["b", "a"]);
    expect(blockerAgeDays(list[1], TODAY)).toBe(3);
    expect(blockerAgeDays(entry("f", "F", {}, day(2)), TODAY)).toBe(0);
    expect([0, 1, 4].map(ageLabel)).toEqual(["today", "1 day", "4 days"]);
    expect([0, 2, 3].map(ageTone)).toEqual(["fresh", "ageing", "stale"]);
  });

  it("keeps who is out for one day only, matched case-insensitively", () => {
    let away = withAway({ date: "", names: [] }, TODAY, "Bo", true);
    away = withAway(away, TODAY, " bo ", true);
    expect(awayOn(away, TODAY)).toEqual(["bo"]);
    expect(awayOn(away, day(1))).toEqual([]);
    expect(awayOn(withAway(away, TODAY, "BO", false), TODAY)).toEqual([]);
    expect(awayOn(null, TODAY)).toEqual([]);
  });

  it("orders the team, then guests who posted, leaving out people away", () => {
    const entries = [
      entry("g2", "Guest Two", { timestamp: 2 }),
      entry("g1", "Guest One", { timestamp: 1 }),
      entry("a", "alice", { timestamp: 0 }),
      entry("old", "Yesterday Only", {}, day(-1)),
    ];
    expect(speakingOrder(["Alice", "Bo", "Cy"], entries, TODAY, ["cy"])).toEqual([
      "Alice",
      "Bo",
      "Guest One",
      "Guest Two",
    ]);
    expect(speakingOrder([], [], TODAY, [])).toEqual([]);
  });

  it("counts updates per day over two weeks, and averages only with enough days", () => {
    const days = participation(
      [entry("a", "A"), entry("b", "B"), entry("c", "C", {}, day(-13))],
      TODAY
    );
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: day(-13), count: 1 });
    expect(days[13]).toEqual({ date: TODAY, count: 2 });
    expect(participationText(days, 4).summary).toBe("Updates on 2 of the last 14 days.");
    const busy = participation(
      [0, -1, -2].flatMap((n) => [
        entry(`a${n}`, "A", {}, day(n)),
        entry(`b${n}`, "B", {}, day(n)),
      ]),
      TODAY
    );
    expect(participationText(busy, 4).summary).toBe(
      "Updates on 3 of the last 14 days. About 2 a day when people post, for a team of 4."
    );
    expect(participationText(participation([], TODAY), 0).summary).toBe(
      "No updates in the last 14 days."
    );
  });

  it("exports every entry as CSV, newest first, with mode and blocker state", () => {
    const rows = csvRows([
      entry("a", "A", { blockers: "x" }, day(-1)),
      entry("b", "B", { mode: "async", description: "note" }),
    ]);
    expect(rows[0]).toEqual([TODAY, "B", "async", "y", "t", "", "", "note"]);
    expect(rows[1]).toEqual([day(-1), "A", "live", "y", "t", "x", "open", ""]);
  });
});

/* -------------------------------------------------------------------------- */
/*  The walk                                                                   */
/* -------------------------------------------------------------------------- */

describe("the live walk", () => {
  const order = ["Alice", "Bo", "Cy"];

  it("shares the Daily Scrum out, a minute to three each", () => {
    expect(autoTurnSeconds(6)).toBe(150);
    expect(autoTurnSeconds(1)).toBe(180);
    expect(autoTurnSeconds(0)).toBe(180);
    expect(autoTurnSeconds(40)).toBe(60);
    expect([150, 59, -12].map(turnClock)).toEqual(["2:30", "0:59", "+0:12"]);
  });

  it("goes in order, puts the skipped after everyone else, and ends", () => {
    let w = startWalk(order, TODAY, 60, 0);
    expect(w.current).toBe("Alice");
    expect(w.endsAt).toBe(60_000);
    w = skipSpeaker(w, order, 1000);
    expect(w.current).toBe("Bo");
    expect(turnState(w, "Alice")).toBe("skipped");
    w = nextSpeaker(w, order, 2000);
    expect(w.current).toBe("Cy");
    w = nextSpeaker(w, order, 3000);
    // The skipped person comes round again.
    expect(w.current).toBe("Alice");
    w = nextSpeaker(w, order, 4000);
    expect(w.current).toBeNull();
    expect(w.spoken).toEqual(["bo", "cy", "alice"]);
    expect(turnState(w, "Alice")).toBe("spoke");
  });

  it("can't skip the last one waiting, and can give anyone the floor", () => {
    let w = startWalk(["Alice"], TODAY, 60, 0);
    expect(skipSpeaker(w, ["Alice"], 10)).toBe(w);
    w = nextSpeaker(startWalk(order, TODAY, 60, 0), order, 0);
    w = takeTurn(w, "alice", 0);
    expect(w.current).toBe("alice");
    expect(w.spoken).toEqual([]);
    expect(nextInLine(order, w, w.current)).toBe("Bo");
    expect(startWalk([], TODAY, 60, 0).current).toBeNull();
  });

  it("pauses, resumes and counts into overtime", () => {
    let w = startWalk(order, TODAY, 60, 0);
    expect(turnRemaining(w, 70_000)).toBe(-10);
    w = pauseTurn(w, 20_000);
    expect(w).toMatchObject({ endsAt: null, pausedRemaining: 40 });
    expect(turnRemaining(w, 999_999)).toBe(40);
    w = resumeTurn(w, 100_000);
    expect(w.endsAt).toBe(140_000);
  });

  it("takes up a pause made from the docked timer", () => {
    const w = startWalk(order, TODAY, 60, 0);
    const docked = {
      label: "Standup: Alice",
      href: "/standup",
      totalSeconds: 60,
      endsAt: null,
      pausedRemaining: 25,
    };
    expect(withDockState(w, docked)).toMatchObject({ endsAt: null, pausedRemaining: 25 });
    expect(withDockState(w, { ...docked, href: "/ceremony-timer" })).toBe(w);
    expect(withDockState(w, null)).toBe(w);
  });

  const dock = (over: Partial<DockedTimer> = {}): DockedTimer => ({
    label: "Standup: Alice",
    href: "/standup",
    totalSeconds: 60,
    endsAt: null,
    pausedRemaining: 0,
    ...over,
  });

  it("keeps counting overtime when the dock stopped its own clock at 0:00", () => {
    const w = startWalk(order, TODAY, 60, 0);
    // The shell's DockedTimer pauses itself at zero, on every page.
    expect(withDockState(w, dock())).toBe(w);
    expect(turnRemaining(withDockState(w, dock()), 90_000)).toBe(-30);
    expect(withDockState(w, dock({ pausedRemaining: 12 }))).toMatchObject({
      endsAt: null,
      pausedRemaining: 12,
    });
  });

  it("hands the floor on when the speaker is out today, without counting a turn", () => {
    let w = skipSpeaker(startWalk(order, TODAY, 60, 0), order, 0); // Bo speaking
    w = dropSpeaker(w, ["Alice", "Cy"], 5000);
    expect(w).toMatchObject({ current: "Cy", spoken: [], skipped: ["alice"], endsAt: 65_000 });
    w = dropSpeaker(w, ["Alice"], 6000);
    expect(w.current).toBe("Alice");
    expect(dropSpeaker(w, [], 7000).current).toBeNull();
    const done = { ...w, current: null };
    expect(dropSpeaker(done, order, 0)).toBe(done);
  });

  it("remembers the turn length picked, and stops a docked turn with no walk behind it", () => {
    expect(startWalk(order, TODAY, 60, 0, 60).turnChoice).toBe(60);
    expect(startWalk(order, TODAY, 180, 0, "auto").turnChoice).toBe("auto");
    expect("turnChoice" in startWalk(order, TODAY, 60, 0)).toBe(false);

    useDockTimer.setState({ timer: dock() });
    stopOrphanedTurn(null, TODAY);
    expect(useDockTimer.getState().timer).toBeNull();
    useDockTimer.setState({ timer: dock() });
    stopOrphanedTurn(startWalk(order, day(-1), 60, 0), TODAY);
    expect(useDockTimer.getState().timer).toBeNull();

    useDockTimer.setState({ timer: dock() });
    stopOrphanedTurn(startWalk(order, TODAY, 60, 0), TODAY);
    expect(useDockTimer.getState().timer).not.toBeNull();
    const retro = dock({ label: "Retro", href: "/ceremony-timer" });
    useDockTimer.setState({ timer: retro });
    stopOrphanedTurn(null, TODAY);
    expect(useDockTimer.getState().timer).toEqual(retro);
  });
});

/* -------------------------------------------------------------------------- */
/*  Verdict and Markdown                                                      */
/* -------------------------------------------------------------------------- */

describe("standupVerdict", () => {
  const six = ["A", "B", "C", "D", "E", "F"];

  it("says who has posted and how old the oldest blocker is", () => {
    const entries = ["A", "B", "C", "D", "E"].map((m) => entry(m, m));
    entries.push(
      entry("x", "A", { blockers: "old" }, day(-3)),
      entry("y", "B", { blockers: "new" })
    );
    expect(standupVerdict({ entries, expected: six, today: TODAY })).toBe(
      "5 of 6 have posted; 2 open blockers, the oldest 3 days."
    );
  });

  it("covers everyone, nobody, one person and no team", () => {
    const one = [entry("a", "a", { blockers: "b" }, day(-1))];
    expect(standupVerdict({ entries: [], expected: six, today: TODAY })).toBe(
      "None of the 6 have posted yet; no open blockers."
    );
    expect(standupVerdict({ entries: [], expected: ["A"], today: TODAY })).toBe(
      "Nobody has posted yet; no open blockers."
    );
    expect(standupVerdict({ entries: [entry("a", "a")], expected: ["A", "B"], today: TODAY })).toBe(
      "1 of 2 has posted; no open blockers."
    );
    expect(standupVerdict({ entries: [entry("a", "a")], expected: ["A"], today: TODAY })).toBe(
      "Everyone has posted; no open blockers."
    );
    expect(standupVerdict({ entries: one, expected: [], today: TODAY })).toBe(
      "No updates today yet; 1 open blocker, 1 day old."
    );
    expect(
      standupVerdict({
        entries: [entry("a", "a", { blockers: "b" }), entry("c", "c", { blockers: "d" })],
        expected: [],
        today: TODAY,
      })
    ).toBe("2 updates posted today; 2 open blockers, all raised today.");
  });

  it("copes with a big team", () => {
    const team = Array.from({ length: 500 }, (_, i) => `P${i}`);
    const entries = team.slice(0, 499).map((m) => entry(m, m));
    expect(standupVerdict({ entries, expected: team, today: TODAY })).toBe(
      "499 of 500 have posted; no open blockers."
    );
  });
});

describe("standup Markdown", () => {
  const NOW = new Date(2026, 9, 18, 9, 30);

  it("marks async updates, adds notes, and names who hasn't posted", () => {
    const md = toMarkdown(
      [
        entry("a", "Ana", { mode: "async", description: "Out at 3", timestamp: 1 }, "2026-10-18"),
        entry("b", "Bo", { timestamp: 2 }, "2026-10-18"),
      ],
      NOW,
      { notPosted: ["Cy", "Di"] }
    );
    const lines = md.split("\n");
    expect(lines).toContain("Not posted yet: Cy and Di.");
    expect(lines).toContain("### Ana (async)");
    expect(lines).toContain("### Bo");
    expect(lines).toContain("- **Notes:** Out at 3");
    expect(toMarkdown([], NOW, { notPosted: ["Cy"] })).toBe(
      "# Standup — 18 Oct 2026\n\nNo standup updates for today yet.\n\nNot posted yet: Cy.\n"
    );
  });

  it("digests the week per person, with the open blockers and their age", () => {
    const md = weeklyMarkdown(
      [
        entry("a", "Bo", { blockers: "Keys", timestamp: 1 }, "2026-10-15"),
        entry("b", "Ana", { mode: "async", timestamp: 2 }, "2026-10-17"),
        entry("c", "Bo", { blockers: "Fixed", blockerResolved: true }, "2026-10-18"),
        entry("old", "Cy", {}, "2026-10-11"),
      ],
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Standup week — 12 Oct 2026 to 18 Oct 2026");
    expect(lines).toContain(
      "3 updates from 2 people over 3 days; 2 blockers raised, 1 still open."
    );
    expect(lines).toContain("- **Bo** (3 days old): Keys");
    expect(lines.indexOf("## Ana")).toBeLessThan(lines.indexOf("## Bo"));
    expect(lines).toContain("**17 Oct 2026** (async)");
    expect(lines).toContain("- Blockers: Fixed (resolved)");
    expect(md).not.toContain("Cy");
    expect(weeklyMarkdown([], NOW)).toBe(
      "# Standup week — 12 Oct 2026 to 18 Oct 2026\n\nNo standup updates in these 7 days.\n"
    );
  });
});

describe("standup example", () => {
  it("works in both modes and keeps its board out of the workspace", () => {
    const live = buildExample(new Date(), "live");
    const async = buildExample(new Date(), "async");
    expect(live.every((e) => e.mode === "live" && !e.description)).toBe(true);
    expect(async.every((e) => e.mode === "async")).toBe(true);
    expect(async.find((e) => e.member === "Sam (QA)")?.description).toMatch(/dentist/);
    const board = buildExampleBoard();
    expect(board.every((s) => s.id.startsWith("example-"))).toBe(true);
    expect(new Set(board.map((s) => s.owner))).toEqual(new Set(EXAMPLE_MEMBERS));
  });
});

/* -------------------------------------------------------------------------- */
/*  The page: live mode                                                       */
/* -------------------------------------------------------------------------- */

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: day(-3),
  endDate: day(10),
  pointsPlanned: 10,
  status: "active",
};
const STORIES: Story[] = [
  {
    id: "st1",
    title: "Login page",
    status: "in_progress",
    sprintId: "s1",
    owner: "Alice",
    points: 3,
  },
  { id: "st2", title: "Password reset", status: "done", sprintId: "s1", owner: "alice", points: 2 },
  { id: "st3", title: "Audit log", status: "todo", sprintId: "s1", owner: "Bo", blocked: true },
  { id: "st4", title: "Other sprint work", status: "todo", sprintId: "s0", owner: "Alice" },
  { id: "st5", title: "Nobody's yet", status: "todo", sprintId: "s1" },
];

describe("live mode: walking the board", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ],
      sprints: [SPRINT],
      stories: STORIES,
      standupEntries: [entry("prev", "Alice", { today: "Finish the login page" }, day(-1))],
    });
  });

  it("shows each speaker's sprint stories by status, and docks the turn's clock", async () => {
    renderStandup();
    expect(screen.getByRole("heading", { name: "Standup Tracker" })).toBeInTheDocument();
    expect(screen.getByText("1 open story on Sprint 7 has no owner yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));

    expect(screen.getByText(/Speaking now · turn 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In progress: 1" })).toHaveTextContent("Login page");
    expect(screen.getByRole("region", { name: "Done: 1" })).toHaveTextContent("Password reset");
    expect(screen.queryByText("Other sprint work")).toBeNull();
    expect(screen.getByText("Planned on", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the sprint board" })).toHaveAttribute(
      "href",
      "/kanban?sprint=s1"
    );
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Standup: Alice",
      href: "/standup",
      totalSeconds: 180,
    });

    // The form follows the speaker, "yesterday" filled from the last plan.
    expect(memberInput()).toHaveValue("Alice");
    expect(yesterdayInput()).toHaveValue("Finish the login page");
    expect(screen.getByText(/Filled in from the plan for/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next speaker" }));
    await waitFor(() => expect(announced()).toBe("Bo's turn"));
    expect(screen.getByRole("region", { name: "To do: 1" })).toHaveTextContent(
      "Audit log · blocked"
    );
    expect(memberInput()).toHaveValue("Bo");
    expect(useDockTimer.getState().timer?.label).toBe("Standup: Bo");
    expect(within(speakingOrderList()).getAllByText("Spoke").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Pause the turn" }));
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End standup" }));
    expect(useDockTimer.getState().timer).toBeNull();
    expect(screen.getByRole("button", { name: "Start the standup" })).toBeInTheDocument();
  });

  it("keeps skipped people as 'not yet' and gives them a turn after the others", () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    const alice = within(speakingOrderList()).getByText("Alice").closest("li")!;
    expect(alice).toHaveTextContent("Skipped, not yet");
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" })); // Bo done
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" })); // Cy done
    expect(screen.getByText(/Speaking now/).nextSibling).toHaveTextContent("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" }));
    expect(screen.getByText("Everyone has had a turn.")).toBeInTheDocument();
  });

  it("says so when there is nobody else to skip to", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Alice" }] });
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(announced()).toBe("Nobody else is waiting"));
    expect(screen.getByText(/Speaking now/).nextSibling).toHaveTextContent("Alice");
  });

  it("never types over notes not saved yet, and keeps the walk across a remount", () => {
    const view = renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    fireEvent.change(todayInput(), { target: { value: "Pair on the login page" } });
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" }));
    expect(memberInput()).toHaveValue("Alice");
    expect(screen.getByText(/These notes are for Alice/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    expect(stored().find((e) => e.member === "Alice" && e.date === TODAY)).toMatchObject({
      today: "Pair on the login page",
      yesterday: "Finish the login page",
      mode: "live",
    });
    expect(history.log).toHaveBeenCalledWith("entry_added", {
      member: "Alice",
      date: TODAY,
      hasBlocker: false,
    });

    // Saved: the form moves on to the speaker.
    expect(memberInput()).toHaveValue("Bo");

    view.unmount();
    renderStandup();
    expect(screen.getByText(/Speaking now · turn 2 of 3/).nextSibling).toHaveTextContent("Bo");
    expect(memberInput()).toHaveValue("Bo");
  });

  it("leaves another page's docked timer alone", () => {
    const ceremony = {
      label: "Retro",
      href: "/ceremony-timer",
      totalSeconds: 600,
      endsAt: Date.now() + 600_000,
      pausedRemaining: 600,
    };
    useDockTimer.setState({ timer: ceremony });
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    expect(useDockTimer.getState().timer).toEqual(ceremony);
    expect(screen.getByRole("timer")).toHaveAccessibleName("3:00 left");
  });

  it("walks the example's own board without writing it to the workspace", () => {
    useWorkspaceStore.setState({ teamMembers: [], standupEntries: [], stories: [] });
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    expect(screen.getByText("Priya (PM)'s stories on Sprint 5 (example)")).toBeInTheDocument();
    expect(ws().stories).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Speaking now/)).toBeNull();
    expect(stored()).toEqual([]);
  });
});

describe("live mode: not in today's standup", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
      ],
      standupEntries: [entry("a", "Alice")],
    });
  });

  it("skips the day without touching the team, and counts only who's in", async () => {
    renderStandup();
    expect(screen.getByText("1 of 2 has posted; no open blockers.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not in today's standup: Bo" }));

    expect(ws().teamMembers.map((m) => m.name)).toEqual(["Alice", "Bo"]);
    expect(within(speakingOrderList()).queryByText("Bo")).toBeNull();
    expect(screen.getByText("Everyone has posted; no open blockers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team page" })).toHaveAttribute("href", "/team");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(AWAY_KEY) ?? "null")).toEqual({
        date: TODAY,
        names: ["Bo"],
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Back in today's standup: Bo" }));
    expect(within(speakingOrderList()).getByText("Bo")).toBeInTheDocument();
  });

  it("forgets yesterday's list", async () => {
    localStorage.setItem(AWAY_KEY, JSON.stringify({ date: day(-1), names: ["Bo"] }));
    renderStandup();
    await waitFor(() => expect(within(speakingOrderList()).getByText("Bo")).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Not in today's standup" })).toBeNull();
  });

  it("adds someone to the team only on an explicit click", () => {
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Zed" } });
    fireEvent.change(todayInput(), { target: { value: "Pair with Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    expect(stored().some((e) => e.member === "Zed")).toBe(true);
    expect(ws().teamMembers.map((m) => m.name)).toEqual(["Alice", "Bo"]);

    fireEvent.change(memberInput(), { target: { value: "Zed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(ws().teamMembers.map((m) => m.name)).toEqual(["Alice", "Bo", "Zed"]);
  });

  it("backdates an update, but not into the future", () => {
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "bo" } });
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: day(1) } });
    fireEvent.change(todayInput(), { target: { value: "Catch up" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    expect(screen.getByText("Pick today or an earlier day.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Day"), { target: { value: day(-1) } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    // Stored with the roster's spelling, on the day picked.
    expect(stored().find((e) => e.member === "Bo")).toMatchObject({ date: day(-1) });
  });
});

/* -------------------------------------------------------------------------- */
/*  The page: async mode and the old AsyncUpdate rows                         */
/* -------------------------------------------------------------------------- */

const LEGACY: AsyncUpdate = {
  id: "au1",
  member: "Bo",
  date: TODAY,
  yesterday: "Old yesterday",
  today: "Old today",
  blockers: "Old blocker",
};

describe("async mode", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ],
      asyncUpdates: [LEGACY],
    });
  });

  it("opens on async with its own title, and the switch links both URLs", () => {
    renderStandup("async");
    expect(screen.getByRole("heading", { name: "Async Standup Digest" })).toBeInTheDocument();
    expect(history.toolIds).toContain("async-standup");
    const nav = screen.getByRole("navigation", { name: "Standup mode" });
    expect(within(nav).getByRole("link", { name: "Async" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(nav).getByRole("link", { name: "Live" })).toHaveAttribute("href", "/standup");
    expect(MODE_HREF.async).toBe("/async-standup");
    expect(screen.queryByRole("button", { name: "Start the standup" })).toBeNull();
  });

  it("shows who hasn't posted, with the old update counted, and the verdict", () => {
    renderStandup("async");
    const list = screen.getByRole("list", { name: "Not posted yet" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["AlicePost for", "CyPost for"]);
    expect(
      screen.getByText("1 of 3 has posted; 1 open blocker, raised today.")
    ).toBeInTheDocument();
    expect(within(card("Bo")).getByText("Async")).toBeInTheDocument();
  });

  it("posts an async entry for someone from the list", () => {
    renderStandup("async");
    fireEvent.click(screen.getByRole("button", { name: "Post for Cy" }));
    expect(memberInput()).toHaveValue("Cy");
    expect(todayInput()).toHaveFocus();
    fireEvent.change(todayInput(), { target: { value: "Write the digest" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "On call" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored().find((e) => e.member === "Cy")).toMatchObject({
      mode: "async",
      today: "Write the digest",
      description: "On call",
    });
    expect(history.log).toHaveBeenCalledWith(
      "update_posted",
      expect.objectContaining({ member: "Cy", date: TODAY, hasBlockers: false })
    );
    expect(
      within(screen.getByRole("list", { name: "Not posted yet" })).queryByText("Cy")
    ).toBeNull();
  });

  it("replaces the old update under its id: one entry per person per day", () => {
    renderStandup("async");
    fireEvent.change(memberInput(), { target: { value: "Bo" } });
    fireEvent.change(todayInput(), { target: { value: "New plan" } });
    fireEvent.change(screen.getByLabelText("Blockers"), { target: { value: "Old blocker" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Replace Bo's standup?");
    fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    expect(stored()).toEqual([
      expect.objectContaining({ id: "au1", mode: "async", today: "New plan" }),
    ]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("edits an old update into an entry under the same id", () => {
    renderStandup("async");
    fireEvent.click(screen.getByRole("button", { name: "Edit Bo's update" }));
    const editor = card("Bo");
    expect(within(editor).getByLabelText("Yesterday")).toHaveFocus();
    fireEvent.change(within(editor).getByLabelText(/^Today/), { target: { value: "Edited" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(byId("au1")).toMatchObject({ mode: "async", today: "Edited", blockers: "Old blocker" });
    // The old row stays behind, replaced (nothing has to be moved).
    expect(ws().asyncUpdates).toEqual([LEGACY]);
    expect(within(card("Bo")).getByText("Edited")).toBeInTheDocument();
  });

  it("deletes an old update (and an entry under its id) with Undo", () => {
    useWorkspaceStore.setState({
      standupEntries: [{ ...fromAsyncUpdate(LEGACY), today: "Edited" }],
    });
    renderStandup("async");
    fireEvent.click(screen.getByRole("button", { name: "Delete Bo's update" }));
    expect(stored()).toEqual([]);
    expect(ws().asyncUpdates).toEqual([]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted Bo's update");
    expect(history.log).toHaveBeenCalledWith(
      "update_removed",
      expect.objectContaining({ updateId: "au1" })
    );

    undoLast();
    expect(byId("au1")?.today).toBe("Edited");
    expect(ws().asyncUpdates).toEqual([LEGACY]);
    expect(within(card("Bo")).getByText("Edited")).toBeInTheDocument();
  });

  it("copies the day's digest (lib/standup standupDigest) and exports it", async () => {
    renderStandup("async");
    fireEvent.click(screen.getByRole("button", { name: "Copy digest" }));
    await waitFor(() => expect(clip.copy).toHaveBeenCalled());
    const text = clip.copy.mock.calls[0][0];
    expect(text).toContain(`# Standup — ${TODAY}`);
    expect(text).toContain("- **Bo**: Old blocker");
    expect(exported.byName.get(`standup-digest-${TODAY}`)).toBe(text);
    expect(history.log).toHaveBeenCalledWith("digest_generated", {
      date: TODAY,
      updateCount: 1,
      blockerCount: 1,
    });
  });

  it("loads the example as async updates, and shows the empty state first", () => {
    useWorkspaceStore.setState({ asyncUpdates: [] });
    renderStandup("async");
    expect(
      screen.getByText(
        "No standup updates yet. Post the first one above, or load an example to see a filled-in standup."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored()).toHaveLength(4);
    expect(stored().every((e) => e.mode === "async")).toBe(true);
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("blockers across both modes", () => {
  it("ages blockers, resolves and reopens them, and clears old updates too", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Alice" }],
      standupEntries: [entry("e1", "Alice", { blockers: "Waiting on the DBA" }, day(-3))],
      asyncUpdates: [LEGACY],
    });
    renderStandup();
    expect(
      screen.getByText("Nobody has posted yet; 2 open blockers, the oldest 3 days.")
    ).toBeInTheDocument();
    openTab(/Blockers/);
    expect(screen.getByText("3 days old")).toBeInTheDocument();
    expect(screen.getByText("Raised today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve Alice's blocker" }));
    expect(byId("e1")?.blockerResolved).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reopen Alice's blocker" }));
    expect(byId("e1")?.blockerResolved).toBeUndefined();

    // Resolving an old update writes an entry under its id.
    fireEvent.click(screen.getByRole("button", { name: "Resolve Bo's blocker" }));
    expect(byId("au1")).toMatchObject({ mode: "async", blockerResolved: true });

    fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete all 2 standup entries?");
    fireEvent.click(screen.getByRole("button", { name: "Delete entries" }));
    expect(stored()).toEqual([]);
    expect(ws().asyncUpdates).toEqual([]);
    undoLast();
    expect(
      stored()
        .map((e) => e.id)
        .sort()
    ).toEqual(["au1", "e1"]);
    expect(ws().asyncUpdates).toEqual([LEGACY]);
  });

  it("counts every open blocker on the Today tab, as the verdict does", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Alice" }],
      standupEntries: [
        entry("e1", "Alice", { blockers: "Waiting on the DBA" }, day(-3)),
        entry("e2", "Alice", { blockers: "Fixed", blockerResolved: true }, day(-1)),
      ],
    });
    renderStandup();
    expect(
      screen.getByText("Nobody has posted yet; 1 open blocker, 3 days old.")
    ).toBeInTheDocument();
    expect(screen.getByText("Open blockers").previousSibling).toHaveTextContent("1");
  });

  it("keeps focus with a blocker as it is resolved and reopened", async () => {
    useWorkspaceStore.setState({
      standupEntries: [entry("e1", "Alice", { blockers: "Keys" }), entry("e2", "Bo")],
    });
    renderStandup();
    // On the card.
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved: Alice's blocker" }));
    const reopen = () => screen.getByRole("button", { name: "Reopen Alice's blocker" });
    await waitFor(() => expect(reopen()).toHaveFocus());
    fireEvent.click(reopen());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mark resolved: Alice's blocker" })).toHaveFocus()
    );
    // In the Blockers tab, where it moves between the lists.
    openTab(/Blockers/);
    fireEvent.click(screen.getByRole("button", { name: "Resolve Alice's blocker" }));
    await waitFor(() => expect(reopen()).toHaveFocus());
    fireEvent.click(reopen());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Resolve Alice's blocker" })).toHaveFocus()
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  Review fixes                                                              */
/* -------------------------------------------------------------------------- */

describe("live mode: the walk across leaving the page", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ],
      sprints: [SPRINT],
      stories: STORIES,
    });
  });

  it("keeps the turn length picked", () => {
    const view = renderStandup();
    fireEvent.change(screen.getByLabelText("Each turn"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    expect(useDockTimer.getState().timer?.totalSeconds).toBe(60);
    view.unmount();
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Next speaker" }));
    // Auto would be 3:00 for three people.
    expect(useDockTimer.getState().timer).toMatchObject({ label: "Standup: Bo", totalSeconds: 60 });
    expect(screen.getByRole("timer")).toHaveAccessibleName("1:00 left");
  });

  it("is still counting overtime on return, and leaves time's up to the docked timer", async () => {
    const view = renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    view.unmount();
    // Ninety seconds over, and the shell's DockedTimer paused itself at 0:00.
    const w = useStandupWalk.getState().walk!;
    const docked = useDockTimer.getState().timer!;
    useStandupWalk.setState({ walk: { ...w, endsAt: Date.now() - 90_000 } });
    useDockTimer.setState({ timer: { ...docked, endsAt: null, pausedRemaining: 0 } });
    renderStandup();
    expect(screen.getByRole("timer")).toHaveAccessibleName("Time's up, 1:30 over");
    expect(screen.getByRole("button", { name: "Pause the turn" })).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 80)));
    // The DockedTimer (on every page) says it; the walk doesn't say it again.
    expect(screen.getByTestId("live-assertive")).toHaveTextContent("");
  });

  it("says time's up itself while another page holds the docked timer", async () => {
    const retro = {
      label: "Retro",
      href: "/ceremony-timer",
      totalSeconds: 600,
      endsAt: Date.now() + 600_000,
      pausedRemaining: 600,
    };
    useDockTimer.setState({ timer: retro });
    useStandupWalk.setState({
      walk: startWalk(["Alice", "Bo", "Cy"], TODAY, 60, Date.now() - 61_000),
    });
    renderStandup();
    await waitFor(() =>
      expect(screen.getByTestId("live-assertive")).toHaveTextContent("Time's up for Alice")
    );
    expect(useDockTimer.getState().timer).toEqual(retro);
  });

  it("lets go of a docked turn clock with no walk behind it (after a reload)", () => {
    useDockTimer.setState({
      timer: {
        label: "Standup: Bo",
        href: "/standup",
        totalSeconds: 60,
        endsAt: Date.now() + 30_000,
        pausedRemaining: 60,
      },
    });
    renderStandup();
    expect(useDockTimer.getState().timer).toBeNull();
    expect(screen.getByRole("button", { name: "Start the standup" })).toBeInTheDocument();
  });

  it("hands the floor on when the speaker is marked out of today's standup", async () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Start the standup" }));
    fireEvent.click(screen.getByRole("button", { name: "Not in today's standup: Alice" }));
    expect(screen.getByText(/Speaking now · turn 1 of 2/).nextSibling).toHaveTextContent("Bo");
    expect(useDockTimer.getState().timer?.label).toBe("Standup: Bo");
    expect(ws().teamMembers).toHaveLength(3);
    await waitFor(() => expect(announced()).toBe("Alice is out of today's standup. Bo's turn"));
    expect(screen.getByRole("button", { name: "Next speaker" })).toHaveFocus();
  });

  it("says when the turns add up to more than the Daily Scrum", () => {
    renderStandup();
    expect(screen.getByText(/3 people, about/).textContent).toBe(
      "3 people, about 3:00 each in a 15-minute Daily Scrum. Each person talks to their own cards on the board."
    );
    useWorkspaceStore.setState({
      teamMembers: ["A", "B", "C", "D", "E", "F"].map((name, i) => ({ id: `m${i}`, name })),
    });
    fireEvent.change(screen.getByLabelText("Each turn"), { target: { value: "180" } });
    expect(screen.getByText(/6 people at/).textContent).toBe(
      "6 people at 3:00 each: about 18 minutes, over the 15-minute Daily Scrum. Each person talks to their own cards on the board."
    );
  });

  it("keeps focus on the walk's controls as they change", async () => {
    renderStandup();
    const button = (name: string) => screen.getByRole("button", { name });
    fireEvent.click(button("Start the standup"));
    await waitFor(() => expect(button("Next speaker")).toHaveFocus());
    fireEvent.click(button("Give Cy the floor"));
    await waitFor(() => expect(button("Next speaker")).toHaveFocus());
    fireEvent.click(button("Next speaker")); // Cy, then Alice
    fireEvent.click(button("Next speaker")); // then Bo
    fireEvent.click(button("Next speaker"));
    await waitFor(() => expect(button("End standup")).toHaveFocus());
    fireEvent.click(button("End standup"));
    await waitFor(() => expect(button("Start the standup")).toHaveFocus());
  });

  it("moves focus along the order as people are marked out, and back in", async () => {
    renderStandup();
    const away = (name: string) =>
      screen.getByRole("button", { name: `Not in today's standup: ${name}` });
    fireEvent.click(away("Bo"));
    await waitFor(() => expect(away("Cy")).toHaveFocus());
    fireEvent.click(away("Cy"));
    await waitFor(() => expect(away("Alice")).toHaveFocus());
    fireEvent.click(away("Alice"));
    // Nobody left to call on: their "Back in".
    const backIn = screen.getByRole("button", { name: "Back in today's standup: Alice" });
    await waitFor(() => expect(backIn).toHaveFocus());
    fireEvent.click(backIn);
    await waitFor(() => expect(away("Alice")).toHaveFocus());
  });
});

describe("editing and deleting in place", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
      ],
      standupEntries: [entry("a", "Alice", { timestamp: 1 }), entry("b", "Bo", { timestamp: 2 })],
    });
  });

  it("saves with Ctrl+Enter or ⌘+Enter (Enter is a new line), back on Edit", async () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Alice's update" }));
    const editor = card("Alice");
    expect(within(editor).getByText("Ctrl/⌘+Enter saves, Esc cancels.")).toBeInTheDocument();
    const field = within(editor).getByLabelText(/^Today/);
    fireEvent.change(field, { target: { value: "Edited" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(byId("a")?.today).toBe("t");
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(byId("a")?.today).toBe("Edited");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Alice's update" })).toHaveFocus()
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Bo's update" }));
    const notes = within(card("Bo")).getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "From a Mac" } });
    fireEvent.keyDown(notes, { key: "Enter", metaKey: true });
    expect(byId("b")?.description).toBe("From a Mac");
  });

  it("cancels with Escape, back on Edit", async () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Bo's update" }));
    fireEvent.keyDown(within(card("Bo")).getByLabelText("Yesterday"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Bo's update" })).toHaveFocus()
    );
  });

  it("posts from the form with Ctrl+Enter", () => {
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Cy" } });
    fireEvent.change(todayInput(), { target: { value: "Ship it" } });
    fireEvent.keyDown(todayInput(), { key: "Enter", ctrlKey: true });
    expect(stored().find((e) => e.member === "Cy")).toMatchObject({ today: "Ship it" });
  });

  it("moves focus to the next card when one is deleted, then to the tab", () => {
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alice's update" }));
    expect(card("Bo")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete Bo's update" }));
    expect(screen.getByRole("tabpanel", { name: "Today" })).toHaveFocus();
  });
});

describe("async mode: Post for, old duplicates and Undo", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ],
    });
  });

  it("never hands notes typed for someone else to the person picked", () => {
    renderStandup("async");
    fireEvent.change(memberInput(), { target: { value: "Alice" } });
    fireEvent.change(todayInput(), { target: { value: "Alice's plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Post for Cy" }));
    expect(memberInput()).toHaveValue("Alice");
    expect(todayInput()).toHaveValue("Alice's plan");
    expect(screen.getByText("These notes are for Alice. Save them, or start Cy's.")).toBeVisible();

    // Saving Alice's moves the form on to Cy.
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored().find((e) => e.member === "Alice")?.today).toBe("Alice's plan");
    expect(memberInput()).toHaveValue("Cy");
    expect(todayInput()).toHaveValue("");
    expect(screen.queryByText(/These notes are for/)).toBeNull();
  });

  it("starts the picked person's notes from the banner", () => {
    renderStandup("async");
    fireEvent.change(memberInput(), { target: { value: "Alice" } });
    fireEvent.change(todayInput(), { target: { value: "Alice's plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Post for Cy" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Cy's notes" }));
    expect(memberInput()).toHaveValue("Cy");
    expect(todayInput()).toHaveValue("");
    expect(todayInput()).toHaveFocus();
    expect(screen.queryByText(/These notes are for/)).toBeNull();
  });

  it("starts a fresh update for today, even from a backdated empty draft", () => {
    useWorkspaceStore.setState({
      standupEntries: [entry("p", "Cy", { today: "Write tests" }, day(-1))],
    });
    renderStandup("async");
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: day(-3) } });
    fireEvent.click(screen.getByRole("button", { name: "Post for Cy" }));
    expect(memberInput()).toHaveValue("Cy");
    expect(screen.getByLabelText("Day")).toHaveValue(TODAY);
    expect(yesterdayInput()).toHaveValue("Write tests");
    expect(todayInput()).toHaveFocus();
  });

  it("counts people, and replaces all of a person's old updates for the day with one", () => {
    const second: AsyncUpdate = {
      id: "au2",
      member: "bo",
      date: TODAY,
      yesterday: "",
      today: "Second post",
    };
    useWorkspaceStore.setState({ asyncUpdates: [LEGACY, second] });
    renderStandup("async");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Posted").previousSibling).toHaveTextContent("1");

    fireEvent.change(memberInput(), { target: { value: "Bo" } });
    fireEvent.change(todayInput(), { target: { value: "One plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      `Bo already has 2 updates for ${TODAY}. Submitting again replaces them with this one.`
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    expect(stored()).toEqual([
      expect.objectContaining({ id: "au1", today: "One plan", mode: "async" }),
    ]);
    expect(ws().asyncUpdates).toEqual([LEGACY]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Replaced 2 updates from Bo with one");

    undoLast();
    expect(stored()).toEqual([]);
    expect(ws().asyncUpdates).toEqual([LEGACY, second]);
  });

  it("won't undo a delete over an update posted since", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("a", "Alice")] });
    renderStandup("async");
    fireEvent.click(screen.getByRole("button", { name: "Delete Alice's update" }));
    const undoDelete = toastSpy.mock.calls.at(-1)?.[1];
    fireEvent.click(screen.getByRole("button", { name: "Post for Alice" }));
    fireEvent.change(todayInput(), { target: { value: "Posted again" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));

    act(() => undoDelete?.action?.onClick());
    expect(stored().filter((e) => e.member === "Alice")).toEqual([
      expect.objectContaining({ today: "Posted again" }),
    ]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe(
      "Alice posted again since, so the deleted update wasn't put back"
    );
  });

  it("gives each Clear Entries its own Undo", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("a", "Alice")], asyncUpdates: [LEGACY] });
    renderStandup("async");
    const clear = () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear Entries" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete entries" }));
      return toastSpy.mock.calls.at(-1)?.[1];
    };
    const first = clear();
    fireEvent.click(screen.getByRole("button", { name: "Post for Cy" }));
    fireEvent.change(todayInput(), { target: { value: "After the clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    const second = clear();

    act(() => first?.action?.onClick());
    expect(stored().map((e) => e.id)).toEqual(["a"]);
    expect(ws().asyncUpdates).toEqual([LEGACY]);
    act(() => second?.action?.onClick());
    expect(
      stored()
        .map((e) => e.member)
        .sort()
    ).toEqual(["Alice", "Cy"]);
  });

  it("moves focus along the list as people are marked out", async () => {
    renderStandup("async");
    const away = (name: string) =>
      screen.getByRole("button", { name: `Not in today's standup: ${name}` });
    fireEvent.click(away("Alice"));
    await waitFor(() => expect(away("Bo")).toHaveFocus());
    fireEvent.click(away("Bo"));
    fireEvent.click(away("Cy"));
    const backIn = screen.getByRole("button", { name: "Back in today's standup: Cy" });
    await waitFor(() => expect(backIn).toHaveFocus());
    fireEvent.click(backIn);
    await waitFor(() => expect(away("Cy")).toHaveFocus());
  });

  it("names each Export menu by what it exports", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("e1", "Alice")] });
    renderStandup("async");
    expect(screen.getByRole("group", { name: "All entries" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Today's digest" })).toBeInTheDocument();
    openTab(/History/);
    expect(screen.getByRole("group", { name: "Day digest" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Week" })).toBeInTheDocument();
  });
});
