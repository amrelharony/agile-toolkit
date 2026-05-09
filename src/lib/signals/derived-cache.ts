"use client";

import { useMemo } from "react";
import { subscribeSignals, type SignalKind } from "./signal-bus";
import { INVALIDATION_MATRIX } from "./invalidation";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  // For LRU eviction: bump on read.
  lastTouched: number;
}

const CACHE_CAP = 200;
const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, CacheEntry<unknown>>();

// FNV-1a hash on a JSON-stable projection of dependency values. Compact
// and fast for the small dep arrays used by tools (typically <10 entries).
function stableHash(deps: unknown[]): string {
  const json = JSON.stringify(deps, (_, v) => {
    if (typeof v === "function") return "[fn]";
    if (v instanceof Date) return v.toISOString();
    return v;
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function makeKey(prefix: string, deps: unknown[]): string {
  return `${prefix}:${stableHash(deps)}`;
}

function evictIfNeeded(): void {
  if (cache.size <= CACHE_CAP) return;
  // Evict the 10% least-recently-touched entries in one pass.
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].lastTouched - b[1].lastTouched);
  const toEvict = Math.ceil(CACHE_CAP * 0.1);
  for (let i = 0; i < toEvict && i < entries.length; i++) {
    cache.delete(entries[i][0]);
  }
}

/**
 * Pure-function derived-value cache keyed by a stable hash of `deps`.
 * Re-uses the cached value if not expired AND deps hash matches.
 *
 * Invalidation happens by signal-kind (see `invalidation.ts`); the TTL is
 * a fallback so stale entries don't stick around forever in tools that
 * don't emit relevant signals.
 *
 * @param prefix     cache namespace (matched against INVALIDATION_MATRIX)
 * @param deps       dependency values; same JSON ⇒ cache hit
 * @param compute    expensive function to memoise
 * @param ttlMs      time to live, default 60s
 */
export function deriveCached<T>(
  prefix: string,
  deps: unknown[],
  compute: () => T,
  ttlMs = DEFAULT_TTL_MS
): T {
  const key = makeKey(prefix, deps);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    hit.lastTouched = now;
    return hit.value as T;
  }
  const value = compute();
  cache.set(key, { value, expiresAt: now + ttlMs, lastTouched: now });
  evictIfNeeded();
  return value;
}

/**
 * React hook variant. Combines `useMemo` (for the dep array's identity)
 * with the cross-render `deriveCached`.
 */
export function useDerived<T>(
  prefix: string,
  deps: unknown[],
  compute: () => T,
  ttlMs = DEFAULT_TTL_MS
): T {
  // useMemo's deps + deriveCached's hash both keep us reactive without
  // recomputing every render.
  return useMemo(() => deriveCached(prefix, deps, compute, ttlMs), deps);
}

/**
 * Invalidate cache entries whose key starts with `prefix`. Pass no prefix
 * to clear the whole cache (used by workspace reset).
 */
export function invalidateDerivedCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return; }
  // Strip an optional trailing wildcard.
  const normalised = prefix.endsWith("*") ? prefix.slice(0, -1) : prefix;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(normalised)) cache.delete(key);
  }
}

/**
 * Wire signal kinds to automatic invalidation. Call once at app boot
 * (from signal-bridge.ts).
 */
export function bindCacheInvalidation(): () => void {
  const allKinds = Object.keys(INVALIDATION_MATRIX) as SignalKind[];
  return subscribeSignals(allKinds, (s) => {
    const prefixes = INVALIDATION_MATRIX[s.kind];
    if (!prefixes) return;
    for (const p of prefixes) invalidateDerivedCache(p);
  });
}

/** Test-only / workspace-reset helper. */
export function __resetDerivedCache(): void {
  cache.clear();
}

/** Inspector for the future debug page. */
export function derivedCacheStats(): { size: number; capacity: number } {
  return { size: cache.size, capacity: CACHE_CAP };
}
