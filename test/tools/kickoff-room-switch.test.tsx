import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kickoff } from "@/lib/stores/workspace-types";
import type { KickoffHandle } from "@/app/(tools)/kickoff/kickoff-handle";

/**
 * Kickoff's collect room lives in the kickoff shown, so whatever changes
 * what shows would end it for every phone in it. With nothing picked the
 * newest kickoff shows, and a change to another one (Amr's verb, another
 * tab) re-sorts the list: the view stays pinned to the one shown. Picking
 * another kickoff, starting a new one or deleting this one while the room
 * is live asks first (saying when its round holds unsaved answers), as the
 * room kit's End room does.
 *
 * The room itself is a stand-in here (test/tools/kickoff-room.test.tsx
 * runs the real one): it goes live, takes posts, and tells the page as the
 * real one does (`onLiveChange`, null when it ends or unmounts).
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "t" }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: () => {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/kickoff",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

type LiveChange = (room: { unsaved: boolean; end?: () => Promise<void> } | null) => void;

/** How many times a room mounted, by kickoff: a remount would lose its posts. */
const mounts = vi.hoisted(() => [] as string[]);
/** The rooms the page ended itself (with the room's `end`), by kickoff. */
const ended = vi.hoisted(() => [] as string[]);
/** Whether the stand-in hands the page an `end`, as the real room does. */
const fake = vi.hoisted(() => ({ withEnd: false }));

/** Mounted while the stand-in room is live, as the real LiveRoom is. */
function FakeLive({
  posts,
  onLiveChange,
  onEnd,
}: {
  posts: number;
  onLiveChange?: LiveChange;
  onEnd: () => void;
}) {
  const report = useRef(onLiveChange);
  report.current = onLiveChange;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  // As the real LiveRoom: `end` resolves once the room is over (this unmounts).
  const waiting = useRef<(() => void)[]>([]);
  useEffect(() => {
    const end = () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        endRef.current();
      });
    report.current?.(fake.withEnd ? { unsaved: posts > 0, end } : { unsaved: posts > 0 });
  }, [posts]);
  useEffect(() => {
    const list = waiting.current;
    return () => {
      report.current?.(null);
      list.splice(0).forEach((done) => done());
    };
  }, []);
  return null;
}

function FakeRoom({ handle, onLiveChange }: { handle: KickoffHandle; onLiveChange?: LiveChange }) {
  const [live, setLive] = useState(false);
  const [posts, setPosts] = useState(0);
  useEffect(() => {
    mounts.push(handle.kickoff.id);
  }, [handle.kickoff.id]);
  return (
    <div data-testid="room" data-kickoff={handle.kickoff.id}>
      {live ? (
        <>
          <span>{`${posts} posts on the wall`}</span>
          <button type="button" onClick={() => setPosts((n) => n + 1)}>
            Post
          </button>
          <button type="button" onClick={() => setLive(false)}>
            End room
          </button>
          <FakeLive
            posts={posts}
            onLiveChange={onLiveChange}
            onEnd={() => {
              ended.push(handle.kickoff.id);
              setLive(false);
            }}
          />
        </>
      ) : (
        <button type="button" onClick={() => setLive(true)}>
          Go live
        </button>
      )}
    </div>
  );
}

vi.mock("@/app/(tools)/kickoff/collect-room", () => ({
  CollectRoom: (props: { handle: KickoffHandle; onLiveChange?: LiveChange }) => (
    <FakeRoom {...props} />
  ),
}));

import { KickoffClient } from "@/app/(tools)/kickoff/kickoff-client";

const ws = () => useWorkspaceStore.getState();
const kickoff = (id: string, title: string, updatedAt: string): Kickoff => ({
  id,
  title,
  format: "alignment-map",
  sections: {},
  status: "draft",
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt,
});

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <KickoffClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** The kickoff the page shows, by its heading. */
const shown = () => document.querySelector("section[aria-labelledby] > h2")?.textContent;
/** The kickoffs in the list, in its order. */
const listed = () =>
  within(screen.getByRole("navigation", { name: "Kickoffs" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

/** Open the room on the kickoff shown, go live and post `n` answers. */
async function goLive(n = 1) {
  fireEvent.click(screen.getByRole("button", { name: "Collect answers from phones" }));
  fireEvent.click(await screen.findByRole("button", { name: "Go live" }));
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByRole("button", { name: "Post" }));
}

beforeEach(() => {
  mounts.length = 0;
  ended.length = 0;
  fake.withEnd = false;
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/kickoff");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    kickoffs: [
      kickoff("kA", "Checkout squad", "2026-11-21T09:00:00.000Z"),
      kickoff("kB", "Refunds", "2026-11-20T09:00:00.000Z"),
    ],
    teamMembers: [],
    productGoals: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a live collect room and the kickoff shown", () => {
  it("stays on the kickoff shown when another one changes and sorts first", async () => {
    renderPage();
    // Nothing picked: the newest shows.
    expect(shown()).toBe("Checkout squad");
    await goLive(2);
    expect(screen.getByText("2 posts on the wall")).toBeInTheDocument();
    // Amr (or another tab) changes the other kickoff: it is newest now.
    act(() => {
      ws().upsertKickoff({
        ...kickoff("kB", "Refunds", "2026-11-22T09:00:00.000Z"),
        sections: { objectives: [{ id: "o1", text: "Refunds in a day" }] },
      });
    });
    expect(listed()[0]).toMatch(/^Refunds/);
    expect(shown()).toBe("Checkout squad");
    expect(screen.getByTestId("room")).toHaveAttribute("data-kickoff", "kA");
    expect(screen.getByText("2 posts on the wall")).toBeInTheDocument();
    expect(mounts).toEqual(["kA"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays put on a re-sort with no room open too", () => {
    renderPage();
    expect(shown()).toBe("Checkout squad");
    act(() => ws().upsertKickoff(kickoff("kB", "Refunds", "2026-11-22T09:00:00.000Z")));
    expect(shown()).toBe("Checkout squad");
  });

  it("asks before showing another kickoff, and keeps the room on Keep the room", async () => {
    renderPage();
    await goLive(1);
    fireEvent.click(screen.getByRole("button", { name: /^Refunds/ }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent(
      "The room on “Checkout squad” is still live. Showing another kickoff ends it for everyone in it, and the answers in its round aren't saved, so they'd be lost."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown()).toBe("Checkout squad");
    expect(screen.getByText("1 posts on the wall")).toBeInTheDocument();
    // Asked again, and this time ended.
    fireEvent.click(screen.getByRole("button", { name: /^Refunds/ }));
    fireEvent.click(screen.getByRole("button", { name: "End it and switch" }));
    expect(shown()).toBe("Refunds");
    expect(screen.queryByTestId("room")).toBeNull();
    // The room is gone, so the next switch doesn't ask.
    fireEvent.click(screen.getByRole("button", { name: /^Checkout squad/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown()).toBe("Checkout squad");
  });

  it("says nothing is lost when the round holds no answers, and stops asking once the room ends", async () => {
    renderPage();
    await goLive(0);
    fireEvent.click(screen.getByRole("button", { name: /^Refunds/ }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent(
      "The room on “Checkout squad” is still live. Showing another kickoff ends it for everyone in it."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    fireEvent.click(screen.getByRole("button", { name: /^Refunds/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown()).toBe("Refunds");
  });

  it("starts a new kickoff into the list and asks before showing it", async () => {
    renderPage();
    await goLive(1);
    fireEvent.click(screen.getByRole("button", { name: "New kickoff" }));
    fireEvent.click(screen.getByRole("button", { name: /^Problem framing/ }));
    const form = screen.getByRole("button", { name: "Start the kickoff" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: "Slow refunds" } });
    fireEvent.click(screen.getByRole("button", { name: "Start the kickoff" }));
    expect((ws().kickoffs ?? []).map((k) => k.title)).toContain("Slow refunds");
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(shown()).toBe("Checkout squad");
    expect(screen.getByText("1 posts on the wall")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Slow refunds/ })).toBeInTheDocument();
  });

  it("ends the room for everyone in it before it shows the other kickoff", async () => {
    fake.withEnd = true;
    renderPage();
    await goLive(1);
    fireEvent.click(screen.getByRole("button", { name: /^Refunds/ }));
    fireEvent.click(screen.getByRole("button", { name: "End it and switch" }));
    // Ended by the page (signed, for every phone), not left behind to time out.
    expect(ended).toEqual(["kA"]);
    await waitFor(() => expect(shown()).toBe("Refunds"));
    expect(screen.queryByTestId("room")).toBeNull();
  });

  it("asks before deleting the kickoff whose room is live", async () => {
    renderPage();
    await goLive(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete this kickoff" }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent("Deleting the kickoff ends it for everyone in it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect((ws().kickoffs ?? []).map((k) => k.id)).toContain("kA");
    fireEvent.click(screen.getByRole("button", { name: "Delete this kickoff" }));
    fireEvent.click(screen.getByRole("button", { name: "End it and delete" }));
    expect((ws().kickoffs ?? []).map((k) => k.id)).toEqual(["kB"]);
    expect(shown()).toBe("Refunds");
  });
});
