// @vitest-environment node
/**
 * The colour edition's server side: the QR link that unlocks a device, the
 * PDF route that checks the cookie, and the page that picks what to show.
 * The key check runs for real, against a test-only hash.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const KEY = "testkey12345";

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  servePdf: vi.fn(async () => new Response("pdf", { status: 206 })),
}));

vi.mock("@/lib/comic/color-edition-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/comic/color-edition-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isColorEditionKey: (raw: string | null | undefined) => actual.isColorEditionKey(raw, hashes),
  };
});
vi.mock("@/lib/comic/serve-pdf", () => ({ servePdf: h.servePdf }));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      name === "agile-toolkit:comic-color" && h.cookie !== undefined
        ? { name, value: h.cookie }
        : undefined,
  }),
}));

import { GET as unlock } from "@/app/(tools)/agile-at-work/color/[key]/route";
import { GET as pdf } from "@/app/(tools)/agile-at-work/color/edition.pdf/route";
import ColorEditionPage from "@/app/(tools)/agile-at-work/color/page";

const ORIGIN = "https://agile.amrelharony.com";

beforeEach(() => {
  h.cookie = undefined;
  h.servePdf.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("QR unlock link", () => {
  async function open(key: string) {
    const res = await unlock(new NextRequest(`${ORIGIN}/agile-at-work/color/${key}?utm=qr`), {
      params: { key },
    });
    return { res, location: new URL(res.headers.get("location") ?? "", ORIGIN) };
  }

  it("remembers a valid key on this device and opens the reader", async () => {
    const { res, location } = await open(KEY);
    expect(res.status).toBe(307);
    // The key doesn't stay in the address bar; nor do stray query params.
    expect(location.pathname).toBe("/agile-at-work/color");
    expect(location.search).toBe("");

    const cookie = res.cookies.get("agile-toolkit:comic-color");
    expect(cookie?.value).toBe(KEY);
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/agile-at-work/color",
      maxAge: 400 * 24 * 60 * 60,
    });
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stores the key normalised when it was typed in capitals", async () => {
    const { res } = await open(KEY.toUpperCase());
    expect(res.cookies.get("agile-toolkit:comic-color")?.value).toBe(KEY);
  });

  it("sends an unknown key to the explanation, without a cookie", async () => {
    const { res, location } = await open("not-the-key");
    expect(location.pathname).toBe("/agile-at-work/color");
    expect(location.searchParams.get("link")).toBe("invalid");
    expect(res.cookies.get("agile-toolkit:comic-color")).toBeUndefined();
  });

  it("marks secure cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { res } = await open(KEY);
    expect(res.cookies.get("agile-toolkit:comic-color")?.secure).toBe(true);
  });
});

describe("colour PDF route", () => {
  function request(cookie?: string, range?: string) {
    const headers = new Headers();
    if (cookie !== undefined) headers.set("cookie", `agile-toolkit:comic-color=${cookie}`);
    if (range) headers.set("range", range);
    return new NextRequest(`${ORIGIN}/agile-at-work/color/edition.pdf?v=abc`, { headers });
  }

  it("refuses a visitor without the access cookie", async () => {
    const res = await pdf(request());
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.servePdf).not.toHaveBeenCalled();
  });

  it("refuses a cookie holding a wrong key", async () => {
    expect((await pdf(request("not-the-key"))).status).toBe(403);
    expect(h.servePdf).not.toHaveBeenCalled();
  });

  it("streams the private file, range intact, privately cached", async () => {
    const res = await pdf(request(KEY, "bytes=0-1048575"));
    expect(res.status).toBe(206);
    expect(h.servePdf).toHaveBeenCalledOnce();
    const [file, range, headers] = h.servePdf.mock.calls[0] as unknown as [
      string,
      string | null,
      Record<string, string>,
    ];
    expect(file).toBe(path.join(process.cwd(), "private", "comics", "agile-at-work-color.pdf"));
    expect(range).toBe("bytes=0-1048575");
    expect(headers["Cache-Control"]).toMatch(/^private/);
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
});

describe("colour edition page", () => {
  async function props(searchParams: { link?: string } = {}) {
    const element = await ColorEditionPage({ searchParams });
    return element.props as { access: string; asset: { src: string } | null };
  }

  it("opens the reader for an unlocked device", async () => {
    vi.stubEnv("COMIC_COLOR_PDF_SIZE", "4096");
    vi.stubEnv("COMIC_COLOR_PDF_VERSION", "c0101abc");
    h.cookie = KEY;
    expect(await props()).toEqual({
      access: "unlocked",
      asset: {
        available: true,
        size: 4096,
        version: "c0101abc",
        src: "/agile-at-work/color/edition.pdf?v=c0101abc",
      },
    });
  });

  it("keeps the PDF's URL from a locked visitor", async () => {
    vi.stubEnv("COMIC_COLOR_PDF_VERSION", "c0101abc");
    expect(await props()).toEqual({ access: "locked", asset: null });
    h.cookie = "not-the-key";
    expect(await props()).toEqual({ access: "locked", asset: null });
  });

  it("explains a bad QR link", async () => {
    expect(await props({ link: "invalid" })).toEqual({ access: "invalid-link", asset: null });
  });
});
