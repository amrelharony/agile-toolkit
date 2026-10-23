"use client";

import { useCallback, useEffect, useRef } from "react";

type Ref = (el: HTMLElement | null) => void;

/**
 * Focus that comes back after an in-place edit, for lists where the parent
 * keeps which row is open (`editing: id | null`).
 *
 * Save, Cancel and Escape unmount the editor, and the element that had
 * focus goes with it, so a keyboard user was dropped on the page body. Each
 * row registers the control that opened it (`ref={refFor("edit:" + id)}`);
 * closing the editor calls `returnTo` with that key, and after the next
 * render focus moves to it, now back on screen. `useInlineEdit` does the
 * same for a single item. A key that isn't on screen after that render
 * (the row moved to another meeting, say) is dropped, never kept for later.
 */
export function useReturnFocus() {
  const targets = useRef(new Map<string, HTMLElement>());
  // One ref callback per key, so React attaches it on mount and detaches it
  // on unmount only, not on every render.
  const refs = useRef(new Map<string, Ref>());
  const pending = useRef<string | null>(null);

  // After every render: cheap, and it catches the one where the row came back.
  useEffect(() => {
    const key = pending.current;
    if (!key) return;
    pending.current = null;
    targets.current.get(key)?.focus();
  });

  const refFor = useCallback((key: string): Ref => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (el) targets.current.set(key, el);
        else targets.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  }, []);

  const returnTo = useCallback((key: string) => {
    pending.current = key;
  }, []);

  return { refFor, returnTo };
}

export type RefFor = (key: string) => Ref;
