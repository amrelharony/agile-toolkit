// @vitest-environment node
/**
 * The pages' reads of a story's counts (migration 0036): summed in the
 * database, one story or all, and soft, so a page shows no counts rather than
 * failing before the migration runs or in an outage.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  data: null as unknown,
  error: null as { message: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    rpc: (...args: unknown[]) => {
      h.calls.push(args);
      return { abortSignal: async () => ({ data: h.data, error: h.error }) };
    },
  }),
}));

import { getStoryTotals, listStoryTotals } from "@/lib/comics/store";
import { NO_TOTALS } from "@/lib/comics/stats";

beforeEach(() => {
  h.calls = [];
  h.data = null;
  h.error = null;
});

describe("getStoryTotals", () => {
  it("asks the database for one story's sums", async () => {
    h.data = [
      { ep: 30, views: "12", visitors: 9, readers: 7, loves: 3, shares: 1, retros: 0, tools: 2 },
    ];
    expect(await getStoryTotals(30)).toEqual({
      views: 12,
      visitors: 9,
      readers: 7,
      loves: 3,
      shares: 1,
      retros: 0,
      tools: 2,
    });
    expect(h.calls).toEqual([["comic_story_totals", { p_ep: 30 }]]);
  });

  it("is no counts for a story nobody has read, or when the read fails", async () => {
    h.data = [];
    expect(await getStoryTotals(31)).toEqual(NO_TOTALS);
    h.error = { message: "function comic_story_totals(integer) does not exist" };
    expect(await getStoryTotals(31)).toEqual(NO_TOTALS);
  });
});

describe("listStoryTotals", () => {
  it("maps every story's sums by number", async () => {
    h.data = [
      { ep: 30, loves: 6 },
      { ep: "31", loves: "2" },
    ];
    const totals = await listStoryTotals();
    expect(totals.get(30)?.loves).toBe(6);
    expect(totals.get(31)?.loves).toBe(2);
    expect(h.calls).toEqual([["comic_story_totals"]]);
  });

  it("is empty when the read fails", async () => {
    h.error = { message: "down" };
    expect((await listStoryTotals()).size).toBe(0);
  });
});
