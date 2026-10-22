"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

// Safari (and older iPadOS) only ship the prefixed API.
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function fullscreenSupported(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

async function exitNativeFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

async function requestNativeFullscreen(el: FullscreenElement): Promise<void> {
  if (el.requestFullscreen) await el.requestFullscreen();
  else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  else throw new Error("Fullscreen API unavailable");
}

export interface FullscreenState {
  /** Native fullscreen or the immersive overlay. */
  isFullscreen: boolean;
  /** The CSS overlay used where the Fullscreen API is missing (iPhone). */
  immersive: boolean;
  toggle: () => void;
  exitImmersive: () => void;
}

/**
 * Fullscreen for the reader frame, following the ceremony timer: the
 * Fullscreen API on the element, with `fullscreenchange` keeping state in
 * sync when the browser exits on its own (Esc, gestures).
 *
 * iPhone Safari has no element fullscreen (`fullscreenEnabled` is false),
 * and a request can also be refused (sandboxed iframes, permissions). Both
 * fall back to an "immersive" overlay the reader renders itself.
 */
export function useFullscreen(ref: RefObject<HTMLElement>): FullscreenState {
  const [native, setNative] = useState(false);
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    const sync = () => setNative(ref.current !== null && fullscreenElement() === ref.current);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  const toggle = useCallback(() => {
    if (immersive) {
      setImmersive(false);
      return;
    }
    const el = ref.current as FullscreenElement | null;
    if (!el) return;
    if (fullscreenElement() === el) {
      exitNativeFullscreen().catch(() => {
        // Already left (e.g. the user pressed Esc first) — nothing to do.
      });
      return;
    }
    if (!fullscreenSupported()) {
      setImmersive(true);
      return;
    }
    requestNativeFullscreen(el).catch(() => setImmersive(true));
  }, [immersive, ref]);

  const exitImmersive = useCallback(() => setImmersive(false), []);

  return { isFullscreen: native || immersive, immersive, toggle, exitImmersive };
}

/**
 * Ref-counted body scroll lock shared with the mobile sidebar and dialogs
 * (see sidebar.tsx): each owner bumps `window.__scrollLockCount`, and only
 * the last one out restores the original overflow.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    type W = Window & { __scrollLockCount?: number; __scrollLockPrev?: string };
    const w = window as W;
    if ((w.__scrollLockCount ?? 0) === 0) {
      w.__scrollLockPrev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
    return () => {
      w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
      if (w.__scrollLockCount === 0) {
        document.body.style.overflow = w.__scrollLockPrev ?? "";
        delete w.__scrollLockPrev;
      }
    };
  }, [active]);
}

/**
 * Make everything outside the modal overlay `inert` while it is open, so
 * neither Tab nor a screen reader's virtual cursor can wander into the page
 * underneath. The overlay is portalled straight into <body>, so its
 * siblings are the whole app plus any other portals. Elements that were
 * already inert are left alone on restore.
 */
export function useInertSiblings(ref: RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    const overlay = ref.current;
    if (!active || !overlay || overlay.parentElement !== document.body) return;
    const changed: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === overlay || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      changed.push(child);
    }
    return () => {
      for (const child of changed) child.removeAttribute("inert");
    };
  }, [ref, active]);
}
