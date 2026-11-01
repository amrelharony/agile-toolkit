"use client";

import { Archive, ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { BlurInput } from "@/components/shared/blur-fields";
import { cn } from "@/lib/utils";
import type {
  HealthDimensionScore,
  HealthTrafficLight,
  HealthVotes,
} from "@/lib/stores/workspace-types";
import {
  HEALTH_LIGHTS,
  HEALTH_NOTE_MAX,
  DIMENSION_NAME_MAX,
  isSplit,
  trendFor,
  votesTotal,
  type HealthDimensionInfo,
} from "@/lib/health-check/score";
import { NameField } from "./name-field";

const LIGHT_LABEL: Record<HealthTrafficLight, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
};
const LIGHT_EMOJI: Record<HealthTrafficLight, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const LIGHT_RING: Record<HealthTrafficLight, string> = {
  green: "ring-2 ring-success",
  yellow: "ring-2 ring-warning",
  red: "ring-2 ring-danger",
};
const LIGHT_BG: Record<HealthTrafficLight, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-danger",
};

/** A saved light as a dot, in theme colours. */
export function TrafficDot({ light }: { light: HealthTrafficLight | null }) {
  if (!light) return <span className="text-sub">—</span>;
  return (
    <span
      className={cn("inline-block h-4 w-4 rounded-full shadow-sm", LIGHT_BG[light])}
      title={LIGHT_LABEL[light]}
      role="img"
      aria-label={LIGHT_LABEL[light]}
    />
  );
}

function TrafficButton({
  active,
  light,
  onClick,
}: {
  active: boolean;
  light: HealthTrafficLight;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-touch-coarse flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? cn("bg-card text-text", LIGHT_RING[light])
          : "bg-transparent text-sub hover:bg-card-hover"
      )}
    >
      <span aria-hidden="true">{LIGHT_EMOJI[light]}</span>
      <span>{LIGHT_LABEL[light]}</span>
    </button>
  );
}

/** The derived trend against the previous saved check, or why there is none. */
function TrendNote({
  light,
  prevLight,
  prevLabel,
}: {
  light: HealthTrafficLight | null;
  prevLight: HealthTrafficLight | null;
  prevLabel: string | null;
}) {
  if (!light) return <span className="text-xs text-sub">Not rated</span>;
  if (!prevLabel) return <span className="text-xs text-sub">First check</span>;
  if (!prevLight) return <span className="text-xs text-sub">New since {prevLabel}</span>;
  const trend = trendFor(prevLight, light);
  const Icon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : ArrowRight;
  const tone = trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-sub";
  const word = trend === "up" ? "Up" : trend === "down" ? "Down" : "Same";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {word}
      <span className="text-sub"> since {prevLabel}</span>
    </span>
  );
}

/** The team's votes on a dimension: a stacked bar, the counts in words, and "Split" when it splits. */
export function VotesBar({ votes }: { votes: HealthVotes }) {
  const n = votesTotal(votes);
  if (n === 0) return null;
  const parts = (["green", "yellow", "red"] as const).map((l) => ({ l, k: votes[l] }));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
      <span className="flex h-2.5 w-32 overflow-hidden rounded bg-card-hover" aria-hidden="true">
        {parts.map(({ l, k }) =>
          k > 0 ? (
            <span key={l} className={LIGHT_BG[l]} style={{ width: `${(k / n) * 100}%` }} />
          ) : null
        )}
      </span>
      <span>
        {votes.green} green · {votes.yellow} yellow · {votes.red} red ({n}{" "}
        {n === 1 ? "vote" : "votes"})
      </span>
      {isSplit(votes) && (
        <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
          Split view
        </span>
      )}
    </div>
  );
}

export interface DimensionRowProps {
  dim: HealthDimensionInfo;
  /** Its rated light, or null while it isn't rated. */
  light: HealthTrafficLight | null;
  score: HealthDimensionScore | undefined;
  /** The previous saved check's light for it, and that check's name (null: none). */
  prevLight: HealthTrafficLight | null;
  prevLabel: string | null;
  /** Unrated after a save was tried. */
  invalid: boolean;
  onRate: (light: HealthTrafficLight) => void;
  onNote: (note: string) => void;
  /** Custom dimensions: rename (returns why not, or null) and archive. */
  onRename?: (name: string) => string | null;
  onArchive?: () => void;
}

/**
 * One dimension of the check in progress: its light (no light is pressed
 * until the team rates it), the votes it came from, the trend against the
 * previous saved check (derived, never typed) and the team's note.
 */
export function DimensionRow({
  dim,
  light,
  score,
  prevLight,
  prevLabel,
  invalid,
  onRate,
  onNote,
  onRename,
  onArchive,
}: DimensionRowProps) {
  return (
    <li className="border-b border-border py-3 last:border-0" data-dimension={dim.key}>
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,11rem)] md:items-center md:gap-3">
        <div className="min-w-0">
          {dim.custom && onRename ? (
            <NameField
              name={dim.name}
              label={`Name of the dimension ${dim.name}`}
              maxLength={DIMENSION_NAME_MAX}
              onRename={onRename}
            />
          ) : (
            <span className="text-sm font-medium text-text">{dim.name}</span>
          )}
          {dim.description && <p className="text-xs text-sub">{dim.description}</p>}
        </div>
        <div
          role="group"
          aria-label={`${dim.name} status${invalid ? ", not rated yet" : ""}`}
          data-unrated={light === null ? "true" : undefined}
          className={cn(
            "flex flex-wrap gap-1.5 rounded-md",
            invalid && "outline outline-1 outline-offset-2 outline-danger"
          )}
        >
          {HEALTH_LIGHTS.map((l) => (
            <TrafficButton key={l} light={l} active={light === l} onClick={() => onRate(l)} />
          ))}
        </div>
        <TrendNote light={light} prevLight={prevLight} prevLabel={prevLabel} />
      </div>
      {score?.votes && votesTotal(score.votes) > 0 && (
        <div className="mt-2">
          <VotesBar votes={score.votes} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <BlurInput
          value={score?.note ?? ""}
          onCommit={onNote}
          maxLength={HEALTH_NOTE_MAX}
          placeholder="What the team said (optional)"
          aria-label={`Note on ${dim.name}`}
          className="h-8 flex-1 text-xs"
        />
        {dim.custom && onArchive && (
          <IconButton
            label={`Archive ${dim.name}`}
            icon={<Archive className="h-4 w-4" aria-hidden="true" />}
            onClick={onArchive}
          />
        )}
      </div>
    </li>
  );
}
