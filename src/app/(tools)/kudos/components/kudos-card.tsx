"use client";

/**
 * A kudos card, drawn as the printed Agile at Work card it was written on.
 *
 * Full size (the form's live preview, a sent card, a card opened from its
 * link, and the image made from any of them): both printed faces, side by
 * side when the card has 640 px and stacked when it hasn't. The front has
 * the coloured band with the card's headline, the comic panel and, on an
 * episode's card, its EP chip and title; the back has To / Thank you for /
 * From / Date, then the episode's lesson and where to read it in the book
 * (or, on an open card, the episode it reminds the sender of).
 *
 * Compact (wall entries, replies, the 240 px flying card): one small face
 * with the band, a thumbnail of the panel and the words.
 *
 * Which card is drawn comes only from `designFor` (lib/kudos/card-designs):
 * a kudos keeps its theme id and episode number, and anything else (one of
 * the original theme ids, a custom theme, a habit with no episode) is drawn
 * as the "Thank you!" card.
 *
 * Two interactive affordances sit on the card: the reaction strip (grouped
 * emoji with counts, and a "+" picker), and the reply chevron in the band,
 * which a reply doesn't get (threading depth is capped at 1). Both are
 * hidden when `excludeInteractive` is set, so an image carries only the card.
 */

import { forwardRef, useState, type CSSProperties, type ReactNode } from "react";
import { MessageCircle, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BookEpisode } from "@/lib/comics/book-episodes";
import type { Kudos, KudosReaction } from "@/lib/stores/workspace-types";
import {
  designFor,
  epLabel,
  padEp,
  remindsOf,
  splitHeadline,
  type CardDesign,
} from "@/lib/kudos/card-designs";
import { cardPanelUrl } from "@/lib/kudos/card-panels";

/**
 * Quick-pick palette for the "+" emoji button. Six common emoji keeps
 * the UI compact while covering the recognition vocabulary the original
 * HTML implied (clap, thank-you, applaud, etc.). Custom emoji ride
 * through the same `onAddReaction(kudosId, emoji)` path but aren't on
 * this palette.
 */
const COMMON_REACTIONS = ["🎉", "👏", "💪", "🙏", "❤️", "🚀", "✨", "👍"];

// A kudos is a printed card: white paper and the print's near-black ink in
// every site theme, so the wall, the preview and the image all match. The
// literal colours are the print's, deliberately the same in light, night and
// high contrast.
const PAPER = "#ffffff";
const PRINT_INK = "#14252A";
const BODY_INK = "#111";
const EDGE = "rgba(20,37,42,0.25)";
const RULE = "rgba(20,37,42,0.2)";
const NOTE_PAPER = "#FFFBF2";
/** Where a panel would be when the site has no address for the art. */
const BLANK_PANEL = "#F2EFE8";
/** "Agile at Work" and the site's address, in the print's teal. */
const BRAND = "#12676B";

/**
 * The id the form's live preview carries until it has one of its own. A
 * random id made while rendering differs between the server's render and the
 * browser's, so the form sets the real one after mount; until then the card
 * leaves data-kudos-id off.
 */
export const PENDING_KUDOS_ID = "kud_pending";

const FACE =
  "flex w-full max-w-[300px] min-h-[423px] flex-col overflow-hidden rounded-lg shadow-md";
const FACE_STYLE: CSSProperties = { background: PAPER, border: `1px solid ${EDGE}` };
const RULED: CSSProperties = { borderBottom: `1px solid ${RULE}` };

interface KudosCardProps {
  kudos: Kudos;
  /** One small face (the wall, replies, the flying card) instead of both
   *  printed faces. The image export uses the full card. */
  compact?: boolean;
  /**
   * When true, the reactions strip + reply chevron are not rendered.
   * Used by the image path so the captured picture is just the card,
   * no interactive chrome. Defaults to false.
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

/**
 * sentAt is a stable ISO string from upsertKudos, formatted with a
 * deterministic locale to avoid SSR/CSR hydration drift. Validators only
 * length-check the field — a hostile peer that survives them with
 * sentAt="lol" would otherwise render the literal string "Invalid Date" both
 * on screen and inside the downloaded image, so it falls back to an em-dash.
 */
function dateLabelOf(sentAt: string): string {
  const date = new Date(sentAt);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US") : "—";
}

/** What an episode's panel shows: who says its line. An open card's panel is decoration. */
function panelAlt(design: CardDesign): string {
  return design.ep !== null && design.speaker && design.quote
    ? `Episode ${design.ep}: ${design.speaker} says “${design.quote}”`
    : "";
}

function senderOf(kudos: Kudos): string {
  return kudos.teamName ? `${kudos.fromName}, ${kudos.teamName}` : kudos.fromName;
}

/** The card's comic panel: square on the front, a 64 px thumbnail on a compact card. */
function PanelArt({ design, thumbnail = false }: { design: CardDesign; thumbnail?: boolean }) {
  const small = cardPanelUrl(design.key, "small");
  const large = cardPanelUrl(design.key, "large");
  // The thumbnail has no h-auto (it would beat h-16 and let the compact row
  // stretch it to the words' height) and keeps to the top of its row.
  const shape = thumbnail
    ? "h-16 w-16 shrink-0 self-start rounded"
    : "aspect-square h-auto w-full rounded-md";
  const style: CSSProperties = { background: BLANK_PANEL, border: `1px solid ${PRINT_INK}` };
  if (!small || !large) return <div aria-hidden="true" className={shape} style={style} />;
  return (
    // Plain <img>: the art is already sized, and the optimiser would add a
    // second copy of every panel to the download bill. crossOrigin (set before
    // src) caches it CORS-mode, so the card image can copy it; Storage allows
    // any origin.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      crossOrigin="anonymous"
      srcSet={thumbnail ? undefined : `${small} 360w, ${large} 720w`}
      sizes={thumbnail ? undefined : "260px"}
      src={thumbnail ? small : large}
      width={thumbnail ? 64 : 720}
      height={thumbnail ? 64 : 720}
      alt={panelAlt(design)}
      loading={thumbnail ? "lazy" : undefined}
      decoding="async"
      className={`block object-cover ${shape}`}
      style={style}
    />
  );
}

/** The band's words: "Thanks for" small over the rest of the headline, or the open card's words. */
function BandTitle({ design, compact }: { design: CardDesign; compact: boolean }) {
  if (design.ep === null) {
    return (
      <h3 className={`leading-tight ${compact ? "text-sm font-bold" : "text-2xl font-extrabold"}`}>
        {design.title}
      </h3>
    );
  }
  const { lead, rest } = splitHeadline(design.headline);
  return (
    <h3 className="min-w-0">
      {lead ? (
        <>
          <span className="block text-xs font-bold uppercase tracking-wider">{lead}</span>{" "}
        </>
      ) : null}
      <span
        className={`block leading-tight ${compact ? "text-sm font-bold" : "text-xl font-extrabold"}`}
      >
        {rest}
      </span>
    </h3>
  );
}

function EpChip({ ep, design, outlined }: { ep: number; design: CardDesign; outlined: boolean }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-2 text-xs font-bold"
      style={
        outlined
          ? { border: `1px solid ${design.ink}` }
          : { background: design.colour, color: design.ink }
      }
    >
      {epLabel(ep)}
    </span>
  );
}

function Front({ design }: { design: CardDesign }) {
  return (
    <div className={FACE} style={FACE_STYLE}>
      <div
        className="flex min-h-[88px] flex-col justify-center px-5 py-3"
        style={{ background: design.colour, color: design.ink }}
      >
        <BandTitle design={design} compact={false} />
      </div>
      <div className="px-4 pt-4">
        <PanelArt design={design} />
      </div>
      <div
        className={`mt-auto flex items-center gap-2 px-4 pb-3 pt-3 text-xs ${
          design.ep === null ? "justify-end" : "justify-between"
        }`}
      >
        {design.ep !== null ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <EpChip ep={design.ep} design={design} outlined={false} />
            <span className="font-bold">{design.title}</span>
          </span>
        ) : null}
        <span className="shrink-0 font-extrabold uppercase" style={{ color: BRAND }}>
          Agile at Work
        </span>
      </div>
    </div>
  );
}

function NoteBox({ label, accent, children }: { label: string; accent: string; children: string }) {
  return (
    <div
      className="mx-5 mt-4 rounded-md p-3"
      style={{ background: NOTE_PAPER, border: `1px solid ${EDGE}` }}
    >
      <p className="text-xs font-bold uppercase" style={{ color: accent }}>
        {label}
      </p>
      <p className="mt-1 text-sm">{children}</p>
    </div>
  );
}

interface BackProps {
  kudos: Kudos;
  design: CardDesign;
  reminds: BookEpisode | null;
  chevron: ReactNode;
}

function Back({ kudos, design, reminds, chevron }: BackProps) {
  return (
    <div className={FACE} style={FACE_STYLE}>
      <div
        className="flex items-center justify-between gap-2 px-5 py-3"
        style={{ background: design.colour, color: design.ink }}
      >
        <p className="text-2xl font-extrabold uppercase tracking-wide">Kudos</p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase">{design.habit}</span>
          {design.ep !== null ? <EpChip ep={design.ep} design={design} outlined /> : null}
          {chevron}
        </div>
      </div>
      <div className="flex flex-col px-5 pt-2 text-sm">
        <p className="flex gap-1.5 py-2" style={RULED}>
          <span className="shrink-0 font-bold">To:</span>{" "}
          <span className="min-w-0 break-words">{kudos.toName}</span>
        </p>
        <div className="py-2" style={RULED}>
          {/* A reply thanks the sender back, so it has no "Thank you for". */}
          {kudos.replyTo ? null : <p className="font-bold">Thank you for:</p>}
          <p className="min-h-[3.75rem] whitespace-pre-wrap break-words">{kudos.message}</p>
        </div>
        {/* No min-w-0 on From: its narrowest is its longest word, so a short
            row moves the Date to a line of its own instead of splitting the
            name mid-word ("Workspac / e owner"). max-w-full still lets a
            single token too long for the whole row break inside it. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 py-2" style={RULED}>
          <p className="flex max-w-full flex-1 gap-1.5">
            <span className="shrink-0 font-bold">From:</span>{" "}
            <span className="min-w-0 break-words">{senderOf(kudos)}</span>
          </p>
          <p className="flex shrink-0 gap-1.5">
            <span className="font-bold">Date:</span>{" "}
            {/* The preview's date is today's, and the server's today (UTC) can
                be a day off the visitor's near midnight: React then takes the
                browser's text instead of failing the hydration. */}
            <span suppressHydrationWarning>{dateLabelOf(kudos.sentAt)}</span>
          </p>
        </div>
      </div>
      {design.ep !== null && design.lesson ? (
        <>
          <NoteBox label="The lesson" accent={design.accent}>
            {design.lesson}
          </NoteBox>
          <p className="mx-5 mt-3 text-sm font-bold">
            {`Read Episode ${padEp(design.ep)}, “${design.title}”, on page ${design.bookPage}.`}
          </p>
        </>
      ) : reminds ? (
        <NoteBox label="Which episode does this remind you of?" accent={design.accent}>
          {`Episode ${padEp(reminds.ep)}, “${reminds.title}”`}
        </NoteBox>
      ) : null}
      <div className="mt-auto px-5 pb-4 pt-4 text-xs">
        <p className="font-bold">Agile at Work</p>
        <p>Borrow the book from your Scrum Master.</p>
        <p style={{ color: BRAND }}>agile.amrelharony.com/comics</p>
      </div>
    </div>
  );
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
  const design = designFor(kudos);
  const reminds = remindsOf(kudos);
  const kudosId = kudos.id === PENDING_KUDOS_ID ? undefined : kudos.id;

  const grouped = groupReactions(kudos.reactions, viewerProfileId);
  // Hide the reply chevron when this card IS a reply (depth-1 cap).
  const showReplyChevron = !excludeInteractive && !kudos.replyTo && !!onToggleReply;
  const showReactions = !excludeInteractive && (grouped.length > 0 || !!onAddReaction);

  const chevron = showReplyChevron ? (
    <button
      type="button"
      onClick={() => onToggleReply?.(kudos.id)}
      aria-pressed={isReplyOpen}
      aria-label={isReplyOpen ? "Hide reply" : "Reply to this kudos"}
      className="min-touch-coarse inline-flex shrink-0 items-center justify-center rounded-md p-1 opacity-80 hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
    >
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
    </button>
  ) : null;

  const reactions = showReactions ? (
    <ReactionStrip
      kudosId={kudos.id}
      grouped={grouped}
      onAddReaction={onAddReaction}
      compact={compact}
    />
  ) : null;

  if (!compact) {
    return (
      <div
        ref={ref}
        data-kudos-id={kudosId}
        className="@container w-full"
        style={{ color: BODY_INK }}
      >
        <div className="flex flex-col items-center gap-4 @[640px]:flex-row @[640px]:items-stretch @[640px]:justify-center">
          <Front design={design} />
          <Back kudos={kudos} design={design} reminds={reminds} chevron={chevron} />
        </div>
        {reactions}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-kudos-id={kudosId}
      className="w-full overflow-hidden rounded-lg shadow-md"
      style={{ ...FACE_STYLE, color: BODY_INK }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: design.colour, color: design.ink }}
      >
        <div className="min-w-0 flex-1">
          <BandTitle design={design} compact />
        </div>
        {design.ep !== null ? <EpChip ep={design.ep} design={design} outlined /> : null}
        {chevron}
      </div>
      <div className="flex gap-3 p-3">
        <PanelArt design={design} thumbnail />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <p className="break-words font-bold">
            To: <span>{kudos.toName}</span>
          </p>
          <p className="whitespace-pre-wrap break-words">
            {kudos.replyTo ? null : <span className="font-bold">Thank you for: </span>}
            {kudos.message}
          </p>
          <p className="text-xs">
            From: <span className="font-semibold">{senderOf(kudos)}</span> ·{" "}
            {dateLabelOf(kudos.sentAt)}
          </p>
          {reminds ? (
            <p className="text-xs">{`Reminds me of Episode ${padEp(reminds.ep)}`}</p>
          ) : null}
        </div>
      </div>
      {reactions}
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
    // Under a compact card's words; under a full card's faces, on its own
    // strip of paper so it reads in every site theme.
    <div
      className={
        compact
          ? "flex flex-wrap items-center gap-1.5 px-3 py-2"
          : "mx-auto mt-3 flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg px-3 py-2"
      }
      style={
        compact
          ? { borderTop: "1px solid rgba(0,0,0,0.08)" }
          : { background: PAPER, border: `1px solid ${EDGE}` }
      }
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
