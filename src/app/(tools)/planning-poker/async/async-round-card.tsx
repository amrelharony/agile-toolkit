"use client";

/**
 * One round without a meeting on the host's page.
 *
 * - Open: blind. The link to send, who has replied and how many cards are
 *   in (never which), a box for pasted reply codes, "Add my own cards",
 *   Reveal and Close.
 * - Revealed: per story, everyone's card with their name (as Poker shows a
 *   revealed round), the verdict, the notes and Accept with the Three-point
 *   check. Accept writes a queue story's estimate back to where it came
 *   from and saves a typed story to the backlog. "Talk about it live" opens
 *   a session with the flagged stories, their cards as its first round.
 * - Closed: the cards without names or notes.
 *
 * A reply under a name already in never replaces it silently: the page asks
 * Replace, Keep both ("Lee (2)") or Ignore. Close and Delete come with Undo.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { Eye, Lock, MessageSquare, Plus, Share2, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ExportButton } from "@/components/shared/export-button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PokerAsyncRound } from "@/lib/stores/workspace-types";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import type { ConsensusLevel } from "@/lib/estimation/consensus";
import {
  asyncResults,
  cardCount,
  closeRound,
  encodePack,
  estimateLink,
  expectedReplied,
  findReplyCodes,
  isReplyIn,
  packFor,
  readReply,
  replyClash,
  replyProblem,
  revealAndFlag,
  validateReply,
  type AsyncReplyCode,
  type AsyncStoryResult,
} from "@/lib/estimation/async-pack";
import { AcceptEstimate } from "../accept-estimate";
import { withRound } from "../rounds";
import { SCALE_LABELS, type ScaleType, type Story as SessionStory } from "../types";
import { useCardReferences } from "../use-card-references";
import { asyncRoundMarkdown } from "./markdown";
import {
  acceptAsyncEstimate,
  addReplyToRound,
  roundById,
  saveRound,
  shortTitle,
} from "./round-actions";

type Log = (action: string, payload?: Record<string, unknown>) => void;

/** A session "Talk about it live" opens. */
export interface AsyncLiveStart {
  sessionName: string;
  scale: string[];
  scaleType: ScaleType;
  displayName: string;
  stories: SessionStory[];
}

const SCALE_TYPES: readonly ScaleType[] = ["fibonacci", "tshirt", "custom"];
const scaleTypeOf = (s: string): ScaleType =>
  (SCALE_TYPES as readonly string[]).includes(s) ? (s as ScaleType) : "custom";

const TONE: Record<ConsensusLevel, string> = {
  agree: "text-success",
  close: "text-warning",
  spread: "text-danger",
};

const STATUS_LABEL: Record<PokerAsyncRound["status"], string> = {
  open: "Waiting for replies",
  revealed: "Revealed",
  closed: "Closed",
};

/** "Fri 28 Nov" for a due day. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a paste did: who went in, who was in already with the same cards, what couldn't. */
type Tally = { names: string[]; already: string[]; notes: string[] };

export function AsyncRoundCard({
  round,
  hostName,
  log,
  sessionOpen = false,
  onTalkLive,
}: {
  round: PokerAsyncRound;
  /** The lobby's display name: the link's "Made by" and the name on "Add my own cards". */
  hostName: string;
  log: Log;
  /** A session is open or opening: "Talk about it live" waits for it to end. */
  sessionOpen?: boolean;
  onTalkLive?: (start: AsyncLiveStart) => void;
}) {
  const headingId = useId();
  const announce = useAnnounce();
  const [status, setStatus] = useState("");
  const say = (text: string) => {
    setStatus(text);
    announce(text);
  };

  const scaleType = scaleTypeOf(round.scaleType);
  const meta = [
    STATUS_LABEL[round.status],
    `${SCALE_LABELS[scaleType]} deck`,
    people(round.stories.length, "story", "stories"),
    ...(round.dueDate ? [`due ${dayLabel(round.dueDate)}`] : []),
  ].join(" · ");

  const remove = () => {
    const before = round;
    const { removePokerAsyncRound, upsertPokerAsyncRound } = useWorkspaceStore.getState();
    undoable({
      label: `Deleted “${shortTitle(before.title)}”`,
      apply: () => removePokerAsyncRound(before.id),
      revert: () => upsertPokerAsyncRound(before),
    });
  };

  const close = () => {
    const before = roundById(round.id);
    if (!before) return;
    const estimated = before.stories.filter((s) => s.finalEstimate).length;
    undoable({
      label: `Closed “${shortTitle(before.title)}”`,
      description: "Names and notes were dropped. The cards stay.",
      apply: () => {
        saveRound(closeRound(before, new Date().toISOString()));
      },
      revert: () => {
        saveRound(before);
      },
    });
    log(PLANNING_POKER_ACTIONS.ASYNC_CLOSED, { roundId: before.id, estimated });
  };

  return (
    <article
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-deep p-3 sm:p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 id={headingId} className="font-display text-base text-text break-words">
            {round.title}
          </h3>
          <p className="text-xs text-sub">{meta}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ExportButton
            filename="planning-poker-async"
            markdown={asyncRoundMarkdown(round)}
            context={round.title}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={remove}
            aria-label={`Delete “${round.title}”`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </header>

      {round.status === "open" && (
        <OpenRound round={round} hostName={hostName} log={log} say={say} onClose={close} />
      )}
      {round.status === "revealed" && (
        <RevealedRound
          round={round}
          hostName={hostName}
          log={log}
          say={say}
          sessionOpen={sessionOpen}
          onTalkLive={onTalkLive}
          onClose={close}
        />
      )}
      {round.status === "closed" && <ClosedRound round={round} />}

      <p role="status" className={cn("text-xs text-sub", !status && "sr-only")}>
        {status}
      </p>
    </article>
  );
}

// ── Open: blind until Reveal ─────────────────────────────────────────

function OpenRound({
  round,
  hostName,
  log,
  say,
  onClose,
}: {
  round: PokerAsyncRound;
  hostName: string;
  log: Log;
  say: (text: string) => void;
  onClose: () => void;
}) {
  const references = useCardReferences(scaleTypeOf(round.scaleType), round.deck);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  const meanings = useMemo(
    () => round.deck.map((c) => references(c)?.description ?? ""),
    [round.deck, references]
  );
  const packed = useMemo(
    () => encodePack(packFor(round, { host: hostName, meanings })),
    [round, hostName, meanings]
  );

  const [pasted, setPasted] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  // Replies waiting on a choice: the first one's name is already in.
  const [waiting, setWaiting] = useState<AsyncReplyCode[]>([]);
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownPicks, setOwnPicks] = useState<(string | null)[]>(() => round.stories.map(() => null));
  const [ownError, setOwnError] = useState<string | null>(null);

  const added = (name: string, n: number) => {
    log(PLANNING_POKER_ACTIONS.ASYNC_REPLY_ADDED, { roundId: round.id, replies: n });
    return name;
  };

  /** What a paste did so far: who went in, who was in already, what couldn't. */
  const tally = (): Tally => ({ names: [], already: [], notes: [] });
  const report = ({ names, already, notes }: Tally) => {
    setProblems(notes);
    const parts = [
      ...(names.length > 0 ? [`Added ${names.join(", ")}.`] : []),
      ...(already.length > 0 ? [`Already in with the same cards: ${already.join(", ")}.`] : []),
    ];
    if (parts.length > 0) say(parts.join(" "));
  };

  /**
   * Add replies in turn, stopping at the first whose name is already in
   * with other cards. One already in with the same cards is skipped.
   */
  const run = (queue: AsyncReplyCode[], t: Tally) => {
    const rest = [...queue];
    while (rest.length > 0) {
      const reply = rest[0];
      const current = roundById(round.id);
      if (reply.roundId !== round.id) {
        t.notes.push(`${reply.name}'s reply is for another round. Paste it on that round.`);
        rest.shift();
        continue;
      }
      const problem = replyProblem(reply, current);
      if (problem) {
        t.notes.push(problem);
        rest.shift();
        continue;
      }
      if (current && isReplyIn(reply, current)) {
        t.already.push(reply.name);
        rest.shift();
        continue;
      }
      if (current && replyClash(reply, current)) {
        setWaiting(rest);
        report(t);
        return;
      }
      const res = addReplyToRound(reply, "replace");
      if (res.ok) t.names.push(added(res.name, res.round.replies.length));
      else t.notes.push(res.problem);
      rest.shift();
    }
    setWaiting([]);
    report(t);
  };

  const addPasted = () => {
    const codes = findReplyCodes(pasted);
    if (codes.length === 0) {
      setProblems(["No reply code there. A reply code starts with AT1."]);
      return;
    }
    const queue: AsyncReplyCode[] = [];
    const t = tally();
    for (const code of codes) {
      const reply = readReply(code);
      if (reply) queue.push(reply);
      else t.notes.push("A code couldn't be read. Ask for it again, copied in full.");
    }
    setPasted("");
    run(queue, t);
  };

  const decide = (mode: "replace" | "keep-both" | "ignore") => {
    const [first, ...rest] = waiting;
    if (!first) return;
    const t = tally();
    if (mode !== "ignore") {
      const res = addReplyToRound(first, mode);
      if (res.ok) t.names.push(added(res.name, res.round.replies.length));
      else t.notes.push(res.problem);
    }
    run(rest, t);
  };

  const addOwn = () => {
    const made = validateReply(
      { r: round.id, d: round.deck, s: round.stories.map((s) => s.title) },
      { name: hostName, picks: ownPicks, notes: [] }
    );
    if (!made.ok) {
      setOwnError(made.errors.name ?? made.errors.cards ?? "These cards can't be added.");
      return;
    }
    setOwnError(null);
    setOwnOpen(false);
    setOwnPicks(round.stories.map(() => null));
    run([made.values.reply], tally());
  };

  const reveal = () => {
    const current = roundById(round.id);
    if (!current || current.replies.length === 0) return;
    // The stories worth a conversation start ticked for "Talk about it live".
    const problem = saveRound(revealAndFlag(current, new Date().toISOString()));
    if (problem) return say(problem);
    log(PLANNING_POKER_ACTIONS.ASYNC_REVEALED, {
      roundId: current.id,
      replies: current.replies.length,
      stories: current.stories.length,
    });
    say(`Revealed “${shortTitle(current.title)}”.`);
  };

  const names = round.replies.map((r) => r.name).filter(Boolean);
  const { replied, expected } = expectedReplied(round);
  const missing = (round.expected ?? []).filter(
    (n) => !round.replies.some((r) => r.name.trim().toLowerCase() === n.trim().toLowerCase())
  );
  const clash = waiting[0];
  const n = round.replies.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {packed.ok ? (
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              text={() => estimateLink(packed.code, origin || window.location.origin)}
              label="Copy link"
              announcement="Link copied"
            />
            {canShare && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  void navigator
                    .share({
                      title: round.title,
                      text: `Pick your cards for “${round.title}”, then send me your reply.`,
                      url: estimateLink(packed.code, origin || window.location.origin),
                    })
                    .catch(() => {
                      /* closed: the copy button still works */
                    })
                }
              >
                <Share2 aria-hidden="true" />
                Share
              </Button>
            )}
            <span className="text-xs text-sub">
              Send it to the team. Each reply comes back to you as a short code.
            </span>
          </div>
        ) : (
          <p className="text-xs text-danger" role="alert">
            {packed.problem}
          </p>
        )}
        {packed.ok && packed.meaningsDropped && (
          <p className="text-xs text-sub">
            The card meanings didn&apos;t fit in the link, so it goes without them.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2">
        <p className="flex items-center gap-2 text-sm text-text">
          <Users className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
          {n === 0
            ? "No replies yet."
            : `${people(n, "reply", "replies")}, ${people(cardCount(round), "card", "cards")}`}
          {expected > 0 && (
            <span className="text-sub">
              ({replied} of {expected} expected)
            </span>
          )}
        </p>
        {names.length > 0 && (
          <p className="text-xs text-sub break-words">From {names.join(", ")}.</p>
        )}
        {missing.length > 0 && (
          <p className="text-xs text-sub break-words">Still to reply: {missing.join(", ")}.</p>
        )}
        <p className="text-xs text-sub">The cards stay hidden until you reveal them.</p>
      </div>

      {clash ? (
        <div
          role="group"
          aria-label={`${clash.name}'s reply`}
          className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2"
        >
          <p className="text-sm text-text">
            This replaces {clash.name}&apos;s earlier reply. Keep both to add it as a second one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => decide("replace")}>
              Replace
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => decide("keep-both")}>
              Keep both
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => decide("ignore")}>
              Ignore
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Field
            label="Paste reply codes"
            hint="A code, or the link it came in. Several at once is fine."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="AT1.…"
                className="font-data"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              size="sm"
              className="gap-1.5"
              onClick={addPasted}
            >
              <Plus aria-hidden="true" />
              Add replies
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={ownOpen}
              onClick={() => setOwnOpen((o) => !o)}
            >
              Add my own cards
            </Button>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-danger" role="alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      {ownOpen && !clash && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-3 py-3">
          <p className="text-sm text-text">Your cards, as {hostName}:</p>
          <ol className="flex flex-col gap-3">
            {round.stories.map((s, i) => (
              <li key={s.id} className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm text-text break-words">
                  {i + 1}. {s.title}
                </span>
                <ToggleGroup
                  label={`Your card for “${s.title}”`}
                  size="sm"
                  className="pointer-coarse:[&>button]:min-h-11 pointer-coarse:[&>button]:min-w-11 pointer-coarse:[&>button]:px-3 pointer-coarse:[&>button]:text-sm"
                  options={round.deck.map((c) => ({ value: c, label: c }))}
                  value={ownPicks[i]}
                  onValueChange={(v) => setOwnPicks((p) => p.map((x, j) => (j === i ? v : x)))}
                />
              </li>
            ))}
          </ol>
          {ownError && (
            <p className="text-xs text-danger" role="alert">
              {ownError}
            </p>
          )}
          <Button type="button" size="sm" className="self-start" onClick={addOwn}>
            Add my cards
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" className="gap-1.5" disabled={n === 0} onClick={reveal}>
          <Eye aria-hidden="true" />
          Reveal the cards
        </Button>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onClose}>
          <Lock aria-hidden="true" />
          Close the round
        </Button>
        {n === 0 && <span className="text-xs text-sub">Reveal waits for the first reply.</span>}
      </div>
    </div>
  );
}

// ── Revealed: everyone's cards, then agree ───────────────────────────

function StoryResult({
  result,
  index,
  names = true,
}: {
  result: AsyncStoryResult;
  index: number;
  names?: boolean;
}) {
  const { story, votes, label, tone, verdict, notes } = result;
  return (
    <>
      <p className="text-sm font-medium text-text break-words">
        {index + 1}. {story.title}
      </p>
      {votes.length === 0 ? (
        <p className="text-xs text-sub">No cards for this one.</p>
      ) : (
        <ul aria-label={`Cards for “${story.title}”`} className="flex flex-wrap gap-1.5">
          {votes.map((v, i) => (
            <li
              key={i}
              className="rounded-md border border-border bg-surface-deep px-2 py-0.5 text-xs text-text"
            >
              {names && v.name ? <span className="text-sub">{v.name} </span> : null}
              <span className="font-data font-bold">{v.card}</span>
            </li>
          ))}
        </ul>
      )}
      {label && (
        <p className="text-xs">
          <span className={cn("font-medium", tone ? TONE[tone] : "text-text")}>{label}</span>
          <span className="text-sub">: {verdict}</span>
        </p>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-sub break-words">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                “{n.text}”{names && n.name ? `, ${n.name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RevealedRound({
  round,
  hostName,
  log,
  say,
  sessionOpen,
  onTalkLive,
  onClose,
}: {
  round: PokerAsyncRound;
  hostName: string;
  log: Log;
  say: (text: string) => void;
  sessionOpen: boolean;
  onTalkLive?: (start: AsyncLiveStart) => void;
  onClose: () => void;
}) {
  const results = useMemo(() => asyncResults(round), [round]);
  const flagged = results.filter((r) => r.story.discuss && !r.story.finalEstimate);
  const left = results.filter((r) => !r.story.finalEstimate).length;

  const accept = (result: AsyncStoryResult, value: string) => {
    const done = acceptAsyncEstimate(
      round.id,
      result.story,
      value,
      result.votes.map((v) => v.card)
    );
    if (!done) return;
    log(PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED, {
      storyId: result.story.id,
      title: result.story.title,
      value,
      via: "async",
    });
    say(
      done.via === "queue" && done.written
        ? `Saved ${value} on “${shortTitle(done.title)}” where it came from.`
        : `Agreed ${value} for “${shortTitle(result.story.title)}”.`
    );
  };

  const flag = (storyId: string, discuss: boolean) => {
    const current = roundById(round.id);
    if (!current) return;
    saveRound({
      ...current,
      updatedAt: new Date().toISOString(),
      stories: current.stories.map((s) => (s.id === storyId ? { ...s, discuss } : s)),
    });
  };

  const talkLive = () => {
    if (sessionOpen || flagged.length === 0 || !onTalkLive) return;
    onTalkLive({
      sessionName: round.title,
      scale: [...round.deck],
      scaleType: scaleTypeOf(round.scaleType),
      displayName: hostName,
      // Each story's cards from the round become the session's first round,
      // under the same story id, so its write-back still matches.
      stories: flagged.map((r) =>
        withRound(
          { id: r.story.id, title: r.story.title, finalEstimate: null },
          r.votes.map((v) => v.card),
          round.deck
        )
      ),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {results.map((r, i) => (
          <li
            key={r.story.id}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card px-3 py-3"
          >
            <StoryResult result={r} index={i} />
            {r.story.finalEstimate ? (
              <p className="text-sm text-text">
                Agreed: <span className="font-data font-bold">{r.story.finalEstimate}</span>
              </p>
            ) : (
              <>
                <AcceptEstimate
                  key={`${r.story.id}:${r.votes.length}`}
                  deck={round.deck}
                  suggested={r.consensus.suggested}
                  onAccept={(value) => accept(r, value)}
                  votes={r.votes.map((v) => v.card)}
                  onThreePointUsed={(card, expected) =>
                    log(PLANNING_POKER_ACTIONS.THREE_POINT_USED, {
                      card,
                      expected: Math.round(expected * 10) / 10,
                    })
                  }
                />
                <label className="flex items-center gap-2 text-sm text-text pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={Boolean(r.story.discuss)}
                    onChange={(e) => flag(r.story.id, e.target.checked)}
                  />
                  Talk about it live
                </label>
              </>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {onTalkLive && left > 0 && (
          <Button
            type="button"
            variant="toolkit"
            size="sm"
            disabled={sessionOpen || flagged.length === 0}
            onClick={talkLive}
          >
            Talk about it live
            {flagged.length > 0 ? ` (${flagged.length})` : ""}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onClose}>
          <Lock aria-hidden="true" />
          Close the round
        </Button>
        {onTalkLive && left > 0 && sessionOpen && (
          <span className="text-xs text-sub">End the current session first.</span>
        )}
        {onTalkLive && left > 0 && !sessionOpen && flagged.length === 0 && (
          <span className="text-xs text-sub">Tick the stories to talk about.</span>
        )}
      </div>
      <p className="text-xs text-sub">
        Closing drops everyone&apos;s names and notes and keeps the cards.
      </p>
    </div>
  );
}

// ── Closed: the cards, without names ─────────────────────────────────

function ClosedRound({ round }: { round: PokerAsyncRound }) {
  const results = useMemo(() => asyncResults(round), [round]);
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {results.map((r, i) => (
          <li
            key={r.story.id}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card px-3 py-3"
          >
            <StoryResult result={r} index={i} names={false} />
            {r.story.finalEstimate && (
              <p className="text-sm text-text">
                Agreed: <span className="font-data font-bold">{r.story.finalEstimate}</span>
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-sub">
        Names and notes were dropped when the round closed. Delete it once you&apos;re done.
      </p>
    </div>
  );
}
