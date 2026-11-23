"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Bug, CalendarPlus, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import {
  TEST_NOTE_KINDS,
  TEST_SESSION_COVERAGE,
  TOOL_TEXT_MAX,
  type BugReport,
  type TestNoteKind,
  type TestSession,
  type TestSessionCoverage,
  type TestSessionNote,
} from "@/lib/stores/workspace-types";
import {
  COVERAGE_LABEL,
  NOTE_KIND_LABEL,
  NOTE_KIND_PLURAL,
  bugLinkOf,
  canAddNote,
  charterSentence,
  minutesInText,
  minutesRan,
  noteCounts,
  noteToBug,
  notesOfKind,
  validateSplit,
  type SessionSplit,
} from "@/lib/test-sessions/model";
import type { Validation } from "@/lib/utils/form";
import { isExampleId } from "@/lib/utils/example-id";
import { lengthText } from "./plan-form";
import { SessionClock } from "./session-clock";

/** What the page does to a session. */
export interface SessionActions {
  start: (s: TestSession) => void;
  restart: (s: TestSession) => void;
  end: (s: TestSession) => void;
  addNote: (s: TestSession, kind: TestNoteKind, text: string) => void;
  debrief: (s: TestSession, values: DebriefValues) => void;
  remove: (s: TestSession) => void;
  followUp: (s: TestSession, note: TestSessionNote) => void;
  sendAll: (s: TestSession, notes: TestSessionNote[]) => void;
  /** A note's links changed through "Send to…" (the send, or its Undo). */
  noteLinks: (
    s: TestSession,
    note: TestSessionNote,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  freshLinks: (s: TestSession, note: TestSessionNote) => readonly HandoffLink[] | undefined;
}

export const EXAMPLE_NOT_SENT = "Example notes aren't sent: clear the example and run your own.";

const KIND_OPTIONS: ToggleOption<TestNoteKind>[] = TEST_NOTE_KINDS.map((k) => ({
  value: k,
  label: NOTE_KIND_LABEL[k],
}));

const COVERAGE_OPTIONS: ToggleOption<TestSessionCoverage>[] = TEST_SESSION_COVERAGE.map((c) => ({
  value: c,
  label: COVERAGE_LABEL[c],
}));

/* ── Quick-capture notes ─────────────────────────────────────────────── */

interface NoteDraft {
  kind: TestNoteKind;
  text: string;
}

function validateNote(d: NoteDraft): Validation<NoteDraft, "text"> {
  const text = d.text.trim();
  if (text === "") return { ok: false, errors: { text: "Write the note in a line." } };
  if (text.length > TOOL_TEXT_MAX.capture) {
    return { ok: false, errors: { text: `Keep it to ${TOOL_TEXT_MAX.capture} characters.` } };
  }
  return { ok: true, values: { kind: d.kind, text } };
}

/** A note in one line: pick its kind, type, Enter adds it, stamped with its minutes in. */
function NoteCapture({
  session,
  onAdd,
}: {
  session: TestSession;
  onAdd: SessionActions["addNote"];
}) {
  const [kind, setKind] = useState<TestNoteKind>("note");
  const form = useItemForm<NoteDraft, NoteDraft, "text">({
    initial: () => ({ kind, text: "" }),
    validate: validateNote,
    onSave: (v) => onAdd(session, v.kind, v.text),
  });
  const full = !canAddNote(session);
  return (
    <ItemForm
      form={form}
      submitLabel="Add note"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <ToggleGroup
        label="Kind of note"
        size="sm"
        options={KIND_OPTIONS}
        value={form.draft.kind}
        onValueChange={(k) => {
          setKind(k);
          form.update({ kind: k });
        }}
      />
      <Field
        label={`${NOTE_KIND_LABEL[form.draft.kind]} to note`}
        error={form.errors.text}
        hint={full ? "This session holds as many notes as it can." : "One line. Enter adds it."}
      >
        {(props) => (
          <Input
            {...props}
            value={form.draft.text}
            maxLength={TOOL_TEXT_MAX.capture}
            enterKeyHint="done"
            autoComplete="off"
            disabled={full}
            onChange={(e) => form.update({ text: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/* ── The debrief ─────────────────────────────────────────────────────── */

export interface DebriefValues {
  coverage: TestSessionCoverage;
  split: SessionSplit | null;
  debrief: string;
}

interface DebriefDraft {
  coverage: TestSessionCoverage | "";
  testing: string;
  bugs: string;
  setup: string;
  debrief: string;
}

type DebriefField = keyof DebriefDraft | "total";

/** How much was covered (required), where the time went (three percents adding up to 100, or none), what was learned. */
export function validateDebrief(d: DebriefDraft): Validation<DebriefValues, DebriefField> {
  const errors: Partial<Record<DebriefField, string>> = {};
  if (!d.coverage) errors.coverage = "Say how much of the charter you covered.";
  const split = validateSplit({ testing: d.testing, bugs: d.bugs, setup: d.setup });
  if (!split.ok) Object.assign(errors, split.errors);
  const debrief = d.debrief.trim();
  if (debrief.length > TOOL_TEXT_MAX.text)
    errors.debrief = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  if (Object.keys(errors).length > 0 || !d.coverage || !split.ok) return { ok: false, errors };
  return { ok: true, values: { coverage: d.coverage, split: split.values, debrief } };
}

const debriefDraftOf = (s: TestSession): DebriefDraft => ({
  coverage: s.coverage ?? "",
  testing: s.split ? String(s.split.testing) : "",
  bugs: s.split ? String(s.split.bugs) : "",
  setup: s.split ? String(s.split.setup) : "",
  debrief: s.debrief ?? "",
});

function DebriefForm({
  session,
  onSave,
  onCancel,
}: {
  session: TestSession;
  onSave: (v: DebriefValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<DebriefDraft, DebriefValues, DebriefField>({
    initial: () => debriefDraftOf(session),
    validate: validateDebrief,
    onSave,
    resetOnSave: false,
  });
  const { draft, update, errors } = form;
  const pct = (key: "testing" | "bugs" | "setup", label: string) => (
    <Field label={label} error={errors[key]}>
      {(props) => (
        <Input
          {...props}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={draft[key]}
          onChange={(e) => update({ [key]: e.target.value } as Partial<DebriefDraft>)}
        />
      )}
    </Field>
  );
  return (
    <ItemForm form={form} submitLabel="Save debrief" onCancel={onCancel}>
      <div className="space-y-1" data-scale-invalid={errors.coverage ? "true" : undefined}>
        <p className="text-sm text-text" id={`cover-${session.id}`}>
          How much of the charter did you cover?
        </p>
        <ToggleGroup
          label="How much of the charter you covered"
          size="sm"
          options={COVERAGE_OPTIONS}
          value={draft.coverage || null}
          onValueChange={(coverage) => update({ coverage })}
          aria-describedby={errors.coverage ? `cover-error-${session.id}` : undefined}
        />
        {errors.coverage && (
          <p id={`cover-error-${session.id}`} className="text-xs text-danger" role="alert">
            {errors.coverage}
          </p>
        )}
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm text-text">Where the time went, in percent</legend>
        <div className="grid grid-cols-3 gap-2">
          {pct("testing", "Testing")}
          {pct("bugs", "Bugs")}
          {pct("setup", "Setup")}
        </div>
        {errors.total && (
          <p className="text-xs text-danger" role="alert">
            {errors.total}
          </p>
        )}
      </fieldset>
      <Field label="What you learned, and what's next" error={errors.debrief}>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={draft.debrief}
            maxLength={TOOL_TEXT_MAX.text}
            onChange={(e) => update({ debrief: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/* ── One session ─────────────────────────────────────────────────────── */

/** "12 min in · Bug" before a note's text. */
function NoteLine({ note, session }: { note: TestSessionNote; session: TestSession }) {
  const when = minutesInText(note, session);
  return (
    <span className="break-words text-sm text-text">
      <span className="text-xs text-sub">
        {NOTE_KIND_LABEL[note.kind]}
        {when ? ` · ${when}` : ""}
        {": "}
      </span>
      {note.text}
    </span>
  );
}

export function SessionCard({
  session,
  storyTitle,
  bugs,
  actions,
  startProblem,
  highlighted,
  headingRef,
}: {
  session: TestSession;
  storyTitle?: string;
  bugs: readonly BugReport[];
  actions: SessionActions;
  /** Why Start can't go (another session is running, the dock is busy), shown inline. */
  startProblem?: string | null;
  highlighted?: boolean;
  headingRef?: (el: HTMLHeadingElement | null) => void;
}) {
  const [editingDebrief, setEditingDebrief] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const example = isExampleId(session.id);
  const counts = noteCounts(session);
  const ran = minutesRan(session);
  const bugIds = new Set(bugs.map((b) => b.id));
  const bugNotes = notesOfKind(session, "bug").filter((n) => n.text.trim() !== "");
  const unsent = bugNotes.filter((n) => {
    const link = bugLinkOf(n);
    return !link || !bugIds.has(link.targetId);
  });
  const followUps = session.notes.filter((n) => n.kind === "question" || n.kind === "idea");
  const countText = TEST_NOTE_KINDS.filter((k) => counts[k] > 0)
    .map(
      (k) =>
        `${counts[k]} ${counts[k] === 1 ? NOTE_KIND_LABEL[k].toLowerCase() : NOTE_KIND_PLURAL[k]}`
    )
    .join(", ");

  return (
    <article
      aria-labelledby={`session-${session.id}`}
      data-session={session.id}
      className={
        highlighted
          ? "space-y-3 rounded-lg border border-accent bg-card p-4"
          : "space-y-3 rounded-lg border border-border bg-card p-4"
      }
    >
      <div className="space-y-1">
        <h3
          id={`session-${session.id}`}
          ref={(el) => {
            heading.current = el;
            headingRef?.(el);
          }}
          tabIndex={-1}
          className="break-words text-sm font-semibold text-text focus:outline-none"
        >
          {charterSentence(session.charter)}
        </h3>
        <p className="text-xs text-sub">
          {lengthText(session.minutes)}
          {ran !== null && ` · ran ${ran} min`}
          {session.tester && ` · ${session.tester}`}
          {session.area && ` · ${session.area}`}
          {countText && ` · ${countText}`}
        </p>
        {storyTitle && (
          <p className="text-xs text-sub">
            Story:{" "}
            <Link href="/sprint" className="text-accent hover:underline">
              {storyTitle}
            </Link>
          </p>
        )}
      </div>

      {session.status === "planned" && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1"
              disabled={example}
              onClick={() => actions.start(session)}
            >
              <Play aria-hidden="true" />
              Start
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={() => actions.remove(session)}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
          {example && (
            <p className="text-xs text-sub">Example sessions don&apos;t start the timer.</p>
          )}
          {startProblem && (
            <p className="text-sm text-sub" role="status">
              {startProblem}
            </p>
          )}
        </div>
      )}

      {session.status === "running" && (
        <div className="space-y-3">
          <SessionClock
            session={session}
            example={example}
            busyText={startProblem}
            onRestart={() => actions.restart(session)}
            onEnd={() => actions.end(session)}
          />
          <NoteCapture session={session} onAdd={actions.addNote} />
        </div>
      )}

      {session.notes.length > 0 && (
        <ul className="space-y-1" aria-label="Notes, in the order taken">
          {session.notes.map((n) => (
            <li key={n.id} data-note={n.id}>
              <NoteLine note={n} session={session} />
            </li>
          ))}
        </ul>
      )}

      {session.status === "done" && (
        <div className="space-y-3 border-t border-border pt-3">
          {session.coverage && !editingDebrief ? (
            <div className="space-y-1 text-sm">
              <p className="text-text">
                Covered: {COVERAGE_LABEL[session.coverage]}
                {session.split &&
                  ` · testing ${session.split.testing}%, bugs ${session.split.bugs}%, setup ${session.split.setup}%`}
              </p>
              {session.debrief && (
                <p className="whitespace-pre-line break-words text-sub">{session.debrief}</p>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => setEditingDebrief(true)}
              >
                <Pencil aria-hidden="true" />
                Edit debrief
              </Button>
            </div>
          ) : (
            <DebriefForm
              session={session}
              onSave={(v) => {
                actions.debrief(session, v);
                setEditingDebrief(false);
              }}
              onCancel={
                session.coverage
                  ? () => {
                      // Cancel goes with the form: focus the session's heading.
                      setEditingDebrief(false);
                      heading.current?.focus();
                    }
                  : undefined
              }
            />
          )}

          {bugNotes.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">Bugs found</p>
                {unsent.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={example}
                    onClick={() => actions.sendAll(session, unsent)}
                  >
                    <Bug aria-hidden="true" />
                    {unsent.length === 1
                      ? "Log the bug in Bug Triage"
                      : `Log all ${unsent.length} bugs`}
                  </Button>
                )}
              </div>
              <ul className="space-y-1">
                {bugNotes.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-48 break-words text-sm text-text">
                      {n.text}
                    </span>
                    <SendToMenu
                      routes={["bug"]}
                      item={noteToBug(n, session)}
                      sentTo={n.sentTo}
                      getLinks={() => actions.freshLinks(session, n)}
                      onLinksChange={(update) => actions.noteLinks(session, n, update)}
                      disabled={example}
                    />
                  </li>
                ))}
              </ul>
              {example && <p className="text-xs text-sub">{EXAMPLE_NOT_SENT}</p>}
            </div>
          )}

          {followUps.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-text">Questions and ideas</p>
              <ul className="space-y-1">
                {followUps.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 basis-48 break-words text-sm text-text">
                      {n.text}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      aria-label={`Plan a follow-up session: ${n.text}`}
                      onClick={() => actions.followUp(session, n)}
                    >
                      <CalendarPlus aria-hidden="true" />
                      Plan a follow-up session
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => actions.remove(session)}
          >
            <Trash2 aria-hidden="true" />
            Delete session
          </Button>
        </div>
      )}
    </article>
  );
}
