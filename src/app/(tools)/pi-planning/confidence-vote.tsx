"use client";

/**
 * The PI confidence vote: a fist of five for the whole train or one team,
 * run on Quick Vote's own room (people join through /join and see Quick
 * Vote there) or counted on one screen, through the vote kit's
 * `VoteRoundPanel`. Anonymous, totals only: the kit holds the results back
 * until enough people have answered, and the board keeps only the counts
 * per point, on the host's Save round, with the kit's Undo. No AI touches
 * the answers.
 *
 * The board doesn't tell Quick Vote about this room (no `setQuickVoteRoom`,
 * no `onLiveChange`), so Quick Vote's Amr verbs never drive it.
 *
 * Loaded with next/dynamic by the page, so the vote kit comes down only
 * when the board has teams to vote.
 */

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import {
  TRAIN_SCOPE,
  TRAIN_SCOPE_NAME,
  confidenceQuestion,
  countsFrom,
  voteAverage,
} from "@/lib/pi-planning/confidence";
import {
  CONFIDENCE_MAX,
  appendCapped,
  removeAppended,
  type PiConfidenceVote,
  type PiState,
} from "@/lib/pi-planning/model";
import { QUESTION_MAX, draftFromPreset, validateRoundDraft } from "@/lib/quick-vote/draft";
import { presetById } from "@/lib/quick-vote/presets";
import { roundFor } from "@/lib/quick-vote/sheets";
import type { Questionnaire } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { ID_RE } from "@/lib/realtime/vote-room/wire";
import { cn } from "@/lib/utils";
import { SelectField } from "../dependency-map/fields";
import { SavedVotes } from "./saved-votes";

type Log = (action: string, payload?: Record<string, unknown>) => void;
type Update = (fn: (s: PiState) => PiState) => void;

const PRESET = presetById("confidence");

/** Marks the scope in a round's questionnaire id: "qv:confidence:pi-train". */
const SCOPE_MARK = ":pi-";

/**
 * The round the kit runs for `question`, checked as Quick Vote checks its
 * own drafts: the confidence format with the PI's question. With `scope`,
 * its questionnaire id also names the scope (as Quick Vote's own ids name
 * a backlog item), so a saved round says whom it asked even when two
 * questions read the same or the host picked another scope while the room
 * was open. Null when the format is missing or the question can't run.
 */
export function confidenceRound(
  question: string,
  scope?: string
): { questionnaire: Questionnaire; minN: number } | null {
  if (!PRESET) return null;
  const v = validateRoundDraft({ ...draftFromPreset(PRESET), question });
  const round = v.ok ? roundFor(v.values) : null;
  if (round?.kind !== "scale") return null;
  const scoped = scope ? `${round.questionnaire.id}${SCOPE_MARK}${scope}` : "";
  const questionnaire =
    scoped && ID_RE.test(scoped) ? { ...round.questionnaire, id: scoped } : round.questionnaire;
  return { questionnaire, minN: round.minN };
}

/** The scope a saved round's questionnaire id names, or null when it names none. */
export function scopeFromRoundId(id: string): string | null {
  const at = id.indexOf(SCOPE_MARK);
  return at < 0 ? null : id.slice(at + SCOPE_MARK.length) || null;
}

/** A scope's question, fitted to the vote kit's cap. */
const questionFor = (teamName?: string) => confidenceQuestion(teamName, QUESTION_MAX);

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export function ConfidenceVote({
  state,
  update,
  log,
}: {
  state: PiState;
  update: Update;
  log: Log;
}) {
  const [picked, setPicked] = useState<string>(TRAIN_SCOPE);
  const [note, setNote] = useState("");
  // A team removed since it was picked: back to the whole train.
  const scope =
    picked === TRAIN_SCOPE || state.teams.some((t) => t.id === picked) ? picked : TRAIN_SCOPE;
  const scopeTeam = state.teams.find((t) => t.id === scope);
  const scopeTeamName = scopeTeam?.name;
  const round = useMemo(
    () => confidenceRound(questionFor(scopeTeamName), scope),
    [scopeTeamName, scope]
  );

  /**
   * The scope a saved round asked about (the host may have picked another
   * scope while the room was open): the one its questionnaire id names,
   * else the one its question names, else the one picked now.
   */
  const scopeOf = (result: VoteRoundResult): { scope: string; name: string } => {
    const named = scopeFromRoundId(result.questionnaireId);
    if (named === TRAIN_SCOPE) return { scope: TRAIN_SCOPE, name: TRAIN_SCOPE_NAME };
    if (named) return { scope: named, name: state.teams.find((t) => t.id === named)?.name ?? "" };
    if (confidenceRound(questionFor())?.questionnaire.title === result.title) {
      return { scope: TRAIN_SCOPE, name: TRAIN_SCOPE_NAME };
    }
    const team = state.teams.find(
      (t) => confidenceRound(questionFor(t.name))?.questionnaire.title === result.title
    );
    if (team) return { scope: team.id, name: team.name };
    return { scope, name: scopeTeam?.name ?? TRAIN_SCOPE_NAME };
  };

  /** Save round: the totals only, or nothing (and why) when the kit held them back. */
  const save = (result: VoteRoundResult): false | (() => void) => {
    const counts = countsFrom(result);
    if (!counts) {
      setNote(
        `Fewer than ${result.minN} people answered, so the totals stay hidden and nothing was saved.`
      );
      return false;
    }
    const asked = scopeOf(result);
    const vote: PiConfidenceVote = {
      id: nanoid(8),
      at: result.closedAt || new Date().toISOString(),
      scope: asked.scope,
      scopeName: asked.name,
      counts,
      ballots: Math.max(
        result.ballots,
        counts.reduce((a, c) => a + c, 0)
      ),
      source: result.source,
    };
    // The votes the cap drops to make room come back on Undo.
    let dropped: PiConfidenceVote[] = [];
    update((s) => {
      const next = appendCapped(s.confidence ?? [], vote, CONFIDENCE_MAX);
      dropped = next.dropped;
      return { ...s, confidence: next.list };
    });
    setNote("");
    log(PI_PLANNING_ACTIONS.CONFIDENCE_SAVED, {
      voteId: vote.id,
      scope: vote.scope === TRAIN_SCOPE ? "train" : "team",
      votes: vote.ballots,
      average: round1(voteAverage(counts)),
    });
    return () =>
      update((s) => ({
        ...s,
        confidence: removeAppended(s.confidence ?? [], vote.id, dropped, CONFIDENCE_MAX),
      }));
  };

  return (
    <div className="space-y-4">
      <SelectField
        label="Who votes"
        className="max-w-sm"
        hint={round?.questionnaire.title}
        options={[
          { value: TRAIN_SCOPE, label: TRAIN_SCOPE_NAME },
          ...state.teams.map((t) => ({ value: t.id, label: t.name || "Unnamed team" })),
        ]}
        value={scope}
        onChange={(v) => {
          setPicked(v);
          setNote("");
        }}
      />
      <VoteRoundPanel
        tool="quick-vote"
        kind="scale"
        toolName="PI Planning"
        questionnaire={round?.questionnaire ?? null}
        minN={round?.minN}
        onSave={save}
      />
      <p role="status" className={cn("text-sm", note ? "text-warning" : "sr-only")}>
        {note}
      </p>
      <SavedVotes state={state} update={update} />
    </div>
  );
}
