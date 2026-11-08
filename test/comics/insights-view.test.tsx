/**
 * Settings › Comics › Insights: the summary, the sortable story table with its
 * pinned story names, the print shortlist with its star toggles and CSV, the
 * trend as a table, and a plain message before migration 0036.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  insights: vi.fn(),
  setShortlist: vi.fn(),
  csv: vi.fn(),
}));

vi.mock("@/app/settings/comics/portal-api", async (original) => ({
  ...(await original<typeof import("@/app/settings/comics/portal-api")>()),
  portalApi: { insights: h.insights, setShortlist: h.setShortlist },
}));
vi.mock("@/lib/utils/export", () => ({ exportToCSV: h.csv }));
// The chart itself is Recharts' business; its figures are also in a table.
vi.mock("@/components/charts/lazy-chart", () => ({ Chart: () => null }));

import { InsightsView } from "@/app/settings/comics/insights-view";
import { PortalError } from "@/app/settings/comics/portal-api";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const RELEASED = "2026-11-08T07:00:00.000Z";

const story = (ep: number, title: string, over = {}) => ({
  ep,
  title,
  themes: ["T01"],
  castNames: ["Amr"],
  releaseAt: RELEASED,
  happened: 0,
  shortlisted: false,
  ...over,
});
const total = (ep: number, metric: string, count: number, bucket = 0) => ({
  ep,
  scope: "all",
  metric,
  bucket,
  count,
});

const DATA = {
  stories: [
    story(27, "Return Address", { shortlisted: true }),
    story(28, "The Practice Desk", { themes: ["T08"] }),
    story(40, "Not out yet", { releaseAt: "2027-02-14T07:00:00.000Z" }),
  ],
  totals: [
    total(27, "visitor", 40),
    total(27, "reader", 25),
    total(27, "love", 3),
    total(28, "visitor", 35),
    total(28, "reader", 30),
    total(28, "love", 12),
    total(28, "time", 9, 3),
  ],
  weeks: [
    { week: "2026-11-08", metric: "view", count: 70 },
    { week: "2026-11-15", metric: "view", count: 20 },
    { week: "2026-11-15", metric: "love", count: 15 },
  ],
  taps: [],
};

async function open() {
  await act(async () => {
    render(<InsightsView enabled now={NOW} />);
  });
}

const storyTable = () => screen.getByRole("table", { name: /^Stories, sorted by/ });

beforeEach(() => {
  h.insights.mockReset();
  h.insights.mockResolvedValue(structuredClone(DATA));
  h.setShortlist.mockReset();
  h.setShortlist.mockResolvedValue({ ep: 28, shortlisted: true });
  h.csv.mockReset();
});

describe("Insights", () => {
  it("sums the stories that are out", async () => {
    await open();
    const summary = within(screen.getByRole("region", { name: "Summary" }));
    expect(summary.getByText("Stories out").nextSibling?.textContent).toBe("2");
    expect(summary.getByText("Readers").nextSibling?.textContent).toBe("55");
    expect(summary.getByText("Loves").nextSibling?.textContent).toBe("15");
    expect(screen.queryByText("Not out yet")).toBeNull();
  });

  it("ranks stories by print score and sorts by any column", async () => {
    await open();
    const table = storyTable();
    expect(table.querySelector("caption")?.textContent).toMatch(/Print score, highest first/);
    const titles = () =>
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.querySelector("a")?.firstChild?.textContent);
    expect(titles()).toEqual(["The Practice Desk", "Return Address"]);
    fireEvent.click(within(table).getByRole("button", { name: "Ep" }));
    expect(titles()).toEqual(["Return Address", "The Practice Desk"]);
    expect(within(table).getByRole("columnheader", { name: /^Ep/ }).getAttribute("aria-sort")).toBe(
      "ascending"
    );
  });

  it("keeps each story's name pinned with its star, and says the link opens a new tab", async () => {
    await open();
    const [first] = within(storyTable()).getAllByRole("rowheader");
    expect(first.className).toMatch(/sticky left-0/);
    expect(within(first).getByRole("button", { name: "Shortlist episode 28" })).toBeTruthy();
    expect(within(first).getByRole("link").textContent).toBe(
      "The Practice Desk (opens in a new tab)"
    );
  });

  it("stars a story onto the shortlist and saves it, keeping the star in reach", async () => {
    await open();
    expect(screen.getByText(/1 shortlisted: 1 of 26 for a volume/)).toBeTruthy();
    const star = screen.getByRole("button", { name: "Shortlist episode 28" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await act(async () => fireEvent.click(star));
    expect(h.setShortlist).toHaveBeenCalledWith(28, true);
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect((star as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/2 shortlisted: 2 of 26 for a volume/)).toBeTruthy();
  });

  it("takes the star back if the save fails, saying so by the table", async () => {
    h.setShortlist.mockRejectedValue(new PortalError("Couldn't save.", 503, "service_unavailable"));
    await open();
    const star = screen.getByRole("button", { name: "Shortlist episode 28" });
    await act(async () => fireEvent.click(star));
    expect(star.getAttribute("aria-pressed")).toBe("false");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Couldn't save.");
    // Next to the table, not at the top of the view.
    expect(alert.closest("section")?.getAttribute("aria-labelledby")).toBe("stories-heading");
  });

  it("explains every column in words, not only in a tooltip", async () => {
    await open();
    fireEvent.click(screen.getByText("What the columns mean"));
    expect(screen.getByText("Readers out of the browsers that opened it.")).toBeTruthy();
    expect(screen.getByText(/0 to 100: where the story's loves per reader/)).toBeTruthy();
  });

  it("gives the trend as a table too", async () => {
    await open();
    fireEvent.click(screen.getByText("Week by week as a table"));
    const trend = screen.getByRole("table", { name: "Views, readers and loves, week by week" });
    expect(
      within(trend)
        .getAllByRole("row")
        .map((r) => r.textContent)
    ).toEqual(["Week ofViewsReadersLoves", "2026-11-087000", "2026-11-1520015"]);
  });

  it("names the theme and character tables", async () => {
    await open();
    expect(screen.getByRole("table", { name: /^Themes/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: /^Characters/ })).toBeTruthy();
  });

  it("downloads the table and the shortlist as CSV", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Download these (CSV)" }));
    fireEvent.click(screen.getByRole("button", { name: "Download shortlist (CSV)" }));
    expect(h.csv).toHaveBeenCalledTimes(2);
    const [headers, rows, name] = h.csv.mock.calls[1];
    expect(headers[0]).toBe("Episode");
    expect(rows.map((r: unknown[]) => r[0])).toEqual([27]);
    expect(name).toBe("comics-print-shortlist");
  });

  it("explains a missing migration and offers to try again", async () => {
    h.insights.mockRejectedValue(
      new PortalError(
        "Insights and the print shortlist need migration 0036, which hasn't been applied yet.",
        503,
        "insights_unavailable"
      )
    );
    await open();
    expect(screen.getByRole("alert").textContent).toMatch(/migration 0036/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
