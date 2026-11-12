"use client";

/**
 * Backlog Health's pieces: a DEEP check's card, the settings, and one
 * story's row with its flags, points, details (criteria both ways), split
 * suggestions and Drop.
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Scissors, Trash2 } from "lucide-react";
import { AiSuggestions } from "@/components/ai";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { StoryDetailsPanel } from "@/components/stories/story-details";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Story, StoryGwt } from "@/lib/stores/workspace-types";
import { storyPoints } from "@/lib/sprints/plan";
import type { StoryDetails } from "@/lib/stories/fields";
import {
  STORY_FLAG_LABEL,
  splitPatternsFor,
  splitTitles,
  type DeepCheck,
  type StoryHealth,
} from "@/lib/backlog/health";
import { cn } from "@/lib/utils";
import {
  settingsDraft,
  validatePoints,
  validateSettings,
  type HealthSettings,
  type SettingsDraft,
} from "./store";

/** One of the four checks: its share as a bar and its reasons. */
export function CheckCard({ check }: { check: DeepCheck }) {
  const pct = check.score === null ? null : Math.round(check.score * 100);
  const tone =
    pct === null ? "bg-sub" : pct >= 80 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
  return (
    <li data-check={check.id} className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{check.label}</h3>
        <span className="font-data text-sm text-text">{pct === null ? "—" : `${pct}%`}</span>
      </div>
      {pct !== null && (
        <div
          role="progressbar"
          aria-label={check.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-2 h-2 w-full overflow-hidden rounded-full border border-border bg-surface"
        >
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="mt-2 space-y-1 text-xs text-sub">
        {check.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </li>
  );
}

/** What counts as the top, too big and stale. */
export function SettingsForm({
  settings,
  onSave,
}: {
  settings: HealthSettings;
  onSave: (s: HealthSettings) => void;
}) {
  const form = useItemForm<SettingsDraft, HealthSettings, keyof HealthSettings>({
    initial: () => settingsDraft(settings),
    validate: validateSettings,
    onSave,
    resetOnSave: false,
  });
  const fields: { key: keyof HealthSettings; label: string; unit: string }[] = [
    { key: "topN", label: "The top of the backlog", unit: "stories" },
    { key: "tooBigPoints", label: "Too big above", unit: "points" },
    { key: "staleWeeks", label: "Stale after", unit: "weeks" },
  ];
  return (
    <ItemForm form={form} submitLabel="Save the settings" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.unit} error={form.errors[f.key]}>
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form.draft[f.key]}
                onChange={(e) => form.update({ [f.key]: e.target.value } as Partial<SettingsDraft>)}
              />
            )}
          </Field>
        ))}
      </div>
    </ItemForm>
  );
}

/** A story's points, saved on blur or Enter; a bad value says why and stays. */
function PointsField({
  story,
  onSave,
}: {
  story: Story;
  onSave: (points: number | undefined) => void;
}) {
  const shown = storyPoints(story) > 0 ? String(story.points) : "";
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  const errorId = useId();
  useEffect(() => {
    setDraft(shown);
    setError(undefined);
  }, [shown]);
  const commit = () => {
    const v = validatePoints(draft);
    if (!v.ok) {
      setError(v.errors.points);
      return;
    }
    setError(undefined);
    if (
      (v.values ?? 0) !== storyPoints(story) ||
      (v.values === undefined && story.points !== undefined)
    ) {
      onSave(v.values);
    }
  };
  return (
    <div className="w-24 shrink-0">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        aria-label={`Points for ${story.title}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Points"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface StoryRowProps {
  row: StoryHealth;
  onPoints: (story: Story, points: number | undefined) => void;
  onDetails: (story: Story, details: StoryDetails) => void;
  onGwt: (story: Story, gwt: StoryGwt[]) => void;
  onSplit: (story: Story, titles: string[]) => void;
  onDrop: (story: Story) => void;
}

export function StoryRow({ row, onPoints, onDetails, onGwt, onSplit, onDrop }: StoryRowProps) {
  const { story, flags, place } = row;
  const [open, setOpen] = useState<"details" | "split" | null>(null);
  const panelId = useId();
  const detailsButton = useRef<HTMLButtonElement>(null);
  const tooBig = flags.some((f) => f.id === "too-big");
  const splits = open === "split" ? splitPatternsFor(story.title) : [];
  const toggle = (which: "details" | "split") => setOpen((o) => (o === which ? null : which));

  return (
    <li className="px-3 py-3" data-story={story.id}>
      <div className="flex items-start gap-3">
        <span className="mt-2 w-6 shrink-0 text-right font-data text-xs text-sub">
          <span className="sr-only">Place </span>
          {place}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-text">{story.title}</p>
          {flags.length > 0 ? (
            <ul className="mt-1 space-y-0.5" aria-label={`Flags on ${story.title}`}>
              {flags.map((f) => (
                <li key={f.id} className="text-xs">
                  <span className="font-semibold text-warning">{STORY_FLAG_LABEL[f.id]}</span>
                  <span className="text-sub">: {f.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-sub">No flags.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              ref={detailsButton}
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={open === "details"}
              aria-controls={open === "details" ? panelId : undefined}
              onClick={() => toggle("details")}
            >
              <ChevronDown
                className={cn(
                  "mr-1 h-4 w-4 transition-transform",
                  open === "details" && "rotate-180"
                )}
                aria-hidden="true"
              />
              Criteria and details
            </Button>
            {tooBig && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-expanded={open === "split"}
                onClick={() => toggle("split")}
              >
                <Scissors className="mr-1 h-4 w-4" aria-hidden="true" />
                Split it
              </Button>
            )}
            <IconButton
              label={`Drop “${story.title.length > 40 ? `${story.title.slice(0, 39)}…` : story.title}”`}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              onClick={() => onDrop(story)}
            />
          </div>
        </div>
        <PointsField story={story} onSave={(p) => onPoints(story, p)} />
      </div>
      {open === "details" && (
        <StoryDetailsPanel
          id={panelId}
          story={story}
          onSave={(d) => onDetails(story, d)}
          onSaveGwt={(g) => onGwt(story, g)}
          className="mt-3 rounded-lg border border-border bg-surface/40 p-3 sm:ml-9"
        />
      )}
      {open === "split" && (
        <div className="mt-3 space-y-2 sm:ml-9">
          {splits.map((p) => (
            <AiSuggestions
              key={p.id}
              items={splitTitles(story.title, p.id)}
              source="fallback"
              title={`Split by ${p.name.toLowerCase()}: ${p.how}`}
              acceptLabel="Add"
              onAccept={(title) => onSplit(story, [title])}
              onAcceptAll={(titles) => onSplit(story, titles)}
              onDismiss={() => setOpen(null)}
            />
          ))}
          <p className="text-xs text-sub">
            Each title becomes a backlog story; edit it, then drop the big one when the team agrees.
            More ways to split are in{" "}
            <Link href="/refinement" className="text-accent hover:underline">
              Refinement
            </Link>
            .
          </p>
        </div>
      )}
    </li>
  );
}
