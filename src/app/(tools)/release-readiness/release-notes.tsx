"use client";

/**
 * "Stories and release notes" on a release card: the stories it ships
 * (linked by hand from the done ones since the previous ship, each
 * removable with Undo; the Definition of Done gate and DORA's lead time
 * read them), then its release notes: drafted by Amr or from the stories,
 * for customers or the team, shown as plain text and used only when the
 * person says so, then edited, saved (with Undo), copied or exported.
 * Linked stories not done yet are left out of a draft, and customers never
 * see ticket keys.
 */

import { useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Link2, Unlink } from "lucide-react";
import { AiButton } from "@/components/ai";
import { ExportButton } from "@/components/shared/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  fitReleaseNotesInput,
  releaseReadinessNotesTask,
  type ReleaseNotesInput,
} from "@/lib/ai/tasks/release-readiness.lite";
import type { AiSource } from "@/lib/ai/task-types";
import {
  AUDIENCE_LABEL,
  NOTES_TEXT_MAX,
  checkedDraft,
  draftText,
  linkedStoriesOf,
  localDay,
  newestDone,
  notesOutdatedFor,
  notesStoryOf,
  releaseNotesMarkdown,
  type NotesAudience,
} from "@/lib/releases/notes";
import { STORY_STATUS_LABEL } from "@/lib/roadmap/rollup";
import type { Release, Story } from "@/lib/stores/workspace-types";
import { dayLabel, nameOf } from "./text";

/** At most this many suggestions show at once (the newest done). */
const SUGGESTIONS_SHOWN = 30;

export interface ReleaseNotesPanelProps {
  release: Release;
  /** The stories it links, by id, in the order linked. */
  linkedIds: readonly string[];
  /** Every story a release can link (the example's own in the example). */
  stories: readonly Story[];
  /** The done stories it could link now. */
  suggestions: readonly Story[];
  today: string;
  /** The example is on screen: its notes stay in the example. */
  preview: boolean;
  epicTitle: (epicId: string | undefined) => string | undefined;
  /** Links them; says why when it can't (the release list would be too big to save). */
  onLink: (r: Release, storyIds: string[]) => string | null;
  onUnlink: (r: Release, story: Story) => void;
  onDrafted: (r: Release, audience: NotesAudience, source: AiSource) => void;
  /** Saves or clears them; says why when it can't (the release list would be too big to save). */
  onSave: (r: Release, notes: { audience: NotesAudience; text: string } | null) => string | null;
}

export function ReleaseNotesPanel(props: ReleaseNotesPanelProps) {
  const { release: r, linkedIds } = props;
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const name = nameOf(r);
  const hasNotes = Boolean(r.releaseNotes?.text.trim());
  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-1.5 text-left text-sm font-medium text-text"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        Stories and release notes
        <span className="text-xs font-normal text-sub">
          ({linkedIds.length} {linkedIds.length === 1 ? "story" : "stories"}
          {hasNotes ? ", notes saved" : ""})
        </span>
      </button>
      {open && (
        <section
          id={regionId}
          aria-label={`Stories and release notes for ${name}`}
          className="space-y-4 pt-2"
        >
          <LinkedStories {...props} />
          <NotesEditor key={`${r.id}:${r.releaseNotes?.updatedAt ?? ""}`} {...props} />
        </section>
      )}
    </div>
  );
}

function LinkedStories({
  release: r,
  linkedIds,
  stories,
  suggestions,
  onLink,
  onUnlink,
}: ReleaseNotesPanelProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const { done, notDone, missing } = linkedStoriesOf({ storyIds: [...linkedIds] }, stories);
  const shown = suggestions.slice(0, SUGGESTIONS_SHOWN);
  const linked = [...done, ...notDone];
  const name = nameOf(r);
  return (
    <div className="space-y-2">
      <p className="text-xs text-sub">
        The Definition of Done gate and DORA&apos;s lead time read the stories linked here.
      </p>
      {linked.length === 0 && missing.length === 0 ? (
        <p className="text-sm text-sub">No stories linked yet.</p>
      ) : (
        <ul className="space-y-1" aria-label={`Stories ${name} ships`}>
          {linked.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1 text-sm"
            >
              <span className="min-w-0 flex-1 break-words text-text">
                {s.title || "Untitled story"}
                {s.ticketKey && (
                  <span className="ml-1 font-data text-xs text-sub">{s.ticketKey}</span>
                )}
              </span>
              <Badge variant="outline" className="shrink-0 text-xs">
                {STORY_STATUS_LABEL[s.status] ?? s.status}
              </Badge>
              <IconButton
                label={`Unlink ${s.title || "the story"}`}
                icon={<Unlink className="h-4 w-4" />}
                className="shrink-0 text-sub hover:text-danger"
                onClick={() => onUnlink(r, s)}
              />
            </li>
          ))}
          {missing.length > 0 && (
            <li className="text-xs text-sub">
              {missing.length} linked {missing.length === 1 ? "story is" : "stories are"} no longer
              on the backlog.
            </li>
          )}
        </ul>
      )}
      {notDone.length > 0 && (
        <p className="text-xs text-sub">
          Not done yet, left out of the notes: {notDone.map((s) => s.title).join(", ")}.
        </p>
      )}
      {shown.length > 0 && (
        <fieldset className="space-y-1 rounded-md border border-border p-2">
          <legend className="px-1 text-xs font-medium text-sub">
            Add stories: done since the previous ship
          </legend>
          {shown.map((s) => (
            <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                checked={picked.includes(s.id)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))
                }
              />
              <span className="min-w-0 flex-1 break-words">
                {s.title || "Untitled story"}
                {s.doneAt && (
                  <span className="ml-1 text-xs text-sub">done {dayLabel(localDay(s.doneAt))}</span>
                )}
              </span>
            </label>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={picked.length === 0}
            onClick={() => {
              const why = onLink(r, picked);
              setRefused(why);
              if (!why) setPicked([]);
            }}
          >
            <Link2 aria-hidden="true" />
            Link {picked.length} {picked.length === 1 ? "story" : "stories"}
          </Button>
          {refused && (
            <p role="alert" className="text-xs text-danger">
              {refused}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}

function NotesEditor({
  release: r,
  linkedIds,
  stories,
  today,
  preview,
  epicTitle,
  onDrafted,
  onSave,
}: ReleaseNotesPanelProps) {
  const saved = r.releaseNotes;
  const [audience, setAudience] = useState<NotesAudience>(saved?.audience ?? "customers");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [text, setText] = useState(saved?.text ?? "");
  const [draft, setDraft] = useState<{ text: string; source: AiSource } | null>(null);
  // Why the last Save was refused, until the text changes.
  const [refused, setRefused] = useState<string | null>(null);
  // Where focus goes when the draft's box (and its buttons) goes.
  const askRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const name = nameOf(r);
  const { done } = linkedStoriesOf({ storyIds: [...linkedIds] }, stories);
  const outdated = notesOutdatedFor(r);
  const over = text.length > NOTES_TEXT_MAX;
  const changed =
    text.trim() !== (saved?.text ?? "").trim() || (saved && audience !== saved.audience);

  const input = (): ReleaseNotesInput =>
    fitReleaseNotesInput({
      release: name.slice(0, 200),
      date: (r.shippedDate ?? "").slice(0, 10) || today,
      audience,
      rolledBack: r.status === "rolled_back",
      stories: newestDone(done).map((s) =>
        notesStoryOf(s, { audience, includeNotes, epicTitle: epicTitle(s.epicId) })
      ),
    });

  const markdown = releaseNotesMarkdown({
    name,
    releaseNotes: text.trim() ? { audience, text, updatedAt: "" } : undefined,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup<NotesAudience>
          label="Written for"
          size="sm"
          value={audience}
          onValueChange={setAudience}
          options={[
            { value: "customers", label: AUDIENCE_LABEL.customers },
            { value: "team", label: AUDIENCE_LABEL.team },
          ]}
        />
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeNotes}
            onChange={(e) => setIncludeNotes(e.target.checked)}
          />
          Include story notes
        </label>
      </div>
      <div ref={askRef}>
        <AiButton
          task={releaseReadinessNotesTask}
          input={input}
          onResult={(data, meta) => {
            const checked = checkedDraft(data, input());
            setDraft({ text: draftText(checked), source: meta.source });
            onDrafted(r, audience, meta.source);
          }}
          label="Ask Amr to draft the notes"
          fallbackLabel="Draft from the stories"
          variant="outline"
          disabledReason={done.length === 0 ? "Link the done stories it ships first." : null}
        />
      </div>
      {draft && (
        <div
          role="region"
          aria-label={`Drafted notes for ${name}`}
          className="space-y-2 rounded-lg border border-border bg-surface p-3"
        >
          <p className="text-xs text-sub">
            {draft.source === "ai" ? "Drafted by Amr." : "Drafted from the stories, without AI."}{" "}
            Nothing is saved until you use it and save.
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-text">{draft.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setText(draft.text.slice(0, NOTES_TEXT_MAX));
                setDraft(null);
                setRefused(null);
                // On to the notes it filled, to read them through and save.
                window.setTimeout(() => notesRef.current?.focus(), 0);
              }}
            >
              Use this draft
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')?.focus();
                setDraft(null);
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {outdated && (
        <p className="text-xs text-warning">
          Written for the ship on {dayLabel(outdated, true)}: check them before the next one.
        </p>
      )}
      <Field
        label={`Release notes for ${name}`}
        hint={
          <span className={over ? "text-danger" : undefined}>
            {text.length.toLocaleString("en-GB")} of {NOTES_TEXT_MAX.toLocaleString("en-GB")}{" "}
            characters{preview ? ". In the example, they stay in the example." : ""}
          </span>
        }
        error={
          over
            ? `Keep the notes to ${NOTES_TEXT_MAX.toLocaleString("en-GB")} characters.`
            : (refused ?? undefined)
        }
      >
        {(p) => (
          <Textarea
            {...p}
            ref={notesRef}
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRefused(null);
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={over || !changed}
          onClick={() =>
            setRefused(onSave(r, text.trim() ? { audience, text: text.trim() } : null))
          }
        >
          {text.trim() || !saved ? "Save notes" : "Clear notes"}
        </Button>
        <CopyButton text={text} label="Copy notes" disabled={!text.trim()} />
        {text.trim() && (
          <ExportButton
            filename="release-notes"
            markdown={markdown}
            clipboardText={text}
            context={`Release notes for ${name}`}
          />
        )}
      </div>
    </div>
  );
}
