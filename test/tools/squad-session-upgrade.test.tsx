/**
 * Squad Session Kit: 15 minutes on the docked timer that never takes another
 * page's clock, actions validated and sent to Retro Actions with Undo, works with
 * or without art, example data, a next step and a Markdown outcome.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";

const h = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
  usePathname: () => "/squad-session",
}));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => (
    <pre data-testid="markdown">{markdown}</pre>
  ),
}));

import { SquadSessionClient } from "@/app/(tools)/squad-session/squad-session-client";
import { EXAMPLE_EP, buildExample } from "@/app/(tools)/squad-session/example";
import { toMarkdown } from "@/app/(tools)/squad-session/markdown";
import {
  SESSION_STEPS,
  advanceSession,
  normalizeSquadRun,
  runIsLive,
  startSession,
  stopSession,
  useSquadRun,
} from "@/app/(tools)/squad-session/session";
import {
  normalizeActions,
  useSquadSessionStore,
  validateAction,
} from "@/app/(tools)/squad-session/store";
import { isExampleId } from "@/components/tool-frame/example-data";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import type { Story } from "@/lib/comics/types";
import { sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import { runSeconds } from "@/lib/timer/step-timer";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type { Workspace } from "@/lib/stores/workspace-types";

const STORY: Story = {
  ep: 1,
  collection: "book",
  title: BOOK_EPISODES[0].title,
  lesson: BOOK_EPISODES[0].lesson,
  squadQuestion: BOOK_EPISODES[0].question,
  castNames: [],
  themes: [],
  panels: [
    {
      pathFull: "s/1-1536.webp",
      pathSmall: "s/1-768.webp",
      width: 1536,
      height: 1024,
      alt: "The first panel.",
      dialogue: [],
      signs: [],
    },
  ],
  sharePath: null,
  bookPage: 9,
  releaseAt: "2026-10-01T07:00:00.000Z",
  updatedAt: "2026-10-01T07:00:00.000Z",
};

function open(ep: number | null, story: Story | null = null) {
  return render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <SquadSessionClient episodes={BOOK_EPISODES} ep={ep} story={story} />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
}

function retroCards() {
  return (useWorkspaceStore.getState().retroBoards ?? []).flatMap((b) => b.cards);
}

beforeEach(() => {
  h.push.mockClear();
  h.replace.mockClear();
  toastSpy.mockClear();
  useSquadSessionStore.setState({ actions: [] });
  useSquadRun.setState({ ep: null, run: null });
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({ retroBoards: [] });
});
afterEach(cleanup);

describe("the session", () => {
  it("takes exactly 15 minutes over three steps", () => {
    expect(SESSION_STEPS.map((s) => s.id)).toEqual(["read", "discuss", "actions"]);
    expect(runSeconds({ steps: [...SESSION_STEPS] })).toBe(900);
  });

  it("runs on the dock, one countdown per step, and frees it at the end", () => {
    const start = startSession(1, "Episode", 1_000);
    expect(start.ok).toBe(true);
    expect(useDockTimer.getState().timer).toMatchObject({
      href: "/squad-session",
      totalSeconds: 180,
      endsAt: 1_000 + 180_000,
    });
    advanceSession(2_000);
    expect(useDockTimer.getState().timer?.totalSeconds).toBe(480);
    advanceSession(3_000);
    expect(useDockTimer.getState().timer?.totalSeconds).toBe(240);
    const last = advanceSession(4_000);
    expect(last).toMatchObject({ ok: true, run: { finished: true } });
    expect(useDockTimer.getState().timer).toBeNull();
    stopSession();
    expect(useSquadRun.getState().run).toBeNull();
  });

  it("never takes another page's clock", () => {
    const other: DockedTimer = {
      label: "Standup",
      href: "/ceremony-timer",
      totalSeconds: 60,
      endsAt: null,
      pausedRemaining: 60,
    };
    useDockTimer.setState({ timer: other });
    expect(startSession(1, "Episode")).toEqual({ ok: false, holder: other });
    expect(useDockTimer.getState().timer).toBe(other);
    expect(useSquadRun.getState().run).toBeNull();
    stopSession();
    expect(useDockTimer.getState().timer).toBe(other);
  });

  it("is over when its dock is gone, and reads a stored run safely", () => {
    const start = startSession(1, "Episode");
    if (!start.ok) throw new Error("expected the dock");
    expect(runIsLive(start.run, useDockTimer.getState().timer)).toBe(true);
    expect(runIsLive(start.run, null)).toBe(false);
    expect(normalizeSquadRun(null)).toEqual({ ep: null, run: null });
    expect(normalizeSquadRun({ ep: "x", run: {} })).toEqual({ ep: null, run: null });
    expect(normalizeSquadRun({ ep: 2, run: { index: 99, title: "T" } }).run?.index).toBe(2);
  });

  it("makes no sound", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "src/app/(tools)/squad-session");
    for (const file of ["session.ts", "squad-session-client.tsx"]) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src).not.toMatch(/sonify|emitUiEvent|Audio\(|chime|alarm|vibrate/);
    }
  });
});

describe("the page", () => {
  it("asks for an episode first, with an example to try", () => {
    open(null);
    expect(screen.getByText("Pick an episode to start")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start the session/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load an example session" }));
    expect(h.push).toHaveBeenCalledWith(`/squad-session?ep=${EXAMPLE_EP}`);
    expect(normalizeActions(useSquadSessionStore.getState().actions)).toHaveLength(2);
  });

  it("uses the book's text when the art isn't out yet", () => {
    open(1);
    expect(screen.getByText(BOOK_EPISODES[0].lesson)).toBeInTheDocument();
    expect(screen.getByText(BOOK_EPISODES[0].question)).toBeInTheDocument();
    expect(screen.getByText("The comic will appear here soon")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/private property of this website/)).toBeInTheDocument();
  });

  it("uses the released art when there is some", () => {
    open(1, STORY);
    expect(screen.getByRole("img", { name: "The first panel." })).toBeInTheDocument();
    expect(screen.queryByText("The comic will appear here soon")).toBeNull();
  });

  it("starts the clock from the button", () => {
    open(3);
    fireEvent.click(screen.getByRole("button", { name: /Start the session/ }));
    expect(useSquadRun.getState().ep).toBe(3);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("the pill's plain address finds the episode that's running", async () => {
    startSession(5, "Episode");
    open(null);
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/squad-session?ep=5"));
  });
});

describe("a run on another episode", () => {
  it("keeps the clock with its own episode and links back to it", () => {
    startSession(5, "The fifth story");
    open(7);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/Step timer:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Start the session/ })).toBeNull();
    expect(
      screen.getByText("A session is running on episode 5: The fifth story.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to that session" })).toHaveAttribute(
      "href",
      "/squad-session?ep=5"
    );
    // This page is still episode 7's.
    expect(screen.getByText(BOOK_EPISODES[6].question)).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("shows the clock on the episode that's running", () => {
    startSession(5, "The fifth story");
    open(5);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText(/Step timer: The fifth story/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to that session" })).toBeNull();
  });

  it("leaves a finished run alone, so the next session can start", () => {
    startSession(5, "The fifth story");
    for (let i = 0; i < SESSION_STEPS.length; i++) advanceSession();
    expect(useSquadRun.getState().run?.finished).toBe(true);
    open(7);
    expect(screen.queryByRole("link", { name: "Back to that session" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start the session/ }));
    expect(useSquadRun.getState().ep).toBe(7);
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });
});

describe("when another page's timer has the dock", () => {
  const other: DockedTimer = {
    label: "Standup",
    href: "/ceremony-timer",
    totalSeconds: 60,
    endsAt: null,
    pausedRemaining: 60,
  };
  /** The message as anyone can see it, not the screen reader's copy. */
  const visible = (text: string) =>
    screen.queryAllByText(text).filter((el) => !el.closest(".sr-only"));

  it("says so on the page when Start can't take the clock", () => {
    useDockTimer.setState({ timer: other });
    open(3);
    fireEvent.click(screen.getByRole("button", { name: /Start the session/ }));
    const message = "The Standup timer is running. Stop it before starting this one.";
    expect(visible(message)).toHaveLength(1);
    expect(useSquadRun.getState().run).toBeNull();
    // Once that timer is gone, so is the message, and Start works.
    act(() => useDockTimer.setState({ timer: null }));
    expect(visible(message)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Start the session/ }));
    expect(useSquadRun.getState().ep).toBe(3);
  });

  it("says so on the page when the next step can't take it back", () => {
    startSession(3, "Episode");
    open(3);
    const nextButton = screen.getByRole("button", { name: /Next step/ });
    // Taken at the moment of the press, before this page has heard about it.
    act(() => {
      useDockTimer.setState({ timer: other });
      fireEvent.click(nextButton);
    });
    expect(visible("The Standup timer took the clock. Stop it to carry on.")).toHaveLength(1);
  });

  it("says nothing when the dock is free", () => {
    open(3);
    expect(screen.queryByText(/timer is running|took the clock/)).toBeNull();
  });
});

describe("actions", () => {
  const addAction = (title: string, owner = "") => {
    fireEvent.change(screen.getByRole("textbox", { name: /What will the team do/ }), {
      target: { value: title },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Who owns it/ }), {
      target: { value: owner },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
  };

  it("validates before saving", () => {
    expect(validateAction({ title: "  ", owner: "" })).toMatchObject({ ok: false });
    expect(validateAction({ title: "x".repeat(201), owner: "" })).toMatchObject({ ok: false });
    expect(validateAction({ title: " Do it ", owner: " Sam " })).toEqual({
      ok: true,
      values: { title: "Do it", owner: "Sam" },
    });
    open(1);
    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(screen.getByText("Say what the team will do.")).toBeInTheDocument();
    expect(useSquadSessionStore.getState().actions).toHaveLength(0);
  });

  it("keeps each episode's actions apart", async () => {
    open(1);
    addAction("Say what can wait", "Priya");
    await screen.findByText("Say what can wait");
    cleanup();
    open(2);
    await waitFor(() => expect(screen.queryByText("Say what can wait")).toBeNull());
    expect(normalizeActions(useSquadSessionStore.getState().actions)[0]).toMatchObject({
      ep: 1,
      title: "Say what can wait",
      owner: "Priya",
    });
  });

  it("removes an action with Undo", async () => {
    open(1);
    addAction("Say what can wait");
    fireEvent.click(await screen.findByRole("button", { name: "Remove Say what can wait" }));
    expect(useSquadSessionStore.getState().actions).toHaveLength(0);
    const [, options] = toastSpy.mock.calls[0] as [string, { action: { onClick: () => void } }];
    act(() => options.action.onClick());
    expect(useSquadSessionStore.getState().actions).toHaveLength(1);
  });

  it("sends them to Retro Actions as action items, once each, with Undo", async () => {
    open(1);
    addAction("Say what can wait", "Priya");
    addAction("Limit what's marked first");
    fireEvent.click(await screen.findByRole("button", { name: /Send all to Retro Actions/ }));

    const cards = retroCards();
    expect(cards.map((c) => c.text)).toEqual(["Say what can wait", "Limit what's marked first"]);
    expect(cards.every((c) => c.isActionItem)).toBe(true);
    expect(cards[0].assignee).toBe("Priya");
    expect(cards[0].sourceRef).toMatchObject({ tool: "squad-session", doc: "1" });
    expect(sourceLabel(cards[0].sourceRef)).toBe("From Squad Session Kit");
    expect(sourceHref(cards[0].sourceRef)).toBe("/squad-session?ep=1");

    // Nothing left to send, so a second press can't make duplicates.
    expect(screen.queryByRole("button", { name: /Send all to Retro Actions/ })).toBeNull();

    const [, options] = toastSpy.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];
    act(() => options.action.onClick());
    expect(retroCards()).toEqual([]);
  });

  it("exports the outcome as Markdown", async () => {
    open(1);
    addAction("Say what can wait", "Priya");
    await screen.findByText("Say what can wait");
    const md = screen.getByTestId("markdown").textContent ?? "";
    expect(md).toContain(`**Episode 1:** ${BOOK_EPISODES[0].title}`);
    expect(md).toContain(`**Ask your team:** ${BOOK_EPISODES[0].question}`);
    expect(md).toContain("1. Read the story (3 min)");
    expect(md).toContain("- Say what can wait (Priya)");
  });
});

describe("toMarkdown", () => {
  it("says so before an episode is picked or an action agreed", () => {
    expect(toMarkdown({ episode: null, steps: SESSION_STEPS, actions: [] })).toContain(
      "No episode picked yet."
    );
    const episode = { ep: 1, title: "T", lesson: "L", question: "Q" };
    expect(toMarkdown({ episode, steps: SESSION_STEPS, actions: [] })).toContain(
      "None agreed yet."
    );
  });

  it("keeps a line to one line and marks what's already sent", () => {
    const md = toMarkdown({
      episode: { ep: 1, title: "T", lesson: "L", question: "Q" },
      steps: SESSION_STEPS,
      actions: [{ id: "a", ep: 1, title: "Two\nlines", owner: "" }],
      sent: () => true,
    });
    expect(md).toContain("- Two lines — in Retro Actions");
  });
});

describe("example data", () => {
  it("is marked, so Clear example removes exactly it", () => {
    const rows = buildExample();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => isExampleId(r.id) && r.ep === EXAMPLE_EP)).toBe(true);
  });

  it("doesn't let an example reach the retro board", async () => {
    useSquadSessionStore.setState({ actions: buildExample() });
    open(EXAMPLE_EP);
    await screen.findByText(buildExample()[0].title);
    expect(screen.queryByRole("button", { name: /Send all to Retro Actions/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(useSquadSessionStore.getState().actions).toEqual([]);
  });
});

describe("the next step", () => {
  const rule = getNextStepRule("squad-session")!;
  const stepsFor = (boards: unknown) =>
    rule.steps(rule.select({ retroBoards: boards } as unknown as Workspace));

  it("is nothing until an action is out there", () => {
    expect(stepsFor([])).toEqual([]);
    expect(stepsFor(undefined)).toEqual([]);
  });

  it("follows up open actions in Retro Actions, each once", () => {
    const card = {
      id: "c1",
      isActionItem: true,
      done: false,
      sourceRef: { tool: "squad-session", id: "a" },
    };
    const done = { ...card, id: "c2", done: true };
    const other = { ...card, id: "c3", sourceRef: { tool: "retro", id: "b" } };
    const [step] = stepsFor([{ cards: [card, done, other] }, { cards: [card] }]);
    expect(step.href).toBe("/retro-actions");
    expect(step.detail).toBe("1 action from your squad sessions is still open.");
  });
});
