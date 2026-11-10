"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CEREMONY_HREF,
  CEREMONY_LABEL,
  ceremonyTimeboxMinutes,
  timeboxLabel,
  whenLabel,
  type CeremonyCadence,
  type CeremonyOccurrence,
} from "@/lib/sprints/cadence";
import { cn } from "@/lib/utils";
import { CadenceForm } from "@/components/sprints/cadence-form";

/**
 * "Next ceremony": the next one or two events from the team's cadence, the
 * first with its timebox for a sprint this long, the form that sets the
 * times tucked under it, and whatever the page adds below (the cockpit's
 * "Add to calendar").
 */
export function NextCeremony({
  occurrences,
  now,
  ended,
  cadence,
  sprintLengthDays,
  onCadence,
  children,
}: {
  occurrences: CeremonyOccurrence[];
  now: Date;
  /** The sprint's last day has passed. */
  ended: boolean;
  cadence: CeremonyCadence;
  /** The sprint's length in days, which sets the planning, review and retro timeboxes. */
  sprintLengthDays: number;
  /** Absent in a read-only preview. */
  onCadence?: (patch: Partial<CeremonyCadence>) => void;
  /** A row under the ceremony and its form, inside the card. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [first, second] = occurrences;

  return (
    <section
      aria-label="Next ceremony"
      className="rounded-lg border border-border bg-card p-4"
      data-chrome="next-ceremony"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-sub">Next ceremony</p>
            {first ? (
              <>
                <p className="text-base font-semibold text-text">
                  <Link href={CEREMONY_HREF[first.kind]} className="hover:text-accent">
                    {CEREMONY_LABEL[first.kind]}
                  </Link>{" "}
                  <span className="font-normal text-sub">
                    · {whenLabel(first.at, now)} ·{" "}
                    {timeboxLabel(ceremonyTimeboxMinutes(first.kind, sprintLengthDays))}
                  </span>
                </p>
                {second && (
                  <p className="text-sm text-sub">
                    then {CEREMONY_LABEL[second.kind]} · {whenLabel(second.at, now)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-text">
                {ended
                  ? "This sprint is over — close it and plan the next one."
                  : "No more ceremonies in this sprint."}
              </p>
            )}
          </div>
        </div>
        {onCadence && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={open ? formId : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            <Settings2 className="mr-1 h-4 w-4" aria-hidden="true" />
            Ceremony times
            <ChevronDown
              className={cn("ml-1 h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
      {onCadence && open && (
        <div id={formId} className="mt-4 border-t border-border pt-4">
          <CadenceForm cadence={cadence} onChange={onCadence} />
        </div>
      )}
      {children && <div className="mt-4 border-t border-border pt-4">{children}</div>}
    </section>
  );
}
