import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useDockTimer } from "@/lib/timer/dock-timer";
import { createRng } from "@/lib/utils/random";

/**
 * Ceremony Timer additions (tools plan, phase 1, P1.7):
 *   - agendas whose segments the team adds, removes and reorders, and
 *     agendas saved under a name (G15);
 *   - Shuffle for the speaking order, with Undo (G03, the timer's side);
 *   - speaking time across runs, kept from each finished meeting, with no
 *     names in the export unless the facilitator chooses (G18).
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/sonification/use-sonification", () => ({ useToolSonification: () => () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/app/(tools)/ceremony-timer/alarm", () => ({
  playChime: vi.fn(),
  vibrate: vi.fn(),
  flashTitle: vi.fn(),
}));

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import {
  MAX_NAMED_AGENDAS,
  MAX_SEGMENTS,
  isAgendaKey,
  layoutOf,
  namedAgendaFrom,
  newSavedAgendaId,
  newSegmentId,
  normalizeLayouts,
  normalizeNamedAgendas,
  readAgendaParam,
  resolveAgenda,
  resolveNamedAgenda,
  templateSegments,
  toSaved,
  type Segment,
} from "@/app/(tools)/ceremony-timer/agenda";
import {
  draftOf,
  validateAgenda,
  validateAgendaName,
  withAddedRow,
  withMovedRow,
  withoutRow,
} from "@/app/(tools)/ceremony-timer/agenda-form";
import {
  HISTORY_MAX,
  anonymousSharesText,
  keptRunOf,
  normalizeHistory,
  speakingShares,
  withKeptRun,
  type KeptRun,
} from "@/app/(tools)/ceremony-timer/history";
import { toMarkdown } from "@/app/(tools)/ceremony-timer/markdown";
import type { RunReport } from "@/app/(tools)/ceremony-timer/run";
import {
  movableCount,
  restoredOrder,
  shuffledOrder,
  type Participant,
} from "@/app/(tools)/ceremony-timer/speakers";
import {
  SETTINGS_INITIAL,
  normalizeSession,
  useTimerSession,
  useTimerSettings,
} from "@/app/(tools)/ceremony-timer/store";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const ANN: Participant = { id: "a", name: "Ann" };
const BO: Participant = { id: "b", name: "Bo" };
const CY: Participant = { id: "c", name: "Cy" };
const DEE: Participant = { id: "d", name: "Dee" };
const retro = () => resolveAgenda("retro", null, 14);
const ids = (segs: readonly Pick<Segment, "id">[]) => segs.map((s) => s.id);

const renderTimer = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CeremonyTimerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const pick = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const key = (k: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });
const tick = (seconds: number) =>
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
const order = () =>
  within(screen.getByRole("list", { name: "Speaking order" }))
    .getAllByRole("listitem")
    .map((li) =>
      li.textContent
        ?.replace(/^\d+\./, "")
        .split(/\d/)[0]
        .trim()
    );
const lastToast = () => {
  const [label, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return { label: label as string, undo: () => act(() => opts.action.onClick()) };
};

/** A finished Daily Scrum's report with each name's spoken seconds. */
function dailyReport(turns: [string, number, boolean?][]): RunReport {
  return {
    label: "Daily Scrum",
    short: "Daily Scrum",
    finished: true,
    plannedSeconds: 900,
    actualSeconds: turns.reduce((s, [, n]) => s + n, 0),
    segments: [
      {
        label: "Round the team",
        plannedSeconds: 900,
        actualSeconds: 900,
        current: false,
        turns: turns.map(([name, seconds, skipped]) => ({
          name,
          plannedSeconds: 180,
          actualSeconds: seconds,
          skipped: skipped === true,
        })),
      },
    ],
  };
}
const kept = (n: number, report: RunReport): KeptRun => keptRunOf(report, T0 + n * 1000, `k${n}`);

beforeEach(() => {
  toastSpy.mockReset();
  exported.markdown = "";
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/ceremony-timer");
  useDockTimer.setState({ timer: null });
  useTimerSession.setState({ agendaId: null, run: null });
  useTimerSettings.setState({ ...SETTINGS_INITIAL });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/*  Agendas: segments added, removed and reordered                             */
/* -------------------------------------------------------------------------- */

describe("reshaping a built-in agenda", () => {
  it("applies added segments and the team's order, and keeps untouched lengths on the cadence", () => {
    const segments: Segment[] = [
      { id: "seg-energy", label: "Energiser", seconds: 300, speakers: false, hint: "" },
      ...retro().segments.filter((s) => s.id !== "close"),
    ];
    const rows = toSaved("retro", segments, 14);
    const layout = layoutOf("retro", segments);
    expect(rows).toEqual([{ id: "seg-energy", added: true, label: "Energiser", minutes: 5 }]);
    expect(layout).toEqual([
      "seg-energy",
      "set-the-stage",
      "gather-data",
      "generate-insights",
      "decide",
    ]);
    const back = resolveAgenda("retro", { retro: rows }, 14, { retro: layout });
    expect(back.edited).toBe(true);
    expect(ids(back.segments)).toEqual(layout);
    // One-week sprints: the built-in lengths still follow the cadence, the added one doesn't.
    expect(
      resolveAgenda("retro", { retro: rows }, 7, { retro: layout }).segments.map(
        (s) => s.seconds / 60
      )
    ).toEqual([5, 5, 15, 10, 10]);
  });

  it("stores no layout while the segments are the built-in ones in the built-in order", () => {
    expect(layoutOf("retro", retro().segments)).toBeUndefined();
    const moved = [...retro().segments].reverse();
    expect(layoutOf("retro", moved)).toEqual(ids(moved));
    expect(resolveAgenda("retro", null, 14, { retro: ids(moved) }).segments[0].id).toBe("close");
  });

  it("ignores added rows and layouts it can't use", () => {
    const a = resolveAgenda(
      "retro",
      {
        retro: [
          { id: "seg-ok", added: true, label: " Check-in ", minutes: 3 },
          { id: "seg-blank", added: true, label: " ", minutes: 3 },
          { id: "seg-no-length", added: true, label: "Nope" },
          { id: "Bad Id!", added: true, label: "Nope", minutes: 2 },
          { id: "close", added: true, label: "Not a copy", minutes: 2 },
        ],
      },
      14,
      { retro: ["ghost", "seg-ok", "seg-ok", "close"] }
    );
    expect(ids(a.segments)).toEqual(["seg-ok", "close"]);
    expect(a.segments[0]).toMatchObject({ label: "Check-in", seconds: 180, hint: "" });
    // A layout naming nothing it has leaves the built-in order.
    expect(ids(resolveAgenda("retro", null, 14, { retro: ["ghost"] }).segments)).toEqual(
      ids(retro().segments)
    );
    expect(normalizeLayouts({ retro: ["close", "close", 3, "Bad Id!"], standup: ["x"] })).toEqual({
      retro: ["close"],
    });
  });

  it("adds, removes and moves segments in the draft, the total following", () => {
    const draft = draftOf(retro());
    const added = withAddedRow(draft, "seg-new");
    expect(added.rows.map((r) => r.id).slice(-1)).toEqual(["seg-new"]);
    expect(added.rows[5]).toMatchObject({ label: "", minutes: "5" });
    expect(added.total).toBe("95");
    const removed = withoutRow(added, "gather-data");
    expect(removed.total).toBe("65");
    const moved = withMovedRow(removed, "seg-new", -1);
    expect(moved.rows.map((r) => r.id)).toEqual([
      "set-the-stage",
      "generate-insights",
      "decide",
      "seg-new",
      "close",
    ]);
    expect(withMovedRow(moved, "set-the-stage", -1)).toBe(moved);
    // The last segment always stays; the list stops at MAX_SEGMENTS.
    const one = draftOf(resolveAgenda("daily", null, 14));
    expect(withoutRow(one, "round")).toBe(one);
    let full = draft;
    for (let i = 0; i < MAX_SEGMENTS + 3; i++) full = withAddedRow(full, `seg-${i}`);
    expect(full.rows).toHaveLength(MAX_SEGMENTS);
  });

  it("builds an added segment on save, in the draft's order, and needs its name", () => {
    const base = retro();
    const draft = withMovedRow(withAddedRow(draftOf(base), "seg-new"), "seg-new", -1);
    expect(validateAgenda(draft, base)).toEqual({
      ok: false,
      errors: { "label:seg-new": "Name this segment." },
    });
    const named = {
      ...draft,
      rows: draft.rows.map((r) => (r.id === "seg-new" ? { ...r, label: "Kudos" } : r)),
    };
    const ok = validateAgenda(named, base);
    expect(ok.ok && ids(ok.values)).toEqual([
      "set-the-stage",
      "gather-data",
      "generate-insights",
      "decide",
      "seg-new",
      "close",
    ]);
    expect(ok.ok && ok.values[4]).toMatchObject({ label: "Kudos", seconds: 300, speakers: false });
    const ids2 = new Set(["seg-a"]);
    expect(newSegmentId(ids2, createRng(1))).toMatch(/^seg-[a-z0-9]{8}$/);
  });
});

describe("agendas saved by name", () => {
  it("keeps a copy that no longer follows the cadence, and reads back safely", () => {
    const copy = namedAgendaFrom("saved-ours", "  Our retro  ", retro().segments);
    expect(copy.name).toBe("Our retro");
    expect(copy.segments).toHaveLength(5);
    const agenda = resolveNamedAgenda(copy);
    expect(agenda).toMatchObject({ id: "saved-ours", label: "Our retro", saved: true });
    expect(agenda.segments.map((s) => s.seconds / 60)).toEqual([10, 30, 20, 20, 10]);
    expect(draftOf(agenda).name).toBe("Our retro");
    expect(draftOf(retro()).name).toBeUndefined();

    expect(
      normalizeNamedAgendas([
        copy,
        copy,
        { id: "nope", name: "Bad id", segments: copy.segments },
        { id: "saved-empty", name: "No segments", segments: [{ id: "x", label: "", minutes: 5 }] },
        { id: "saved-blank", name: " ", segments: copy.segments },
        "junk",
      ]).map((a) => a.id)
    ).toEqual(["saved-ours"]);
    const many = Array.from({ length: MAX_NAMED_AGENDAS + 5 }, (_, i) => ({
      ...copy,
      id: `saved-n${i}`,
    }));
    expect(normalizeNamedAgendas(many)).toHaveLength(MAX_NAMED_AGENDAS);
  });

  it("validates a name: required, short enough, not taken in any case, within the limit", () => {
    expect(validateAgendaName(" ", [])).toEqual({
      ok: false,
      errors: { name: "Name the agenda." },
    });
    expect(validateAgendaName("sprint retrospective", ["Sprint Retrospective"])).toEqual({
      ok: false,
      errors: { name: "“Sprint Retrospective” is already an agenda." },
    });
    expect(validateAgendaName("x".repeat(81), [])).toMatchObject({ ok: false });
    expect(validateAgendaName("Ours", [], MAX_NAMED_AGENDAS)).toMatchObject({ ok: false });
    expect(validateAgendaName(" Ours ", ["Theirs"])).toEqual({ ok: true, values: "Ours" });
  });

  it("knows saved ids from links and sessions", () => {
    const id = newSavedAgendaId(createRng(3));
    expect(id).toMatch(/^saved-[a-z0-9]{8}$/);
    expect(isAgendaKey(id)).toBe(true);
    expect(isAgendaKey("saved-")).toBe(false);
    expect(readAgendaParam(`?agenda=${id}`)).toBe(id);
    expect(normalizeSession({ agendaId: id, run: null })).toEqual({ agendaId: id, run: null });
  });

  it("splits a built-in template over any length, for a draft without AI", () => {
    const segs = templateSegments("retro", 60);
    expect(segs.map((s) => s.seconds / 60)).toEqual([7, 20, 13, 13, 7]);
    expect(segs[0].hint).toMatch(/Welcome everyone/);
    expect(templateSegments("daily", 9000).reduce((s, x) => s + x.seconds, 0)).toBe(480 * 60);
  });
});

describe("editing the agenda on the page", () => {
  it("removes, adds and moves segments, saves the order, and resets with Undo", () => {
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove segment 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Add segment" }));
    const fresh = screen.getByRole("textbox", { name: /^Segment 5 name/ });
    expect(fresh).toHaveFocus();
    fireEvent.change(fresh, { target: { value: "Appreciations" } });
    fireEvent.click(screen.getByRole("button", { name: "Move segment 5 up" }));
    // Focus stays on the moved segment's arrow, now that of segment 4.
    expect(screen.getByRole("button", { name: "Move segment 4 up" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));

    const list = screen.getByRole("list", { name: "Agenda segments" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      expect.stringContaining("Set the stage"),
      expect.stringContaining("Gather data"),
      expect.stringContaining("Generate insights"),
      expect.stringContaining("Appreciations"),
      expect.stringContaining("Decide what to do"),
    ]);
    const state = useTimerSettings.getState();
    expect(state.layouts.retro).toHaveLength(5);
    expect(state.agendas.retro).toEqual([
      expect.objectContaining({ added: true, label: "Appreciations", minutes: 5 }),
    ]);
    expect(screen.getByRole("button", { name: /^Sprint Retrospective/ })).toHaveTextContent(
      "1 h 25 min"
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset agenda" })
    );
    expect(useTimerSettings.getState()).toMatchObject({ agendas: {}, layouts: {} });
    lastToast().undo();
    expect(useTimerSettings.getState().layouts.retro).toHaveLength(5);
    expect(useTimerSettings.getState().agendas.retro).toHaveLength(1);
  });

  it("keeps the segments in place once the meeting has started", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    expect(screen.queryByRole("button", { name: "Add segment" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove segment/ })).toBeNull();
    expect(screen.getByText(/^Start over to add, remove or reorder segments/)).toBeInTheDocument();
  });

  it("keeps focus on a segment's other arrow once it reaches the top", () => {
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Move segment 2 up" }));
    expect(screen.getByRole("button", { name: "Move segment 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move segment 1 down" })).toHaveFocus();
  }, 15_000);

  it("resets only names, lengths and turns during a meeting, and its Undo keeps the segments too", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove segment 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Segment 1 name/ }), {
      target: { value: "Collect data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    tick(60);
    fireEvent.click(screen.getByRole("button", { name: "Next segment" }));
    const segments = () =>
      within(screen.getByRole("list", { name: "Agenda segments" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
    const current = () =>
      screen.getByRole("list", { name: "Agenda segments" }).querySelector('[aria-current="step"]')
        ?.textContent;
    expect(segments()[0]).toContain("Collect data");
    expect(current()).toContain("Generate insights");

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("The meeting keeps its segments in their order");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset agenda" }));
    // The name is back; Set the stage stays out and the meeting stays where it was.
    expect(segments()).toHaveLength(4);
    expect(segments()[0]).toContain("Gather data");
    expect(segments()[0]).not.toContain("Set the stage");
    expect(current()).toContain("Generate insights");
    expect(useTimerSession.getState().run?.index).toBe(1);
    expect(useTimerSettings.getState().layouts.retro).toHaveLength(4);
    // Only the order differs now, which waits for Start over.
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBeNull();

    lastToast().undo();
    expect(segments()[0]).toContain("Collect data");
    expect(segments()).toHaveLength(4);
    expect(current()).toContain("Generate insights");
  }, 15_000);

  it("keeps the meeting's segments when a reset made before it is undone during it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove segment 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset agenda" })
    );
    const undoReset = lastToast().undo;
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    undoReset();
    expect(useTimerSettings.getState().layouts.retro).toBeUndefined();
    expect(
      within(screen.getByRole("list", { name: "Agenda segments" })).getAllByRole("listitem")
    ).toHaveLength(5);
  }, 15_000);

  it("saves an agenda under a new name, opens it, renames it and deletes it with Undo", () => {
    renderTimer();
    pick(/^Sprint Retrospective/);
    fireEvent.click(screen.getByRole("button", { name: "Save as new agenda" }));
    const name = screen.getByRole("textbox", { name: /^New agenda name/ });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "sprint retrospective" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new agenda" }));
    expect(screen.getByText("“Sprint Retrospective” is already an agenda.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Our retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new agenda" }));

    const saved = useTimerSettings.getState().named;
    expect(saved).toHaveLength(1);
    expect(useTimerSession.getState().agendaId).toBe(saved[0].id);
    const yours = screen.getByRole("list", { name: "Your agendas" });
    expect(within(yours).getByRole("button", { name: /^Our retro/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit agenda" }));
    const rename = screen.getByRole("textbox", { name: /^Agenda name/ });
    fireEvent.change(rename, { target: { value: "Team retro" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Segment 1 name/ }), {
      target: { value: "Check in" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agenda" }));
    expect(useTimerSettings.getState().named[0]).toMatchObject({ name: "Team retro" });
    expect(useTimerSettings.getState().named[0].segments[0].label).toBe("Check in");

    fireEvent.click(screen.getByRole("button", { name: "Delete agenda" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agenda" })
    );
    expect(useTimerSettings.getState().named).toEqual([]);
    expect(useTimerSession.getState().agendaId).toBeNull();
    // The card went with its Delete button: focus is on the agendas to pick.
    expect(
      within(screen.getByRole("list", { name: "Agendas" })).getAllByRole("button")[0]
    ).toHaveFocus();
    lastToast().undo();
    expect(useTimerSettings.getState().named.map((a) => a.name)).toEqual(["Team retro"]);
    expect(useTimerSession.getState().agendaId).toBe(saved[0].id);
  });

  it("opens a saved agenda a link names", () => {
    const copy = namedAgendaFrom("saved-linked", "Kick-off", retro().segments);
    useTimerSettings.setState({ named: [copy] });
    window.history.replaceState({}, "", "/ceremony-timer?agenda=saved-linked");
    renderTimer();
    expect(screen.getByRole("heading", { name: "Kick-off" })).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Shuffle speakers                                                           */
/* -------------------------------------------------------------------------- */

describe("shuffling the speaking order", () => {
  it("always changes the order of those it moves and leaves the kept ones in place", () => {
    const order4 = [ANN, BO, CY, DEE];
    for (let seed = 0; seed < 20; seed++) {
      const mixed = shuffledOrder(order4, new Set(), createRng(seed));
      expect(mixed.map((p) => p.id).sort()).toEqual(["a", "b", "c", "d"]);
      expect(mixed.map((p) => p.id)).not.toEqual(["a", "b", "c", "d"]);
      const kept = shuffledOrder(order4, new Set(["a", "b"]), createRng(seed));
      expect(kept.slice(0, 2)).toEqual([ANN, BO]);
      expect(kept.slice(2).map((p) => p.id)).toEqual(["d", "c"]);
    }
    // A random source stuck on one number still moves someone.
    expect(shuffledOrder([ANN, BO], new Set(), () => 0.99).map((p) => p.id)).toEqual(["b", "a"]);
    expect(shuffledOrder([ANN, BO], new Set(["a"]))).toEqual([ANN, BO]);
    expect(movableCount(order4, new Set(["a"]))).toBe(3);
  });

  it("undoes to the old order for whoever is still there", () => {
    expect(restoredOrder([ANN, BO, CY], [CY, DEE, ANN])).toEqual([ANN, CY, DEE]);
  });

  it("shuffles on the page with Undo, and keeps the speaker who is up in place", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    useTimerSettings.setState({ speakers: [ANN, BO, CY, DEE] });
    renderTimer();
    pick(/^Daily Scrum/);
    fireEvent.click(screen.getByRole("button", { name: "Shuffle order" }));
    expect(useTimerSettings.getState().speakers.map((p) => p.name)).toEqual([
      "Bo",
      "Cy",
      "Dee",
      "Ann",
    ]);
    expect(lastToast().label).toBe("Shuffled the speaking order");
    lastToast().undo();
    expect(useTimerSettings.getState().speakers.map((p) => p.name)).toEqual([
      "Ann",
      "Bo",
      "Cy",
      "Dee",
    ]);

    key(" ");
    tick(30);
    fireEvent.click(screen.getByRole("button", { name: "Shuffle order" }));
    expect(order()[0]).toBe("Ann");
    expect(screen.getByText("Only those still waiting move.")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  Speaking time across runs                                                  */
/* -------------------------------------------------------------------------- */

describe("speaking time across runs", () => {
  it("averages each person's share over the last meetings with turns", () => {
    const history = [
      kept(
        1,
        dailyReport([
          ["Ann", 300],
          ["Bo", 100],
          ["Cy", 0, true],
        ])
      ),
      kept(
        2,
        dailyReport([
          ["ann", 100],
          ["Bo", 100],
        ])
      ),
      kept(3, { ...dailyReport([]), segments: [] }),
    ];
    const shares = speakingShares(history, 5);
    expect(shares.runs).toBe(2);
    const by = Object.fromEntries(shares.people.map((p) => [p.name, p]));
    expect(by.ann.share).toBeCloseTo((0.75 + 0.5) / 2);
    expect(by.ann.even).toBeCloseTo((1 / 3 + 1 / 2) / 2);
    expect(by.Cy).toMatchObject({ runs: 1, share: 0 });
    expect(shares.people[0].name).toBe("ann");
    expect(speakingShares(history, 1).runs).toBe(1);
    expect(anonymousSharesText(shares)).toBe(
      "Over the last 2 meetings with turns, 3 people spoke; shares ran from 0% to 63% of the speaking time (an even share was about 39%)."
    );
  });

  it("keeps the last twenty meetings, each once, and reads back only what it can use", () => {
    let list: KeptRun[] = [];
    for (let i = 0; i < HISTORY_MAX + 4; i++)
      list = withKeptRun(list, kept(i, dailyReport([["Ann", 60]])));
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0].id).toBe("k4");
    expect(
      normalizeHistory([
        list[0],
        list[0],
        { id: "x", at: "soon", report: list[0].report },
        { id: "y", at: 1, report: { segments: [] } },
        null,
      ])
    ).toHaveLength(1);
  });

  it("exports the range without names unless the facilitator chooses names", () => {
    const shares = speakingShares(
      [
        kept(
          1,
          dailyReport([
            ["Ann", 120],
            ["Bo", 60],
          ])
        ),
      ],
      5
    );
    const agenda = resolveAgenda("daily", null, 14);
    const anon = toMarkdown({ agenda, speakers: [], shares });
    expect(anon).toContain("## Speaking time across runs");
    expect(anon).toContain("shares ran from 33% to 67%");
    expect(anon).not.toContain("Ann");
    const named = toMarkdown({ agenda, speakers: [], shares, exportNames: true });
    expect(named).toContain("| Ann | 67% | 50% | 1 of 1 |");
  });

  it("keeps a finished meeting, shows the shares, and drops it when Finish is undone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    useTimerSettings.setState({ speakers: [ANN, BO] });
    renderTimer();
    pick(/^Daily Scrum/);
    key(" ");
    tick(240);
    key("n");
    tick(60);
    key("N", { shiftKey: true });
    expect(useTimerSettings.getState().history).toHaveLength(1);
    const card = screen.getByRole("heading", { name: "Speaking time across runs" });
    expect(card).toBeInTheDocument();
    const shares = screen.getByRole("list", { name: "Speaking shares", hidden: true });
    expect(within(shares).getByText("Ann")).toBeInTheDocument();
    expect(within(shares).getByText(/^80%/)).toBeInTheDocument();
    expect(exported.markdown).toContain("shares ran from 20% to 80%");
    expect(exported.markdown).not.toContain("| Ann | 80%");

    fireEvent.click(screen.getByRole("switch", { name: "Name people in the export" }));
    expect(exported.markdown).toContain("| Ann | 80% | 50% | 1 of 1 |");

    const finish = toastSpy.mock.calls.find(([label]) => label === "Finished the Daily Scrum");
    act(() => finish![1].action.onClick());
    expect(useTimerSettings.getState().history).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Speaking time across runs" })).toBeNull();
  });

  it("clears the kept meetings with confirm and Undo", () => {
    useTimerSettings.setState({
      history: [
        kept(
          1,
          dailyReport([
            ["Ann", 60],
            ["Bo", 60],
          ])
        ),
      ],
    });
    renderTimer();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear history" })
    );
    expect(useTimerSettings.getState().history).toEqual([]);
    lastToast().undo();
    expect(useTimerSettings.getState().history).toHaveLength(1);
  });
});
