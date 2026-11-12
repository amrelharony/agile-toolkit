"use client";

/**
 * What Amr's corner shows while a part of him isn't there
 * (design §1.2 "Amr himself"):
 *
 *   FigureFailed   his figure crashed, or its code couldn't load: it tells the
 *                  shell, which turns his button into the "Ask Amr" launcher
 *                  plate in his spot. The same button, so he is still dragged,
 *                  moved by Move Amr and the arrow keys, and tapped open; the
 *                  shell tries his figure again from there.
 *
 * Never AmrStill and never a new likeness of him: where his figure can't be,
 * the plate says his name in lettering (decision 3).
 *
 * Small on purpose: it ships in Amr's chunk, which every page loads.
 */

import { useEffect, useRef } from "react";

/** What the launcher plate says, and its button's name: the same words, so the name is what's seen. */
export const LAUNCHER_LABEL = "Ask Amr";

/**
 * His figure's boundary fallback. It draws nothing itself: it tells the shell
 * once it has rendered (the shell's state changes then, never while
 * rendering), and the shell turns his button into the launcher plate.
 */
export function FigureFailed({ onFailed }: { onFailed: () => void }) {
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    onFailed();
  }, [onFailed]);
  return null;
}
