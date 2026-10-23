"use client";

import Link from "next/link";
import { Link2, Unlink } from "lucide-react";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { Epic, Story } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { STORY_STATUS_LABEL } from "./rollup";
import type { EpicView } from "./view";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

const pointsText = (s: Story) =>
  typeof s.points === "number" && Number.isFinite(s.points) ? `${s.points} pts` : "not estimated";

const short = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A story picked to link must still exist and not already be in this epic. */
export function validateLink(
  storyId: string,
  candidates: readonly Story[]
): Validation<{ storyId: string }, "storyId"> {
  if (!storyId) return { ok: false, errors: { storyId: "Pick a story to link." } };
  if (!candidates.some((s) => s.id === storyId))
    return { ok: false, errors: { storyId: "That story is no longer available. Pick another." } };
  return { ok: true, values: { storyId } };
}

/**
 * The stories behind an epic's progress: link backlog or sprint stories
 * (`Story.epicId`), unlink them, and see which still need an estimate.
 * An example epic shows its preview stories read-only.
 */
export function EpicStories({
  id,
  view,
  stories,
  epics,
  onLink,
  onUnlink,
}: {
  /** The panel's id, for the "Stories" button's aria-controls. */
  id?: string;
  view: EpicView;
  /** Every workspace story. */
  stories: readonly Story[];
  /** Every epic, to name the one a story would move from. */
  epics: readonly Epic[];
  onLink: (story: Story) => void;
  onUnlink: (story: Story) => void;
}) {
  const { epic, linked, rollup } = view;
  const example = isExampleId(epic.id);
  const epicTitle = new Map(epics.map((e) => [e.id, e.title]));
  // A story already in another epic can move here; its old epic is named.
  const candidates = example
    ? []
    : stories.filter((s) => s.epicId !== epic.id && !isExampleId(s.id));

  const form = useItemForm<{ storyId: string }, { storyId: string }, "storyId">({
    initial: { storyId: "" },
    validate: (d) => validateLink(d.storyId, candidates),
    onSave: ({ storyId }) => {
      const story = candidates.find((s) => s.id === storyId);
      if (story) onLink(story);
    },
  });

  return (
    <div id={id} className="space-y-3 rounded-md border border-border bg-bg p-3">
      {example && (
        <p className="text-xs text-sub">
          Example epic: these stories are a preview and aren’t in your backlog.
        </p>
      )}
      {linked.length === 0 ? (
        <p className="text-sm text-sub">
          No stories linked. Progress is typed until you link the stories that deliver this epic.
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label={`Stories in ${epic.title}`}>
          {linked.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="min-w-0 flex-1 basis-40 break-words text-sm text-text">
                {s.title}
              </span>
              <span className="text-xs text-sub">{STORY_STATUS_LABEL[s.status] ?? s.status}</span>
              <span className="w-24 text-right font-data text-xs text-sub">{pointsText(s)}</span>
              {!example && (
                <IconButton
                  label={`Unlink ${s.title}`}
                  icon={<Unlink className="h-4 w-4" />}
                  className="text-sub hover:text-danger"
                  onClick={() => onUnlink(s)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {rollup.unestimated > 0 && (
        <p className="text-xs text-sub">
          {rollup.unestimated === 1
            ? "1 story isn’t estimated, so progress counts stories, not points."
            : `${rollup.unestimated} stories aren’t estimated, so progress counts stories, not points.`}{" "}
          {!example && (
            <Link
              href="/planning-poker"
              className="text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Size them in Planning Poker
            </Link>
          )}
        </p>
      )}
      {!example &&
        (candidates.length === 0 ? (
          <p className="text-xs text-sub">
            No other stories to link.{" "}
            <Link
              href="/sprint-planning"
              className="text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Add stories in Sprint Planning
            </Link>
          </p>
        ) : (
          <ItemForm
            form={form}
            submitLabel="Link story"
            submitIcon={<Link2 className="h-4 w-4" aria-hidden="true" />}
          >
            <Field label="Link a story" error={form.errors.storyId}>
              {(props) => (
                <select
                  {...props}
                  className={SELECT_CLASS}
                  value={form.draft.storyId}
                  onChange={(e) => form.update({ storyId: e.target.value })}
                >
                  <option value="">Pick a story</option>
                  {candidates.map((s) => {
                    const other = s.epicId ? epicTitle.get(s.epicId) : undefined;
                    return (
                      <option key={s.id} value={s.id}>
                        {[
                          short(s.title),
                          STORY_STATUS_LABEL[s.status] ?? s.status,
                          pointsText(s),
                          other ? `in “${short(other, 30)}”` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    );
                  })}
                </select>
              )}
            </Field>
          </ItemForm>
        ))}
    </div>
  );
}
