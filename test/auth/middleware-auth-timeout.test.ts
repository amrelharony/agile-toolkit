/**
 * The middleware's session check must be bounded.
 *
 * When the Supabase project's DNS record disappeared, `getUser()` never
 * returned and Vercel killed the invocation — a site-wide 504
 * MIDDLEWARE_INVOCATION_TIMEOUT for every signed-in request, while signed-out
 * visitors saw a healthy site (with no session cookie supabase-js answers
 * locally and never touches the network).
 *
 * So the property under test is not "the right user is let in" — it is
 * "probeSession always settles, and everything that isn't a verified user
 * fails closed" for the API and owner pages (public pages pass regardless;
 * see middleware-routing.test.ts). Fake timers keep the 3s deadline instant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_TIMEOUT_MS, probeSession } from "@/middleware";

/** A client whose getUser() never settles — the outage, reduced to one line. */
const hangs = { auth: { getUser: () => new Promise<never>(() => {}) } };

const resolvesWith = (value: {
  data: { user: { email?: string | null } | null };
  error: { name?: string } | null;
}) => ({ auth: { getUser: () => Promise.resolve(value) } });

describe("probeSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a hung auth backend instead of hanging with it", async () => {
    const probe = probeSession(hangs);
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    await expect(probe).resolves.toEqual({ status: "unreachable" });
  });

  it("does not give up early — a slow-but-alive backend still authenticates", async () => {
    const slow = {
      auth: {
        getUser: () =>
          new Promise<{
            data: { user: { email?: string | null } | null };
            error: { name?: string } | null;
          }>((resolve) =>
            setTimeout(
              () => resolve({ data: { user: { email: "a.elharony@gmail.com" } }, error: null }),
              AUTH_TIMEOUT_MS - 500
            )
          ),
      },
    };

    const probe = probeSession(slow);
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS - 500);
    await expect(probe).resolves.toEqual({
      status: "ok",
      user: { email: "a.elharony@gmail.com" },
    });
  });

  it("reports a verified user as ok", async () => {
    await expect(
      probeSession(resolvesWith({ data: { user: { email: "a.elharony@gmail.com" } }, error: null }))
    ).resolves.toEqual({ status: "ok", user: { email: "a.elharony@gmail.com" } });
  });

  it("treats a missing session as anonymous, not as an outage", async () => {
    await expect(
      probeSession(
        resolvesWith({ data: { user: null }, error: { name: "AuthSessionMissingError" } })
      )
    ).resolves.toEqual({ status: "anonymous" });
  });

  it("classifies a failed request as unreachable so the log says why", async () => {
    await expect(
      probeSession(
        resolvesWith({ data: { user: null }, error: { name: "AuthRetryableFetchError" } })
      )
    ).resolves.toEqual({ status: "unreachable" });
  });

  it("survives a rejected getUser() rather than propagating the throw", async () => {
    const throws = { auth: { getUser: () => Promise.reject(new TypeError("fetch failed")) } };
    await expect(probeSession(throws)).resolves.toEqual({ status: "unreachable" });
  });

  it("clears its deadline timer once the check settles", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await probeSession(resolvesWith({ data: { user: null }, error: null }));
    expect(clear).toHaveBeenCalled();
    // Nothing left pending that could keep the invocation alive.
    expect(vi.getTimerCount()).toBe(0);
    clear.mockRestore();
  });
});
