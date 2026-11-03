"use client";

import { useEffect, useRef, useState } from "react";
import { INTRO_RUN_ATTR, type IntroKind } from "@/lib/comics/intro";
import { introAllowed, playIntro, stopIntro } from "@/lib/comics/play-intro";

/**
 * Plays this page's intro again. Nothing to show where an intro never plays:
 * reduced motion, Save-Data, or before the browser has said which.
 *
 * If the page goes while its replay plays (Back is the only way off it, since
 * the overlay covers the page), the replay ends with it. Otherwise <html> would
 * keep the intro's attribute, and the overlay would flash up mid-play when the
 * page came back. Only the run this button started: never the arrival's.
 */
export function ReplayIntro({ kind }: { kind: IntroKind }) {
  const [allowed, setAllowed] = useState(false);
  const started = useRef<string | null>(null);
  useEffect(() => setAllowed(introAllowed()), []);
  useEffect(
    () => () => {
      const run = started.current;
      if (run !== null && document.documentElement.getAttribute(INTRO_RUN_ATTR) === run) {
        stopIntro();
      }
    },
    []
  );
  if (!allowed) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (playIntro(kind))
          started.current = document.documentElement.getAttribute(INTRO_RUN_ATTR);
      }}
      className="min-h-11 text-sm font-medium text-text underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:min-h-0"
    >
      Replay intro
    </button>
  );
}
