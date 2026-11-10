"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlash } from "@/hooks/use-flash";
import type { Sprint } from "@/lib/stores/workspace-types";
import { ceremonyDates, type CeremonyCadence } from "@/lib/sprints/cadence";
import {
  CEREMONY_REMINDER_MINUTES,
  calendarActions,
  sprintCalendar,
  type CalendarAction,
} from "@/lib/sprints/ics";
import { exportToICS } from "@/lib/utils/export";

/** A checkbox and its words: the whole label is the 44px target on touch. */
const OPTION_LABEL =
  "inline-flex items-start gap-2 text-sm text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center";

/**
 * "Add to calendar": the sprint's ceremonies as a calendar file, built in
 * the browser (lib/sprints/ics) and saved on click. Two options sit beside
 * it: the open retro actions on their due dates (on when there are any) and
 * the weekly Agile at Work story (off). Without a sprint, or for one with no
 * dates, the button is disabled and the line beside it says why.
 */
export function AddToCalendar({
  sprint,
  cadence,
  actions,
  place,
}: {
  /** The sprint whose ceremonies go in the file. Absent: the team has no sprint yet. */
  sprint: Sprint | undefined;
  cadence: CeremonyCadence;
  /** The team's retro actions: the open ones with a due date can go in the file. */
  actions: readonly CalendarAction[];
  /** Where this sits, for the way to a sprint's dates: the cockpit edits them in place. */
  place: "cockpit" | "team";
}) {
  const noteId = useId();
  const { flash, flashing } = useFlash();
  const ceremonies = useMemo(
    () => (sprint ? ceremonyDates(sprint, cadence).length : 0),
    [sprint, cadence]
  );
  const due = useMemo(() => calendarActions(actions).length, [actions]);
  // Until it is clicked, the actions' box is ticked when there is one to add.
  const [actionsChoice, setActionsChoice] = useState<boolean | null>(null);
  const withActions = due > 0 && (actionsChoice ?? true);
  const [withStory, setWithStory] = useState(false);
  const ready = sprint !== undefined && ceremonies > 0;

  const download = () => {
    if (!sprint) return;
    const calendar = sprintCalendar({
      sprint,
      cadence,
      now: new Date(),
      origin: window.location.origin,
      actions: withActions ? actions : [],
      weeklyStory: withStory,
    });
    if (!calendar) return;
    exportToICS(calendar.ics, calendar.filename);
    flash("Calendar file downloaded");
  };

  const cockpitLink = (
    <Link href="/sprint" className="font-medium text-accent hover:underline">
      Sprint Cockpit
    </Link>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!ready}
          aria-describedby={noteId}
          onClick={download}
        >
          {flashing ? <Check aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
          {flashing ? "Downloaded" : "Add to calendar"}
        </Button>
        <p id={noteId} className="min-w-0 flex-1 basis-60 break-words text-sm text-sub">
          {ready ? (
            <>
              Downloads a calendar file with the {ceremonies} ceremonies of {sprint.name}, each with
              a reminder {CEREMONY_REMINDER_MINUTES} minutes before. Open the file to add them to
              your calendar.
            </>
          ) : !sprint ? (
            <>
              There is no sprint yet, so there are no ceremonies to add. Create one in the{" "}
              {cockpitLink}.
            </>
          ) : place === "cockpit" ? (
            <>
              {sprint.name} has no dates, so its ceremonies can&rsquo;t go on a calendar. Click Edit
              details and set its first and last day.
            </>
          ) : (
            <>
              {sprint.name} has no dates, so its ceremonies can&rsquo;t go on a calendar. Set its
              first and last day in the {cockpitLink}.
            </>
          )}
        </p>
      </div>
      {ready && (
        <>
          <fieldset>
            <legend className="text-sm font-medium text-text">Also put in the file</legend>
            <div className="mt-1.5 flex flex-col items-start gap-1.5 pointer-coarse:mt-0 pointer-coarse:gap-0">
              <label className={OPTION_LABEL}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] pointer-coarse:mt-0"
                  checked={withActions}
                  disabled={due === 0}
                  onChange={(e) => setActionsChoice(e.target.checked)}
                />
                <span>
                  Open retro actions, as all-day entries on their due dates{" "}
                  <span className="text-sub">
                    {due === 0 ? "(no open action has a due date)" : `(${due} with a due date)`}
                  </span>
                </span>
              </label>
              <label className={OPTION_LABEL}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] pointer-coarse:mt-0"
                  checked={withStory}
                  onChange={(e) => setWithStory(e.target.checked)}
                />
                <span>The new Agile at Work story, as a weekly entry on Sundays</span>
              </label>
            </div>
          </fieldset>
          <p className="text-xs text-sub">
            The file is a snapshot. It does not change when the ceremony times do, so download it
            again after a change. Each teammate imports it into their own calendar, or the Scrum
            Master forwards it. Times are in this device&rsquo;s time zone.
          </p>
        </>
      )}
    </div>
  );
}
