// @vitest-environment node
/**
 * /api/comics/stats: the public route behind the heart, views, finishes,
 * shares and reading time. Only a released weekly story counts (or one in the
 * VIP window, for a device with the book's key), only known events, and nothing
 * about the reader reaches the database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DAY = 86_400_000;

const h = vi.hoisted(() => ({
  story: null as Record<string, unknown> | null,
  storyError: null as { message: string } | null,
  rpc: vi.fn(),
  vip: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vip/access", () => ({ hasVipAccess: async () => h.vip }));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    rpc: h.rpc,
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.story, error: h.storyError }),
      };
      return chain;
    },
  }),
}));

import { POST } from "@/app/api/comics/stats/route";

const HOST = "agile.test";
let ip = 0;

function headers(extra: Record<string, string> = {}, sameIp = false) {
  if (!sameIp) ip += 1;
  return {
    host: HOST,
    origin: `https://${HOST}`,
    "x-real-ip": `10.2.${Math.floor(ip / 250)}.${ip % 250}`,
    ...extra,
  };
}

const post = (body: unknown, extra: Record<string, string> = {}, sameIp = false) =>
  POST(
    new NextRequest(`https://${HOST}/api/comics/stats`, {
      method: "POST",
      headers: headers(extra, sameIp),
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const released = (over: Record<string, unknown> = {}) => ({
  guess: null,
  release_at: new Date(Date.now() - DAY).toISOString(),
  collection: "weekly",
  ...over,
});

beforeEach(() => {
  h.story = released();
  h.storyError = null;
  h.vip = false;
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [{ loves: "7", readers: 12 }], error: null });
});

describe("POST /api/comics/stats", () => {
  it("counts events on a released story and answers its loves and readers", async () => {
    const res = await post({ ep: 30, events: ["love"] });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("comic_story_stat", { p_ep: 30, p_events: ["love"] });
    expect(await res.json()).toEqual({ loves: 7, readers: 12 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("passes beacons' views and time bands through as they are", async () => {
    await post({ ep: 31, events: ["view", "visitor", "time:3"] });
    expect(h.rpc).toHaveBeenCalledWith("comic_story_stat", {
      p_ep: 31,
      p_events: ["view", "visitor", "time:3"],
    });
  });

  it("refuses another site, a bad body and unknown events", async () => {
    expect((await post({ ep: 30, events: ["view"] }, { origin: "https://evil.test" })).status).toBe(
      403
    );
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ep: 30, events: ["like"] })).status).toBe(400);
    expect((await post({ ep: 12, events: ["view"] })).status).toBe(400);
    expect((await post({ ep: 30, events: ["view"], pad: "x".repeat(300) })).status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("only counts a story that's out, never one still in a VIP's window", async () => {
    h.story = null;
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(404);
    h.story = released({ release_at: null });
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(404);
    h.story = released({ collection: "book" });
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(404);
    // A story's number can still move in a reorder until it's out.
    h.vip = true;
    h.story = released({ release_at: new Date(Date.now() + 3 * DAY).toISOString() });
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(404);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("drops a connection's events over their hourly limit on one story, keeping the rest", async () => {
    ip += 1; // An address no other test has used.
    for (let i = 0; i < 10; i += 1) await post({ ep: 40, events: ["love"] }, {}, true);
    expect(h.rpc).toHaveBeenCalledTimes(10);
    // The eleventh love is dropped quietly: nothing left to count.
    expect((await post({ ep: 40, events: ["love"] }, {}, true)).status).toBe(204);
    expect(h.rpc).toHaveBeenCalledTimes(10);
    // The view still counts, the love doesn't.
    await post({ ep: 40, events: ["view", "love"] }, {}, true);
    expect(h.rpc).toHaveBeenLastCalledWith("comic_story_stat", { p_ep: 40, p_events: ["view"] });
    // Another story has its own limit.
    await post({ ep: 41, events: ["love"] }, {}, true);
    expect(h.rpc).toHaveBeenLastCalledWith("comic_story_stat", { p_ep: 41, p_events: ["love"] });
  });

  it("goes quiet over the rate limit, as a beacon expects", async () => {
    let last = 0;
    ip += 1; // An address no other test has used.
    for (let i = 0; i < 121; i += 1)
      last = (await post({ ep: 30, events: ["view"] }, {}, true)).status;
    expect(last).toBe(204);
    expect(h.rpc).toHaveBeenCalledTimes(120);
  });

  it("answers 503 when the database can't count", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(503);
    h.storyError = { message: "down" };
    expect((await post({ ep: 30, events: ["view"] })).status).toBe(503);
  });
});
