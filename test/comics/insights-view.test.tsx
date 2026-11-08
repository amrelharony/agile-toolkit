/**
 * Settings › Comics › Insights: the summary, the sortable story table, the
 * print shortlist with its star toggles and CSV, and a plain message before
 * migration 0036.
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
const stat = (ep: number, metric: string, count: number, bucket = 0) => ({
  ep,
  week: "2026-11-08",
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
  stats: [
    stat(27, "visitor", 40),
    stat(27, "reader", 25),
    stat(27, "love", 3),
    stat(28, "visitor", 35),
    stat(28, "reader", 30),
    stat(28, "love", 12),
    stat(28, "time", 9, 3),
  ],
  taps: [],
};

async function open() {
  await act(async () => {
    render(<InsightsView enabled now={NOW} />);
  });
}

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
    const table = screen.getByRole("table", { name: /Stories, sorted by Print score/ });
    const titles = () =>
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent);
    expect(titles()).toEqual(["The Practice Desk", "Return Address"]);
    fireEvent.click(within(table).getByRole("button", { name: "Ep" }));
    expect(titles()).toEqual(["Return Address", "The Practice Desk"]);
    expect(within(table).getByRole("columnheader", { name: /Ep/ }).getAttribute("aria-sort")).toBe(
      "ascending"
    );
  });

  it("stars a story onto the shortlist and saves it", async () => {
    await open();
    expect(screen.getByText(/1 shortlisted: 1 of 26 for a volume/)).toBeTruthy();
    const star = screen.getByRole("button", { name: "Shortlist episode 28" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await act(async () => fireEvent.click(star));
    expect(h.setShortlist).toHaveBeenCalledWith(28, true);
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/2 shortlisted: 2 of 26 for a volume/)).toBeTruthy();
  });

  it("takes the star back if the save fails", async () => {
    h.setShortlist.mockRejectedValue(new PortalError("Couldn't save.", 503, "service_unavailable"));
    await open();
    const star = screen.getByRole("button", { name: "Shortlist episode 28" });
    await act(async () => fireEvent.click(star));
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save.");
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
