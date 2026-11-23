"use client";

/**
 * The confidence votes the board keeps: the latest with its bars and the
 * rule, the earlier ones in a list, each deleted with Undo. The confidence
 * vote shows them under its round, and the page shows them on their own
 * when the board has no teams left (removing a team keeps its votes), so
 * they can still be read and deleted.
 *
 * Loaded with next/dynamic by the page, like the vote itself, so the vote
 * kit's formats come down only when there's a vote to show.
 */

import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  averageText,
  confidenceRule,
  confidenceVotes,
  scopeLabel,
  votesUnderThree,
} from "@/lib/pi-planning/confidence";
import {
  CONFIDENCE_MAX,
  localDayOf,
  type PiConfidenceVote,
  type PiState,
} from "@/lib/pi-planning/model";
import { presetById } from "@/lib/quick-vote/presets";
import { cn } from "@/lib/utils";
import { undoable } from "@/lib/utils/undoable";
import { dayLabel } from "../dependency-map/format";

type Update = (fn: (s: PiState) => PiState) => void;

/** The scale's labels, lowest first ("1: Not at all" …). */
const POINT_LABELS = (presetById("confidence")?.points ?? []).map((p) => p.label);

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

export function SavedVotes({ state, update }: { state: PiState; update: Update }) {
  const votes = confidenceVotes(state);
  const latest = votes[votes.length - 1];
  const earlier = votes.slice(0, -1).reverse();

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
    <>
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
    </>
  );
}
