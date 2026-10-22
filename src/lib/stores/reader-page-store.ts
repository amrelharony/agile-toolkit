"use client";

import { useEffect, useLayoutEffect } from "react";
import { create } from "zustand";

/**
 * The full-viewport reader page on screen right now, if any (today only the
 * private comic).
 *
 * Such a page is in no tool registry and its URL is a secret, so the shared
 * chrome must not recognise it by its path: matching that path there would
 * ship it, and the page's title, in the root layout chunk every visitor
 * downloads. The page announces itself instead (useReaderPage), and while
 * `title` is set the header names it in the breadcrumb, the mascot's figure
 * steps aside, the toast stack moves to the top, and "Sign in" links never
 * carry the current path along. On every other page all of that behaves
 * as usual. Not persisted: it describes what is mounted.
 */

interface ReaderPageState {
  /** The mounted reader page's title; null on every other page. */
  title: string | null;
  enter: (title: string) => void;
  leave: () => void;
}

export const useReaderPageStore = create<ReaderPageState>((set) => ({
  title: null,
  enter: (title) => set({ title }),
  leave: () => set({ title: null }),
}));

// Effects never run on the server; this only skips React's SSR warning.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Mark the calling page as a reader page for as long as it is mounted. A
 * layout effect, so the header and the mascot change before the first
 * paint of a client-side navigation.
 */
export function useReaderPage(title: string): void {
  useIsomorphicLayoutEffect(() => {
    const { enter, leave } = useReaderPageStore.getState();
    enter(title);
    return leave;
  }, [title]);
}
