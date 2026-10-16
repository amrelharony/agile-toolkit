/**
 * Theme constants shared by the server layout and the client theme module.
 * Kept free of "use client" so app/layout.tsx can inline the boot script.
 */

export type ThemePreference = "system" | "dark" | "light" | "hc";
export type AppliedTheme = "dark" | "light" | "hc";

export const THEME_STORAGE_KEY = "ae-theme";
/** Theme for visitors who haven't chosen one. */
export const DEFAULT_PREFERENCE: ThemePreference = "dark";

/** Browser chrome colour per applied theme (matches --bg). */
export const THEME_COLORS: Record<AppliedTheme, string> = {
  dark: "#06080f",
  light: "#f4f6fb",
  hc: "#000000",
};

/**
 * Blocking script for <head>: apply the stored (or system) theme and the
 * matching theme-color before first paint, so there's no wrong-theme flash.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var t=p==="dark"||p==="light"||p==="hc"?p:p==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):"${DEFAULT_PREFERENCE}";var r=document.documentElement;r.classList.remove("dark","light","hc");r.classList.add(t);r.setAttribute("data-theme",t);var c={dark:"${THEME_COLORS.dark}",light:"${THEME_COLORS.light}",hc:"${THEME_COLORS.hc}"}[t];document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}catch(e){}})()`;
