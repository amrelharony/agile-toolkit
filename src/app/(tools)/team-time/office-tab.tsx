"use client";

import Link from "next/link";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import { namesList } from "@/lib/team-time/format";
import { officeGroups } from "@/lib/team-time/office";
import { cn } from "@/lib/utils";
import type { TeamTimeCtx } from "./context";
import { WEEK_ORDER } from "./fields";

/**
 * Office days: for each office (each zone, for people who name none) with
 * two people or more, who is in on each weekday, the anchor day the most
 * people share, and who never meets in the office.
 */
export function OfficeTab({ ctx }: { ctx: TeamTimeCtx }) {
  const groups = officeGroups(ctx.people);
  if (groups.length === 0) {
    return (
      <p className="text-sm text-sub">
        Add office days and an office for two people or more on the People tab to see your anchor
        days.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-3" aria-label="Offices">
        {groups.map((g) => (
          <li key={g.key} className="space-y-2 rounded-lg border border-border bg-card p-3">
            <h3 className="font-medium text-text">{g.label}</h3>
            <p className="text-sm text-text">
              {g.anchorDays.length > 0
                ? `Anchor day: ${g.anchorDays.map((d) => WEEKDAY_LABEL[d]).join(" or ")}, when ${g.inOn[g.anchorDays[0]].length} of ${g.people.length} are in.`
                : "Nobody is in on a set day yet."}
            </p>
            <ul
              className="grid grid-cols-2 gap-1 sm:grid-cols-4"
              aria-label={`Who is in at ${g.label}`}
            >
              {WEEK_ORDER.filter((d) => g.inOn[d].length > 0 || g.anchorDays.includes(d)).map(
                (d) => (
                  <li
                    key={d}
                    className={cn(
                      "rounded-md border p-2 text-xs",
                      g.anchorDays.includes(d) ? "border-success bg-success/10" : "border-border"
                    )}
                  >
                    <span className="font-medium text-text">
                      {WEEKDAY_LABEL[d]} ({g.inOn[d].length})
                    </span>
                    <span className="block break-words text-sub">
                      {namesList(g.inOn[d].map(ctx.name))}
                    </span>
                  </li>
                )
              )}
            </ul>
            {g.neverMeet.length > 0 && (
              <p className="text-sm text-text">
                Never in on the same day:{" "}
                {g.neverMeet.map(([a, b]) => `${ctx.name(a)} and ${ctx.name(b)}`).join("; ")}.
              </p>
            )}
            {g.remote.length > 0 && (
              <p className="text-xs text-sub">
                Not in the office: {namesList(g.remote.map(ctx.name))}.
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link
          href="/working-agreement?template=core-hours"
          className="text-accent underline underline-offset-2"
        >
          Add an anchor-day rule
        </Link>{" "}
        <span className="text-sub">to the Working Agreement.</span>
      </p>
    </div>
  );
}
