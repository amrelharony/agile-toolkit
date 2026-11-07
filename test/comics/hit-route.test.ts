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
        "x-real-ip": `10.0.${Math.floor(ip / 250)}.${ip % 250}`,
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
  it("adds a poster scan to this month's total", async () => {
    const res = await hit({ path: "/comics", src: "poster", ep: 12 });
    expect(res.status).toBe(204);
    expect(h.rpc).toHaveBeenCalledWith("comic_visit_hit", {
      p_path: "/comics",
      p_src: "poster",
      p_ep: 12,
    });
  });

  it.each([
    ["an episode kudos card", { path: "/comics", src: "kudos", ep: 7 }],
    ["an open kudos card", { path: "/comics", src: "kudos", ep: 0 }],
    ["the book", { path: "/comics", src: "book", ep: 0 }],
    ["a weekly story with no printed piece", { path: "/comics", src: "none", ep: 140 }],
    ["the kudos wall sign", { path: "/kudos", src: "sign", ep: 0 }],
    ["the Scrum Master guide", { path: "/kudos", src: "guide", ep: 0 }],
    ["the comics' own link", { path: "/kudos", src: "comics", ep: 7 }],
    ["a plain visit to kudos", { path: "/kudos", src: "none", ep: 0 }],
  ])("counts %s", async (_label, body) => {
    expect((await hit(body)).status).toBe(204);
    expect(h.rpc).toHaveBeenCalledWith("comic_visit_hit", {
      p_path: body.path,
      p_src: body.src,
      p_ep: body.ep,
    });
  });

  it.each([
    ["the old entry shape", { entry: "poster", ep: 12, b: 3 }],
    ["a VIP entry", { path: "/comics", src: "vip", ep: 0 }],
    ["another page", { path: "/vip", src: "none", ep: 0 }],
    ["a poster with no episode", { path: "/comics", src: "poster", ep: 0 }],
    ["a poster for a weekly story", { path: "/comics", src: "poster", ep: 27 }],
    ["a kudos card for a weekly story", { path: "/comics", src: "kudos", ep: 27 }],
    ["the book with an episode", { path: "/comics", src: "book", ep: 3 }],
    ["the sign on the comics page", { path: "/comics", src: "sign", ep: 0 }],
    ["a poster on the kudos page", { path: "/kudos", src: "poster", ep: 3 }],
    ["a weekly story on the kudos page", { path: "/kudos", src: "none", ep: 40 }],
    ["an episode past 999", { path: "/comics", src: "none", ep: 1000 }],
    ["a negative episode", { path: "/comics", src: "none", ep: -1 }],
    ["a decimal", { path: "/comics", src: "poster", ep: 1.5 }],
    ["a numeric string", { path: "/comics", src: "poster", ep: "12" }],
    ["a missing episode", { path: "/comics", src: "none" }],
    ["an extra field", { path: "/comics", src: "none", ep: 0, b: 3 }],
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
    const res = await hit({ path: "/comics", src: "none", ep: 0, padding: "x".repeat(1000) });
    expect(res.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses another site, and a request with no Origin", async () => {
    const visit = { path: "/comics", src: "none", ep: 0 };
    expect((await hit(visit, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new NextRequest(`https://${HOST}/api/comics/hit`, {
      method: "POST",
      headers: { host: HOST, "x-real-ip": "10.9.0.1" },
      body: JSON.stringify(visit),
    });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("is quiet when no database is configured", async () => {
    h.hasClient = false;
    const res = await hit({ path: "/comics", src: "none", ep: 0 });
    expect(res.status).toBe(204);
  });

  it("is quiet when the database fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ error: { message: "down" } });
    expect((await hit({ path: "/comics", src: "none", ep: 0 })).status).toBe(204);
    warn.mockRestore();
  });

  it("stores no identifiers and sets no cookie", async () => {
    const res = await hit(
      { path: "/comics", src: "poster", ep: 12 },
      {
        "user-agent": "Mozilla/5.0 Secret",
        "x-forwarded-for": "9.9.9.9",
        cookie: "a=b",
        referer: "https://agile.test/comics?name=Sara",
      }
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    const [, args] = h.rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(Object.keys(args).sort()).toEqual(["p_ep", "p_path", "p_src"]);
    const sent = JSON.stringify(args);
    for (const secret of ["Sara", "9.9.9.9", "Mozilla", "a=b"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("takes a group scanning on one office Wi-Fi, then stops one address hammering it, quietly", async () => {
    const send = () =>
      POST(
        new NextRequest(`https://${HOST}/api/comics/hit`, {
          method: "POST",
          headers: { host: HOST, origin: `https://${HOST}`, "x-real-ip": "10.2.0.1" },
          body: JSON.stringify({ path: "/comics", src: "poster", ep: 4 }),
        })
      );
    for (let i = 0; i < 120; i++) await send();
    expect(h.rpc).toHaveBeenCalledTimes(120);
    expect((await send()).status).toBe(204);
    expect(h.rpc).toHaveBeenCalledTimes(120);
  });
});
