/**
 * What the public routes (the comics' beacon and forms, and Amr's AI for
 * visitors) need before touching their body: a same-site check, a per-instance
 * rate limit, and the caller's address.
 *
 * In memory, like the guest routes (api/guest/_rate-limit.ts): the real ceiling
 * is limit x instances, which is enough to stop a script hammering one route
 * and worth no extra dependency. The IP is only a key in this map, for the
 * length of the window. It is never written anywhere.
 */

import "server-only";
import type { NextRequest } from "next/server";

const MAX_ENTRIES = 2_000;
const buckets = new Map<string, { count: number; expiresAt: number }>();

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
  if (buckets.size > MAX_ENTRIES) {
    buckets.forEach((entry, key) => {
      if (now >= entry.expiresAt) buckets.delete(key);
    });
  }
  const ip = clientIp(req);
  const key = `${route}:${(bucketOf && ip !== "unknown" ? bucketOf(ip) : null) ?? ip}`;
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
