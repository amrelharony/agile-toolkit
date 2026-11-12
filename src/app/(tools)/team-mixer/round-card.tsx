"use client";

import { useId, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Info, LayoutGrid } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { BROKEN_KINDS, groupLabel } from "@/lib/team-mixer/model";
import type { MixerRound } from "@/lib/team-mixer/state";
import { findRosterMember } from "@/lib/team/names";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./fields";
import { GroupNamer } from "./group-namer";

export interface RoundCardProps {
  round: MixerRound;
  roster: readonly TeamMember[];
  onMove: (name: string, toGroup: number) => void;
  onName: (names: (string | null)[]) => void;
}

/** A person's role or skills from the roster, as the round was balanced. */
function traitOf(
  roster: readonly TeamMember[],
  name: string,
  balance: MixerRound["balance"]
): string {
  if (balance === "none") return "";
  const m = findRosterMember(roster, name);
  if (balance === "role") return m?.role?.trim() ?? "";
  return (m?.skills ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * The newest round: each group with its people (and their role or skills
 * when the round was balanced), the plain-words report, a way to move
 * someone after the mix, and fun names for the groups.
 */
export function RoundCard({ round, roster, onMove, onName }: RoundCardProps) {
  const id = useId();
  const number = round.number;
  const word = round.mode === "pairs" ? "Pair" : "Group";
  const everyone = [...round.groups.flatMap((g) => g.people), ...round.sitOut];
  const [who, setWho] = useState("");
  const [to, setTo] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const label = (i: number) => round.groups[i].name || groupLabel(round.mode, i);

  const move = () => {
    if (!who) return setMoveError("Pick who to move.");
    if (to === "") return setMoveError(`Pick the ${word.toLowerCase()} to move them to.`);
    setMoveError(null);
    onMove(who, Number(to));
    setWho("");
    setTo("");
  };

  return (
    <SectionCard
      title={`Round ${number}: ${round.groups.length} ${round.mode === "pairs" ? "pairs" : "groups"}`}
      icon={LayoutGrid}
    >
      <div className="space-y-4">
        {round.title && <p className="break-words text-sm text-sub">{round.title}</p>}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Round ${number}`}>
          {round.groups.map((g, i) => (
            <li key={i} className="min-w-0 rounded-lg border border-border bg-card p-3">
              <p className="break-words font-semibold text-text">
                {label(i)}
                {g.name && (
                  <span className="ml-1.5 text-xs font-normal text-sub">
                    {groupLabel(round.mode, i)}
                  </span>
                )}
              </p>
              <ul className="mt-1.5 space-y-1" aria-label={label(i)}>
                {g.people.map((p) => {
                  const trait = traitOf(roster, p, round.balance);
                  return (
                    <li key={p} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="break-words text-text">{p}</span>
                      {trait && <span className="break-words text-xs text-sub">{trait}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {round.sitOut.length > 0 && (
          <p className="text-sm text-text">Sitting out: {round.sitOut.join(", ")}</p>
        )}

        {round.issues.length > 0 && (
          <ul className="space-y-1.5" aria-label="About this mix">
            {round.issues.map((issue, i) => {
              const broken = BROKEN_KINDS.has(issue.kind);
              return (
                <li key={i} className="flex items-start gap-2 text-sm text-text">
                  {broken ? (
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                      role="img"
                      aria-label="Rule broken"
                    />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
                  )}
                  <span className={cn("min-w-0 break-words", broken && "font-medium")}>
                    {issue.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-sub" aria-hidden="true" />
            <p className="text-sm font-medium text-text">Move someone</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Who" error={moveError && !who ? moveError : undefined}>
              {(props) => (
                <NativeSelect {...props} value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Pick someone</option>
                  {everyone.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="To" error={moveError && who ? moveError : undefined}>
              {(props) => (
                <NativeSelect {...props} value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Pick a {word.toLowerCase()}</option>
                  {round.groups.map((_, i) => (
                    <option key={i} value={String(i)}>
                      {label(i)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Button type="button" variant="outline" onClick={move} aria-describedby={`${id}-move`}>
              Move
            </Button>
          </div>
          <p id={`${id}-move`} className="text-xs text-sub">
            For someone who must leave early or join late. The next round still avoids who sat
            together.
          </p>
        </div>

        <GroupNamer count={round.groups.length} unit={word} onApply={onName} />
      </div>
    </SectionCard>
  );
}
