"use client";

import { useId, type CSSProperties } from "react";
import Link from "next/link";
import { CheckCircle2, Link2, MoveRight, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DependencyStatus } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { dayLabel } from "../dependency-map/format";
import { DependencyStatusChip } from "../dependency-map/status-chip";
import {
  EMPTY_ITEM,
  PiItemEditor,
  TeamEditor,
  type ItemDraft,
  type ItemValues,
  type TeamValues,
} from "./forms";
import { capacityOf, cellLoad, teamLoad, type DependencyView } from "./load";
import type { PiItem, PiItemKind, PiState, PiTeam } from "./store";

const KIND_STYLE: Record<PiItemKind, { label: string; border: string; text: string }> = {
  feature: { label: "Feature", border: "border-l-accent", text: "text-accent" },
  dependency: { label: "Dependency", border: "border-l-warning", text: "text-warning" },
  risk: { label: "Risk", border: "border-l-danger", text: "text-danger" },
};

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

/** What the board's editor is open on, if anything. */
export type Editing =
  | { kind: "team"; id: string }
  | { kind: "item"; id: string }
  | { kind: "add"; teamId: string; iteration: number }
  | null;

export interface BoardActions {
  saveTeam: (team: PiTeam, v: TeamValues) => void;
  removeTeam: (team: PiTeam) => void;
  addItem: (team: PiTeam, iteration: number, v: ItemValues) => void;
  saveItem: (item: PiItem, v: ItemValues) => void;
  moveItem: (item: PiItem, teamId: string, iteration: number) => void;
  removeItem: (item: PiItem) => void;
  setStatus: (item: PiItem, status: DependencyStatus) => void;
  relink: (item: PiItem) => void;
}

const draftFrom = (item: PiItem, view: DependencyView | undefined): ItemDraft => ({
  title: item.title,
  kind: item.kind,
  points: item.points === undefined ? "" : String(item.points),
  dependsOn: view?.waitsOn ?? item.dependsOn ?? "",
  due: view?.edge?.due ?? "",
  description: item.description ?? "",
});

/**
 * One team's row of the board as a card: its capacity and load, then one
 * cell per iteration. A single layout for every width: below 640 px the
 * cells stack, from 640 px they pair up, and from 768 px they line up as
 * the classic team × iteration row (scrolling inside the card when a PI
 * has more iterations than fit).
 */
export function TeamCard({
  team,
  state,
  views,
  editing,
  setEditing,
  actions,
}: {
  team: PiTeam;
  state: PiState;
  /** Dependency items' live state, by item id. */
  views: ReadonlyMap<string, DependencyView>;
  editing: Editing;
  setEditing: (e: Editing) => void;
  actions: BoardActions;
}) {
  const headingId = useId();
  const cap = capacityOf(team);
  const load = teamLoad(state, team);
  const others = state.teams.filter((t) => t.id !== team.id).map((t) => t.name);
  const editingTeam = editing?.kind === "team" && editing.id === team.id;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4"
    >
      {editingTeam ? (
        <TeamEditor
          team={team}
          teams={state.teams}
          onSave={(v) => actions.saveTeam(team, v)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-56">
            <h3 id={headingId} className="break-words text-base font-semibold text-text">
              {team.name || "Unnamed team"}
            </h3>
            <p className="text-xs text-sub">
              {cap ? `${pts(cap)} per iteration` : "No velocity set: load can't be checked"}
              {load.capacity !== null &&
                ` · ${load.planned} of ${load.capacity} pts planned (${load.pct}%)`}
              {load.unsized > 0 && ` · ${load.unsized} not sized`}
            </p>
            {team.description && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-sub">
                {team.description}
              </p>
            )}
          </div>
          <span className="ml-auto flex shrink-0 items-center">
            <IconButton
              label={`Edit team ${team.name}`}
              icon={<Pencil className="h-4 w-4" />}
              className="text-sub hover:text-text"
              onClick={() => setEditing({ kind: "team", id: team.id })}
            />
            <IconButton
              label={`Remove team ${team.name}`}
              icon={<Trash2 className="h-4 w-4" />}
              className="text-sub hover:text-danger"
              onClick={() => actions.removeTeam(team)}
            />
          </span>
        </div>
      )}

      <div className="mt-3 md:overflow-x-auto">
        <ol
          aria-label={`${team.name} iterations`}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:[grid-template-columns:repeat(var(--pi-iterations),minmax(11rem,1fr))]"
          style={{ "--pi-iterations": state.iterations } as CSSProperties}
        >
          {Array.from({ length: state.iterations }, (_, it) => {
            const items = state.items.filter((i) => i.teamId === team.id && i.iteration === it);
            const cell = cellLoad(state, team, it);
            const adding =
              editing?.kind === "add" && editing.teamId === team.id && editing.iteration === it;
            return (
              <li
                key={it}
                className={cn(
                  "min-w-0 space-y-2 rounded-lg border p-2",
                  cell.over ? "border-danger/40 bg-danger/5" : "border-border bg-card"
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-sub">
                    Iteration {it + 1}
                  </h4>
                  <span className="font-mono text-xs text-text">
                    {cell.planned}
                    {cell.capacity !== null && ` / ${cell.capacity}`} pts
                  </span>
                </div>
                {cell.over && (
                  <p className="text-xs text-danger">
                    Over capacity by {pts(cell.planned - (cell.capacity as number))}
                  </p>
                )}
                {cell.unsized > 0 && (
                  <p className="text-xs text-sub">
                    {cell.unsized} {cell.unsized === 1 ? "feature" : "features"} not sized
                  </p>
                )}
                {items.length > 0 && (
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li key={item.id}>
                        {editing?.kind === "item" && editing.id === item.id ? (
                          <PiItemEditor
                            initial={draftFrom(item, views.get(item.id))}
                            teamName={team.name}
                            otherTeams={others}
                            submitLabel="Save"
                            onSave={(v) => actions.saveItem(item, v)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <ItemCard
                            item={item}
                            view={views.get(item.id)}
                            state={state}
                            onEdit={() => setEditing({ kind: "item", id: item.id })}
                            actions={actions}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {adding ? (
                  <PiItemEditor
                    initial={EMPTY_ITEM}
                    teamName={team.name}
                    otherTeams={others}
                    submitLabel="Add item"
                    onSave={(v) => actions.addItem(team, it, v)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-touch-coarse w-full gap-1 text-xs text-sub hover:text-accent"
                    aria-label={`Add item to ${team.name || "team"}, iteration ${it + 1}`}
                    onClick={() => setEditing({ kind: "add", teamId: team.id, iteration: it })}
                  >
                    <Plus aria-hidden="true" />
                    Add item
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function ItemCard({
  item,
  view,
  state,
  onEdit,
  actions,
}: {
  item: PiItem;
  view: DependencyView | undefined;
  state: PiState;
  onEdit: () => void;
  actions: BoardActions;
}) {
  const style = KIND_STYLE[item.kind];
  const name = item.title || "Untitled item";
  return (
    <div
      className={cn("space-y-1 rounded-md border border-l-4 border-border bg-bg p-2", style.border)}
    >
      <p className="break-words text-sm text-text">{name}</p>
      <p className="flex flex-wrap gap-x-2 text-xs">
        <span className={style.text}>{style.label}</span>
        <span className="text-sub">
          {item.points === undefined ? "Not sized" : pts(item.points)}
        </span>
      </p>
      {item.description && (
        <p className="whitespace-pre-wrap break-words text-xs text-sub">{item.description}</p>
      )}
      {item.kind === "dependency" && view && (
        <DependencyLine item={item} view={view} actions={actions} />
      )}
      <div className="flex flex-wrap items-center justify-end">
        <MoveMenu item={item} state={state} onMove={(t, it) => actions.moveItem(item, t, it)} />
        <IconButton
          label={`Edit ${name}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={() => actions.removeItem(item)}
        />
      </div>
    </div>
  );
}

/** Where a dependency stands on the Dependency Map, resolvable from here. */
function DependencyLine({
  item,
  view,
  actions,
}: {
  item: PiItem;
  view: DependencyView;
  actions: BoardActions;
}) {
  const name = item.title || "dependency";
  if (!view.edge) {
    return (
      <div className="space-y-1 text-xs text-sub">
        <p>
          {view.waitsOn ? `Waits on ${view.waitsOn}. ` : ""}Not on the Dependency Map
          {view.waitsOn ? "." : " yet: edit it to name the team it waits on."}
        </p>
        {view.waitsOn && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-touch-coarse h-7 gap-1 px-2 text-xs"
            onClick={() => actions.relink(item)}
          >
            <Link2 aria-hidden="true" />
            Add to the map
          </Button>
        )}
      </div>
    );
  }
  const resolved = view.status === "resolved";
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
        <span>Waits on {view.waitsOn}</span>
        <DependencyStatusChip status={view.status ?? "open"} overdue={view.overdue} />
        {view.edge.due && (
          <span className={view.overdue ? "text-danger" : undefined}>
            due {dayLabel(view.edge.due)}
          </span>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-x-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "min-touch-coarse h-7 gap-1 px-2 text-xs",
            resolved ? "text-sub" : "text-success"
          )}
          aria-label={`${resolved ? "Reopen" : "Resolve"} ${name}`}
          onClick={() => actions.setStatus(item, resolved ? "open" : "resolved")}
        >
          {resolved ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          {resolved ? "Reopen" : "Resolve"}
        </Button>
        <Link
          href="/dependency-map"
          className="text-xs text-sub underline-offset-2 hover:text-accent hover:underline"
        >
          On the map
        </Link>
      </p>
    </div>
  );
}

/** "Move to…": any team's any iteration, from the keyboard as well as the mouse. */
function MoveMenu({
  item,
  state,
  onMove,
}: {
  item: PiItem;
  state: PiState;
  onMove: (teamId: string, iteration: number) => void;
}) {
  const name = item.title || "item";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch-coarse h-7 gap-1 px-2 text-xs text-sub hover:text-accent"
          aria-label={`Move ${name}`}
        >
          <MoveRight aria-hidden="true" />
          Move
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {state.teams.map((t) => (
          <DropdownMenuGroup key={t.id}>
            <DropdownMenuLabel className="text-xs font-medium text-sub">{t.name}</DropdownMenuLabel>
            {Array.from({ length: state.iterations }, (_, it) => {
              const here = t.id === item.teamId && it === item.iteration;
              return (
                <DropdownMenuItem
                  key={it}
                  disabled={here}
                  aria-label={`${t.name}, iteration ${it + 1}${here ? " (here now)" : ""}`}
                  onSelect={() => onMove(t.id, it)}
                >
                  Iteration {it + 1}
                  {here && <span className="ml-auto text-xs text-sub">here</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
