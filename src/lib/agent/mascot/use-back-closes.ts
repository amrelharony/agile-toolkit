/**
 * The phone's Back closes Amr's full-height sheet (design §1.3 item 9 "Back",
 * audit critic2-2), as Back dismisses any sheet that fills the screen. Only in
 * the sheet layout: the floating card and the side panel leave the page in
 * view, so Back stays the page's there.
 *
 * Where the browser has a CloseWatcher (Chrome, Edge, Android's Back), one is
 * created while the sheet is open, and a second one on top while History
 * shows, so Back leaves History first and closes the sheet next. No history
 * entry is added: a link followed from the sheet pushes its page as usual.
 * The watcher hears Escape too, but only one nothing else took: the panel's
 * own Escape (deny a card, leave History, close) calls preventDefault, and a
 * prevented Escape never reaches a watcher.
 *
 * Elsewhere (Safari, older browsers) a marker entry is pushed as the sheet
 * opens, at the same address, its state Next's own plus `amrPanel`, so the
 * app router still knows the entry. Back leaves the marker (a popstate) and
 * the sheet closes. While it is open:
 *   - The address may change under it: a sprint picked, a tool's query kept
 *     in sync (replaceState). No event says so, so it is checked every
 *     URL_CHECK_MS. Such a change re-flags the marker (replaceUrl() writes a
 *     null state, which drops the flag), and the newest address is kept: Back
 *     returns to the entry under the marker, which still has the old one, so
 *     the newest is put back with replaceUrl() (on-search-params). Only a
 *     change of query or hash: replaceUrl() can't load another page.
 *   - A page pushed over the marker (or one that took its place) leaves the
 *     marker behind: it is no longer the newest entry, and a fresh marker
 *     goes over the new page while the sheet stays open.
 *   - `replaceOnNavigate` is true only while the marker is the newest entry,
 *     so a link followed from the sheet replaces it instead of stacking on it.
 * Closing:
 *   - by Back: the marker has gone already;
 *   - by a link ("navigate"): its page replaced the marker, or went over it;
 *     history.back() would undo the navigation, so nothing is called;
 *   - any other way (Close, Escape, Amr tapped, Ctrl/Cmd+J, another surface):
 *     history.back() exactly once, if the marker is still the newest entry,
 *     and the newest address is put back as for Back.
 *
 * No router: Next's own popstate handling restores the entry, and
 * replaceUrl() keeps the app router in step (wave T's link coverage pins who
 * holds useRouter()).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { replaceUrl } from "@/components/shared/on-search-params";
import type { PanelCloseReason } from "./use-panel-focus";

/** The key the marker entry's history state carries (its value is the marker's token). */
export const BACK_MARKER = "amrPanel";

/** How often an open sheet's address is checked for a change (no event says so). */
export const URL_CHECK_MS = 250;

/** How long a close waits for its own history.back() to land before letting the marker go. */
export const OWN_BACK_WAIT_MS = 1000;

/** The part of CloseWatcher used here (TypeScript's DOM types don't have it yet). */
interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null;
  destroy(): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

/** The browser's CloseWatcher, or null where there is none. */
function closeWatcherCtor(): CloseWatcherCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as Window & { CloseWatcher?: unknown }).CloseWatcher;
  return typeof ctor === "function" ? (ctor as CloseWatcherCtor) : null;
}

/** A watcher whose close (Back, or an Escape nothing took) calls `onClose`; null if it can't be made. */
function watch(ctor: CloseWatcherCtor, onClose: () => void): CloseWatcherLike | null {
  try {
    const watcher = new ctor();
    watcher.onclose = () => onClose();
    return watcher;
  } catch {
    return null;
  }
}

/** The history state as an object to spread (Next's own is one; anything else is dropped). */
function stateObject(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

/** The same page: path alike, so only the query or the hash differ. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

/** The marker entry pushed for one open sheet. */
interface Marker {
  /** In the entry's history state under BACK_MARKER, so the entry is known as this marker's. */
  token: string;
  /** The address it went over: the entry under it keeps this one. */
  origin: string;
  /** The newest address while it is the newest entry. */
  latest: string;
  /** history.length right after the push: a page pushed over the marker grows it. */
  length: number;
  /** A close's own history.back() is on its way. */
  leaving: boolean;
  /** Lets the marker go if that history.back() never lands. */
  timer: ReturnType<typeof setTimeout> | undefined;
}

let markers = 0;

export interface BackClosesOptions {
  /** The panel is open (the store's `open`). */
  open: boolean;
  /** It is the phone's full-height sheet: only then is Back the panel's. */
  sheet: boolean;
  /** The owner's History shows: Back leaves it first (a second close watcher). */
  inHistory: boolean;
  /** Back closes the panel: closePanel("back"). */
  onBack(): void;
  /** Back leaves History for the chat. */
  onLeaveHistory(): void;
}

export interface BackCloses {
  /** The marker is the newest history entry: a link followed from the sheet should replace it. */
  replaceOnNavigate: boolean;
  /** Says why the panel is about to close, before the store closes it (closePanel). */
  willClose(reason: PanelCloseReason): void;
}

export function useBackCloses({
  open,
  sheet,
  inHistory,
  onBack,
  onLeaveHistory,
}: BackClosesOptions): BackCloses {
  // Read once: a browser doesn't gain or lose CloseWatcher while the page is up.
  const [ctor] = useState(closeWatcherCtor);
  const latest = useRef({ onBack, onLeaveHistory });
  latest.current = { onBack, onLeaveHistory };
  const reasonRef = useRef<PanelCloseReason | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [onTop, setOnTop] = useState(false);
  // Bumped each time a marker goes: one is pushed again if the sheet is still open.
  const [gone, setGone] = useState(0);
  const active = open && sheet;

  // ── A CloseWatcher ────────────────────────────────────────────────────
  // The sheet's watcher, and History's on top of it (the newest closes
  // first). Callbacks come off a ref, so the sheet's watcher is made once per
  // open and always stays under History's.
  const watching = active && ctor !== null;
  useEffect(() => {
    if (!watching || !ctor) return;
    const watcher = watch(ctor, () => latest.current.onBack());
    return () => watcher?.destroy();
  }, [watching, ctor]);
  const watchingHistory = watching && inHistory;
  useEffect(() => {
    if (!watchingHistory || !ctor) return;
    const watcher = watch(ctor, () => latest.current.onLeaveHistory());
    return () => watcher?.destroy();
  }, [watchingHistory, ctor]);

  // ── The history marker ────────────────────────────────────────────────
  // While a marker is held: one popstate listener (stable, it reads the
  // newest handler off a ref) and the address check's timer.
  const onPopRef = useRef<() => void>(() => {});
  const [popListener] = useState(() => () => onPopRef.current());
  const checkTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Stops listening for the marker and forgets it; its entry stays in history.
  const letGo = useCallback(() => {
    const m = markerRef.current;
    if (!m) return;
    markerRef.current = null;
    clearTimeout(m.timer);
    clearInterval(checkTimer.current);
    window.removeEventListener("popstate", popListener);
    setOnTop(false);
    setGone((n) => n + 1);
  }, [popListener]);

  // The address may have changed under the open sheet. Still the newest
  // entry, on the same page: keep the newest address, and the flag on it. A
  // page pushed over it, or one that took its place: let it go.
  const check = useCallback(() => {
    const m = markerRef.current;
    if (!m || m.leaving) return;
    const href = window.location.href;
    if (window.history.length !== m.length || !samePage(href, m.origin)) {
      letGo();
      return;
    }
    m.latest = href;
    if (stateObject()[BACK_MARKER] === m.token) return;
    try {
      window.history.replaceState({ ...stateObject(), [BACK_MARKER]: m.token }, "");
    } catch {
      /* no history API: Back is left to the page */
    }
  }, [letGo]);

  // Back (or Forward) left the marker: a close's own history.back(), or the
  // phone's Back, which closes the sheet. Landing on the entry under it (the
  // address the marker went over), the newest address comes back: a query or
  // a hash only, as replaceUrl() can't load another page.
  onPopRef.current = () => {
    const m = markerRef.current;
    if (!m) return;
    letGo();
    if (m.latest !== m.origin && window.location.href === m.origin) {
      try {
        replaceUrl(new URL(m.latest));
      } catch {
        /* a malformed address: the old one stays, which is harmless */
      }
    }
    if (!m.leaving) latest.current.onBack();
  };

  // One marker per open sheet, pushed as it opens (or turns into the sheet),
  // and again over a page that went over the last one. It stays until the
  // panel closes, even if the layout changes meanwhile.
  const marking = active && ctor === null;
  useEffect(() => {
    if (!marking || markerRef.current) return;
    const origin = window.location.href;
    const token = `amr-${Date.now().toString(36)}-${++markers}`;
    try {
      window.history.pushState({ ...stateObject(), [BACK_MARKER]: token }, "");
    } catch {
      return; // no history API: Back is left to the page
    }
    markerRef.current = {
      token,
      origin,
      latest: origin,
      length: window.history.length,
      leaving: false,
      timer: undefined,
    };
    window.addEventListener("popstate", popListener);
    checkTimer.current = setInterval(check, URL_CHECK_MS);
    setOnTop(true);
  }, [marking, gone, check, popListener]);

  // The panel closed. By Back, the marker went already; by a link, its page
  // replaced the marker or went over it (history.back() would undo that), so
  // it is let go. Any other close takes it out of history, once, if it is
  // still the newest entry.
  useEffect(() => {
    if (open) return;
    const reason = reasonRef.current;
    reasonRef.current = null;
    const m = markerRef.current;
    if (!m || m.leaving) return;
    if (reason === "navigate" || reason === "back") {
      letGo();
      return;
    }
    check();
    if (markerRef.current !== m) return; // no longer the newest entry: left behind
    m.leaving = true;
    setOnTop(false);
    m.timer = setTimeout(() => {
      if (markerRef.current === m) letGo();
    }, OWN_BACK_WAIT_MS);
    try {
      window.history.back();
    } catch {
      letGo();
    }
  }, [open, check, letGo]);

  // Gone from the page: stop listening (the entry stays in history).
  useEffect(
    () => () => {
      const m = markerRef.current;
      markerRef.current = null;
      if (m) clearTimeout(m.timer);
      clearInterval(checkTimer.current);
      window.removeEventListener("popstate", popListener);
    },
    [popListener]
  );

  const willClose = useCallback((reason: PanelCloseReason) => {
    reasonRef.current = reason;
  }, []);

  return { replaceOnNavigate: onTop, willClose };
}
