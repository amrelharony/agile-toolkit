"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts for running the meeting without reaching for the
 * mouse (the facilitator is usually sharing the screen and talking).
 * The buttons carry the same keys in `aria-keyshortcuts`, and the page
 * lists them under the controls.
 */

export type Shortcut = "toggle" | "next-speaker" | "skip-speaker" | "next-segment";

/** The keys, as `aria-keyshortcuts` spells them. */
export const SHORTCUT_KEYS: Record<Shortcut, string> = {
  toggle: "Space",
  "next-speaker": "N",
  "skip-speaker": "S",
  "next-segment": "Shift+N",
};

/** Where typing goes: letters typed here are text, not shortcuts. */
const TEXT_ENTRY =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Controls Space already activates. */
const SPACE_TARGETS =
  'button, a[href], summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="link"]';

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "defaultPrevented"
> & { target: EventTarget | null };

/**
 * The timer action a key press asks for, or null: not one of the keys, a
 * modifier held (Ctrl+S still saves), typing in a field or a dialog, or
 * Space on a control that Space presses anyway.
 */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest(TEXT_ENTRY)) return null;
  if (e.key === " " || e.key === "Spacebar") {
    if (e.repeat || e.shiftKey || el?.closest(SPACE_TARGETS)) return null;
    return "toggle";
  }
  if (e.repeat) return null;
  const key = e.key.toLowerCase();
  if (key === "n") return e.shiftKey ? "next-segment" : "next-speaker";
  if (key === "s" && !e.shiftKey) return "skip-speaker";
  return null;
}

/**
 * Listens on the document while the page is open. `run` gets the shortcut
 * and returns whether it did anything; only then is the key's default
 * (Space scrolling the page) prevented.
 */
export function useTimerShortcuts(run: (shortcut: Shortcut) => boolean): void {
  const ref = useRef(run);
  useEffect(() => {
    ref.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e);
      if (shortcut && ref.current(shortcut)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
