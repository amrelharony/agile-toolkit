"use client";

import { Pencil, Save, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ScalePicker } from "@/components/shared/scale-picker";
import { cn } from "@/lib/utils";
import {
  MEETING_VERDICTS,
  type MeetingAudit,
  type MeetingVerdict,
} from "@/lib/stores/workspace-types";
import {
  AUDIT_QUESTIONS,
  AUDIT_QUESTION_IDS,
  CADENCE_LABEL,
  LOW_RATING,
  RATING_SCALE,
  VERDICT_LABEL,
  draftOf,
  meetingScore,
  ratedCount,
  ratingOf,
  weeklyHours,
  weeklyText,
  type MeetingValues,
} from "@/lib/meeting-audit/model";
import { MeetingForm } from "./meeting-form";

const VERDICT_TONE: Record<MeetingVerdict, string> = {
  keep: "border-success/40 text-success",
  change: "border-warning/40 text-warning",
  drop: "border-danger/40 text-danger",
};

/** A meeting's name, short enough for a button's name. */
export function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "Rated 3.4 on average, 5 of 5 questions", or "Not rated yet". */
export function ratingText(a: Pick<MeetingAudit, "ratings">): string {
  const n = ratedCount(a);
  const score = meetingScore(a);
  if (n === 0 || score === null) return "Not rated yet";
  return `Rated ${Math.round(score * 10) / 10} on average, ${n} of ${AUDIT_QUESTION_IDS.length} questions`;
}

export interface MeetingCardProps {
  audit: MeetingAudit;
  rating: boolean;
  editing: boolean;
  onRate: (a: MeetingAudit, questionId: string, value: number | null) => void;
  onToggleRating: (a: MeetingAudit | null) => void;
  onVerdict: (a: MeetingAudit, verdict: MeetingVerdict | null) => void;
  onEdit: (a: MeetingAudit | null) => void;
  onSave: (a: MeetingAudit, values: MeetingValues) => void;
  onDelete: (a: MeetingAudit) => void;
}

/**
 * One recurring meeting: what it costs a week, its purpose, the team's
 * ratings (in a panel opened one meeting at a time, so each question's
 * group is named once on the page), its verdict and the notes on what to
 * change. Edited in place; deleted with Undo.
 */
export function MeetingCard({
  audit: a,
  rating,
  editing,
  onRate,
  onToggleRating,
  onVerdict,
  onEdit,
  onSave,
  onDelete,
}: MeetingCardProps) {
  const name = shortName(a.meeting);
  const lows = AUDIT_QUESTIONS.filter((q) => {
    const v = ratingOf(a, q.id);
    return v !== null && v <= LOW_RATING;
  });
  if (editing) {
    return (
      <li id={`meeting-${a.id}`} className="rounded-lg border border-border bg-card p-3">
        <MeetingForm
          initial={draftOf(a)}
          submitLabel="Save"
          submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          withNotes
          autoFocus
          onSave={(values) => onSave(a, values)}
          onCancel={() => onEdit(null)}
        />
      </li>
    );
  }
  return (
    <li id={`meeting-${a.id}`} className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3
          data-meeting-name={a.id}
          tabIndex={-1}
          className="min-w-0 break-words rounded-sm text-sm font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {a.meeting}
        </h3>
        {a.verdict && (
          <Badge variant="outline" className={cn("shrink-0", VERDICT_TONE[a.verdict])}>
            {VERDICT_LABEL[a.verdict]}
          </Badge>
        )}
      </div>
      <p className="text-xs text-sub">
        {CADENCE_LABEL[a.cadence]} · {a.minutes} min · {a.attendees}{" "}
        {a.attendees === 1 ? "person" : "people"} ·{" "}
        <span className="font-medium text-text">{weeklyText(weeklyHours(a))}</span>
      </p>
      {a.purpose.trim() && <p className="break-words text-sm text-text">{a.purpose}</p>}
      <p className="text-xs text-sub">
        {ratingText(a)}
        {lows.length > 0 && <> · low on {lows.map((q) => q.label.toLowerCase()).join(", ")}</>}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-sub" aria-hidden="true">
          Verdict
        </span>
        <ToggleGroup<MeetingVerdict>
          label={`Verdict for ${name}`}
          size="sm"
          value={a.verdict ?? null}
          onValueChange={(v) => onVerdict(a, v)}
          options={MEETING_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] }))}
        />
        {a.verdict && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Clear the verdict for ${name}`}
            onClick={() => onVerdict(a, null)}
          >
            Clear
          </Button>
        )}
      </div>

      {a.notes?.trim() && (
        <div className="rounded-md border border-border bg-surface px-2 py-1.5">
          <p className="text-xs font-medium text-sub">What to change</p>
          <p className="whitespace-pre-line break-words text-sm text-text">{a.notes}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-expanded={rating}
          aria-controls={`meeting-rate-${a.id}`}
          aria-label={`${rating ? "Close the ratings" : "Rate"}: ${name}`}
          onClick={() => onToggleRating(rating ? null : a)}
        >
          <Star aria-hidden="true" />
          {rating ? "Close the ratings" : "Rate"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label={`Edit: ${name}`}
          onClick={() => onEdit(a)}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sub hover:text-danger"
          aria-label={`Delete: ${name}`}
          onClick={() => onDelete(a)}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      </div>

      {rating && (
        <div
          id={`meeting-rate-${a.id}`}
          className="space-y-3 rounded-md border border-border bg-surface p-3"
        >
          <p className="text-xs text-sub">
            Rate it with the team: 1 is not at all, 5 is always. Each rating saves as you pick it.
          </p>
          {AUDIT_QUESTIONS.map((q) => (
            <ScalePicker
              key={q.id}
              label={q.label}
              hint={q.question}
              size="sm"
              steps={RATING_SCALE}
              value={ratingOf(a, q.id)}
              onValueChange={(v) => onRate(a, q.id, v)}
              onClear={() => onRate(a, q.id, null)}
              optionsClassName="grid grid-cols-5 sm:inline-flex"
            />
          ))}
        </div>
      )}
    </li>
  );
}
