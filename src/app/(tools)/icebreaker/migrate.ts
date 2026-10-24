"use client";

import {
  migrateLegacyKeysNow,
  runLegacyKeyMigration,
  type LegacyKeyMigrationResult,
  type MigrateLegacyKeysOptions,
} from "@/lib/data/migrate-legacy-key";
import { normalizeFavorites, useIcebreakerSettings } from "./store";

/**
 * Moves the favourites the page kept in raw localStorage into the synced
 * settings store, once, through the crash-safe legacy-key move
 * (lib/data/migrate-legacy-key.ts): one write, then a `:migrated` backup,
 * then the old key goes.
 *
 * Two keys held them: the prefixed one, and an older unprefixed one that
 * the page moved on read only while the prefixed key was absent, so a
 * browser can still have both. Both are read; the ids fill gaps in the
 * favourites already there, so running it twice (a crash between the write
 * and the backup, two tabs) changes nothing the second time.
 */

export const FAVORITES_KEY = "agile-toolkit:icebreaker-favorites";
export const LEGACY_FAVORITES_KEY = "icebreaker-favorites";

/** `navigator.locks` name, so two tabs never move it at the same time. */
const LOCK = "agile-toolkit:icebreaker-migration";

export interface FavoritesMoveReport {
  /** Favourites the store didn't have. */
  added: number;
}

/** The ids in an old key's value: a JSON array of strings, anything else is none. */
function legacyIds(raw: string | undefined): unknown[] {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The favourites after the move, and how many it added. Pure. */
export function planFavoritesMove(
  raw: Readonly<Record<string, string>>,
  current: readonly string[]
): { next: string[]; report: FavoritesMoveReport } {
  const have = normalizeFavorites(current);
  const incoming = normalizeFavorites([
    ...legacyIds(raw[FAVORITES_KEY]),
    ...legacyIds(raw[LEGACY_FAVORITES_KEY]),
  ]).filter((id) => !have.includes(id));
  return { next: [...have, ...incoming], report: { added: incoming.length } };
}

function options(storage?: Storage): MigrateLegacyKeysOptions<FavoritesMoveReport> {
  return {
    keys: [FAVORITES_KEY, LEGACY_FAVORITES_KEY],
    storage,
    // The settings store, not the workspace, receives them: moving into a
    // store that hasn't loaded would write over what it holds.
    ready: () => useIcebreakerSettings.persist.hasHydrated(),
    move: (raw) => {
      const { next, report } = planFavoritesMove(
        raw,
        useIcebreakerSettings.getState().favorites ?? []
      );
      const wrote = report.added > 0;
      if (wrote) useIcebreakerSettings.setState({ favorites: next });
      return { wrote, report };
    },
  };
}

/** The move, synchronously (tests, and callers already holding the lock). */
export function migrateIcebreakerFavoritesNow(
  storage?: Storage
): LegacyKeyMigrationResult<FavoritesMoveReport> {
  return migrateLegacyKeysNow(options(storage));
}

/** The move under the cross-tab lock; the page runs it once the settings have loaded. */
export function runIcebreakerFavoritesMigration(
  storage?: Storage
): Promise<LegacyKeyMigrationResult<FavoritesMoveReport>> {
  return runLegacyKeyMigration(LOCK, options(storage));
}
