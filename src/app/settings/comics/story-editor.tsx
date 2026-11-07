"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComicPanels } from "@/app/(tools)/comics/components/comic-panels";
import { EpisodeNotes } from "@/app/(tools)/comics/components/episode-notes";
import { RightsNotice } from "@/app/(tools)/comics/components/rights-notice";
import {
  NEW_STORY_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftKey,
  type StoryDraft,
} from "@/lib/comics/draft-store";
import type { UploadedArt } from "@/lib/comics/image-pipeline";
import { nextSundaySlot } from "@/lib/comics/queue";
import {
  DEFAULT_CREDIT_CORNER,
  STORY_LIMITS,
  panelHasArt,
  publishProblems,
  storyState,
  unreviewedPanels,
  type OwnerStory,
  type StoredPanel,
} from "@/lib/comics/story-input";
import { THEME_LABELS } from "@/lib/comics/themes";
import { cn } from "@/lib/utils";
import { ArtJobRow, PanelEditor, PickImages } from "./panel-editor";
import { createArtUploader, errorMessage, panelForSave, portalApi } from "./portal-api";
import { useArtQueue } from "./use-art-queue";

const AUTOSAVE_MS = 400;

export const LEAVE_WHILE_UPLOADING =
  "Pictures are still uploading or waiting for a retry. If you leave now, those ones will need choosing again. What you typed is kept. Leave anyway?";

type EditorPanel = StoredPanel & { key: string };
type Form = Omit<StoryDraft, "panels" | "baseUpdatedAt"> & { panels: EditorPanel[] };

let panelSerial = 0;
function withKey(panel: StoredPanel): EditorPanel {
  panelSerial += 1;
  return { ...panel, key: `p${panelSerial}` };
}

function emptyPanel(): EditorPanel {
  return withKey({
    pathFull: "",
    pathSmall: "",
    width: 0,
    height: 0,
    alt: "",
    dialogue: [],
    signs: [],
    needsReview: false,
    creditCorner: DEFAULT_CREDIT_CORNER,
  });
}

/** The value a datetime-local input wants: this device's clock, no zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function formFromStory(story: OwnerStory | null): Form {
  return {
    title: story?.title ?? "",
    lesson: story?.lesson ?? "",
    squadQuestion: story?.squadQuestion ?? "",
    cast: story?.castNames.join(", ") ?? "",
    themes: story?.themes ?? [],
    release: toLocalInput(story?.releaseAt ?? null),
    panels: (story?.panels ?? []).map(withKey),
    sharePath: story?.sharePath ?? null,
  };
}

function formFromDraft(draft: StoryDraft): Form {
  return { ...draft, panels: draft.panels.map(withKey) };
}

/** What was typed wins, and whatever wasn't touched comes from the server's copy. */
function fillBlanks(typed: Form, server: Form): Form {
  return {
    title: typed.title || server.title,
    lesson: typed.lesson || server.lesson,
    squadQuestion: typed.squadQuestion || server.squadQuestion,
    cast: typed.cast || server.cast,
    themes: typed.themes.length > 0 ? typed.themes : server.themes,
    release: typed.release || server.release,
    panels: typed.panels.length > 0 ? typed.panels : server.panels,
    sharePath: typed.sharePath ?? server.sharePath,
  };
}

function castList(cast: string): string[] {
  return cast
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, STORY_LIMITS.castNames);
}

function toBody(form: Form) {
  return {
    title: form.title,
    lesson: form.lesson,
    squadQuestion: form.squadQuestion,
    castNames: castList(form.cast),
    themes: form.themes,
    panels: form.panels.map(panelForSave),
    sharePath: form.sharePath,
  };
}

interface StoryEditorProps {
  /** The story's number, or null for one that doesn't have a number yet. */
  ep: number | null;
  /** The server's copy, when it has loaded. */
  story: OwnerStory | null;
  /** False until the owner is verified: typing is fine, saving isn't. */
  verified: boolean;
  /** Why the server's copy hasn't arrived, if it failed to load. */
  loadError?: string | null;
  onRetryLoad?: () => void;
  /** Whether this form is holding pictures that stop if it closes. */
  onUploading?: (active: boolean) => void;
  onSaved: (story: OwnerStory) => void;
  onDeleted: (ep: number) => void;
  onClose: () => void;
}

/**
 * New or edit story, built for a phone on a poor signal: everything typed goes
 * to this device first, and a failed save or upload costs nothing.
 */
export function StoryEditor({
  ep: initialEp,
  story,
  verified,
  loadError = null,
  onRetryLoad,
  onUploading,
  onSaved,
  onDeleted,
  onClose,
}: StoryEditorProps) {
  const [ep, setEp] = useState(initialEp);
  const draftKey: DraftKey = ep ?? NEW_STORY_KEY;

  const initialDraft = useRef(loadDraft(draftKey));
  const [form, setForm] = useState<Form>(() =>
    initialDraft.current ? formFromDraft(initialDraft.current) : formFromStory(story)
  );
  /** Always the newest text, for saves and jobs that outlive a render. */
  const formRef = useRef(form);
  const replaceForm = useCallback((next: Form) => {
    formRef.current = next;
    setForm(next);
  }, []);
  /** Whether the form holds anything yet: a draft, or the server's copy. */
  const seeded = useRef(Boolean(initialDraft.current || story || initialEp === null));
  const [restored, setRestored] = useState(Boolean(initialDraft.current));
  const [conflict, setConflict] = useState<OwnerStory | null>(null);
  const baseUpdatedAt = useRef<string | null>(
    initialDraft.current?.baseUpdatedAt ?? story?.updatedAt ?? null
  );
  const [server, setServer] = useState(story);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const files = useRef(new Map<string, File>());
  const dirty = useRef(false);
  /** Set once the form is gone or thrown away: nothing it started may save after that. */
  const closed = useRef(false);

  // The server's copy can arrive after the form opened on a slow connection.
  useEffect(() => {
    if (!story) return;
    setServer((current) => current ?? story);
    if (!seeded.current) {
      seeded.current = true;
      if (dirty.current) {
        // Typed into the empty form while this was on its way: keep every word.
        replaceForm(fillBlanks(formRef.current, formFromStory(story)));
        setConflict(story);
        return;
      }
      baseUpdatedAt.current = story.updatedAt;
      replaceForm(formFromStory(story));
      return;
    }
    // A draft from before the queue moved may belong to another story now, so
    // restoring it is the owner's call.
    if (initialDraft.current && initialDraft.current.baseUpdatedAt !== story.updatedAt) {
      setConflict(story);
    }
    initialDraft.current = null;
  }, [story, replaceForm]);

  const update = useCallback(
    (change: Partial<Form> | ((f: Form) => Form)) => {
      dirty.current = true;
      const current = formRef.current;
      replaceForm(typeof change === "function" ? change(current) : { ...current, ...change });
    },
    [replaceForm]
  );

  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  // A number with no server copy yet: saving now would overwrite it with a blank form.
  const canSave = verified && (ep === null || server !== null);
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  const serverRef = useRef(server);
  serverRef.current = server;

  const keepDraft = useCallback(() => {
    if (!dirty.current) return;
    const { panels, ...rest } = formRef.current;
    const kept = saveDraft(draftKeyRef.current, {
      ...rest,
      panels: panels.map(panelForSave),
      baseUpdatedAt: baseUpdatedAt.current,
    });
    setStorageFailed(!kept);
  }, []);

  useEffect(() => {
    const timer = setTimeout(keepDraft, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [form, keepDraft]);

  // A phone can kill the page without warning once it's in the background.
  useEffect(() => {
    const flush = () => keepDraft();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      keepDraft();
    };
  }, [keepDraft]);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  /** One save at a time, in order, each sending the newest text. */
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const epRef = useRef(ep);
  const persist = useCallback((): Promise<OwnerStory> => {
    const run = async () => {
      if (closed.current) throw new Error("This form has closed.");
      const snapshot = formRef.current;
      const body = toBody(snapshot);
      const saved =
        epRef.current === null
          ? (await portalApi.createStory(body)).story
          : (await portalApi.patchStory(epRef.current, body)).story;
      const previousKey = draftKeyRef.current;
      epRef.current = saved.ep;
      setEp(saved.ep);
      draftKeyRef.current = saved.ep;
      setServer(saved);
      baseUpdatedAt.current = saved.updatedAt;
      setConflict(null);
      onSaved(saved);
      clearDraft(previousKey);
      if (formRef.current === snapshot) {
        dirty.current = false;
        clearDraft(saved.ep);
      } else {
        // Typed while that was on its way: keep the newer text under its number.
        keepDraft();
      }
      return saved;
    };
    const next = saving.current.then(run, run);
    saving.current = next.catch(() => undefined);
    return next;
  }, [keepDraft, onSaved]);

  const uploader = useMemo(createArtUploader, []);
  const art = useArtQueue({
    uploader,
    optionsFor: (key) => {
      const panels = formRef.current.panels;
      const panel = panels.find((p) => p.key === key);
      if (!panel) return null;
      return { corner: panel.creditCorner, withShare: panels[0]?.key === key };
    },
    onDone: (key: string, done: UploadedArt) => {
      update((f) => ({
        ...f,
        // Only the panel in first place by now: the crop has to match what readers see first.
        sharePath: (f.panels[0]?.key === key ? done.sharePath : null) ?? f.sharePath,
        panels: f.panels.map((p) =>
          p.key === key
            ? {
                ...p,
                pathFull: done.pathFull,
                pathSmall: done.pathSmall,
                width: done.width,
                height: done.height,
              }
            : p
        ),
      }));
      // New art goes on the server's draft at once, so it can't end up unused.
      // Not on a live story: that waits for an explicit save.
      if (canSaveRef.current && !serverRef.current?.releaseAt) {
        setTimeout(() => {
          if (closed.current) return;
          persist().catch(() => setStatus("Art uploaded. The story is kept on this device."));
        }, 0);
      }
    },
  });

  const jobFor = (key: string) => art.jobs.find((job) => job.key === key);

  const holdingPictures = art.jobs.length > 0;
  useEffect(() => {
    onUploading?.(holdingPictures);
  }, [holdingPictures, onUploading]);

  const addPictures = (picked: File[]) => {
    const panels = [...formRef.current.panels];
    const assign: [string, File][] = [];
    for (const file of picked) {
      let slot = panels.find(
        (p) => !panelHasArt(p) && !jobFor(p.key) && !assign.some(([key]) => key === p.key)
      );
      if (!slot) {
        if (panels.length >= STORY_LIMITS.panels) break;
        slot = emptyPanel();
        panels.push(slot);
      }
      assign.push([slot.key, file]);
    }
    update({ panels });
    for (const [key, file] of assign) {
      files.current.set(key, file);
      art.enqueue(key, file);
    }
  };

  const pickFor = (key: string, file: File) => {
    files.current.set(key, file);
    art.enqueue(key, file);
  };

  /** The share image is cropped from panel 1, so a new panel 1 needs a new one. */
  const refreshShareImage = (wasFirst: string | undefined) => {
    const first = formRef.current.panels[0];
    if (!first || first.key === wasFirst) return;
    const file = files.current.get(first.key);
    if (file) art.enqueue(first.key, file);
    else if (panelHasArt(first)) {
      setStatus(
        "The share image still shows the old first panel. Choose this panel's art again to update it."
      );
    }
  };

  const movePanel = (index: number, step: -1 | 1) => {
    const panels = [...formRef.current.panels];
    const to = index + step;
    if (to < 0 || to >= panels.length) return;
    const wasFirst = panels[0]?.key;
    [panels[index], panels[to]] = [panels[to], panels[index]];
    update({ panels });
    refreshShareImage(wasFirst);
  };

  const changePanel = (key: string, change: Partial<StoredPanel>) =>
    update((f) => ({
      ...f,
      panels: f.panels.map((p) => (p.key === key ? { ...p, ...change } : p)),
    }));

  const removePanel = (key: string) => {
    art.dismiss(key);
    files.current.delete(key);
    const wasFirst = formRef.current.panels[0]?.key;
    update((f) => ({ ...f, panels: f.panels.filter((p) => p.key !== key) }));
    refreshShareImage(wasFirst);
  };

  const toggleTheme = (code: string) =>
    update((f) => ({
      ...f,
      themes: f.themes.includes(code) ? f.themes.filter((t) => t !== code) : [...f.themes, code],
    }));

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveDraftNow = () =>
    act(async () => {
      await persist();
      setStatus("Saved.");
    });

  /**
   * The server has a new date. It isn't the owner's edit, so it mustn't look like
   * unsaved work: the draft goes unless something was typed meanwhile, and the
   * base moves on, or the next open would warn of a change that came from here.
   */
  const settleRelease = (settled: OwnerStory, releaseAt: string | null) => {
    baseUpdatedAt.current = settled.updatedAt;
    setServer(settled);
    onSaved(settled);
    replaceForm({ ...formRef.current, release: toLocalInput(releaseAt) });
    if (dirty.current) keepDraft();
    else clearDraft(settled.ep);
  };

  const release = (releaseAt: string, message: string) => {
    const body = toBody(formRef.current);
    const blockers = publishProblems(body);
    setProblems(blockers);
    if (blockers.length > 0) return;
    const unreviewed = unreviewedPanels(body);
    if (
      unreviewed > 0 &&
      !window.confirm(
        `${unreviewed} ${unreviewed === 1 ? "panel still needs" : "panels still need"} review. Descriptions go into the public page as they are. Go ahead?`
      )
    ) {
      return;
    }
    void act(async () => {
      const saved = await persist();
      const { story: released } = await portalApi.setRelease(saved.ep, releaseAt, unreviewed > 0);
      settleRelease(released, releaseAt);
      setStatus(message);
    });
  };

  const publishNow = () => {
    if (!window.confirm("Publish this story now? Everyone will be able to read it.")) return;
    release(new Date().toISOString(), "Published.");
  };

  const schedule = () => {
    const at = fromLocalInput(formRef.current.release);
    if (!at) {
      setError("Choose a release date first.");
      return;
    }
    if (Date.parse(at) <= Date.now()) {
      setError("That date has passed. Choose a later one, or use Publish now.");
      return;
    }
    release(at, "Scheduled.");
  };

  const unpublish = () => {
    if (ep === null) return;
    if (
      !window.confirm("Unpublish this story? It goes back to being a draft and keeps its number.")
    ) {
      return;
    }
    void act(async () => {
      const { story: back } = await portalApi.setRelease(ep, null);
      settleRelease(back, null);
      setStatus("Unpublished.");
    });
  };

  const removeStory = () => {
    if (ep === null) {
      if (!window.confirm("Throw away this new story?")) return;
      // Pictures still on their way would otherwise create the story being thrown away.
      closed.current = true;
      art.cancelAll();
      dirty.current = false;
      clearDraft(NEW_STORY_KEY);
      onClose();
      return;
    }
    if (!window.confirm("Delete this draft? This can't be undone.")) return;
    art.cancelAll();
    void act(async () => {
      await portalApi.deleteStory(ep);
      closed.current = true;
      dirty.current = false;
      clearDraft(ep);
      onDeleted(ep);
    });
  };

  const useServerCopy = () => {
    if (!conflict) return;
    dirty.current = false;
    clearDraft(draftKey);
    baseUpdatedAt.current = conflict.updatedAt;
    replaceForm(formFromStory(conflict));
    setConflict(null);
    setRestored(false);
  };

  const discardRestored = () => {
    dirty.current = false;
    clearDraft(draftKey);
    // The server's copy may not have arrived: leave the form to take it when it does.
    seeded.current = Boolean(server) || epRef.current === null;
    replaceForm(formFromStory(server));
    setRestored(false);
    setConflict(null);
  };

  const backToStories = () => {
    if (art.jobs.length > 0 && !window.confirm(LEAVE_WHILE_UPLOADING)) return;
    onClose();
  };

  const suggestDate = () =>
    update({ release: toLocalInput(nextSundaySlot(new Date()).toISOString()) });

  const state = storyState(server?.releaseAt ?? null);
  const isBook = ep !== null && ep <= 26;
  const panelsWithArt = form.panels.filter(panelHasArt);
  const orphanJobs = art.jobs.filter((job) => !form.panels.some((p) => p.key === job.key));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void saveDraftNow();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-text">
          {ep === null ? "New story" : `Episode ${ep}`}
          {server ? <span className="ml-2 text-sm font-normal text-sub">({state})</span> : null}
        </h2>
        <Button type="button" variant="outline" onClick={backToStories}>
          Back to stories
        </Button>
      </div>

      {!verified ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm text-sub">
          Checking it&apos;s you. Keep typing: everything stays on this device, and saving comes
          back once the check finishes.
        </p>
      ) : !canSave && loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p className="text-danger">
            Couldn&apos;t load this story from the server, so saving is off for now. {loadError}
          </p>
          {onRetryLoad ? (
            <Button type="button" variant="outline" onClick={onRetryLoad}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : !canSave ? (
        <p role="status" className="rounded-md border border-border p-3 text-sm text-sub">
          Loading this story from the server. Keep typing: everything stays on this device, and
          saving comes back once it arrives.
        </p>
      ) : null}
      {storageFailed ? (
        <p role="alert" className="rounded-md border border-border p-3 text-sm text-danger">
          This browser isn&apos;t keeping drafts, so save to the server before leaving the page.
        </p>
      ) : null}
      {restored && !conflict ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm text-sub"
        >
          <span className="mr-auto">Restored your unsaved draft from this device.</span>
          <Button type="button" variant="ghost" onClick={discardRestored}>
            Discard it
          </Button>
        </div>
      ) : null}
      {conflict ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-border p-3 text-sm text-text"
        >
          <p>
            This story changed on the server after your draft was typed. The form shows your draft.
            Saving would replace the server&apos;s copy with it.
          </p>
          <Button type="button" variant="outline" onClick={useServerCopy}>
            Use the server&apos;s copy
          </Button>
        </div>
      ) : null}

      <Field label="Title" required>
        {(props) => (
          <Input
            {...props}
            value={form.title}
            maxLength={STORY_LIMITS.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <Field label="Lesson">
        {(props) => (
          <Textarea
            {...props}
            value={form.lesson}
            maxLength={STORY_LIMITS.lesson}
            rows={2}
            onChange={(e) => update({ lesson: e.target.value })}
          />
        )}
      </Field>
      <Field label="Squad question">
        {(props) => (
          <Textarea
            {...props}
            value={form.squadQuestion}
            maxLength={STORY_LIMITS.squadQuestion}
            rows={2}
            onChange={(e) => update({ squadQuestion: e.target.value })}
          />
        )}
      </Field>
      <Field label="Cast" hint="Names, separated by commas.">
        {(props) => (
          <Input {...props} value={form.cast} onChange={(e) => update({ cast: e.target.value })} />
        )}
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Themes</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(THEME_LABELS).map(([code, label]) => {
            const on = form.themes.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTheme(code)}
                className={cn(
                  "min-h-11 rounded-md border border-border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "bg-accent/10 font-medium text-accent" : "text-sub"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section aria-label="Panels" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto font-semibold text-text">Panels</h3>
          <PickImages label="Pick images" multiple variant="toolkit" onPick={addPictures} />
        </div>
        <p className="text-sm text-sub">
          Each picture is converted on this device and uploaded one at a time. The original stays
          here.
        </p>
        {orphanJobs.map((job) => (
          <ArtJobRow
            key={job.key}
            job={job}
            onRetry={() => art.retry(job.key)}
            onDismiss={() => art.dismiss(job.key)}
          />
        ))}
        {form.panels.map((panel, index) => (
          <PanelEditor
            key={panel.key}
            index={index}
            count={form.panels.length}
            panel={panel}
            job={jobFor(panel.key)}
            onChange={(change) => changePanel(panel.key, change)}
            onMove={(step) => movePanel(index, step)}
            onRemove={() => removePanel(panel.key)}
            onPick={(file) => pickFor(panel.key, file)}
            onRetry={() => art.retry(panel.key)}
            onDismissJob={() => art.dismiss(panel.key)}
          />
        ))}
        {form.panels.length < STORY_LIMITS.panels ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => update((f) => ({ ...f, panels: [...f.panels, emptyPanel()] }))}
          >
            Add a panel without art
          </Button>
        ) : null}
      </section>

      <Field label="Release date" hint="Your device's time. The usual slot is Sunday at 07:00 UTC.">
        {(props) => (
          <Input
            {...props}
            type="datetime-local"
            value={form.release}
            onChange={(e) => update({ release: e.target.value })}
          />
        )}
      </Field>
      <Button type="button" variant="outline" onClick={suggestDate}>
        Use next Sunday
      </Button>

      {problems.length > 0 ? (
        <div role="alert" className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-danger">This story can&apos;t go out yet:</p>
          <ul className="mt-1 list-disc pl-5 text-text">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-sub">
          {status}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="toolkit" disabled={!canSave || busy}>
          Save draft
        </Button>
        <Button type="button" variant="outline" onClick={() => setPreviewing((v) => !v)}>
          {previewing ? "Hide preview" : "Preview"}
        </Button>
        <Button type="button" variant="outline" disabled={!canSave || busy} onClick={schedule}>
          Schedule
        </Button>
        <Button type="button" variant="outline" disabled={!canSave || busy} onClick={publishNow}>
          Publish now
        </Button>
        {server?.releaseAt ? (
          <Button type="button" variant="outline" disabled={!canSave || busy} onClick={unpublish}>
            Unpublish
          </Button>
        ) : null}
        {!server?.releaseAt && !server?.firstReleasedAt ? (
          <Button type="button" variant="danger-ghost" disabled={busy} onClick={removeStory}>
            {ep === null ? "Discard" : "Delete draft"}
          </Button>
        ) : null}
      </div>

      {previewing ? (
        <section aria-label="Preview" className="space-y-4 rounded-lg border border-border p-3">
          <h3 className="text-lg font-semibold text-text">{form.title || "Untitled"}</h3>
          <ComicPanels panels={panelsWithArt} title={form.title} />
          {panelsWithArt.length < form.panels.length ? (
            <p className="text-sm text-sub">Panels without art aren&apos;t shown here.</p>
          ) : null}
          <EpisodeNotes
            lesson={form.lesson}
            question={form.squadQuestion}
            bookPage={isBook ? server?.bookPage : null}
          />
          <RightsNotice />
        </section>
      ) : null}
    </form>
  );
}
