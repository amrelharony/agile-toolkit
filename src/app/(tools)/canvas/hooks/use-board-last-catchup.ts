"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "agile-toolkit:canvas:last-catchup";

interface Stored {
  [boardId: string]: number;
}

function load(): Stored {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Strip any non-number values — defensive against hand-edited storage.
    const out: Stored = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function save(state: Stored): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — accept loss */
  }
}

/**
 * Per-board "last time the user clicked Catch me up" timestamp,
 * stored in localStorage so it survives reloads but stays per-device.
 *
 * Default-on-first-use is `Date.now() - 7 days` so a brand-new
 * visitor sees the last week of activity rather than "nothing new"
 * (an empty value would otherwise return events from epoch 0).
 *
 * Returns `[lastCatchupAt, markCaughtUp]`:
 *   - `lastCatchupAt`: timestamp; events with `at > lastCatchupAt`
 *     are "new since last catch-up".
 *   - `markCaughtUp()`: writes `Date.now()` and advances the local
 *     state so the count resets to zero.
 */
export function useBoardLastCatchup(boardId: string): {
  lastCatchupAt: number;
  markCaughtUp: () => void;
} {
  const [lastCatchupAt, setLastCatchupAt] = useState<number>(() => {
    if (typeof window === "undefined") return Date.now();
    const all = load();
    return all[boardId] ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  });

  // Re-read on boardId change. Without this, switching boards keeps
  // showing the prior board's timestamp until the user clicks Catch
  // me up.
  useEffect(() => {
    const all = load();
    setLastCatchupAt(all[boardId] ?? Date.now() - 7 * 24 * 60 * 60 * 1000);
  }, [boardId]);

  const markCaughtUp = useCallback(() => {
    const now = Date.now();
    setLastCatchupAt(now);
    const all = load();
    all[boardId] = now;
    save(all);
  }, [boardId]);

  return { lastCatchupAt, markCaughtUp };
}
