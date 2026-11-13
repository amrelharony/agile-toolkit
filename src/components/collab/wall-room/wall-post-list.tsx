"use client";

/**
 * The posts on a wall, most votes first: each one's text (React text only,
 * never HTML), its votes, and the texts the host merged into it. No name
 * or member id is on any post.
 *
 * A participant's list marks their own posts ("Your post", with Take it
 * back) and offers an upvote toggle on everyone else's, and in a
 * brainwriting round "Yes, and…" on each post. The host's list offers Hide
 * or Show again, Mark answered (for questions), and Merge into another post
 * (for duplicates): the list only picks the post, the Merge button asks
 * first, because a merge can't be split again.
 *
 * A "Yes, and…" post shows under the post it builds on. A question marked
 * answered says so; a 25/10 post shows its average score once the host
 * shares the totals.
 */

import { useId, useState } from "react";
import { ArrowBigUp, Check, Combine, Eye, EyeOff, MessageSquarePlus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import type { WallPost } from "@/lib/realtime/wall-room/protocol";
import { scoreText } from "@/lib/realtime/wall-room/score";

export type ListedPost = WallPost & { hidden?: boolean };

export interface WallPostListProps {
  posts: readonly ListedPost[];
  /** Participant: ids of this tab's own posts. */
  mine?: ReadonlySet<string>;
  /** Participant: ids of the posts this tab upvoted. */
  myVotes?: ReadonlySet<string>;
  /** Participant: upvotes are open (the round takes votes). */
  canVote?: boolean;
  onVote?: (id: string) => void;
  onUnvote?: (id: string) => void;
  onWithdraw?: (id: string) => void;
  /** Participant, brainwriting: post "Yes, and…" on this post. */
  onBuild?: (post: ListedPost) => void;
  /** Host: take a post off the wall, or put it back. */
  onHide?: (id: string, hidden: boolean) => void;
  /** Host: merge one post into another. */
  onMerge?: (fromId: string, intoId: string) => void;
  /** Host: mark a question answered, or not. */
  onAnswer?: (id: string, answered: boolean) => void;
  /** Shown when there are no posts. */
  emptyText?: string;
}

function votesText(n: number): string {
  return `${n} ${n === 1 ? "vote" : "votes"}`;
}

/** A post's first words, for the merge list. */
function short(text: string): string {
  return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
}

/**
 * Pick the post to merge into, then press Merge. Choosing in the list does
 * nothing by itself, so arrowing through it with the keyboard is safe.
 */
function MergeControl({
  post,
  others,
  onAsk,
}: {
  post: ListedPost;
  others: readonly ListedPost[];
  onAsk: (fromId: string, intoId: string) => void;
}) {
  const id = useId();
  const [target, setTarget] = useState("");
  // The post picked may have left the wall since.
  const into = others.some((o) => o.id === target) ? target : "";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <label htmlFor={`${id}-into`} className="text-xs text-sub">
        Merge into
      </label>
      <select
        id={`${id}-into`}
        className="min-h-9 min-w-0 max-w-[12rem] rounded-md border border-border bg-background px-2 text-xs text-text pointer-coarse:min-h-11"
        value={into}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setTarget(e.target.value)}
      >
        <option value="">Pick a post</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {short(o.text)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        disabled={!into}
        onClick={() => onAsk(post.id, into)}
      >
        <Combine className="h-4 w-4" aria-hidden="true" />
        Merge<span className="sr-only">: {short(post.text)}</span>
      </Button>
      <span id={`${id}-hint`} className="sr-only">
        Merging puts this post under the one you pick, with its votes.
      </span>
    </div>
  );
}

export function WallPostList({
  posts,
  mine,
  myVotes,
  canVote = false,
  onVote,
  onUnvote,
  onWithdraw,
  onBuild,
  onHide,
  onMerge,
  onAnswer,
  emptyText = "No posts yet.",
}: WallPostListProps) {
  const [asked, setAsked] = useState<{ from: string; into: string } | null>(null);
  if (posts.length === 0) return <p className="text-sm text-sub">{emptyText}</p>;
  const host = Boolean(onHide || onMerge || onAnswer);
  const askedFrom = asked ? posts.find((p) => p.id === asked.from) : undefined;
  const askedInto = asked ? posts.find((p) => p.id === asked.into) : undefined;

  // "Yes, and…" posts go under the post they build on, in the list's order.
  const ids = new Set(posts.map((p) => p.id));
  const replies = new Map<string, ListedPost[]>();
  const top: ListedPost[] = [];
  for (const p of posts) {
    if (p.re && p.re !== p.id && ids.has(p.re)) {
      replies.set(p.re, [...(replies.get(p.re) ?? []), p]);
    } else {
      top.push(p);
    }
  }

  const item = (post: ListedPost, reply: boolean) => {
    const own = mine?.has(post.id) ?? false;
    const voted = myVotes?.has(post.id) ?? false;
    const others = posts.filter((p) => p.id !== post.id && !p.hidden);
    const below = replies.get(post.id) ?? [];
    return (
      <li
        key={post.id}
        className={cn(
          "space-y-2 rounded-lg border border-border bg-card p-3",
          own && "border-accent",
          post.hidden && "opacity-60"
        )}
      >
        {reply && <p className="text-xs font-medium text-accent">Yes, and…</p>}
        <div className="flex min-w-0 items-start gap-3">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-text">
            {post.text}
          </p>
          <span className="shrink-0 font-data text-sm text-text">
            <span aria-hidden="true">{post.votes}</span>
            <span className="sr-only">{votesText(post.votes)}</span>
          </span>
        </div>
        {post.merged.length > 0 && (
          <ul className="space-y-1 border-l-2 border-border pl-2 text-xs text-sub">
            {post.merged.map((t, i) => (
              <li key={`${post.id}-m${i}`} className="break-words">
                {t}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {own && <span className="text-xs font-medium text-accent">Your post</span>}
          {post.answered && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Answered
            </span>
          )}
          {post.score !== undefined && (
            <span className="text-xs text-sub">Score: {scoreText(post)}</span>
          )}
          {post.hidden && <span className="text-xs text-sub">Hidden from the room</span>}
          {!host && !own && onVote && onUnvote && (
            <Button
              type="button"
              variant={voted ? "toolkit" : "outline"}
              size="sm"
              className="gap-1"
              aria-pressed={voted}
              disabled={!canVote && !voted}
              onClick={() => (voted ? onUnvote(post.id) : onVote(post.id))}
            >
              <ArrowBigUp className="h-4 w-4" aria-hidden="true" />
              Upvote<span className="sr-only">: {short(post.text)}</span>
            </Button>
          )}
          {!host && onBuild && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => onBuild(post)}
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              Yes, and… <span className="sr-only">on: {short(post.text)}</span>
            </Button>
          )}
          {!host && own && onWithdraw && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => onWithdraw(post.id)}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Take it back<span className="sr-only">: {short(post.text)}</span>
            </Button>
          )}
          {onAnswer && !post.hidden && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              aria-pressed={post.answered === true}
              onClick={() => onAnswer(post.id, !post.answered)}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Answered<span className="sr-only">: {short(post.text)}</span>
            </Button>
          )}
          {onHide && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => onHide(post.id, !post.hidden)}
            >
              {post.hidden ? (
                <Eye className="h-4 w-4" aria-hidden="true" />
              ) : (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              )}
              {post.hidden ? "Show again" : "Hide"}
              <span className="sr-only">: {short(post.text)}</span>
            </Button>
          )}
          {onMerge && !post.hidden && others.length > 0 && (
            <MergeControl
              post={post}
              others={others}
              onAsk={(from, into) => setAsked({ from, into })}
            />
          )}
        </div>
        {below.length > 0 && (
          <ol
            className="space-y-2 border-l-2 border-accent/30 pl-2 sm:pl-3"
            aria-label={`Yes, and… on: ${short(post.text)}`}
          >
            {below.map((r) => item(r, true))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <>
      <ol className="space-y-2">{top.map((post) => item(post, false))}</ol>
      {onMerge && (
        <ConfirmDialog
          open={Boolean(askedFrom && askedInto)}
          onOpenChange={(open) => {
            if (!open) setAsked(null);
          }}
          title="Merge these posts?"
          description={
            askedFrom && askedInto
              ? `"${short(askedFrom.text)}" goes under "${short(askedInto.text)}", and its votes join that post's. You can't split them again.`
              : undefined
          }
          confirmLabel="Merge posts"
          tone="default"
          onConfirm={() => {
            if (askedFrom && askedInto) onMerge(askedFrom.id, askedInto.id);
            setAsked(null);
          }}
        />
      )}
    </>
  );
}
