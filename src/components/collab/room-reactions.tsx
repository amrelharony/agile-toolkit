"use client";

/**
 * Emoji reactions in a visitor room (`lib/realtime/room-reactions.ts`): the
 * bar of six, and the band they rise through.
 *
 *   <RoomReactions extras={extras} />   // the bar, with the band above it
 *   <ReactionLayer reactions={extras.reactions} className="inset-x-0 bottom-0 h-64" />
 *
 * The band sits inside the room's own panel (never fixed or full-screen),
 * is decorative (`aria-hidden`, click-through) and keeps nothing: each emoji
 * rises for 2.4 s and is gone. Under reduced motion they show still, spread
 * along the band, for the same time. They carry no names.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ROOM_REACTIONS,
  REACTION_LIMITS,
  type FloatingReaction,
} from "@/lib/realtime/room-reactions";
import type { RoomExtras } from "@/lib/realtime/use-room-extras";
import { cn } from "@/lib/utils";

export interface ReactionBarProps {
  onReact: (r: number) => void;
  disabled?: boolean;
  className?: string;
}

/** Six buttons, one per reaction. Each sends one; nothing is kept. */
export function ReactionBar({ onReact, disabled = false, className }: ReactionBarProps) {
  return (
    <div
      role="group"
      aria-label="Send a reaction"
      className={cn("flex flex-wrap gap-1", className)}
    >
      {ROOM_REACTIONS.map((r, i) => (
        <button
          key={r.label}
          type="button"
          disabled={disabled}
          aria-label={`React: ${r.label}`}
          title={r.label}
          onClick={() => onReact(i)}
          className="min-touch-coarse inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-lg transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <span aria-hidden="true">{r.emoji}</span>
        </button>
      ))}
    </div>
  );
}

export interface ReactionLayerProps {
  reactions: readonly FloatingReaction[];
  /** Where the band sits in its (relative) parent, e.g. "inset-x-0 bottom-full". */
  className?: string;
  /** "md": a 10rem band of small emoji; "lg": a 18rem band of big ones (the big screen). */
  size?: "md" | "lg";
}

const BAND = {
  md: { height: "h-40", rise: "-11rem", emoji: "text-3xl" },
  lg: { height: "h-72", rise: "-19rem", emoji: "text-6xl" },
} as const;

/** The person's "reduce motion" setting, followed live. False where it can't be read. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduce;
}

/** The band the reactions rise through, and out of. Decorative and click-through. */
export function ReactionLayer({ reactions, className, size = "md" }: ReactionLayerProps) {
  const reduce = usePrefersReducedMotion();
  const band = BAND[size];
  return (
    <div
      aria-hidden="true"
      data-reaction-layer
      className={cn("pointer-events-none absolute overflow-hidden", band.height, className)}
    >
      {reactions.map((r) => {
        const emoji = ROOM_REACTIONS[r.r]?.emoji;
        if (!emoji) return null;
        const left = `${Math.round(r.lane * 100)}%`;
        const cls = cn("absolute bottom-1 select-none leading-none", band.emoji);
        return reduce ? (
          // Still: spread up the band by lane instead of rising.
          <span
            key={r.key}
            data-reaction
            className={cn(cls, "-translate-x-1/2")}
            style={{ left, bottom: `${Math.round(r.lane * 50)}%` }}
          >
            {emoji}
          </span>
        ) : (
          <motion.span
            key={r.key}
            data-reaction
            className={cls}
            // framer-motion owns the transform, so the centring goes through it too.
            style={{ left, x: "-50%" }}
            initial={{ y: 0 }}
            animate={{ y: band.rise }}
            transition={{ duration: REACTION_LIMITS.showMs / 1000, ease: "easeOut" }}
          >
            {emoji}
          </motion.span>
        );
      })}
    </div>
  );
}

/**
 * The bar with its band above it, for the bottom of a room's panel. The
 * band rises over the room's content just above the bar.
 */
export function RoomReactions({ extras, className }: { extras: RoomExtras; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <ReactionLayer reactions={extras.reactions} className="inset-x-0 bottom-full" />
      <ReactionBar onReact={(r) => extras.react(r)} disabled={!extras.live} />
    </div>
  );
}
