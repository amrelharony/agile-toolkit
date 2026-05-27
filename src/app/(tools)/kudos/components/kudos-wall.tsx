"use client";

/**
 * Reverse-chrono kudos feed.
 *
 * Renders the most-recent N kudos with a celebratory pop-in animation
 * on entry. New kudos that arrive via realtime (parent calls
 * `upsertKudos` → store update → re-render) get the same entry
 * animation thanks to framer-motion's `AnimatePresence` keyed by id.
 *
 * Accessibility: the wall is declared `role="feed"` with `aria-live`
 * polite — when a peer broadcast lands a new card the screen reader
 * announces it via the card's `aria-label`. The empty state uses
 * `role="status"` so the "No kudos yet" message is announced too.
 *
 * Motion: respects `prefers-reduced-motion`. Reduced-motion users
 * still see kudos appear, just without the layout shuffle and pop-in.
 */

import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KudosCard } from "./kudos-card";
import { getKudosTheme } from "../types";

interface Props {
  kudos: Kudos[];
  /** Highlights cards whose `toProfileId` matches this id — used by
   *  the guest view to draw attention to kudos addressed to them. */
  highlightToProfileId?: string;
  /** Max entries to render. Defaults to 50 — past that we'd want
   *  pagination but the cap on the store is 500 anyway. */
  limit?: number;
}

export function KudosWall({ kudos, highlightToProfileId, limit = 50 }: Props) {
  const reducedMotion = useReducedMotion();

  // Reverse-chrono — newest first. Slice AFTER reverse so we keep the
  // most-recent N, not the oldest N. Memoised so realtime broadcasts
  // that don't change the list reference don't re-allocate.
  const ordered = useMemo(() => kudos.slice().reverse().slice(0, limit), [kudos, limit]);

  if (kudos.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/40 bg-surface/40 px-6 py-12 text-center"
      >
        <Sparkles className="h-8 w-8 text-accent/40" aria-hidden="true" />
        <p className="text-sm text-text">No kudos yet</p>
        <p className="text-xs text-sub max-w-sm">
          Send the first one with the form on the left. Kudos appear here for everyone in the
          session.
        </p>
      </div>
    );
  }

  // Reduced-motion path: skip framer-motion entirely. The user still
  // sees new entries; they just don't pop or shuffle. Avoids the
  // `layout` cascade that would force 50 cards to animate to their
  // new positions on every realtime insert.
  if (reducedMotion) {
    return (
      <div role="feed" aria-busy={false} className="flex flex-col gap-3">
        {ordered.map((k) => (
          <article
            key={k.id}
            aria-label={kudosAriaLabel(k)}
            className={
              highlightToProfileId !== undefined && k.toProfileId === highlightToProfileId
                ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-bg"
                : ""
            }
          >
            <KudosCard kudos={k} compact />
          </article>
        ))}
      </div>
    );
  }

  return (
    <div role="feed" aria-busy={false} className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {ordered.map((k) => {
          const highlighted =
            highlightToProfileId !== undefined && k.toProfileId === highlightToProfileId;
          return (
            <motion.article
              key={k.id}
              layout
              aria-label={kudosAriaLabel(k)}
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 240, damping: 22 }}
              className={
                highlighted ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-bg" : ""
              }
            >
              <KudosCard kudos={k} compact />
            </motion.article>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Build a screen-reader-friendly label so an assistive tech user is
 * told "Thank You kudos from Alice to Bob: thanks for the review"
 * rather than just navigating a wall of unlabeled cards.
 */
function kudosAriaLabel(k: Kudos): string {
  const theme = getKudosTheme(k.theme);
  const messageBrief = k.message.length > 120 ? `${k.message.slice(0, 117)}…` : k.message;
  return `${theme.title} kudos from ${k.fromName} to ${k.toName}: ${messageBrief}`;
}
