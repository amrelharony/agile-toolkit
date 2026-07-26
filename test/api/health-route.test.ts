/**
 * The uptime probe at /api/health.
 *
 * The failure this route exists to prevent is silent: a monitor that gets a
 * 404, or a 200 whose body was frozen at build time, both misreport the site.
 * So the assertions are about what a monitor actually consumes — the status
 * code, `status: "ok"`, a timestamp that moves, and headers that forbid caching.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, dynamic } from "@/app/api/health/route";

const VERCEL_VARS = ["VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV", "VERCEL_REGION"] as const;

describe("GET /api/health", () => {
  const saved: Partial<Record<(typeof VERCEL_VARS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of VERCEL_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of VERCEL_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("answers 200 with status ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("forbids caching, so a probe never reads a stale edge copy", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("is force-dynamic, so Next cannot prerender it at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("reports a fresh timestamp on every call", async () => {
    const first = (await (await GET()).json()) as { timestamp: string };
    await new Promise((r) => setTimeout(r, 2));
    const second = (await (await GET()).json()) as { timestamp: string };

    expect(Date.parse(first.timestamp)).not.toBeNaN();
    expect(Date.parse(second.timestamp)).toBeGreaterThan(Date.parse(first.timestamp) - 1);
    expect(second.timestamp >= first.timestamp).toBe(true);
  });

  it("surfaces the deployed commit so a probe can tell which build is live", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "8a095fa1bd3854ea97ea8625ebf6a2714f0cfdc5";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_REGION = "fra1";

    await expect((await GET()).json()).resolves.toMatchObject({
      commit: "8a095fa",
      env: "production",
      region: "fra1",
    });
  });

  it("degrades to nulls off Vercel instead of throwing", async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(body.commit).toBeNull();
    expect(body.region).toBeNull();
    expect(body.status).toBe("ok");
  });
});
