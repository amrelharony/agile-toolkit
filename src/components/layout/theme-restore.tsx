"use client";

import { useEffect } from "react";
import { applyStoredTheme } from "@/lib/theme/theme";

/**
 * Puts the visitor's theme back once the app is in the browser. On a normal
 * page the boot script already did and this changes nothing; on a page the
 * server couldn't render, nothing else would, and a night or high-contrast
 * visitor would get the comic.
 */
export function ThemeRestore() {
  useEffect(() => {
    applyStoredTheme();
  }, []);

  return null;
}
