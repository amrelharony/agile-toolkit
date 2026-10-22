// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageApiError, StorageUnknownError } from "@supabase/storage-js";

/**
 * Signing a URL for the private comic PDF, and refusing to when the bucket
 * isn't private. supabase-js is mocked; the errors are storage-js's own
 * classes, built the way its fetch layer builds them from Storage's JSON
 * error bodies.
 */

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  createSignedUrl: vi.fn(),
  getBucket: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    h.createClient(...args);
    return {
      storage: {
        getBucket: h.getBucket,
        from: (bucket: string) => {
          h.from(bucket);
          return { createSignedUrl: h.createSignedUrl };
        },
      },
    };
  },
}));

const SERVICE_KEY = "service-role-secret-for-tests";
/** What Storage answers for the bucket, as storage-js's `Bucket`. */
const PRIVATE_BUCKET = { id: "comics", name: "comics", public: false };
const SIGNED =
  "https://ref.supabase.co/storage/v1/object/sign/comics/agile-at-work.pdf?token=signed-url-token";

async function load() {
  return import("@/lib/comic/storage");
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The client is cached per module instance; start each case fresh.
  vi.resetModules();
  h.createClient.mockClear();
  h.from.mockClear();
  h.createSignedUrl.mockReset();
  h.getBucket.mockReset();
  h.getBucket.mockResolvedValue({ data: PRIVATE_BUCKET, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
});

/** Every console.warn argument, flattened — to prove no secret is logged. */
function warned(): string {
  return warn.mock.calls.flat().map(String).join("\n");
}

describe("getComicSignedUrl", () => {
  it("signs agile-at-work.pdf in the private comics bucket for 12 hours", async () => {
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
    const { getComicSignedUrl, COMIC_BUCKET, COMIC_OBJECT, COMIC_SIGNED_URL_TTL_SECONDS } =
      await load();

    expect(await getComicSignedUrl()).toEqual({ status: "ready", url: SIGNED });
    expect(COMIC_BUCKET).toBe("comics");
    expect(COMIC_OBJECT).toBe("agile-at-work.pdf");
    expect(COMIC_SIGNED_URL_TTL_SECONDS).toBe(12 * 60 * 60);
    expect(h.from).toHaveBeenCalledWith("comics");
    expect(h.createSignedUrl).toHaveBeenCalledWith("agile-at-work.pdf", 43_200);
    expect(h.getBucket).toHaveBeenCalledWith("comics");
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses a service-role client without a persisted session, created once", async () => {
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
    const { getComicSignedUrl } = await load();
    await getComicSignedUrl();
    await getComicSignedUrl();

    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.createClient).toHaveBeenCalledWith("https://ref.supabase.co", SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // A fresh URL per request — never a cached one — and a fresh look at
    // the bucket's visibility, so making it public is caught at once.
    expect(h.createSignedUrl).toHaveBeenCalledTimes(2);
    expect(h.getBucket).toHaveBeenCalledTimes(2);
  });

  it("refuses to serve when the bucket has been made public", async () => {
    h.getBucket.mockResolvedValue({ data: { ...PRIVATE_BUCKET, public: true }, error: null });
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
    const { getComicSignedUrl } = await load();

    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned()).toMatch(/bucket "comics" is PUBLIC/);
    // The signed URL is dropped, never logged.
    expect(warned()).not.toContain(SIGNED);
    expect(warned()).not.toContain(SERVICE_KEY);
  });

  it("refuses to serve when the bucket's visibility is unknown", async () => {
    h.getBucket.mockResolvedValue({ data: { id: "comics", name: "comics" }, error: null });
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
  });

  it("reports a missing bucket as missing", async () => {
    const notFound = new StorageApiError("Bucket not found", 400, "404");
    h.getBucket.mockResolvedValue({ data: null, error: notFound });
    h.createSignedUrl.mockResolvedValue({ data: null, error: notFound });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "missing" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails closed when the bucket's visibility can't be checked", async () => {
    h.getBucket.mockResolvedValue({
      data: null,
      error: new StorageApiError("Internal Server Error", 500, "500"),
    });
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    expect(warned()).toContain("Internal Server Error");
    expect(warned()).not.toContain(SIGNED);
  });

  it.each([
    ["an unknown object (older servers: HTTP 400)", "Object not found", 400, "404"],
    ["an unknown object (HTTP 404)", "Object not found", 404, "404"],
    ["a missing bucket", "Bucket not found", 400, "404"],
    ["a bare 404", "Not Found", 404, "NoSuchKey"],
  ])("reports %s as missing", async (_label, message, status, statusCode) => {
    h.createSignedUrl.mockResolvedValue({
      data: null,
      error: new StorageApiError(message, status, statusCode),
    });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "missing" });
  });

  it("reports any other Storage error as unavailable, logging no secrets", async () => {
    h.createSignedUrl.mockResolvedValue({
      data: null,
      error: new StorageApiError("Invalid Compact JWS", 400, "403"),
    });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned()).toContain("Invalid Compact JWS");
    expect(warned()).not.toContain(SERVICE_KEY);
  });

  it("reports a network failure as unavailable", async () => {
    h.createSignedUrl.mockResolvedValue({
      data: null,
      error: new StorageUnknownError("fetch failed", new TypeError("fetch failed")),
    });
    const { getComicSignedUrl } = await load();
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    expect(warned()).not.toContain(SERVICE_KEY);
  });

  it("reports a thrown error or an empty answer as unavailable", async () => {
    const { getComicSignedUrl } = await load();
    h.createSignedUrl.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined"));
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    h.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "" }, error: null });
    expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
    expect(warned()).not.toContain(SIGNED);
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])(
    "is unavailable without %s, and never builds a client",
    async (name) => {
      vi.stubEnv(name, "");
      const { getComicSignedUrl } = await load();
      expect(await getComicSignedUrl()).toEqual({ status: "unavailable" });
      expect(h.createClient).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    }
  );
});
