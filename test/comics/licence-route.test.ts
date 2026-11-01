// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  insert: vi.fn<(row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>>(
    async () => ({ error: null })
  ),
  unhandled: 0 as number | null,
  countError: null as { message: string } | null,
  hasClient: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () =>
    h.hasClient
      ? {
          from: (table: string) => {
            expect(table).toBe("comic_licence_requests");
            return {
              select: () => ({
                is: async () => ({ count: h.unhandled, error: h.countError }),
              }),
              insert: h.insert,
            };
          },
        }
      : null,
}));

import { POST } from "@/app/api/comics/licence/route";

const HOST = "agile.test";
const GOOD = {
  name: "Sara Ali",
  company: "Acme",
  email: "sara@acme.example",
  intendedUse: "Slides for an internal training course",
  teamSize: "40",
  message: "Hello",
};
let ip = 0;

function request(body: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return new NextRequest(`https://${HOST}/api/comics/licence`, {
    method: "POST",
    headers: {
      host: HOST,
      origin: `https://${HOST}`,
      "x-real-ip": `10.0.0.${ip}`,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.insert.mockClear();
  h.insert.mockResolvedValue({ error: null });
  h.unhandled = 0;
  h.countError = null;
  h.hasClient = true;
});

describe("POST /api/comics/licence", () => {
  it("stores what was typed", async () => {
    const res = await POST(request(GOOD));
    expect(res.status).toBe(204);
    expect(h.insert).toHaveBeenCalledWith({
      name: "Sara Ali",
      company: "Acme",
      email: "sara@acme.example",
      intended_use: "Slides for an internal training course",
      team_size: "40",
      message: "Hello",
    });
  });

  it("stores no IP address or user agent", async () => {
    await POST(
      request(GOOD, {
        "user-agent": "Mozilla/5.0 Secret",
        "x-forwarded-for": "9.9.9.9",
        cookie: "a=b",
      })
    );
    const row = h.insert.mock.calls[0][0];
    expect(Object.keys(row).sort()).toEqual([
      "company",
      "email",
      "intended_use",
      "message",
      "name",
      "team_size",
    ]);
    expect(JSON.stringify(row)).not.toMatch(/Mozilla|9\.9\.9\.9/);
  });

  it("strips control characters Postgres would refuse", async () => {
    await POST(request({ ...GOOD, name: "Sara\u0000 Ali" }));
    expect(h.insert.mock.calls[0][0].name).toBe("Sara Ali");
  });

  it.each([
    ["another site", { origin: "https://evil.example" }],
    ["a malformed origin", { origin: "not a url" }],
    ["a look-alike host", { origin: `https://${HOST}.evil.example` }],
  ])("refuses %s", async (_label, headers) => {
    const res = await POST(request(GOOD, headers));
    expect(res.status).toBe(403);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("refuses a request with no Origin", async () => {
    const res = await POST(
      new NextRequest(`https://${HOST}/api/comics/licence`, {
        method: "POST",
        headers: { host: HOST, "x-real-ip": "10.1.0.1" },
        body: JSON.stringify(GOOD),
      })
    );
    expect(res.status).toBe(403);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("drops a filled honeypot without storing it or telling the bot", async () => {
    const res = await POST(request({ ...GOOD, website: "https://spam.example" }));
    expect(res.status).toBe(204);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    const res = await POST(request({ ...GOOD, message: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["a long name", { name: "x".repeat(121) }],
    ["a long company", { company: "x".repeat(161) }],
    ["a long email", { email: `${"x".repeat(250)}@a.co` }],
    ["a long intended use", { intendedUse: "x".repeat(1001) }],
    ["a long team size", { teamSize: "x".repeat(41) }],
    ["a long message", { message: "x".repeat(2001) }],
    ["a bad email", { email: "not-an-email" }],
    ["a missing name", { name: "" }],
    ["a blank company", { company: "   " }],
    ["a number for a name", { name: 42 }],
  ])("refuses %s", async (_label, change) => {
    const res = await POST(request({ ...GOOD, ...change }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("refuses text that isn't JSON", async () => {
    expect((await POST(request("nope"))).status).toBe(400);
  });

  it("refuses more once the inbox holds its cap of unhandled rows", async () => {
    h.unhandled = 500;
    const res = await POST(request(GOOD));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("inbox_full");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("takes one more just under the cap", async () => {
    h.unhandled = 499;
    expect((await POST(request(GOOD))).status).toBe(204);
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("refuses when the cap can't be checked, rather than guessing", async () => {
    h.countError = { message: "down" };
    expect((await POST(request(GOOD))).status).toBe(503);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("answers 503 with no database, and when the insert fails", async () => {
    h.hasClient = false;
    expect((await POST(request(GOOD))).status).toBe(503);
    h.hasClient = true;
    h.insert.mockResolvedValue({ error: { message: "down" } });
    expect((await POST(request(GOOD))).status).toBe(503);
  });

  it("rate limits one address", async () => {
    const headers = { "x-real-ip": "10.2.0.1" };
    for (let i = 0; i < 5; i++) expect((await POST(request(GOOD, headers))).status).toBe(204);
    const res = await POST(request(GOOD, headers));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(h.insert).toHaveBeenCalledTimes(5);
  });
});
