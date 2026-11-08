"use client";

import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chart } from "@/components/charts/lazy-chart";
import { chartTheme } from "@/components/charts/chart-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { comicHref } from "@/lib/comics/entry";
import {
  CSV_HEADERS,
  MIN_READERS_FOR_SCORE,
  VOLUME_SIZE,
  bandLabel,
  csvRows,
  rollUp,
  storyInsights,
  summarise,
  weeklyTrend,
  type GroupInsight,
  type InsightPeriod,
  type InsightStory,
  type StatRow,
  type StoryInsight,
  type TapRow,
} from "@/lib/comics/insights";
import { THEME_LABELS } from "@/lib/comics/themes";
import { exportToCSV } from "@/lib/utils/export";
import { cn } from "@/lib/utils";
import { errorMessage, portalApi } from "./portal-api";

const ALL = "all";

type SortKey =
  | "ep"
  | "readers"
  | "completion"
  | "medianBand"
  | "loves"
  | "loveRate"
  | "actionRate"
  | "guessRight"
  | "seenYes"
  | "score";

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "ep", label: "Ep" },
  { key: "readers", label: "Readers", title: "Browsers that finished the story" },
  { key: "completion", label: "Finished", title: "Readers ÷ visitors" },
  { key: "medianBand", label: "Typical time", title: "Median active reading time" },
  { key: "loves", label: "Loves" },
  { key: "loveRate", label: "Loves /100", title: "Loves per 100 readers" },
  {
    key: "actionRate",
    label: "Actions /100",
    title: "Shares, retro hand-offs and tool clicks per 100 readers",
  },
  { key: "guessRight", label: "Guessed right" },
  { key: "seenYes", label: "Seen at work", title: "“Seen this at work?” answered yes" },
  { key: "score", label: "Print score", title: `0–100, from ${MIN_READERS_FOR_SCORE} readers` },
];

interface InsightsData {
  stories: InsightStory[];
  stats: StatRow[];
  taps: TapRow[];
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const one = (v: number | null) => (v === null ? "—" : (Math.round(v * 10) / 10).toString());

function cell(s: StoryInsight, key: SortKey): string {
  switch (key) {
    case "ep":
      return String(s.ep);
    case "completion":
    case "guessRight":
    case "seenYes":
      return pct(s[key]);
    case "medianBand":
      return bandLabel(s.medianBand);
    case "loveRate":
    case "actionRate":
      return one(s[key]);
    case "score":
      return s.score === null ? "Too early" : String(s.score);
    default:
      return String(s[key]);
  }
}

/** Highest first, a missing figure last whichever way. */
function compare(a: StoryInsight, b: StoryInsight, key: SortKey, dir: "asc" | "desc"): number {
  const x = a[key];
  const y = b[key];
  if (x === null && y === null) return a.ep - b.ep;
  if (x === null) return 1;
  if (y === null) return -1;
  return (dir === "asc" ? x - y : y - x) || a.ep - b.ep;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-sub">{label}</p>
      <p className="font-display text-xl font-semibold text-text">{value}</p>
    </div>
  );
}

function GroupTable({ title, groups }: { title: string; groups: GroupInsight[] }) {
  return (
    <section className="space-y-2" aria-labelledby={`group-${title}`}>
      <h3 id={`group-${title}`} className="font-semibold text-text">
        {title}
      </h3>
      {groups.length === 0 ? (
        <p className="text-sm text-sub">Nothing yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-surface text-xs text-sub">
              <tr>
                <th scope="col" className="p-2 font-medium">
                  {title === "Themes" ? "Theme" : "Character"}
                </th>
                <th scope="col" className="p-2 font-medium">
                  Stories
                </th>
                <th scope="col" className="p-2 font-medium">
                  Readers
                </th>
                <th scope="col" className="p-2 font-medium">
                  Finished
                </th>
                <th scope="col" className="p-2 font-medium">
                  Typical time
                </th>
                <th scope="col" className="p-2 font-medium">
                  Loves /100
                </th>
                <th scope="col" className="p-2 font-medium">
                  Seen at work
                </th>
                <th scope="col" className="p-2 font-medium">
                  Shortlisted
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-border">
                  <th scope="row" className="p-2 font-medium text-text">
                    {g.label}
                  </th>
                  <td className="p-2 text-text">{g.stories}</td>
                  <td className="p-2 text-text">{g.readers}</td>
                  <td className="p-2 text-text">{pct(g.completion)}</td>
                  <td className="p-2 text-text">{bandLabel(g.medianBand)}</td>
                  <td className="p-2 text-text">{one(g.loveRate)}</td>
                  <td className="p-2 text-text">{pct(g.seenYes)}</td>
                  <td className="p-2 text-text">{g.shortlisted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Settings › Comics › Insights: what readers do with each weekly story, by
 * theme and by character, and the print shortlist. Everything is anonymous
 * weekly totals; the figures are worked out here (lib/comics/insights).
 */
export function InsightsView({ enabled, now = Date.now() }: { enabled: boolean; now?: number }) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<InsightPeriod>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "score",
    dir: "desc",
  });
  const [theme, setTheme] = useState(ALL);
  const [character, setCharacter] = useState(ALL);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  const load = useCallback(() => {
    setError(null);
    portalApi
      .insights()
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const all = useMemo(
    () => (data ? storyInsights(data.stories, data.stats, data.taps, period) : []),
    [data, period]
  );
  // Out, or already read early by a book reader: the rest have nothing to show.
  const live = useMemo(
    () => all.filter((s) => (s.releaseAt && Date.parse(s.releaseAt) <= now) || s.views > 0),
    [all, now]
  );
  const summary = useMemo(() => summarise(live, now), [live, now]);
  const trend = useMemo(() => (data ? weeklyTrend(data.stats) : []), [data]);
  const themes = useMemo(() => rollUp(live, "themes"), [live]);
  const characters = useMemo(() => rollUp(live, "castNames"), [live]);
  const shortlist = useMemo(() => all.filter((s) => s.shortlisted), [all]);

  const themeOptions = useMemo(
    () => Array.from(new Set(live.flatMap((s) => s.themes))).sort(),
    [live]
  );
  const characterOptions = useMemo(
    () => Array.from(new Set(live.flatMap((s) => s.castNames))).sort((a, b) => a.localeCompare(b)),
    [live]
  );
  const rows = useMemo(
    () =>
      live
        .filter(
          (s) =>
            (theme === ALL || s.themes.includes(theme)) &&
            (character === ALL || s.castNames.includes(character)) &&
            (!shortlistOnly || s.shortlisted)
        )
        .sort((a, b) => compare(a, b, sort.key, sort.dir)),
    [live, theme, character, shortlistOnly, sort]
  );

  const toggleShortlist = async (ep: number, on: boolean) => {
    if (!data) return;
    const mark = (value: boolean) =>
      setData((d) =>
        d
          ? {
              ...d,
              stories: d.stories.map((s) => (s.ep === ep ? { ...s, shortlisted: value } : s)),
            }
          : d
      );
    mark(on);
    setSaving(ep);
    try {
      await portalApi.setShortlist(ep, on);
    } catch (err) {
      mark(!on);
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const sortBy = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "ep" ? "asc" : "desc" }
    );

  const download = (list: readonly StoryInsight[], name: string) =>
    exportToCSV(CSV_HEADERS, csvRows(list), name);

  if (!enabled) return null;
  if (error && !data) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <Button type="button" variant="outline" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-sub">Loading insights…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-text">Insights</h2>
        <p className="text-sm text-sub">
          Anonymous counts from readers of the weekly stories. Use them to choose stories for a
          printed volume and to see which themes land. Your own reading isn&apos;t counted.
        </p>
        <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All time"],
              ["first4", "First 4 weeks after release"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={period === value ? "toolkit" : "outline"}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {period === "first4" ? (
          <p className="text-xs text-sub">
            Each story&apos;s first four weeks, so older and newer stories compare fairly. Guesses
            and &ldquo;Seen this at work?&rdquo; keep no dates, so they&apos;re all time.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryCard label="Stories out" value={String(summary.storiesOut)} />
        <SummaryCard label="Visitors" value={String(summary.visitors)} />
        <SummaryCard label="Readers" value={String(summary.readers)} />
        <SummaryCard label="Finished" value={pct(summary.completion)} />
        <SummaryCard label="Loves" value={String(summary.loves)} />
        <SummaryCard label="Typical reading time" value={bandLabel(summary.medianBand)} />
      </section>

      <section className="space-y-2" aria-labelledby="trend-heading">
        <h3 id="trend-heading" className="font-semibold text-text">
          Week by week
        </h3>
        {trend.length < 2 ? (
          <p className="text-sm text-sub">The trend shows once there are two weeks of counts.</p>
        ) : (
          <Card>
            <CardContent className="p-2 sm:p-4">
              <Chart height={240}>
                {({
                  ResponsiveContainer,
                  LineChart,
                  Line,
                  XAxis,
                  YAxis,
                  Tooltip,
                  Legend,
                  CartesianGrid,
                }) => (
                  <ResponsiveContainer>
                    <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                      <XAxis dataKey="week" stroke={chartTheme.axisColor} fontSize={11} />
                      <YAxis allowDecimals={false} stroke={chartTheme.axisColor} fontSize={11} />
                      <Tooltip contentStyle={chartTheme.tooltipStyle} />
                      <Legend wrapperStyle={chartTheme.legendStyle} />
                      <Line
                        type="monotone"
                        dataKey="views"
                        name="Views"
                        stroke={chartTheme.colors.cyan}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="readers"
                        name="Readers"
                        stroke={chartTheme.colors.green}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="loves"
                        name="Loves"
                        stroke={chartTheme.colors.magenta}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Chart>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="stories-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="stories-heading" className="font-semibold text-text">
            Stories
          </h3>
          <Button type="button" variant="outline" onClick={() => download(rows, "comics-insights")}>
            Download these (CSV)
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Theme">
            {(props) => (
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All themes</SelectItem>
                  {themeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {THEME_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Character">
            {(props) => (
              <Select value={character} onValueChange={setCharacter}>
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All characters</SelectItem>
                  {characterOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="size-5"
            checked={shortlistOnly}
            onChange={(e) => setShortlistOnly(e.target.checked)}
          />
          Shortlisted only
        </label>
        {rows.length === 0 ? (
          <p className="text-sm text-sub">
            {live.length === 0
              ? "No counts yet. They start with the first readers."
              : "No stories match these filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">
                Stories, sorted by {COLUMNS.find((c) => c.key === sort.key)?.label},{" "}
                {sort.dir === "desc" ? "highest first" : "lowest first"}
              </caption>
              <thead className="bg-surface text-xs text-sub">
                <tr>
                  <th scope="col" className="p-2 font-medium">
                    <span className="sr-only">Shortlist</span>
                  </th>
                  {COLUMNS.slice(0, 1).map((c) => (
                    <SortHeader key={c.key} column={c} sort={sort} onSort={sortBy} />
                  ))}
                  <th scope="col" className="p-2 font-medium">
                    Story
                  </th>
                  {COLUMNS.slice(1).map((c) => (
                    <SortHeader key={c.key} column={c} sort={sort} onSort={sortBy} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.ep} className="border-t border-border">
                    <td className="p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-pressed={s.shortlisted}
                        aria-label={`Shortlist episode ${s.ep}`}
                        disabled={saving === s.ep}
                        onClick={() => void toggleShortlist(s.ep, !s.shortlisted)}
                        className="size-11"
                      >
                        <Star
                          className={cn("size-5", s.shortlisted && "fill-current text-accent")}
                          aria-hidden="true"
                        />
                      </Button>
                    </td>
                    <td className="p-2 text-text">{s.ep}</td>
                    <th scope="row" className="max-w-[16rem] p-2 font-medium text-text">
                      <a
                        href={comicHref(s.ep)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {s.title}
                      </a>
                    </th>
                    {COLUMNS.slice(1).map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "p-2 text-text",
                          c.key === "score" && s.score === null && "text-sub"
                        )}
                      >
                        {cell(s, c.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-sub">
          Print score: where a story&apos;s loves per reader, finishing rate, &ldquo;seen it at
          work&rdquo; share and actions per reader sit among stories with at least{" "}
          {MIN_READERS_FOR_SCORE} readers, averaged, 0 to 100.
        </p>
      </section>

      <GroupTable title="Themes" groups={themes} />
      <GroupTable title="Characters" groups={characters} />

      <section className="space-y-3" aria-labelledby="shortlist-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="shortlist-heading" className="font-semibold text-text">
            Print shortlist
          </h3>
          <Button
            type="button"
            variant="outline"
            disabled={shortlist.length === 0}
            onClick={() => download(shortlist, "comics-print-shortlist")}
          >
            Download shortlist (CSV)
          </Button>
        </div>
        <p className="text-sm text-text">
          {shortlist.length} shortlisted: {Math.min(shortlist.length, VOLUME_SIZE)} of {VOLUME_SIZE}{" "}
          for a volume
          {shortlist.length > VOLUME_SIZE
            ? `, and ${shortlist.length - VOLUME_SIZE} more to choose from`
            : ""}
          .
        </p>
        {shortlist.length === 0 ? (
          <p className="text-sm text-sub">Star stories in the table to build the shortlist.</p>
        ) : (
          <>
            <ul
              className="flex list-none flex-wrap gap-2 text-xs"
              aria-label="Themes in the shortlist"
            >
              {rollUp(shortlist, "themes").map((g) => (
                <li key={g.key} className="rounded-full border border-border px-3 py-1 text-text">
                  {g.label}: {g.stories}
                </li>
              ))}
            </ul>
            <ol className="list-none space-y-1 text-sm">
              {[...shortlist]
                .sort((a, b) => a.ep - b.ep)
                .map((s) => (
                  <li key={s.ep} className="text-text">
                    {s.ep}. {s.title}
                    <span className="text-sub"> · score {s.score ?? "too early"}</span>
                  </li>
                ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: { key: SortKey; label: string; title?: string };
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === column.key;
  return (
    <th
      scope="col"
      className="p-1 font-medium"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        title={column.title}
        onClick={() => onSort(column.key)}
        className={cn(
          "min-h-11 whitespace-nowrap rounded px-1 text-left hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          active && "text-text"
        )}
      >
        {column.label}
        {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}
