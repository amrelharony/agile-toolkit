"use client";

/**
 * The Emotional Seismograph on a board in that format: the moments the team
 * wrote (highs, steady stretches and lows) charted on the sprint's days,
 * and under it the team's mood on its own 1–5 scale, so a low card never
 * reads as a mood of 1.5.
 *
 * It charts only what this screen shows (`shownCards`: a live room's hidden
 * cards stay hidden) and only the team's own moments: action items,
 * carried-over actions and cards sent from other tools are left out. A
 * grouped card charts with the top card of its group, or, under a top card
 * that doesn't chart, with the group's first card that does.
 *
 * "Place the cards" gives each moment a day (cards with no day first),
 * labelled with the sprint's dates when the board has a sprint; each day
 * set is logged. The selects hide in the Actions phase; the chart stays.
 * With no sprint the board draws Day 0–9 and no mood. In a live room the
 * host places the days: participants' phones don't carry them.
 *
 * The board passes the days and the mood line (it reads the sprint once,
 * for its facts too), so this view reads nothing from the store.
 */

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Activity } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ChartFigure } from "@/components/shared/chart-card";
import { Button } from "@/components/ui/button";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { ChartTable } from "@/lib/charts/chart-text";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import {
  BAND_LABEL,
  BAND_LANE,
  momentCards,
  placedCards,
  seismographRead,
  type Moment,
  type MoodPoint,
  type Placement,
  type SeismographDay,
} from "@/lib/retro/seismograph";
import type { BoardState, RetroCard } from "../types";
import type { SeismographPoint } from "./seismograph-chart";

const SeismographChart = dynamic(
  () => import("./seismograph-chart").then((m) => m.SeismographChart),
  { ssr: false }
);
const MoodStripChart = dynamic(() => import("./seismograph-chart").then((m) => m.MoodStripChart), {
  ssr: false,
});

/** A native select the size of the other fields: 44 px and 16 px text on a phone (no iOS zoom). */
const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-2 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm sm:w-56";

const short = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const votes = (n: number) => (n > 0 ? `${n} ${n === 1 ? "vote" : "votes"}` : "no votes");

/** The chart's dots: a moment's day and lane, nudged apart when several share both. */
export function seismographPoints(placement: Placement): SeismographPoint[] {
  const counts = new Map<string, number>();
  for (const m of placement.placed) {
    const key = `${m.day}:${m.band}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return placement.placed.map((m) => {
    const n = counts.get(`${m.day}:${m.band}`) ?? 1;
    const nudge = Math.max(-0.4, Math.min(0.4, (m.stack - (n - 1) / 2) * 0.2));
    return { x: m.day, y: BAND_LANE[m.band] + nudge, band: m.band, text: m.text, votes: m.votes };
  });
}

/** The cards chart's table: one row per card on a day (Day | Band | Card | Votes). */
export function seismographTable(
  placement: Placement,
  days: readonly SeismographDay[]
): ChartTable {
  const label = new Map(days.map((d) => [d.day, d.label]));
  return {
    caption: "The cards by the sprint day they happened",
    columns: ["Day", "Band", "Card", "Votes"],
    rows: placement.placed.map((m) => [
      label.get(m.day) ?? `Day ${m.day}`,
      BAND_LABEL[m.band],
      m.text,
      m.votes,
    ]),
  };
}

/** The mood strip's table: one row per day it shows (Day | Team mood). */
export function moodTable(mood: readonly MoodPoint[], days: readonly SeismographDay[]): ChartTable {
  const label = new Map(days.map((d) => [d.day, d.label]));
  return {
    caption: "The team's mood on days with at least 3 check-ins",
    columns: ["Day", "Team mood"],
    rows: mood.map((p) => [label.get(p.day) ?? `Day ${p.day}`, p.average.toFixed(1)]),
  };
}

/** The cards chart's sentence: the read, or what to do first. */
export function seismographSummary(placement: Placement, read: readonly string[]): string {
  const total = placement.placed.length + placement.unplaced.length;
  if (total === 0) return "No moments yet: write the sprint's highs, steady stretches and lows.";
  if (placement.placed.length === 0) {
    return "No card has a day yet: give each one the day it happened, below.";
  }
  const on = `${placement.placed.length} of ${total} ${total === 1 ? "card is" : "cards are"} on a day.`;
  return read.length > 0 ? `${read.join(" ")} ${on}` : on;
}

export function SeismographView({
  state,
  shownCards,
  days,
  mood,
  hasSprint,
  example,
  onUpdate,
  log,
}: {
  state: Pick<BoardState, "phase">;
  /** The cards this screen shows (a live room's hidden ones left out). */
  shownCards: readonly RetroCard[];
  days: readonly SeismographDay[];
  mood: readonly MoodPoint[];
  /** The board looks back on a sprint, so its days have dates and a mood. */
  hasSprint: boolean;
  /** The board holds the example (it has no sprint of the team's). */
  example: boolean;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  log: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const [showMood, setShowMood] = useState(true);
  const moments = useMemo(() => momentCards(shownCards), [shownCards]);
  const placement = useMemo(() => placedCards(moments, days), [moments, days]);
  const read = useMemo(() => seismographRead(placement, mood), [placement, mood]);
  const points = useMemo(() => seismographPoints(placement), [placement]);
  const lastDay = days.length > 0 ? days[days.length - 1].day : 0;
  const label = useMemo(() => new Map(days.map((d) => [d.day, d.label])), [days]);
  // Cards with no day first, then the rest by day.
  const toPlace: Moment[] = [...placement.unplaced, ...placement.placed];

  const setDay = (m: Moment, day: number | null) => {
    onUpdate((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => {
        if (c.id !== m.id) return c;
        const next = { ...c };
        if (day === null) delete next.day;
        else next.day = day;
        return next;
      }),
    }));
    if (!isExampleId(m.id)) log(RETRO_ACTIONS.CARD_EDITED, { cardId: m.id, field: "day", day });
    announce(
      day === null
        ? `“${short(m.text, 40)}” has no day now.`
        : `“${short(m.text, 40)}” is on ${label.get(day) ?? `day ${day}`}.`
    );
  };

  return (
    <section
      aria-labelledby="seismograph-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <h3 id="seismograph-heading" className="text-sm font-semibold text-text">
        Emotional seismograph
      </h3>
      {!hasSprint && !example && (
        <p className="text-xs text-sub">
          Pick the sprint to draw its days and the team&apos;s mood.
        </p>
      )}

      <ChartFigure
        label="The sprint's highs and lows by day"
        summary={seismographSummary(placement, read)}
        table={seismographTable(placement, days)}
        plotClassName="h-[220px]"
      >
        <SeismographChart points={points} lastDay={lastDay} />
      </ChartFigure>

      {hasSprint &&
        (mood.length === 0 ? (
          <p className="text-xs text-sub">
            The team&apos;s mood shows on days with at least 3 check-ins in Mood Tracker; none has
            that many yet.
          </p>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              size="sm"
              variant={showMood ? "default" : "outline"}
              aria-pressed={showMood}
              className="gap-1.5"
              onClick={() => setShowMood((v) => !v)}
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              Team mood
            </Button>
            {showMood && (
              <ChartFigure
                label="Team mood, 1–5"
                summary={`Team mood, 1–5, on ${mood.length} ${mood.length === 1 ? "day" : "days"} with at least 3 check-ins.`}
                table={moodTable(mood, days)}
                plotClassName="h-[120px]"
              >
                <MoodStripChart
                  points={mood.map((p) => ({ day: p.day, average: p.average }))}
                  lastDay={lastDay}
                />
              </ChartFigure>
            )}
          </div>
        ))}

      {state.phase !== "actions" && toPlace.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-text">Place the cards</h4>
          <p className="text-xs text-sub">
            {placement.unplaced.length === 0
              ? "Every card is on a day."
              : `${placement.unplaced.length} ${placement.unplaced.length === 1 ? "card has" : "cards have"} no day yet.`}
          </p>
          <ul className="space-y-1.5">
            {toPlace.map((m) => {
              const fieldId = `seismo-day-${m.id}`;
              const past = m.day !== undefined && m.day > lastDay;
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-bg px-2.5 py-2 sm:flex-row sm:items-center"
                >
                  <label htmlFor={fieldId} className="min-w-0 flex-1 break-words text-sm text-text">
                    <span className="text-xs font-semibold text-sub">{BAND_LABEL[m.band]}: </span>
                    {m.text}
                    <span className="text-xs text-sub"> ({votes(m.votes)})</span>
                  </label>
                  <select
                    id={fieldId}
                    value={m.day === undefined ? "" : String(m.day)}
                    onChange={(e) =>
                      setDay(m, e.target.value === "" ? null : Number(e.target.value))
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">No day</option>
                    {days.map((d) => (
                      <option key={d.day} value={String(d.day)}>
                        {d.label}
                      </option>
                    ))}
                    {past && <option value={String(m.day)}>Day {m.day} (past this sprint)</option>}
                  </select>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {state.phase === "actions" && placement.unplaced.length > 0 && (
        <p className="text-xs text-sub">
          {placement.unplaced.length} {placement.unplaced.length === 1 ? "card has" : "cards have"}{" "}
          no day, so {placement.unplaced.length === 1 ? "it isn't" : "they aren't"} on the chart.
        </p>
      )}
    </section>
  );
}
