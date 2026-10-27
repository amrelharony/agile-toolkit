"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { csatCategory, isReadableScore, npsCategory } from "@/lib/nps/score";
import { cn } from "@/lib/utils";
import { responseDraft, type ResponseValues } from "./form";
import { ResponseForm } from "./response-form";

const CATEGORY_TONE: Record<string, string> = {
  promoter: "text-success",
  satisfied: "text-success",
  passive: "text-warning",
  neutral: "text-warning",
  detractor: "text-danger",
  dissatisfied: "text-danger",
};

/** "Promoter", "Dissatisfied", or "Off the scale" for a score an old agent stored outside it. */
export function categoryOf(r: NpsResponse): string {
  if (!isReadableScore(r.kind, r.score)) return "Off the scale";
  const c = r.kind === "nps" ? npsCategory(r.score) : csatCategory(r.score);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** One line, cut to `max` characters with an ellipsis. */
function excerpt(s: string, max = 32): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * What a row's buttons call it: survey, score, day, and who answered or
 * how the verbatim starts ("NPS 9 of 2026-10-03, ana@x.io"). An import
 * puts many answers on one day, so the day alone named every button alike.
 */
export function responseName(r: NpsResponse): string {
  const day = typeof r.date === "string" && r.date ? r.date.slice(0, 10) : "no date";
  const who = r.respondent?.trim()
    ? `, ${excerpt(r.respondent)}`
    : r.verbatim?.trim()
      ? `, “${excerpt(r.verbatim)}”`
      : "";
  return `${r.kind === "csat" ? "CSAT" : "NPS"} ${r.score} of ${day}${who}`;
}

/** A row's delete button, where the page moves focus after a delete (the next row's). */
export const DELETE_SELECTOR = "[data-response-delete]";

/**
 * One response: day, survey, score and what it counts as, the respondent
 * and the whole verbatim (both shown; the old row showed the verbatim or
 * the respondent, cut to one line), and its tags, each a filter. Edit
 * turns the row into its form, in place.
 */
export function ResponseRow({
  response: r,
  today,
  onEdit,
  onDelete,
  onTag,
}: {
  response: NpsResponse;
  today: string;
  onEdit: (values: ResponseValues) => void;
  onDelete: () => void;
  /** Filter the page by a tag. */
  onTag: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    editRef.current?.focus();
  }, [editing]);
  const close = () => {
    refocus.current = true;
    setEditing(false);
  };
  const day = typeof r.date === "string" && r.date ? r.date.slice(0, 10) : "No date";
  const kind = r.kind === "csat" ? "CSAT" : "NPS";
  const category = categoryOf(r);
  const name = responseName(r);

  if (editing) {
    return (
      <li className="rounded-lg border border-accent/40 bg-surface p-3">
        <ResponseForm
          initial={responseDraft(r)}
          today={today}
          keepScore={r.score}
          keepKind={r.kind === "csat" ? "csat" : "nps"}
          keepRespondent={r.respondent}
          keepVerbatim={r.verbatim}
          autoFocus
          submitLabel="Save response"
          onSave={(values) => {
            onEdit(values);
            close();
          }}
          onCancel={close}
        />
      </li>
    );
  }

  return (
    <li className="space-y-1.5 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-data text-xs text-sub">{day}</span>
        <span className="text-xs font-medium uppercase tracking-wider text-accent">{kind}</span>
        <span className="font-data text-sm text-text">{r.score}</span>
        <span className={cn("text-xs", CATEGORY_TONE[category.toLowerCase()] ?? "text-sub")}>
          {category}
        </span>
        {r.respondent && (
          <span className="min-w-0 break-words text-xs text-sub">{r.respondent}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <IconButton
            ref={editRef}
            label={`Edit ${name}`}
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => setEditing(true)}
            className="text-sub hover:text-text"
          />
          <IconButton
            label={`Remove ${name}`}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={onDelete}
            className="text-sub hover:text-danger"
            data-response-delete=""
          />
        </span>
      </div>
      {r.verbatim && (
        <p className="whitespace-pre-line break-words text-sm text-text">“{r.verbatim}”</p>
      )}
      {(r.tags ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {(r.tags ?? []).map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => onTag(t)}
                className="min-touch-coarse rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Show only responses tagged ${t}`}
              >
                <Badge variant="outline" className="text-xs">
                  {t}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
