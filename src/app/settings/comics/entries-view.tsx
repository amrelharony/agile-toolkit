"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EntriesSummary } from "@/lib/comics/entries-summary";
import { errorMessage, portalApi } from "./portal-api";

const RANGES = [7, 30, 90, 365] as const;

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

/** Anonymous daily totals: there's nothing here about any one person. */
export function EntriesView({ enabled }: { enabled: boolean }) {
  const [days, setDays] = useState<number>(30);
  const [summary, setSummary] = useState<EntriesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setError(null);
    portalApi
      .entries(days)
      .then((result) => {
        if (current) setSummary(result.summary);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [days, enabled, attempt]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="How far back">
        {RANGES.map((range) => (
          <Button
            key={range}
            type="button"
            variant={range === days ? "toolkit" : "outline"}
            aria-pressed={range === days}
            onClick={() => setDays(range)}
          >
            {range} days
          </Button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-danger">{error}</p>
          <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {summary ? (
        <>
          <p className="text-sm text-text">
            {summary.total} entries: {summary.poster} from posters, {summary.direct} from the
            printed address or direct.
          </p>
          <Rows
            title="By building"
            empty="No poster scans yet."
            rows={summary.byBuilding.map((b) => ({
              label: `Building ${b.building}`,
              count: b.count,
            }))}
          />
          <Rows
            title="By episode"
            empty="No poster scans yet."
            rows={summary.byEpisode.map((e) => ({ label: `Episode ${e.ep}`, count: e.count }))}
          />
          <Rows
            title="By day"
            empty="Nothing counted yet."
            rows={summary.byDay.map((d) => ({ label: d.day, count: d.count }))}
          />
        </>
      ) : error ? null : (
        <p className="text-sm text-sub">Loading entries…</p>
      )}
    </div>
  );
}
