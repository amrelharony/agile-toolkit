"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArrivalSource } from "@/lib/comics/entry";
import { REPORT_SOURCES, type MonthSummary } from "@/lib/comics/entries-summary";
import { errorMessage, portalApi } from "./portal-api";

/** A year of months: the report never shows anything finer than a month. */
const MONTHS = 12;

const SOURCE_LABELS: Record<ArrivalSource, string> = {
  poster: "Posters",
  kudos: "Kudos cards",
  book: "The book (page 161 and the back cover)",
  sign: "The kudos wall sign",
  guide: "The Scrum Master guide",
  comics: "The comics' own links to kudos",
  none: "No printed piece (typed, shared or bookmarked)",
};

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Rows({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; count: number }[];
  empty: string;
}) {
  const largest = rows.reduce((max, row) => Math.max(max, row.count), 0);
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-sub">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.label} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-text">{row.label}</span>
                <span className="font-medium text-text">{row.count}</span>
              </div>
              <div aria-hidden="true" className="h-1 rounded-full bg-muted">
                <div
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${largest ? (row.count / largest) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Month({ summary }: { summary: MonthSummary }) {
  const sources = REPORT_SOURCES.map((src) => ({
    label: SOURCE_LABELS[src],
    count: summary.bySource[src],
  })).filter((row) => row.count > 0);
  return (
    <>
      <p className="text-sm text-text">
        {summary.total} visits in {monthLabel(summary.month)}: {summary.bySource.poster} from
        posters, {summary.bySource.kudos} from kudos cards, and {summary.vip} VIP activations from
        the link in the book.
      </p>
      <Rows title="By printed piece" empty="No visits this month." rows={sources} />
      <section className="space-y-2">
        <h3 className="font-semibold text-text">By episode: posters and kudos cards</h3>
        {summary.byEpisode.length === 0 ? (
          <p className="text-sm text-sub">No poster or kudos card scanned this month.</p>
        ) : (
          <table className="w-full max-w-md text-sm">
            <thead>
              <tr className="text-left text-sub">
                <th scope="col" className="py-1 font-medium">
                  Episode
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Posters
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Kudos cards
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.byEpisode.map((e) => (
                <tr key={e.ep} className="border-t border-border text-text">
                  <th scope="row" className="py-1 text-left font-normal">
                    Episode {e.ep}
                  </th>
                  <td className="py-1 text-right">{e.poster}</td>
                  <td className="py-1 text-right">{e.kudos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** Anonymous monthly totals: there's nothing here about any one person. */
export function EntriesView({ enabled }: { enabled: boolean }) {
  const [summary, setSummary] = useState<MonthSummary[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setError(null);
    portalApi
      .entries(MONTHS)
      .then((result) => {
        if (current) setSummary(result.summary);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [enabled, attempt]);

  const shown = summary?.find((m) => m.month === month) ?? summary?.[0] ?? null;

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-danger">{error}</p>
          <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {summary ? (
        shown ? (
          <>
            <div className="max-w-xs">
              <Field label="Month">
                {(props) => (
                  <Select value={shown.month} onValueChange={setMonth}>
                    <SelectTrigger {...props}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {summary.map((m) => (
                        <SelectItem key={m.month} value={m.month}>
                          {monthLabel(m.month)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>
            <Month summary={shown} />
          </>
        ) : (
          <p className="text-sm text-sub">Nothing counted yet.</p>
        )
      ) : error ? null : (
        <p className="text-sm text-sub">Loading entries…</p>
      )}
    </div>
  );
}
