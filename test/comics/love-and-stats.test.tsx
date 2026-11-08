/**
 * The heart and the story counter: one love per browser that can be taken back,
 * one view and one reading-time band per page, and nothing at all counted for
 * the signed-in owner.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ owner: false }));

vi.mock("@/lib/auth/use-is-owner", () => ({
  useOwnerState: () => ({
    isOwner: h.owner,
    settled: true,
    unverified: false,
    visitor: !h.owner,
  }),
}));

import { LoveButton, lovesLabel } from "@/app/(tools)/comics/components/love-button";
import { StoryStats } from "@/app/(tools)/comics/components/story-stats";
import { isLoved, totalSeconds } from "@/lib/comics/reading";

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
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ loves: 25, readers: 40 }), { status: 200 })
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
  it("words the count for none, one and many", () => {
    expect(lovesLabel(0)).toBe("Be the first to love this");
    expect(lovesLabel(1)).toBe("1 reader loves this");
    expect(lovesLabel(24)).toBe("24 readers love this");
  });

  it("loves, shows the server's fresh count, and takes it back", async () => {
    render(<LoveButton ep={30} initialLoves={24} />);
    const button = screen.getByRole("button", { name: "Love this" });
    await act(async () => fireEvent.click(button));
    expect(isLoved(30)).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("25 readers love this")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ep: 30, events: ["love"] });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ loves: 24, readers: 40 }), { status: 200 })
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Loved" })));
    expect(isLoved(30)).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ep: 30, events: ["unlove"] });
    expect(screen.getByText("24 readers love this")).toBeTruthy();
  });

  it("remembers this browser's love on the next visit", async () => {
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ loved: { 30: "2026-11-08T08:00:00Z" } })
    );
    await act(async () => {
      render(<LoveButton ep={30} initialLoves={3} />);
    });
    expect(screen.getByRole("button", { name: "Loved" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("never counts the owner's own heart", async () => {
    h.owner = true;
    render(<LoveButton ep={30} initialLoves={3} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Love this" })));
    expect(isLoved(30)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("3 readers love this")).toBeTruthy();
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

  it("sends nothing for the owner", () => {
    h.owner = true;
    const view = render(<StoryStats ep={33} />);
    setVisibility("hidden");
    view.unmount();
    expect(beacon).not.toHaveBeenCalled();
  });
});
