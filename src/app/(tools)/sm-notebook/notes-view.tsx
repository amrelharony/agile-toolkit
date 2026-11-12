"use client";

/**
 * Every note, as a timeline by week (newest first), with a search over the
 * words, tags, event and linked tool, an event filter and tag filters. A tag
 * on a note filters by it too. The count says how many notes the filters
 * leave.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  eventCounts,
  filterNotes,
  groupByWeek,
  shiftDay,
  tagCounts,
  weekLabel,
  weekStartOf,
} from "@/lib/notebook/model";
import { toolNameOf } from "@/lib/notebook/tools";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { NoteCard, type NoteCardProps } from "./note-card";
import { SELECT_CLASS } from "./note-form";

/** Tags offered as filters, at most (most used first; a picked one always shows). */
const TAG_CHIPS = 12;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type CardHandlers = Omit<NoteCardProps, "note" | "activeTags" | "onToggleTag">;

export function NotesView({
  notes,
  today,
  cards,
}: {
  notes: readonly NotebookEntry[];
  today: string;
  cards: (note: NotebookEntry) => CardHandlers;
}) {
  const tagsLabelId = useId();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [event, setEvent] = useState("");

  const counts = useMemo(() => tagCounts(notes), [notes]);
  const events = useMemo(() => eventCounts(notes), [notes]);
  const chips = useMemo(() => {
    const top = counts.slice(0, TAG_CHIPS).map((c) => c.tag);
    return [...top, ...tags.filter((t) => !top.includes(t))];
  }, [counts, tags]);
  const shown = useMemo(
    () => filterNotes(notes, { query, tags, event: event || null }, toolNameOf),
    [notes, query, tags, event]
  );
  const weeks = useMemo(() => groupByWeek(shown), [shown]);
  const filtering = Boolean(query.trim() || tags.length > 0 || event);
  const thisWeek = weekStartOf(today);
  const lastWeek = shiftDay(thisWeek, -7);

  const toggleTag = (tag: string) =>
    setTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  const clear = () => {
    setQuery("");
    setTags([]);
    setEvent("");
  };

  return (
    <div className="space-y-4">
      <div role="search" className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <Field label="Search notes">
          {(props) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub"
                aria-hidden="true"
              />
              <Input
                {...props}
                type="search"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Words, tags, an event or a tool"
              />
            </div>
          )}
        </Field>
        <Field label="Filter by event">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={event}
              onChange={(e) => setEvent(e.target.value)}
            >
              <option value="">All events</option>
              {events.map((ev) => (
                <option key={ev.event} value={ev.event}>
                  {ev.label} ({ev.count})
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {chips.length > 0 && (
        <div className="space-y-1.5">
          <p id={tagsLabelId} className="text-xs font-medium text-sub">
            Filter by tag
          </p>
          <div role="group" aria-labelledby={tagsLabelId} className="flex flex-wrap gap-1.5">
            {chips.map((tag) => {
              const pressed = tags.includes(tag);
              const count = counts.find((c) => c.tag === tag)?.count ?? 0;
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "min-touch-coarse rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    pressed
                      ? "border-accent/60 bg-accent/10 text-text"
                      : "border-border text-sub hover:text-text"
                  )}
                >
                  {tag} <span className="tabular-nums">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm text-sub">
          {filtering
            ? `${plural(shown.length, "note")} of ${notes.length} match`
            : plural(notes.length, "note")}
        </p>
        {filtering && (
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={clear}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>

      {weeks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-sub">
          No note matches. Try fewer words, or clear the filters.
        </p>
      ) : (
        weeks.map((w) => (
          <WeekGroup
            key={w.weekStart}
            title={
              w.weekStart === thisWeek
                ? "This week"
                : w.weekStart === lastWeek
                  ? "Last week"
                  : weekLabel(w.weekStart)
            }
            notes={w.notes}
            render={(n) => (
              <NoteCard note={n} {...cards(n)} activeTags={tags} onToggleTag={toggleTag} />
            )}
          />
        ))
      )}
    </div>
  );
}

function WeekGroup({
  title,
  notes,
  render,
}: {
  title: string;
  notes: readonly NotebookEntry[];
  render: (n: NotebookEntry) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold text-text">
        {title} <span className="font-normal text-sub">· {plural(notes.length, "note")}</span>
      </h3>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id}>{render(n)}</li>
        ))}
      </ul>
    </section>
  );
}
