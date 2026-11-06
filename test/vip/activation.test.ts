// @vitest-environment node
/**
 * Opening the printed link counts one anonymous activation, from the route
 * handler and for a valid key only.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const KEY = "testkey12345";

const h = vi.hoisted(() => ({
  result: { error: null as { message: string } | null } as unknown,
  rpc: vi.fn(),
  hasClient: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => (h.hasClient ? { rpc: h.rpc } : null),
}));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});

import { GET } from "@/app/vip/[key]/route";
import { summariseVisits } from "@/lib/comics/entries-summary";
import { parseVisit } from "@/lib/comics/visits";

function open(key: string, cookie?: string) {
  return GET(
    new NextRequest(`https://agile.test/vip/${key}`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: { key } }
  );
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockImplementation(() => ({ abortSignal: async () => h.result }));
  h.result = { error: null };
  h.hasClient = true;
});

describe("/vip/<key> counting", () => {
  it("counts a valid key once, with no identifying value", async () => {
    await open(KEY);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("comic_entry_hit", {
      p_entry: "vip",
      p_ep: 0,
      p_building: 0,
    });
  });

  it.each(["not-the-key", "", "testkey12346", "x".repeat(200)])(
    "doesn't count the bad key %j",
    async (key) => {
      const res = await open(key);
      expect(h.rpc).not.toHaveBeenCalled();
      expect(res.cookies.get("agile-toolkit:vip")).toBeUndefined();
    }
  );

  it("doesn't count a bad key from a device that's already unlocked", async () => {
    await open("not-the-key", `agile-toolkit:vip=${KEY}`);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("doesn't count the same device scanning again", async () => {
    await open(KEY, `agile-toolkit:vip=${KEY}`);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("counts when the device's old cookie isn't valid", async () => {
    await open(KEY, "agile-toolkit:vip=forged");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("still unlocks when the count fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.result = { error: { message: "check constraint" } };
    const failed = await open(KEY);
    expect(failed.cookies.get("agile-toolkit:vip")?.value).toBe(KEY);

    h.rpc.mockImplementation(() => {
      throw new Error("network");
    });
    const thrown = await open(KEY);
    expect(thrown.cookies.get("agile-toolkit:vip")?.value).toBe(KEY);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("still unlocks with no service-role key configured", async () => {
    h.hasClient = false;
    const res = await open(KEY);
    expect(res.cookies.get("agile-toolkit:vip")?.value).toBe(KEY);
  });
});

describe("where the count can and can't come from", () => {
  it("the public beacon can't send a VIP entry", () => {
    expect(parseVisit({ entry: "vip" })).toBeNull();
    expect(parseVisit({ path: "/comics", src: "vip", ep: 0 })).toBeNull();
    expect(parseVisit({ path: "/vip", src: "none", ep: 0 })).toBeNull();
    const route = readFileSync(path.join(process.cwd(), "src/app/api/comics/hit/route.ts"), "utf8");
    expect(route).not.toContain("comic_entry_hit");
  });

  it("the middleware has no part in it", () => {
    const src = readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(src).not.toContain("comic_entry_hit");
  });

  it("the migration only widens the check, and is safe to run twice", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0032_comic_entry_vip.sql"),
      "utf8"
    );
    expect(sql).toContain("drop constraint if exists comic_entry_counts_entry_check");
    expect(sql).toMatch(/check \(entry in \('poster', 'direct', 'vip'\)\)/);
    expect(sql).not.toMatch(/grant/i);
  });
});

describe("the portal's Entries view", () => {
  it("adds VIP activations to the month's total, apart from the printed pieces", () => {
    const [november, october] = summariseVisits(
      [
        { month: "2026-11-01", path: "/comics", src: "none", ep: 0, count: 7 },
        { month: "2026-11-01", path: "/comics", src: "poster", ep: 12, count: "2" },
      ],
      [
        { day: "2026-11-02", count: 3 },
        { day: "2026-11-05", count: 1 },
        { day: "2026-10-30", count: 4 },
      ]
    );
    expect(november.vip).toBe(4);
    expect(november.total).toBe(13);
    // A VIP activation is neither a printed piece nor an episode.
    expect(november.bySource.none).toBe(7);
    expect(november.bySource.book).toBe(0);
    expect(november.byEpisode).toEqual([{ ep: 12, poster: 2, kudos: 0 }]);
    expect(october).toMatchObject({ month: "2026-10-01", vip: 4, total: 4, byEpisode: [] });
  });
});
