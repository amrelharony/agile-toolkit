"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import {
  listDraftKeys,
  readOpenStory,
  rememberOpenStory,
  NEW_STORY_KEY,
  type DraftKey,
} from "@/lib/comics/draft-store";
import type { OwnerStory } from "@/lib/comics/story-input";
import { EntriesView } from "./entries-view";
import { ExtrasEditor } from "./extras-editor";
import { GuessEditor } from "./guess-editor";
import { GuestbookView } from "./guestbook-view";
import { LicenceView } from "./licence-view";
import { errorMessage, portalApi, type GuestbookNoteRow, type LicenceRequest } from "./portal-api";
import { ReviewView, reviewQueue } from "./review-view";
import { StoriesView } from "./stories-view";
import { LEAVE_WHILE_UPLOADING, StoryEditor } from "./story-editor";

type View = "stories" | "editor" | "review" | "entries" | "licence" | "guestbook";

export const PORTAL_SIGN_IN_HREF = `/auth/sign-in?next=${encodeURIComponent("/settings/comics")}`;

export function OwnerOnlyNotice({ href = PORTAL_SIGN_IN_HREF }: { href?: string }) {
  return (
    <div className="max-w-3xl">
      <EmptyState
        icon={Lock}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Owner sign in</Link>
          </Button>
        }
      >
        <p className="font-medium text-text">Owner only</p>
        <p className="mt-1 text-sm">Sign in as the owner to manage the comics.</p>
      </EmptyState>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "toolkit" : "outline"}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function upsertStory(stories: OwnerStory[] | null, story: OwnerStory): OwnerStory[] | null {
  if (!stories) return stories;
  const others = stories.filter((s) => s.ep !== story.ep);
  return [...others, story].sort((a, b) => a.ep - b.ep);
}

/**
 * The owner's portal. Gates on `visitor`, never on `settled && !isOwner`: the
 * owner check can time out after 8 seconds on a weak signal, and that must not
 * unmount a half-filled form. Until it's answered the tree stays exactly as it
 * is, typing goes to this device, and saving waits.
 */
export function ComicsPortal() {
  const { isOwner, visitor } = useOwnerState();
  const [view, setView] = useState<View>("stories");
  // `instance` names the form: a new story getting its number must not remount it.
  const [editing, setEditing] = useState<{ ep: number | null; instance: number } | null>(null);
  const [stories, setStories] = useState<OwnerStory[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requests, setRequests] = useState<LicenceRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [notes, setNotes] = useState<GuestbookNoteRow[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<DraftKey[]>([]);
  // Bumped when a guess is saved: the quiz-and-tool form reloads (approving a
  // draft can set the tool) and the story list rereads which drafts still wait.
  const [guessRound, setGuessRound] = useState(0);
  /** The open form has pictures in hand, which stop if it closes. */
  const uploading = useRef(false);
  const setUploading = useCallback((active: boolean) => {
    uploading.current = active;
  }, []);
  /** Saved by the open form, so a list fetched just before that can't say it's gone. */
  const savedHere = useRef(new Set<number>());

  const refreshStories = useCallback(async () => {
    setLoadError(null);
    try {
      setStories((await portalApi.listStories()).stories);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  const refreshRequests = useCallback(async () => {
    setRequestsError(null);
    try {
      setRequests((await portalApi.licenceRequests()).requests);
    } catch (err) {
      setRequestsError(errorMessage(err));
    }
  }, []);

  const refreshNotes = useCallback(async () => {
    setNotesError(null);
    try {
      setNotes((await portalApi.guestbookNotes()).notes);
    } catch (err) {
      setNotesError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void refreshStories();
    void refreshRequests();
    void refreshNotes();
  }, [isOwner, refreshNotes, refreshRequests, refreshStories]);

  // On a weak signal the first try can easily fail, and a form may be waiting on it.
  useEffect(() => {
    if (!isOwner || !loadError) return;
    const retry = () => {
      if (document.visibilityState === "visible") void refreshStories();
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [isOwner, loadError, refreshStories]);

  // After a reload, back to the form that was open. Effects only: localStorage
  // isn't there for the server's render.
  useEffect(() => {
    setUnsaved(listDraftKeys());
    const open = readOpenStory();
    if (open === null) return;
    setEditing({ ep: open === NEW_STORY_KEY ? null : open, instance: 0 });
    setView("editor");
  }, []);

  const openEditor = useCallback((ep: number | null) => {
    if (uploading.current && !window.confirm(LEAVE_WHILE_UPLOADING)) return;
    uploading.current = false;
    setEditing((current) => ({ ep, instance: (current?.instance ?? 0) + 1 }));
    setView("editor");
    rememberOpenStory(ep ?? NEW_STORY_KEY);
  }, []);

  const closeEditor = useCallback(() => {
    uploading.current = false;
    setEditing(null);
    setView("stories");
    rememberOpenStory(null);
    setUnsaved(listDraftKeys());
  }, []);

  // Reopened after a reload, but it's gone: deleted elsewhere, say. Any draft stays kept.
  useEffect(() => {
    if (!stories || editing?.ep == null) return;
    if (!stories.some((s) => s.ep === editing.ep) && !savedHere.current.has(editing.ep)) {
      closeEditor();
    }
  }, [closeEditor, editing, stories]);

  const onSaved = useCallback((story: OwnerStory) => {
    savedHere.current.add(story.ep);
    setStories((current) => upsertStory(current, story));
    setEditing((current) => {
      if (current?.ep !== null || !current) return current;
      rememberOpenStory(story.ep);
      return { ...current, ep: story.ep };
    });
  }, []);

  const onDeleted = useCallback(
    (ep: number) => {
      savedHere.current.delete(ep);
      setStories((current) => current?.filter((s) => s.ep !== ep) ?? null);
      closeEditor();
    },
    [closeEditor]
  );

  const unhandled = requests?.filter((r) => !r.handled_at).length ?? 0;
  const waitingNotes = notes?.filter((n) => !n.approved_at).length ?? 0;
  const toReview = useMemo(() => reviewQueue(stories ?? []).length, [stories]);
  const unsavedEps = useMemo(
    () => new Set(unsaved.filter((key): key is number => typeof key === "number")),
    [unsaved]
  );

  if (visitor) return <OwnerOnlyNotice />;

  const editingStory =
    editing?.ep != null ? (stories?.find((s) => s.ep === editing.ep) ?? null) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <nav aria-label="Comics portal" className="flex flex-wrap gap-2">
        <ViewButton active={view === "stories"} onClick={() => setView("stories")}>
          Stories
        </ViewButton>
        {editing ? (
          <ViewButton active={view === "editor"} onClick={() => setView("editor")}>
            {editing.ep === null ? "New story" : `Episode ${editing.ep}`}
          </ViewButton>
        ) : null}
        <ViewButton active={view === "review"} onClick={() => setView("review")}>
          Review queue{toReview > 0 ? ` (${toReview})` : ""}
        </ViewButton>
        <ViewButton active={view === "entries"} onClick={() => setView("entries")}>
          Entries
        </ViewButton>
        <ViewButton active={view === "licence"} onClick={() => setView("licence")}>
          Licence requests
          {unhandled > 0 ? (
            <span
              aria-label={`${unhandled} waiting`}
              className="rounded-full bg-accent/10 px-2 text-xs font-semibold text-accent"
            >
              {unhandled}
            </span>
          ) : null}
        </ViewButton>
        <ViewButton active={view === "guestbook"} onClick={() => setView("guestbook")}>
          Guestbook
          {waitingNotes > 0 ? (
            <span
              aria-label={`${waitingNotes} waiting`}
              className="rounded-full bg-accent/10 px-2 text-xs font-semibold text-accent"
            >
              {waitingNotes}
            </span>
          ) : null}
        </ViewButton>
      </nav>

      <div hidden={view !== "stories"}>
        <StoriesView
          stories={stories}
          loadError={loadError}
          unsavedEps={unsavedEps}
          editing={Boolean(editing)}
          onEdit={openEditor}
          onStories={setStories}
          onRetry={refreshStories}
          guessRound={guessRound}
        />
      </div>
      {/* Hidden, not unmounted: visiting another view can't lose what's typed. */}
      {editing ? (
        <div hidden={view !== "editor"}>
          <StoryEditor
            key={editing.instance}
            ep={editing.ep}
            story={editingStory}
            verified={isOwner}
            loadError={loadError}
            onRetryLoad={refreshStories}
            onUploading={setUploading}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onClose={closeEditor}
          />
          {/* Outside the story's form, and only once it has a number to save under. */}
          {editing.ep !== null ? (
            <>
              <GuessEditor
                key={`guess-${editing.ep}`}
                ep={editing.ep}
                verified={isOwner}
                onSaved={() => setGuessRound((round) => round + 1)}
              />
              <ExtrasEditor
                key={`extras-${editing.ep}-${guessRound}`}
                ep={editing.ep}
                verified={isOwner}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {view === "review" ? (
        <ReviewView
          stories={stories}
          canSave={isOwner}
          skipEp={editing?.ep ?? null}
          onSaved={onSaved}
        />
      ) : null}
      {view === "entries" ? <EntriesView enabled={isOwner} /> : null}
      {view === "licence" ? (
        <LicenceView requests={requests} loadError={requestsError} onChanged={refreshRequests} />
      ) : null}
      {view === "guestbook" ? (
        <GuestbookView notes={notes} loadError={notesError} onChanged={refreshNotes} />
      ) : null}
    </div>
  );
}
