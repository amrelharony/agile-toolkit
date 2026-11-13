"use client";

/**
 * The Lean Coffee runner, on a board in the `lean-coffee` format.
 *
 * Write and Vote: topics go in To Discuss and are dot-voted with the
 * board's own votes. Ask Amr (or the common words, without AI) groups
 * topics that are the same; the host merges the groups it agrees with,
 * each with Undo, so the team discusses them once.
 *
 * Discuss: the topics in vote order, one at a time. Start puts the next one
 * in Discussing and runs the board's timer for its timebox (7 minutes by
 * default). When the time is up (the board rings the shared alarm), the
 * room votes thumbs up to keep going (3 more minutes) or thumbs down to
 * move on: in a live room every phone gets the vote (the room's thumbs, a
 * protocol revision that older tabs simply don't show); on one screen the
 * facilitator counts the thumbs held up. The facilitator decides, the
 * totals as a guide.
 *
 * The room's vote opens on its own only for a topic the runner started (in
 * Discussing and marked as the one being discussed), when its timebox ran
 * out in Discuss, and its text comes from the cards this screen shows: a
 * card hidden while people write never reaches the room's phones. While
 * the vote is open, the host's screen shows how many voted, not the split,
 * so a shared screen can't tie a thumb to whoever just tapped.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Coffee, Play, SkipForward, ThumbsDown, ThumbsUp, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiButton, AiSuggestions } from "@/components/ai";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { groupTopicsTask } from "@/lib/ai/tasks/retro";
import type { AiSource } from "@/lib/ai/task-types";
import {
  LEAN_COFFEE_EXTEND_CHOICES,
  LEAN_COFFEE_TIMEBOX_CHOICES,
  currentTopic,
  doneTopics,
  leanTopics,
  thumbsDecision,
  topicQueue,
  withTopicDone,
  withTopicExtended,
  withTopicStarted,
  withTopicsMerged,
  type LeanTopic,
} from "@/lib/retro/lean-coffee";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import type { BoardState, RetroCard } from "../types";
import { useLeanCoffeeSettings } from "../lean-coffee-store";
import type { RetroThumbsHost } from "../room/use-retro-room";
import { thumbsVerdict } from "../room/thumbs-vote-card";

/**
 * History actions the runner logs. Not in RETRO_ACTIONS
 * (lib/history/event-actions.ts) yet; named like the events that are.
 */
export const LEAN_COFFEE_LOG = {
  TOPIC_STARTED: "topic_started",
  TOPIC_EXTENDED: "topic_extended",
  TOPIC_DONE: "topic_done",
  TOPICS_MERGED: "topics_merged",
} as const;

const short = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

function MinutesPicker({
  label,
  groupLabel,
  value,
  choices,
  onChange,
}: {
  label: string;
  /** The group's name for screen readers (the board's own timer has a "Timebox" group). */
  groupLabel: string;
  value: number;
  choices: readonly number[];
  onChange: (min: number) => void;
}) {
  return (
    <div role="group" aria-label={groupLabel} className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-sub" aria-hidden="true">
        {label}
      </span>
      {choices.map((m) => (
        <Button
          key={m}
          type="button"
          size="sm"
          variant={value === m ? "default" : "outline"}
          aria-pressed={value === m}
          className="h-7 px-2 text-xs"
          onClick={() => onChange(m)}
        >
          {m} min
        </Button>
      ))}
    </div>
  );
}

/** The cards' grouping and columns before a merge, for its Undo. */
function placesOf(cards: readonly RetroCard[], ids: ReadonlySet<string>) {
  return cards
    .filter((c) => ids.has(c.id) || (c.groupedWith !== null && ids.has(c.groupedWith)))
    .map((c) => ({ id: c.id, groupedWith: c.groupedWith, columnKey: c.columnKey }));
}

export function LeanCoffeeRunner({
  state,
  shownCards,
  onUpdate,
  timeUp,
  thumbs,
  log,
}: {
  state: BoardState;
  /** The cards this screen shows (a live room hides the others' while they write). */
  shownCards: readonly RetroCard[];
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  /** The board's timer ran out and hasn't been set again. */
  timeUp: boolean;
  /** A live room's thumbs vote; null on one screen. */
  thumbs: RetroThumbsHost | null;
  log: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const settings = useLeanCoffeeSettings();
  const queue = useMemo(() => topicQueue(shownCards), [shownCards]);
  const current = useMemo(() => currentTopic(shownCards), [shownCards]);
  const done = useMemo(() => doneTopics(shownCards), [shownCards]);
  // The topic the runner started: in Discussing and marked as discussed (a
  // card someone dropped in Discussing isn't one until it's started).
  const started =
    state.phase === "discuss" &&
    current !== null &&
    shownCards.some((c) => c.id === current.id && c.discussing)
      ? current
      : null;
  const next = queue[0] ?? null;
  const [extensions, setExtensions] = useState<{ topicId: string; count: number } | null>(null);
  const extendedTimes = current && extensions?.topicId === current.id ? extensions.count : 0;
  // On one screen: the thumbs the facilitator counts by hand.
  const [hand, setHand] = useState({ keep: 0, move: 0 });
  const [groups, setGroups] = useState<{
    items: { title: string; topicIds: string[] }[];
    source: AiSource;
  } | null>(null);

  // Which phase the timebox ran out in: a writing or voting timebox that
  // ended before Discuss isn't a topic's time being up.
  const upInRef = useRef<BoardState["phase"] | null>(null);
  useEffect(() => {
    if (!timeUp) upInRef.current = null;
    else if (upInRef.current === null) upInRef.current = state.phase;
  }, [timeUp, state.phase]);

  // At time-up a live room gets the vote on every phone, once per timebox
  // of a topic the runner started, and only in Discuss.
  const askedRef = useRef<string | null>(null);
  const roomPoll = thumbs?.poll ?? null;
  useEffect(() => {
    if (!timeUp || !started || !thumbs) return;
    if (state.phase !== "discuss" || upInRef.current !== "discuss") return;
    const key = `${started.id}:${extendedTimes}`;
    if (askedRef.current === key) return;
    askedRef.current = key;
    thumbs.open(started.text);
    announce("Time's up. The room is voting: keep going or move on?");
  }, [timeUp, started, thumbs, extendedTimes, announce, state.phase]);

  const start = (topic: LeanTopic) => {
    const seconds = settings.timeboxMin * 60;
    onUpdate((prev) => withTopicStarted(prev, topic.id, seconds));
    setExtensions({ topicId: topic.id, count: 0 });
    setHand({ keep: 0, move: 0 });
    thumbs?.clear();
    log(LEAN_COFFEE_LOG.TOPIC_STARTED, { cardId: topic.id, minutes: settings.timeboxMin });
    announce(`Now discussing “${short(topic.text)}” for ${settings.timeboxMin} minutes.`);
  };

  const keepGoing = () => {
    if (!current) return;
    const seconds = settings.extendMin * 60;
    onUpdate((prev) => withTopicExtended(prev, seconds));
    setExtensions({ topicId: current.id, count: extendedTimes + 1 });
    setHand({ keep: 0, move: 0 });
    thumbs?.clear();
    log(LEAN_COFFEE_LOG.TOPIC_EXTENDED, { cardId: current.id, minutes: settings.extendMin });
    announce(`${settings.extendMin} more minutes on “${short(current.text)}”.`);
  };

  const moveOn = () => {
    if (!current) return;
    const following = queue.find((t) => t.id !== current.id) ?? null;
    onUpdate((prev) => {
      const finished = withTopicDone(prev, current.id);
      return following
        ? withTopicStarted(finished, following.id, settings.timeboxMin * 60)
        : finished;
    });
    setHand({ keep: 0, move: 0 });
    thumbs?.clear();
    log(LEAN_COFFEE_LOG.TOPIC_DONE, { cardId: current.id, extended: extendedTimes });
    if (following) {
      setExtensions({ topicId: following.id, count: 0 });
      log(LEAN_COFFEE_LOG.TOPIC_STARTED, { cardId: following.id, minutes: settings.timeboxMin });
      announce(
        `Done. Now discussing “${short(following.text)}” for ${settings.timeboxMin} minutes.`
      );
    } else {
      announce("That was the last topic. Move on to Actions when you're ready.");
    }
  };

  const merge = (group: { title: string; topicIds: string[] }) => {
    const ids = new Set(group.topicIds);
    const before = placesOf(state.cards, ids);
    undoable({
      label: `Merged ${group.topicIds.length} topics`,
      description: `“${short(group.title, 40)}”`,
      kind: "success",
      apply: () => {
        onUpdate((prev) => withTopicsMerged(prev, group.topicIds));
        log(LEAN_COFFEE_LOG.TOPICS_MERGED, { cardIds: group.topicIds, title: group.title });
      },
      revert: () =>
        onUpdate((prev) => {
          const was = new Map(before.map((b) => [b.id, b]));
          return {
            ...prev,
            cards: prev.cards.map((c) => {
              const b = was.get(c.id);
              return b ? { ...c, groupedWith: b.groupedWith, columnKey: b.columnKey } : c;
            }),
          };
        }),
    });
    announce(`Merged into “${short(group.title)}”.`);
  };

  // ── Write and Vote: grouping the topics ──
  if (state.phase === "write" || state.phase === "vote") {
    const topics = leanTopics(shownCards).filter((t) => t.columnKey === "to-discuss");
    const byId = new Map(topics.map((t) => [t.id, t]));
    const live = (groups?.items ?? [])
      .map((g) => ({ ...g, topicIds: g.topicIds.filter((id) => byId.has(id)) }))
      .filter((g) => g.topicIds.length >= 2);
    return (
      <section
        aria-label="Lean Coffee"
        className="space-y-3 rounded-lg border border-border bg-card px-4 py-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm text-text">
            <Coffee className="h-4 w-4 text-accent" aria-hidden="true" />
            {state.phase === "write"
              ? "Lean Coffee: everyone writes topics in To Discuss, then the team dot-votes them."
              : "Lean Coffee: dot-vote the topics. In Discuss they're taken in vote order, one timebox each."}
          </p>
          <AiButton
            task={groupTopicsTask}
            input={() => ({
              topics: topics.slice(0, 100).map((t) => ({
                id: t.id.slice(0, 64),
                text: t.text.slice(0, 500),
                votes: Math.min(999, t.votes),
              })),
            })}
            label="Ask Amr to group similar topics"
            fallbackLabel="Group similar topics without AI"
            variant="outline"
            disabledReason={topics.length < 2 ? "Add at least two topics first." : null}
            onResult={(data, meta) => {
              setGroups({ items: data.groups, source: meta.source });
              const n = data.groups.length;
              announce(
                n === 0
                  ? "No topics look the same."
                  : `${n} ${n === 1 ? "group" : "groups"} of similar topics below.`
              );
            }}
          />
        </div>
        {groups &&
          (live.length > 0 ? (
            <AiSuggestions
              items={live}
              source={groups.source}
              title="Topics that look the same"
              acceptLabel="Merge"
              render={(g) => ({
                title: g.title,
                detail: g.topicIds
                  .map((id) => `“${short(byId.get(id)?.text ?? "", 40)}”`)
                  .join(" · "),
              })}
              onAccept={(g) => merge(g)}
              onDismiss={() => setGroups(null)}
            />
          ) : (
            <p role="status" className="text-xs text-sub">
              No topics look the same. Nothing to merge.
            </p>
          ))}
      </section>
    );
  }

  if (state.phase !== "discuss") return null;

  // ── Discuss: one topic at a time ──
  // The room's split counts once its vote is closed; until then the host's
  // screen shows only how many voted.
  const tally = thumbs ? (roomPoll && !roomPoll.open ? roomPoll : null) : timeUp ? hand : null;
  const decision = tally ? thumbsDecision(tally) : "none";
  return (
    <section
      aria-label="Lean Coffee"
      className="space-y-3 rounded-lg border border-accent/40 bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-text">
          <Coffee className="h-4 w-4 text-accent" aria-hidden="true" />
          Lean Coffee
        </h3>
        <div className="flex flex-wrap gap-3">
          <MinutesPicker
            label="Timebox"
            groupLabel="Minutes per topic"
            value={settings.timeboxMin}
            choices={LEAN_COFFEE_TIMEBOX_CHOICES}
            onChange={settings.setTimebox}
          />
          <MinutesPicker
            label="Then"
            groupLabel="Minutes each keep going adds"
            value={settings.extendMin}
            choices={LEAN_COFFEE_EXTEND_CHOICES}
            onChange={settings.setExtend}
          />
        </div>
      </div>

      {current ? (
        <div className="space-y-2">
          <p className="text-sm text-text">
            <span className="font-semibold">Now:</span> {current.text}{" "}
            <span className="text-xs text-sub">
              · {current.votes} {current.votes === 1 ? "vote" : "votes"}
              {extendedTimes > 0
                ? ` · kept going ${extendedTimes === 1 ? "once" : `${extendedTimes} times`}`
                : ""}
            </span>
          </p>
          {timeUp ? (
            <div className="space-y-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2">
              <p className="text-sm font-semibold text-text">
                Time&apos;s up. Keep going or move on?
              </p>
              {thumbs ? (
                roomPoll ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {roomPoll.open ? (
                      <p role="status" className="text-sm text-text">
                        {roomPoll.voters} {roomPoll.voters === 1 ? "person has" : "people have"}{" "}
                        voted so far.
                      </p>
                    ) : (
                      <p role="status" className="text-sm text-text">
                        <ThumbsUp className="mr-1 inline h-4 w-4" aria-hidden="true" />
                        Keep going {roomPoll.keep} ·{" "}
                        <ThumbsDown className="mr-1 inline h-4 w-4" aria-hidden="true" />
                        Move on {roomPoll.move}{" "}
                        <span className="text-xs text-sub">({roomPoll.voters} voted)</span>
                      </p>
                    )}
                    {roomPoll.open ? (
                      <Button type="button" size="sm" variant="outline" onClick={thumbs.close}>
                        Close the vote and show everyone
                      </Button>
                    ) : (
                      <span className="text-xs text-sub">{thumbsVerdict(roomPoll)}</span>
                    )}
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => thumbs.open(current.text)}
                  >
                    Ask the room again
                  </Button>
                )
              ) : (
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Count the thumbs"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setHand((h) => ({ ...h, keep: h.keep + 1 }))}
                    aria-label={`One more thumb up, ${hand.keep} so far`}
                  >
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    {hand.keep}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setHand((h) => ({ ...h, move: h.move + 1 }))}
                    aria-label={`One more thumb down, ${hand.move} so far`}
                  >
                    <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                    {hand.move}
                  </Button>
                  {(hand.keep > 0 || hand.move > 0) && (
                    <>
                      <span role="status" className="text-xs text-sub">
                        {thumbsVerdict(hand)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setHand({ keep: 0, move: 0 })}
                      >
                        Count again
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={decision === "keep" ? "default" : "outline"}
                  className="gap-1.5"
                  onClick={keepGoing}
                >
                  <TimerReset className="h-4 w-4" aria-hidden="true" />
                  Keep going ({settings.extendMin} min)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={decision === "move" ? "default" : "outline"}
                  className="gap-1.5"
                  onClick={moveOn}
                >
                  <SkipForward className="h-4 w-4" aria-hidden="true" />
                  {queue.some((t) => t.id !== current.id) ? "Move on to the next topic" : "Move on"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={moveOn}
              >
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                {next ? "Done, next topic" : "Done with this topic"}
              </Button>
              {thumbs && !roomPoll && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => thumbs.open(current.text)}
                >
                  Ask the room now
                </Button>
              )}
            </div>
          )}
        </div>
      ) : next ? (
        <div className="space-y-2">
          <p className="break-words text-sm text-text">
            <span className="font-semibold">Next:</span> {next.text}{" "}
            <span className="text-xs text-sub">
              · {next.votes} {next.votes === 1 ? "vote" : "votes"}
            </span>
          </p>
          <Button
            type="button"
            className="gap-1.5"
            onClick={() => start(next)}
            aria-label={`${done.length === 0 ? "Start the first topic" : "Start the next topic"}: ${short(next.text, 40)}`}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {done.length === 0 ? "Start the first topic" : "Start the next topic"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-sub">
          {done.length > 0
            ? "Every topic has been discussed. Move on to Actions to agree what you'll do."
            : "No topics in To Discuss yet. Go back to Write to add some."}
        </p>
      )}

      {queue.filter((t) => t.id !== current?.id).length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sub">Up next</p>
          <ol className="mt-1 space-y-0.5 text-sm text-text">
            {queue
              .filter((t) => t.id !== current?.id)
              .map((t, i) => (
                <li key={t.id} className={cn("break-words", i > 0 && "text-sub")}>
                  {i + 1}. {t.text}{" "}
                  <span className="text-xs text-sub">
                    · {t.votes} {t.votes === 1 ? "vote" : "votes"}
                  </span>
                </li>
              ))}
          </ol>
        </div>
      )}
      {done.length > 0 && (
        <p className="text-xs text-sub">
          Discussed: {done.length} {done.length === 1 ? "topic" : "topics"}.
        </p>
      )}
    </section>
  );
}
