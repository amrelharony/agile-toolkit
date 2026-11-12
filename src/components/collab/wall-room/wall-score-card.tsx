"use client";

/**
 * A participant's 25/10 scoring: the five posts this tab scores (picked at
 * random once, the same five after a reload), each with a 1 to 5 scale.
 * A score can be changed until the host shows the totals. Nobody else sees
 * who gave which score; the room sees only each post's average, later.
 */

import { ScalePicker, type ScaleStep } from "@/components/shared/scale-picker";
import { WALL_LIMITS, type WallPost } from "@/lib/realtime/wall-room/protocol";

export interface WallScoreCardProps {
  /** The posts on the wall. */
  posts: readonly WallPost[];
  /** The ids this tab scores (`room.toScore`). */
  toScore: readonly string[];
  /** This tab's scores so far. */
  myScores: ReadonlyMap<string, number>;
  onScore: (postId: string, value: number) => void;
}

export const WALL_SCORE_STEPS: readonly ScaleStep[] = [
  { value: 1, name: "Not for us", meaning: "1: leave it" },
  { value: 2, meaning: "2: a little" },
  { value: 3, meaning: "3: worth a look" },
  { value: 4, meaning: "4: strong" },
  { value: 5, name: "Do it", meaning: "5: the one to do first" },
];

export function WallScoreCard({ posts, toScore, myScores, onScore }: WallScoreCardProps) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const picked = toScore.map((id) => byId.get(id)).filter((p): p is WallPost => Boolean(p));
  const done = picked.filter((p) => myScores.has(p.id)).length;
  if (toScore.length === 0) {
    return (
      <p className="text-sm text-sub">
        There are no posts for you to score: the others on the wall are yours.
      </p>
    );
  }
  return (
    <section aria-label="Score these posts" className="space-y-3">
      <p className="text-sm text-sub" aria-live="polite">
        Score each post from 1 to {WALL_LIMITS.maxScore}: {done} of {picked.length} scored. You can
        change a score until the host shows the totals.
      </p>
      {picked.length < toScore.length && (
        <p className="text-xs text-sub">Some of your posts to score left the wall.</p>
      )}
      <ol className="space-y-3">
        {picked.map((p, i) => (
          <li key={p.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
            <p className="whitespace-pre-wrap break-words text-sm text-text">{p.text}</p>
            <ScalePicker
              label={`Post ${i + 1} of ${picked.length}`}
              steps={WALL_SCORE_STEPS}
              value={myScores.get(p.id) ?? null}
              onValueChange={(v) => onScore(p.id, v)}
              size="sm"
              optionsClassName="grid grid-cols-5 sm:inline-flex"
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
