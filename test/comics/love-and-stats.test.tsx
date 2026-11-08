/**
 * The heart and the story counter: one love per browser that can be taken back,
 * one view and one reading-time band per page, and nothing at all counted for
 * the signed-in owner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ owner: false, settled: true }));

vi.mock("@/lib/auth/use-is-owner", () => ({
  useOwnerState: () => ({
    isOwner: h.owner,
    settled: h.settled,
    unverified: false,
    visitor: h.settled && !h.owner,
  }),
}));

import { LoveButton, lovesLabel, readersLabel } from "@/app/(tools)/comics/components/love-button";
import { StoryStats } from "@/app/(tools)/comics/components/story-stats";
import { isLoveCounted, isLoved, markRead, totalSeconds } from "@/lib/comics/reading";

const fetchMock = vi.fn();
const beacon = vi.fn(() => true);

async function sentEvents(): Promise<string[][]> {
  const calls = beacon.mock.calls as unknown as [string, Blob][];
  return Promise.all(calls.map(async ([, blob]) => JSON.parse(await blob.text()).events));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  h.owner = false;
  h.settled = true;
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ loves: 25, readers: 4 }), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  beacon.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LoveButton", () => {
  const answer = (loves: number) =>
    new Response(JSON.stringify({ loves, readers: 4 }), { status: 200 });
  const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).events[0]);
  const heart = () => screen.getByRole("button", { name: "Love this" });

  it("words the count for none, one and many, and for this reader's own love", () => {
    expect(lovesLabel(0)).toBe("Be the first to love this");
    expect(lovesLabel(1)).toBe("1 reader loves this");
    expect(lovesLabel(24)).toBe("24 readers love this");
    expect(lovesLabel(0, true)).toBe("You love this");
    expect(lovesLabel(1, true)).toBe("You love this");
    expect(lovesLabel(5, true)).toBe("5 readers love this");
  });

  it("loves, shows the server's fresh count, and takes it back", async () => {
    render(<LoveButton ep={30} initialLoves={24} />);
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(true);
    expect(isLoveCounted(30)).toBe(true);
    // The label never changes: the pressed state is aria-pressed.
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("25 readers love this");

    fetchMock.mockResolvedValue(answer(24));
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(false);
    expect(isLoveCounted(30)).toBe(false);
    expect(sentBodies()).toEqual(["love", "unlove"]);
    expect(screen.getByRole("status").textContent).toBe("24 readers love this");
  });

  it("never takes back a love the server didn't count", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 503 }));
    render(<LoveButton ep={30} initialLoves={4} />);
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(true);
    expect(isLoveCounted(30)).toBe(false);
    await act(async () => fireEvent.click(heart()));
    expect(sentBodies()).toEqual(["love"]);
  });

  it("doesn't take back the owner's uncounted love when that browser is later a visitor", async () => {
    h.owner = true;
    const first = render(<LoveButton ep={30} initialLoves={3} />);
    await act(async () => fireEvent.click(heart()));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("3 readers love this");
    first.unmount();

    h.owner = false;
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={3} />);
    });
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't count a love twice when a take-back failed", async () => {
    render(<LoveButton ep={30} initialLoves={4} />);
    await act(async () => fireEvent.click(heart()));
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await act(async () => fireEvent.click(heart()));
    // The server still holds the love, so loving again sends nothing.
    await act(async () => fireEvent.click(heart()));
    expect(sentBodies()).toEqual(["love", "unlove"]);
    expect(isLoved(30)).toBe(true);
  });

  it("shows the answer to the latest press when answers arrive out of order", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(answer(9));
    render(<LoveButton ep={30} initialLoves={9} />);
    await act(async () => fireEvent.click(heart()));
    // The first press's answer hasn't come, so the love isn't counted yet:
    // taking it back sends nothing and the count stays.
    await act(async () => fireEvent.click(heart()));
    expect(sentBodies()).toEqual(["love"]);
    await act(async () => releaseFirst(answer(10)));
    expect(screen.getByRole("status").textContent).toBe("10 readers love this");
  });

  it("says how many have read it, from ten readers", async () => {
    expect(readersLabel(9)).toBeNull();
    expect(readersLabel(10)).toBe("Read by 10 readers");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ loves: 3, readers: 40 }), { status: 200 })
    );
    render(<LoveButton ep={30} initialLoves={2} initialReaders={9} />);
    expect(screen.getByRole("status").textContent).toBe("2 readers love this");
    await act(async () => fireEvent.click(heart()));
    expect(screen.getByRole("status").textContent).toBe("3 readers love this · Read by 40 readers");
  });

  it("remembers this browser's love on the next visit", async () => {
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={3} />);
    });
    expect(heart().getAttribute("aria-pressed")).toBe("true");
  });

  it("still works for the visit when the browser can't keep it", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      render(<LoveButton ep={30} initialLoves={2} />);
      await act(async () => fireEvent.click(heart()));
      expect(heart().getAttribute("aria-pressed")).toBe("true");
      await act(async () => fireEvent.click(heart()));
      expect(heart().getAttribute("aria-pressed")).toBe("false");
      expect(sentBodies()).toEqual(["love", "unlove"]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("catches up when another tab already loved the story", async () => {
    render(<LoveButton ep={30} initialLoves={2} />);
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    await act(async () => fireEvent.click(heart()));
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never counts the owner's own heart, or one pressed before sign-in settles", async () => {
    h.owner = true;
    const view = render(<LoveButton ep={30} initialLoves={3} />);
    await act(async () => fireEvent.click(heart()));
    view.unmount();
    localStorage.clear();
    h.owner = false;
    h.settled = false;
    render(<LoveButton ep={31} initialLoves={3} />);
    await act(async () => fireEvent.click(heart()));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("StoryStats", () => {
  it("counts a view, a first visitor, and one time band when the page is hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T08:00:00Z"));
    render(<StoryStats ep={30} />);
    // Reading: an input every 20 seconds for 90 seconds.
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(20_000);
      window.dispatchEvent(new Event("scroll"));
    }
    vi.advanceTimersByTime(10_000);
    setVisibility("hidden");
    // Back and away again: kept for Your reading, not counted twice.
    setVisibility("visible");
    vi.advanceTimersByTime(30_000);
    setVisibility("hidden");
    vi.useRealTimers();
    expect(await sentEvents()).toEqual([["view", "visitor"], ["time:3"]]);
    expect(totalSeconds()).toBe(120);
  });

  it("stops the clock after a minute without input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T08:00:00Z"));
    render(<StoryStats ep={31} />);
    vi.advanceTimersByTime(5 * 60_000);
    setVisibility("hidden");
    vi.useRealTimers();
    expect((await sentEvents())[1]).toEqual(["time:3"]);
    expect(totalSeconds()).toBe(60);
  });

  it("counts a returning browser's view without calling it a new visitor", async () => {
    const first = render(<StoryStats ep={32} />);
    first.unmount();
    beacon.mockClear();
    render(<StoryStats ep={32} />);
    expect((await sentEvents())[0]).toEqual(["view"]);
  });

  it("sends one time band when the story is left inside the site, or the page is put away", async () => {
    const leaving = render(<StoryStats ep={34} />);
    leaving.unmount();
    render(<StoryStats ep={35} />);
    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    const events = await sentEvents();
    expect(events.filter((e) => e[0].startsWith("time:"))).toHaveLength(2);
  });

  it("doesn't call a story read before the counts began a new visitor", async () => {
    markRead(36);
    render(<StoryStats ep={36} />);
    expect((await sentEvents())[0]).toEqual(["view"]);
  });

  it("waits until sign-in has settled", () => {
    h.settled = false;
    render(<StoryStats ep={37} />);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("sends nothing for the owner", () => {
    h.owner = true;
    const view = render(<StoryStats ep={33} />);
    setVisibility("hidden");
    view.unmount();
    expect(beacon).not.toHaveBeenCalled();
  });
});
