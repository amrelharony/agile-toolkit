"use client";

import { ChevronDown, ChevronUp, ImagePlus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { panelImageUrl } from "@/lib/comics/images";
import {
  CREDIT_CORNERS,
  STORY_LIMITS,
  panelHasArt,
  type CreditCorner,
  type StoredPanel,
} from "@/lib/comics/story-input";
import type { ArtJob, ArtJobStatus } from "./use-art-queue";

export const CORNER_LABELS: Readonly<Record<CreditCorner, string>> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
};

const STATUS_LABELS: Readonly<Record<ArtJobStatus, string>> = {
  waiting: "Waiting its turn…",
  converting: "Converting…",
  uploading: "Uploading…",
  failed: "Upload failed",
};

/** A picture picker that looks like a button: no camera API, the phone offers its own. */
export function PickImages({
  label,
  multiple,
  onPick,
  variant = "outline",
}: {
  label: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
  variant?: "outline" | "toolkit";
}) {
  return (
    <Button asChild variant={variant} className="cursor-pointer focus-within:ring-1">
      <label>
        <ImagePlus aria-hidden="true" />
        {label}
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // Cleared, or choosing the same file again wouldn't fire this.
            e.target.value = "";
            if (files.length > 0) onPick(files);
          }}
        />
      </label>
    </Button>
  );
}

export function ArtJobRow({
  job,
  onRetry,
  onDismiss,
}: {
  job: ArtJob;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
    >
      <span className={job.status === "failed" ? "font-medium text-danger" : "text-sub"}>
        {STATUS_LABELS[job.status]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sub">{job.file.name}</span>
      {job.status === "failed" ? (
        <>
          <span className="w-full text-sub">{job.error}</span>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Leave this one
          </Button>
        </>
      ) : null}
    </div>
  );
}

interface PanelEditorProps {
  index: number;
  count: number;
  panel: StoredPanel;
  job?: ArtJob;
  onChange: (change: Partial<StoredPanel>) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
  onPick: (file: File) => void;
  onRetry: () => void;
  onDismissJob: () => void;
}

export function PanelEditor({
  index,
  count,
  panel,
  job,
  onChange,
  onMove,
  onRemove,
  onPick,
  onRetry,
  onDismissJob,
}: PanelEditorProps) {
  const n = index + 1;
  const updateLine = (at: number, change: Partial<StoredPanel["dialogue"][number]>) =>
    onChange({ dialogue: panel.dialogue.map((d, i) => (i === at ? { ...d, ...change } : d)) });

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-1">
          <h3 className="mr-auto font-semibold text-text">Panel {n}</h3>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Move panel ${n} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Move panel ${n} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            size="icon"
            aria-label={`Remove panel ${n}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>

        {panelHasArt(panel) ? (
          // Plain <img>, as the reader does: the optimiser would add another
          // copy of the art to the download allowance.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={panelImageUrl(panel.pathSmall)}
            alt=""
            width={panel.width}
            height={panel.height}
            loading="lazy"
            className="h-auto w-full rounded-md border border-border"
          />
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-sub">
            No art yet.
          </p>
        )}
        {job ? <ArtJobRow job={job} onRetry={onRetry} onDismiss={onDismissJob} /> : null}
        <div className="flex flex-wrap items-end gap-2">
          <PickImages
            label={panelHasArt(panel) ? "Replace art" : "Choose art"}
            onPick={(files) => onPick(files[0])}
          />
          <Field label="Credit corner" className="min-w-40 flex-1">
            {(props) => (
              <select
                {...props}
                value={panel.creditCorner}
                onChange={(e) => onChange({ creditCorner: e.target.value as CreditCorner })}
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base pointer-fine:md:h-9 pointer-fine:md:text-sm"
              >
                {CREDIT_CORNERS.map((corner) => (
                  <option key={corner} value={corner}>
                    {CORNER_LABELS[corner]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {panelHasArt(panel) ? (
          <p className="text-sm text-sub">
            The credit is drawn into the picture, so a new corner needs the picture chosen again.
          </p>
        ) : null}

        <Field
          label="What this panel shows"
          hint="For people who can't see the art. Publishing needs this on every panel."
          required
        >
          {(props) => (
            <Textarea
              {...props}
              value={panel.alt}
              maxLength={STORY_LIMITS.alt}
              rows={3}
              onChange={(e) => onChange({ alt: e.target.value })}
            />
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text">Dialogue</legend>
          {panel.dialogue.map((d, at) => (
            <div key={at} className="flex flex-wrap items-start gap-2">
              <Input
                aria-label={`Panel ${n}, line ${at + 1}: speaker`}
                placeholder="Who says it"
                value={d.speaker}
                maxLength={STORY_LIMITS.speaker}
                className="w-full sm:w-40"
                onChange={(e) => updateLine(at, { speaker: e.target.value })}
              />
              <Textarea
                aria-label={`Panel ${n}, line ${at + 1}: words`}
                placeholder="What they say"
                value={d.line}
                maxLength={STORY_LIMITS.line}
                rows={2}
                className="min-w-0 flex-1 basis-40"
                onChange={(e) => updateLine(at, { line: e.target.value })}
              />
              <Button
                type="button"
                variant="danger-ghost"
                size="icon"
                aria-label={`Remove panel ${n}, line ${at + 1}`}
                onClick={() => onChange({ dialogue: panel.dialogue.filter((_, i) => i !== at) })}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={panel.dialogue.length >= STORY_LIMITS.dialogueLines}
            onClick={() => onChange({ dialogue: [...panel.dialogue, { speaker: "", line: "" }] })}
          >
            <Plus aria-hidden="true" />
            Add a line
          </Button>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text">Signs and screens</legend>
          {panel.signs.map((sign, at) => (
            <div key={at} className="flex items-center gap-2">
              <Input
                aria-label={`Panel ${n}, sign ${at + 1}`}
                value={sign}
                maxLength={STORY_LIMITS.sign}
                onChange={(e) =>
                  onChange({
                    signs: panel.signs.map((s, i) => (i === at ? e.target.value : s)),
                  })
                }
              />
              <Button
                type="button"
                variant="danger-ghost"
                size="icon"
                aria-label={`Remove panel ${n}, sign ${at + 1}`}
                onClick={() => onChange({ signs: panel.signs.filter((_, i) => i !== at) })}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={panel.signs.length >= STORY_LIMITS.signs}
            onClick={() => onChange({ signs: [...panel.signs, ""] })}
          >
            <Plus aria-hidden="true" />
            Add a sign
          </Button>
        </fieldset>

        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={panel.needsReview}
            className="size-5"
            onChange={(e) => onChange({ needsReview: e.target.checked })}
          />
          Still needs review
        </label>
      </CardContent>
    </Card>
  );
}
