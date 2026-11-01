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
 *
 * Phase 5 layered TWO grouping behaviours on top:
 *   - Dedup clusters: rows sharing an `llmDedupGroup` are folded into
 *     one card (the most recent) with a `+{N}` badge that expands the
 *     stack inline. Phase 3's LLM is what stamps that group; without
 *     it every row stands alone.
 *   - Reply chains: replies (rows with `replyTo` set) are pulled out
 *     of the top-level feed and rendered indented beneath their
 *     parent. Depth-1 cap matches the Phase 5 plan.
 *
 * The wall also wires reactions + reply composers via the props the
 * parent passes (owner client wires both; guest client may opt out of
 * either). When NO handlers are provided the card renders identically
 * to its pre-redesign form.
 */

import { useMemo, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import type { Kudos } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { KudosCard } from "./kudos-card";
import { KudosThreadReply } from "./kudos-thread-reply";
import { getKudosTheme } from "../types";
import { useKudosThread } from "../use-kudos-thread";

interface Props {
  kudos: Kudos[];
  /** Highlights cards whose `toProfileId` matches this id — used by
   *  the guest view to draw attention to kudos addressed to them. */
  highlightToProfileId?: string;
  /** Max entries to render. Defaults to 50 — past that we'd want
   *  pagination but the cap on the store is 500 anyway. */
  limit?: number;
  /** Local viewer profile id (passed to the card for "you reacted"
   *  styling on the reactions strip). */
  viewerProfileId?: string;
  /** Wires the reactions affordance. When absent, the strip falls
   *  back to read-only — existing reactions render but the "+"
   *  picker + click-to-toggle are hidden. */
  onAddReaction?: (kudosId: string, emoji: string) => void;
  /** Wires the reply composer. When absent, the chevron is hidden. */
  onSendReply?: (reply: Kudos) => Promise<void> | void;
  /** Sender display name for the reply composer. */
  replyFromName?: string;
  /** Sender squad profile id for the reply composer (guest mode). */
  replyFromProfileId?: string;
  /**
   * Controls under a top-level card (the owner's "Add to retro"). Not
   * rendered for replies: a reply thanks the sender, it isn't recognition.
   */
  cardActions?: (kudos: Kudos) => ReactNode;
}

interface FeedEntry {
  parent: Kudos;
  /** Other kudos folded into the same dedup cluster (most recent first). */
  clusterSiblings: Kudos[];
  /** Replies (depth-1) under this parent, in send-time order. */
  replies: Kudos[];
}

/**
 * Build the feed shape: one entry per top-level (non-reply) kudos,
 * cluster-folded by llmDedupGroup, plus its replies. Replies that
 * dangle (`replyTo` set to a missing parent) are surfaced as top-level
 * cards rather than dropped — graceful degrade if the parent was
 * deleted out from under them.
 */
function buildFeed(kudos: Kudos[]): FeedEntry[] {
  // Bucket replies by parent id; everything else is a candidate top-level.
  const repliesByParent = new Map<string, Kudos[]>();
  const tops: Kudos[] = [];
  for (const k of kudos) {
    if (k.replyTo) {
      const arr = repliesByParent.get(k.replyTo) ?? [];
      arr.push(k);
      repliesByParent.set(k.replyTo, arr);
    } else {
      tops.push(k);
    }
  }
  const topIds = new Set(tops.map((t) => t.id));
  // Orphaned replies (parent removed) graduate to top-level.
  repliesByParent.forEach((arr, parentId) => {
    if (!topIds.has(parentId)) {
      for (const orphan of arr) tops.push(orphan);
    }
  });

  // Dedup-cluster fold. Group by llmDedupGroup; the most-recent row in
  // the group is the visible parent, the rest become clusterSiblings.
  // Rows WITHOUT a group stand alone (group key = row.id).
  const byCluster = new Map<string, Kudos[]>();
  for (const t of tops) {
    const key = t.llmDedupGroup ?? `__solo:${t.id}`;
    const arr = byCluster.get(key) ?? [];
    arr.push(t);
    byCluster.set(key, arr);
  }
  // tops is already in workspace-store order (oldest→newest). Iterate
  // by insertion order of the FIRST member of each cluster but build
  // the entry from the newest row (clusters fold visibly to "latest").
  const seenKeys = new Set<string>();
  const entries: FeedEntry[] = [];
  for (const t of tops) {
    const key = t.llmDedupGroup ?? `__solo:${t.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const cluster = byCluster.get(key) ?? [t];
    const sorted = cluster.slice().sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    const parent = sorted[sorted.length - 1];
    const siblings = sorted.slice(0, -1).reverse(); // newest-first under parent
    const replies = (repliesByParent.get(parent.id) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    entries.push({ parent, clusterSiblings: siblings, replies });
  }
  return entries;
}

export function KudosWall({
  kudos,
  highlightToProfileId,
  limit = 50,
  viewerProfileId,
  onAddReaction,
  onSendReply,
  replyFromName,
  replyFromProfileId,
  cardActions,
}: Props) {
  const reducedMotion = useReducedMotion();
  const thread = useKudosThread();

  // Reverse-chrono — newest first. We feed-build BEFORE slicing so
  // dedup clusters aren't accidentally split across the limit window;
  // then slice the top-level entries.
  const ordered = useMemo<FeedEntry[]>(() => {
    const entries = buildFeed(kudos);
    // Most-recent parent first.
    entries.sort((a, b) => Date.parse(b.parent.sentAt) - Date.parse(a.parent.sentAt));
    return entries.slice(0, limit);
  }, [kudos, limit]);

  if (kudos.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface/40 px-6 py-12 text-center"
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
        {ordered.map((entry) => (
          <WallEntry
            key={entry.parent.id}
            entry={entry}
            highlightToProfileId={highlightToProfileId}
            viewerProfileId={viewerProfileId}
            onAddReaction={onAddReaction}
            onSendReply={onSendReply}
            replyFromName={replyFromName}
            replyFromProfileId={replyFromProfileId}
            isReplyOpen={thread.isExpanded(entry.parent.id)}
            onToggleReply={thread.toggleExpand}
            cardActions={cardActions}
          />
        ))}
      </div>
    );
  }

  return (
    <div role="feed" aria-busy={false} className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {ordered.map((entry) => (
          <motion.div
            key={entry.parent.id}
            layout
            initial={{ opacity: 0, scale: 0.92, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
          >
            <WallEntry
              entry={entry}
              highlightToProfileId={highlightToProfileId}
              viewerProfileId={viewerProfileId}
              onAddReaction={onAddReaction}
              onSendReply={onSendReply}
              replyFromName={replyFromName}
              replyFromProfileId={replyFromProfileId}
              isReplyOpen={thread.isExpanded(entry.parent.id)}
              onToggleReply={thread.toggleExpand}
              cardActions={cardActions}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface WallEntryProps {
  entry: FeedEntry;
  highlightToProfileId?: string;
  viewerProfileId?: string;
  onAddReaction?: (kudosId: string, emoji: string) => void;
  onSendReply?: (reply: Kudos) => Promise<void> | void;
  replyFromName?: string;
  replyFromProfileId?: string;
  isReplyOpen: boolean;
  onToggleReply: (id: string) => void;
  cardActions?: (kudos: Kudos) => ReactNode;
}

function WallEntry({
  entry,
  highlightToProfileId,
  viewerProfileId,
  onAddReaction: onReact,
  onSendReply: onReply,
  replyFromName,
  replyFromProfileId,
  isReplyOpen,
  onToggleReply,
  cardActions,
}: WallEntryProps) {
  const [stackOpen, setStackOpen] = useState(false);
  const { parent, clusterSiblings, replies } = entry;
  // An example card (Kudos' "Load an example") takes no reactions or
  // replies: those go to the server and the room, and the example doesn't.
  const example = isExampleId(parent.id);
  const onAddReaction = example ? undefined : onReact;
  const onSendReply = example ? undefined : onReply;
  const highlighted =
    highlightToProfileId !== undefined && parent.toProfileId === highlightToProfileId;

  // Replies are pre-built to inherit the parent's onSend → just rebuild
  // for each because closure captures parent. Reply chevron is wired to
  // the wall-level thread state so toggling the same id collapses.
  return (
    <article
      aria-label={kudosAriaLabel(parent)}
      className={highlighted ? "rounded-xl ring-2 ring-accent/60 ring-offset-2 ring-offset-bg" : ""}
    >
      <KudosCard
        kudos={parent}
        compact
        viewerProfileId={viewerProfileId}
        onAddReaction={onAddReaction}
        onToggleReply={onSendReply ? onToggleReply : undefined}
        isReplyOpen={isReplyOpen}
      />
      {cardActions && <div className="mt-1.5">{cardActions(parent)}</div>}
      {clusterSiblings.length > 0 && (
        <button
          type="button"
          onClick={() => setStackOpen((v) => !v)}
          aria-expanded={stackOpen}
          className="min-touch-coarse mt-1.5 ml-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface-deep/60 px-2 py-0.5 text-xs text-sub hover:text-text"
        >
          {stackOpen ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
          <span>
            {stackOpen ? "Hide" : "Show"} +{clusterSiblings.length} similar
          </span>
        </button>
      )}
      {stackOpen && clusterSiblings.length > 0 && (
        <div className="ml-2 sm:ml-4 mt-2 flex flex-col gap-2">
          {clusterSiblings.map((sib) => (
            <article key={sib.id} aria-label={kudosAriaLabel(sib)}>
              <KudosCard
                kudos={sib}
                compact
                viewerProfileId={viewerProfileId}
                onAddReaction={onAddReaction}
              />
            </article>
          ))}
        </div>
      )}
      {isReplyOpen && onSendReply && (
        <KudosThreadReply
          parent={parent}
          fromName={replyFromName ?? "Me"}
          fromProfileId={replyFromProfileId}
          onSend={onSendReply}
          onSent={() => onToggleReply(parent.id)}
        />
      )}
      {replies.length > 0 && (
        <div className="ml-3 sm:ml-6 mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
          {replies.map((r) => (
            <article key={r.id} aria-label={kudosAriaLabel(r)}>
              <KudosCard
                kudos={r}
                compact
                viewerProfileId={viewerProfileId}
                onAddReaction={onAddReaction}
              />
            </article>
          ))}
        </div>
      )}
    </article>
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
