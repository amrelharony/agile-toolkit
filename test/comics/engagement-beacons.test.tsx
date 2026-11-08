/**
 * The counts the story page's own actions send (lib/comics/stats): a first
 * finish, a retro hand-off, a share that went and a click on the story's tool,
 * each for weekly stories only, and none for the owner or while sign-in is
 * still being checked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ owner: false, settled: true }));

vi.mock("@/lib/auth/use-is-owner", () => ({
  useOwnerState: () => ({
    isOwner: h.owner,
    settled: h.settled,
    unverified: false,
    visitor: h.settled && !h.owner,
  }),
}));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: () => {} }));
vi.mock("@/lib/team/use-team-roster", () => ({ useWorkspaceHydrated: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import {
  DiscussInRetro,
  READ_DWELL_MS,
  ReadTracker,
} from "@/app/(tools)/comics/components/story-actions";
import { SeenAtWork } from "@/app/(tools)/comics/components/seen-at-work";
import { StoryNav } from "@/app/(tools)/comics/components/story-nav";
import { ToolLink } from "@/app/(tools)/comics/components/tool-link";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const beacon = vi.fn(() => true);

async function sent(): Promise<{ ep: number; events: string[] }[]> {
  const calls = beacon.mock.calls as unknown as [string, Blob][];
  return Promise.all(calls.map(async ([, blob]) => JSON.parse(await blob.text())));
}

let show: (visible: boolean) => void = () => {};
class FakeObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {
    show = (visible) =>
      this.cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  h.owner = false;
  h.settled = true;
  localStorage.clear();
  beacon.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  useWorkspaceStore.setState({ retroBoards: [] });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function readToTheEnd(ep: number) {
  vi.useFakeTimers();
  render(<ReadTracker ep={ep} />);
  act(() => show(true));
  act(() => {
    vi.advanceTimersByTime(READ_DWELL_MS + 10);
  });
  vi.useRealTimers();
}

describe("a first finish", () => {
  it("counts a weekly story's reader once", async () => {
    readToTheEnd(30);
    cleanup();
    readToTheEnd(30);
    expect(await sent()).toEqual([{ ep: 30, events: ["reader"] }]);
  });

  it("sends nothing for a book episode, the owner, or before sign-in has settled", async () => {
    readToTheEnd(5);
    cleanup();
    h.owner = true;
    readToTheEnd(31);
    cleanup();
    h.owner = false;
    h.settled = false;
    readToTheEnd(32);
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("a retro hand-off", () => {
  it("counts the first time a weekly story's question goes to the retro", async () => {
    render(<DiscussInRetro ep={30} question="What can wait?" />);
    fireEvent.click(screen.getByRole("button", { name: "Discuss in your retro" }));
    expect(await sent()).toEqual([{ ep: 30, events: ["retro"] }]);
  });

  it("sends nothing for a book episode", () => {
    render(<DiscussInRetro ep={3} question="What can wait?" />);
    fireEvent.click(screen.getByRole("button", { name: "Discuss in your retro" }));
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("a share", () => {
  it("counts a share that went, never a dismissed share sheet", async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(<StoryNav ep={30} title="Return Address" prevEp={null} nextEp={null} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share a link" }));
    });
    expect(await sent()).toEqual([{ ep: 30, events: ["share"] }]);

    share.mockRejectedValueOnce(new Error("AbortError"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share a link" }));
    });
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("the story's tool", () => {
  it("counts a click on a weekly story's tool link", async () => {
    render(
      <ToolLink ep={30} href="/kanban">
        Kanban Board
      </ToolLink>
    );
    fireEvent.click(screen.getByRole("link", { name: "Kanban Board" }));
    expect(await sent()).toEqual([{ ep: 30, events: ["tool"] }]);
  });
});

describe("Seen this at work, for the owner", () => {
  it("shows the owner the totals without counting their answer", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ counts: [3, 1], shares: null }))
    );
    vi.stubGlobal("fetch", fetchMock);
    h.owner = true;
    render(<SeenAtWork ep={30} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, I've seen this" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/comics/taps?ep=30&kind=seen"]);
  });

  it("counts a visitor's answer", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ counts: [4, 1], shares: null }))
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SeenAtWork ep={30} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, I've seen this" }));
    });
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ method: "POST" });
  });
});
