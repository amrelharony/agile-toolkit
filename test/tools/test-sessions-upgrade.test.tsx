import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestSession } from "@/lib/stores/workspace-types";
import { TEST_SESSIONS_ACTIONS } from "@/lib/history/event-actions";
import { countdown, useDockTimer } from "@/lib/timer/dock-timer";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/**
 * Test Sessions on workspace.testSessions: planning from a charter (nothing
 * blank, a length from the list), Start claiming the docked timer at
 * /test-sessions (refused when another page holds it, or another session
 * runs), the clock restored from the start when the dock is gone, time's up
 * left to the dock, notes stamped with their minutes in, End stopping only
 * its own dock, the debrief (coverage, a split that adds up to 100),
 * sending bug notes to Bug Triage with one Undo, follow-up sessions,
 * charters without AI, ?session=, delete with Undo, the example (never
 * claims the dock or sends) and the export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as unknown[][]);
const rings = vi.hoisted(() => ({ count: 0 }));
const path = vi.hoisted(() => ({ name: "/test-sessions" }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => path.name,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/celebrate/chime")>();
  return { ...actual, timesUp: () => (rings.count += 1) };
});
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { TestSessionsClient } from "@/app/(tools)/test-sessions/test-sessions-client";
import { sessionsCsv } from "@/app/(tools)/test-sessions/markdown";
import { DockedTimer } from "@/components/timer/docked-timer";

const MIN = 60 * 1000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

const ws = () => useWorkspaceStore.getState();
const sessions = () => ws().testSessions ?? [];
const stored = (id: string) => sessions().find((s) => s.id === id);

const session = (over: Partial<TestSession> = {}): TestSession => ({
  id: "tsess_a",
  charter: { target: "Saved addresses", using: "a slow network", toLearn: "what fails" },
  minutes: 60,
  status: "planned",
  notes: [],
  createdAt: ago(30),
  updatedAt: ago(30),
  ...over,
});

const seed = (testSessions: TestSession[]) =>
  useWorkspaceStore.setState({ testSessions, bugReports: [], stories: [], sprints: [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <TestSessionsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const logged = (action: string) => logs.filter((l) => l.action === action);
const card = (id: string) => document.querySelector(`[data-session="${id}"]`) as HTMLElement;
/** The session's card once it is on screen. */
const findCard = (id: string) =>
  waitFor(() => {
    const el = card(id);
    expect(el).not.toBeNull();
    return el;
  });
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
/** Focus a control, then click it, as a keyboard user's Enter does. */
const press = (el: HTMLElement) => {
  act(() => el.focus());
  fireEvent.click(el);
};
const dock = () => useDockTimer.getState().timer;
const standupDock = () =>
  useDockTimer
    .getState()
    .publish({ ...countdown("Standup", "/standup", 900), endsAt: Date.now() + 900_000 });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  rings.count = 0;
  path.name = "/test-sessions";
  localStorage.clear();
  useDockTimer.setState({ timer: null });
  window.history.replaceState(null, "", "/test-sessions");
  seed([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("an empty page and the example", () => {
  it("offers the example: a still clock, no Start, no sends, and never the dock", async () => {
    renderPage();
    expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(sessions()).toHaveLength(3);
    expect(sessions().every((s) => s.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText(/clock stands still/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart the timer" })).toBeNull();
    const planned = card("example-session-planned");
    expect(within(planned).getByRole("button", { name: "Start" })).toBeDisabled();
    const done = card("example-session-done");
    expect(within(done).getByRole("button", { name: "Log all 2 bugs" })).toBeDisabled();
    expect(within(done).getByText(/Example notes aren't sent/)).toBeInTheDocument();
    expect(dock()).toBeNull();
    expect(logs).toEqual([]);
  });
});

describe("planning", () => {
  it("saves nothing blank, then plans a session from the charter", async () => {
    renderPage();
    await screen.findByText(/No sessions yet/);
    const target = screen.getByRole("textbox", { name: /^Look at…/ });
    fireEvent.submit(target.closest("form")!);
    expect(await screen.findByText("Say what the session looks at.")).toBeInTheDocument();
    expect(screen.getByText("Say what you want to learn.")).toBeInTheDocument();
    expect(sessions()).toEqual([]);
    fireEvent.change(target, { target: { value: "Saved addresses" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^To learn…/ }), {
      target: { value: "whether the list loads" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Length" }), { target: { value: "45" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tester" }), {
      target: { value: "Sam" },
    });
    fireEvent.submit(target.closest("form")!);
    expect(sessions()).toEqual([
      expect.objectContaining({
        charter: { target: "Saved addresses", toLearn: "whether the list loads" },
        minutes: 45,
        tester: "Sam",
        status: "planned",
      }),
    ]);
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_PLANNED)[0].payload).toEqual({
      sessionId: sessions()[0].id,
      minutes: 45,
    });
    expect(target).toHaveValue("");
  });

  it("suggests charters without AI, and planning one has Undo", async () => {
    renderPage();
    await screen.findByText(/No sessions yet/);
    fireEvent.change(screen.getByRole("textbox", { name: /^Look at…/ }), {
      target: { value: "Booking a delivery date" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest charters without AI" }));
    expect(await screen.findByText(/Suggested without AI/)).toBeInTheDocument();
    const idea = screen.getByText(/using other dates, times and time zones/).closest("li")!;
    fireEvent.click(within(idea).getByRole("button", { name: /^Plan/ }));
    expect(sessions()[0]).toMatchObject({
      charter: { target: "Booking a delivery date", using: "other dates, times and time zones" },
      minutes: 60,
      status: "planned",
    });
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_PLANNED)[0].payload).toMatchObject({
      source: "suggestion",
    });
    undoLast();
    expect(sessions()).toEqual([]);
  });

  it("shows an AI charter at the length Plan will make, the nearest the form offers", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              charters: [
                {
                  target: "Saved addresses",
                  using: "a long list",
                  toLearn: "how the list scrolls",
                  minutes: 240,
                  why: "Lists that grow break first.",
                },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await screen.findByText(/No sessions yet/);
    fireEvent.change(screen.getByRole("textbox", { name: /^Look at…/ }), {
      target: { value: "Saved addresses" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr for charters" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(list).getByText("2 hours. Lists that grow break first.")).toBeInTheDocument();
    expect(within(list).queryByText(/4 hours/)).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: /^Plan/ }));
    expect(sessions()[0]).toMatchObject({ minutes: 120, status: "planned" });
  });

  it("asks for a target before suggesting", async () => {
    renderPage();
    await screen.findByText(/No sessions yet/);
    fireEvent.click(screen.getByRole("button", { name: "Suggest charters without AI" }));
    expect(
      await screen.findByText("Type what to look at, or pick a story, first.")
    ).toBeInTheDocument();
  });
});

describe("running a session", () => {
  it("Start claims the dock at /test-sessions for the session's length", async () => {
    seed([session({ minutes: 45 })]);
    renderPage();
    const before = Date.now();
    fireEvent.click(within(await findCard("tsess_a")).getByRole("button", { name: "Start" }));
    expect(stored("tsess_a")?.status).toBe("running");
    expect(stored("tsess_a")?.startedAt).toBeDefined();
    const t = dock()!;
    expect(t).toMatchObject({
      href: "/test-sessions",
      label: "Test session: Saved addresses",
      totalSeconds: 2700,
    });
    expect(t.endsAt! - before).toBeGreaterThanOrEqual(2700 * 1000 - 50);
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_STARTED)).toEqual([
      { action: "session_started", payload: { sessionId: "tsess_a" } },
    ]);
    expect(await screen.findByRole("timer")).toHaveAccessibleName(
      /Saved addresses: 4[45]:\d\d left/
    );
  });

  it("refuses to Start while another page holds the dock, and says which", async () => {
    seed([session()]);
    act(() => standupDock());
    renderPage();
    fireEvent.click(within(await findCard("tsess_a")).getByRole("button", { name: "Start" }));
    expect(
      within(card("tsess_a")).getByText("The Standup timer is running: stop it first.")
    ).toBeInTheDocument();
    expect(stored("tsess_a")?.status).toBe("planned");
    expect(dock()?.href).toBe("/standup");
  });

  it("runs one session at a time", async () => {
    seed([
      session({
        id: "tsess_r",
        status: "running",
        startedAt: ago(5),
        charter: { target: "Search", toLearn: "x" },
      }),
      session(),
    ]);
    renderPage();
    fireEvent.click(within(await findCard("tsess_a")).getByRole("button", { name: "Start" }));
    expect(
      within(card("tsess_a")).getByText("End “Search” first: one session runs at a time.")
    ).toBeInTheDocument();
    expect(stored("tsess_a")?.status).toBe("planned");
  });

  it("counts from the start when the dock is gone, and Restart puts it back", async () => {
    seed([session({ status: "running", startedAt: ago(10) })]);
    renderPage();
    const timer = await screen.findByRole("timer");
    expect(timer).toHaveAccessibleName(/(49|50):\d\d left/);
    expect(screen.getByText(/Counting from when it started/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart the timer" }));
    expect(dock()).toMatchObject({ href: "/test-sessions" });
    expect(dock()!.totalSeconds).toBeGreaterThan(49 * 60);
    expect(dock()!.totalSeconds).toBeLessThanOrEqual(50 * 60);
    expect(screen.queryByRole("button", { name: "Restart the timer" })).toBeNull();
  });

  it("shows time's up and the overtime, and leaves the ringing to the dock", async () => {
    seed([session({ status: "running", startedAt: ago(70) })]);
    renderPage();
    const timer = await screen.findByRole("timer");
    expect(timer).toHaveTextContent("Time's up");
    expect(timer).toHaveTextContent(/\+10:0\d over/);
    expect(screen.queryByRole("button", { name: "Restart the timer" })).toBeNull();
    expect(rings.count).toBe(0);
  });

  it("hides the docked pill on its own page", () => {
    act(() => {
      useDockTimer.getState().publish({
        ...countdown("Test session: Saved addresses", "/test-sessions", 600),
        endsAt: Date.now() + 600_000,
      });
    });
    const { unmount } = render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <DockedTimer />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    expect(screen.queryByRole("link", { name: /Open the timer/ })).toBeNull();
    unmount();
    // On any other page it shows.
    path.name = "/sprint";
    render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <DockedTimer />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    expect(
      screen.getByRole("link", { name: /Test session: Saved addresses timer/ })
    ).toHaveAttribute("href", "/test-sessions");
  });

  it("stamps each note with its kind and its minutes in", async () => {
    seed([session({ status: "running", startedAt: ago(12) })]);
    renderPage();
    await screen.findByRole("timer");
    const running = card("tsess_a");
    fireEvent.click(
      within(within(running).getByRole("radiogroup", { name: "Kind of note" })).getByRole("radio", {
        name: "Bug",
      })
    );
    const field = within(running).getByRole("textbox", { name: "Bug to note" });
    fireEvent.change(field, { target: { value: "The list jumps to the top" } });
    fireEvent.submit(field.closest("form")!);
    expect(stored("tsess_a")?.notes).toEqual([
      expect.objectContaining({ kind: "bug", text: "The list jumps to the top" }),
    ]);
    expect(within(card("tsess_a")).getByText(/Bug · 12 min in/)).toBeInTheDocument();
    expect(logged(TEST_SESSIONS_ACTIONS.NOTE_ADDED)[0].payload).toEqual({
      sessionId: "tsess_a",
      kind: "bug",
    });
    // The kind stays for the next note.
    expect(within(card("tsess_a")).getByRole("textbox", { name: "Bug to note" })).toHaveValue("");
  });

  it("End stops its own dock only", async () => {
    seed([session({ status: "running", startedAt: ago(5) })]);
    act(() => standupDock());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));
    expect(stored("tsess_a")?.status).toBe("done");
    expect(stored("tsess_a")?.endedAt).toBeDefined();
    expect(dock()?.href).toBe("/standup");
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_ENDED)[0].payload).toMatchObject({
      sessionId: "tsess_a",
      notes: 0,
    });

    act(() => {
      seed([session({ id: "tsess_b" })]);
      useDockTimer.setState({ timer: null });
    });
    fireEvent.click(within(await findCard("tsess_b")).getByRole("button", { name: "Start" }));
    expect(dock()?.href).toBe("/test-sessions");
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(dock()).toBeNull();
  });
});

describe("the debrief", () => {
  it("needs the coverage and a split that adds up to 100, then cheers once", async () => {
    seed([session({ status: "done", startedAt: ago(70), endedAt: ago(10) })]);
    renderPage();
    const done = await findCard("tsess_a");
    const save = within(done).getByRole("button", { name: "Save debrief" });
    fireEvent.change(within(done).getByRole("spinbutton", { name: "Testing" }), {
      target: { value: "70" },
    });
    fireEvent.change(within(done).getByRole("spinbutton", { name: "Bugs" }), {
      target: { value: "20" },
    });
    fireEvent.change(within(done).getByRole("spinbutton", { name: "Setup" }), {
      target: { value: "5" },
    });
    fireEvent.click(save);
    expect(
      await within(done).findByText("Say how much of the charter you covered.")
    ).toBeInTheDocument();
    expect(within(done).getByText("The three add up to 95%: make them 100%.")).toBeInTheDocument();
    expect(stored("tsess_a")?.coverage).toBeUndefined();
    fireEvent.click(
      within(
        within(done).getByRole("radiogroup", { name: "How much of the charter you covered" })
      ).getByRole("radio", { name: "Most of it" })
    );
    fireEvent.change(within(done).getByRole("spinbutton", { name: "Setup" }), {
      target: { value: "10" },
    });
    fireEvent.change(within(done).getByRole("textbox", { name: /What you learned/ }), {
      target: { value: "Prices follow the address." },
    });
    press(save);
    // The form, Save with it, gave way to the debrief: focus is on the session.
    expect(within(card("tsess_a")).queryByRole("button", { name: "Save debrief" })).toBeNull();
    expect(document.activeElement).toBe(within(card("tsess_a")).getByRole("heading"));
    expect(stored("tsess_a")).toMatchObject({
      coverage: "most",
      split: { testing: 70, bugs: 20, setup: 10 },
      debrief: "Prices follow the address.",
    });
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_DEBRIEFED)).toEqual([
      {
        action: "session_debriefed",
        payload: {
          sessionId: "tsess_a",
          coverage: "most",
          split: { testing: 70, bugs: 20, setup: 10 },
        },
      },
    ]);
    expect(cheers).toEqual([["test-sessions", "done"]]);
    // An edit later neither logs nor cheers again.
    fireEvent.click(within(card("tsess_a")).getByRole("button", { name: "Edit debrief" }));
    fireEvent.click(within(card("tsess_a")).getByRole("button", { name: "Save debrief" }));
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_DEBRIEFED)).toHaveLength(1);
    expect(cheers).toHaveLength(1);
    // Cancel goes with the form too.
    fireEvent.click(within(card("tsess_a")).getByRole("button", { name: "Edit debrief" }));
    press(within(card("tsess_a")).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(within(card("tsess_a")).getByRole("heading"));
  });

  it("logs all the bugs in Bug Triage with one Undo", async () => {
    seed([
      session({
        status: "done",
        tester: "Priya",
        area: "Checkout",
        notes: [
          { id: "n1", at: ago(20), kind: "bug", text: "The list jumps to the top" },
          { id: "n2", at: ago(15), kind: "bug", text: "Prices stay wrong" },
        ],
      }),
    ]);
    renderPage();
    press(within(await findCard("tsess_a")).getByRole("button", { name: "Log all 2 bugs" }));
    // The button went with the last unsent bug: focus is on the session.
    expect(document.activeElement).toBe(within(card("tsess_a")).getByRole("heading"));
    const bugs = ws().bugReports ?? [];
    expect(bugs.map((b) => b.title)).toEqual(["The list jumps to the top", "Prices stay wrong"]);
    expect(bugs[0]).toMatchObject({
      status: "new",
      reportedBy: "Priya",
      area: "Checkout",
      sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_a" },
    });
    expect(stored("tsess_a")?.notes.every((n) => n.sentTo?.[0]?.route === "bug")).toBe(true);
    expect(logged(TEST_SESSIONS_ACTIONS.BUGS_SENT)).toEqual([
      { action: "bugs_sent", payload: { sessionId: "tsess_a", count: 2 } },
    ]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(within(card("tsess_a")).queryByRole("button", { name: /Log all/ })).toBeNull();
    undoLast();
    expect(ws().bugReports ?? []).toEqual([]);
    expect(stored("tsess_a")?.notes.every((n) => (n.sentTo ?? []).length === 0)).toBe(true);
  });

  it("plans a follow-up session from an idea, with Undo", async () => {
    seed([
      session({
        status: "done",
        notes: [{ id: "n3", at: ago(10), kind: "idea", text: "Try it on a phone" }],
      }),
    ]);
    renderPage();
    fireEvent.click(
      within(await findCard("tsess_a")).getByRole("button", {
        name: "Plan a follow-up session: Try it on a phone",
      })
    );
    const next = sessions().find((s) => s.id !== "tsess_a");
    expect(next).toMatchObject({
      status: "planned",
      charter: {
        target: "Try it on a phone",
        using: "a slow network",
        toLearn: "Try it on a phone",
      },
    });
    undoLast();
    expect(sessions()).toHaveLength(1);
  });
});

describe("the page", () => {
  it("focuses the session a ?session= link names, and deletes with Undo", async () => {
    seed([
      session(),
      session({ id: "tsess_b", charter: { target: "Search", toLearn: "x" }, createdAt: ago(5) }),
    ]);
    window.history.replaceState(null, "", "/test-sessions?session=tsess_a");
    renderPage();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(card("tsess_a")).getByRole("heading"))
    );
    expect(window.location.search).toBe("");
    fireEvent.click(within(card("tsess_b")).getByRole("button", { name: "Delete" }));
    expect(stored("tsess_b")).toBeUndefined();
    expect(logged(TEST_SESSIONS_ACTIONS.SESSION_REMOVED)).toHaveLength(1);
    undoLast();
    expect(stored("tsess_b")).toBeDefined();
  });

  it("dates the CSV's Planned column by the local day, not the UTC one", () => {
    // Pinned east of UTC so this holds on a UTC runner too: 20:30 UTC on
    // the 20th is early on the 21st in Tokyo, where a UTC slice says the 20th.
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Tokyo";
    try {
      const csv = sessionsCsv([session({ createdAt: "2026-10-20T20:30:00.000Z" })]);
      expect(csv.rows[0][csv.headers.indexOf("Planned")]).toBe("2026-10-21");
    } finally {
      process.env.TZ = zone;
    }
  });

  it("exports the sessions with their charters, counting the team's own", async () => {
    seed([
      session({ status: "done", startedAt: ago(70), endedAt: ago(20), coverage: "some" }),
      session({ id: "example-x", charter: { target: "Example", toLearn: "x" } }),
    ]);
    renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toMatch(/^# Test sessions — \d{4}-\d{2}-\d{2}/);
    expect(md).toContain("## Look at Saved addresses, using a slow network, to learn what fails");
    expect(md).toContain("- Covered: Some of it");
    expect(md).toContain("ran 50 min");
    expect(md).not.toContain("Example");
  });
});
