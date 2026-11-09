"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "@/lib/comics/draft-store";
import { panelImageUrl } from "@/lib/comics/images";
import { processPanelImage } from "@/lib/comics/image-pipeline";
import {
  CREDIT_CORNERS,
  STORY_LIMITS,
  panelHasArt,
  type CreditCorner,
  type OwnerStory,
  type StoredPanel,
} from "@/lib/comics/story-input";
import { CORNER_LABELS, PickImages } from "./panel-editor";
import { createArtUploader, errorMessage, panelForSave, portalApi } from "./portal-api";

const AUTOSAVE_MS = 400;

interface ReviewItem {
  ep: number;
  index: number;
}

export function reviewQueue(stories: readonly OwnerStory[]): ReviewItem[] {
  return stories.flatMap((story) =>
    story.panels.flatMap((panel, index) => (panel.needsReview ? [{ ep: story.ep, index }] : []))
  );
}

function ReviewPanel({
  story,
  index,
  remaining,
  position,
  onSaved,
  onMove,
  canSave,
}: {
  story: OwnerStory;
  index: number;
  remaining: number;
  position: number;
  onSaved: (story: OwnerStory) => void;
  onMove: (step: -1 | 1) => void;
  canSave: boolean;
}) {
  const panel = story.panels[index];
  // This is where 104 descriptions get written, so what's typed goes to this
  // device first: Skip, another view or a killed tab can't cost any of it.
  const [restored] = useState(() => loadReviewDraft(story.ep, index, panel.alt));
  const [alt, setAlt] = useState(restored?.alt ?? panel.alt);
  const [dialogue, setDialogue] = useState(restored?.dialogue ?? panel.dialogue);
  const [storageFailed, setStorageFailed] = useState(false);
  const touched = useRef(false);
  const typed = useRef({ alt, dialogue, baseAlt: panel.alt });
  typed.current = { alt, dialogue, baseAlt: panel.alt };
  const [corner, setCorner] = useState<CreditCorner>(panel.creditCorner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const uploader = useRef(createArtUploader());

  const keepDraft = useCallback(() => {
    if (touched.current) setStorageFailed(!saveReviewDraft(story.ep, index, typed.current));
  }, [index, story.ep]);

  useEffect(() => {
    const timer = setTimeout(keepDraft, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [alt, dialogue, keepDraft]);

  useEffect(() => {
    window.addEventListener("pagehide", keepDraft);
    document.addEventListener("visibilitychange", keepDraft);
    return () => {
      window.removeEventListener("pagehide", keepDraft);
      document.removeEventListener("visibilitychange", keepDraft);
      keepDraft();
    };
  }, [keepDraft]);

  const save = async (change: Partial<StoredPanel>, sharePath?: string | null) => {
    const panels = story.panels.map((p, i) =>
      panelForSave(i === index ? { ...p, alt, dialogue, ...change } : p)
    );
    const { story: saved } = await portalApi.patchStory(story.ep, {
      panels,
      ...(sharePath ? { sharePath } : {}),
    });
    touched.current = false;
    clearReviewDraft(story.ep, index);
    onSaved(saved);
  };

  const markReviewed = async () => {
    if (!alt.trim()) {
      setError("Describe what this panel shows first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({ needsReview: false });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** The credit is drawn into the pixels, so moving it needs the original again. */
  const redraw = async (file: File) => {
    setBusy(true);
    setError(null);
    setRetryFile(null);
    setStatus("Converting…");
    try {
      const art = await processPanelImage(file, {
        corner,
        withShare: index === 0,
        uploader: uploader.current,
        onStep: (step) => setStatus(step === "converting" ? "Converting…" : "Uploading…"),
      });
      await save(
        {
          pathFull: art.pathFull,
          pathSmall: art.pathSmall,
          width: art.width,
          height: art.height,
          creditCorner: corner,
        },
        art.sharePath
      );
      setStatus("Credit moved.");
    } catch (err) {
      setRetryFile(file);
      setStatus(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-sub">
        {remaining} {remaining === 1 ? "panel" : "panels"} to check. This one:{" "}
        <span className="font-medium text-text">
          episode {story.ep}, {story.title || "Untitled"}, panel {index + 1}
        </span>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {panelHasArt(panel) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={panelImageUrl(panel.pathSmall)}
              width={panel.width}
              height={panel.height}
              alt=""
              className="h-auto w-full rounded-md border border-border"
            />
          ) : (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-sub">
              No art yet.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Credit corner" className="min-w-40 flex-1">
              {(props) => (
                <select
                  {...props}
                  value={corner}
                  onChange={(e) => setCorner(e.target.value as CreditCorner)}
                  className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base pointer-fine:md:h-9 pointer-fine:md:text-sm"
                >
                  {CREDIT_CORNERS.map((c) => (
                    <option key={c} value={c}>
                      {CORNER_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <PickImages
              label="Choose the picture to redraw"
              onPick={(files) => void redraw(files[0])}
            />
          </div>
          {status ? (
            <p role="status" className="text-sm text-sub">
              {status}
            </p>
          ) : null}
          {retryFile ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void redraw(retryFile)}
            >
              Try again
            </Button>
          ) : null}
        </div>
        <div className="space-y-3">
          <Field label="What this panel shows" required>
            {(props) => (
              <Textarea
                {...props}
                value={alt}
                rows={6}
                maxLength={STORY_LIMITS.alt}
                onChange={(e) => {
                  touched.current = true;
                  setAlt(e.target.value);
                }}
              />
            )}
          </Field>
          {dialogue.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-text">Who says what</legend>
              {dialogue.map((d, at) => (
                <div key={at} className="space-y-1">
                  <Input
                    aria-label={`Line ${at + 1}: speaker`}
                    placeholder="Who says it"
                    value={d.speaker}
                    maxLength={STORY_LIMITS.speaker}
                    onChange={(e) => {
                      touched.current = true;
                      setDialogue((lines) =>
                        lines.map((l, i) => (i === at ? { ...l, speaker: e.target.value } : l))
                      );
                    }}
                  />
                  <p className="text-sm text-sub">{d.line}</p>
                </div>
              ))}
            </fieldset>
          ) : null}
          {restored ? (
            <p role="status" className="text-sm text-sub">
              Restored what you typed on this device.
            </p>
          ) : null}
          {storageFailed ? (
            <p role="alert" className="text-sm text-danger">
              This browser isn&apos;t keeping drafts, so save before leaving this panel.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              disabled={busy || !canSave}
              onClick={markReviewed}
            >
              Save and mark reviewed
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={position === 0}
              onClick={() => onMove(-1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={position >= remaining - 1}
              onClick={() => onMove(1)}
            >
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReviewView({
  stories,
  canSave,
  skipEp,
  onSaved,
}: {
  stories: OwnerStory[] | null;
  canSave: boolean;
  /** The story open in the form: two editors on one story would overwrite each other. */
  skipEp: number | null;
  onSaved: (story: OwnerStory) => void;
}) {
  const items = useMemo(
    () => reviewQueue(stories ?? []).filter((item) => item.ep !== skipEp),
    [skipEp, stories]
  );
  const [position, setPosition] = useState(0);
  const at = Math.min(position, Math.max(0, items.length - 1));
  const item = items[at];
  const story = item ? stories?.find((s) => s.ep === item.ep) : undefined;

  useEffect(() => setPosition(at), [at]);

  if (!stories) return <p className="text-sm text-sub">Loading stories…</p>;

  return (
    <div className="space-y-4">
      {item && story ? (
        <ReviewPanel
          key={`${item.ep}:${item.index}`}
          story={story}
          index={item.index}
          remaining={items.length}
          position={at}
          canSave={canSave}
          onSaved={onSaved}
          onMove={(step) => setPosition(at + step)}
        />
      ) : (
        <p className="text-sm text-sub">
          Nothing to review. Panels from an{" "}
          <Link className="underline" href="/settings/comics/import">
            import
          </Link>{" "}
          show up here.
        </p>
      )}
    </div>
  );
}
