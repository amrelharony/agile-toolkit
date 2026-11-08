// @vitest-environment node
/**
 * /api/comics/taps: the public route behind the guess and "Seen this at work?".
 * Only a released weekly story counts (or one in the VIP window, for a device
 * with the book's key), only within its own choices, and nothing about the
 * reader reaches the database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DAY = 86_400_000;
const GUESS = { question: "What happens next?", options: ["A", "B", "C"], happened: 1 };

const h = vi.hoisted(() => ({
  story: null as Record<string, unknown> | null,
  storyError: null as { message: string } | null,
  rows: [] as { choice: number; count: number }[],
  rpc: vi.fn(),
  vip: false,
  filters: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vip/access", () => ({ hasVipAccess: async () => h.vip }));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => ({
    rpc: h.rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          h.filters.push([table, ...args]);
          return chain;
        },
        maybeSingle: async () => ({ data: h.story, error: h.storyError }),
        returns: async () => ({ data: h.rows, error: null }),
      };
      return chain;
    },
  }),
}));

import { GET, POST } from "@/app/api/comics/taps/route";

const HOST = "agile.test";
let ip = 0;

function headers(extra: Record<string, string> = {}) {
  // A fresh address per request, so the rate limit stays out of the other tests.
  ip += 1;
  return {
    host: HOST,
    origin: `https://${HOST}`,
    "x-real-ip": `10.1.${Math.floor(ip / 250)}.${ip % 250}`,
    ...extra,
  };
}

const post = (body: unknown, extra: Record<string, string> = {}) =>
  POST(
    new NextRequest(`https://${HOST}/api/comics/taps`, {
      method: "POST",
      headers: headers(extra),
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const get = (query: string) =>
  GET(new NextRequest(`https://${HOST}/api/comics/taps?${query}`, { headers: headers() }));

const released = (over: Record<string, unknown> = {}) => ({
  guess: GUESS,
  release_at: new Date(Date.now() - DAY).toISOString(),
  collection: "weekly",
  ...over,
});

beforeEach(() => {
  h.story = released();
  h.storyError = null;
  h.rows = [];
  h.vip = false;
  h.filters = [];
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({
    data: [
      { tap_choice: 2, tap_count: 1 },
      { tap_choice: 0, tap_count: "4" },
    ],
    error: null,
  });
});

describe("POST /api/comics/taps", () => {
  it("counts a guess on a released story and answers with the totals", async () => {
    const res = await post({ ep: 30, kind: "guess", choice: 2 });
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("comic_story_tap", {
      p_ep: 30,
      p_kind: "guess",
      p_choice: 2,
    });
    expect(await res.json()).toEqual({ counts: [4, 0, 1], shares: null });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("counts Seen this at work on any released weekly story, guess or not", async () => {
    h.story = released({ guess: null });
    h.rpc.mockResolvedValue({ data: [{ tap_choice: 0, tap_count: 20 }], error: null });
    const res = await post({ ep: 30, kind: "seen", choice: 0 });
    expect(await res.json()).toEqual({ counts: [20, 0], shares: [100, 0] });
  });

  it("refuses a choice the story doesn't have, and a guess on a story without one", async () => {
    expect((await post({ ep: 30, kind: "guess", choice: 3 })).status).toBe(400);
    expect((await post({ ep: 30, kind: "seen", choice: 2 })).status).toBe(400);
    h.story = released({ guess: null });
    expect((await post({ ep: 30, kind: "guess", choice: 0 })).status).toBe(404);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("counts nothing for a draft, a book episode or a story that isn't out", async () => {
    h.story = released({ release_at: null });
    expect((await post({ ep: 30, kind: "seen", choice: 0 })).status).toBe(404);
    h.story = released({ collection: "book" });
    expect((await post({ ep: 30, kind: "seen", choice: 0 })).status).toBe(404);
    h.story = released({ release_at: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await post({ ep: 30, kind: "seen", choice: 0 })).status).toBe(404);
    h.story = null;
    expect((await post({ ep: 30, kind: "seen", choice: 0 })).status).toBe(404);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("counts a VIP reading ahead, inside the four-week window only", async () => {
    h.vip = true;
    h.story = released({ release_at: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await post({ ep: 30, kind: "guess", choice: 1 })).status).toBe(200);
    h.story = released({ release_at: new Date(Date.now() + 40 * DAY).toISOString() });
    expect((await post({ ep: 30, kind: "guess", choice: 1 })).status).toBe(404);
  });

  it.each([
    ["no number", { kind: "seen", choice: 0 }],
    ["a book number", { ep: 12, kind: "seen", choice: 0 }],
    ["another kind", { ep: 30, kind: "vote", choice: 0 }],
    ["a choice past four", { ep: 30, kind: "guess", choice: 4 }],
  ])("refuses %s", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("refuses another site, a broken body and an oversized one", async () => {
    expect(
      (await post({ ep: 30, kind: "seen", choice: 0 }, { origin: "https://evil.test" })).status
    ).toBe(403);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ ep: 30, pad: "x".repeat(400) }))).status).toBe(413);
  });

  it("slows one address down after a minute's worth of taps", async () => {
    const same = { "x-real-ip": "10.9.9.9" };
    const answers: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      answers.push((await post({ ep: 30, kind: "seen", choice: 0 }, same)).status);
    }
    expect(answers.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(answers[60]).toBe(429);
  });

  it("says when the count couldn't be kept", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post({ ep: 30, kind: "seen", choice: 0 })).status).toBe(503);
  });
});

describe("GET /api/comics/taps", () => {
  it("reads the totals back, privately cached", async () => {
    h.rows = [{ choice: 1, count: 25 }];
    const res = await get("ep=30&kind=guess");
    expect(await res.json()).toEqual({ counts: [0, 25, 0], shares: [0, 100, 0] });
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(h.filters).toContainEqual(["comic_story_taps", "kind", "guess"]);
  });

  it("refuses a story that isn't out, and a bad query", async () => {
    h.story = released({ release_at: new Date(Date.now() + DAY).toISOString() });
    expect((await get("ep=30&kind=seen")).status).toBe(404);
    expect((await get("ep=x&kind=seen")).status).toBe(400);
    expect((await get("ep=30&kind=vote")).status).toBe(400);
  });
});
