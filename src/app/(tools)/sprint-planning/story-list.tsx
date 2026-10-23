"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import type { Story } from "@/lib/stores/workspace-types";
import { storyPoints } from "@/lib/sprints/plan";
import { isReady } from "./view";

const STATUS_LABEL: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

/** A story's points, edited in a draft and saved on blur or Enter. */
function PointsCell({ story, onChange }: { story: Story; onChange: (points?: number) => void }) {
  const shown = storyPoints(story) > 0 ? String(story.points) : "";
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      if (storyPoints(story) > 0) onChange(undefined);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(shown);
      return;
    }
    if (n !== story.points) onChange(n);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      aria-label={`Points for ${story.title}`}
      className="h-8 w-20 shrink-0 text-right"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
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
}: {
  story: Story;
  checked: boolean;
  onToggle: (story: Story) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  onRename: (story: Story, title: string) => void;
  showStatus?: boolean;
  showPriority?: boolean;
}) {
  const edit = useInlineEdit();
  // A done story stays in its sprint: moving it out would hide finished
  // work (it isn't backlog any more), so its box can't be unticked.
  const locked = checked && story.status === "done";
  const meta: string[] = [];
  if (showStatus) meta.push(STATUS_LABEL[story.status] ?? story.status);
  if (story.owner?.trim()) meta.push(story.owner.trim());
  if (showPriority) {
    meta.push(
      typeof story.priorityScore === "number" ? `Priority ${story.priorityScore}` : "Not scored"
    );
  }

  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)] disabled:opacity-60"
        checked={checked}
        disabled={locked}
        title={locked ? "Done: stays in the sprint" : undefined}
        aria-label={
          locked
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
        {(meta.length > 0 || story.status !== "done") && (
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
          </p>
        )}
      </div>
      <PointsCell story={story} onChange={(points) => onPoints(story, points)} />
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
}: {
  stories: readonly Story[];
  checked: boolean;
  onToggle: (story: Story) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  onRename: (story: Story, title: string) => void;
  showStatus?: boolean;
  showPriority?: boolean;
  /** The list's accessible name. */
  label: string;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border rounded-lg border border-border">
      {stories.map((story) => (
        <StoryRow
          key={story.id}
          story={story}
          checked={checked}
          onToggle={onToggle}
          onPoints={onPoints}
          onRename={onRename}
          showStatus={showStatus}
          showPriority={showPriority}
        />
      ))}
    </ul>
  );
}
