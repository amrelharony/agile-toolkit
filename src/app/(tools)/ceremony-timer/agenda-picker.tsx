"use client";

import { ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { cn } from "@/lib/utils";
import { agendaSeconds, durationText, type Agenda, type AgendaId } from "./agenda";

/**
 * The agendas to run, each with its length (from the team's cadence until
 * they change it). Nothing is picked until someone picks.
 */
export function AgendaPicker({
  agendas,
  selected,
  onPick,
}: {
  agendas: readonly Agenda[];
  selected: AgendaId | null;
  onPick: (id: AgendaId) => void;
}) {
  return (
    <SectionCard title="Agenda" icon={ListOrdered} titleSize="sm">
      <ul className="flex flex-col gap-1" aria-label="Agendas">
        {agendas.map((a) => {
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
                <span className="min-w-0 whitespace-normal">
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
        })}
      </ul>
    </SectionCard>
  );
}
