/**
 * What the public routes (the comics' beacon and forms, and Amr's AI for
 * visitors) need before touching their body: a same-site check, a per-instance
 * rate limit, and the caller's address.
 *
 * In memory, like the guest routes (api/guest/_rate-limit.ts): the real ceiling
 * is limit x instances, which is enough to stop a script hammering one route
 * and worth no extra dependency. The address itself is never kept, not even
 * here: the map's keys hold a hash of it with a salt that lives and dies with
 * the instance, and an entry is swept within a minute of its window ending.
 * Nothing is written anywhere.
 */

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

const MAX_ENTRIES = 2_000;
const SWEEP_EVERY_MS = 60_000;
const SALT = randomBytes(16).toString("hex");
const buckets = new Map<string, { count: number; expiresAt: number }>();
let lastSweep = 0;

/** A stand-in for the address (or its bucket) that can't be turned back into it. */
function anonymous(ip: string): string {
  return createHash("sha256").update(SALT).update(ip).digest("base64url").slice(0, 22);
}

/**
 * The caller's address, or null when the request carries none. x-real-ip is
 * set by the fronting proxy; x-forwarded-for is only the fallback.
 */
export function clientIpOrNull(req: NextRequest): string | null {
  const realIp = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = realIp || forwarded?.split(",")[0]?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/** The caller's address, with every address-less request sharing "unknown". */
export function clientIp(req: NextRequest): string {
  return clientIpOrNull(req) ?? "unknown";
}

/**
 * Fixed window per route and IP. True while the caller is within its budget.
 *
 * `bucketOf` groups addresses that belong to one caller, so they share one
 * budget: the visitor AI route passes ipBucket (visitor-key.ts), which puts a
 * whole IPv6 /64 in one bucket, since a host with a /64 can send each request
 * from a new address. null from it (an address it can't read) keeps the
 * address as it is.
 */
export function withinRateLimit(
  req: NextRequest,
  route: string,
  limit: number,
  windowMs: number,
  bucketOf?: (ip: string) => string | null
): boolean {
  const now = Date.now();
  if (buckets.size > MAX_ENTRIES || now - lastSweep >= SWEEP_EVERY_MS) {
    lastSweep = now;
    buckets.forEach((entry, key) => {
      if (now >= entry.expiresAt) buckets.delete(key);
    });
  }
  const ip = clientIp(req);
  const bucket = (bucketOf && ip !== "unknown" ? bucketOf(ip) : null) ?? ip;
  const key = `${route}:${anonymous(bucket)}`;
  const entry = buckets.get(key);
  if (!entry || now >= entry.expiresAt) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/** Whether the Origin header names this site. A missing header is not a match. */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
