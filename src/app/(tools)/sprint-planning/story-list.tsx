"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { SourceLink } from "@/components/handoff/source-link";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import type { Story } from "@/lib/stores/workspace-types";
import { storyPoints } from "@/lib/sprints/plan";
import { checkStoryPoints, isReady } from "./view";

const STATUS_LABEL: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

/**
 * A story's points, edited in a draft and saved on blur or Enter. A value
 * that can't be saved stays in the field with the reason under the row
 * (`error`), instead of being reverted without a word; and a malformed
 * entry ("3e", "-"), which a number field reports as blank, no longer
 * clears the points.
 */
function PointsCell({
  story,
  onChange,
  errorId,
  error,
  onError,
}: {
  story: Story;
  onChange: (points?: number) => void;
  errorId: string;
  error: string | undefined;
  onError: (error: string | undefined) => void;
}) {
  const shown = storyPoints(story) > 0 ? String(story.points) : "";
  const [draft, setDraft] = useState(shown);
  const badInput = useRef(false);
  // A new saved value replaces the draft and whatever was wrong with it.
  useEffect(() => {
    setDraft(shown);
    onError(undefined);
  }, [shown, onError]);
  const commit = () => {
    const checked = checkStoryPoints(draft, storyPoints(story), badInput.current);
    if (!checked.ok) {
      onError(checked.error);
      return;
    }
    onError(undefined);
    if (checked.points === undefined) {
      if (storyPoints(story) > 0) onChange(undefined);
      return;
    }
    if (checked.points !== story.points) onChange(checked.points);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      aria-label={`Points for ${story.title}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className="h-8 w-20 shrink-0 text-right"
      value={draft}
      placeholder="—"
      onChange={(e) => {
        setDraft(e.target.value);
        badInput.current = e.currentTarget.validity?.badInput === true;
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * Where the story stands against the Definition of Ready. "Not refined"
 * links to Refinement, where the team checks it.
 */
function ReadinessBadge({ story }: { story: Story }) {
  if (isReady(story)) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-success/40 bg-success/10 px-1.5 text-xs text-text">
        <Check className="h-3 w-3 text-success" aria-hidden="true" />
        Ready
      </span>
    );
  }
  return (
    <Link
      href="/refinement"
      className="inline-flex items-center rounded border border-border px-1.5 text-xs text-sub underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Not refined<span className="sr-only">: refine “{story.title}”</span>
    </Link>
  );
}

/** One story: tick in or out of the sprint, its title (edit in place), what it is, its points. */
function StoryRow({
  story,
  checked,
  onToggle,
  onPoints,
  onRename,
  showStatus,
  showPriority,
  cantAdd,
}: {
  story: Story;
  checked: boolean;
  onToggle: (story: Story) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  onRename: (story: Story, title: string) => void;
  showStatus?: boolean;
  showPriority?: boolean;
  /** Why the box can't tick the story into the sprint (a closed sprint), if it can't. */
  cantAdd?: string;
}) {
  const edit = useInlineEdit();
  const errorId = useId();
  const [pointsError, setPointsError] = useState<string | undefined>();
  // A done story stays in its sprint: moving it out would hide finished
  // work (it isn't backlog any more), so its box can't be unticked.
  const done = checked && story.status === "done";
  const blocked = !checked && cantAdd !== undefined;
  const locked = done || blocked;
  const meta: string[] = [];
  if (showStatus) meta.push(STATUS_LABEL[story.status] ?? story.status);
  if (story.owner?.trim()) meta.push(story.owner.trim());
  if (showPriority) {
    meta.push(
      typeof story.priorityScore === "number" ? `Priority ${story.priorityScore}` : "Not scored"
    );
  }

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)] disabled:opacity-60"
          checked={checked}
          disabled={locked}
          title={done ? "Done: stays in the sprint" : blocked ? cantAdd : undefined}
          aria-label={
            done
              ? `Done, stays in the sprint: ${story.title}`
              : `${checked ? "Remove from sprint" : "Add to sprint"}: ${story.title}`
          }
          onChange={() => onToggle(story)}
        />
        <div className="min-w-0 flex-1">
          {edit.editing ? (
            <InlineItemEditor
              label={`Edit ${story.title}`}
              title={story.title}
              titleLabel="Story title"
              titleMaxLength={200}
              onDone={(next, opts) => {
                if (next) onRename(story, next.title);
                edit.stop(opts);
              }}
            />
          ) : (
            <div className="flex items-start gap-1">
              <span className="min-w-0 break-words pt-0.5 text-sm text-text">{story.title}</span>
              <IconButton
                ref={edit.triggerRef}
                label={`Edit ${story.title}`}
                icon={<Pencil className="h-3.5 w-3.5" />}
                className="h-7 w-7 shrink-0 text-sub hover:text-text"
                onClick={edit.start}
              />
            </div>
          )}
          {(meta.length > 0 || story.status !== "done" || story.sourceRef) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-sub">
              {meta.flatMap((part, i) => [
                ...(i > 0
                  ? [
                      <span key={`sep-${i}`} aria-hidden="true">
                        ·
                      </span>,
                    ]
                  : []),
                <span key={`part-${i}`}>{part}</span>,
              ])}
              {story.status !== "done" && <ReadinessBadge story={story} />}
              {/* Where it came from: a job, a story-map card, a review note… */}
              <SourceLink sourceRef={story.sourceRef} />
            </p>
          )}
        </div>
        <PointsCell
          story={story}
          onChange={(points) => onPoints(story, points)}
          errorId={errorId}
          error={pointsError}
          onError={setPointsError}
        />
      </div>
      {pointsError && (
        <p id={errorId} role="alert" className="mt-1 text-right text-xs text-danger">
          {pointsError}
        </p>
      )}
    </li>
  );
}

/** A list of stories with the same tick action (all in the sprint, or all out of it). */
export function StoryList({
  stories,
  checked,
  onToggle,
  onPoints,
  onRename,
  showStatus,
  showPriority,
  label,
  listKey,
  cantAdd,
}: {
  stories: readonly Story[];
  checked: boolean;
  /** `index` is the story's place in this list, for where focus goes after it moves. */
  onToggle: (story: Story, index: number) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  onRename: (story: Story, title: string) => void;
  showStatus?: boolean;
  showPriority?: boolean;
  /** The list's accessible name. */
  label: string;
  /** Names the list for `focusAfterMove`. */
  listKey: string;
  /** Why unticked stories can't be ticked into the sprint (it is closed), if they can't. */
  cantAdd?: string;
}) {
  return (
    <ul
      aria-label={label}
      data-story-list={listKey}
      className="divide-y divide-border rounded-lg border border-border"
    >
      {stories.map((story, index) => (
        <StoryRow
          key={story.id}
          story={story}
          checked={checked}
          onToggle={(s) => onToggle(s, index)}
          onPoints={onPoints}
          onRename={onRename}
          showStatus={showStatus}
          showPriority={showPriority}
          cantAdd={cantAdd}
        />
      ))}
    </ul>
  );
}

/** Where focus goes once a story has moved: a list's place, else a heading's id. */
export interface FocusTarget {
  listKey?: string;
  index?: number;
  /** The id of an element that stays (a section's heading, with tabIndex -1). */
  fallbackId: string;
}

/**
 * Put focus back after a move. Ticking a story moves its row to another
 * list, so the focused box unmounts and focus fell to the page body;
 * keyboard and screen-reader users lost their place after every tick. The
 * story now in `index`'s place in the same list takes focus (the last one
 * when the list got shorter), else the fallback heading when the list is
 * gone.
 */
export function focusAfterMove(root: HTMLElement | null, target: FocusTarget): void {
  if (!root) return;
  const list = target.listKey ? root.querySelector(`[data-story-list="${target.listKey}"]`) : null;
  const boxes = list
    ? Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)'))
    : [];
  const box = boxes[Math.min(target.index ?? 0, boxes.length - 1)];
  const next = box ?? root.ownerDocument.getElementById(target.fallbackId);
  next?.focus();
}
