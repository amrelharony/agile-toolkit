/**
 * What both public comics routes need before touching their body: a same-site
 * check and a per-instance rate limit.
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

/** x-real-ip is set by the fronting proxy; x-forwarded-for is only the fallback. */
function clientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  return (realIp || forwarded?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}

/** Fixed window per route and IP. True while the caller is within its budget. */
export function withinRateLimit(
  req: NextRequest,
  route: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  if (buckets.size > MAX_ENTRIES) {
    buckets.forEach((entry, key) => {
      if (now >= entry.expiresAt) buckets.delete(key);
    });
  }
  const key = `${route}:${clientIp(req)}`;
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
