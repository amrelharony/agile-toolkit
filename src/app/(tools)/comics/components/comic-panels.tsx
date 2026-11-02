"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { panelImageUrl } from "@/lib/comics/images";
import type { Panel } from "@/lib/comics/types";
import { PanelOverlay } from "./panel-overlay";
import { PanelTranscript } from "./panel-transcript";

/**
 * A story's panels, stacked on a phone. Every page gets the 768 px file, and
 * there is no srcset on purpose: a 3x phone would pick the 1536 px one, and on
 * the free tier that download allowance is shared with sign-in and sync.
 *
 * The transcript is always in the page, because the speech is baked into the
 * art and a screen reader can't get it any other way. The button only shows it
 * to everyone else.
 */
export function ComicPanels({ panels, title }: { panels: readonly Panel[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const close = useCallback(() => setOpen(null), []);

  if (panels.length === 0) return null;

  return (
    <section aria-label="Comic panels" className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => setShowTranscript((v) => !v)}>
          {showTranscript ? "Hide transcript" : "Show transcript"}
        </Button>
      </div>
      <ol className="grid list-none gap-3 sm:grid-cols-2">
        {panels.map((panel, i) => (
          <li key={panel.pathSmall}>
            <figure>
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-label={`Open panel ${i + 1} of ${panels.length} full screen`}
                className="panel block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* Plain <img>: the optimiser would add another copy of every
                    panel to the download bill, and the real size stops the
                    page jumping as each one loads. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={panelImageUrl(panel.pathSmall)}
                  width={panel.width}
                  height={panel.height}
                  alt={panel.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full"
                />
              </button>
              <figcaption
                className={showTranscript ? "mt-2 space-y-1 text-sm text-sub" : "sr-only"}
              >
                <PanelTranscript panel={panel} />
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
      {open !== null && panels[open] ? (
        <PanelOverlay panels={panels} index={open} title={title} onClose={close} onMove={setOpen} />
      ) : null}
    </section>
  );
}
