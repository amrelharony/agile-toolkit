"use client";

import { useId } from "react";
import { AlertTriangle, Coffee, Info } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { cafeMoves } from "@/lib/team-mixer/cafe";
import { BROKEN_KINDS, groupLabel } from "@/lib/team-mixer/model";
import type { MixerCafe } from "@/lib/team-mixer/state";
import { cn } from "@/lib/utils";

export interface CafeCardProps {
  cafe: MixerCafe;
  onShowRound: (index: number) => void;
}

/**
 * A World Café plan: pick a round to see its tables (hosts stay, guests
 * move), and the whole session person by person, "who goes where": a line
 * each on a phone, a table from sm up.
 */
export function CafeCard({ cafe, onShowRound }: CafeCardProps) {
  const round = cafe.rounds[cafe.current];
  const hosts = cafe.rounds[0].map((t) => t.host);
  const moves = Array.from(cafeMoves({ hosts, rounds: cafe.rounds }).entries());
  const label = (i: number) => round[i]?.name || groupLabel("cafe", i);
  /** Table `t` in round `r`, by its name when it has one. */
  const tableName = (r: number, t: number) => cafe.rounds[r]?.[t]?.name || groupLabel("cafe", t);
  const whereId = useId();

  return (
    <SectionCard title="World Café plan" icon={Coffee}>
      <div className="space-y-4">
        {cafe.title && <p className="break-words text-sm text-sub">{cafe.title}</p>}
        {cafe.rounds.length > 1 && (
          <ToggleGroup
            label="Round on screen"
            options={cafe.rounds.map((_, i) => ({ value: i, label: `Round ${i + 1}` }))}
            value={cafe.current}
            onValueChange={onShowRound}
          />
        )}
        <h3 className="text-sm font-semibold text-text">
          Round {cafe.current + 1} of {cafe.rounds.length}
        </h3>
        <ul
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={`Round ${cafe.current + 1} tables`}
        >
          {round.map((t, i) => (
            <li key={i} className="min-w-0 rounded-lg border border-border bg-card p-3">
              <p className="break-words font-semibold text-text">{label(i)}</p>
              <p className="break-words text-sm text-sub">Host: {t.host}</p>
              <ul className="mt-1.5 space-y-1" aria-label={`${label(i)} guests`}>
                {t.guests.map((p) => (
                  <li key={p} className="break-words text-sm text-text">
                    {p}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {cafe.issues.length > 0 && (
          <ul className="space-y-1.5" aria-label="About this plan">
            {cafe.issues.map((issue, i) => {
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

        <div className="space-y-2">
          <h3 id={whereId} className="text-sm font-semibold text-text">
            Who goes where
          </h3>
          {/* On a phone, one line per person: a table of rounds would need
              sideways scrolling there. */}
          <ul className="space-y-1.5 sm:hidden" aria-labelledby={whereId}>
            {moves.map(([name, tables]) => {
              const host = hosts.indexOf(name);
              return (
                <li key={name} className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="break-words text-sm font-medium text-text">
                    {name}
                    {host >= 0 && <span className="ml-1 text-xs font-normal text-sub">(host)</span>}
                  </p>
                  <p className="break-words text-sm text-sub">
                    {host >= 0
                      ? `${tableName(0, host)}, every round.`
                      : tables.map((t, r) => (
                          <span
                            key={r}
                            className={cn(r === cafe.current && "font-medium text-text")}
                          >
                            {r > 0 && " · "}
                            Round {r + 1}: {t >= 0 ? tableName(r, t) : "no table"}
                          </span>
                        ))}
                  </p>
                </li>
              );
            })}
          </ul>
          {/* From sm up, a table: it scrolls inside its own box (by keyboard
              too), with the names pinned while the rounds scroll. */}
          <div
            role="region"
            aria-labelledby={whereId}
            tabIndex={0}
            className="hidden max-w-full overflow-x-auto rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Each person&apos;s table, round by round</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="sticky left-0 bg-card px-3 py-2 font-medium text-text">
                    Person
                  </th>
                  {cafe.rounds.map((_, r) => (
                    <th
                      key={r}
                      scope="col"
                      className={cn(
                        "whitespace-nowrap px-3 py-2 font-medium text-text",
                        r === cafe.current && "bg-accent/10"
                      )}
                    >
                      Round {r + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {moves.map(([name, tables]) => (
                  <tr key={name} className="border-b border-border last:border-b-0">
                    <th
                      scope="row"
                      className="sticky left-0 bg-card px-3 py-1.5 font-normal text-text"
                    >
                      {name}
                      {hosts.includes(name) && (
                        <span className="ml-1 text-xs text-sub">(host)</span>
                      )}
                    </th>
                    {tables.map((t, r) => (
                      <td
                        key={r}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-text",
                          r === cafe.current && "bg-accent/10"
                        )}
                      >
                        {t >= 0 ? tableName(r, t) : "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
