"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useCloudPersisted } from "@/lib/sync/use-cloud-persisted";
import { getToolByPath } from "@/lib/constants/tools";

export interface RecentToolEntry {
  id: string;
  usedAt: number;
}

export interface ToolPrefs {
  favorites: string[];
  recent: RecentToolEntry[];
}

const STORAGE_KEY = "agile-toolkit:tool-prefs:v1";
const RECENT_LIMIT = 5;

const EMPTY: ToolPrefs = { favorites: [], recent: [] };

export interface ToolPrefsAPI {
  favorites: string[];
  recent: RecentToolEntry[];
  isFavorite: (toolId: string) => boolean;
  toggleFavorite: (toolId: string) => void;
  recordUse: (toolId: string) => void;
}

export function useToolPrefs(): ToolPrefsAPI {
  const [prefs, setPrefs] = useCloudPersisted<ToolPrefs>(STORAGE_KEY, EMPTY);

  // Memo the array fallbacks so React's useCallback/useMemo dependency
  // arrays stay stable across renders when the blob is unchanged — without
  // this, every render produces fresh `[]` literals and busts memoization
  // for every consumer (sidebar list, ToolCard star state, etc.).
  const favorites = useMemo<string[]>(
    () => (Array.isArray(prefs?.favorites) ? prefs.favorites : []),
    [prefs?.favorites]
  );
  const recent = useMemo<RecentToolEntry[]>(
    () => (Array.isArray(prefs?.recent) ? prefs.recent : []),
    [prefs?.recent]
  );

  const isFavorite = useCallback((toolId: string) => favorites.includes(toolId), [favorites]);

  const toggleFavorite = useCallback(
    (toolId: string) => {
      setPrefs((prev) => {
        const base = prev ?? EMPTY;
        const list = Array.isArray(base.favorites) ? base.favorites : [];
        const next = list.includes(toolId) ? list.filter((id) => id !== toolId) : [...list, toolId];
        return {
          favorites: next,
          recent: Array.isArray(base.recent) ? base.recent : [],
        };
      });
    },
    [setPrefs]
  );

  const recordUse = useCallback(
    (toolId: string) => {
      const now = Date.now();
      setPrefs((prev) => {
        const base = prev ?? EMPTY;
        const list = Array.isArray(base.recent) ? base.recent : [];
        const filtered = list.filter((r) => r.id !== toolId);
        const next = [{ id: toolId, usedAt: now }, ...filtered].slice(0, RECENT_LIMIT);
        return {
          favorites: Array.isArray(base.favorites) ? base.favorites : [],
          recent: next,
        };
      });
    },
    [setPrefs]
  );

  return useMemo(
    () => ({ favorites, recent, isFavorite, toggleFavorite, recordUse }),
    [favorites, recent, isFavorite, toggleFavorite, recordUse]
  );
}

/**
 * Headless tracker — mounts once at the app shell, listens for pathname
 * changes, and records the matching tool in the user's recent list.
 * Non-tool routes (/, /history, /insights, /auth, /not-authorized) are
 * skipped because getToolByPath returns undefined for them.
 */
export function RecentToolTracker(): null {
  const pathname = usePathname();
  const { recordUse } = useToolPrefs();

  useEffect(() => {
    if (!pathname) return;
    const tool = getToolByPath(pathname);
    if (tool) recordUse(tool.id);
  }, [pathname, recordUse]);

  return null;
}
