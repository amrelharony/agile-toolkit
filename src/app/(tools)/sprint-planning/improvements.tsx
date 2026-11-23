"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOUCH_LINK } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import {
  actionMeta,
  addMode,
  impedimentMeta,
  impedimentOverdue,
  improvementsHeading,
  placeText,
  type Improvements,
  type PlannedAction,
  type PlannedImpediment,
  type StoryPlace,
} from "./view";

const LINK = cn(
  "inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline",
  TOUCH_LINK
);

/**
 * One thing to improve: what it is, who has it, and either "Add to this
 * sprint" or where its story already is. Pressing the button swaps it for
 * that status, which takes focus so the keyboard keeps its place in the list.
 */
function Row({
  title,
  meta,
  overdue,
  place,
  cantAdd,
  onAdd,
}: {
  title: string;
  meta: string;
  overdue: boolean;
  place: StoryPlace;
  /** Why nothing can be added (the sprint is closed), if it can't. */
  cantAdd?: string;
  onAdd: () => void;
}) {
  const mode = addMode(place);
  const where = placeText(place);
  const status = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);
  // The button went with the press: land on what replaced it.
  useEffect(() => {
    if (!pressed.current || mode !== null) return;
    pressed.current = false;
    status.current?.focus();
  }, [mode]);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm text-text">{title}</p>
        <p className="text-xs text-sub">
          {overdue && <span className="font-medium text-warning">Overdue · </span>}
          {meta}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {where && (
          <span
            ref={status}
            tabIndex={-1}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              place.where === "sprint" ? "text-text" : "text-sub"
            )}
          >
            {place.where === "sprint" && (
              <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            )}
            {where}
          </span>
        )}
        {mode !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cantAdd !== undefined}
            title={cantAdd}
            // Rows repeat the button, so its name says which one (and starts
            // with the visible text).
            aria-label={`Add to this sprint: ${title}`}
            onClick={() => {
              pressed.current = true;
              onAdd();
            }}
          >
            Add to this sprint
          </Button>
        )}
      </div>
    </li>
  );
}

const LIST = "divide-y divide-border rounded-lg border border-border bg-card";

/**
 * "From the last retro": the retro's open actions and the open impediments,
 * each with "Add to this sprint". Adding makes a story in the sprint that
 * links back; a retro action then closes when its story is done, and an
 * impediment stays open until it is resolved in Impediments. One already
 * sent to the backlog as a story is moved in instead of being made twice.
 */
export function ImprovementsPanel({
  improvements,
  today,
  cantAdd,
  onAddAction,
  onAddImpediment,
}: {
  improvements: Improvements;
  /** YYYY-MM-DD, local: for an impediment's age. */
  today: string;
  /** Why nothing can be added (the sprint is closed), if it can't. */
  cantAdd?: string;
  onAddAction: (row: PlannedAction) => void;
  onAddImpediment: (row: PlannedImpediment) => void;
}) {
  const headingId = useId();
  const actionsId = useId();
  const impedimentsId = useId();
  const { actions, impediments, earlierOpen, retroLabel } = improvements;
  const heading = improvementsHeading(improvements);

  return (
    <section
      aria-labelledby={headingId}
      data-improvements=""
      className="rounded-lg border border-accent/30 bg-accent/5 p-3"
    >
      <h3 id={headingId} className="flex items-start gap-1.5 text-sm font-semibold text-text">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span>
          {heading.lead}: <span className="font-normal text-sub">{heading.counts}</span>
        </span>
      </h3>
      <p className="mt-1 text-xs text-sub">
        Add one and it becomes a story in this sprint. A retro action closes when its story is done.
        An impediment stays open until you resolve it in Impediments.
      </p>

      {actions.length > 0 && (
        <div className="mt-3">
          <h4 id={actionsId} className="mb-1.5 text-xs font-medium text-sub">
            Retro actions{retroLabel ? ` · ${retroLabel}` : ""}
          </h4>
          <ul aria-labelledby={actionsId} className={LIST}>
            {actions.map((row) => (
              <Row
                key={row.action.id}
                title={row.action.text}
                meta={actionMeta(row.action)}
                overdue={row.action.overdue}
                place={row.place}
                cantAdd={cantAdd}
                onAdd={() => onAddAction(row)}
              />
            ))}
          </ul>
        </div>
      )}
      {earlierOpen > 0 && (
        <p className="mt-2 text-xs text-sub">
          {earlierOpen === 1
            ? "1 more open action is from an earlier retro. Retro Actions lists it."
            : `${earlierOpen} more open actions are from earlier retros. Retro Actions lists them.`}
        </p>
      )}

      {impediments.length > 0 && (
        <div className="mt-3">
          <h4 id={impedimentsId} className="mb-1.5 text-xs font-medium text-sub">
            Open impediments
          </h4>
          <ul aria-labelledby={impedimentsId} className={LIST}>
            {impediments.map((row) => (
              <Row
                key={row.impediment.id}
                title={row.impediment.title}
                meta={impedimentMeta(row.impediment, today)}
                overdue={impedimentOverdue(row.impediment, today)}
                place={row.place}
                cantAdd={cantAdd}
                onAdd={() => onAddImpediment(row)}
              />
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/retro-actions" className={LINK}>
          Retro Actions
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link href="/impediments" className={LINK}>
          Impediments
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
