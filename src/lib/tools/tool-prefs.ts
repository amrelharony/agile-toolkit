"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useCloudPersisted } from "@/lib/sync/use-cloud-persisted";
import { getToolByPath } from "@/lib/constants/tools";
import { readVipHint } from "@/lib/vip/hint";

export interface RecentToolEntry {
  id: string;
  usedAt: number;
}

export interface ToolPrefs {
  favorites: string[];
  recent: RecentToolEntry[];
  /** List the "More tools" shelf in navigation and search (lib/tools/catalog). */
  showAllTools?: boolean;
}

const STORAGE_KEY = "agile-toolkit:tool-prefs:v1";
const RECENT_LIMIT = 8;

const EMPTY: ToolPrefs = { favorites: [], recent: [] };

/** A stored blob with every field in a usable shape (older blobs lack some). */
function normalize(prev: ToolPrefs | undefined): Required<ToolPrefs> {
  const base = prev ?? EMPTY;
  return {
    favorites: Array.isArray(base.favorites) ? base.favorites : [],
    recent: Array.isArray(base.recent) ? base.recent : [],
    showAllTools: base.showAllTools === true,
  };
}

export interface ToolPrefsAPI {
  favorites: string[];
  recent: RecentToolEntry[];
  showAllTools: boolean;
  isFavorite: (toolId: string) => boolean;
  toggleFavorite: (toolId: string) => void;
  recordUse: (toolId: string) => void;
  setShowAllTools: (on: boolean) => void;
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
  const showAllTools = prefs?.showAllTools === true;

  const isFavorite = useCallback((toolId: string) => favorites.includes(toolId), [favorites]);

  const toggleFavorite = useCallback(
    (toolId: string) => {
      setPrefs((prev) => {
        const base = normalize(prev);
        const next = base.favorites.includes(toolId)
          ? base.favorites.filter((id) => id !== toolId)
          : [...base.favorites, toolId];
        return { ...base, favorites: next };
      });
    },
    [setPrefs]
  );

  const recordUse = useCallback(
    (toolId: string) => {
      const now = Date.now();
      setPrefs((prev) => {
        const base = normalize(prev);
        const filtered = base.recent.filter((r) => r.id !== toolId);
        return {
          ...base,
          recent: [{ id: toolId, usedAt: now }, ...filtered].slice(0, RECENT_LIMIT),
        };
      });
    },
    [setPrefs]
  );

  const setShowAllTools = useCallback(
    (on: boolean) => {
      setPrefs((prev) => ({ ...normalize(prev), showAllTools: on }));
    },
    [setPrefs]
  );

  return useMemo(
    () => ({
      favorites,
      recent,
      showAllTools,
      isFavorite,
      toggleFavorite,
      recordUse,
      setShowAllTools,
    }),
    [favorites, recent, showAllTools, isFavorite, toggleFavorite, recordUse, setShowAllTools]
  );
}

/**
 * Headless tracker — mounts once at the app shell, listens for pathname
 * changes, and records the matching tool in the user's recent list.
 * Non-tool routes (/, /history, /insights, /auth, /not-authorized) are
 * skipped because getToolByPath returns undefined for them. So is a VIP tool's
 * page without the hint: seeing its lock panel isn't using the tool.
 */
export function RecentToolTracker(): null {
  const pathname = usePathname();
  const { recordUse } = useToolPrefs();

  useEffect(() => {
    if (!pathname) return;
    const tool = getToolByPath(pathname);
    if (tool && (tool.access !== "vip" || readVipHint())) recordUse(tool.id);
  }, [pathname, recordUse]);

  return null;
}
