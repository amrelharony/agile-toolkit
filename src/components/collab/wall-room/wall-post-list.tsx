"use client";

/**
 * The posts on a wall, most votes first: each one's text (React text only,
 * never HTML), its votes, and the texts the host merged into it. No name
 * or member id is on any post.
 *
 * A participant's list marks their own posts ("Your post", with Take it
 * back) and offers an upvote toggle on everyone else's. The host's list
 * offers Hide or Show again, and Merge into another post (for duplicates):
 * the list only picks the post, the Merge button asks first, because a
 * merge can't be split again.
 */

import { useId, useState } from "react";
import { ArrowBigUp, Combine, Eye, EyeOff, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import type { WallPost } from "@/lib/realtime/wall-room/protocol";

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
  /** Host: take a post off the wall, or put it back. */
  onHide?: (id: string, hidden: boolean) => void;
  /** Host: merge one post into another. */
  onMerge?: (fromId: string, intoId: string) => void;
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
  onHide,
  onMerge,
  emptyText = "No posts yet.",
}: WallPostListProps) {
  const [asked, setAsked] = useState<{ from: string; into: string } | null>(null);
  if (posts.length === 0) return <p className="text-sm text-sub">{emptyText}</p>;
  const host = Boolean(onHide || onMerge);
  const askedFrom = asked ? posts.find((p) => p.id === asked.from) : undefined;
  const askedInto = asked ? posts.find((p) => p.id === asked.into) : undefined;
  return (
    <>
      <ol className="space-y-2">
        {posts.map((post) => {
          const own = mine?.has(post.id) ?? false;
          const voted = myVotes?.has(post.id) ?? false;
          const others = posts.filter((p) => p.id !== post.id && !p.hidden);
          return (
            <li
              key={post.id}
              className={cn(
                "space-y-2 rounded-lg border border-border bg-card p-3",
                own && "border-accent",
                post.hidden && "opacity-60"
              )}
            >
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
            </li>
          );
        })}
      </ol>
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
