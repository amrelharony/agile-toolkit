"use client";

/**
 * Reverse-chrono kudos feed.
 *
 * Renders the most-recent N kudos with a celebratory pop-in animation
 * on entry. New kudos that arrive via realtime (parent calls
 * `upsertKudos` → store update → re-render) get the same entry
 * animation thanks to framer-motion's `AnimatePresence` keyed by id.
 *
 * The wall is read-only: clicking a card highlights it (could
 * eventually open a detail modal, but MVP keeps it simple). The
 * download-PNG action lives in the compose form, not here.
 */

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KudosCard } from "./kudos-card";

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
  if (kudos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/40 bg-surface/40 px-6 py-12 text-center">
        <Sparkles className="h-8 w-8 text-accent/40" aria-hidden="true" />
        <p className="text-sm text-text">No kudos yet</p>
        <p className="text-xs text-sub max-w-sm">
          Send the first one with the form on the left. Kudos appear here for everyone in the
          session.
        </p>
      </div>
    );
  }

  // Reverse-chrono — newest first. Slice AFTER reverse so we keep the
  // most-recent N, not the oldest N.
  const ordered = [...kudos].reverse().slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {ordered.map((k) => {
          const highlighted =
            highlightToProfileId !== undefined && k.toProfileId === highlightToProfileId;
          return (
            <motion.div
              key={k.id}
              layout
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 240, damping: 22 }}
              className={
                highlighted ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-bg" : ""
              }
            >
              <KudosCard kudos={k} compact />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
