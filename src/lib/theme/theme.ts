"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PREFERENCE,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  type AppliedTheme,
  type ThemePreference,
} from "./boot-script";

export {
  DEFAULT_PREFERENCE,
  THEME_BOOT_SCRIPT,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  type AppliedTheme,
  type ThemePreference,
} from "./boot-script";

/**
 * The colour theme the visitor chose, and the one actually applied.
 *
 * "system" follows the OS (`prefers-color-scheme`); "light" (comic), "dark"
 * (night comic) and "hc" (high contrast) are explicit. Without a stored choice
 * the toolkit is the comic. A visitor who already stored a choice keeps it. The
 * choice lives under the existing `ae-theme` key, which the blocking script in
 * app/layout.tsx reads before first paint, so there's no wrong-theme flash.
 */

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "hc" || v === "system") return v;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_PREFERENCE;
}

function systemTheme(): AppliedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "light";
  }
}

export function resolveTheme(pref: ThemePreference, system: AppliedTheme): AppliedTheme {
  return pref === "system" ? system : pref;
}

/** Put the classes, data attribute and meta theme-color on <html>. */
export function applyTheme(theme: AppliedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("hc", theme === "hc");
  root.setAttribute("data-theme", theme);
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", THEME_COLORS[theme]));
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  return readPreference();
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* preference stays for this page only */
  }
  applyTheme(resolveTheme(pref, systemTheme()));
  listeners.forEach((l) => l());
}

let systemWatchInstalled = false;
function ensureSystemWatch() {
  if (systemWatchInstalled || typeof window === "undefined") return;
  systemWatchInstalled = true;
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (readPreference() === "system") applyTheme(systemTheme());
      listeners.forEach((l) => l());
    });
  } catch {
    /* old browser: no live updates */
  }
}

function subscribe(listener: () => void) {
  ensureSystemWatch();
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyTheme(resolveTheme(readPreference(), systemTheme()));
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The visitor's preference (the default on the server). */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => DEFAULT_PREFERENCE);
}

/** The theme in effect (the comic on the server). */
export function useAppliedTheme(): AppliedTheme {
  return useSyncExternalStore(
    subscribe,
    () => resolveTheme(readPreference(), systemTheme()),
    () => "light"
  );
}
