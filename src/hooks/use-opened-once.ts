"use client";

import { useState } from "react";

/**
 * True from the first time `open` is. A dialog whose code loads on demand
 * mounts then, so a page that never opens it never downloads or renders it,
 * and stays mounted so it can animate shut and reopen at once.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  // Adjusting state while rendering, as React documents for state derived
  // from a prop: this render already returns true, and the latch holds it.
  if (open && !opened) setOpened(true);
  return opened || open;
}
