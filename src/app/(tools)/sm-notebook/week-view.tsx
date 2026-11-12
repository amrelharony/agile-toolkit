"use client";

/**
 * The week: one week's notes read together (Monday to Sunday), with how many
 * carry each tag and came from each event, and Amr's read of it: a summary,
 * the patterns and tools to try. Amr's read only shows; "Keep as a note"
 * saves the summary (edited, with the patterns ticked) as a note tagged
 * weekly-summary, with Undo. Kept summaries show at the top of their week
 * and never count in it.
 *
 * Keyboard focus never falls to the page: the week buttons stay in place
 * (Next week is aria-disabled on this week, not disabled), "This week" hands
 * focus to Previous week as it goes, and Keep or Dismiss move it to the kept
 * summary or back to the button that asked. A new week and a finished read
 * are announced.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { AiSource } from "@/lib/ai/task-types";
import { notebookWeeklySummaryTask } from "@/lib/ai/tasks/sm-notebook";
import { cn } from "@/lib/utils";
import {
  NOTE_BODY_MAX,
  eventCounts,
  formatDay,
  notesOfWeek,
  shiftDay,
  tagCounts,
  weekEndOf,
  weekLabel,
  weekStartOf,
} from "@/lib/notebook/model";
import {
  WEEKLY_BODY_MAX,
  summaryNoteBody,
  weeklyInput,
  type WeeklyInput,
  type WeeklyOutput,
} from "@/lib/notebook/summary";
import { resolveSuggestedTools, type SuggestedTool } from "@/lib/notebook/tools";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { NoteCard, type NoteCardProps } from "./note-card";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface KeptSummary {
  weekStart: string;
  summary: string;
  patterns: string[];
  source: AiSource;
}

/** A kept summary needs its text, and must fit in a note with its patterns. */
export function validateSummary(
  summary: string,
  patterns: readonly string[]
): Validation<{ summary: string; patterns: string[] }, "summary"> {
  const text = summary.trim();
  if (!text) return { ok: false, errors: { summary: "Write the summary, or dismiss it." } };
  if (summaryNoteBody(text, patterns).length > NOTE_BODY_MAX) {
    return { ok: false, errors: { summary: `Keep it to ${NOTE_BODY_MAX} characters or fewer.` } };
  }
  return { ok: true, values: { summary: text, patterns: [...patterns] } };
}

type CardHandlers = Omit<NoteCardProps, "note">;

interface Review {
  weekStart: string;
  source: AiSource;
  data: WeeklyOutput;
  tools: SuggestedTool[];
}

function Counts({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number }[];
}) {
  const headingId = useId();
  if (rows.length === 0) return null;
  const top = Math.max(...rows.map((r) => r.count));
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className="mb-1.5 text-xs font-medium text-sub">
        {title}
      </h3>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-sm text-text">
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span
              aria-hidden="true"
              className="h-2 rounded-full bg-accent/20"
              style={{ width: `${Math.max(8, Math.round((r.count / top) * 64))}px` }}
            />
            <span className="w-6 shrink-0 text-right tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WeeklyReview({
  review,
  onKeep,
  onDismiss,
}: {
  review: Review;
  onKeep: (kept: KeptSummary) => void;
  onDismiss: () => void;
}) {
  const headingId = useId();
  const [summary, setSummary] = useState(review.data.summary);
  const [kept, setKept] = useState<ReadonlySet<number>>(
    () => new Set(review.data.patterns.map((_, i) => i))
  );
  const [tried, setTried] = useState(false);
  const patterns = review.data.patterns.filter((_, i) => kept.has(i));
  const check = validateSummary(summary, patterns);
  const error = tried && !check.ok ? check.errors.summary : undefined;

  const keep = () => {
    if (!check.ok) {
      setTried(true);
      return;
    }
    onKeep({ weekStart: review.weekStart, ...check.values, source: review.source });
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="weekly-review"
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div>
        <h3 id={headingId} className="text-sm font-semibold text-text">
          Amr&apos;s read of the week
        </h3>
        <p className="text-xs text-sub">
          {review.source === "fallback"
            ? "Written without AI, from your notes' counts, tags and words. Check it before you keep it."
            : "Written by Amr's AI from your notes. Check it before you keep it."}
        </p>
      </div>

      <Field label="Summary" error={error} required>
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        )}
      </Field>

      {review.data.patterns.length > 0 ? (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-medium text-sub">Patterns to keep with it</legend>
          {review.data.patterns.map((p, i) => (
            <label key={i} className="flex min-h-11 items-start gap-2 py-1 text-sm text-text">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={kept.has(i)}
                onChange={(e) =>
                  setKept((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span className="min-w-0 break-words">{p}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-sub">No pattern stood out this week.</p>
      )}

      {review.tools.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-sub">Tools to try</h4>
          <ul className="space-y-2">
            {review.tools.map((t) => (
              <li key={t.id} className="text-sm">
                <Link
                  href={t.href}
                  className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t.name}
                </Link>
                {t.why && <p className="break-words text-xs text-sub">{t.why}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="gap-1" onClick={keep}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Keep as a note
        </Button>
        <Button type="button" variant="ghost" className="gap-1" onClick={onDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
          Dismiss
        </Button>
      </div>
    </section>
  );
}

export function WeekView({
  notes,
  today,
  cards,
  onKeep,
}: {
  notes: readonly NotebookEntry[];
  today: string;
  cards: (note: NotebookEntry) => CardHandlers;
  onKeep: (kept: KeptSummary) => void;
}) {
  const thisWeek = weekStartOf(today);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [review, setReview] = useState<Review | null>(null);
  const headingId = useId();
  const week = useMemo(() => notesOfWeek(notes, weekStart), [notes, weekStart]);
  const tags = tagCounts(week.notes).map((t) => ({ key: t.tag, label: t.tag, count: t.count }));
  const events = eventCounts(week.notes).map((e) => ({
    key: e.event,
    label: e.label,
    count: e.count,
  }));
  const shown = review && review.weekStart === weekStart ? review : null;
  const rangeOf = (start: string) => `${formatDay(start)} to ${formatDay(weekEndOf(start))}`;
  const range = rangeOf(weekStart);
  const atThisWeek = weekStart >= thisWeek;
  const announce = useAnnounce();

  const askRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const keptRef = useRef<HTMLHeadingElement>(null);
  /** What gets focus once the next render is on screen. */
  const focusNext = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const pick = focusNext.current;
    if (!pick) return;
    focusNext.current = null;
    pick()?.focus();
  });
  // Queried each time: the kit's button is re-created when it can be used again.
  const askButton = () => askRef.current?.querySelector<HTMLElement>("button");

  const go = (start: string) => {
    setWeekStart(start);
    setReview(null);
    const n = notesOfWeek(notes, start).notes.length;
    announce(
      `${start === thisWeek ? "This week" : weekLabel(start)}, ${rangeOf(start)}: ${plural(n, "note")}`
    );
  };

  const takeReview = (data: WeeklyOutput, source: AiSource) => {
    const tools = resolveSuggestedTools(data.tools);
    setReview({ weekStart, source, data, tools });
    const parts = [
      "a summary",
      ...(data.patterns.length > 0 ? [plural(data.patterns.length, "pattern")] : []),
      ...(tools.length > 0 ? [`${plural(tools.length, "tool")} to try`] : []),
    ];
    const list =
      parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    announce(`Amr's read of the week is ready below: ${list}.`);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={headingId}
            tabIndex={-1}
            data-notebook-view-heading=""
            className="rounded-sm text-base font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {weekStart === thisWeek ? "This week" : weekLabel(weekStart)}
          </h2>
          <p className="text-xs text-sub">
            {range} · {plural(week.notes.length, "note")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            ref={prevRef}
            type="button"
            size="sm"
            variant="outline"
            className="min-touch-coarse gap-1"
            onClick={() => go(shiftDay(weekStart, -7))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous week
          </Button>
          {weekStart !== thisWeek && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-touch-coarse"
              onClick={() => {
                // This button goes with the week it leaves: focus stays on the row.
                focusNext.current = () => prevRef.current;
                go(thisWeek);
              }}
            >
              This week
            </Button>
          )}
          {/* aria-disabled, not disabled: a disabled button would drop focus to the page. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("min-touch-coarse gap-1", atThisWeek && "opacity-60")}
            aria-disabled={atThisWeek || undefined}
            onClick={() => {
              if (!atThisWeek) go(shiftDay(weekStart, 7));
            }}
          >
            Next week
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {week.notes.length > 0 && (tags.length > 0 || events.length > 0) && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2">
          <Counts title="By tag" rows={tags} />
          <Counts title="By event" rows={events} />
        </div>
      )}

      <div className="space-y-2">
        <div ref={askRef}>
          <AiButton
            task={notebookWeeklySummaryTask}
            input={() => weeklyInput(notes, weekStart) as WeeklyInput}
            onResult={(data, meta) => takeReview(data, meta.source)}
            label="Ask Amr about this week"
            fallbackLabel="Sum up this week"
            disabledReason={week.notes.length === 0 ? "Write a note in this week first." : null}
          />
        </div>
        <p className="text-xs text-sub">
          Ask Amr sends this week&apos;s notes, each cut to {WEEKLY_BODY_MAX} characters, to
          Amr&apos;s AI. Nothing is kept until you keep it.
        </p>
      </div>

      {shown && (
        <WeeklyReview
          key={`${shown.weekStart}:${shown.source}:${shown.data.summary}`}
          review={shown}
          onKeep={(kept) => {
            // The kept summary shows below; its heading takes focus from Keep.
            focusNext.current = () => keptRef.current ?? askButton();
            onKeep(kept);
            setReview(null);
          }}
          onDismiss={() => {
            askButton()?.focus();
            setReview(null);
          }}
        />
      )}

      {week.summaries.length > 0 && (
        <div className="space-y-2">
          <h3
            ref={keptRef}
            tabIndex={-1}
            className="rounded-sm text-sm font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Kept summary
          </h3>
          <ul className="space-y-2">
            {week.summaries.map((s) => (
              <li key={s.id}>
                <NoteCard note={s} {...cards(s)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {week.notes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-sub">
          No notes in this week. Write one under New note, or look at another week.
        </p>
      ) : (
        <>
          <h3 className="sr-only">Notes in this week</h3>
          <ul className="space-y-2" aria-label={`Notes in the week of ${formatDay(weekStart)}`}>
            {week.notes.map((n) => (
              <li key={n.id}>
                <NoteCard note={n} {...cards(n)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
