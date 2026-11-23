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
import { Trash2 } from "lucide-react";
import { VoteRoundPanel } from "@/components/collab/vote-room";
import { IconButton } from "@/components/ui/icon-button";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import {
  TRAIN_SCOPE,
  TRAIN_SCOPE_NAME,
  averageText,
  confidenceQuestion,
  confidenceRule,
  confidenceVotes,
  countsFrom,
  scopeLabel,
  voteAverage,
  votesUnderThree,
} from "@/lib/pi-planning/confidence";
import {
  CONFIDENCE_MAX,
  appendCapped,
  localDayOf,
  removeAppended,
  type PiConfidenceVote,
  type PiState,
} from "@/lib/pi-planning/model";
import { draftFromPreset, validateRoundDraft } from "@/lib/quick-vote/draft";
import { presetById } from "@/lib/quick-vote/presets";
import { roundFor } from "@/lib/quick-vote/sheets";
import type { Questionnaire } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { cn } from "@/lib/utils";
import { undoable } from "@/lib/utils/undoable";
import { dayLabel } from "../dependency-map/format";
import { SelectField } from "../dependency-map/fields";

type Log = (action: string, payload?: Record<string, unknown>) => void;
type Update = (fn: (s: PiState) => PiState) => void;

const PRESET = presetById("confidence");

/** The scale's labels, lowest first ("1: Not at all" …). */
const POINT_LABELS = (PRESET?.points ?? []).map((p) => p.label);

/**
 * The round the kit runs for `question`, checked as Quick Vote checks its
 * own drafts: the confidence format with the PI's question. Null when the
 * format is missing or the question can't run.
 */
export function confidenceRound(
  question: string
): { questionnaire: Questionnaire; minN: number } | null {
  if (!PRESET) return null;
  const v = validateRoundDraft({ ...draftFromPreset(PRESET), question });
  const round = v.ok ? roundFor(v.values) : null;
  return round?.kind === "scale" ? { questionnaire: round.questionnaire, minN: round.minN } : null;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** One vote's totals as bars, with the rule under them. */
function VoteBars({ vote }: { vote: PiConfidenceVote }) {
  const max = Math.max(1, ...vote.counts);
  return (
    <div className="space-y-2">
      <ul className="space-y-1" aria-label="Votes per point">
        {vote.counts.map((c, i) => (
          <li
            key={i}
            className="grid grid-cols-[minmax(0,8rem)_1fr_2rem] items-center gap-2 text-xs"
          >
            <span className="truncate text-sub">{POINT_LABELS[i] ?? String(i + 1)}</span>
            <span className="h-3 overflow-hidden rounded-full bg-sub/15">
              <span
                className={cn("block h-full rounded-full", i < 2 ? "bg-warning" : "bg-accent")}
                style={{ width: `${Math.round((c / max) * 100)}%` }}
              />
            </span>
            <span className="text-right font-mono text-text">{c}</span>
          </li>
        ))}
      </ul>
      <p
        className={cn(
          "text-sm",
          votesUnderThree(vote.counts) > 0 ? "font-medium text-warning" : "text-sub"
        )}
      >
        {confidenceRule(vote.counts)}
      </p>
    </div>
  );
}

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
  const round = useMemo(() => confidenceRound(confidenceQuestion(scopeTeamName)), [scopeTeamName]);
  const votes = confidenceVotes(state);
  const latest = votes[votes.length - 1];
  const earlier = votes.slice(0, -1).reverse();

  /**
   * The scope a saved round asked about, read from its question (the host
   * may have picked another scope while the room was open), else the one
   * picked now.
   */
  const scopeOf = (title: string): { scope: string; name: string } => {
    if (confidenceRound(confidenceQuestion())?.questionnaire.title === title) {
      return { scope: TRAIN_SCOPE, name: TRAIN_SCOPE_NAME };
    }
    const team = state.teams.find(
      (t) => confidenceRound(confidenceQuestion(t.name))?.questionnaire.title === title
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
    const asked = scopeOf(result.title);
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

  const remove = (vote: PiConfidenceVote) => {
    let index = -1;
    undoable({
      label: `Deleted the ${scopeLabel(state, vote.scope, vote.scopeName)} vote`,
      apply: () =>
        update((s) => {
          const list = s.confidence ?? [];
          index = list.findIndex((v) => v.id === vote.id);
          return { ...s, confidence: list.filter((v) => v.id !== vote.id) };
        }),
      revert: () =>
        update((s) => {
          const list = [...(s.confidence ?? [])];
          if (list.some((v) => v.id === vote.id)) return s;
          list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, vote);
          return { ...s, confidence: list.slice(-CONFIDENCE_MAX) };
        }),
    });
  };

  const deleteLabel = (v: PiConfidenceVote) =>
    `Delete the ${scopeLabel(state, v.scope, v.scopeName)} vote from ${dayLabel(localDayOf(v.at))}`;

  const voteLine = (v: PiConfidenceVote) =>
    `${scopeLabel(state, v.scope, v.scopeName)} · ${dayLabel(localDayOf(v.at), true)} · ${
      v.ballots
    } ${v.ballots === 1 ? "vote" : "votes"} · average ${averageText(v.counts)} of 5`;

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

      {latest ? (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-text">Latest vote</h3>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 basis-56 text-sm text-text">{voteLine(latest)}</p>
            <IconButton
              label={deleteLabel(latest)}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={() => remove(latest)}
            />
          </div>
          <VoteBars vote={latest} />
        </div>
      ) : (
        <p className="text-sm text-sub">
          No vote saved yet. Run one as planning ends, before the train commits to its objectives.
        </p>
      )}

      {earlier.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <h3 className="text-sm font-semibold text-text">Earlier votes</h3>
          <ul className="divide-y divide-border">
            {earlier.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-0 flex-1 basis-56 text-sm text-text">{voteLine(v)}</span>
                <span className="text-xs text-sub">{confidenceRule(v.counts)}</span>
                <IconButton
                  label={deleteLabel(v)}
                  icon={<Trash2 className="h-4 w-4" />}
                  className="text-sub hover:text-danger"
                  onClick={() => remove(v)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
