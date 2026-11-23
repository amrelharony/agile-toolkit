"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { IconButton } from "@/components/ui/icon-button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  RELATIVE_SIZING_AI,
  sizingDiscussTask,
  sizingSplitTask,
  type DiscussInput,
  type SplitInput,
} from "@/lib/ai/tasks/relative-sizing.lite";
import { bucketOf } from "@/lib/relative-sizing/model";
import type { SizingBoard, SizingItem } from "@/lib/relative-sizing/state";

/**
 * Under a card to talk about: questions to ask about it (from the room's
 * totals and the card's own text, on this screen only: nothing reaches the
 * room) and smaller stories to split it into, accepted as new cards with
 * Undo. Both work without AI.
 */
export function TalkAbout({
  board,
  item,
  notes,
  onSplit,
}: {
  board: SizingBoard;
  item: SizingItem;
  /** The story's notes, when it is a workspace story. */
  notes?: string;
  /** Add the accepted titles as new cards; returns an undo. */
  onSplit: (titles: string[]) => void;
}) {
  const announce = useAnnounce();
  const [questions, setQuestions] = useState<{ items: string[]; source: AiSource } | null>(null);
  const [splits, setSplits] = useState<{ items: string[]; source: AiSource } | null>(null);
  const cap = (t: string, max: number) => t.slice(0, max);

  const discussInput = (): DiscussInput => ({
    title: cap(item.title, RELATIVE_SIZING_AI.title),
    buckets: board.buckets.map((b) => cap(b.label, RELATIVE_SIZING_AI.label)),
    counts: board.buckets.map((_, i) =>
      Math.min(RELATIVE_SIZING_AI.count, item.room?.counts[i] ?? 0)
    ),
    moves: Math.min(RELATIVE_SIZING_AI.moves, item.moves),
  });
  const splitInput = (): SplitInput => ({
    title: cap(item.title, RELATIVE_SIZING_AI.title),
    notes: cap(notes ?? "", RELATIVE_SIZING_AI.notes),
    bucket: cap(bucketOf(board, item)?.label ?? "", RELATIVE_SIZING_AI.label),
  });

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex flex-wrap gap-2">
        <AiButton
          task={sizingDiscussTask}
          input={discussInput}
          label="Ask Amr what to ask"
          fallbackLabel="Questions to ask"
          variant="outline"
          onResult={(data, meta) => {
            setQuestions({ items: data.questions, source: meta.source });
            announce(`${data.questions.length} questions to ask about “${item.title}”, below.`);
          }}
        />
        <AiButton
          task={sizingSplitTask}
          input={splitInput}
          label="Ask Amr to split it"
          fallbackLabel="Split it without AI"
          variant="outline"
          onResult={(data, meta) => {
            setSplits({ items: data.titles, source: meta.source });
            announce(`${data.titles.length} smaller stories below. Add the ones that fit.`);
          }}
        />
      </div>
      {questions && (
        <div className="rounded-md border border-border bg-surface p-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-text">
              Questions to ask{questions.source === "fallback" ? " (suggested without AI)" : ""}
            </p>
            <IconButton
              label="Close the questions"
              icon={<X aria-hidden="true" />}
              variant="ghost"
              size="icon"
              onClick={() => setQuestions(null)}
            />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-text">
            {questions.items.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {splits && (
        <AiSuggestions
          items={splits.items}
          source={splits.source}
          title="Smaller stories"
          onAccept={(t) => onSplit([t])}
          onAcceptAll={(all) => onSplit(all)}
          onDismiss={() => setSplits(null)}
        />
      )}
    </div>
  );
}
