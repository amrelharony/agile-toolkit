"use client";

import { ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { cn } from "@/lib/utils";
import { agendaSeconds, durationText, type Agenda, type AgendaKey } from "./agenda";

/**
 * The agendas to run, each with its length (from the team's cadence until
 * they change it): the built-in ones, then the team's own, saved by name.
 * Nothing is picked until someone picks.
 */
export function AgendaPicker({
  agendas,
  selected,
  onPick,
}: {
  agendas: readonly Agenda[];
  selected: AgendaKey | null;
  onPick: (id: AgendaKey) => void;
}) {
  const builtIn = agendas.filter((a) => !a.saved);
  const named = agendas.filter((a) => a.saved);
  const row = (a: Agenda) => {
    const total = agendaSeconds(a);
    const active = a.id === selected;
    return (
      <li key={a.id}>
        <Button
          variant="ghost"
          onClick={() => onPick(a.id)}
          aria-pressed={active}
          className={cn(
            "h-auto min-h-11 w-full justify-between gap-3 px-4 py-2 text-left text-sm",
            active
              ? "border border-accent/30 bg-accent/10 text-accent"
              : "text-sub hover:bg-surface-hover hover:text-text"
          )}
        >
          <span className="min-w-0 whitespace-normal break-words">
            {a.label}
            {a.segments.length > 1 && (
              <span className="block text-xs opacity-70">{a.segments.length} segments</span>
            )}
          </span>
          <span className="shrink-0 font-data text-xs tabular-nums opacity-70">
            {total > 0 ? durationText(total) : "set a length"}
          </span>
        </Button>
      </li>
    );
  };

  return (
    <SectionCard title="Agenda" icon={ListOrdered} titleSize="sm">
      <ul className="flex flex-col gap-1" aria-label="Agendas">
        {builtIn.map(row)}
      </ul>
      {named.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">Your agendas</h3>
          <ul className="flex flex-col gap-1" aria-label="Your agendas">
            {named.map(row)}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
