// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ error: null as { message: string } | null })),
  hasClient: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => (h.hasClient ? { rpc: h.rpc } : null),
}));

import { POST } from "@/app/api/comics/hit/route";
import { parseHit } from "@/lib/comics/hit";

const HOST = "agile.test";
let ip = 0;

function hit(body: unknown, headers: Record<string, string> = {}) {
  // A fresh address per request, so the rate limit stays out of these tests.
  ip += 1;
  return POST(
    new NextRequest(`https://${HOST}/api/comics/hit`, {
      method: "POST",
      headers: {
        host: HOST,
        origin: `https://${HOST}`,
        "x-real-ip": `10.0.0.${ip}`,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  h.rpc.mockClear();
  h.rpc.mockResolvedValue({ error: null });
  h.hasClient = true;
});

describe("POST /api/comics/hit", () => {
  it("adds a poster scan to the daily total", async () => {
    const res = await hit({ entry: "poster", ep: 12, b: 3 });
    expect(res.status).toBe(204);
    expect(h.rpc).toHaveBeenCalledWith("comic_entry_hit", {
      p_entry: "poster",
      p_ep: 12,
      p_building: 3,
    });
  });

  it("counts a direct arrival with no episode or building", async () => {
    await hit({ entry: "direct" });
    expect(h.rpc).toHaveBeenCalledWith("comic_entry_hit", {
      p_entry: "direct",
      p_ep: 0,
      p_building: 0,
    });
  });

  it.each([
    ["an unknown entry", { entry: "vip" }],
    ["a poster with no building", { entry: "poster", ep: 12 }],
    ["a poster with no episode", { entry: "poster", b: 1 }],
    ["a weekly episode", { entry: "poster", ep: 27, b: 1 }],
    ["building zero", { entry: "poster", ep: 12, b: 0 }],
    ["building eleven", { entry: "poster", ep: 12, b: 11 }],
    ["a decimal", { entry: "poster", ep: 1.5, b: 1 }],
    ["a numeric string", { entry: "poster", ep: "12", b: 1 }],
    ["direct with an episode", { entry: "direct", ep: 12 }],
    ["an array", [1, 2]],
    ["null", null],
  ])("refuses %s", async (_label, body) => {
    const res = await hit(body);
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses text that isn't JSON", async () => {
    expect((await hit("nope")).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    const res = await hit({ entry: "direct", padding: "x".repeat(1000) });
    expect(res.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses another site, and a request with no Origin", async () => {
    expect((await hit({ entry: "direct" }, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new NextRequest(`https://${HOST}/api/comics/hit`, {
      method: "POST",
      headers: { host: HOST, "x-real-ip": "10.1.0.1" },
      body: JSON.stringify({ entry: "direct" }),
    });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("is quiet when no database is configured", async () => {
    h.hasClient = false;
    const res = await hit({ entry: "direct" });
    expect(res.status).toBe(204);
  });

  it("is quiet when the database fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ error: { message: "down" } });
    expect((await hit({ entry: "direct" })).status).toBe(204);
    warn.mockRestore();
  });

  it("stores no identifiers and sets no cookie", async () => {
    const res = await hit(
      { entry: "poster", ep: 12, b: 3, name: "Sara", ip: "1.2.3.4" },
      { "user-agent": "Mozilla/5.0 Secret", "x-forwarded-for": "9.9.9.9", cookie: "a=b" }
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    const [, args] = h.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(Object.keys(args).sort()).toEqual(["p_building", "p_entry", "p_ep"]);
    const sent = JSON.stringify(args);
    for (const secret of ["Sara", "1.2.3.4", "9.9.9.9", "Mozilla"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("stops one address hammering the counter, quietly", async () => {
    const send = () =>
      POST(
        new NextRequest(`https://${HOST}/api/comics/hit`, {
          method: "POST",
          headers: { host: HOST, origin: `https://${HOST}`, "x-real-ip": "10.2.0.1" },
          body: JSON.stringify({ entry: "direct" }),
        })
      );
    for (let i = 0; i < 30; i++) await send();
    expect(h.rpc).toHaveBeenCalledTimes(30);
    expect((await send()).status).toBe(204);
    expect(h.rpc).toHaveBeenCalledTimes(30);
  });
});

describe("parseHit", () => {
  it("returns only the allowlisted fields", () => {
    expect(parseHit({ entry: "poster", ep: 1, b: 10, extra: "x" })).toEqual({
      entry: "poster",
      ep: 1,
      b: 10,
    });
  });
});
