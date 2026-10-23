"use client";

import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { ObjectiveAddForm, ObjectiveEditor, type ObjectiveValues } from "./forms";
import type { PiObjective, PiTeam } from "./store";

/** "2 committed (BV 16), 1 uncommitted": a team's objectives at a glance. */
export function objectiveSummary(objectives: readonly PiObjective[]): string {
  const committed = objectives.filter((o) => o.committed);
  const stretch = objectives.length - committed.length;
  const bv = committed.reduce((a, o) => a + (o.businessValue ?? 0), 0);
  const unscored = objectives.filter((o) => o.businessValue === undefined).length;
  const parts = [
    `${committed.length} committed${committed.length > 0 ? ` (BV ${bv})` : ""}`,
    ...(stretch > 0 ? [`${stretch} uncommitted`] : []),
    ...(unscored > 0 ? [`${unscored} not scored`] : []),
  ];
  return parts.join(", ");
}

/**
 * PI objectives per team: what each team commits to, with the business
 * value its business owners give it (1–10) and whether it's a committed
 * objective or a stretch goal.
 */
export function ObjectivesPanel({
  teams,
  objectives,
  editingId,
  setEditingId,
  onAdd,
  onSave,
  onRemove,
}: {
  teams: readonly PiTeam[];
  objectives: readonly PiObjective[];
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onAdd: (v: ObjectiveValues) => void;
  onSave: (o: PiObjective, v: ObjectiveValues) => void;
  onRemove: (o: PiObjective) => void;
}) {
  return (
    <div className="space-y-4">
      <ObjectiveAddForm teams={teams} onAdd={onAdd} />
      {teams
        .map((team) => ({ team, list: objectives.filter((o) => o.teamId === team.id) }))
        .filter(({ list }) => list.length > 0)
        .map(({ team, list }) => (
          <div key={team.id} className="border-t border-border pt-3">
            <h3 className="text-sm font-semibold text-text">
              {team.name} <span className="font-normal text-sub">· {objectiveSummary(list)}</span>
            </h3>
            <ul className="mt-1 divide-y divide-border" aria-label={`${team.name} objectives`}>
              {list.map((o) => (
                <li key={o.id} className="py-2">
                  {editingId === o.id ? (
                    <ObjectiveEditor
                      objective={o}
                      teams={teams}
                      onSave={(v) => onSave(o, v)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 basis-56 break-words text-sm text-text">
                        {o.title}
                      </span>
                      <span className="font-mono text-xs text-text">
                        {o.businessValue === undefined ? (
                          <span className="font-sans text-sub">Not scored</span>
                        ) : (
                          `BV ${o.businessValue}`
                        )}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs",
                          o.committed ? "border-accent/40 text-accent" : "border-border text-sub"
                        )}
                      >
                        {o.committed ? "Committed" : "Uncommitted"}
                      </span>
                      <span className="flex shrink-0 items-center">
                        <IconButton
                          label={`Edit objective ${o.title}`}
                          icon={<Pencil className="h-4 w-4" />}
                          className="text-sub hover:text-text"
                          onClick={() => setEditingId(o.id)}
                        />
                        <IconButton
                          label={`Delete objective ${o.title}`}
                          icon={<Trash2 className="h-4 w-4" />}
                          className="text-sub hover:text-danger"
                          onClick={() => onRemove(o)}
                        />
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
