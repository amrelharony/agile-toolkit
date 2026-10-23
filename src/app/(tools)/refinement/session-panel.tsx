"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Dices, RotateCcw } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Story } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import {
  isUnsized,
  metCriteria,
  readinessState,
  validateReady,
  type ReadinessState,
  type ReadyDraft,
  type ReadyField,
} from "./session";
import type { Criterion } from "./store";

/* -------------------------------------------------------------------------- */
/*  Badges                                                                    */
/* -------------------------------------------------------------------------- */

const STATE: Record<ReadinessState, { label: string; className: string }> = {
  ready: {
    label: "Ready",
    className: "border-accent-green/20 bg-accent-green/10 text-accent-green",
  },
  partial: { label: "Partial", className: "border-warning/20 bg-warning/10 text-warning" },
  "not-ready": { label: "Not ready", className: "border-danger/20 bg-danger/10 text-danger" },
  unchecked: { label: "Not checked", className: "border-border bg-card text-sub" },
};

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  const s = STATE[state];
  return <Badge className={cn("border text-xs", s.className)}>{s.label}</Badge>;
}

/** "5 pts", or a flag when the story has no points. */
export function PointsBadge({ story }: { story: Story }) {
  if (isUnsized(story)) {
    return (
      <Badge className="border border-warning/30 bg-warning/10 text-xs text-warning">Unsized</Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {story.points} pts
    </Badge>
  );
}

/** "3/8" criteria met, or nothing when the story was never checked. */
function metLabel(story: Story, criteria: readonly Criterion[]): string | null {
  if (!story.readiness || criteria.length === 0) return null;
  return `${metCriteria(story.readiness.checked, criteria).length}/${criteria.length}`;
}

/* -------------------------------------------------------------------------- */
/*  The story being refined                                                   */
/* -------------------------------------------------------------------------- */

export interface StoryCheckPanelProps {
  story: Story;
  criteria: readonly Criterion[];
  /** Where it is in the list being walked; null when re-checking a ready story. */
  position: { index: number; count: number } | null;
  sprintName?: string;
  /** Waiting in the Planning Poker queue. */
  queued: boolean;
  /** An example story: its checks stay in the example, nothing is queued. */
  example: boolean;
  /** Move focus to the heading on mount (after the walk moved on). */
  autoFocus: boolean;
  onSaveChecks: (checked: string[]) => void;
  onMarkReady: (checked: string[]) => void;
  onQueue: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * One story at a time: tick the Definition of Ready, see whether it has
 * points, queue it for Planning Poker if not, then mark it ready. "Save
 * checks" records the ticks without the call, so a story that isn't ready
 * shows where it stands next time.
 */
export function StoryCheckPanel({
  story,
  criteria,
  position,
  sprintName,
  queued,
  example,
  autoFocus,
  onSaveChecks,
  onMarkReady,
  onQueue,
  onPrevious,
  onNext,
}: StoryCheckPanelProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const form = useItemForm<ReadyDraft, ReadyDraft, ReadyField>({
    initial: () => ({ checked: metCriteria(story.readiness?.checked, criteria) }),
    validate: (d) => validateReady(d, criteria, story),
    onSave: (v) => onMarkReady(v.checked),
    resetOnSave: false,
  });

  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
    // Only on mount: the panel is keyed by story, so a new story remounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ticked = new Set(form.draft.checked);
  const met = criteria.filter((c) => ticked.has(c.id)).length;
  const pct = criteria.length > 0 ? Math.round((met / criteria.length) * 100) : 0;
  const firstOpen = criteria.find((c) => !ticked.has(c.id))?.id;
  const unsized = isUnsized(story);
  const toggle = (id: string, on: boolean) =>
    form.update({
      checked: on
        ? metCriteria([...form.draft.checked, id], criteria)
        : form.draft.checked.filter((x) => x !== id),
    });

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-accent/30 bg-accent/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-sub">
            {position
              ? `Story ${position.index + 1} of ${position.count} to refine`
              : "Re-checking a ready story"}
          </p>
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="mt-0.5 break-words text-base font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {story.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PointsBadge story={story} />
            <ReadinessBadge state={readinessState(story, criteria)} />
            {sprintName && (
              <Badge variant="outline" className="text-xs">
                In {sprintName}
              </Badge>
            )}
          </div>
        </div>
        {position && position.count > 1 && (
          <span className="flex shrink-0 items-center">
            <IconButton
              label="Previous story"
              icon={<ChevronLeft className="h-4 w-4" />}
              disabled={position.index === 0}
              onClick={onPrevious}
            />
            <IconButton
              label="Next story"
              icon={<ChevronRight className="h-4 w-4" />}
              disabled={position.index >= position.count - 1}
              onClick={onNext}
            />
          </span>
        )}
      </div>

      <ItemForm
        form={form}
        submitLabel="Mark ready"
        submitIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={criteria.length === 0}
              onClick={() => onSaveChecks(metCriteria(form.draft.checked, criteria))}
            >
              Save checks
            </Button>
            {unsized && <QueueButton queued={queued} example={example} onQueue={onQueue} />}
          </>
        }
      >
        {criteria.length === 0 ? (
          <p className="text-sm text-sub">
            No criteria yet. Add your Definition of Ready to check stories against it.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-text">Definition of Ready</legend>
            <ul className="space-y-2">
              {criteria.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 hover:bg-card-hover">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      checked={ticked.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                      // The first unticked box takes focus after a refused "Mark ready".
                      aria-invalid={form.errors.criteria && c.id === firstOpen ? true : undefined}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm text-text">{c.label}</span>
                      {c.description && (
                        <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-sub">
                          {c.description}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {criteria.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-sub">
              <span>
                {met} of {criteria.length} criteria met
              </span>
              <span className="font-data font-semibold text-text">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-card" aria-hidden="true">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  pct === 100 ? "bg-accent-green" : pct > 0 ? "bg-warning" : "bg-danger"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {(form.errors.criteria || form.errors.points) && (
          <div className="space-y-1" role="alert">
            {form.errors.criteria && <p className="text-xs text-danger">{form.errors.criteria}</p>}
            {form.errors.points && <p className="text-xs text-danger">{form.errors.points}</p>}
          </div>
        )}
      </ItemForm>
    </section>
  );
}

function QueueButton({
  queued,
  example,
  onQueue,
}: {
  queued: boolean;
  example: boolean;
  onQueue: () => void;
}) {
  if (example) {
    return (
      <span className="text-xs text-sub">
        Example stories aren&rsquo;t sent to Planning Poker; your own unsized stories are.
      </span>
    );
  }
  if (queued) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-sm text-sub">
        <Check className="h-4 w-4 text-success" aria-hidden="true" />
        Queued for Poker
        <Link href="/planning-poker" className="text-accent underline-offset-2 hover:underline">
          Open Planning Poker
        </Link>
      </span>
    );
  }
  return (
    <Button type="button" variant="outline" className="gap-1.5" onClick={onQueue}>
      <Dices className="h-4 w-4" aria-hidden="true" />
      Queue for Poker
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/*  The lists                                                                 */
/* -------------------------------------------------------------------------- */

/** The stories still to refine; picking one puts it in the panel. */
export function StoryQueue({
  stories,
  criteria,
  focusId,
  queued,
  sprintNames,
  onSelect,
}: {
  stories: readonly Story[];
  criteria: readonly Criterion[];
  focusId: string | null;
  queued: ReadonlySet<string>;
  sprintNames: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
}) {
  return (
    <ol aria-label="Stories to refine" className="space-y-1.5">
      {stories.map((s) => {
        const current = s.id === focusId;
        const metText = metLabel(s, criteria);
        const sprint = s.sprintId ? sprintNames.get(s.sprintId) : undefined;
        return (
          <li key={s.id}>
            <button
              type="button"
              aria-current={current ? "true" : undefined}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex w-full min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                current
                  ? "border-accent/40 bg-accent/10"
                  : "border-border bg-card hover:bg-card-hover"
              )}
            >
              <span className="min-w-0 flex-1 basis-40 break-words text-sm text-text">
                {s.title}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <PointsBadge story={s} />
                {metText && (
                  <span className="font-mono text-xs text-sub">
                    <span className="sr-only">Criteria met: </span>
                    {metText}
                  </span>
                )}
                {queued.has(s.id) && (
                  <Badge variant="outline" className="text-xs">
                    Queued
                  </Badge>
                )}
                {sprint && <span className="text-xs text-sub">{sprint}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Ready stories; "Re-check" puts one back in the panel. */
export function ReadyList({
  stories,
  criteria,
  onRecheck,
}: {
  stories: readonly Story[];
  criteria: readonly Criterion[];
  onRecheck: (id: string) => void;
}) {
  return (
    <ul aria-label="Ready stories" className="divide-y divide-border">
      {stories.map((s) => {
        const metText = metLabel(s, criteria);
        const at = s.readiness ? new Date(s.readiness.updatedAt) : null;
        const when =
          at && !Number.isNaN(at.getTime())
            ? at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : null;
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="min-w-0 flex-1 basis-40 break-words text-sm text-text">{s.title}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-sub">
              <PointsBadge story={s} />
              {metText && <span className="font-mono">{metText}</span>}
              {when && <span>Checked {when}</span>}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1"
              aria-label={`Re-check ${s.title}`}
              onClick={() => onRecheck(s.id)}
            >
              <RotateCcw aria-hidden="true" />
              Re-check
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
