"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneCall, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { cn } from "@/lib/utils";
import {
  QUADRANTS,
  QUADRANT_CENTRE,
  QUADRANT_LABEL,
  SENTIMENTS,
  SENTIMENT_LABEL,
  gapText,
  isIsoDay,
  isPlaced,
  sentimentGap,
  touchStatus,
  type Quadrant,
  type Sentiment,
  type Stakeholder,
  type TouchStatus,
} from "./model";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const TOUCH_LABEL: Record<TouchStatus, string> = {
  overdue: "Touch overdue",
  "due-soon": "Touch due this week",
  scheduled: "Touch planned",
  none: "No touch planned",
};
const TOUCH_TONE: Record<TouchStatus, string> = {
  overdue: "border-danger/40 bg-danger/10 text-danger",
  "due-soon": "border-warning/40 bg-warning/10 text-warning",
  scheduled: "border-border bg-card text-sub",
  none: "border-border bg-card text-sub",
};

/** A name edited in place: an emptied one goes back rather than saving a blank. */
function NameField({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      maxLength={80}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={() => {
        const next = draft.replace(/\s+/g, " ").trim();
        if (!next) setDraft(value);
        else if (next !== value) onCommit(next);
      }}
      className="bg-bg border-border font-semibold"
    />
  );
}

/** A 0–10 slider that saves once, when it's let go (not per step). */
function ScoreSlider({
  value,
  onCommit,
  label,
  name,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  name: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium leading-none text-sub">{label}</span>
        <span className="text-xs font-data text-text">{draft}/10</span>
      </div>
      <Slider
        min={0}
        max={10}
        step={1}
        value={[draft]}
        onValueChange={(v) => setDraft(v[0] ?? draft)}
        onValueCommit={(v) => onCommit(v[0] ?? draft)}
        className="mt-2"
        aria-label={`${label} for ${name}`}
        thumbProps={{ "aria-valuetext": `${draft} of 10` }}
      />
    </div>
  );
}

function SentimentSelect({
  value,
  onChange,
  label,
}: {
  value: Sentiment | null;
  onChange: (v: Sentiment | null) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Sentiment | null)}
      className={SELECT_CLASS}
    >
      <option value="">Not set</option>
      {SENTIMENTS.map((s) => (
        <option key={s} value={s}>
          {SENTIMENT_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/**
 * One stakeholder, edited in place: name and role, where they sit (sliders
 * once placed; "Place in…" until then), how they feel now and how you need
 * them to, when you last spoke and when you'll next reach out ("Contacted
 * today" logs it), and the plan.
 */
export function StakeholderRow({
  stakeholder: s,
  today,
  onPatch,
  onPlace,
  onRemove,
}: {
  stakeholder: Stakeholder;
  today: string;
  onPatch: (patch: Partial<Stakeholder>) => void;
  /** Place them from "Place in…" (saved and announced as the map's picker is). */
  onPlace: (at: { interest: number; authority: number }) => void;
  onRemove: () => void;
}) {
  const gap = sentimentGap(s);
  const touch = touchStatus(s, today);
  // "Place in…" gives way to the sliders, and the focused select goes with
  // it: focus moves on to the Interest slider.
  const slidersRef = useRef<HTMLDivElement>(null);
  const focusSliders = useRef(false);
  const placed = isPlaced(s);
  useEffect(() => {
    if (!placed || !focusSliders.current) return;
    focusSliders.current = false;
    slidersRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
  }, [placed]);
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <NameField
              value={s.name}
              label={`Name of ${s.name}`}
              onCommit={(name) => onPatch({ name })}
            />
            <BlurInput
              value={s.role ?? ""}
              onCommit={(v) => onPatch({ role: v.trim() || undefined })}
              placeholder="Role (optional)"
              className="bg-bg border-border text-xs"
              aria-label={`Role for ${s.name}`}
            />
          </div>
          <IconButton
            label={`Remove ${s.name}`}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            className="h-8 w-8 text-sub hover:text-danger"
            onClick={onRemove}
          />
        </div>

        {placed ? (
          <div ref={slidersRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ScoreSlider
              label="Interest"
              name={s.name}
              value={s.interest as number}
              onCommit={(interest) => onPatch({ interest })}
            />
            <ScoreSlider
              label="Authority"
              name={s.name}
              value={s.authority as number}
              onCommit={(authority) => onPatch({ authority })}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
            <span>Not placed yet.</span>
            <select
              aria-label={`Place ${s.name} in`}
              value=""
              onChange={(e) => {
                const q = e.target.value as Quadrant;
                if (!q) return;
                focusSliders.current = true;
                onPlace(QUADRANT_CENTRE[q]);
              }}
              className={SELECT_CLASS}
            >
              <option value="">Place in…</option>
              {QUADRANTS.map((q) => (
                <option key={q} value={q}>
                  {QUADRANT_LABEL[q]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
          <span>Now</span>
          <SentimentSelect
            label={`Current sentiment for ${s.name}`}
            value={s.currentSentiment}
            onChange={(currentSentiment) => onPatch({ currentSentiment })}
          />
          <span aria-hidden="true">→</span>
          <span>Need</span>
          <SentimentSelect
            label={`Desired sentiment for ${s.name}`}
            value={s.desiredSentiment}
            onChange={(desiredSentiment) => onPatch({ desiredSentiment })}
          />
          {gap !== null && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5",
                gap > 0
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-success/40 bg-success/10 text-success"
              )}
            >
              {gapText(gap)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
          <label className="inline-flex items-center gap-1.5">
            Last contact
            <Input
              type="date"
              value={s.lastContactAt ?? ""}
              max={today}
              aria-label={`Last contact with ${s.name}`}
              onChange={(e) => {
                const day = e.target.value;
                // Backdatable, or cleared; a day after today hasn't happened.
                if (isIsoDay(day) && day > today) return;
                onPatch({ lastContactAt: isIsoDay(day) ? day : undefined });
              }}
              className="h-8 w-auto border-border bg-bg text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1.5">
            Next touch
            <Input
              type="date"
              value={s.nextTouchAt ?? ""}
              aria-label={`Next touch with ${s.name}`}
              onChange={(e) =>
                onPatch({ nextTouchAt: isIsoDay(e.target.value) ? e.target.value : undefined })
              }
              className="h-8 w-auto border-border bg-bg text-xs"
            />
          </label>
          <span className={cn("rounded-full border px-2 py-0.5", TOUCH_TONE[touch])}>
            {TOUCH_LABEL[touch]}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            aria-label={`Contacted ${s.name} today`}
            onClick={() =>
              onPatch({
                lastContactAt: today,
                // A touch that was due is done; a later one stays planned.
                ...(s.nextTouchAt && s.nextTouchAt <= today ? { nextTouchAt: undefined } : {}),
              })
            }
          >
            <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />
            Contacted today
          </Button>
        </div>

        <BlurTextarea
          value={s.strategy ?? ""}
          onCommit={(v) => onPatch({ strategy: v.trim() || undefined })}
          placeholder="Engagement strategy..."
          rows={2}
          className="bg-bg border-border text-sm resize-none"
          aria-label={`Engagement strategy for ${s.name}`}
        />
        <BlurTextarea
          value={s.description ?? ""}
          onCommit={(v) => onPatch({ description: v.trim() || undefined })}
          placeholder="Description (optional)..."
          rows={2}
          className="bg-bg border-border text-xs resize-none"
          aria-label={`Description for ${s.name}`}
        />
      </CardContent>
    </Card>
  );
}
