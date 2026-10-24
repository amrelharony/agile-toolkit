"use client";

import { useState } from "react";
import { ArrowRightLeft, Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineItemEditor } from "@/components/shared/inline-item-editor";
import { useReturnFocus, type RefFor } from "@/hooks/use-return-focus";
import type { SixHatsHat, SixHatsThought } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { HATS, hatInfo } from "./hats";
import { THOUGHT_MAX, byHat, hatColumns } from "./session";

/** "Ship behind feature flags so…" for a button's name. */
export function shortText(text: string, max = 40): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Thoughts in a column per hat, oldest first, each edited in place, moved to
 * another hat from its menu, or deleted (the caller offers Undo). Editing
 * never re-sorts a column: thoughts keep the order they were said in.
 */
export function ThoughtColumns({
  order,
  thoughts,
  currentHat,
  regionPrefix = "",
  onEdit,
  onMove,
  onRemove,
}: {
  /** The session's order; null shows every hat with thoughts. */
  order: readonly SixHatsHat[] | null;
  thoughts: readonly SixHatsThought[];
  currentHat?: SixHatsHat;
  /** Tells two sets of columns apart for screen readers ("Earlier thoughts: "). */
  regionPrefix?: string;
  onEdit: (t: SixHatsThought, text: string) => void;
  onMove: (t: SixHatsThought, hat: SixHatsHat) => void;
  onRemove: (t: SixHatsThought) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { refFor, returnTo } = useReturnFocus();
  const groups = byHat(thoughts);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {hatColumns(order, thoughts).map((hat) => {
        const info = hatInfo(hat);
        const list = groups[hat];
        const now = hat === currentHat;
        return (
          <section
            key={hat}
            aria-label={`${regionPrefix}${info.name} hat`}
            className={cn(
              "min-w-0 rounded-md border border-l-4 border-border bg-surface-deep p-3",
              info.edge,
              now && "ring-2 ring-accent/40"
            )}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn("h-3 w-3 shrink-0 rounded-full", info.swatch)}
                aria-hidden="true"
              />
              <h3 className="min-w-0 flex-1 text-sm">
                <span className={cn("font-bold uppercase", info.text)}>{info.name}</span>
                <span className="text-sub"> · {info.focus}</span>
                {now && <span className="ml-2 text-xs font-medium text-accent">Now</span>}
              </h3>
              <span className="text-xs text-sub">
                {list.length}
                <span className="sr-only"> {list.length === 1 ? "thought" : "thoughts"}</span>
              </span>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-sub">Nothing under this hat yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {list.map((t) => (
                  <li key={t.id} className="text-sm">
                    {editingId === t.id ? (
                      <InlineItemEditor
                        label="Edit thought"
                        titleLabel="Thought"
                        title={t.text}
                        titleMaxLength={THOUGHT_MAX}
                        onDone={(next, { refocus }) => {
                          setEditingId(null);
                          if (refocus) returnTo(`edit:${t.id}`);
                          if (next) onEdit(t, next.title);
                        }}
                      />
                    ) : (
                      <ThoughtRow
                        thought={t}
                        refFor={refFor}
                        onEdit={() => setEditingId(t.id)}
                        onMove={(to) => {
                          // The thought re-renders in its new column; focus follows it there.
                          returnTo(`move:${t.id}`);
                          onMove(t, to);
                        }}
                        onRemove={() => onRemove(t)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ThoughtRow({
  thought,
  refFor,
  onEdit,
  onMove,
  onRemove,
}: {
  thought: SixHatsThought;
  refFor: RefFor;
  onEdit: () => void;
  onMove: (hat: SixHatsHat) => void;
  onRemove: () => void;
}) {
  const name = shortText(thought.text);
  return (
    <div className="flex items-start gap-1">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1 text-text">
        {thought.text}
      </p>
      <span className="flex shrink-0 items-center">
        <IconButton
          ref={refFor(`edit:${thought.id}`)}
          label={`Edit thought: ${name}`}
          icon={<Pencil className="h-3.5 w-3.5" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              ref={refFor(`move:${thought.id}`)}
              label={`Move to another hat: ${name}`}
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
              className="text-sub hover:text-text"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs font-medium text-sub">Move to</DropdownMenuLabel>
            {HATS.map((h) => {
              const here = h.id === thought.hat;
              return (
                <DropdownMenuItem
                  key={h.id}
                  disabled={here}
                  aria-label={here ? `${h.name} hat (here now)` : `${h.name} hat`}
                  onSelect={() => onMove(h.id)}
                >
                  <span className={cn("h-2.5 w-2.5 rounded-full", h.swatch)} aria-hidden="true" />
                  <span className={h.text}>{h.name}</span>
                  <span className="text-xs text-sub">{h.focus}</span>
                  {here && <span className="ml-auto text-xs text-sub">here</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          label={`Delete thought: ${name}`}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
