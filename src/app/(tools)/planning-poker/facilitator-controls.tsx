"use client";

/**
 * Facilitator mode controls for a LOCAL Planning Poker session: seat the
 * team, open a player's deck to record their vote face down, and pass the
 * screen round so each person votes in turn. See `players.ts` for the
 * session changes behind them.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SectionCard } from "@/components/shared/section-card";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS, cleanPlayerName, playerKey } from "./players";
import type { Participant } from "./types";
import { VotingDeck } from "./voting-deck";

/** "voted ✓": that a card is down, never which one. */
export function VotedMark() {
  return (
    <span className="flex items-center gap-0.5 text-xs text-accent-green">
      voted
      <Check className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}

/**
 * Seat people with no device of their own: the whole roster from the Team
 * page in one click, or one name at a time.
 */
export function AddPlayers({
  participants,
  onAdd,
}: {
  participants: readonly Participant[];
  /** Seat these names; duplicates and blanks are skipped. */
  onAdd: (names: string[]) => void;
}) {
  const roster = useTeamRoster();
  const workspaceReady = useWorkspaceHydrated();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const taken = new Set(participants.map((p) => playerKey(p.name)));
  // Everyone on the roster who isn't seated yet, once each.
  const fromRoster = roster
    .map((m) => cleanPlayerName(m.name))
    .filter(
      (n, i, all) =>
        n !== "" &&
        !taken.has(playerKey(n)) &&
        all.findIndex((o) => playerKey(o) === playerKey(n)) === i
    );
  const full = participants.length >= MAX_PARTICIPANTS;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanPlayerName(name);
    if (!clean) return;
    if (taken.has(playerKey(clean))) {
      setError(`${clean} is already at the table.`);
      return;
    }
    if (full) {
      setError(`A session holds ${MAX_PARTICIPANTS} people at most.`);
      return;
    }
    onAdd([clean]);
    setName("");
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs text-sub">
        Running it on one screen? Add your team, then vote for each person face down or pass the
        screen round.
      </p>
      {roster.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAdd(fromRoster)}
          disabled={fromRoster.length === 0 || full}
          className="justify-start gap-1.5"
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {fromRoster.length > 0 ? `Add team (${fromRoster.length})` : "Team added"}
        </Button>
      ) : (
        workspaceReady && (
          <p className="text-xs text-sub">
            <Link href="/team" className="text-accent underline-offset-4 hover:underline">
              Set up your team
            </Link>{" "}
            to seat everyone in one click.
          </p>
        )
      )}
      <form onSubmit={submit} className="flex items-end gap-2">
        <Field label="Player name" error={error} className="min-w-0 flex-1">
          {(props) => (
            <Input
              {...props}
              ref={inputRef}
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Priya"
              className="h-9 pointer-coarse:min-h-11 text-sm bg-surface-deep border-border text-text"
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="toolkit"
          size="sm"
          disabled={!name.trim()}
          className="h-9 shrink-0 pointer-coarse:min-h-11"
        >
          Add player
        </Button>
      </form>
    </div>
  );
}

/**
 * A player's deck, opened by "Vote for <name>" or by "Next voter". It never
 * shows which card they played: picking records the vote face down.
 */
export function PlayerDeck({
  player,
  scale,
  passing,
  onPick,
  onSkip,
  onClose,
}: {
  player: Participant;
  scale: readonly string[];
  /** Passing the screen round: the deck is this player's turn. */
  passing: boolean;
  onPick: (value: string) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  return (
    <SectionCard
      title={passing ? `${player.name}'s turn` : `Vote for ${player.name}`}
      titleSize="sm"
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 text-xs text-sub hover:text-text"
        >
          {passing ? "Stop passing" : "Cancel"}
        </Button>
      }
      className="border-accent/30 bg-surface"
      contentClassName="flex flex-col gap-2 pb-6"
    >
      <p className="text-sm text-sub">
        {passing
          ? `Hand the screen to ${player.name}. Earlier votes stay face down.`
          : `Pick ${player.name}'s card. It stays face down until you reveal.`}
      </p>
      <VotingDeck
        label={`${player.name}'s vote`}
        scale={scale}
        selected={null}
        onPick={onPick}
        focusOnMount
      />
      {player.vote !== null && (
        <p className="flex items-center justify-center gap-1.5 text-center text-sm text-sub">
          <VotedMark />
          <span>Picking a card replaces it.</span>
        </p>
      )}
      {passing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSkip}
          className="self-center h-8 text-xs"
        >
          Skip {player.name}
        </Button>
      )}
    </SectionCard>
  );
}

/**
 * Between turns while the screen is passed round: who just went, and the
 * "Next voter" button. Shows names only, never a card.
 */
export function PassScreen({
  last,
  next,
  onNext,
  onDone,
}: {
  /** The player who just had the screen, and whether they voted. */
  last: { name: string; voted: boolean } | null;
  /** Who's up next; null once everyone has voted. */
  next: Participant | null;
  onNext: () => void;
  onDone: () => void;
}) {
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    focusRef.current?.focus();
  }, []);

  return (
    <SectionCard
      title="Pass the screen"
      titleSize="sm"
      className="border-accent/30 bg-surface"
      contentClassName="flex flex-col items-center gap-3 pb-6 text-center"
    >
      {last && (
        <p className="flex items-center gap-1.5 text-sm text-text">
          <span className="font-medium">{last.name}</span>
          {last.voted ? <VotedMark /> : <span className="text-xs text-sub">skipped</span>}
        </p>
      )}
      {next ? (
        <>
          <p className="text-sm text-sub">
            Up next: <span className="font-medium text-text">{next.name}</span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button ref={focusRef} type="button" variant="toolkit" size="sm" onClick={onNext}>
              Next voter
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              Stop passing
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-accent-green">All votes in</p>
          <p className="text-xs text-sub">Reveal when everyone is ready.</p>
          <Button ref={focusRef} type="button" variant="outline" size="sm" onClick={onDone}>
            Done
          </Button>
        </>
      )}
    </SectionCard>
  );
}
