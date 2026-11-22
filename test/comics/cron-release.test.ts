// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({
  revalidated: [] as { path: string; type?: string }[],
  recent: [] as StorySummary[],
  readThrows: false,
  limits: [] as (number | undefined)[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => h.revalidated.push({ path, type }),
}));
vi.mock("@/lib/comics/store", () => ({
  listReleasedWeekly: async (limit?: number) => {
    h.limits.push(limit);
    if (h.readThrows) throw new Error("comics: read failed: down");
    return h.recent;
  },
}));

import { GET } from "@/app/api/cron/comics-release/route";
import { EPISODE_PAGES, revalidateComics } from "@/lib/comics/revalidate";
import { nextSundaySlot } from "@/lib/comics/queue";

const SECRET = "a-cron-secret-of-32-characters!!";
const NOW = Date.parse("2026-11-15T07:20:00Z");
const HOUR = 60 * 60 * 1000;

function summary(ep: number, releasedAgoMs: number): StorySummary {
  return {
    ep,
    title: `Story ${ep}`,
    lesson: "",
    castNames: [],
    themes: [],
    cover: null,
    releaseAt: new Date(NOW - releasedAgoMs).toISOString(),
    updatedAt: new Date(NOW - releasedAgoMs).toISOString(),
  };
}

function call(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return GET(new Request("https://agile.example/api/cron/comics-release", { headers }));
}

const paths = () => h.revalidated.map((r) => r.path);

beforeEach(() => {
  h.revalidated = [];
  h.recent = [];
  h.readThrows = false;
  h.limits = [];
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/comics-release", () => {
  it("refuses to run without a CRON_SECRET, so nobody can rebuild every page at will", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer `);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "cron_unconfigured" });
    expect(h.limits).toEqual([]);
  });

  it("treats a secret shorter than Vercel's advice as unset", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(503);
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer a-cron-secret-of-32-characters!?"],
    ["the secret without Bearer", SECRET],
    ["a longer header", `Bearer ${SECRET}x`],
  ])("answers 401 to %s and reads nothing", async (_what, header) => {
    const res = await call(header);
    expect(res.status).toBe(401);
    expect(h.limits).toEqual([]);
    expect(h.revalidated).toEqual([]);
  });

  it("refreshes the comic pages for a story out within the lookback", async () => {
    h.recent = [summary(31, 20 * 60 * 1000), summary(30, 7 * 24 * HOUR)];
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ refreshed: [31] });
    expect(paths()).toEqual(
      expect.arrayContaining(["/", "/comics", "/comics/feed.xml", "/comics/sitemap.xml"])
    );
    expect(paths()).toContain("/comics/ep/31");
    expect(paths()).not.toContain("/comics/ep/30");
    expect(h.revalidated).toContainEqual({ path: EPISODE_PAGES, type: "page" });
  });

  it("catches a story from just inside 26 hours, so a late run misses nothing", async () => {
    h.recent = [summary(40, 26 * HOUR - 60_000), summary(39, 26 * HOUR + 60_000)];
    expect(await (await call(`Bearer ${SECRET}`)).json()).toEqual({ refreshed: [40] });
  });

  it("refreshes every story of a launch day", async () => {
    h.recent = [27, 28, 29, 30].map((ep) => summary(ep, 5 * 60 * 1000));
    expect(await (await call(`Bearer ${SECRET}`)).json()).toEqual({
      refreshed: [27, 28, 29, 30],
    });
  });

  it("leaves every page alone on a day with no release", async () => {
    h.recent = [summary(31, 3 * 24 * HOUR)];
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ refreshed: [] });
    expect(h.revalidated).toEqual([]);
  });

  it("says the read failed, and refreshes nothing", async () => {
    h.readThrows = true;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "read_failed" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("revalidateComics", () => {
  it("refreshes home, the lists and every episode page, plus the saved ones by name", () => {
    revalidateComics([33]);
    expect(paths()).toEqual(
      expect.arrayContaining([
        "/",
        "/comics",
        "/comics/flashcards",
        "/comics/feed.xml",
        "/comics/sitemap.xml",
        "/comics/ep/33",
      ])
    );
    expect(h.revalidated).toContainEqual({ path: EPISODE_PAGES, type: "page" });
  });

  it("names the episode route as Next tags it: the app path, route group included", () => {
    const file = path.join(process.cwd(), "src", "app", ...EPISODE_PAGES.split("/"), "page.tsx");
    expect(existsSync(file), file).toBe(true);
  });
});

describe("the cron schedule", () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
    crons?: { path: string; schedule: string }[];
  };
  const job = config.crons?.find((c) => c.path === "/api/cron/comics-release");

  it("is in vercel.json, daily, as Hobby requires", () => {
    expect(job).toBeDefined();
    const [minute, hour, ...rest] = job!.schedule.split(" ");
    expect(rest).toEqual(["*", "*", "*"]);
    expect(Number(minute)).toBe(0);
    expect(Number.isInteger(Number(hour))).toBe(true);
  });

  it("fires in the hour stories come out", () => {
    const hour = Number(job!.schedule.split(" ")[1]);
    expect(nextSundaySlot(new Date("2026-11-10T00:00:00Z")).getUTCHours()).toBe(hour);
  });
});
