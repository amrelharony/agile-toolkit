"use client";

import { useEffect, useState } from "react";
import type { IntroKind } from "@/lib/comics/intro";
import { introAllowed, playIntro } from "@/lib/comics/play-intro";

/**
 * Plays this page's intro again. Nothing to show where an intro never plays:
 * reduced motion, Save-Data, or before the browser has said which.
 */
export function ReplayIntro({ kind }: { kind: IntroKind }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(introAllowed()), []);
  if (!allowed) return null;

  return (
    <button
      type="button"
      onClick={() => playIntro(kind)}
      className="min-h-11 text-sm font-medium text-text underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-0"
    >
      Replay intro
    </button>
  );
}
