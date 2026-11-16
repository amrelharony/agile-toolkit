"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, CircleMinus, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { SourceLink } from "@/components/handoff/source-link";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { StoryDetailsPanel, StoryTicket } from "@/components/stories/story-details";
import { cn } from "@/lib/utils";
import type { Story, StoryGwt } from "@/lib/stores/workspace-types";
import { isRankedStory, storyPoints } from "@/lib/sprints/plan";
import {
  hasStoryDetails,
  hasStoryGwt,
  storyLink,
  type GwtWrite,
  type StoryDetails,
} from "@/lib/stories/fields";
import type { StoryRemoval } from "@/lib/stories/removal";
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
  className,
}: {
  story: Story;
  onChange: (points?: number) => void;
  errorId: string;
  error: string | undefined;
  onError: (error: string | undefined) => void;
  /** Where the row places it (its grid cell on a phone). */
  className?: string;
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
  // Height comes from Input (44 px on phones, 36 px from md up), and stays
  // 44 px on any touch screen: a landscape phone or a tablet is md-wide too
  // (md:pointer-coarse:, because a bare pointer-coarse: loses to Input's md:).
  // Narrower below sm, where it sits beside the meta line: it holds a few
  // digits, and the rest of the width goes to that line.
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      aria-label={`Points for ${story.title}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className={cn(
        "w-14 shrink-0 px-2 text-right sm:w-20 sm:px-3 md:pointer-coarse:h-11",
        className
      )}
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
 * links to Refinement, where the team checks it. The chip is an inner span
 * so that on a touch screen the link can be 44 px tall (a target a finger
 * can hit) while the chip keeps its size; with a mouse the link is the chip.
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
      className="group inline-flex items-center rounded text-xs text-sub underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none pointer-coarse:min-h-11"
    >
      <span className="inline-flex items-center rounded border border-border px-1.5 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        Not refined<span className="sr-only">: refine “{story.title}”</span>
      </span>
    </Link>
  );
}

/**
 * The row's small buttons after the pencil (delete, remove from the sprint):
 * 28 px as drawn, 44 px to a finger at any width. On a touch screen each
 * stands 8 px clear of the pencil's slot (the row's 4 px gap and this 4 px
 * margin), which is how far the pencil's own 44 px reaches, so the two
 * targets meet and never overlap.
 */
const ROW_ACTION =
  "h-7 w-7 shrink-0 pointer-coarse:-mr-2 pointer-coarse:-mt-2 pointer-coarse:ml-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 md:pointer-coarse:min-h-11 md:pointer-coarse:min-w-11";

/**
 * One story: tick in or out of the sprint, its title (edit in place), what
 * it is, its points; its acceptance criteria, notes, ticket key and link
 * behind "Details"; and the bin (a story in the backlog or in a sprint that
 * hasn't started) or "remove from the sprint" (a running sprint). A story
 * with neither because a started sprint still counts it says so (`keptNote`).
 */
function StoryRow({
  story,
  checked,
  onToggle,
  onPoints,
  onRename,
  onDetails,
  onGwt,
  onDelete,
  removal = "locked",
  keptNote,
  showStatus,
  showPriority,
  cantAdd,
}: {
  story: Story;
  checked: boolean;
  onToggle: (story: Story) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  onRename: (story: Story, title: string) => void;
  /** Save the story's acceptance criteria, notes, ticket key and link. Absent: no Details. */
  onDetails?: (story: Story, details: StoryDetails) => void;
  /** Save the story's Given/When/Then scenarios. Absent: they show read only. */
  onGwt?: (story: Story, gwt: StoryGwt[], write?: GwtWrite) => void;
  onDelete?: (story: Story) => void;
  /** What the row's remove control may do (lib/stories/removal.ts). */
  removal?: StoryRemoval;
  /** Why the row has no bin, for a story a started sprint still counts ("Was in Sprint 5…"). */
  keptNote?: string;
  showStatus?: boolean;
  showPriority?: boolean;
  /** Why the box can't tick the story into the sprint (a closed sprint), if it can't. */
  cantAdd?: string;
}) {
  const edit = useInlineEdit();
  const errorId = useId();
  const detailsId = useId();
  const [pointsError, setPointsError] = useState<string | undefined>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsToggle = useRef<HTMLButtonElement>(null);
  // Given/When/Then scenarios count as details: the panel shows them beside the free text.
  const hasDetails = hasStoryDetails(story) || hasStoryGwt(story);
  // A done story's details can be read, but none are started on one that has none.
  const showDetails = onDetails !== undefined && (story.status !== "done" || hasDetails);
  const hasTicket = Boolean(story.ticketKey?.trim() || storyLink(story.link));
  // A done story stays in its sprint: moving it out would hide finished
  // work (it isn't backlog any more), so its box can't be unticked.
  const done = checked && story.status === "done";
  const blocked = !checked && cantAdd !== undefined;
  const locked = done || blocked;
  const meta: string[] = [];
  if (showStatus) meta.push(STATUS_LABEL[story.status] ?? story.status);
  if (story.owner?.trim()) meta.push(story.owner.trim());
  if (showPriority) {
    // The backlog's decided order (the Prioritizer's Decide order) comes
    // first, so a row's place reads right even when its score is lower.
    if (isRankedStory(story)) meta.push(`Rank ${story.backlogRank}`);
    meta.push(
      typeof story.priorityScore === "number" ? `Priority ${story.priorityScore}` : "Not scored"
    );
  }
  // No bin on this row, and nothing else here would say why.
  if (keptNote) meta.push(keptNote);
  const hasMeta =
    meta.length > 0 ||
    story.status !== "done" ||
    Boolean(story.sourceRef) ||
    hasTicket ||
    showDetails;
  // On a phone (below sm) the row is a grid: the points field leaves the
  // title's line for the meta line under it, so the title gets the row's
  // width and a long one wraps to about 3 lines at 360 px, not 5. The middle
  // column's wrapper drops out of the layout there (contents) so the title
  // and the meta line take their own cells. From sm up it is the flex row
  // it always was, and these cell placements do nothing.
  const titleCell = cn("max-sm:col-start-2 max-sm:row-start-1", hasMeta && "max-sm:col-end-4");

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-3 max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)_auto] max-sm:gap-y-1">
        {/* The box is the step's main action, so on a touch screen its label
            pads it out to a 44 px target. The negative margins give most of
            that back: the padding reaches into the row's own edge and the
            whole gap. Its last 4 px stay its own, so the padding ends where
            the title starts; the title paints after it and would take a tap
            on any strip the two shared. */}
        <label className="flex shrink-0 pointer-coarse:-my-3 pointer-coarse:-ml-3 pointer-coarse:-mr-3 pointer-coarse:py-3 pointer-coarse:pl-3 pointer-coarse:pr-4">
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
        </label>
        <div className="min-w-0 flex-1 max-sm:contents">
          {edit.editing ? (
            <InlineItemEditor
              label={`Edit ${story.title}`}
              title={story.title}
              titleLabel="Story title"
              titleMaxLength={200}
              className={titleCell}
              onDone={(next, opts) => {
                if (next) onRename(story, next.title);
                edit.stop(opts);
              }}
            />
          ) : (
            <div className={cn("flex items-start gap-1", titleCell)}>
              <span className="min-w-0 break-words pt-0.5 text-sm text-text">{story.title}</span>
              {/* 44 px to a finger at any width (md:pointer-coarse: outranks
                  the button's md: sizes), but laid out as the 28 px button it
                  looks like: the margins keep the pencil where it sits beside
                  the title and leave the title its width on a phone. */}
              <IconButton
                ref={edit.triggerRef}
                label={`Edit ${story.title}`}
                icon={<Pencil className="h-3.5 w-3.5" />}
                className="h-7 w-7 shrink-0 text-sub hover:text-text pointer-coarse:-mx-2 pointer-coarse:-mt-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 md:pointer-coarse:min-h-11 md:pointer-coarse:min-w-11"
                onClick={edit.start}
              />
              {removal === "delete" && onDelete && (
                <IconButton
                  label={`Delete ${story.title}`}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  variant="danger-ghost"
                  className={ROW_ACTION}
                  onClick={() => onDelete(story)}
                />
              )}
              {/* In a running sprint a story can only leave it: deleting it
                  would erase it from the days it was in scope. The box does
                  the same; this stands where the bin would. */}
              {removal === "remove-from-sprint" && checked && (
                <IconButton
                  label={`Remove ${story.title} from the sprint`}
                  icon={<CircleMinus className="h-3.5 w-3.5" />}
                  className={cn(ROW_ACTION, "text-sub hover:text-text")}
                  onClick={() => onToggle(story)}
                />
              )}
            </div>
          )}
          {hasMeta && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-sub max-sm:col-start-2 max-sm:row-start-2 max-sm:self-center">
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
              {/* Its issue in the team's tracker, opened in a new tab. */}
              <StoryTicket story={story} />
              {showDetails && (
                <button
                  ref={detailsToggle}
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls={detailsOpen ? detailsId : undefined}
                  onClick={() => setDetailsOpen((open) => !open)}
                  className="group inline-flex items-center rounded text-xs text-sub hover:text-accent focus-visible:outline-none pointer-coarse:min-h-11"
                >
                  <span className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 group-focus-visible:ring-2 group-focus-visible:ring-accent">
                    {hasDetails ? "Details" : "Add details"}
                    <span className="sr-only">: {story.title}</span>
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              )}
            </p>
          )}
        </div>
        <PointsCell
          story={story}
          onChange={(points) => onPoints(story, points)}
          errorId={errorId}
          error={pointsError}
          onError={setPointsError}
          className={
            hasMeta
              ? "max-sm:col-start-3 max-sm:row-start-2"
              : "max-sm:col-start-3 max-sm:row-start-1"
          }
        />
      </div>
      {pointsError && (
        <p id={errorId} role="alert" className="mt-1 text-right text-xs text-danger">
          {pointsError}
        </p>
      )}
      {detailsOpen && onDetails && (
        <StoryDetailsPanel
          id={detailsId}
          story={story}
          // Nothing to read yet: open straight on the form.
          startEditing={!hasDetails}
          onSave={(details) => onDetails(story, details)}
          onSaveGwt={onGwt ? (gwt, write) => onGwt(story, gwt, write) : undefined}
          onEmpty={() => {
            setDetailsOpen(false);
            detailsToggle.current?.focus();
          }}
          className="mt-2 rounded-lg border border-border bg-surface/40 p-3 sm:ml-7"
        />
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
  onDetails,
  onGwt,
  onDelete,
  removalOf,
  keptNoteOf,
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
  /** Save a story's acceptance criteria, notes, ticket key and link. */
  onDetails?: (story: Story, details: StoryDetails) => void;
  /** Save a story's Given/When/Then scenarios. */
  onGwt?: (story: Story, gwt: StoryGwt[], write?: GwtWrite) => void;
  /** Delete a story (its row shows the bin only where `removalOf` allows it). */
  onDelete?: (story: Story, index: number) => void;
  /** What each row's remove control may do; absent: no row has one. */
  removalOf?: (story: Story) => StoryRemoval;
  /** Why a story a started sprint still counts has no bin; undefined for any other story. */
  keptNoteOf?: (story: Story) => string | undefined;
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
          onDetails={onDetails}
          onGwt={onGwt}
          onDelete={onDelete ? (s) => onDelete(s, index) : undefined}
          removal={removalOf?.(story)}
          keptNote={keptNoteOf?.(story)}
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
