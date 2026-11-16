/**
 * The owner's History (src/components/agent/conversation-list.tsx; design
 * §1.2 "History", audit history-view, history-controls-a11y, critic1-4,
 * critic1-8, enter-ime-guard):
 *   - rows grouped Today / Yesterday / Last 7 days / Earlier, each with a
 *     <time dateTime> line in words (lib/agent/history-groups), "now" moved
 *     with a Date subclass, never fake timers
 *   - a ui/input search: it filters, Enter goes to the first thread, Escape
 *     clears its words first, an input method's keys are its own
 *   - a list or a thread that can't be read keeps History, with a narration
 *     caption, Try again, and the failure said once
 *   - row actions named by their thread, the open thread marked
 *   - the rename field's input-method guard, enterKeyHint and direction
 *   - focus: into the search coming in from the chat (a fine pointer only),
 *     kept on History's button going back, and kept in the list after a
 *     rename or a delete
 *   - the "Amr is waiting for your OK" caption while a card waits
 *
 * agent-panel-touch.test.tsx keeps the touch sizes and the Undo flow.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatMessage, ConversationMeta, PendingToolUse } from "@/lib/agent/types";

type Read<T> = { ok: boolean; data: T };

const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<Read<ConversationMeta[]>>>(),
  load: vi.fn<(id: string) => Promise<Read<ChatMessage[]>>>(),
  rename: vi.fn<(id: string, title: string) => Promise<void>>(async () => {}),
  toast: Object.assign(
    vi.fn<(label: unknown, opts?: unknown) => string>(() => "toast-1"),
    { dismiss: vi.fn(), error: vi.fn() }
  ),
}));

vi.mock("@/lib/agent/persist", () => ({
  listConversations: h.list,
  loadMessages: h.load,
  deleteConversation: vi.fn(async () => {}),
  renameConversation: h.rename,
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
// The owner's panel around the list: its chat and usage bar are markers here.
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/agent-conversation", () => ({
  AgentConversation: () => <div data-testid="agent-conversation" />,
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({ RateLimitBar: () => null }));

import {
  ConversationList,
  HISTORY_EMPTY,
  HISTORY_FAILED,
  HISTORY_LOADING,
  OPEN_NOW,
  SEARCH_ANNOUNCE_MS,
  chatMatchCount,
  exportFailed,
  noMatches,
  openFailed,
  rowAction,
} from "@/components/agent/conversation-list";
import OwnerAgentPanel from "@/components/agent/mascot/owner-agent-panel";
import { PanelHeader } from "@/components/agent/mascot/panel-header";
import { PANEL_SUBTITLE, PanelChrome } from "@/components/agent/mascot/panel-chrome";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { HISTORY_GROUPS, historyGroups, threadTime } from "@/lib/agent/history-groups";
import { AMR_WAITING_FOR_OK } from "@/lib/agent/mascot/outside-narration";
import { useAgentStore } from "@/lib/agent/store";

const RealDate = Date;

/**
 * "Now" moved to `to`, still ticking: new Date() and Date.now() read the real
 * clock plus the offset, and a Date made from a value is a plain one.
 */
function shiftNow(to: Date) {
  const offset = to.getTime() - RealDate.now();
  class Shifted extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      super(...((args.length ? args : [RealDate.now() + offset]) as [number]));
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = Shifted as DateConstructor;
}

/** Wednesday 11 November 2026, 15:00, on the reader's own clock. */
const NOW = new RealDate(2026, 10, 11, 15, 0, 0);
const before = (ms: number) => new RealDate(NOW.getTime() - ms).toISOString();
const local = (...parts: [number, number, number, number, number]) =>
  new RealDate(...parts).toISOString();
const MIN = 60_000;

const meta = (id: string, title: string, at: string, toolId: string | null = null) =>
  ({
    id,
    title,
    toolId,
    createdAt: at,
    updatedAt: at,
    lastMessageAt: at,
  }) satisfies ConversationMeta;

/** Newest first, as Supabase gives them. */
const DATED = [
  meta("d1", "Just started", before(20_000)),
  meta("d2", "Five minutes", before(5 * MIN), "retro"),
  meta("d3", "Two hours", before(120 * MIN)),
  meta("d4", "Last night", local(2026, 10, 10, 22, 30)),
  meta("d5", "On Monday", local(2026, 10, 9, 10, 0)),
  meta("d6", "Six days back", local(2026, 10, 5, 9, 0)),
  meta("d7", "A week back", local(2026, 10, 4, 9, 0)),
  meta("d8", "Last year", local(2025, 11, 20, 9, 0)),
];

const THREADS = [
  meta("c1", "Sprint 42 retro prep", before(10 * MIN), "retro"),
  meta("c2", "Backlog grooming notes", before(30 * MIN)),
  meta("c3", "Velocity question", before(50 * MIN)),
];

const CARD: PendingToolUse = {
  toolUseId: "t1",
  actionId: "workspace_sprint_create",
  resolvedActionId: "workspace.sprint.create",
  input: {},
  prompt: {
    verb: "Create sprint",
    title: "Workspace",
    question: "Create a sprint?",
    detail: "",
    destructive: false,
  },
  resolve: () => {},
};

const ok = <T,>(data: T): Read<T> => ({ ok: true, data });
const failed = <T,>(data: T): Read<T> => ({ ok: false, data });

/** A promise the test settles. */
function later<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

/** The page on a touch screen: (pointer: coarse) matches, nothing else does. */
const touchScreen = () =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList
  );

function renderList(onClose = vi.fn()) {
  render(
    <LiveAnnouncerProvider>
      <ConversationList onClose={onClose} />
    </LiveAnnouncerProvider>
  );
  return onClose;
}

const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const openButton = (title: string) => within(rowOf(title)).getByTitle(title);
const assertive = () => screen.getByTestId("live-assertive");
const polite = () => screen.getByTestId("live-polite");

/** Every line a live region says from now on (its clearing before a repeat is not a line). */
function heard(region: HTMLElement) {
  const lines: string[] = [];
  const watch = new MutationObserver(() => {
    const text = region.textContent ?? "";
    if (text) lines.push(text);
  });
  watch.observe(region, { childList: true, characterData: true, subtree: true });
  return { lines, stop: () => watch.disconnect() };
}

/** Wait out the search's pause, and the announcer's own. */
const pastSearchPause = () =>
  act(() => new Promise((r) => setTimeout(r, SEARCH_ANNOUNCE_MS + 150)));

beforeEach(() => {
  // Every test reads the threads against the same Wednesday afternoon.
  shiftNow(NOW);
  h.list.mockReset();
  h.list.mockImplementation(async () => ok(THREADS));
  h.load.mockReset();
  h.load.mockImplementation(async () => ok([]));
  h.rename.mockClear();
  h.toast.mockClear();
  h.toast.error.mockClear();
});

afterEach(() => {
  globalThis.Date = RealDate;
  vi.restoreAllMocks();
  useAgentStore.getState().reset();
  useAgentStore.setState({ pendingToolUse: null });
});

// ── Groups and time lines ───────────────────────────────────────────────

describe("groups by recency", () => {
  it("puts each thread under its day's heading, with a <time> line in words", async () => {
    h.list.mockImplementation(async () => ok(DATED));
    renderList();
    await screen.findByText("Just started");

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((el) => el.textContent)).toEqual(HISTORY_GROUPS.map((g) => g.label));
    const titlesUnder = (label: string) => {
      const list = screen.getByRole("list", { name: label });
      return within(list)
        .getAllByRole("listitem")
        .map((li) => li.querySelector("[dir=auto]")?.textContent);
    };
    expect(titlesUnder("Today")).toEqual(["Just started", "Five minutes", "Two hours"]);
    expect(titlesUnder("Yesterday")).toEqual(["Last night"]);
    expect(titlesUnder("Last 7 days")).toEqual(["On Monday", "Six days back"]);
    expect(titlesUnder("Earlier")).toEqual(["A week back", "Last year"]);

    // Spelled out, never "5m ago", and the machine-readable time beside it.
    const time = (title: string) => rowOf(title).querySelector("time")!;
    expect(time("Just started")).toHaveTextContent(/^Just now$/);
    expect(time("Five minutes")).toHaveTextContent(/^5 minutes ago$/);
    expect(time("Two hours")).toHaveTextContent(/^2 hours ago$/);
    const at = (iso: string) => new RealDate(iso);
    expect(time("Last night")).toHaveTextContent(
      at(DATED[3].lastMessageAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    );
    // In the reader's own words for the day: "Monday", "November 4", "December 20, 2025".
    const weekday = (iso: string) => at(iso).toLocaleDateString(undefined, { weekday: "long" });
    expect(time("On Monday")).toHaveTextContent(weekday(DATED[4].lastMessageAt));
    expect(time("Six days back")).toHaveTextContent(weekday(DATED[5].lastMessageAt));
    expect(time("A week back")).toHaveTextContent(
      at(DATED[6].lastMessageAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })
    );
    expect(time("Last year")).toHaveTextContent(
      at(DATED[7].lastMessageAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    );
    for (const c of DATED.slice(3)) expect(time(c.title).textContent).not.toMatch(/ago|^Just/);
    for (const c of DATED) expect(time(c.title)).toHaveAttribute("dateTime", c.lastMessageAt);

    // The thread's tool, by name, before its time; each part said apart.
    expect(openButton("Five minutes")).toHaveAccessibleName(
      /^Five minutes Retro Board\s+5 minutes ago$/
    );
  });

  it("leaves out a day with no threads, and keeps each group in the order given", () => {
    const now = new RealDate(2026, 10, 11, 0, 10);
    const groups = historyGroups(
      [
        meta("a", "Ten past midnight", local(2026, 10, 11, 0, 5)),
        // 20 minutes earlier, but yesterday on the calendar.
        meta("b", "Ten to midnight", local(2026, 10, 10, 23, 50)),
        meta("c", "Old", local(2026, 9, 1, 9, 0)),
        meta("d", "Unreadable", "not a date"),
      ],
      now
    );
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Earlier", ["c", "d"]],
    ]);
  });

  it("says one minute and one hour in the singular, and a time just ahead as Just now", () => {
    const now = new RealDate(2026, 10, 11, 15, 0);
    const ago = (ms: number) => new RealDate(now.getTime() - ms).toISOString();
    expect(threadTime(ago(MIN), now)).toBe("1 minute ago");
    expect(threadTime(ago(59 * MIN), now)).toBe("59 minutes ago");
    expect(threadTime(ago(60 * MIN), now)).toBe("1 hour ago");
    // Another device's clock a little ahead.
    expect(threadTime(ago(-30_000), now)).toBe("Just now");
    expect(threadTime("not a date", now)).toBe("");
  });
});

// ── Loading, empty and failed ───────────────────────────────────────────

describe("loading and failures", () => {
  it("scribbles while the list loads, then says when there are no saved chats", async () => {
    const read = later<Read<ConversationMeta[]>>();
    h.list.mockImplementation(() => read.promise);
    renderList();
    const loading = document.querySelector("[data-panel-loading]");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveTextContent(HISTORY_LOADING);
    expect(loading?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The search is there to take focus while the list loads.
    expect(screen.getByLabelText("Search conversations")).toBeInTheDocument();

    await act(async () => read.settle(ok([])));
    expect(document.querySelector("[data-panel-loading]")).toBeNull();
    expect(screen.getByText(HISTORY_EMPTY).closest("[data-voice]")).toHaveAttribute(
      "data-voice",
      "narration"
    );
    // Nothing to search.
    expect(screen.queryByLabelText("Search conversations")).toBeNull();
  });

  it("stays in History when the list can't be read: a caption with Try again, said once, never 'no chats'", async () => {
    h.list.mockImplementation(async () => failed([]));
    renderList();
    const caption = (await screen.findByText(HISTORY_FAILED)).closest("[data-voice]");
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(screen.queryByText(HISTORY_EMPTY)).toBeNull();
    expect(document.querySelector("[data-panel-loading]")).toBeNull();
    await waitFor(() => expect(assertive()).toHaveTextContent(HISTORY_FAILED));

    // Try again works: the caption goes, and its focus goes to the first thread.
    h.list.mockImplementation(async () => ok(THREADS));
    const retry = within(caption as HTMLElement).getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByText("Sprint 42 retro prep");
    // Gone from the list (the announcer still holds the words it said).
    expect(document.querySelector("[data-history-failed]")).toBeNull();
    expect(openButton("Sprint 42 retro prep")).toHaveFocus();
  });

  it("keeps the threads it showed when a later read fails, and says nothing out loud", async () => {
    renderList();
    await screen.findByText("Velocity question");
    h.list.mockImplementation(async () => failed([]));
    // Back to the tab: a quiet re-read.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText(HISTORY_FAILED)).toBeInTheDocument();
    expect(screen.getByText("Velocity question")).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(assertive()).toBeEmptyDOMElement();
  });

  it("keeps History when a thread can't be opened, busy while it loads, and opens it on Try again", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], []);
    const onClose = renderList();
    await screen.findByText("Velocity question");
    const read = later<Read<ChatMessage[]>>();
    h.load.mockImplementationOnce(() => read.promise);

    const row = openButton("Velocity question");
    row.focus();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(row.querySelector(".ink-scribble")).not.toBeNull();
    // A second tap loads nothing twice.
    fireEvent.click(row);
    expect(h.load).toHaveBeenCalledTimes(1);

    await act(async () => read.settle(failed([])));
    expect(row).not.toHaveAttribute("aria-busy");
    const caption = screen.getByText(openFailed("Velocity question")).closest("[data-voice]");
    expect(caption).toHaveAttribute("data-tone", "error");
    expect(onClose).not.toHaveBeenCalled();
    // Never opened empty: the thread that was open stays open.
    expect(useAgentStore.getState().activeConversationId).toBe("c1");
    expect(row).toHaveFocus();
    await waitFor(() => expect(assertive()).toHaveTextContent(openFailed("Velocity question")));

    const said: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "hi" }],
        createdAt: THREADS[2].createdAt,
      },
    ];
    h.load.mockImplementationOnce(async () => ok(said));
    fireEvent.click(within(caption as HTMLElement).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useAgentStore.getState().activeConversationId).toBe("c3");
    expect(useAgentStore.getState().messages).toEqual(said);
  });

  it("keeps the caption and its focus while Try again loads, and when it fails again", async () => {
    const onClose = renderList();
    await screen.findByText("Velocity question");
    h.load.mockImplementationOnce(async () => failed([]));
    fireEvent.click(openButton("Velocity question"));
    const caption = (await screen.findByText(openFailed("Velocity question"))).closest(
      "[data-voice]"
    ) as HTMLElement;
    await waitFor(() => expect(assertive()).toHaveTextContent(openFailed("Velocity question")));

    const read = later<Read<ChatMessage[]>>();
    h.load.mockImplementationOnce(() => read.promise);
    const retry = within(caption).getByRole("button", { name: "Try again" });
    retry.focus();
    const said = heard(assertive());
    fireEvent.click(retry);
    // Loading: the caption and its button stay, focus on it, and it is busy.
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-busy", "true");

    await act(async () => read.settle(failed([])));
    expect(screen.getByText(openFailed("Velocity question"))).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).not.toHaveAttribute("aria-busy");
    expect(onClose).not.toHaveBeenCalled();
    // Said again, once more.
    await waitFor(() => expect(said.lines).toEqual([openFailed("Velocity question")]));
    said.stop();
  });

  it("leaves the open thread's answer and card alone when another thread can't be opened", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[0], []);
    const abortTurn = vi.fn();
    const resolve = vi.fn();
    useAgentStore.setState({ streaming: true, pendingToolUse: { ...CARD, resolve } });
    useAgentStore.getState().setAbortTurn(abortTurn);
    const onClose = renderList();
    await screen.findByText("Velocity question");

    h.load.mockImplementationOnce(async () => failed([]));
    fireEvent.click(openButton("Velocity question"));
    await screen.findByText(openFailed("Velocity question"));
    expect(abortTurn).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    const s = useAgentStore.getState();
    expect(s.pendingToolUse).not.toBeNull();
    expect(s.streaming).toBe(true);
    expect(s.activeConversationId).toBe("c1");
    expect(screen.getByText(AMR_WAITING_FOR_OK)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("exports nothing from a thread it can't read, and says so", async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click");
    renderList();
    await screen.findByText("Velocity question");
    h.load.mockImplementationOnce(async () => failed([]));
    fireEvent.click(screen.getByRole("button", { name: rowAction("Export", "Velocity question") }));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(exportFailed("Velocity question"))
    );
    expect(download).not.toHaveBeenCalled();
  });
});

// ── Search ──────────────────────────────────────────────────────────────

describe("search", () => {
  it("is a ui/input search that filters by title and says when nothing matches", async () => {
    renderList();
    await screen.findByText("Velocity question");
    const search = screen.getByLabelText("Search conversations");
    expect(search).toHaveAttribute("type", "search");
    expect(search.closest('[role="search"]')).not.toBeNull();
    // ui/input: 44 px and 16 px text unless a mouse at md+ (no iOS zoom).
    expect(search).toHaveClass("h-11", "text-base");

    fireEvent.change(search, { target: { value: "VELOCITY" } });
    expect(screen.getByText("Velocity question")).toBeInTheDocument();
    expect(screen.queryByText("Backlog grooming notes")).toBeNull();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(noMatches("zzz"))).toBeInTheDocument();
  });

  it("goes to the first thread found on Enter, never while an input method composes", async () => {
    renderList();
    await screen.findByText("Velocity question");
    const search = screen.getByLabelText("Search conversations");
    fireEvent.change(search, { target: { value: "notes" } });
    search.focus();
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    fireEvent.keyDown(search, { key: "Enter", keyCode: 229 });
    expect(search).toHaveFocus();
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(openButton("Backlog grooming notes")).toHaveFocus();
  });

  it("says what it found once typing stops, politely, and nothing on mount or for an emptied search", async () => {
    renderList();
    await screen.findByText("Velocity question");
    const said = heard(polite());
    await pastSearchPause();
    expect(said.lines).toEqual([]);

    const search = screen.getByLabelText("Search conversations");
    // Each key press starts the wait again: only the last words are said.
    fireEvent.change(search, { target: { value: "v" } });
    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(said.lines).toEqual([noMatches("zzz")]));
    fireEvent.change(search, { target: { value: "es" } });
    await waitFor(() => expect(said.lines.at(-1)).toBe(chatMatchCount(2)));
    fireEvent.change(search, { target: { value: "notes" } });
    await waitFor(() => expect(said.lines.at(-1)).toBe(chatMatchCount(1)));
    expect(chatMatchCount(1)).toBe("1 chat matches");
    expect(said.lines).toEqual([noMatches("zzz"), "2 chats match", "1 chat matches"]);

    // Escape empties it: nothing more is said.
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    await pastSearchPause();
    expect(said.lines).toHaveLength(3);
    // The line is plain words: no dashes.
    for (const line of said.lines) expect(line).not.toMatch(/[–—]/);
    said.stop();
  });

  it("clears its words on Escape first, then leaves Escape to the panel", async () => {
    renderList();
    await screen.findByText("Velocity question");
    const search = screen.getByLabelText("Search conversations");
    fireEvent.change(search, { target: { value: "retro" } });
    // Used: prevented, so the panel's Escape order skips it.
    expect(fireEvent.keyDown(search, { key: "Escape" })).toBe(false);
    expect(search).toHaveValue("");
    expect(fireEvent.keyDown(search, { key: "Escape" })).toBe(true);
  });
});

// ── Rows ────────────────────────────────────────────────────────────────

describe("rows", () => {
  it("names every row action by its thread, so no two are alike", async () => {
    renderList();
    await screen.findByText("Velocity question");
    const names = screen
      .getAllByRole("listitem")
      .flatMap((li) => within(li).getAllByRole("button"))
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(new Set(names).size).toBe(names.length);
    for (const c of THREADS) {
      for (const verb of ["Export", "Rename", "Delete"] as const) {
        expect(
          within(rowOf(c.title)).getByRole("button", { name: `${verb} “${c.title}”` })
        ).toBeInTheDocument();
      }
    }
  });

  it("marks the open thread in words and for screen readers", async () => {
    useAgentStore.getState().setActiveConversation(THREADS[1], []);
    renderList();
    await screen.findByText("Velocity question");
    expect(openButton("Backlog grooming notes")).toHaveAttribute("aria-current", "true");
    expect(openButton("Velocity question")).not.toHaveAttribute("aria-current");
    expect(openButton("Sprint 42 retro prep")).not.toHaveAttribute("aria-current");
    // Seen on the row (not only a tint); aria-current says it to screen readers.
    const marker = within(rowOf("Backlog grooming notes")).getByText(OPEN_NOW);
    expect(marker.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(rowOf("Velocity question")).queryByText(OPEN_NOW)).toBeNull();
  });

  it("sets each title's direction from its own words", async () => {
    h.list.mockImplementation(async () => ok([meta("ar", "خطة السبرينت", before(MIN))]));
    renderList();
    expect(await screen.findByText("خطة السبرينت")).toHaveAttribute("dir", "auto");
  });
});

// ── Rename ──────────────────────────────────────────────────────────────

describe("rename", () => {
  async function startRename(title: string) {
    renderList();
    await screen.findByText(title);
    fireEvent.click(screen.getByRole("button", { name: rowAction("Rename", title) }));
    return screen.getByRole("textbox", { name: rowAction("Rename", title) });
  }

  it("leaves an input method's Enter to it, saves on a real one, and hands focus back to Rename", async () => {
    const field = await startRename("Velocity question");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("enterKeyHint", "done");
    expect(field).toHaveAttribute("dir", "auto");
    fireEvent.change(field, { target: { value: "Velocity, explained" } });

    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(h.rename).not.toHaveBeenCalled();
    expect(field).toBeInTheDocument();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(h.rename).toHaveBeenCalledWith("c3", "Velocity, explained");
    // The field went: focus is on that row's Rename, not the page.
    expect(
      screen.getByRole("button", { name: rowAction("Rename", "Velocity question") })
    ).toHaveFocus();
    await act(async () => {});
  });

  it("cancels on Escape, keeping the panel's Escape order out of it, and on Cancel, focus back on Rename", async () => {
    let field = await startRename("Backlog grooming notes");
    expect(fireEvent.keyDown(field, { key: "Escape", isComposing: true })).toBe(true);
    expect(field).toBeInTheDocument();
    expect(fireEvent.keyDown(field, { key: "Escape" })).toBe(false);
    const rename = screen.getByRole("button", {
      name: rowAction("Rename", "Backlog grooming notes"),
    });
    expect(rename).toHaveFocus();

    fireEvent.click(rename);
    field = screen.getByRole("textbox", { name: rowAction("Rename", "Backlog grooming notes") });
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(
      screen.getByRole("button", { name: rowAction("Rename", "Backlog grooming notes") })
    ).toHaveFocus();
    expect(h.rename).not.toHaveBeenCalled();
  });
});

// ── Focus after a delete ────────────────────────────────────────────────

describe("focus after a delete", () => {
  const remove = (title: string) => {
    const button = screen.getByRole("button", { name: rowAction("Delete", title) });
    button.focus();
    fireEvent.click(button);
  };

  it("goes to the next row, the one before for the last, and New chat when none is left", async () => {
    renderList();
    await screen.findByText("Velocity question");
    remove("Sprint 42 retro prep");
    expect(openButton("Backlog grooming notes")).toHaveFocus();
    remove("Velocity question");
    expect(openButton("Backlog grooming notes")).toHaveFocus();
    remove("Backlog grooming notes");
    expect(screen.getByRole("button", { name: "New chat" })).toHaveFocus();
    // Undo each, so no thread stays pending deletion for the next test.
    for (const call of h.toast.mock.calls) {
      act(() => (call[1] as { action: { onClick: () => void } }).action.onClick());
    }
  });
});

// ── The card waiting in the chat ────────────────────────────────────────

describe("a card waiting in the chat", () => {
  it("says Amr is waiting for the OK, with Back to chat", async () => {
    useAgentStore.setState({ pendingToolUse: CARD });
    const onClose = renderList();
    await screen.findByText("Velocity question");
    const caption = screen.getByText(AMR_WAITING_FOR_OK).closest("[data-voice]") as HTMLElement;
    expect(caption).toHaveAttribute("data-voice", "narration");
    // Third person, never a line of Amr's own.
    expect(caption.textContent).not.toMatch(/\b(I|me|my)\b/);
    fireEvent.click(within(caption).getByRole("button", { name: "Back to chat" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // One already waiting is not said again.
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(polite()).toBeEmptyDOMElement();
  });

  it("says so when a card comes while History shows, and takes the caption away once it is answered", async () => {
    renderList();
    await screen.findByText("Velocity question");
    expect(document.querySelector("[data-history-waiting]")).toBeNull();
    act(() => useAgentStore.setState({ pendingToolUse: CARD }));
    expect(document.querySelector("[data-history-waiting]")).toHaveTextContent(AMR_WAITING_FOR_OK);
    await waitFor(() => expect(polite()).toHaveTextContent(AMR_WAITING_FOR_OK));
    act(() => useAgentStore.setState({ pendingToolUse: null }));
    expect(document.querySelector("[data-history-waiting]")).toBeNull();
  });
});

// ── Going in and out ────────────────────────────────────────────────────

describe("focus going in and out of History", () => {
  /** The shell around the owner's chat, as MascotAssistant keeps it. */
  function Shell({ inHistory = false }: { inHistory?: boolean }) {
    const [showHistory, setShowHistory] = useState(inHistory);
    return (
      <PanelChrome>
        <PanelHeader subtitle={PANEL_SUBTITLE.owner} onClose={() => {}} />
        <OwnerAgentPanel
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory((v) => !v)}
          onCloseHistory={() => setShowHistory(false)}
        />
      </PanelChrome>
    );
  }
  const header = () => document.querySelector<HTMLElement>("[data-panel-header]")!;

  it("goes into the search coming in from the chat, and stays on History's button going back", async () => {
    render(<Shell />);
    const history = within(header()).getByRole("button", { name: "Conversation history" });
    history.focus();
    fireEvent.click(history);
    expect(screen.getByLabelText("Search conversations")).toHaveFocus();
    await screen.findByText("Velocity question");

    const back = within(header()).getByRole("button", { name: "Back to chat" });
    back.focus();
    fireEvent.click(back);
    expect(screen.getByTestId("agent-conversation")).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: "Conversation history" })).toHaveFocus();
  });

  it("hands the search's focus on to New chat when the list comes back empty", async () => {
    h.list.mockImplementation(async () => ok([]));
    render(<Shell />);
    const history = within(header()).getByRole("button", { name: "Conversation history" });
    history.focus();
    fireEvent.click(history);
    expect(screen.getByLabelText("Search conversations")).toHaveFocus();
    await screen.findByText(HISTORY_EMPTY);
    // Nothing to search: the search goes, and its focus to New chat, not the page or the plate.
    expect(screen.queryByLabelText("Search conversations")).toBeNull();
    expect(document.querySelector('[data-history-focus="new"]')).toHaveFocus();
  });

  it("keeps words typed while the list loads, and hands focus to New chat once they are cleared over an empty list", async () => {
    for (const clear of ["Escape", "emptied"] as const) {
      const read = later<Read<ConversationMeta[]>>();
      h.list.mockImplementation(() => read.promise);
      const { unmount } = render(
        <LiveAnnouncerProvider>
          <ConversationList onClose={vi.fn()} />
        </LiveAnnouncerProvider>
      );
      const search = screen.getByLabelText("Search conversations");
      search.focus();
      fireEvent.change(search, { target: { value: "retro" } });
      await act(async () => read.settle(ok([])));
      // Words in it: it stays, with focus.
      expect(search).toHaveFocus();
      if (clear === "Escape") fireEvent.keyDown(search, { key: "Escape" });
      else fireEvent.change(search, { target: { value: "" } });
      expect(screen.queryByLabelText("Search conversations")).toBeNull();
      expect(document.querySelector('[data-history-focus="new"]')).toHaveFocus();
      unmount();
    }
  });

  it("raises no keyboard on a touch screen: focus stays on the button", async () => {
    touchScreen();
    render(<Shell />);
    const history = within(header()).getByRole("button", { name: "Conversation history" });
    history.focus();
    fireEvent.click(history);
    await screen.findByText("Velocity question");
    expect(screen.getByLabelText("Search conversations")).not.toHaveFocus();
    expect(within(header()).getByRole("button", { name: "Back to chat" })).toHaveFocus();
  });

  it("takes no focus when the panel opens on History: the panel's focus owner decides", async () => {
    render(<Shell inHistory />);
    await screen.findByText("Velocity question");
    expect(screen.getByLabelText("Search conversations")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});
