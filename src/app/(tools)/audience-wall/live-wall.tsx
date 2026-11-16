"use client";

/**
 * Audience Wall's live room: the wall-room kit's host panel
 * (`WallRoomHost`), set up for the kind of wall, with what each kind adds
 * under it: the word cloud for open answers, duplicate questions to merge,
 * the next speaker for raised hands, Yes, and… for brainwriting, and the
 * 25/10 scoring with its top ten.
 *
 * Amr's help here is the host's only: it reads the posts on the host's
 * screen (anonymous text), and its draft shows on that screen alone until
 * the host accepts a merge and confirms it (a merge can't be split again),
 * which is when the room sees it. While a live room is open, a visitor
 * host's AI is off (useToolAi), and the duplicates come from the word rules
 * instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, ListOrdered, Sparkles, Trophy } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { WallRoomHost } from "@/components/collab/wall-room/wall-room-host";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { SaveRound } from "@/components/collab/vote-room/save-round";
import { Button } from "@/components/ui/button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  aiPosts,
  cleanMerges,
  mergeQuestionsTask,
  type MergeOutput,
} from "@/lib/ai/tasks/audience-wall";
import { registerLiveWall } from "@/lib/audience-wall/live";
import type { WallKind } from "@/lib/audience-wall/model";
import { AUDIENCE_WALL_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WALL_LIMITS, type WallRoundResult } from "@/lib/realtime/wall-room/protocol";
import { scoreText } from "@/lib/realtime/wall-room/score";
import type { WallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { WALL_KIND_HOW, WALL_KIND_SETUP } from "./kinds";
import { WordCloud } from "./word-cloud";

export interface LiveWallProps {
  kind: WallKind;
  /** Save round: the room's result, once per round (an undo back, or false). */
  onSave: SaveRound<WallRoundResult>;
  /** The room is live (its controls are on screen), or not any more. */
  onLiveChange?: (live: boolean) => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

const short = (text: string, max = 60) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export function LiveWall({ kind, onSave, onLiveChange, crypto }: LiveWallProps) {
  const setup = WALL_KIND_SETUP[kind];
  return (
    <WallRoomHost
      tool="audience-wall"
      toolName="Audience Wall"
      onSave={onSave}
      defaultPrompt={setup.prompt}
      defaultMode={setup.mode}
      roundOptions={setup.roundOptions}
      answerable={setup.answerable}
      promptSuggestions={setup.starters}
      crypto={crypto}
      startLabel={setup.startLabel}
      description={WALL_KIND_HOW[kind]}
      renderResults={(result) =>
        kind === "answers" || kind === "brainwriting" ? (
          <ResultCloud texts={result.posts.map((p) => p.text)} />
        ) : null
      }
    >
      {(room, { unsaved }) => (
        <LiveControls kind={kind} room={room} unsaved={unsaved} onLiveChange={onLiveChange} />
      )}
    </WallRoomHost>
  );
}

/** The word cloud under the posts, on demand. */
function ResultCloud({ texts }: { texts: readonly string[] }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
      >
        <Cloud className="h-4 w-4" aria-hidden="true" />
        Word cloud
      </Button>
      {shown && <WordCloud texts={texts} label="Word cloud of the posts" />}
    </div>
  );
}

function LiveControls({
  kind,
  room,
  unsaved,
  onLiveChange,
}: {
  kind: WallKind;
  room: WallRoom;
  unsaved: boolean;
  onLiveChange?: (live: boolean) => void;
}) {
  const { log } = useHistoryLogger("audience-wall");
  const announce = useAnnounce();
  const roomRef = useRef(room);
  roomRef.current = room;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const liveRef = useRef(onLiveChange);
  liveRef.current = onLiveChange;

  useEffect(() => {
    liveRef.current?.(true);
    return () => liveRef.current?.(false);
  }, []);

  // Amr's room verbs reach this room through the registry: counts only.
  useEffect(
    () =>
      registerLiveWall({
        status: () => {
          const r = roomRef.current;
          return {
            prompt: r.round?.prompt ?? null,
            open: r.round?.open ?? false,
            mode: r.round?.mode ?? "hidden",
            posts: r.round?.count ?? 0,
            shown: Boolean(r.round && r.round.posts !== null),
            hands: r.hands.length,
            people: r.members.length,
            scoring: r.round?.scoring ?? null,
            kind,
            unsaved: unsavedRef.current,
          };
        },
        openRound: (prompt, mode) =>
          roomRef.current.openRound(prompt, mode, WALL_KIND_SETUP[kind].roundOptions),
        setOpen: (open) => roomRef.current.setOpen(open),
        reveal: () => roomRef.current.reveal(),
        lowerAllHands: () => roomRef.current.lowerAllHands(),
        ...(kind === "crowd"
          ? { setScoring: (s: "open" | "shown") => roomRef.current.setScoring(s) }
          : {}),
      }),
    [kind]
  );

  // A hand going up is said out loud: the queue is how the host calls on people.
  const handIds = room.hands.map((h) => h.id).join(" ");
  const handsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    const now = roomRef.current.hands;
    const before = new Set(handsRef.current);
    handsRef.current = now.map((h) => h.id);
    const raised = now.filter((h) => !before.has(h.id));
    if (raised.length === 0) return;
    const who =
      raised.length === 1 ? `${raised[0].name} raised a hand` : `${raised.length} hands went up`;
    announce(`${who}: ${now.length} in the queue.`);
  }, [handIds, announce]);

  // A new prompt on the wall: logged with its kind and mode, never its posts.
  const roundId = room.round?.id ?? null;
  const roundMode = room.round?.mode ?? null;
  useEffect(() => {
    if (roundId) log(AUDIENCE_WALL_ACTIONS.WALL_OPENED, { kind, mode: roundMode });
    // Once per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  if (!room.round) return null;
  return (
    <div className="space-y-3">
      {kind === "questions" && <DuplicateQuestions room={room} />}
      {kind === "hands" && <NextSpeaker room={room} />}
      {kind === "brainwriting" && <BuildSwitch room={room} />}
      {kind === "crowd" && <CrowdScoring room={room} />}
    </div>
  );
}

/** Questions: Amr (or the word rules) finds duplicates; the host merges each group. */
function DuplicateQuestions({ room }: { room: WallRoom }) {
  const announce = useAnnounce();
  const posts = useMemo(() => (room.round?.posts ?? []).filter((p) => !p.hidden), [room.round]);
  const [draft, setDraft] = useState<{ groups: MergeOutput["groups"]; source: AiSource } | null>(
    null
  );
  // The groups waiting for the host's yes, and the list's key: a "no" puts
  // them back in the draft (a fresh list, so it shows them again).
  const [asked, setAsked] = useState<MergeOutput["groups"] | null>(null);
  const [listKey, setListKey] = useState(0);
  const confirmedRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const textOf = (id: string) => posts.find((p) => p.id === id)?.text ?? "";
  const known = new Set(posts.map((p) => p.id));
  // A group whose posts left the wall since drops out of the draft.
  const groups = draft ? cleanMerges(draft.groups, known) : [];
  const sent = aiPosts(posts);
  if (room.round?.posts === null) return null;
  const askedGroups = asked ? cleanMerges(asked, known) : [];
  const askedPosts = askedGroups.reduce((n, g) => n + g.merge.length, 0);
  return (
    <section ref={sectionRef} aria-label="Duplicate questions" className="space-y-2">
      <AiButton
        task={mergeQuestionsTask}
        label="Find duplicate questions"
        fallbackLabel="Find duplicates without AI"
        disabledReason={posts.length < 2 ? "Wait for at least two questions." : null}
        input={() => ({ posts: sent.posts.map((p) => ({ id: p.id, text: p.text })) })}
        onResult={(data, meta) => {
          const found = cleanMerges(data.groups, known);
          setDraft({ groups: data.groups, source: meta.source });
          announce(
            found.length === 0
              ? "No duplicate questions found."
              : `${found.length} ${found.length === 1 ? "group" : "groups"} of duplicates to review.`
          );
        }}
      />
      {sent.left > 0 && (
        <p className="text-xs text-sub">
          Amr reads the {sent.posts.length} most upvoted questions; {sent.left} more are left out.
        </p>
      )}
      {draft && groups.length === 0 && (
        <p role="status" className="text-sm text-sub">
          No duplicate questions on the wall.
        </p>
      )}
      {draft && groups.length > 0 && (
        <>
          <p className="text-xs text-sub">
            Only you see this draft. Nothing changes in the room until you press Merge, and a merge
            can&apos;t be split again.
          </p>
          <AiSuggestions
            items={groups}
            source={draft.source}
            title="Duplicates to merge"
            acceptLabel="Merge"
            render={(g) => ({
              title: `Keep: ${short(textOf(g.keep))}`,
              detail: `Merge in: ${g.merge.map((id) => short(textOf(id))).join(" · ")}${
                g.reason ? `. ${g.reason}` : ""
              }`,
            })}
            onAccept={(g) => setAsked([g])}
            onAcceptAll={(all) => setAsked(all)}
            onDismiss={() => setDraft(null)}
            key={listKey}
          />
        </>
      )}
      <ConfirmDialog
        open={askedGroups.length > 0}
        onOpenChange={(open) => {
          if (open) return;
          if (!confirmedRef.current) {
            // Not merged: the groups go back into the draft.
            setListKey((k) => k + 1);
            window.setTimeout(
              () =>
                sectionRef.current
                  ?.querySelector<HTMLElement>('[data-testid="ai-suggestions"] h3')
                  ?.focus(),
              0
            );
          }
          confirmedRef.current = false;
          setAsked(null);
        }}
        title={
          askedGroups.length === 1
            ? "Merge these questions for everyone?"
            : `Merge ${askedGroups.length} groups for everyone?`
        }
        description={
          askedGroups.length === 1
            ? `${askedGroups[0].merge.map((id) => `“${short(textOf(id))}”`).join(", ")} ${
                askedGroups[0].merge.length === 1 ? "goes" : "go"
              } under “${short(textOf(askedGroups[0].keep))}” on every screen in the room, and the votes join it. A merge can't be split again.`
            : `${askedPosts} questions go under the ones they repeat, on every screen in the room, and their votes join them. A merge can't be split again.`
        }
        confirmLabel={askedGroups.length === 1 ? "Merge questions" : "Merge them all"}
        tone="default"
        onConfirm={() => {
          confirmedRef.current = true;
          for (const g of askedGroups) for (const id of g.merge) room.merge(id, g.keep);
          announce(
            `Merged ${askedPosts} ${askedPosts === 1 ? "question" : "questions"} in the room.`
          );
        }}
      />
    </section>
  );
}

/** Raised hands: who's next, and done with them. */
function NextSpeaker({ room }: { room: WallRoom }) {
  const announce = useAnnounce();
  const lineRef = useRef<HTMLParagraphElement>(null);
  const [first, second] = room.hands;
  return (
    <section aria-label="Next speaker" className="space-y-2 rounded-lg border border-border p-3">
      <p
        ref={lineRef}
        tabIndex={-1}
        className={
          first
            ? "break-words text-base font-semibold text-text outline-none"
            : "text-sm text-sub outline-none"
        }
      >
        {first
          ? `Next: ${first.name}`
          : "No hands up. People raise theirs from their phone, and the queue shows here in order."}
      </p>
      {first && (
        <>
          {second && <p className="break-words text-sm text-sub">Then: {second.name}</p>}
          <Button
            type="button"
            variant="toolkit"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              room.lowerHand(first.id);
              announce(second ? `Next up: ${second.name}.` : "That was the last raised hand.");
              // The button goes with the last hand: keep focus on the queue's line.
              if (!second) lineRef.current?.focus();
            }}
          >
            <ListOrdered className="h-4 w-4" aria-hidden="true" />
            {second ? "Done, call the next" : "Done"}
          </Button>
        </>
      )}
    </section>
  );
}

/** Brainwriting: whether people may say Yes, and… right now. */
function BuildSwitch({ room }: { room: WallRoom }) {
  const on = room.round?.build === true;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={on ? "toolkit" : "outline"}
        size="sm"
        className="gap-1.5"
        aria-pressed={on}
        onClick={() => room.setBuild(!on)}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Yes, and…
      </Button>
      <span className="text-xs text-sub">
        {on
          ? "People can build on any post on the wall. Their replies show under it."
          : "Turn it on when the first ideas are up, so people build on each other's."}
      </span>
    </div>
  );
}

/** 25/10: start the scoring, follow it, then show the top ten. */
function CrowdScoring({ room }: { room: WallRoom }) {
  const announce = useAnnounce();
  const topRef = useRef<HTMLHeadingElement>(null);
  const r = room.round;
  if (!r) return null;
  if (!r.scoring) {
    return (
      <section aria-label="25/10 scoring" className="space-y-2">
        <p className="text-sm text-sub">
          When everyone has written their idea, start the scoring. Each person then scores five
          posts from 1 to {WALL_LIMITS.maxScore}, picked at random, never their own.
        </p>
        <Button
          type="button"
          variant="toolkit"
          size="sm"
          className="gap-1.5"
          disabled={r.count < 2}
          onClick={() => {
            room.setScoring("open");
            announce("Scoring started. New posts are closed.");
          }}
        >
          <ListOrdered className="h-4 w-4" aria-hidden="true" />
          Start the scoring
        </Button>
        {r.count < 2 && <p className="text-xs text-sub">It needs two posts or more.</p>}
      </section>
    );
  }
  if (r.scoring === "open") {
    const most = Math.max(0, room.members.length - 1) * WALL_LIMITS.scoresPerMember;
    return (
      <section aria-label="25/10 scoring" className="space-y-2">
        {/* The kit's status line above announces each new score: this one stays quiet. */}
        <p className="text-sm text-text">
          {most > 0
            ? `${r.scored ?? 0} of up to ${most} scores in.`
            : `${r.scored ?? 0} ${r.scored === 1 ? "score" : "scores"} in.`}{" "}
          The totals stay hidden until you show them.
        </p>
        <Button
          type="button"
          variant="toolkit"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            room.setScoring("shown");
            announce("The top ten are showing.");
            // The button goes: focus the list that replaces it.
            window.setTimeout(() => topRef.current?.focus(), 0);
          }}
        >
          <Trophy className="h-4 w-4" aria-hidden="true" />
          Show the top ten
        </Button>
      </section>
    );
  }
  // Posts the host hid stay off the top ten, as they are off the room's wall.
  const top = (r.posts ?? [])
    .filter((p) => !p.hidden && (p.scorers ?? 0) > 0)
    .slice(0, WALL_LIMITS.topCount);
  return (
    <section aria-label="Top ten" className="space-y-2">
      <h3
        ref={topRef}
        tabIndex={-1}
        className="flex items-center gap-1.5 text-sm font-semibold text-text outline-none"
      >
        <Trophy className="h-4 w-4 text-accent" aria-hidden="true" />
        Top ten
      </h3>
      {top.length === 0 ? (
        <p className="text-sm text-sub">Nobody scored a post.</p>
      ) : (
        <ol className="space-y-1.5">
          {top.map((p, i) => (
            <li key={p.id} className="flex min-w-0 items-baseline gap-2 text-sm">
              <span className="w-6 shrink-0 text-right font-data text-sub">{i + 1}.</span>
              {/* On a phone the score goes under the idea, so the idea keeps the width. */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <span className="min-w-0 break-words text-text sm:flex-1">{p.text}</span>
                <span className="text-xs text-sub sm:shrink-0">{scoreText(p)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
