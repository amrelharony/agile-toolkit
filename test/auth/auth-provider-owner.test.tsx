import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * AuthProvider's owner invariant: status "authenticated" only after
 * GET /api/auth/owner confirmed the session. The Supabase browser client
 * is faked (session store + auth-event emitter + profiles query); fetch
 * is stubbed per test to play the owner endpoint.
 */

type AuthListener = (event: string, session: Session | null) => void;

const h = vi.hoisted(() => {
  const listeners = new Set<AuthListener>();
  const store = { session: null as Session | null };
  const profileQuery = {
    single: null as unknown as () => Promise<{ data: unknown; error: unknown }>,
  };
  const client = {
    auth: {
      getSession: null as unknown as () => Promise<{ data: { session: Session | null } }>,
      onAuthStateChange: (cb: AuthListener) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      signOut: null as unknown as (opts?: { scope?: string }) => Promise<{ error: null }>,
      signInWithOAuth: async () => ({ error: null }),
    },
    from: null as unknown as (table: string) => unknown,
  };
  const emit = (event: string, session: Session | null) => {
    for (const cb of Array.from(listeners)) cb(event, session);
  };
  return { listeners, store, client, emit, profileQuery };
});

vi.mock("@/lib/auth/supabase-browser", () => ({
  getAuthBrowserClient: () => h.client,
  isAuthAvailable: () => true,
}));

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@/lib/utils/toast", () => ({ toast }));

vi.mock("@/components/auth/role-picker-dialog", async () => {
  const { createElement } = await import("react");
  return {
    RolePickerDialog: ({ open }: { open: boolean }) =>
      createElement("div", { "data-testid": "role-picker", "data-open": String(open) }),
  };
});

import { AuthProvider, OWNER_UNVERIFIED, useAuth } from "@/lib/auth/auth-provider";
import { OWNER_SEEN_KEY, useIsOwner } from "@/lib/auth/use-is-owner";

const DENIED_TOAST =
  "That Google account isn't the owner account — every tool still works without signing in.";

function session(uid: string, token = "t1"): Session {
  return {
    access_token: token,
    refresh_token: "r",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: uid, email: `${uid}@example.com`, app_metadata: {}, user_metadata: {} },
  } as unknown as Session;
}

function profile(uid: string, scrum_role: string | null = "developer") {
  return { id: uid, email: `${uid}@example.com`, display_name: uid, scrum_role };
}

type FetchResult = { status: number; body?: unknown } | Error | Promise<never>;

let fetchSpy: ReturnType<typeof vi.fn>;
let signOutSpy: ReturnType<typeof vi.fn>;
let fromSpy: ReturnType<typeof vi.fn>;

/** Queue owner-endpoint answers in call order; the last one repeats. */
function ownerEndpoint(...results: FetchResult[]) {
  let i = 0;
  fetchSpy.mockImplementation(async () => {
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    if (r instanceof Error) throw r;
    if (r instanceof Promise) return r;
    return { status: r.status, json: async () => r.body };
  });
}

function Probe() {
  const auth = useAuth();
  const isOwner = useIsOwner();
  return (
    <div
      data-testid="probe"
      data-status={auth.status}
      data-user={auth.user?.id ?? ""}
      data-error={auth.error ?? ""}
      data-owner={String(isOwner)}
      data-role={auth.profile?.scrum_role ?? ""}
    />
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

const probe = () => screen.getByTestId("probe");
const ownerCalls = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url) === "/api/auth/owner").length;

beforeEach(() => {
  h.listeners.clear();
  h.store.session = null;
  window.localStorage.clear();
  toast.info.mockClear();

  h.client.auth.getSession = vi.fn(async () => ({ data: { session: h.store.session } }));
  signOutSpy = vi.fn(async () => {
    h.store.session = null;
    h.emit("SIGNED_OUT", null);
    return { error: null };
  });
  h.client.auth.signOut = signOutSpy as unknown as typeof h.client.auth.signOut;

  h.profileQuery.single = vi.fn(async () => ({
    data: profile(h.store.session?.user.id ?? "u1"),
    error: null,
  }));
  fromSpy = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: () => h.profileQuery.single() }) }),
  }));
  h.client.from = fromSpy as unknown as typeof h.client.from;

  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AuthProvider owner verification", () => {
  it("is authenticated only after the server confirms the owner", async () => {
    h.store.session = session("u1");
    ownerEndpoint({ status: 200, body: { owner: true } });

    renderProvider();
    expect(probe().dataset.status).toBe("loading");

    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));
    expect(probe().dataset.user).toBe("u1");
    expect(probe().dataset.owner).toBe("true");
    expect(probe().dataset.role).toBe("developer");
    expect(ownerCalls()).toBe(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(window.localStorage.getItem(OWNER_SEEN_KEY)).toBe("1");
    expect(screen.getByTestId("role-picker").dataset.open).toBe("false");
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it("opens the role picker for the owner when the profile has no role", async () => {
    h.store.session = session("u1");
    h.profileQuery.single = vi.fn(async () => ({ data: profile("u1", null), error: null }));
    ownerEndpoint({ status: 200, body: { owner: true } });

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));
    expect(screen.getByTestId("role-picker").dataset.open).toBe("true");
  });

  it("signs a non-owner out locally, stays anonymous and explains why", async () => {
    h.store.session = session("stranger");
    ownerEndpoint({ status: 403, body: { error: "not_authorized" } });

    renderProvider();
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" }));
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));

    expect(probe().dataset.user).toBe("");
    expect(probe().dataset.owner).toBe("false");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(DENIED_TOAST);
    expect(screen.queryByTestId("role-picker")).toBeNull();
    expect(window.localStorage.getItem(OWNER_SEEN_KEY)).toBeNull();
  });

  it("still ends anonymous when the local sign-out itself fails", async () => {
    h.store.session = session("stranger");
    ownerEndpoint({ status: 403 });
    signOutSpy.mockImplementation(async () => {
      throw new Error("storage unavailable");
    });

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(toast.info).toHaveBeenCalledWith(DENIED_TOAST);
  });

  it("drops a session the server rejects as invalid without a toast", async () => {
    h.store.session = session("u1");
    ownerEndpoint({ status: 401 });

    renderProvider();
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" }));
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(probe().dataset.user).toBe("");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("reports an error with no user when the owner check can't be answered", async () => {
    h.store.session = session("u1");
    ownerEndpoint(new TypeError("Failed to fetch"));

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("error"));
    expect(probe().dataset.error).toBe(OWNER_UNVERIFIED);
    expect(probe().dataset.user).toBe("");
    expect(probe().dataset.owner).toBe("false");
    expect(signOutSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("role-picker")).toBeNull();
  });

  it("does not re-check an already-verified uid on repeat auth events", async () => {
    h.store.session = session("u1");
    ownerEndpoint({ status: 200, body: { owner: true } });

    renderProvider();
    // INITIAL_SESSION races getSession(): the in-flight check covers both.
    act(() => h.emit("INITIAL_SESSION", session("u1")));
    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));

    act(() => {
      h.emit("TOKEN_REFRESHED", session("u1", "t2"));
      h.emit("SIGNED_IN", session("u1", "t3")); // fired on every tab refocus
      h.emit("TOKEN_REFRESHED", session("u1", "t4"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(ownerCalls()).toBe(1);
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(probe().dataset.status).toBe("authenticated");
  });

  it("forgets the verified owner on SIGNED_OUT and re-checks on the next sign-in", async () => {
    h.store.session = session("u1");
    ownerEndpoint({ status: 200, body: { owner: true } });

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));

    act(() => h.emit("SIGNED_OUT", null));
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(probe().dataset.user).toBe("");
    expect(probe().dataset.owner).toBe("false");

    // Same uid again, but the server now says no (e.g. removed from the allowlist).
    ownerEndpoint({ status: 403 });
    act(() => h.emit("SIGNED_IN", session("u1", "t9")));
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" }));
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(ownerCalls()).toBe(2);
  });

  it("ignores a stale owner answer for a user who was replaced mid-check (BUG-A4)", async () => {
    let releaseFirst: (v: { status: number; json: () => Promise<unknown> }) => void = () => {};
    const first = new Promise<{ status: number; json: () => Promise<unknown> }>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    fetchSpy.mockImplementation(() => {
      call += 1;
      if (call === 1) return first;
      return Promise.resolve({ status: 403, json: async () => ({}) });
    });
    h.store.session = session("owner");

    renderProvider();
    await waitFor(() => expect(ownerCalls()).toBe(1));

    // A different account takes over before the owner's answer lands.
    act(() => h.emit("SIGNED_IN", session("stranger")));
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));

    await act(async () => {
      releaseFirst({ status: 200, json: async () => ({ owner: true }) });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(probe().dataset.status).toBe("anonymous");
    expect(probe().dataset.user).toBe("");
  });

  it("settles as a visitor when getSession() rejects", async () => {
    h.client.auth.getSession = vi.fn(async () => {
      throw new Error("lock timeout");
    });

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("settles as a visitor with no session at all, without calling the owner endpoint", async () => {
    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("anonymous"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("AuthProvider owner re-check while unverified", () => {
  it("retries at 2s, 10s and 30s, then stops", async () => {
    vi.useFakeTimers();
    h.store.session = session("u1");
    ownerEndpoint(new TypeError("offline"));

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(probe().dataset.status).toBe("error");
    expect(ownerCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(ownerCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ownerCalls()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(ownerCalls()).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(ownerCalls()).toBe(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(ownerCalls()).toBe(4);
    expect(probe().dataset.status).toBe("error");
  });

  it("becomes authenticated when a scheduled retry succeeds, and stops retrying", async () => {
    vi.useFakeTimers();
    h.store.session = session("u1");
    ownerEndpoint({ status: 503 }, { status: 200, body: { owner: true } });

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(probe().dataset.status).toBe("error");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(probe().dataset.status).toBe("authenticated");
    expect(probe().dataset.user).toBe("u1");
    expect(ownerCalls()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(ownerCalls()).toBe(2);
  });

  it("retries when the browser comes back online or the tab becomes visible", async () => {
    h.store.session = session("u1");
    ownerEndpoint(new TypeError("offline"), new TypeError("still offline"), {
      status: 200,
      body: { owner: true },
    });

    renderProvider();
    await waitFor(() => expect(probe().dataset.status).toBe("error"));
    expect(ownerCalls()).toBe(1);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(ownerCalls()).toBe(2));
    await waitFor(() => expect(probe().dataset.status).toBe("error"));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));
    expect(ownerCalls()).toBe(3);

    // Verified now: further online / visibility events don't re-check.
    act(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(ownerCalls()).toBe(3);
  });

  it("stops retrying after sign-out", async () => {
    vi.useFakeTimers();
    h.store.session = session("u1");
    ownerEndpoint(new TypeError("offline"));

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(probe().dataset.status).toBe("error");

    act(() => h.emit("SIGNED_OUT", null));
    expect(probe().dataset.status).toBe("anonymous");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ownerCalls()).toBe(1);
  });

  it("clears pending retries on unmount", async () => {
    vi.useFakeTimers();
    h.store.session = session("u1");
    ownerEndpoint(new TypeError("offline"));

    const { unmount } = renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ownerCalls()).toBe(1);

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(ownerCalls()).toBe(1);
  });
});

/**
 * Owner sign-out on a shared browser. supabase-js returns `{ error }` and
 * keeps the stored session when POST /logout fails (offline, 5xx, 429) or
 * hangs; the session must still leave THIS browser, or the next page load
 * hands the owner's account to whoever uses it next.
 */
describe("AuthProvider sign-out", () => {
  let auth: AuthContextValue | null = null;
  function Capture() {
    auth = useAuth();
    return null;
  }
  const cookieNames = () =>
    document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter(Boolean)
      .sort();
  const removeSession = vi.fn(async () => {
    // auth-js's private _removeSession: storage gone, SIGNED_OUT emitted.
    h.store.session = null;
    h.emit("SIGNED_OUT", null);
  });

  async function signedInOwner() {
    h.store.session = session("u1");
    ownerEndpoint({ status: 200, body: { owner: true } });
    render(
      <AuthProvider>
        <Probe />
        <Capture />
      </AuthProvider>
    );
    await waitFor(() => expect(probe().dataset.status).toBe("authenticated"));
  }

  beforeEach(() => {
    auth = null;
    removeSession.mockClear();
    (h.client.auth as unknown as { _removeSession?: unknown })._removeSession = removeSession;
    for (const name of [
      "sb-ref-auth-token.0",
      "sb-ref-auth-token.1",
      "sb-ref-auth-token-code-verifier",
      "ae-theme",
    ]) {
      document.cookie = `${name}=v; path=/`;
    }
  });

  afterEach(() => {
    delete (h.client.auth as unknown as { _removeSession?: unknown })._removeSession;
    for (const name of cookieNames()) document.cookie = `${name}=; Max-Age=0; path=/`;
  });

  it("signs out normally when the server answers", async () => {
    await signedInOwner();
    signOutSpy.mockImplementation(async () => {
      h.store.session = null;
      for (const name of cookieNames()) {
        if (name.startsWith("sb-")) document.cookie = `${name}=; Max-Age=0; path=/`;
      }
      h.emit("SIGNED_OUT", null);
      return { error: null };
    });

    let result: unknown;
    await act(async () => {
      result = await auth!.signOut();
    });
    expect(result).toEqual({ revoked: true, signedOutHere: true });
    expect(removeSession).not.toHaveBeenCalled();
    expect(probe().dataset.status).toBe("anonymous");
  });

  it("removes the session from this browser when the server call fails", async () => {
    await signedInOwner();
    // What auth-js 2.101 does offline: no throw, session kept, no event.
    signOutSpy.mockImplementation(async () => ({ error: new Error("Failed to fetch") }));

    let result: unknown;
    await act(async () => {
      result = await auth!.signOut();
    });
    expect(result).toEqual({ revoked: false, signedOutHere: true });
    expect(removeSession).toHaveBeenCalledTimes(1);
    expect(cookieNames()).toEqual(["ae-theme"]);
    expect(probe().dataset.status).toBe("anonymous");
    expect(probe().dataset.owner).toBe("false");
  });

  it("does not wait forever on a hung sign-out request", async () => {
    await signedInOwner();
    vi.useFakeTimers();
    signOutSpy.mockImplementation(() => new Promise(() => {}));

    let result: unknown;
    await act(async () => {
      const pending = auth!.signOut().then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(8_000);
      await pending;
    });
    expect(result).toEqual({ revoked: false, signedOutHere: true });
    expect(cookieNames()).toEqual(["ae-theme"]);
    expect(probe().dataset.status).toBe("anonymous");
  });

  it("reports a session it could not remove, and keeps showing it as signed in", async () => {
    await signedInOwner();
    signOutSpy.mockImplementation(async () => ({ error: new Error("Failed to fetch") }));
    // Neither the client's own removal nor storage cooperates.
    delete (h.client.auth as unknown as { _removeSession?: unknown })._removeSession;

    let result: unknown;
    await act(async () => {
      result = await auth!.signOut();
    });
    expect(result).toEqual({ revoked: false, signedOutHere: false });
    // Truthful: still the owner here, so the UI can say sign-out failed
    // rather than present a signed-out page over a live session.
    expect(probe().dataset.status).toBe("authenticated");
  });
});
