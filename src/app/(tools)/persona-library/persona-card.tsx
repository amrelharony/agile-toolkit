"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import type {
  Persona,
  PersonaEvidence,
  PersonaTier,
  StrategyMap,
} from "@/lib/stores/workspace-types";
import {
  EVIDENCE_LABEL,
  LIST_LABEL,
  PERSONA_LISTS,
  TIER_LABEL,
  initialOf,
} from "@/lib/personas/model";
import { cn } from "@/lib/utils";

/** The badge's theme tone by tier: no photos, only the name's initial. */
const TIER_TONE: Record<PersonaTier, string> = {
  primary: "bg-accent/20 text-accent",
  secondary: "bg-info/20 text-info",
  anti: "bg-danger/20 text-danger",
};

const EVIDENCE_TONE: Record<PersonaEvidence, string> = {
  assumed: "border-warning/40 text-warning",
  some: "border-info/40 text-info",
  researched: "border-success/40 text-success",
};

/** One persona: badge, name, role, chips, lists, quote, context, tags and where it is used. */
export function PersonaCard({
  persona: p,
  usedOn,
  basedOn,
  highlighted,
  onEdit,
  onRemove,
}: {
  persona: Persona;
  /** The impact maps whose actors are this persona. */
  usedOn: readonly StrategyMap[];
  /** How many of its linked interviews are still in the log. */
  basedOn: number;
  /** Opened from a `?persona=` link. */
  highlighted: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const headingId = `persona-${p.id}`;
  return (
    <article
      aria-labelledby={headingId}
      tabIndex={-1}
      data-persona-card={p.id}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        highlighted ? "border-accent" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-lg font-semibold",
            TIER_TONE[p.tier]
          )}
        >
          {initialOf(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="break-words text-base font-semibold text-text">
            {p.name}
          </h3>
          <p className="break-words text-sm text-sub">{p.role || "Role to confirm"}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text">
              {TIER_LABEL[p.tier]}
            </span>
            <span
              className={cn("rounded-full border px-2 py-0.5 text-xs", EVIDENCE_TONE[p.evidence])}
            >
              {EVIDENCE_LABEL[p.evidence]}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={`Edit ${p.name}`}
            data-focus-key={`edit:${p.id}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={onEdit}
          />
          <IconButton
            label={`Delete ${p.name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={onRemove}
          />
        </div>
      </div>

      {p.summary && (
        <p className="whitespace-pre-wrap break-words text-sm text-text">{p.summary}</p>
      )}

      {PERSONA_LISTS.map((list) =>
        p[list].length > 0 ? (
          <div key={list}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-sub">
              {LIST_LABEL[list]}
            </h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text">
              {p[list].map((item) => (
                <li key={item} className="break-words">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      )}

      {p.quote && (
        <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text">
          “{p.quote}”
        </blockquote>
      )}
      {p.context && (
        <p className="whitespace-pre-wrap break-words text-xs text-sub">
          <span className="font-medium text-text">Context: </span>
          {p.context}
        </p>
      )}
      {p.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Tags for ${p.name}`}>
          {p.tags.map((t) => (
            <li key={t} className="rounded bg-surface-deep px-1.5 py-0.5 text-xs text-sub">
              {t}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-sub">
        {usedOn.length === 0 ? (
          <span>Not on an Impact Map yet</span>
        ) : (
          <span>
            Used on {usedOn.length === 1 ? "1 Impact Map" : `${usedOn.length} Impact Maps`}:{" "}
            {usedOn.map((m, i) => (
              <span key={m.id}>
                {i > 0 && ", "}
                <Link
                  href={`/impact-map?map=${encodeURIComponent(m.id)}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {m.title}
                </Link>
              </span>
            ))}
          </span>
        )}
        {basedOn > 0 && (
          <span>Based on {basedOn === 1 ? "1 interview" : `${basedOn} interviews`}</span>
        )}
      </div>
    </article>
  );
}
