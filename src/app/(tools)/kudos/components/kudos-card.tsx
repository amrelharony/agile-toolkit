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
 *
 * Phase 5 layered two interactive affordances ONTO the card without
 * disturbing the original shareable shape:
 *
 *   - A reaction strip rendered between the message and the footer.
 *     Groups `kudos.reactions[]` by emoji + count badge; click toggles
 *     via the parent-supplied `onAddReaction`. A small "+" trigger
 *     opens a Radix Popover with a fixed grid of common emoji.
 *   - A reply chevron in the top-right of the header — toggling it is
 *     the parent's job (the card just renders the affordance + fires
 *     `onToggleReply`). Hidden when the kudos is itself a reply
 *     (`replyTo` set) — threading depth is capped at 1.
 *
 * Both affordances are HIDDEN when `excludeInteractive` is true. The
 * PNG-export path passes that flag so the shareable image carries no
 * UI chrome, only the recognition.
 */

import { forwardRef, useState } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Kudos, KudosReaction } from "@/lib/stores/workspace-types";
import { episodeCard } from "@/lib/kudos/print-cards";
import { getKudosTheme, themeInk } from "../types";

/**
 * Quick-pick palette for the "+" emoji button. Six common emoji keeps
 * the UI compact while covering the recognition vocabulary the original
 * HTML implied (clap, thank-you, applaud, etc.). Custom emoji ride
 * through the same `onAddReaction(kudosId, emoji)` path but aren't on
 * this palette.
 */
const COMMON_REACTIONS = ["🎉", "👏", "💪", "🙏", "❤️", "🚀", "✨", "👍"];

interface KudosCardProps {
  kudos: Kudos;
  /** When true (used by the wall feed), shrinks the card to fit a
   *  3-column grid. The PNG-export path uses `compact={false}` so the
   *  exported image is full-size. */
  compact?: boolean;
  /**
   * When true, the reactions strip + reply chevron are not rendered.
   * Used by the PNG-export path so the captured image is just the
   * shareable recognition, no interactive chrome. Defaults to false.
   */
  excludeInteractive?: boolean;
  /** Local viewer profile id — used to render the "you reacted with X"
   *  affordance. Optional; when absent the strip still renders but no
   *  reaction is highlighted as the viewer's own. */
  viewerProfileId?: string;
  /** Called when the viewer clicks an emoji (existing or palette). */
  onAddReaction?: (kudosId: string, emoji: string) => void;
  /** Called when the viewer clicks the reply chevron. Hidden when the
   *  card itself is a reply. */
  onToggleReply?: (kudosId: string) => void;
  /** When true, render the reply chevron in an "open" state. The card
   *  doesn't manage thread state — that's the wall's job. */
  isReplyOpen?: boolean;
}

interface GroupedReaction {
  emoji: string;
  count: number;
  viewerReacted: boolean;
}

function groupReactions(
  reactions: KudosReaction[] | undefined,
  viewerProfileId: string | undefined
): GroupedReaction[] {
  if (!reactions || reactions.length === 0) return [];
  const map = new Map<string, GroupedReaction>();
  for (const r of reactions) {
    const cur = map.get(r.emoji);
    const viewerReacted = !!viewerProfileId && r.byProfileId === viewerProfileId;
    if (!cur) {
      map.set(r.emoji, { emoji: r.emoji, count: 1, viewerReacted });
    } else {
      cur.count += 1;
      cur.viewerReacted = cur.viewerReacted || viewerReacted;
    }
  }
  // Stable order: insertion-order of first occurrence (Map preserves it).
  return Array.from(map.values());
}

export const KudosCard = forwardRef<HTMLDivElement, KudosCardProps>(function KudosCard(
  {
    kudos,
    compact = false,
    excludeInteractive = false,
    viewerProfileId,
    onAddReaction,
    onToggleReply,
    isReplyOpen = false,
  },
  ref
) {
  const theme = getKudosTheme(kudos.theme);
  // A card written from a book episode says what that episode's printed card says.
  const printed = episodeCard(kudos.episode);
  // sentAt is a stable ISO string from upsertKudos, formatted with a
  // deterministic locale to avoid SSR/CSR hydration drift. Validators
  // only length-check the field — a hostile peer that survives them
  // with sentAt="lol" would otherwise render the literal string
  // "Invalid Date" both on screen and inside the downloaded PNG.
  // Guard with Number.isFinite(getTime()) and fall back to an em-dash.
  const sentAtDate = new Date(kudos.sentAt);
  const dateLabel = Number.isFinite(sentAtDate.getTime())
    ? sentAtDate.toLocaleDateString("en-US")
    : "—";

  const grouped = groupReactions(kudos.reactions, viewerProfileId);
  // Hide the reply chevron when this card IS a reply (depth-1 cap).
  const showReplyChevron = !excludeInteractive && !kudos.replyTo && !!onToggleReply;
  const showReactions = !excludeInteractive && (grouped.length > 0 || !!onAddReaction);

  // A kudos is a printed card: white paper and near-black ink in every
  // theme, so the wall, the live preview and the PNG match. The literal
  // colours here (and KUDOS_THEMES' hex) are deliberate print styling: the
  // PNG export renders outside the page's CSS, where tokens don't resolve.
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
        style={{
          borderBottom: "2px solid rgba(0,0,0,0.2)",
          color: themeInk(theme),
          // A custom theme has no Tailwind class: its hex is the strip.
          ...(theme.headerBg ? {} : { background: theme.hex }),
        }}
      >
        {theme.emoji ? (
          <span className={compact ? "text-2xl" : "text-3xl"} aria-hidden="true">
            {theme.emoji}
          </span>
        ) : null}
        <h3
          className={`font-bold ${compact ? "text-lg" : "text-fluid-h3"} flex-1`}
          style={{ margin: 0 }}
        >
          {theme.title}
        </h3>
        {showReplyChevron && (
          <button
            type="button"
            onClick={() => onToggleReply?.(kudos.id)}
            aria-pressed={isReplyOpen}
            aria-label={isReplyOpen ? "Hide reply" : "Reply to this kudos"}
            className="min-touch-coarse inline-flex items-center justify-center rounded-md p-1 opacity-80 hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={compact ? "px-4 py-3" : "px-6 py-5"}>
        {printed ? (
          <div className="mb-3">
            <p className={`font-bold ${compact ? "text-base" : "text-xl"}`} style={{ margin: 0 }}>
              {printed.headline}
            </p>
            <p className={`italic ${compact ? "text-xs" : "text-sm"}`} style={{ margin: 0 }}>
              &ldquo;{printed.quote}&rdquo; &mdash; {printed.speaker}
            </p>
          </div>
        ) : null}
        <div className={`font-bold mb-2 ${compact ? "text-sm" : "text-lg"}`}>
          To: <span className="font-semibold">{kudos.toName}</span>
        </div>
        <p
          className={`leading-relaxed whitespace-pre-wrap break-words ${
            compact ? "text-sm" : "text-base"
          }`}
          style={{ margin: 0 }}
        >
          {kudos.replyTo ? null : <span className="font-bold">Thank you for: </span>}
          {kudos.message}
        </p>
      </div>
      {showReactions && (
        <ReactionStrip
          kudosId={kudos.id}
          grouped={grouped}
          onAddReaction={onAddReaction}
          compact={compact}
        />
      )}
      <div
        className={`flex flex-wrap items-end justify-between gap-2 ${
          compact ? "px-4" : "px-6"
        } py-3 text-xs`}
        style={{ borderTop: "1px solid rgba(0,0,0,0.1)" }}
      >
        <span>
          From: <span className="font-semibold">{kudos.fromName}</span>
          {kudos.teamName ? `, ${kudos.teamName}` : ""}
        </span>
        <span>Date: {dateLabel}</span>
      </div>
    </div>
  );
});

interface ReactionStripProps {
  kudosId: string;
  grouped: GroupedReaction[];
  onAddReaction?: (kudosId: string, emoji: string) => void;
  compact: boolean;
}

function ReactionStrip({ kudosId, grouped, onAddReaction, compact }: ReactionStripProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handlePick = (emoji: string) => {
    setPickerOpen(false);
    onAddReaction?.(kudosId, emoji);
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${compact ? "px-4" : "px-6"} pb-2`}
      style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}
    >
      {grouped.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onAddReaction?.(kudosId, g.emoji)}
          aria-label={`React with ${g.emoji}, ${g.count} so far${
            g.viewerReacted ? " — you reacted" : ""
          }`}
          aria-pressed={g.viewerReacted}
          className={[
            "min-touch-coarse inline-flex items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
            g.viewerReacted
              ? "border-black/40 bg-black/10 text-black"
              : "border-black/15 bg-black/[0.03] text-black/80 hover:bg-black/[0.06]",
          ].join(" ")}
        >
          <span aria-hidden="true">{g.emoji}</span>
          <span className="font-semibold tabular-nums">{g.count}</span>
        </button>
      ))}
      {onAddReaction && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add a reaction"
              className="min-touch-coarse inline-flex items-center justify-center gap-1 rounded-full border border-dashed border-black/20 px-2 py-0.5 text-xs text-black/60 hover:border-black/40 hover:text-black/80"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto max-w-[calc(100vw-2rem)] bg-surface border-border p-2"
          >
            <div role="group" aria-label="Pick a reaction" className="grid grid-cols-4 gap-1">
              {COMMON_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handlePick(e)}
                  className="min-touch-coarse rounded-md px-2 py-1 text-lg hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  aria-label={`React with ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
