"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage, portalApi, type GuestbookNoteRow } from "./portal-api";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function NoteCard({ note, onChanged }: { note: GuestbookNoteRow; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <p className="whitespace-pre-wrap break-words text-text">{note.message}</p>
        <p className="text-sub">
          {note.name}, {when(note.created_at)}
          {note.approved_at ? `, shown since ${when(note.approved_at)}` : ""}
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={note.approved_at ? "outline" : "toolkit"}
            disabled={busy}
            onClick={() => run(() => portalApi.approveNote(note.id, !note.approved_at))}
          >
            {note.approved_at ? "Take it down" : "Show it"}
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete the note from ${note.name}? This can't be undone.`)) {
                return;
              }
              void run(() => portalApi.deleteNote(note.id));
            }}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Notes left at /comics/guestbook: none shows there until it's shown from here. */
export function GuestbookView({
  notes,
  loadError,
  onChanged,
}: {
  notes: GuestbookNoteRow[] | null;
  loadError: string | null;
  onChanged: () => Promise<void>;
}) {
  if (loadError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-danger">{loadError}</p>
        <p className="text-sub">
          If the guestbook has never loaded, migration 0033 may not have been applied yet.
        </p>
        <Button type="button" variant="outline" onClick={() => void onChanged()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!notes) return <p className="text-sm text-sub">Loading notes…</p>;

  const waiting = notes.filter((n) => !n.approved_at);
  const shown = notes.filter((n) => n.approved_at);
  return (
    <div className="space-y-4">
      {waiting.length === 0 ? <p className="text-sm text-sub">No notes waiting.</p> : null}
      {waiting.map((note) => (
        <NoteCard key={note.id} note={note} onChanged={onChanged} />
      ))}
      {shown.length > 0 ? (
        <details className="rounded-lg border border-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
            On the page ({shown.length})
          </summary>
          <div className="mt-2 space-y-2">
            {shown.map((note) => (
              <NoteCard key={note.id} note={note} onChanged={onChanged} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
