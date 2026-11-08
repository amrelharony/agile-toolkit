// @vitest-environment node
/**
 * The owner's Insights routes: everything the tab works from, the print
 * shortlist mark, and a clear answer before migration 0036 has run. Who may
 * call them is test/comics/owner-routes' business.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  stories: [] as Record<string, unknown>[],
  storiesError: null as { code?: string; message: string } | null,
  stats: [] as Record<string, unknown>[],
  statsError: null as { message: string } | null,
  taps: [] as Record<string, unknown>[],
  updated: null as Record<string, unknown> | null,
  updateError: null as { code?: string; message: string } | null,
  updates: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => ({ id: "owner" }),
}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        update: (values: unknown) => {
          h.updates.push(values);
          return chain;
        },
        range: () => chain,
        maybeSingle: async () => ({ data: h.updated, error: h.updateError }),
        returns: async () => {
          if (table === "comic_stories") return { data: h.stories, error: h.storiesError };
          if (table === "comic_story_stats") return { data: h.stats, error: h.statsError };
          return { data: h.taps, error: null };
        },
      };
      return chain;
    },
  }),
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
  h.stats = [{ ep: 27, week: "2026-11-08", metric: "view", bucket: 0, count: "12" }];
  h.statsError = null;
  h.taps = [{ ep: 27, kind: "seen", choice: 0, count: "3" }];
  h.updated = { ep: 27, print_shortlist: false };
  h.updateError = null;
  h.updates = [];
});

describe("GET /api/comics/insights", () => {
  it("answers the stories, weekly totals and taps, as numbers", async () => {
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
      stats: [{ ep: 27, week: "2026-11-08", metric: "view", bucket: 0, count: 12 }],
      taps: [{ ep: 27, kind: "seen", choice: 0, count: 3 }],
    });
  });

  it("says the migration is missing before 0036 has run", async () => {
    h.storiesError = { code: "42703", message: "column print_shortlist does not exist" };
    expect(await (await get()).json()).toEqual({ error: "insights_unavailable" });
    h.storiesError = null;
    h.statsError = { message: "relation does not exist" };
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "insights_unavailable" });
  });
});

describe("PUT /api/comics/stories/N/shortlist", () => {
  it("sets the mark and answers it", async () => {
    const res = await put("27", { on: false });
    expect(await res.json()).toEqual({ ep: 27, shortlisted: false });
    expect(h.updates).toEqual([{ print_shortlist: false }]);
  });

  it("refuses a bad number or body, and a story that isn't there", async () => {
    expect((await put("abc", { on: true })).status).toBe(400);
    expect((await put("27", { on: "yes" })).status).toBe(400);
    h.updated = null;
    expect((await put("27", { on: true })).status).toBe(404);
    h.updateError = { code: "42703", message: "no column" };
    expect(await (await put("27", { on: true })).json()).toEqual({ error: "insights_unavailable" });
  });
});
