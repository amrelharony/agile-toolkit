// @vitest-environment node
/**
 * The owner's Insights routes: everything the tab works from, the print
 * shortlist mark, and a clear answer before migration 0036 has run, kept apart
 * from an ordinary outage. Who may call them is test/comics/owner-routes'
 * business.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Err = { code?: string; message: string } | null;

const h = vi.hoisted(() => ({
  stories: [] as Record<string, unknown>[],
  storiesError: null as Err,
  totals: [] as Record<string, unknown>[],
  totalsError: null as Err,
  weeks: [] as Record<string, unknown>[],
  taps: [] as Record<string, unknown>[],
  updated: null as Record<string, unknown> | null,
  updateError: null as Err,
  updates: [] as unknown[],
  filters: [] as unknown[][],
  rpcs: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => ({ id: "owner" }),
}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => {
    const chain = (resolve: () => { data: unknown; error: Err }, table: string) => {
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (...args: unknown[]) => {
          h.filters.push([table, ...args]);
          return c;
        },
        order: () => c,
        update: (values: unknown) => {
          h.updates.push(values);
          return c;
        },
        // Awaited directly (an RPC) or through .returns() (a table).
        range: () => ({
          returns: async () => resolve(),
          then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) =>
            Promise.resolve(resolve()).then(ok, no),
        }),
        maybeSingle: async () => ({ data: h.updated, error: h.updateError }),
        returns: async () => resolve(),
      };
      return c;
    };
    return {
      from: (table: string) =>
        chain(
          () =>
            table === "comic_stories"
              ? { data: h.stories, error: h.storiesError }
              : { data: h.taps, error: null },
          table
        ),
      rpc: (name: string) => {
        h.rpcs.push(name);
        return chain(
          () =>
            name === "comic_story_insight_totals"
              ? { data: h.totalsError ? null : h.totals, error: h.totalsError }
              : { data: h.weeks, error: null },
          name
        );
      },
    };
  },
}));

import { GET } from "@/app/api/comics/insights/route";
import { PUT } from "@/app/api/comics/stories/[ep]/shortlist/route";

const HOST = "agile.test";
const get = () =>
  GET(new NextRequest(`https://${HOST}/api/comics/insights`, { headers: { host: HOST } }), {
    params: {},
  } as never);
const put = (ep: string, body: unknown) =>
  PUT(
    new NextRequest(`https://${HOST}/api/comics/stories/${ep}/shortlist`, {
      method: "PUT",
      headers: { host: HOST, origin: `https://${HOST}` },
      body: JSON.stringify(body),
    }),
    { params: { ep } }
  );

beforeEach(() => {
  h.stories = [
    {
      ep: 27,
      title: "Return Address",
      themes: ["T12"],
      cast_names: ["HiPPO"],
      release_at: "2026-11-08T06:33:01.316Z",
      guess: { question: "Q?", options: ["A", "B", "C"], happened: 2 },
      print_shortlist: true,
    },
  ];
  h.storiesError = null;
  h.totals = [{ ep: 27, scope: "all", metric: "view", bucket: 0, count: "12" }];
  h.totalsError = null;
  h.weeks = [{ week: "2026-11-08", metric: "view", count: "12" }];
  h.taps = [{ ep: 27, kind: "seen", choice: 0, count: "3" }];
  h.updated = { ep: 27, print_shortlist: false };
  h.updateError = null;
  h.updates = [];
  h.filters = [];
  h.rpcs = [];
});

describe("GET /api/comics/insights", () => {
  it("answers the weekly stories, the database's sums and the taps, as numbers", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      stories: [
        {
          ep: 27,
          title: "Return Address",
          themes: ["T12"],
          castNames: ["HiPPO"],
          releaseAt: "2026-11-08T06:33:01.316Z",
          happened: 2,
          shortlisted: true,
        },
      ],
      totals: [{ ep: 27, scope: "all", metric: "view", bucket: 0, count: 12 }],
      weeks: [{ week: "2026-11-08", metric: "view", count: 12 }],
      taps: [{ ep: 27, kind: "seen", choice: 0, count: 3 }],
    });
    // Weekly stories only, and the sums from the database, never raw weekly rows.
    expect(h.filters).toContainEqual(["comic_stories", "collection", "weekly"]);
    expect(h.rpcs).toEqual(["comic_story_insight_totals", "comic_story_weekly_totals"]);
  });

  it("says the migration is missing only when that's what the database says", async () => {
    h.storiesError = { code: "42703", message: "column print_shortlist does not exist" };
    expect(await (await get()).json()).toEqual({ error: "insights_unavailable" });
    h.storiesError = null;
    h.totalsError = { code: "PGRST202", message: "function not found" };
    expect(await (await get()).json()).toEqual({ error: "insights_unavailable" });
    h.totalsError = { code: "57014", message: "statement timeout" };
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "service_unavailable" });
  });
});

describe("PUT /api/comics/stories/N/shortlist", () => {
  it("sets the mark on a weekly story and answers it", async () => {
    const res = await put("27", { on: false });
    expect(await res.json()).toEqual({ ep: 27, shortlisted: false });
    expect(h.updates).toEqual([{ print_shortlist: false }]);
    expect(h.filters).toContainEqual(["comic_stories", "collection", "weekly"]);
  });

  it("refuses a bad number or body, and a story that isn't there", async () => {
    expect((await put("abc", { on: true })).status).toBe(400);
    expect((await put("27", { on: "yes" })).status).toBe(400);
    h.updated = null;
    expect((await put("27", { on: true })).status).toBe(404);
    h.updateError = { code: "42703", message: "no column" };
    expect(await (await put("27", { on: true })).json()).toEqual({
      error: "insights_unavailable",
    });
  });
});
