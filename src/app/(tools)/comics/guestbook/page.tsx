import type { Metadata } from "next";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Card, CardContent } from "@/components/ui/card";
import { COMMUNITY_URL, GUESTBOOK_ROUTE } from "@/lib/comics/guestbook";
import { listApprovedNotes } from "@/lib/comics/guestbook-store";
import { comicMetadata } from "../comic-metadata";
import { GuestbookForm } from "./guestbook-form";
import { guestbookArt } from "@/lib/ink/drawings/pages/guestbook";

/** Refreshed about every 10 minutes, and at once when a note is approved. */
export const revalidate = 600;

// Out of search: a guestbook is only worth spamming if it's indexed.
export const metadata: Metadata = comicMetadata({
  title: "Guestbook — Agile at Work",
  description: "Notes from readers of Agile at Work.",
  canonical: GUESTBOOK_ROUTE,
  index: false,
});

/**
 * /comics/guestbook: notes readers have left, once Amr has approved them, and
 * the form to leave one. Nothing anyone writes shows until it's approved.
 */
export default async function GuestbookPage() {
  const notes = await listApprovedNotes();
  return (
    <ToolPageWrapper
      art={guestbookArt}
      title="Guestbook"
      description="Notes from readers of Agile at Work"
    >
      <div className="max-w-2xl space-y-6">
        <section aria-labelledby="sign-heading" className="space-y-3">
          <h2 id="sign-heading" className="font-display text-lg font-semibold text-text">
            Leave a note
          </h2>
          <p className="text-sub">
            A story that rang true, or a question for Amr. Notes appear here once he has read them.
          </p>
          <GuestbookForm />
        </section>

        {COMMUNITY_URL ? (
          <p className="text-sub">
            Talk with other readers in the{" "}
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline"
            >
              WhatsApp community
            </a>
            .
          </p>
        ) : null}

        <section aria-labelledby="notes-heading" className="space-y-3">
          <h2 id="notes-heading" className="font-display text-lg font-semibold text-text">
            From readers
          </h2>
          {notes.length === 0 ? (
            <p className="text-sub">No notes yet.</p>
          ) : (
            <ul className="list-none space-y-3">
              {notes.map((note) => (
                <li key={note.id}>
                  <Card>
                    <CardContent className="space-y-1 p-4">
                      <p className="whitespace-pre-wrap break-words text-text">{note.message}</p>
                      <p className="text-sm font-medium text-sub">{note.name}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ToolPageWrapper>
  );
}
