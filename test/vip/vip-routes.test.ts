// @vitest-environment node
/**
 * The VIP server side: the printed link that unlocks a device and the page
 * that picks what to show. The key check runs for real, against a test-only
 * hash.
 */

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ReactElement } from "react";

const KEY = "testkey12345";

const h = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/squads/server", () => ({ getSquadAdminClient: () => null }));
vi.mock("@/lib/comics/store", () => ({ listEarlyWeekly: async () => [] }));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "agile-toolkit:vip" && h.cookie !== undefined
        ? { name, value: h.cookie }
        : undefined,
  }),
}));

import { GET as unlock } from "@/app/vip/[key]/route";
import VipPage from "@/app/vip/page";

const ORIGIN = "https://agile.amrelharony.com";

beforeEach(() => {
  h.cookie = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("printed VIP link", () => {
  async function open(key: string) {
    const res = await unlock(new NextRequest(`${ORIGIN}/vip/${key}?utm=book`), {
      params: { key },
    });
    return { res, location: new URL(res.headers.get("location") ?? "", ORIGIN) };
  }

  it("remembers a valid key on this device and opens the VIP page", async () => {
    const { res, location } = await open(KEY);
    expect(res.status).toBe(307);
    // The key doesn't stay in the address bar; nor do stray query params.
    expect(location.pathname).toBe("/vip");
    expect(location.search).toBe("");

    const cookie = res.cookies.get("agile-toolkit:vip");
    expect(cookie?.value).toBe(KEY);
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
    });
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("sets a readable, non-secret hint beside the httpOnly key", async () => {
    const { res } = await open(KEY);
    const hint = res.cookies.get("agile-toolkit:vip-hint");
    expect(hint?.value).toBe("1");
    expect(hint?.httpOnly).toBeFalsy();
    expect(hint).toMatchObject({ sameSite: "lax", path: "/" });
  });

  it("stores the key normalised when it was typed in capitals", async () => {
    const { res } = await open(KEY.toUpperCase());
    expect(res.cookies.get("agile-toolkit:vip")?.value).toBe(KEY);
  });

  it("sends an unknown key to the explanation, without a cookie", async () => {
    const { res, location } = await open("not-the-key");
    expect(location.pathname).toBe("/vip");
    expect(location.searchParams.get("link")).toBe("invalid");
    expect(res.cookies.get("agile-toolkit:vip")).toBeUndefined();
    expect(res.cookies.get("agile-toolkit:vip-hint")).toBeUndefined();
  });

  it("marks secure cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { res } = await open(KEY);
    expect(res.cookies.get("agile-toolkit:vip")?.secure).toBe(true);
  });
});

describe("VIP page", () => {
  async function access(link?: string) {
    const el = (await VipPage({ searchParams: link ? { link } : {} })) as ReactElement<{
      access: string;
    }>;
    return el.props.access;
  }

  it("welcomes a device that opened the link", async () => {
    h.cookie = KEY;
    expect(await access()).toBe("unlocked");
    // A stale ?link=invalid from an earlier typo doesn't override the cookie.
    expect(await access("invalid")).toBe("unlocked");
  });

  it("tells everyone else how to get in", async () => {
    expect(await access()).toBe("locked");
    h.cookie = "a-forged-value";
    expect(await access()).toBe("locked");
  });

  it("explains a link that didn't work", async () => {
    expect(await access("invalid")).toBe("invalid-link");
  });
});
