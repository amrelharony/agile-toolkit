"use client";

/**
 * "Run a feedback room": an Audience Wall room for the review's
 * stakeholders, one demo item per round (or the whole increment). They post
 * from their phones, without names. Nothing reaches the Feedback tab until
 * the host presses Save round, and then only after picking what kind of
 * feedback the round's posts are (no default, as for a typed item); each
 * post becomes a feedback item from "Feedback room", most upvoted first,
 * and the kit's Undo takes the whole round back out.
 *
 * Sprint Review hosts no room of its own: this is the Audience Wall's room
 * kind and channel (`tool="audience-wall"`), loaded only when asked for.
 */

import { useEffect, useId, useRef, useState } from "react";
import { WallRoomHost } from "@/components/collab/wall-room/wall-room-host";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import type { WallRoundResult } from "@/lib/realtime/wall-room/protocol";
import { CATEGORY_LABELS, FEEDBACK_CATEGORIES } from "../constants";
import { shortName } from "../doc";
import type { FeedbackCategory, FeedbackItem, ReviewSource } from "../types";
import { FEEDBACK_MAX } from "./feedback-form";

/** Who the imported feedback is from: the room, never a person. */
export const FEEDBACK_ROOM_STAKEHOLDER = "Feedback room";

/** The whole increment's prompt, and one per demo item with a name. */
export function feedbackRoomPrompts(features: readonly { name: string }[]): string[] {
  const items = features
    .map((f) => f.name.trim())
    .filter(Boolean)
    .map((name) => `What do you think of “${shortName(name, 80)}”?`);
  return Array.from(new Set(["What do you think of what we showed today?", ...items]));
}

/** A room post as feedback: its text, and the duplicates merged into it. */
export function feedbackFromPost(p: WallRoundResult["posts"][number]): string {
  const also = p.merged.length > 0 ? ` (also: ${p.merged.join("; ")})` : "";
  const text = `${p.text}${also}`;
  return text.length > FEEDBACK_MAX ? `${text.slice(0, FEEDBACK_MAX - 1).trimEnd()}…` : text;
}

/** The round's posts as feedback items of `category`, most upvoted first. */
export function feedbackFromRound(
  result: WallRoundResult,
  category: FeedbackCategory,
  newId: () => string = () => crypto.randomUUID()
): FeedbackItem[] {
  return result.posts.map((p) => ({
    id: newId(),
    stakeholder: FEEDBACK_ROOM_STAKEHOLDER,
    feedback: feedbackFromPost(p),
    category,
  }));
}

export function FeedbackRoom({
  source,
  crypto: cryptoImpl,
}: {
  source: ReviewSource;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}) {
  const { doc, writer } = source;
  const { log } = useHistoryLogger("sprint-review");
  const announce = useAnnounce();
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [problem, setProblem] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const kindId = useId();

  const save = (result: WallRoundResult) => {
    if (!category) {
      setProblem("Pick what kind of feedback these posts are, then save the round.");
      document.getElementById(kindId)?.focus();
      return false;
    }
    const items = feedbackFromRound(result, category);
    if (items.length === 0) return false;
    const ids = new Set(items.map((i) => i.id));
    writer.update((d) => ({ ...d, feedbackItems: [...d.feedbackItems, ...items] }));
    log(SPRINT_REVIEW_ACTIONS.FEEDBACK_ADDED, { category, count: items.length, from: "room" });
    setProblem(null);
    // Each round is filed on purpose: the next one asks again.
    setCategory("");
    announce(
      `Added ${items.length} ${CATEGORY_LABELS[category].toLowerCase()} ${
        items.length === 1 ? "item" : "items"
      } from the room to the feedback.`
    );
    return () =>
      writer.update((d) => ({
        ...d,
        feedbackItems: d.feedbackItems.filter((f) => !ids.has(f.id)),
      }));
  };

  return (
    <div className="space-y-3">
      <WallRoomHost
        tool="audience-wall"
        toolName="Audience Wall"
        startLabel="Open the feedback room"
        description="Stakeholders post feedback from their phones, without names. Ask about one demo item per round. Nothing reaches the Feedback tab until you press Save round."
        defaultPrompt={feedbackRoomPrompts(doc.features)[0]}
        promptSuggestions={feedbackRoomPrompts(doc.features)}
        defaultMode="hidden"
        crypto={cryptoImpl}
        onSave={save}
      >
        {() => <RoomStarted onStart={() => setStarted(true)} />}
      </WallRoomHost>
      {started && (
        // Outside the room's panel, so it stays for a Save round after the room ends.
        <div className="space-y-1">
          <label htmlFor={kindId} className="text-sm font-medium text-text">
            File each round&apos;s posts as
          </label>
          <select
            id={kindId}
            className="block min-h-11 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm text-text"
            value={category}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${kindId}-problem` : `${kindId}-hint`}
            onChange={(e) => {
              setCategory(e.target.value as FeedbackCategory | "");
              setProblem(null);
            }}
          >
            <option value="">Pick a kind</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          {problem ? (
            <p id={`${kindId}-problem`} role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : (
            <p id={`${kindId}-hint`} className="text-xs text-sub">
              Ask for one kind per round (what landed well, concerns, or suggestions), then pick it
              here before Save round.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Tells the panel the room is live (its controls mount only then). */
function RoomStarted({ onStart }: { onStart: () => void }) {
  const ref = useRef(onStart);
  ref.current = onStart;
  useEffect(() => ref.current(), []);
  return null;
}
