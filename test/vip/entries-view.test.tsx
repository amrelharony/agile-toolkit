/** The portal's Entries view: a month's visits by printed piece and episode, VIP activations beside them. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { summariseVisits, type MonthSummary } from "@/lib/comics/entries-summary";

const h = vi.hoisted(() => ({
  entries: vi.fn<(months: number) => Promise<{ months: number; summary: MonthSummary[] }>>(),
}));

vi.mock("@/app/settings/comics/portal-api", () => ({
  errorMessage: () => "error",
  portalApi: { entries: h.entries },
}));

import { EntriesView } from "@/app/settings/comics/entries-view";

const NOVEMBER = summariseVisits(
  [
    { month: "2026-11-01", path: "/comics", src: "none", ep: 0, count: 7 },
    { month: "2026-11-01", path: "/comics", src: "poster", ep: 12, count: 2 },
    { month: "2026-11-01", path: "/comics", src: "kudos", ep: 12, count: 1 },
    { month: "2026-11-01", path: "/comics", src: "kudos", ep: 0, count: 4 },
    { month: "2026-11-01", path: "/kudos", src: "sign", ep: 0, count: 5 },
    { month: "2026-10-01", path: "/comics", src: "book", ep: 0, count: 9 },
  ],
  [{ day: "2026-11-02", count: 3 }]
);

beforeEach(() => {
  h.entries.mockReset();
  h.entries.mockResolvedValue({ months: 12, summary: NOVEMBER });
});
afterEach(cleanup);

describe("Entries view", () => {
  it("asks for a year of months and sums up the newest", async () => {
    render(<EntriesView enabled />);
    expect(
      await screen.findByText(
        "22 visits in November 2026: 2 from posters, 5 from kudos cards, and 3 VIP activations from the link in the book."
      )
    ).toBeInTheDocument();
    expect(h.entries).toHaveBeenCalledWith(12);
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveTextContent("November 2026");
  });

  it("lists the month's printed pieces, leaving out the ones nobody used", async () => {
    render(<EntriesView enabled />);
    const pieces = (await screen.findByRole("heading", { name: "By printed piece" }))
      .parentElement!;
    const rows = within(pieces)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "Posters2",
      "Kudos cards5",
      "The kudos wall sign5",
      "No printed piece (typed, shared or bookmarked)7",
    ]);
  });

  it("puts each episode's posters beside its kudos cards", async () => {
    render(<EntriesView enabled />);
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /Episode 12/ });
    expect(
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent)
    ).toEqual(["2", "1"]);
    // An open kudos card has no episode, so it has no row.
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("says so when a month has no poster or kudos card", async () => {
    h.entries.mockResolvedValue({ months: 12, summary: NOVEMBER.slice(1) });
    render(<EntriesView enabled />);
    expect(
      await screen.findByText("No poster or kudos card scanned this month.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when nothing has been counted", async () => {
    h.entries.mockResolvedValue({ months: 12, summary: [] });
    render(<EntriesView enabled />);
    expect(await screen.findByText("Nothing counted yet.")).toBeInTheDocument();
  });

  it("asks for nothing until the portal is open", () => {
    render(<EntriesView enabled={false} />);
    expect(h.entries).not.toHaveBeenCalled();
  });
});
