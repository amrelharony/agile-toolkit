/**
 * The reader's weekly streak and the cast they've met: worked out in the
 * browser from the reading record, with nothing sent anywhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { READING_KEY, READ_EVENT } from "@/lib/comics/reading";

const h = vi.hoisted(() => ({ vip: false }));
vi.mock("@/lib/vip/use-vip-hint", () => ({ useVipHint: () => h.vip }));

import {
  ReaderProgress,
  StreakNote,
  metCast,
  readingTimeLabel,
} from "@/app/(tools)/comics/components/reader-progress";

const CAST = ["Amr", "Dinosaur", "HiPPO", "Retrospective Turtle"];
const STORIES = [
  { ep: 27, castNames: ["HiPPO", "Retrospective Turtle"], title: "Return Address" },
  { ep: 28, castNames: ["Amr", "Dinosaur", "Someone Unlisted"], title: "The Practice Desk" },
  { ep: 29, castNames: ["HiPPO", "Amr"], title: "A Different Kind of Help" },
];

function reading(read: Record<number, string>) {
  localStorage.setItem(READING_KEY, JSON.stringify({ read, sent: {}, asked: {} }));
}

beforeEach(() => {
  localStorage.clear();
  h.vip = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z")); // a Wednesday
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the cast a reader has met", () => {
  it("is everyone in the stories read, each with the first story read, in cast order", () => {
    expect(metCast(CAST, STORIES, [{ ep: 29 }, { ep: 27 }])).toEqual([
      { name: "Amr", ep: 29 },
      { name: "HiPPO", ep: 29 },
      { name: "Retrospective Turtle", ep: 27 },
    ]);
  });

  it("counts no name that isn't in the cast, and no story it doesn't know", () => {
    expect(metCast(CAST, STORIES, [{ ep: 28 }, { ep: 99 }]).map((m) => m.name)).toEqual([
      "Amr",
      "Dinosaur",
    ]);
  });
});

describe("Your reading, on /comics", () => {
  it("starts at nothing for a new reader, at the same size", () => {
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    expect(screen.getByText("Weeks in a row: 0")).toBeTruthy();
    expect(screen.getByText("Cast met: 0 of 4")).toBeTruthy();
    fireEvent.click(screen.getByText("Cast you've met"));
    expect(
      screen.getByText(/Each story you read to the end adds its colleagues here/)
    ).toBeTruthy();
  });

  it("shows the streak and links each colleague met to where the reader met them", () => {
    reading({ 27: "2026-11-01T09:00:00.000Z", 28: "2026-11-09T09:00:00.000Z" });
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    expect(screen.getByText("Weeks in a row: 2")).toBeTruthy();
    expect(screen.getByText("Cast met: 4 of 4")).toBeTruthy();
    expect(screen.getByRole("link", { name: /HiPPO/ })).toHaveAttribute("href", "/comics?ep=27");
    expect(screen.getByRole("link", { name: /Dinosaur/ })).toHaveAttribute("href", "/comics?ep=28");
    expect(screen.queryByRole("link", { name: "Meet the whole cast" })).toBeNull();
  });

  it("counts the stories read and the reader's own reading time", () => {
    localStorage.setItem(
      READING_KEY,
      JSON.stringify({
        read: { 27: "2026-11-09T09:00:00.000Z", 28: "2026-11-10T09:00:00.000Z" },
        seconds: { 27: 1800, 28: 2100 },
      })
    );
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    expect(screen.getByText("Stories read: 2")).toBeTruthy();
    expect(screen.getByText("Time reading: 1 h 5 min")).toBeTruthy();
  });

  it("lists the stories this browser loves, newest love first", () => {
    localStorage.setItem(
      READING_KEY,
      JSON.stringify({
        loved: {
          27: "2026-11-09T09:00:00.000Z",
          29: "2026-11-10T09:00:00.000Z",
          // Loved early on the read-ahead page: not out yet, so not listed.
          99: "2026-11-11T09:00:00.000Z",
        },
      })
    );
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    fireEvent.click(screen.getByText("Stories you loved (2)"));
    const links = screen
      .getAllByRole("link")
      .filter((a) => /Return Address|A Different Kind of Help/.test(a.textContent ?? ""));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["A Different Kind of Help", "/comics?ep=29"],
      ["Return Address", "/comics?ep=27"],
    ]);
    expect(screen.queryByRole("link", { name: /Episode 99/ })).toBeNull();
  });

  it("explains the loved list before there's anything in it", () => {
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    expect(screen.getByText("Stories read: 0")).toBeTruthy();
    expect(screen.getByText("Time reading: under 1 min")).toBeTruthy();
    fireEvent.click(screen.getByText("Stories you loved (0)"));
    expect(screen.getByText(/under a story to keep it here/)).toBeTruthy();
  });

  it("words reading time in minutes and hours", () => {
    expect([0, 59, 60, 1500, 3600, 4800].map(readingTimeLabel)).toEqual([
      "under 1 min",
      "under 1 min",
      "1 min",
      "25 min",
      "1 h",
      "1 h 20 min",
    ]);
  });

  it("points a book reader to the whole cast", () => {
    h.vip = true;
    reading({ 27: "2026-11-09T09:00:00.000Z" });
    render(<ReaderProgress cast={CAST} stories={STORIES} />);
    expect(screen.getByRole("link", { name: "Meet the whole cast" })).toHaveAttribute(
      "href",
      "/meet-the-cast"
    );
    expect(screen.getByText("2 more to meet in the weekly stories.")).toBeTruthy();
  });
});

describe("the streak at the end of a story", () => {
  it("updates the moment the story counts as read", () => {
    render(<StreakNote />);
    expect(screen.getByText("Read a story each week to build a streak.")).toBeTruthy();
    reading({ 27: "2026-11-11T11:00:00.000Z" });
    act(() => {
      window.dispatchEvent(new CustomEvent(READ_EVENT));
    });
    expect(screen.getByText("Weeks in a row: 1. A new story comes out every Sunday.")).toBeTruthy();
  });
});
