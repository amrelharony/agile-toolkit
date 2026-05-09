"use client";

import { useEffect, useState } from "react";

/**
 * Returns `true` after the first client-side render. Use to gate UI that
 * would otherwise hydrate-mismatch (theme-dependent icons, browser-only
 * APIs, etc.). Replaces the inline `const [mounted, setMounted] = useState(false);
 * useEffect(() => setMounted(true), [])` pattern duplicated across the app.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
