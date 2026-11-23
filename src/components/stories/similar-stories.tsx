"use client";

/**
 * "Like this one": finished stories that read like the story being sized,
 * with the points they took and the words both mention, so a size can be
 * argued from the team's own work. When none reads alike it falls back to
 * the Estimation Guide's reference stories ("3 · Login page").
 *
 * Read only: it writes nothing. Ask Amr (or "Find similar without AI")
 * replaces the list with picks, marked with where they came from; a pick
 * is kept only when it names one of the stories offered, and its points
 * always come from the store, never from the answer. Without AI the picks
 * are this panel's own word match, which reads every story's notes; the
 * task's fallback sees only the titles the request carries, so it could
 * miss a match the list had just shown.
 *
 * Planning Poker shows it to the host after Reveal (never before: a size
 * on screen would anchor the votes) and never in a visitor room; Refinement
 * beside a story with no points.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { AiButton, type AiResultMeta } from "@/components/ai";
import { Button } from "@/components/ui/button";
import {
  pokerSimilarInput,
  pokerSimilarTask,
  sharesLine,
  type PokerSimilarOutput,
} from "@/lib/ai/tasks/planning-poker.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { formatPoints, isNumericDeck } from "@/lib/estimation/three-point";
import { similarHint, type ReferencePins, type SimilarTarget } from "@/lib/estimation/similar";
import type { Story } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/** What the hint compares with. */
export interface SimilarSource {
  /** The workspace's stories; the done ones with points are compared with. */
  stories: readonly Story[];
  /** The Estimation Guide's pins on the deck's cards, for the fallback. */
  references?: ReferencePins;
}

const pts = (n: number | undefined) =>
  n === undefined ? "" : `${formatPoints(n)} ${n === 1 ? "pt" : "pts"}`;

interface Picks {
  /** The story the picks were for: a new story drops them. */
  for: string;
  source: AiSource;
  items: { id: string; why: string }[];
}

export function SimilarStories({
  target,
  source,
  className,
}: {
  target: SimilarTarget;
  source: SimilarSource;
  className?: string;
}) {
  const { id, title, notes } = target;
  const { stories, references } = source;
  const hint = useMemo(
    () => similarHint({ id, title, notes }, stories, references),
    [id, title, notes, stories, references]
  );
  const input = useMemo(
    () => pokerSimilarInput({ id, title, notes }, stories),
    [id, title, notes, stories]
  );
  const targetKey = `${id ?? ""}\u0000${title}`;
  const [picks, setPicks] = useState<Picks | null>(null);
  const shown = picks?.for === targetKey ? picks : null;
  // "Show the word match again" goes away when pressed: focus moves to the
  // panel's label first, so a keyboard user keeps their place.
  const labelRef = useRef<HTMLParagraphElement>(null);
  const showWordMatch = useCallback(() => {
    labelRef.current?.focus();
    setPicks(null);
  }, []);

  const onResult = useCallback(
    (data: PokerSimilarOutput, meta: AiResultMeta) => {
      if (meta.source === "fallback") {
        // The word match the list shows, notes and all, so the answer
        // without AI never contradicts it.
        const words = hint.kind === "similar" ? hint.items : [];
        setPicks({
          for: targetKey,
          source: "fallback",
          items: words.map((m) => ({ id: m.story.id, why: sharesLine(m.shared) })),
        });
        return;
      }
      // Only stories that were offered, each once, in the answer's order.
      const offered = new Set(input.candidates.map((c) => c.id));
      const seen = new Set<string>();
      const items = data.matches.filter((m) => {
        if (!offered.has(m.id) || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      setPicks({ for: targetKey, source: meta.source, items });
    },
    [hint, input, targetKey]
  );

  const byId = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const canAsk = input.candidates.length > 0 && input.story.title !== "";
  // The guide pins reference stories on points cards only, so a T-shirt
  // deck gets no advice it can't follow.
  const canPin = references !== undefined && isNumericDeck(references.cards);
  // Nothing to compare with and nothing to ask about: no panel at all.
  if (hint.kind === "none" && !canAsk) return null;

  return (
    <section
      aria-label="Like this one"
      className={cn("mt-3 rounded-lg border border-border bg-surface-deep p-3 text-sm", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          ref={labelRef}
          tabIndex={-1}
          className="text-xs font-medium uppercase tracking-wider text-sub outline-none"
        >
          Like this one
        </p>
        {canAsk && (
          <AiButton
            task={pokerSimilarTask}
            input={input}
            onResult={onResult}
            fallbackLabel="Find similar without AI"
            variant="outline"
          />
        )}
      </div>

      {shown ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-sub">
            {shown.source === "ai" ? "Picked by Amr." : "Found without AI, by shared words."}
          </p>
          {shown.items.length > 0 ? (
            <ul className="space-y-1.5">
              {shown.items.map((m) => {
                const story = byId.get(m.id);
                if (!story) return null;
                return (
                  <li key={m.id} className="break-words">
                    <span className="text-text">{story.title}</span>
                    <span className="text-sub"> · {pts(story.points)}</span>
                    {m.why && <span className="block text-xs text-sub">{m.why}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-text">No finished story is like this one.</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 pointer-coarse:min-h-11"
            onClick={showWordMatch}
          >
            <RotateCcw aria-hidden="true" />
            Show the word match again
          </Button>
        </div>
      ) : hint.kind === "similar" ? (
        <div className="mt-2 space-y-1.5">
          <ul className="space-y-1.5">
            {hint.items.map((m) => (
              <li key={m.story.id} className="break-words">
                <span className="text-text">{m.story.title}</span>
                <span className="text-sub"> · {pts(m.story.points)}</span>
                {m.shared.length > 0 && (
                  <span className="block text-xs text-sub">
                    Both mention: {m.shared.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {hint.items.length > 1 && (
            <p className="text-xs text-sub">
              Middle of these: <span className="font-data text-text">{pts(hint.medianPoints)}</span>
              .
            </p>
          )}
        </div>
      ) : hint.kind === "reference" ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-sub">
            No finished story reads like this one yet. Your reference stories:
          </p>
          <ul className="space-y-0.5">
            {hint.items.map((r, i) => (
              <li key={`${r.card}-${i}`} className="break-words text-text">
                <span className="font-data">{r.card}</span> · {r.title}
                {r.example && <span className="text-sub"> (example)</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : canPin ? (
        <p className="mt-2 text-xs text-sub">
          No finished story reads like this one yet. Pin reference stories in the{" "}
          <Link href="/estimation-guide" className="text-accent underline-offset-4 hover:underline">
            Estimation Guide
          </Link>{" "}
          to compare with.
        </p>
      ) : (
        <p className="mt-2 text-xs text-sub">No finished story reads like this one yet.</p>
      )}
    </section>
  );
}
