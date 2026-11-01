"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  QUEUE_WARNING_WEEKS,
  queueWeeksLeft,
  scheduleQueue,
  swapInQueue,
  unreleasedWeekly,
  type ScheduledRelease,
} from "@/lib/comics/queue";
import {
  publishProblems,
  storyState,
  unreviewedPanels,
  type OwnerStory,
} from "@/lib/comics/story-input";
import { errorMessage, portalApi, type UnusedFile } from "./portal-api";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
};

export function formatRelease(iso: string): string {
  return new Date(iso).toLocaleString(undefined, DATE_FORMAT);
}

function QueueNotice({ stories, now }: { stories: readonly OwnerStory[]; now: number }) {
  const weeks = queueWeeksLeft(stories, now);
  const scheduled = stories.some(
    (s) => s.collection === "weekly" && storyState(s.releaseAt, now) === "scheduled"
  );
  if (!scheduled) {
    return (
      <p role="status" className="rounded-md border border-border p-3 text-sm text-warning">
        Nothing is scheduled, so no new story will come out.
      </p>
    );
  }
  const text = `The queue runs out in ${weeks} ${weeks === 1 ? "week" : "weeks"}.`;
  return weeks < QUEUE_WARNING_WEEKS ? (
    <p
      role="alert"
      className="rounded-md border border-border p-3 text-sm font-medium text-warning"
    >
      {text} Time to add more stories.
    </p>
  ) : (
    <p className="rounded-md border border-border p-3 text-sm text-sub">{text}</p>
  );
}

function ScheduleQueue({
  stories,
  now,
  onStories,
}: {
  stories: readonly OwnerStory[];
  now: number;
  onStories: (stories: OwnerStory[]) => void;
}) {
  const [date, setDate] = useState("");
  const [plan, setPlan] = useState<ScheduledRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false);

  const queue = useMemo(() => unreleasedWeekly(stories, now), [stories, now]);
  const ready = queue.filter((s) => publishProblems(s).length === 0);
  const notReady = queue.length - ready.length;
  const reviewed = ready.filter((s) => unreviewedPanels(s) === 0);
  const unreviewedStories = ready.length - reviewed.length;
  const panelsToReview = ready.reduce((sum, s) => sum + unreviewedPanels(s), 0);
  const chosen = includeUnreviewed ? ready : reviewed;
  const byEp = new Map(stories.map((s) => [s.ep, s]));

  const preview = () => {
    setDone(false);
    setError(null);
    const next = scheduleQueue(
      chosen.map((s) => s.ep),
      date
    );
    if (!next || Date.parse(next[0]?.releaseAt ?? "") <= now) {
      setPlan(null);
      setError("Choose a launch date in the future.");
      return;
    }
    setPlan(next);
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const { stories: fresh } = await portalApi.schedule(plan, includeUnreviewed);
      onStories(fresh);
      setPlan(null);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
        Schedule the queue
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-sm text-sub">
          Episodes 27 to 30 go out on the launch date, then one every Monday at 07:00 UTC in number
          order. You can still change any story&apos;s date afterwards.
        </p>
        {notReady > 0 ? (
          <p className="text-sm text-sub">
            {notReady} {notReady === 1 ? "story isn't" : "stories aren't"} ready and will be left
            out.
          </p>
        ) : null}
        {unreviewedStories > 0 ? (
          <div className="space-y-1 rounded-md border border-border p-3 text-sm">
            <p className="text-warning">
              {unreviewedStories} {unreviewedStories === 1 ? "story has" : "stories have"}{" "}
              {panelsToReview} {panelsToReview === 1 ? "panel" : "panels"} nobody has reviewed.
              Descriptions go into the public page as they are, so these are left out unless you
              include them.
            </p>
            <label className="flex min-h-11 items-center gap-2 text-text">
              <input
                type="checkbox"
                checked={includeUnreviewed}
                className="size-5"
                onChange={(e) => {
                  setIncludeUnreviewed(e.target.checked);
                  setPlan(null);
                }}
              />
              Include them anyway
            </label>
          </div>
        ) : null}
        <Field label="Launch date">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setPlan(null);
              }}
            />
          )}
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={!date || chosen.length === 0}
          onClick={preview}
        >
          Preview the dates
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm text-sub">
            Dates saved.
          </p>
        ) : null}
        {plan ? (
          <div className="space-y-2">
            <ol className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {plan.map((item) => (
                <li key={item.ep} className="rounded-md border border-border p-2">
                  <span className="font-medium text-text">
                    {item.ep}. {byEp.get(item.ep)?.title}
                  </span>
                  <span className="block text-sub">{formatRelease(item.releaseAt)}</span>
                  {unreviewedPanels(byEp.get(item.ep) ?? { panels: [] }) > 0 ? (
                    <span className="block text-warning">Not reviewed yet</span>
                  ) : null}
                </li>
              ))}
            </ol>
            <Button type="button" variant="toolkit" disabled={saving} onClick={save}>
              Save these {plan.length} dates
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function UnusedArt() {
  const [files, setFiles] = useState<UnusedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setFiles((await portalApi.unusedArt()).files);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!files || files.length === 0) return;
    if (!window.confirm(`Delete ${files.length} unused files? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await portalApi.deleteUnusedArt(files.slice(0, 500).map((f) => f.path));
      setFiles((await portalApi.unusedArt()).files);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const megabytes = files ? files.reduce((sum, f) => sum + f.size, 0) / 1_048_576 : 0;
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">Unused art</summary>
      <div className="mt-2 space-y-3">
        <p className="text-sm text-sub">
          Replacing art or deleting a draft leaves the old files in storage. Nothing removes them
          until you do. Files from the last day aren&apos;t listed. A draft on another device may
          still point at one of these: if it does, saving that draft asks for the picture again.
        </p>
        <Button type="button" variant="outline" disabled={busy} onClick={check}>
          Check for unused art
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {files ? (
          files.length === 0 ? (
            <p className="text-sm text-sub">No unused art.</p>
          ) : (
            <>
              <p className="text-sm text-text">
                {files.length} files, {megabytes.toFixed(1)} MB.
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto break-all font-mono text-xs text-sub">
                {files.map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
              </ul>
              <Button type="button" variant="destructive" disabled={busy} onClick={remove}>
                Delete these files
              </Button>
            </>
          )
        ) : null}
      </div>
    </details>
  );
}

function StoryCard({
  story,
  now,
  unsaved,
  onEdit,
  onMove,
}: {
  story: OwnerStory;
  now: number;
  unsaved: boolean;
  onEdit: () => void;
  onMove?: (step: -1 | 1) => void;
}) {
  const state = storyState(story.releaseAt, now);
  const problems = publishProblems(story).length;
  const reviewing = story.panels.filter((p) => p.needsReview).length;
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div>
          <p className="font-medium text-text">
            {story.ep}. {story.title || "Untitled"}
          </p>
          <p className="text-sm text-sub">
            {state === "draft"
              ? "Draft"
              : `${state === "scheduled" ? "Scheduled" : "Released"}: ${formatRelease(story.releaseAt!)}`}
          </p>
          {problems > 0 ? (
            <p className="text-sm text-warning">Not ready: {problems} to fix.</p>
          ) : null}
          {reviewing > 0 ? (
            <p className="text-sm text-sub">{reviewing} panels need review.</p>
          ) : null}
          {story.firstReleasedAt && state === "draft" ? (
            <p className="text-sm text-sub">Unpublished. It has been out, so its number stays.</p>
          ) : null}
          {unsaved ? <p className="text-sm text-sub">Has unsaved changes on this device.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="mr-auto" onClick={onEdit}>
            Edit
          </Button>
          {onMove ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move episode ${story.ep} earlier`}
                onClick={() => onMove(-1)}
              >
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move episode ${story.ep} later`}
                onClick={() => onMove(1)}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface StoriesViewProps {
  stories: OwnerStory[] | null;
  loadError: string | null;
  unsavedEps: ReadonlySet<number>;
  /** A form is open. Moving stories under it would make its next save overwrite another one. */
  editing: boolean;
  onEdit: (ep: number | null) => void;
  onStories: (stories: OwnerStory[]) => void;
  onRetry: () => void;
}

export function StoriesView({
  stories,
  loadError,
  unsavedEps,
  editing,
  onEdit,
  onStories,
  onRetry,
}: StoriesViewProps) {
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // Read in an effect: the server's clock would disagree with the browser's on hydration.
  useEffect(() => setNow(Date.now()), [stories]);

  const queue = useMemo(() => unreleasedWeekly(stories ?? [], now), [stories, now]);
  const queueEps = queue.map((s) => s.ep);
  const scheduled = (stories ?? []).filter((s) => storyState(s.releaseAt, now) === "scheduled");
  const drafts = (stories ?? []).filter((s) => storyState(s.releaseAt, now) === "draft");
  const released = (stories ?? [])
    .filter((s) => storyState(s.releaseAt, now) === "released")
    .reverse();

  const move = async (ep: number, step: -1 | 1) => {
    const order = swapInQueue(queueEps, ep, step);
    if (!order || moving) return;
    if (editing) {
      setError("Close the story you have open before moving stories.");
      return;
    }
    setMoving(true);
    setError(null);
    try {
      const { stories: fresh } = await portalApi.reorder(order);
      onStories(fresh);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMoving(false);
    }
  };

  const cards = (list: OwnerStory[]) =>
    list.map((story) => (
      <StoryCard
        key={story.ep}
        story={story}
        now={now}
        unsaved={unsavedEps.has(story.ep)}
        onEdit={() => onEdit(story.ep)}
        onMove={
          story.collection === "weekly" && queueEps.includes(story.ep)
            ? (step) => move(story.ep, step)
            : undefined
        }
      />
    ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="toolkit" onClick={() => onEdit(null)}>
          <Plus aria-hidden="true" />
          New story
        </Button>
        <Button asChild variant="outline">
          <Link href="/settings/comics/import">
            <Upload aria-hidden="true" />
            Import a batch
          </Link>
        </Button>
      </div>

      {loadError ? (
        <div role="alert" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p className="text-danger">{loadError}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!stories ? (
        loadError ? null : (
          <p className="text-sm text-sub">Loading stories…</p>
        )
      ) : (
        <>
          <QueueNotice stories={stories} now={now} />
          <ScheduleQueue stories={stories} now={now} onStories={onStories} />

          <section aria-labelledby="scheduled-heading" className="space-y-2">
            <h2 id="scheduled-heading" className="font-semibold text-text">
              Scheduled ({scheduled.length})
            </h2>
            {scheduled.length === 0 ? (
              <p className="text-sm text-sub">Nothing scheduled.</p>
            ) : (
              cards(scheduled)
            )}
          </section>

          <section aria-labelledby="drafts-heading" className="space-y-2">
            <h2 id="drafts-heading" className="font-semibold text-text">
              Drafts ({drafts.length})
            </h2>
            {drafts.length === 0 ? <p className="text-sm text-sub">No drafts.</p> : cards(drafts)}
          </section>

          <details className="space-y-2 rounded-lg border border-border p-3">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
              Released ({released.length})
            </summary>
            <div className="mt-2 space-y-2">{cards(released)}</div>
          </details>

          <UnusedArt />
        </>
      )}
    </div>
  );
}
