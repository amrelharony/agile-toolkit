/**
 * A crash-safe, one-time move of old per-tool storage keys into the
 * workspace, extracted from the shared-sprints migration
 * (lib/sprints/migrate-legacy.ts) for the tools that move their storage
 * later. In order:
 *
 *   1. read the keys that are still there (none: nothing to do);
 *   2. wait for the workspace to have loaded: planning against an empty one
 *      would duplicate what it holds, and its write would overwrite the
 *      saved one, so until then every key is kept;
 *   3. `move` the raw values into the workspace, in one write;
 *   4. per key: copy it to `<key>:migrated` (or a timestamped name when
 *      that's taken), then remove it.
 *
 * A removed key is the done marker. A key that is still there (a crash, a
 * full storage, a workspace write that couldn't be saved) is moved again on
 * the next run, so `move` must only fill gaps: what already landed is a
 * no-op the second time, and two tabs or devices converge.
 *
 * `runLegacyKeyMigration` adds the cross-tab lock (`navigator.locks`) and
 * shares one run per lock within a tab.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useStorageHealth } from "@/lib/stores/storage-health";

export interface LegacyKeyMove<R> {
  /** Whether the workspace was written (false when everything was there already). */
  wrote: boolean;
  /** What the move did, for the caller's own summary. */
  report: R;
}

export interface MigrateLegacyKeysOptions<R> {
  /** The old keys, in the order they are read, backed up and removed. */
  keys: readonly string[];
  /**
   * Move the raw values (only the keys present) into the workspace in one
   * write, filling gaps only. Gets the storage too, for side keys of its own.
   */
  move: (raw: Readonly<Record<string, string>>, storage: Storage) => LegacyKeyMove<R>;
  /** Defaults to `window.localStorage`. */
  storage?: Storage;
  /** Clock for the backup-key suffix. */
  now?: () => number;
  /** Whether it's safe to move now. Defaults to "the workspace has loaded". */
  ready?: () => boolean;
  /** Whether the move's write was saved. Defaults to "no failed storage write". */
  saved?: () => boolean;
}

export interface LegacyKeyMigrationResult<R> {
  /** Null when nothing was moved (no old keys, storage blocked, not ready). */
  report: R | null;
  /** Old keys backed up and removed. */
  removed: string[];
  /** Old keys left in place, moved again on the next run. */
  kept: string[];
  /** Where each removed key's backup went. */
  backups: Record<string, string>;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Copy `raw` to `<key>:migrated`, or `<key>:migrated:<time>` when that is
 * taken (an earlier backup stays). Returns the backup's key, or null when
 * the storage refused (full or blocked): then the original must stay.
 */
export function backUpLegacyKey(
  storage: Storage,
  key: string,
  raw: string,
  now: number
): string | null {
  try {
    let name = `${key}:migrated`;
    if (storage.getItem(name) !== null) {
      let t = now;
      name = `${key}:migrated:${t}`;
      while (storage.getItem(name) !== null) name = `${key}:migrated:${++t}`;
    }
    storage.setItem(name, raw);
    return name;
  } catch {
    return null;
  }
}

/** The whole move, synchronously, against the workspace as it is right now. */
export function migrateLegacyKeysNow<R>(
  options: MigrateLegacyKeysOptions<R>
): LegacyKeyMigrationResult<R> {
  const result: LegacyKeyMigrationResult<R> = { report: null, removed: [], kept: [], backups: {} };
  const storage = options.storage ?? defaultStorage();
  if (!storage) return result;

  // No prototype, so a key can't collide with an inherited name.
  const raw: Record<string, string> = Object.create(null);
  const present: string[] = [];
  try {
    for (const key of options.keys) {
      const value = storage.getItem(key);
      if (value === null || key in raw) continue;
      raw[key] = value;
      present.push(key);
    }
  } catch {
    return result;
  }
  if (present.length === 0) return result;

  const ready = options.ready ?? (() => useWorkspaceStore.persist.hasHydrated());
  if (!ready()) {
    result.kept = present;
    return result;
  }

  // 1. One write.
  const { wrote, report } = options.move(raw, storage);
  result.report = report;

  // If the workspace couldn't be saved, it holds the moved data in memory
  // only: keep the old keys so the next run moves them again.
  const saved = options.saved ?? (() => !useStorageHealth.getState().writeFailed);
  const keep = wrote && !saved();

  // 2-3. Per key: back up, then remove.
  const now = options.now ?? Date.now;
  for (const key of present) {
    const backup = keep ? null : backUpLegacyKey(storage, key, raw[key], now());
    if (!backup) {
      result.kept.push(key);
      continue;
    }
    try {
      storage.removeItem(key);
      result.removed.push(key);
      result.backups[key] = backup;
    } catch {
      result.kept.push(key);
    }
  }
  return result;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `task` once at a time per `lock`: across tabs under `navigator.locks`
 * where the browser has it, and within the tab by sharing the run already
 * going. A task that re-reads its keys inside finds them gone after another
 * tab's run, and does nothing.
 */
export function runExclusive<T>(lock: string, task: () => T): Promise<T> {
  const running = inFlight.get(lock) as Promise<T> | undefined;
  if (running) return running;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const started: Promise<T> =
    locks && typeof locks.request === "function"
      ? Promise.resolve(locks.request(lock, task) as Promise<T>)
      : Promise.resolve().then(task);
  const shared = started.finally(() => {
    inFlight.delete(lock);
  });
  inFlight.set(lock, shared);
  return shared;
}

/** `migrateLegacyKeysNow` under `runExclusive(lock)`. */
export function runLegacyKeyMigration<R>(
  lock: string,
  options: MigrateLegacyKeysOptions<R>
): Promise<LegacyKeyMigrationResult<R>> {
  return runExclusive(lock, () => migrateLegacyKeysNow(options));
}
