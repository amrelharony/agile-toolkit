/**
 * The generic crash-safe move of old storage keys: one write, then a
 * `<key>:migrated` backup, then the key's removal, in that order; nothing
 * before the workspace has loaded; every failure keeps the key for the next
 * run; and a second run is a no-op. Plus the cross-tab lock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backUpLegacyKey,
  migrateLegacyKeysNow,
  runExclusive,
  runLegacyKeyMigration,
  type MigrateLegacyKeysOptions,
} from "@/lib/data/migrate-legacy-key";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useStorageHealth } from "@/lib/stores/storage-health";

const A = "agile-toolkit:old-a";
const B = "agile-toolkit:old-b";

/** A move that copies each raw value into the workspace's decisions, filling gaps only. */
function decisionsMove(): MigrateLegacyKeysOptions<{ moved: string[] }>["move"] {
  return (raw) => {
    const have = new Set(useWorkspaceStore.getState().decisions.map((d) => d.id));
    const rows = Object.entries(raw)
      .filter(([key]) => !have.has(key))
      .map(([key, value]) => ({
        id: key,
        title: value,
        decision: "",
        status: "proposed" as const,
        date: "2026-10-23",
      }));
    if (rows.length > 0) {
      useWorkspaceStore.setState((s) => ({ decisions: [...s.decisions, ...rows] }));
    }
    return { wrote: rows.length > 0, report: { moved: rows.map((r) => r.id) } };
  };
}

const opts = (over: Partial<MigrateLegacyKeysOptions<{ moved: string[] }>> = {}) => ({
  keys: [A, B],
  move: decisionsMove(),
  ready: () => true,
  ...over,
});

/** A storage whose chosen calls throw, wrapped around localStorage. */
function failing(fail: {
  getItem?: boolean;
  setItem?: (k: string) => boolean;
  removeItem?: boolean;
}) {
  return new Proxy(localStorage, {
    get(target, prop) {
      if (prop === "getItem" && fail.getItem) {
        return () => {
          throw new DOMException("blocked", "SecurityError");
        };
      }
      if (prop === "setItem" && fail.setItem) {
        return (k: string, v: string) => {
          if (fail.setItem!(k)) throw new DOMException("full", "QuotaExceededError");
          target.setItem(k, v);
        };
      }
      if (prop === "removeItem" && fail.removeItem) {
        return () => {
          throw new DOMException("blocked", "SecurityError");
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ decisions: [] });
  useStorageHealth.setState({ writeFailed: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("migrateLegacyKeysNow", () => {
  it("moves, backs up and removes each key present, in order", () => {
    localStorage.setItem(A, "first");
    localStorage.setItem(B, "second");
    const result = migrateLegacyKeysNow(opts());
    expect(result.report).toEqual({ moved: [A, B] });
    expect(result.removed).toEqual([A, B]);
    expect(result.kept).toEqual([]);
    expect(result.backups).toEqual({ [A]: `${A}:migrated`, [B]: `${B}:migrated` });
    expect(localStorage.getItem(A)).toBeNull();
    expect(localStorage.getItem(`${A}:migrated`)).toBe("first");
    expect(useWorkspaceStore.getState().decisions.map((d) => d.title)).toEqual(["first", "second"]);
  });

  it("only passes the keys that are there, once each", () => {
    localStorage.setItem(B, "only");
    const move = vi.fn(decisionsMove());
    migrateLegacyKeysNow(opts({ keys: [A, B, B], move }));
    expect(move).toHaveBeenCalledTimes(1);
    expect({ ...move.mock.calls[0][0] }).toEqual({ [B]: "only" });
  });

  it("is a no-op the second time", () => {
    localStorage.setItem(A, "first");
    migrateLegacyKeysNow(opts());
    const before = useWorkspaceStore.getState().decisions;
    const move = vi.fn(decisionsMove());
    const second = migrateLegacyKeysNow(opts({ move }));
    expect(second).toEqual({ report: null, removed: [], kept: [], backups: {} });
    expect(move).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().decisions).toBe(before);
    expect(localStorage.getItem(`${A}:migrated`)).toBe("first");
  });

  it("does nothing before the workspace has loaded, keeping every key", () => {
    localStorage.setItem(A, "first");
    const move = vi.fn(decisionsMove());
    const result = migrateLegacyKeysNow(opts({ ready: () => false, move }));
    expect(move).not.toHaveBeenCalled();
    expect(result.kept).toEqual([A]);
    expect(localStorage.getItem(A)).toBe("first");
  });

  it("waits for the workspace store's own hydration by default", () => {
    localStorage.setItem(A, "first");
    vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(false);
    const result = migrateLegacyKeysNow({ keys: [A], move: decisionsMove() });
    expect(result.kept).toEqual([A]);
  });

  it("keeps the keys when the write couldn't be saved, and the next run finishes without writing", () => {
    localStorage.setItem(A, "first");
    useStorageHealth.setState({ writeFailed: true });
    const first = migrateLegacyKeysNow(opts({ saved: undefined }));
    expect(first.kept).toEqual([A]);
    expect(localStorage.getItem(A)).toBe("first");

    useStorageHealth.setState({ writeFailed: false });
    const move = decisionsMove();
    let wrote = true;
    const second = migrateLegacyKeysNow(
      opts({
        move: (raw, storage) => {
          const out = move(raw, storage);
          wrote = out.wrote;
          return out;
        },
      })
    );
    expect(wrote).toBe(false);
    expect(second.removed).toEqual([A]);
    expect(useWorkspaceStore.getState().decisions).toHaveLength(1);
  });

  it("keeps a key whose backup the storage refuses", () => {
    localStorage.setItem(A, "first");
    localStorage.setItem(B, "second");
    const storage = failing({ setItem: (k) => k === `${A}:migrated` });
    const result = migrateLegacyKeysNow(opts({ storage }));
    expect(result.kept).toEqual([A]);
    expect(result.removed).toEqual([B]);
    expect(localStorage.getItem(A)).toBe("first");
  });

  it("keeps a key the storage won't remove (its backup is already there)", () => {
    localStorage.setItem(A, "first");
    const result = migrateLegacyKeysNow(opts({ storage: failing({ removeItem: true }) }));
    expect(result.kept).toEqual([A]);
    expect(result.backups).toEqual({});
    expect(localStorage.getItem(`${A}:migrated`)).toBe("first");
    // Next time it finishes, and the second backup is timestamped.
    const next = migrateLegacyKeysNow(opts({ now: () => 42 }));
    expect(next.backups[A]).toBe(`${A}:migrated:42`);
  });

  it("does nothing when the storage can't be read", () => {
    const move = vi.fn(decisionsMove());
    const result = migrateLegacyKeysNow(opts({ storage: failing({ getItem: true }), move }));
    expect(result).toEqual({ report: null, removed: [], kept: [], backups: {} });
    expect(move).not.toHaveBeenCalled();
  });

  it("moves a huge value, and keeps one whose backup no longer fits", () => {
    // The move reads the value without copying it into the workspace.
    const move = (raw: Readonly<Record<string, string>>) => ({
      wrote: false,
      report: { moved: Object.keys(raw) },
    });
    const big = "x".repeat(1_500_000);
    localStorage.setItem(A, big);
    expect(migrateLegacyKeysNow(opts({ keys: [A], move })).removed).toEqual([A]);
    expect(localStorage.getItem(`${A}:migrated`)).toHaveLength(big.length);

    // jsdom's storage holds about 5 MB: a 3 MB key has no room for its copy.
    localStorage.clear();
    localStorage.setItem(B, "y".repeat(3_000_000));
    const result = migrateLegacyKeysNow(opts({ keys: [B], move }));
    expect(result.kept).toEqual([B]);
    expect(localStorage.getItem(B)).toHaveLength(3_000_000);
  });
});

describe("backUpLegacyKey", () => {
  it("keeps every earlier backup", () => {
    localStorage.setItem(`${A}:migrated`, "one");
    localStorage.setItem(`${A}:migrated:100`, "two");
    expect(backUpLegacyKey(localStorage, A, "three", 100)).toBe(`${A}:migrated:101`);
    expect(localStorage.getItem(`${A}:migrated`)).toBe("one");
    expect(localStorage.getItem(`${A}:migrated:100`)).toBe("two");
    expect(localStorage.getItem(`${A}:migrated:101`)).toBe("three");
  });

  it("is null when the storage is full", () => {
    expect(backUpLegacyKey(failing({ setItem: () => true }), A, "v", 1)).toBeNull();
  });
});

describe("runExclusive / runLegacyKeyMigration", () => {
  it("holds the cross-tab lock when the browser has one", async () => {
    localStorage.setItem(A, "first");
    const request = vi.fn((_name: string, cb: () => unknown) => Promise.resolve(cb()));
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    const result = await runLegacyKeyMigration("agile-toolkit:test-lock", opts());
    expect(request).toHaveBeenCalledWith("agile-toolkit:test-lock", expect.any(Function));
    expect(result.removed).toEqual([A]);
  });

  it("shares a run already going under the same lock, not another", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const task = vi.fn(async () => {
      await gate;
      return "done";
    });
    const one = runExclusive("lock-x", task);
    const two = runExclusive("lock-x", task);
    const other = runExclusive("lock-y", async () => "other");
    expect(two).toBe(one);
    release();
    expect(await one).toBe("done");
    expect(await other).toBe("other");
    expect(task).toHaveBeenCalledTimes(1);
    // Finished: the next call runs again.
    await runExclusive("lock-x", task);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
