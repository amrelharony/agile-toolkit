/**
 * PAT-mint input hardening:
 *   - resolveRequestedExpiry — validates/normalises a requested expiry
 *   - consumeMintToken       — per-user mint rate ceiling
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveRequestedExpiry } from "@/lib/mcp/pat";
import {
  consumeMintToken,
  __resetMintRateLimit,
  MINT_RATE_LIMIT_PER_MIN,
} from "@/app/api/access-tokens/_rate-limit";

const NOW = Date.parse("2026-06-05T00:00:00.000Z");
const DAY = 86_400_000;
const OPTS = { defaultTtlDays: 90, maxTtlDays: 365 * 5 };

describe("resolveRequestedExpiry", () => {
  it("defaults an omitted value to now + defaultTtlDays", () => {
    for (const v of [undefined, null]) {
      const r = resolveRequestedExpiry(v, NOW, OPTS);
      expect(r.ok).toBe(true);
      if (r.ok) expect(Date.parse(r.iso)).toBe(NOW + 90 * DAY);
    }
  });

  it("accepts and normalises a valid future ISO string", () => {
    const wanted = new Date(NOW + 30 * DAY).toISOString();
    const r = resolveRequestedExpiry(wanted, NOW, OPTS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.iso).toBe(wanted);
  });

  it("rejects a non-string value", () => {
    for (const v of [123, {}, [], true]) {
      const r = resolveRequestedExpiry(v, NOW, OPTS);
      expect(r).toEqual({ ok: false, error: "invalid_expires_at" });
    }
  });

  it("rejects an unparseable string", () => {
    const r = resolveRequestedExpiry("not-a-date", NOW, OPTS);
    expect(r).toEqual({ ok: false, error: "invalid_expires_at" });
  });

  it("rejects a past-or-now date (no born-expired tokens)", () => {
    expect(resolveRequestedExpiry(new Date(NOW).toISOString(), NOW, OPTS)).toEqual({
      ok: false,
      error: "expires_at_in_past",
    });
    expect(resolveRequestedExpiry(new Date(NOW - DAY).toISOString(), NOW, OPTS)).toEqual({
      ok: false,
      error: "expires_at_in_past",
    });
  });

  it("rejects a date beyond the max-TTL ceiling", () => {
    const tooFar = new Date(NOW + (365 * 5 + 1) * DAY).toISOString();
    expect(resolveRequestedExpiry(tooFar, NOW, OPTS)).toEqual({
      ok: false,
      error: "expires_at_too_far",
    });
  });

  it("accepts exactly the ceiling", () => {
    const atCeiling = new Date(NOW + 365 * 5 * DAY).toISOString();
    const r = resolveRequestedExpiry(atCeiling, NOW, OPTS);
    expect(r.ok).toBe(true);
  });
});

describe("consumeMintToken", () => {
  afterEach(() => __resetMintRateLimit());

  it("allows up to the per-minute ceiling, then blocks", () => {
    let allowed = 0;
    for (let i = 0; i < MINT_RATE_LIMIT_PER_MIN + 5; i++) {
      if (consumeMintToken("user-a", NOW)) allowed++;
    }
    expect(allowed).toBe(MINT_RATE_LIMIT_PER_MIN);
    expect(consumeMintToken("user-a", NOW)).toBe(false);
  });

  it("scopes the bucket per user", () => {
    for (let i = 0; i < MINT_RATE_LIMIT_PER_MIN; i++) consumeMintToken("user-a", NOW);
    expect(consumeMintToken("user-a", NOW)).toBe(false);
    // A different user is unaffected.
    expect(consumeMintToken("user-b", NOW)).toBe(true);
  });

  it("refills after the window elapses", () => {
    for (let i = 0; i < MINT_RATE_LIMIT_PER_MIN; i++) consumeMintToken("user-a", NOW);
    expect(consumeMintToken("user-a", NOW)).toBe(false);
    // A full window later, the bucket is replenished.
    expect(consumeMintToken("user-a", NOW + 60_000)).toBe(true);
  });
});
