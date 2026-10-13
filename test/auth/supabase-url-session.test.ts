import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Neither browser Supabase client may adopt a session from the page URL:
 * OAuth codes must only be exchanged by /auth/callback, which enforces the
 * owner check. Runs the REAL @supabase/ssr / supabase-js against a stubbed
 * fetch. Each "control" case shows the URL really would be consumed with
 * default settings, so the assertions below aren't passing vacuously —
 * and it fails loudly if a library upgrade changes how the flag is read.
 */

const SUPABASE_URL = "https://abcd.supabase.co";
const STORAGE_KEY = "sb-abcd-auth-token";

let fetchSpy: ReturnType<typeof vi.fn>;
const created: SupabaseClient[] = [];

function authCalls() {
  return fetchSpy.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith(`${SUPABASE_URL}/auth/v1/`));
}

function setUrl(url: string) {
  window.history.replaceState(null, "", url);
}

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  // Two clients share a storage key on purpose here; silence GoTrue's warning.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "test" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchSpy);
  window.localStorage.clear();
  clearCookies();
});

afterEach(async () => {
  for (const client of created.splice(0)) await client.auth.stopAutoRefresh();
  setUrl("/");
  clearCookies();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("auth browser client (supabase-browser.ts)", () => {
  // A PKCE code in the query string plus a code verifier in this browser:
  // exactly what a page would see if someone pointed the OAuth redirect at
  // a public page instead of /auth/callback.
  beforeEach(() => {
    setUrl("/?code=stolen-or-misrouted-code");
    document.cookie = `${STORAGE_KEY}-code-verifier=verifier-value; path=/`;
  });

  it("control: @supabase/ssr ignores detectSessionInUrl:false and exchanges the code", async () => {
    const { createBrowserClient } = await import("@supabase/ssr");
    const client = createBrowserClient(SUPABASE_URL, "anon-key", {
      isSingleton: false,
      auth: { detectSessionInUrl: false },
    });
    created.push(client);
    await client.auth.initialize();

    expect(authCalls().some((url) => url.includes("/token?grant_type=pkce"))).toBe(true);
  });

  it("getAuthBrowserClient never exchanges a code found in the URL", async () => {
    const { getAuthBrowserClient } = await import("@/lib/auth/supabase-browser");
    const client = getAuthBrowserClient();
    expect(client).not.toBeNull();
    created.push(client!);
    await client!.auth.initialize();

    expect(authCalls()).toEqual([]);
    expect((client!.auth as unknown as { detectSessionInUrl: unknown }).detectSessionInUrl).toBe(
      false
    );
    // The code is left alone for /auth/callback-style handling, not consumed.
    expect(window.location.search).toBe("?code=stolen-or-misrouted-code");
  });
});

describe("realtime client (realtime/supabase-client.ts)", () => {
  const plantedHash =
    "#access_token=attacker-jwt&refresh_token=attacker-refresh&expires_in=3600&token_type=bearer";

  it("control: a default supabase-js client adopts an access token from the URL hash", async () => {
    setUrl(`/${plantedHash}`);
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, "anon-key");
    created.push(client);
    await client.auth.initialize();

    // Implicit-flow detection validates the planted token against /user.
    expect(authCalls().some((url) => url.endsWith("/auth/v1/user"))).toBe(true);
  });

  it("getSupabaseClient ignores tokens in the URL", async () => {
    setUrl(`/${plantedHash}`);
    const { getSupabaseClient } = await import("@/lib/realtime/supabase-client");
    const client = getSupabaseClient();
    expect(client).not.toBeNull();
    created.push(client!);
    await client!.auth.initialize();

    expect(authCalls()).toEqual([]);
    const { data } = await client!.auth.getSession();
    expect(data.session).toBeNull();
  });

  it("getSupabaseClient ignores a session persisted in localStorage", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: "planted-jwt",
        refresh_token: "planted-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: expiresAt,
        user: { id: "someone-else", aud: "authenticated" },
      })
    );
    const { getSupabaseClient } = await import("@/lib/realtime/supabase-client");
    const client = getSupabaseClient();
    created.push(client!);
    await client!.auth.initialize();

    const { data } = await client!.auth.getSession();
    expect(data.session).toBeNull();
  });
});
