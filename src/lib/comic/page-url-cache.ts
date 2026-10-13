/**
 * Small LRU of rendered comic pages, stored as blob: URLs keyed
 * `${page}@${widthBucket}`.
 *
 * Every blob URL pins its JPEG in memory until it is revoked, so the cache
 * is bounded and revokes whatever it drops. Pages on screen are pinned and
 * never evicted: an `<img>` whose blob URL was revoked breaks the next time
 * the browser re-decodes it (or when the crossfade remounts it). When every
 * entry is pinned the cache briefly holds more than its capacity rather
 * than break a visible page.
 */

export const DEFAULT_PAGE_CACHE_CAPACITY = 8;

export function pageCacheKey(page: number, bucket: number): string {
  return `${page}@${bucket}`;
}

function defaultRevoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Non-browser runtime or an already-revoked URL — nothing to free.
  }
}

export class PageUrlCache {
  readonly capacity: number;
  private readonly revoke: (url: string) => void;
  // Map iteration order is insertion order: first entry = least recent.
  private readonly entries = new Map<string, string>();
  private pinned = new Set<string>();

  constructor(opts: { capacity?: number; revoke?: (url: string) => void } = {}) {
    this.capacity = Math.max(1, Math.floor(opts.capacity ?? DEFAULT_PAGE_CACHE_CAPACITY));
    this.revoke = opts.revoke ?? defaultRevoke;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Look up a URL without touching its recency (safe during React render). */
  peek(key: string): string | undefined {
    return this.entries.get(key);
  }

  /** Look up a URL and mark it most recently used. */
  get(key: string): string | undefined {
    const url = this.entries.get(key);
    if (url === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, url);
    return url;
  }

  /** Store a URL as most recently used, revoking any URL it replaces. */
  set(key: string, url: string): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.entries.delete(key);
      if (previous !== url) this.revoke(previous);
    }
    this.entries.set(key, url);
    this.evict();
  }

  /** Replace the pinned set (the keys currently on screen). */
  pin(keys: Iterable<string>): void {
    this.pinned = new Set(keys);
    this.evict();
  }

  /** Revoke and drop everything (on unmount or a new document). */
  clear(): void {
    this.entries.forEach((url) => this.revoke(url));
    this.entries.clear();
    this.pinned.clear();
  }

  private evict(): void {
    if (this.entries.size <= this.capacity) return;
    for (const key of Array.from(this.entries.keys())) {
      if (this.entries.size <= this.capacity) break;
      if (this.pinned.has(key)) continue;
      const url = this.entries.get(key)!;
      this.entries.delete(key);
      this.revoke(url);
    }
  }
}
