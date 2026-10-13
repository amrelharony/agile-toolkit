import { describe, it, expect, vi, afterEach } from "vitest";
import { checkOwner, OWNER_CHECK_URL, OWNER_SEEN_KEY } from "@/lib/auth/owner-check";

/**
 * checkOwner() is the client's only source of "is this session the owner?".
 * Anything that isn't a clear 200 / 401 / 403 must come back "unknown" so
 * the provider neither trusts nor signs out the session.
 */

function response(status: number, body?: unknown, json?: () => Promise<unknown>) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: json ?? (async () => body),
  } as unknown as Response;
}

function fetchReturning(res: Response) {
  return vi.fn<typeof fetch>(async () => res);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkOwner", () => {
  it("returns owner for 200 { owner: true } and calls the owner endpoint uncached", async () => {
    const fetchImpl = fetchReturning(response(200, { owner: true }));
    await expect(checkOwner({ fetchImpl })).resolves.toBe("owner");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/owner");
    expect(url).toBe(OWNER_CHECK_URL);
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns denied for 403", async () => {
    const body = { error: "not_authorized", message: "nope" };
    await expect(checkOwner({ fetchImpl: fetchReturning(response(403, body)) })).resolves.toBe(
      "denied"
    );
  });

  it("returns invalid for 401", async () => {
    const body = { error: "unauthenticated", message: "sign in" };
    await expect(checkOwner({ fetchImpl: fetchReturning(response(401, body)) })).resolves.toBe(
      "invalid"
    );
  });

  it.each([500, 502, 503, 404, 204])("returns unknown for HTTP %i", async (status) => {
    await expect(checkOwner({ fetchImpl: fetchReturning(response(status, {})) })).resolves.toBe(
      "unknown"
    );
  });

  it("returns unknown for a 200 that does not say owner: true", async () => {
    for (const body of [{ owner: false }, { owner: "true" }, {}, null, "owner"]) {
      await expect(checkOwner({ fetchImpl: fetchReturning(response(200, body)) })).resolves.toBe(
        "unknown"
      );
    }
  });

  it("returns unknown for a 200 with an unparseable body", async () => {
    const res = response(200, undefined, async () => {
      throw new SyntaxError("Unexpected token <");
    });
    await expect(checkOwner({ fetchImpl: fetchReturning(res) })).resolves.toBe("unknown");
  });

  it("returns unknown when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(checkOwner({ fetchImpl })).resolves.toBe("unknown");
  });

  it("returns unknown and aborts the request when the server never answers", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const result = checkOwner({ fetchImpl, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("unknown");
    expect(signal?.aborted).toBe(true);
  });

  it("times out after 8 seconds by default, including a body that never finishes", async () => {
    vi.useFakeTimers();
    const res = response(200, undefined, () => new Promise(() => {}));
    let settled: string | null = null;
    const result = checkOwner({ fetchImpl: fetchReturning(res) }).then((r) => (settled = r));

    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("unknown");
  });

  it("uses the global fetch when no fetchImpl is given", async () => {
    const globalFetch = fetchReturning(response(200, { owner: true }));
    vi.stubGlobal("fetch", globalFetch);
    await expect(checkOwner()).resolves.toBe("owner");
    expect(globalFetch).toHaveBeenCalledWith("/api/auth/owner", expect.any(Object));
  });

  it("exposes the owner-seen storage key", () => {
    expect(OWNER_SEEN_KEY).toBe("agile-toolkit:owner-seen");
  });
});
