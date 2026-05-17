"use client";

import { useMemo } from "react";
import { subscribeSignals, type SignalKind } from "./signal-bus";
import { INVALIDATION_MATRIX } from "./invalidation";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_CAP = 200;
const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, CacheEntry<unknown>>();

// FNV-1a hash on a JSON-stable projection of dependency values. Compact
// and fast for the small dep arrays used by tools (typically <10 entries).
//
// R5: `JSON.stringify` does NOT canonicalize object key order, so
// `{a:1,b:2}` and `{b:2,a:1}` hashed to different keys → cache misses
// on logically-equal deps and unbounded cache growth from key-reshuffled
// dep objects. Pre-sort plain-object keys via the replacer so the
// serialised projection is deterministic.
function stableHash(deps: unknown[]): string {
  const json = JSON.stringify(deps, (_, v) => {
    if (typeof v === "function") return "[fn]";
    if (v instanceof Date) return v.toISOString();
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
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
  // Maps preserve insertion order; we re-insert on every cache hit
  // (delete+set in `deriveCached`), so the front of the iterator is the
  // least-recently-used. Snapshot the keys (deleting while iterating an
  // active Map iterator is safe in spec, but the project's tsconfig target
  // is conservative — Array.from costs an array allocation but no sort).
  const toEvict = cache.size - CACHE_CAP;
  const keys = Array.from(cache.keys());
  for (let i = 0; i < toEvict; i++) {
    cache.delete(keys[i]);
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
    // Move to back of insertion order so it becomes the most-recently-used;
    // eviction walks the front (oldest) entries.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value as T;
  }
  // If we hit an expired entry, remove it before reinsert so the new entry
  // lands at the back of the iteration order, not in the original (older)
  // slot which would defeat LRU.
  if (hit) cache.delete(key);
  const value = compute();
  cache.set(key, { value, expiresAt: now + ttlMs });
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
  // R5: passing `deps` directly defeats the cache for any caller whose
  // dep is an object/array (referential identity changes every render →
  // useMemo recomputes → defeats cache). Use the stable hash as the
  // single memo dep so identity-stable structural equality wins.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => deriveCached(prefix, deps, compute, ttlMs), [prefix, stableHash(deps), ttlMs]);
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
