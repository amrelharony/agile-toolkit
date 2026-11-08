/**
 * The heart and the story counter: one love per browser that can be taken back,
 * one view and one reading-time band per page, and nothing at all counted for
 * the signed-in owner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ owner: false, settled: true }));

vi.mock("@/lib/auth/use-is-owner", () => ({
  useOwnerState: () => ({
    isOwner: h.owner,
    settled: h.settled,
    unverified: false,
    visitor: h.settled && !h.owner,
  }),
}));

import {
  LoveButton,
  NOT_COUNTED,
  heartLine,
  lovesLabel,
  readersLabel,
} from "@/app/(tools)/comics/components/love-button";
import { StoryStats } from "@/app/(tools)/comics/components/story-stats";
import { COUNTED_KEY, isLoveCounted, isLoved, markRead, totalSeconds } from "@/lib/comics/reading";

const fetchMock = vi.fn();
const beacon = vi.fn(() => true);

async function sentPayloads(): Promise<{ ep: number; events: string[] }[]> {
  const calls = beacon.mock.calls as unknown as [string, Blob][];
  return Promise.all(calls.map(async ([, blob]) => JSON.parse(await blob.text())));
}

async function sentEvents(): Promise<string[][]> {
  return (await sentPayloads()).map((p) => p.events);
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
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
});

describe("LoveButton", () => {
  const answer = (loves: number) =>
    new Response(JSON.stringify({ loves, readers: 4 }), { status: 200 });
  const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).events[0]);
  const heart = () => screen.getByRole("button", { name: "Love this" });
  // The line beside the heart, which is read, not announced.
  const line = () => heart().parentElement?.querySelector("p:not([role])")?.textContent;
  const announced = () => screen.getByRole("status").textContent;
  /** A request whose answer comes when the test says. */
  const held = () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    return (r: Response) => act(async () => release(r));
  };

  it("words the count for none, one and many, and for this reader's own love", () => {
    expect(lovesLabel(0)).toBe("Be the first to love this");
    expect(lovesLabel(1)).toBe("1 reader loves this");
    expect(lovesLabel(24)).toBe("24 readers love this");
    expect(lovesLabel(0, true)).toBe("You love this");
    expect(lovesLabel(1, true)).toBe("You love this");
    expect(lovesLabel(5, true)).toBe("5 readers love this");
    // A heart that's on but wasn't counted never says "Be the first".
    expect(lovesLabel(0, false, true)).toBe("No loves counted yet");
    expect(lovesLabel(1, false, true)).toBe("1 reader loves this");
    // The whole line says when a heart that's on isn't among the count.
    expect(heartLine(3, false, true, true)).toBe("3 readers love this (yours isn't counted)");
    // A counted mark missing from this device (a restore) proves nothing.
    expect(heartLine(3, false, true)).toBe("3 readers love this");
    expect(heartLine(3, true)).toBe("3 readers love this");
    expect(heartLine(0, false, true)).toBe("No loves counted yet");
  });

  it("loves, shows the server's fresh count, and takes it back", async () => {
    render(<LoveButton ep={30} initialLoves={24} />);
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(true);
    expect(isLoveCounted(30)).toBe(true);
    // The label never changes: the pressed state is aria-pressed.
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(line()).toBe("25 readers love this");
    expect(announced()).toBe("25 readers love this");

    fetchMock.mockResolvedValue(answer(24));
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(false);
    expect(isLoveCounted(30)).toBe(false);
    expect(sentBodies()).toEqual(["love", "unlove"]);
    expect(line()).toBe("24 readers love this");
  });

  it("never takes back a love the server didn't count, nor shows it in the count", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 503 }));
    render(<LoveButton ep={30} initialLoves={4} />);
    await act(async () => fireEvent.click(heart()));
    expect(isLoved(30)).toBe(true);
    expect(isLoveCounted(30)).toBe(false);
    // The press's +1 goes again: the server holds 4. And it says so.
    expect(line()).toBe("4 readers love this (yours isn't counted)");
    expect(announced()).toBe(NOT_COUNTED);
    await act(async () => fireEvent.click(heart()));
    expect(sentBodies()).toEqual(["love"]);
    expect(line()).toBe("4 readers love this");
  });

  it("says when a heart on a story with no loves wasn't counted, and clears an old announcement", async () => {
    render(<LoveButton ep={30} initialLoves={0} />);
    fetchMock.mockResolvedValue(answer(1));
    await act(async () => fireEvent.click(heart()));
    expect(announced()).toBe("You love this");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await act(async () => fireEvent.click(heart()));
    // The take-back wasn't counted: the server still holds the love.
    expect(announced()).toBe(NOT_COUNTED);
    expect(line()).toBe("1 reader loves this");
    localStorage.clear();
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const other = render(<LoveButton ep={31} initialLoves={0} />);
    await act(async () => fireEvent.click(within(other.container).getByRole("button")));
    expect(other.container.querySelector("p:not([role])")?.textContent).toBe(
      "No loves counted yet"
    );
  });

  it("sends once for two tabs of the same story, one after the other", async () => {
    // Web Locks, as a browser runs them: one holder per name at a time.
    const queues = new Map<string, Promise<unknown>>();
    const names: string[] = [];
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (name: string, task: () => Promise<void>) => {
          names.push(name);
          const run = (queues.get(name) ?? Promise.resolve()).then(task);
          queues.set(
            name,
            run.catch(() => undefined)
          );
          return run;
        },
      },
    });
    const release = held();
    const first = render(<LoveButton ep={30} initialLoves={9} />);
    const second = render(<LoveButton ep={30} initialLoves={9} />);
    const tab = (r: typeof first) => within(r.container).getByRole("button");
    await act(async () => fireEvent.click(tab(first)));
    // The second tab's heart is stale: it catches up, takes it back, loves again.
    await act(async () => fireEvent.click(tab(second)));
    await act(async () => fireEvent.click(tab(second)));
    await act(async () => fireEvent.click(tab(second)));
    await release(answer(10));
    expect(sentBodies()).toEqual(["love"]);
    expect(isLoveCounted(30)).toBe(true);
    expect(new Set(names)).toEqual(new Set(["agile-toolkit:comics:love:30"]));
    // The tab that waited counts in the love the first tab sent for it.
    const secondLine = second.container.querySelector("p:not([role])")?.textContent;
    expect(secondLine).toBe("10 readers love this");
    expect(within(second.container).getByRole("status").textContent).toBe("10 readers love this");
  });

  it("counts in a love another tab already sent when this tab catches up", async () => {
    render(<LoveButton ep={30} initialLoves={4} />);
    // Another tab loved it and the server counted it.
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    localStorage.setItem(COUNTED_KEY, JSON.stringify({ 30: "2026-11-08T08:00:01Z" }));
    await act(async () => fireEvent.click(heart()));
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(line()).toBe("5 readers love this");
    expect(announced()).toBe("5 readers love this");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts out a love another tab took back when this tab catches up", async () => {
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    localStorage.setItem(COUNTED_KEY, JSON.stringify({ 30: "2026-11-08T08:00:01Z" }));
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={5} />);
    });
    // Another tab took it back, and the server let it go.
    localStorage.clear();
    await act(async () => fireEvent.click(heart()));
    expect(heart().getAttribute("aria-pressed")).toBe("false");
    expect(line()).toBe("4 readers love this");
    expect(announced()).toBe("4 readers love this");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't say a restored love isn't counted: this device just has no mark", async () => {
    // A backup carries the love, never the counted mark.
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={1} />);
    });
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(line()).toBe("1 reader loves this");
  });

  it("clears the announcement while a press is sent, so the same outcome is said again", async () => {
    const release = held();
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    render(<LoveButton ep={30} initialLoves={5} />);
    await act(async () => fireEvent.click(heart()));
    expect(announced()).toBe("");
    await release(new Response(null, { status: 503 }));
    expect(announced()).toBe(NOT_COUNTED);
    // Taken back unsent (the server holds nothing), then loved again: fails again.
    await act(async () => fireEvent.click(heart()));
    expect(announced()).toBe("5 readers love this");
    await act(async () => fireEvent.click(heart()));
    expect(announced()).toBe(NOT_COUNTED);
    // And once more with the send held: the old outcome is gone while it's out.
    const again = held();
    await act(async () => fireEvent.click(heart()));
    await act(async () => fireEvent.click(heart()));
    expect(announced()).toBe("");
    await again(new Response(null, { status: 503 }));
    expect(announced()).toBe(NOT_COUNTED);
    expect(sentBodies()).toEqual(["love", "love", "love"]);
  });

  it("doesn't take back the owner's uncounted love when that browser is later a visitor", async () => {
    h.owner = true;
    const first = render(<LoveButton ep={30} initialLoves={1} />);
    await act(async () => fireEvent.click(heart()));
    expect(fetchMock).not.toHaveBeenCalled();
    // The one love is another reader's, so it isn't "You love this", and the
    // line (announced too) says the owner's heart isn't counted.
    expect(line()).toBe("1 reader loves this (yours isn't counted)");
    expect(announced()).toBe("1 reader loves this (yours isn't counted)");
    first.unmount();

    h.owner = false;
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={1} />);
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

  it("sends one request at a time, however quick the taps", async () => {
    const release = held();
    render(<LoveButton ep={30} initialLoves={9} />);
    await act(async () => fireEvent.click(heart()));
    // While it's out, the count follows the heart.
    expect(line()).toBe("10 readers love this");
    await act(async () => fireEvent.click(heart()));
    expect(line()).toBe("9 readers love this");
    await act(async () => fireEvent.click(heart()));
    expect(sentBodies()).toEqual(["love"]);
    // The answer matches what the reader wants now: nothing more to send.
    await release(answer(10));
    expect(sentBodies()).toEqual(["love"]);
    expect(isLoveCounted(30)).toBe(true);
    expect(line()).toBe("10 readers love this");
  });

  it("says how many have read it, from ten readers", async () => {
    expect(readersLabel(9)).toBeNull();
    expect(readersLabel(10)).toBe("Read by 10 readers");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ loves: 3, readers: 40 }), { status: 200 })
    );
    render(<LoveButton ep={30} initialLoves={2} initialReaders={9} />);
    expect(line()).toBe("2 readers love this");
    await act(async () => fireEvent.click(heart()));
    expect(line()).toBe("3 readers love this · Read by 40 readers");
  });

  it("takes back a love pressed away while it was being sent", async () => {
    const release = held();
    fetchMock.mockResolvedValueOnce(answer(9));
    render(<LoveButton ep={30} initialLoves={9} />);
    await act(async () => fireEvent.click(heart()));
    await act(async () => fireEvent.click(heart()));
    await release(answer(10));
    expect(sentBodies()).toEqual(["love", "unlove"]);
    expect(isLoveCounted(30)).toBe(false);
    expect(heart().getAttribute("aria-pressed")).toBe("false");
    expect(line()).toBe("9 readers love this");
    expect(announced()).toBe("9 readers love this");
  });

  it("remembers this browser's love on the next visit, without announcing it", async () => {
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    localStorage.setItem(COUNTED_KEY, JSON.stringify({ 30: "2026-11-08T08:00:01Z" }));
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={1} />);
    });
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(line()).toBe("You love this");
    expect(announced()).toBe("");
  });

  it("works for the visit when the browser can't keep it, counting nothing", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      render(<LoveButton ep={30} initialLoves={2} />);
      await act(async () => fireEvent.click(heart()));
      expect(heart().getAttribute("aria-pressed")).toBe("true");
      expect(line()).toBe("2 readers love this (yours isn't counted)");
      await act(async () => fireEvent.click(heart()));
      expect(heart().getAttribute("aria-pressed")).toBe("false");
      // With no record, every visit could add another love.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it("catches up when another tab already loved the story, sending what it couldn't", async () => {
    render(<LoveButton ep={30} initialLoves={2} />);
    // Another tab loved it, but its send failed: the server doesn't hold it.
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    fetchMock.mockResolvedValue(answer(3));
    await act(async () => fireEvent.click(heart()));
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    // This press wants the heart on, so it's sent, once.
    expect(sentBodies()).toEqual(["love"]);
    expect(line()).toBe("3 readers love this");
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
    const bands = async () =>
      (await sentPayloads()).filter((p) => p.events[0].startsWith("time:")).map((p) => p.ep);
    // Left for another page of the site: the story unmounts.
    const leaving = render(<StoryStats ep={34} />);
    leaving.unmount();
    expect(await bands()).toEqual([34]);
    // Put away: pagehide alone sends it, and nothing after adds another.
    render(<StoryStats ep={35} />);
    window.dispatchEvent(new Event("pagehide"));
    expect(await bands()).toEqual([34, 35]);
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    expect(await bands()).toEqual([34, 35]);
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
