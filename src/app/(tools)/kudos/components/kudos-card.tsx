"use client";

/**
 * Visual kudos card.
 *
 * Used in three places:
 *   * Live preview in the compose form
 *   * Wall feed entry
 *   * PNG-export target (forwardRef so `exportPng` can capture the
 *     outermost wrapper)
 *
 * Renders as a fixed-aspect card so the PNG export produces a clean
 * shareable image regardless of where the card is rendered. All
 * colors derive from the theme catalog (no inline hex outside the
 * `headerBg`/`hex` mapping which mirrors the toolkit palette).
 */

import { forwardRef } from "react";
import type { Kudos } from "@/lib/stores/workspace-types";
import { getKudosTheme } from "../types";

interface KudosCardProps {
  kudos: Kudos;
  /** When true (used by the wall feed), shrinks the card to fit a
   *  3-column grid. The PNG-export path uses `compact={false}` so the
   *  exported image is full-size. */
  compact?: boolean;
}

export const KudosCard = forwardRef<HTMLDivElement, KudosCardProps>(function KudosCard(
  { kudos, compact = false },
  ref
) {
  const theme = getKudosTheme(kudos.theme);
  // sentAt is a stable ISO string from upsertKudos; format on the
  // server-rendered initial pass with a deterministic locale to avoid
  // a hydration mismatch with the client's locale-specific format.
  const dateLabel = new Date(kudos.sentAt).toLocaleDateString("en-US");

  return (
    <div
      ref={ref}
      data-kudos-id={kudos.id}
      className={
        compact
          ? "rounded-lg overflow-hidden border-2 border-black/20 bg-white shadow-md w-full"
          : "rounded-lg overflow-hidden border-2 border-black/20 bg-white shadow-lg w-full max-w-2xl"
      }
      style={{ color: "#111" }}
    >
      <div
        className={`px-5 py-3 flex items-center gap-3 ${theme.headerBg}`}
        style={{ borderBottom: "2px solid rgba(0,0,0,0.2)" }}
      >
        <span className={compact ? "text-2xl" : "text-3xl"} aria-hidden="true">
          {theme.emoji}
        </span>
        <h3
          className={`font-bold text-white ${compact ? "text-lg" : "text-2xl"}`}
          style={{ margin: 0 }}
        >
          {theme.title}
        </h3>
      </div>
      <div className={compact ? "px-4 py-3" : "px-6 py-5"}>
        <div className={`font-bold mb-2 ${compact ? "text-sm" : "text-lg"}`}>
          To: <span className="font-semibold">{kudos.toName}</span>
        </div>
        <p
          className={`leading-relaxed whitespace-pre-wrap break-words ${
            compact ? "text-sm" : "text-base"
          }`}
          style={{ margin: 0 }}
        >
          {kudos.message}
        </p>
      </div>
      <div
        className={`flex flex-wrap items-end justify-between gap-2 ${
          compact ? "px-4" : "px-6"
        } py-3 text-xs`}
        style={{ borderTop: "1px solid rgba(0,0,0,0.1)" }}
      >
        <span>
          Signed: <span className="font-semibold">{kudos.fromName}</span>
          {kudos.teamName ? `, ${kudos.teamName}` : ""}
        </span>
        <span>Date: {dateLabel}</span>
      </div>
    </div>
  );
});
