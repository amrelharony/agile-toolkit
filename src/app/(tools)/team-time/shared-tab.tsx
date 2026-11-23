"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AiButton } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { AiSource } from "@/lib/ai/task-types";
import { teamTimeScheduleNoteTask } from "@/lib/ai/tasks/team-time.lite";
import { WORKING_AGREEMENT_ID } from "@/lib/stores/workspace-types";
import { clockText, dayText, daysLabel, namesList } from "@/lib/team-time/format";
import { ceremonyTimes, meetingBurdens, savedCadence } from "@/lib/team-time/model";
import { clockChangeLine, scheduleNoteInput } from "@/lib/team-time/note";
import {
  DAY_MS,
  clockChanges,
  coreHoursIntervals,
  sharedWindows,
  weekRange,
  windowLines,
  workIntervals,
  type Interval,
} from "@/lib/team-time/overlap";
import { BURDEN_LABEL } from "@/lib/team-time/slots";
import { localClock, wallToUtc, zoneLabel } from "@/lib/team-time/zones";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { cn } from "@/lib/utils";
import type { TeamTimeCtx } from "./context";
import { useTeamTimeView } from "./store";

/** Where a span sits on a day's 24-hour strip, as percentages. */
function place(i: Interval, from: number, to: number) {
  const a = Math.max(i.start, from);
  const b = Math.min(i.end, to);
  if (b <= a) return null;
  const width = to - from;
  return { left: ((a - from) / width) * 100, width: ((b - a) / width) * 100 };
}

/** A span's local times on the display clock: "09:00–17:30". */
function spanText(i: Interval, zone: string): string {
  const a = localClock(zone, i.start);
  const b = localClock(zone, i.end);
  return `${clockText(a.minute)}–${clockText(b.minute === 0 && b.day !== a.day ? 1440 : b.minute)}`;
}

function Strip({
  label,
  spans,
  from,
  to,
  zone,
  tone,
  emptyText,
}: {
  label: string;
  spans: Interval[];
  from: number;
  to: number;
  zone: string;
  tone: string;
  emptyText: string;
}) {
  const parts = spans.map((s) => ({ s, at: place(s, from, to) })).filter((x) => x.at !== null);
  const said = parts.length > 0 ? parts.map((x) => spanText(x.s, zone)).join(", ") : emptyText;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-2 sm:grid-cols-[minmax(0,10rem)_1fr]">
      <span className="truncate text-xs text-text">{label}</span>
      <div
        role="img"
        aria-label={`${label}: ${said}`}
        className="relative h-5 overflow-hidden rounded border border-border bg-surface-deep"
      >
        {parts.map(({ s, at }) => (
          <span
            key={`${s.start}-${s.end}`}
            aria-hidden="true"
            className={cn("absolute inset-y-0 rounded-sm", tone)}
            style={{ left: `${at!.left}%`, width: `${at!.width}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Shared hours: a 24-hour strip per person for a day of the chosen week on
 * the display clock, with the everyone and all-but-one bands and the
 * charter's core hours, the same windows as a list for the whole week, the
 * clock changes ahead, the saved cadence's ceremonies on each clock, and
 * Ask Amr's tips (the page's own rules without AI).
 */
export function SharedTab({ ctx }: { ctx: TeamTimeCtx }) {
  const weekOffset = useTeamTimeView((s) => s.weekOffset);
  const setWeek = (n: number) =>
    useTeamTimeView.setState({ weekOffset: Math.max(-52, Math.min(52, n)) });
  const zone = ctx.zone;
  const week = useMemo(() => weekRange(zone, ctx.now, weekOffset), [zone, ctx.now, weekOffset]);
  const today = localClock(zone, ctx.now).day;
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const day =
    pickedDay && week.days.includes(pickedDay)
      ? pickedDay
      : week.days.includes(today)
        ? today
        : week.days[0];
  const dayNumber = isoDayNumber(day) ?? 0;
  const from = wallToUtc(day, "00:00", zone)?.getTime() ?? dayNumber * DAY_MS;
  const to = wallToUtc(isoFromDayNumber(dayNumber + 1), "00:00", zone)?.getTime() ?? from + DAY_MS;

  const shared = useMemo(() => sharedWindows(ctx.people, week.from, week.to), [ctx.people, week]);
  const everyoneLines = windowLines(shared.everyone, zone);
  const allButOneLines = windowLines(shared.allButOne, zone);
  const changes = useMemo(
    () => clockChanges(ctx.people, ctx.now, 8, zone),
    [ctx.people, ctx.now, zone]
  );
  const agreement =
    ctx.agreements.find((a) => a.id === WORKING_AGREEMENT_ID) ?? ctx.agreements[0] ?? null;
  const core = agreement?.templates?.coreHours ?? null;
  const coreBand = core ? coreHoursIntervals(core, from, to) : [];
  const cadence = savedCadence(ctx.cadences);
  const ceremonies = cadence ? ceremonyTimes(cadence, ctx.now, ctx.viewerZone) : [];
  const clock = zone === ctx.viewerZone ? "your time" : zoneLabel(zone);

  const askRef = useRef<HTMLDivElement>(null);
  const [tips, setTips] = useState<{ note: string; tips: string[]; source: AiSource } | null>(null);
  const noteInput = () =>
    scheduleNoteInput({
      people: ctx.people,
      now: ctx.now,
      zone: ctx.viewerZone,
      cadence,
      rotations: ctx.rotations,
      holidays: ctx.holidays,
    });

  if (ctx.people.length === 0) {
    return (
      <p className="text-sm text-sub">
        Add people with their time zones on the People tab to see the hours you share.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setWeek(weekOffset - 1)}>
          <ChevronLeft aria-hidden="true" />
          Earlier week
        </Button>
        <p className="text-sm font-medium text-text" aria-live="polite">
          Week of {dayText(week.days[0])}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setWeek(weekOffset + 1)}>
          Later week
          <ChevronRight aria-hidden="true" />
        </Button>
        {weekOffset !== 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setWeek(0)}>
            This week
          </Button>
        )}
      </div>

      <div role="group" aria-label="Day" className="flex flex-wrap gap-1">
        {week.days.map((d) => (
          <Button
            key={d}
            type="button"
            size="sm"
            variant={d === day ? "toolkit" : "ghost"}
            aria-pressed={d === day}
            onClick={() => setPickedDay(d)}
          >
            {dayText(d).slice(0, 6)}
          </Button>
        ))}
      </div>

      <section aria-label={`Working hours on ${dayText(day)}, ${clock}`} className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-xs text-sub sm:grid-cols-[minmax(0,10rem)_1fr]">
          <span>{dayText(day)}</span>
          <span className="flex justify-between" aria-hidden="true">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </span>
        </div>
        <Strip
          label="Everyone"
          spans={shared.everyone}
          from={from}
          to={to}
          zone={zone}
          tone="bg-success/20 border border-success"
          emptyText="no shared time"
        />
        {ctx.people.length >= 3 && (
          <Strip
            label="All but one"
            spans={shared.allButOne}
            from={from}
            to={to}
            zone={zone}
            tone="bg-warning/20 border border-warning"
            emptyText="none"
          />
        )}
        {coreBand.length > 0 && (
          <Strip
            label="Core hours"
            spans={coreBand}
            from={from}
            to={to}
            zone={zone}
            tone="bg-info/20 border border-info"
            emptyText="none"
          />
        )}
        {ctx.people.map((p) => (
          <Strip
            key={p.id}
            label={ctx.name(p.id)}
            spans={workIntervals(p, from, to)}
            from={from}
            to={to}
            zone={zone}
            tone="bg-accent/20 border border-accent"
            emptyText="not working"
          />
        ))}
        <p className="text-xs text-sub">Times on the strips: {clock}.</p>
      </section>

      <section aria-labelledby="tt-shared-list" className="space-y-1">
        <h3 id="tt-shared-list" className="text-sm font-semibold text-text">
          This week, {clock}
        </h3>
        <ul className="space-y-0.5 text-sm text-text">
          {everyoneLines.map((l) => (
            <li key={`e-${l.start}-${l.end}`}>
              Everyone: {l.start}–{l.end} {clock}, {daysLabel(l.days)}
            </li>
          ))}
          {allButOneLines.map((l) => (
            <li key={`a-${l.start}-${l.end}-${l.leftOut}`}>
              All but {ctx.name(l.leftOut ?? "")}: {l.start}–{l.end} {clock}, {daysLabel(l.days)}
            </li>
          ))}
          {everyoneLines.length === 0 && allButOneLines.length === 0 && (
            <li className="text-sub">No hour this week has everyone, or all but one, working.</li>
          )}
        </ul>
        {everyoneLines.length + allButOneLines.length > 0 && (
          <p className="text-sm">
            <Link
              href="/working-agreement?template=core-hours"
              className="text-accent underline underline-offset-2"
            >
              Make these your core hours
            </Link>{" "}
            <span className="text-sub">in the Working Agreement.</span>
          </p>
        )}
      </section>

      {changes.length > 0 && (
        <section aria-labelledby="tt-changes" className="space-y-1">
          <h3 id="tt-changes" className="text-sm font-semibold text-text">
            Clock changes ahead
          </h3>
          <ul className="space-y-0.5 text-sm text-text">
            {changes.map((c) => (
              <li key={c.at}>{clockChangeLine(c, zone)}</li>
            ))}
          </ul>
        </section>
      )}

      {ceremonies.length > 0 && (
        <section aria-labelledby="tt-ceremonies" className="space-y-1">
          <h3 id="tt-ceremonies" className="text-sm font-semibold text-text">
            Your ceremonies on everyone&apos;s clock
          </h3>
          <ul className="space-y-1 text-sm text-text">
            {ceremonies.map((c) => {
              const outside = meetingBurdens(ctx.people, c.start, c.minutes).filter(
                (b) => b.burden > 0
              );
              const at = Date.parse(c.start);
              return (
                <li key={c.kind}>
                  <span className="font-medium">{c.label}</span> {c.time} your time
                  {outside.length === 0
                    ? " is in everyone's hours."
                    : ` is ${namesList(
                        outside.map((b) => {
                          const p = ctx.people.find((x) => x.id === b.personId)!;
                          return `${clockText(localClock(p.timeZone, at).minute)} for ${ctx.name(p.id)} (${BURDEN_LABEL[b.burden]})`;
                        })
                      )}.`}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-sub">
            Ceremony times are on this browser&apos;s clock, as the Sprint Cockpit and its calendar
            file read them.
          </p>
        </section>
      )}

      <section ref={askRef} aria-labelledby="tt-tips" className="space-y-2">
        <h3 id="tt-tips" className="text-sm font-semibold text-text">
          Tips for this schedule
        </h3>
        <AiButton
          task={teamTimeScheduleNoteTask}
          label="Ask Amr for tips"
          fallbackLabel="Get tips"
          input={noteInput}
          onResult={(data, meta) => setTips({ ...data, source: meta.source })}
        />
        {tips && (
          <div className="space-y-2 rounded-md border border-border bg-card p-3" data-schedule-note>
            <p className="text-xs text-sub">
              {tips.source === "ai" ? "Amr's note (AI, not saved)" : "Written without AI"}
            </p>
            <p role="status" className="whitespace-pre-line break-words text-sm text-text">
              {tips.note}
            </p>
            {tips.tips.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                {tips.tips.map((t) => (
                  <li key={t} className="break-words">
                    {t}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <CopyButton
                text={() => [tips.note, ...tips.tips.map((t) => `- ${t}`)].join("\n")}
                label="Copy"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')?.focus();
                  setTips(null);
                }}
              >
                Hide the tips
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
