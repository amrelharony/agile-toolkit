"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePersisted } from "@/lib/utils/use-persisted";
import {
  EMPTY_PREMORTEM_STATE,
  PREMORTEM_KEY,
  normalizePremortemState,
  pickPremortem,
  type Premortem,
  type PremortemState,
} from "./model";

/** `?premortem=<id>` opens that premortem. */
export const PREMORTEM_PARAM = "premortem";

/** `?premortem=` from a query string, or null. */
export function readPremortemParam(search: string): string | null {
  const v = new URLSearchParams(search).get(PREMORTEM_PARAM);
  return v && v.length <= 128 ? v : null;
}

/** A link to one premortem. */
export function premortemHref(id: string): string {
  return `/premortem?${PREMORTEM_PARAM}=${encodeURIComponent(id)}`;
}

export interface Premortems {
  state: PremortemState;
  /** Change the stored state; `change` always sees the current shape. */
  update: (change: (s: PremortemState) => PremortemState) => void;
  selected: Premortem | undefined;
  /** Open a premortem here, and keep the address bar pointing at it. */
  select: (id: string) => void;
}

/**
 * The premortems, read through the normalizer, and which one is open.
 *
 * The blob keeps whatever shape was last written (an old client's single
 * premortem, a newer one's list): every read normalizes it, and every
 * write starts from the normalized state, so the first edit is what
 * stores the current shape and nothing is lost before then.
 *
 * Which premortem is open lives in the URL (`?premortem=`), not in the
 * synced blob: two people on two screens can look at different ones.
 */
export function usePremortems(): Premortems {
  const [raw, setRaw] = usePersisted<unknown>(PREMORTEM_KEY, EMPTY_PREMORTEM_STATE);
  const state = useMemo(() => normalizePremortemState(raw), [raw]);
  const update = useCallback(
    (change: (s: PremortemState) => PremortemState) =>
      setRaw((prev: unknown) => {
        const current = normalizePremortemState(prev);
        const next = change(current);
        // Unchanged: hand back what was stored, so nothing is written.
        return next === current ? prev : next;
      }),
    [setRaw]
  );

  const [chosenId, setChosenId] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = readPremortemParam(window.location.search);
    if (fromUrl) setChosenId(fromUrl);
  }, []);

  const select = useCallback((id: string) => {
    setChosenId(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(PREMORTEM_PARAM, id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* no history API: the choice still applies on this page */
    }
  }, []);

  const selected = useMemo(() => pickPremortem(state.premortems, chosenId), [state, chosenId]);
  return { state, update, selected, select };
}
