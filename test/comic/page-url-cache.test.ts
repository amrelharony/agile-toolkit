import { describe, it, expect, vi } from "vitest";
import {
  PageUrlCache,
  pageCacheKey,
  DEFAULT_PAGE_CACHE_CAPACITY,
} from "@/lib/comic/page-url-cache";

/**
 * LRU of rendered comic pages (blob URLs). Whatever it drops must be
 * revoked, and pages on screen must never be dropped.
 */

function setup(capacity = 3) {
  const revoke = vi.fn<(url: string) => void>();
  const cache = new PageUrlCache({ capacity, revoke });
  return { cache, revoke };
}

describe("PageUrlCache", () => {
  it("keys pages by page number and width bucket", () => {
    expect(pageCacheKey(3, 1280)).toBe("3@1280");
    expect(new PageUrlCache().capacity).toBe(DEFAULT_PAGE_CACHE_CAPACITY);
  });

  it("evicts the least recently used entry and revokes its URL", () => {
    const { cache, revoke } = setup();
    cache.set("1@512", "blob:1");
    cache.set("2@512", "blob:2");
    cache.set("3@512", "blob:3");
    expect(revoke).not.toHaveBeenCalled();
    cache.set("4@512", "blob:4");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:1");
    expect(cache.has("1@512")).toBe(false);
    expect(cache.size).toBe(3);
  });

  it("get() refreshes recency; peek() does not", () => {
    const { cache, revoke } = setup();
    cache.set("1@512", "blob:1");
    cache.set("2@512", "blob:2");
    cache.set("3@512", "blob:3");
    expect(cache.get("1@512")).toBe("blob:1");
    expect(cache.peek("2@512")).toBe("blob:2");
    cache.set("4@512", "blob:4");
    expect(revoke).toHaveBeenCalledWith("blob:2");
    expect(cache.has("1@512")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("never evicts pinned (visible) entries", () => {
    const { cache, revoke } = setup(2);
    cache.set("1@512", "blob:1");
    cache.set("2@512", "blob:2");
    cache.pin(["1@512"]);
    cache.set("3@512", "blob:3");
    expect(revoke).toHaveBeenCalledWith("blob:2");
    expect(cache.has("1@512")).toBe(true);
  });

  it("overflows rather than evict when everything is pinned", () => {
    const { cache, revoke } = setup(2);
    cache.set("1@512", "blob:1");
    cache.set("2@512", "blob:2");
    cache.pin(["1@512", "2@512", "3@512"]);
    cache.set("3@512", "blob:3");
    expect(revoke).not.toHaveBeenCalled();
    expect(cache.size).toBe(3);
    // Unpinning lets the cache shrink back, oldest first.
    cache.pin(["3@512"]);
    expect(revoke).toHaveBeenCalledWith("blob:1");
    expect(cache.size).toBe(2);
  });

  it("revokes a URL replaced under the same key", () => {
    const { cache, revoke } = setup();
    cache.set("1@512", "blob:a");
    cache.set("1@512", "blob:a");
    expect(revoke).not.toHaveBeenCalled();
    cache.set("1@512", "blob:b");
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(cache.get("1@512")).toBe("blob:b");
  });

  it("clear() revokes everything", () => {
    const { cache, revoke } = setup();
    cache.set("1@512", "blob:1");
    cache.set("2@512", "blob:2");
    cache.pin(["1@512"]);
    cache.clear();
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(["blob:1", "blob:2"]);
    expect(cache.size).toBe(0);
  });
});
