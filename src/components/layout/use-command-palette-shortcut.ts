"use client";

import { useEffect } from "react";

/**
 * Ctrl/Cmd+K toggles the tool finder. It lives in the shell rather than in the
 * palette, whose code (cmdk, the search synonyms) loads only when it's first
 * opened: the shortcut has to work before then.
 */
export function useCommandPaletteShortcut(toggle: () => void): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Caps Lock makes `e.key` "K" — compare against the lowercase form so
      // the shortcut keeps working regardless of caps state. Also accept the
      // physical key code as a fallback for layouts where the K position
      // produces a different character. Some synthetic keydowns (autofill)
      // carry no key at all.
      const isK = (e.key ?? "").toLowerCase() === "k" || e.code === "KeyK";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggle]);
}
