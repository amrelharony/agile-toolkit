"use client";

import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type StoryInsight,
  type TapRow,
  type TotalRow,
  type WeekRow,
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

/** The table's figures, each with what it means, shown under the table too. */
const COLUMNS: { key: SortKey; label: string; meaning: string }[] = [
  { key: "ep", label: "Ep", meaning: "The episode number." },
  { key: "readers", label: "Readers", meaning: "Browsers that read the story to the end." },
  { key: "completion", label: "Finished", meaning: "Readers out of the browsers that opened it." },
  { key: "medianBand", label: "Typical time", meaning: "The middle view's active reading time." },
  { key: "loves", label: "Loves", meaning: "Hearts, net of those taken back." },
  { key: "loveRate", label: "Loves /100", meaning: "Loves for every 100 readers." },
  {
    key: "actionRate",
    label: "Actions /100",
    meaning: "Shares, retro hand-offs and tool clicks for every 100 readers.",
  },
  {
    key: "guessRight",
    label: "Guessed right",
    meaning: "Guesses that picked what the last panel shows.",
  },
  {
    key: "seenYes",
    label: "Seen at work",
    meaning: "“Seen this at work?” answers that said yes.",
  },
  {
    key: "score",
    label: "Print score",
    meaning: `0 to 100: where the story's loves per reader, finishing rate, seen-at-work share and actions per reader sit among stories with at least ${MIN_READERS_FOR_SCORE} readers, averaged. Fewer readers: too early.`,
  },
];
const FIGURES = COLUMNS.filter((c) => c.key !== "ep");

interface InsightsData {
  stories: InsightStory[];
  totals: TotalRow[];
  weeks: WeekRow[];
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

function GroupTable({ title, groups }: { title: "Themes" | "Characters"; groups: GroupInsight[] }) {
  const id = `group-${title.toLowerCase()}`;
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className="font-semibold text-text">
        {title}
      </h3>
      {groups.length === 0 ? (
        <p className="text-sm text-sub">Nothing yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">{title}, most loved for their readers first</caption>
            <thead className="bg-surface text-xs text-sub">
              <tr>
                <th scope="col" className="sticky left-0 bg-surface p-2 font-medium">
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
                  <th
                    scope="row"
                    className="sticky left-0 max-w-[12rem] bg-card p-2 font-medium text-text"
                  >
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

/** Three lines a reader tells apart by their dashes as well as their colours. */
const TREND_LINES = [
  { key: "views", name: "Views", color: chartTheme.colors.cyan, dash: undefined },
  { key: "readers", name: "Readers", color: chartTheme.colors.green, dash: "6 3" },
  { key: "loves", name: "Loves", color: chartTheme.colors.magenta, dash: "2 3" },
] as const;

/**
 * Keeps a control focused in the scrolling columns clear of the pinned star
 * and story name (WCAG 2.4.11). The box's scroll padding does most of it; this
 * nudges after the browser has scrolled the control into view.
 */
function keepClearOfPinned(e: React.FocusEvent<HTMLElement>) {
  const target = e.currentTarget;
  const box = target.closest<HTMLElement>("[data-scroll-box]");
  if (!box) return;
  requestAnimationFrame(() => {
    const edge = box.querySelector("[data-pinned-edge]")?.getBoundingClientRect().right;
    if (edge === undefined) return;
    const { left, right } = target.getBoundingClientRect();
    const boxRight = box.getBoundingClientRect().right;
    if (left < edge) box.scrollLeft -= edge - left + 4;
    else if (right > boxRight) box.scrollLeft += right - boxRight + 4;
  });
}

/**
 * Settings › Comics › Insights: what readers do with each weekly story, by
 * theme and by character, and the print shortlist. Everything is anonymous
 * weekly totals the database sums; the figures are worked out here
 * (lib/comics/insights).
 */
export function InsightsView({ enabled, now = Date.now() }: { enabled: boolean; now?: number }) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed star says so in its own row.
  const [shortlistError, setShortlistError] = useState<{ ep: number; message: string } | null>(
    null
  );
  const [period, setPeriod] = useState<InsightPeriod>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "score",
    dir: "desc",
  });
  const [theme, setTheme] = useState(ALL);
  const [character, setCharacter] = useState(ALL);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  // A star follows each press at once and stays focusable. One save per story
  // at a time: a press while one is out is sent when it settles.
  const saving = useRef<Set<number>>(new Set());
  const wanted = useRef<Map<number, boolean>>(new Map());
  // What the server holds for a story while its saves are out.
  const confirmed = useRef<Map<number, boolean>>(new Map());

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
    () => (data ? storyInsights(data.stories, data.totals, data.taps, period) : []),
    [data, period]
  );
  // Out, or already read: the rest have nothing to show.
  const live = useMemo(
    () => all.filter((s) => (s.releaseAt && Date.parse(s.releaseAt) <= now) || s.views > 0),
    [all, now]
  );
  const summary = useMemo(() => summarise(live, now), [live, now]);
  const trend = useMemo(() => (data ? weeklyTrend(data.weeks) : []), [data]);
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

  const mark = (ep: number, value: boolean) =>
    setData((d) =>
      d
        ? {
            ...d,
            stories: d.stories.map((s) => (s.ep === ep ? { ...s, shortlisted: value } : s)),
          }
        : d
    );

  const save = async (ep: number) => {
    saving.current.add(ep);
    try {
      for (;;) {
        const on = wanted.current.get(ep) ?? false;
        await portalApi.setShortlist(ep, on);
        confirmed.current.set(ep, on);
        if (wanted.current.get(ep) === on) break;
      }
    } catch (err) {
      mark(ep, confirmed.current.get(ep) ?? false);
      setShortlistError({ ep, message: errorMessage(err) });
    } finally {
      wanted.current.delete(ep);
      saving.current.delete(ep);
    }
  };

  const toggleShortlist = (ep: number, on: boolean) => {
    if (!data) return;
    // With no save out, the star shows what the server holds.
    if (!saving.current.has(ep)) confirmed.current.set(ep, !on);
    wanted.current.set(ep, on);
    mark(ep, on);
    setShortlistError((e) => (e?.ep === ep ? null : e));
    if (!saving.current.has(ep)) void save(ep);
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
          printed volume and to see which themes land. Your own reading, guesses and answers
          aren&apos;t counted while you&apos;re signed in.
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
            <CardContent className="space-y-2 p-2 sm:p-4">
              <div aria-hidden="true">
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
                      <LineChart
                        data={trend}
                        margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                        // Hidden from screen readers (the table below has the
                        // figures), so the SVG mustn't be a tab stop either.
                        accessibilityLayer={false}
                      >
                        <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                        <XAxis dataKey="week" stroke={chartTheme.axisColor} fontSize={11} />
                        <YAxis allowDecimals={false} stroke={chartTheme.axisColor} fontSize={11} />
                        <Tooltip contentStyle={chartTheme.tooltipStyle} />
                        <Legend wrapperStyle={chartTheme.legendStyle} />
                        {TREND_LINES.map((line) => (
                          <Line
                            key={line.key}
                            type="monotone"
                            dataKey={line.key}
                            name={line.name}
                            stroke={line.color}
                            strokeDasharray={line.dash}
                            strokeWidth={2}
                            dot={false}
                            // The legend draws each line's own dashes.
                            legendType="plainline"
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Chart>
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">
                  Week by week as a table
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Views, readers and loves, week by week</caption>
                    <thead className="text-xs text-sub">
                      <tr>
                        <th scope="col" className="p-2 font-medium">
                          Week of
                        </th>
                        {TREND_LINES.map((line) => (
                          <th key={line.key} scope="col" className="p-2 font-medium">
                            {line.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trend.map((point) => (
                        <tr key={point.week} className="border-t border-border">
                          <th scope="row" className="p-2 font-medium text-text">
                            {point.week}
                          </th>
                          <td className="p-2 text-text">{point.views}</td>
                          <td className="p-2 text-text">{point.readers}</td>
                          <td className="p-2 text-text">{point.loves}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
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
          <div
            data-scroll-box
            className="overflow-x-auto rounded-lg border border-border scroll-pl-[12.5rem] sm:scroll-pl-[16rem]"
          >
            <span id="insights-new-tab" hidden>
              Opens in a new tab
            </span>
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">
                Stories, sorted by {COLUMNS.find((c) => c.key === sort.key)?.label},{" "}
                {sort.dir === "desc" ? "highest first" : "lowest first"}
              </caption>
              <thead className="bg-surface text-xs text-sub">
                <tr>
                  <th
                    scope="col"
                    data-pinned
                    className="sticky left-0 z-10 w-12 bg-surface p-0.5 font-medium"
                  >
                    <span className="sr-only">Shortlist</span>
                  </th>
                  <th
                    scope="col"
                    data-pinned
                    data-pinned-edge
                    className="sticky left-12 z-10 w-[9.5rem] bg-surface p-2 font-medium sm:w-[13rem]"
                  >
                    Story
                  </th>
                  {COLUMNS.map((c) => (
                    <SortHeader key={c.key} column={c} sort={sort} onSort={sortBy} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.ep} className="border-t border-border align-top">
                    <td data-pinned className="sticky left-0 z-10 w-12 bg-card p-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-pressed={s.shortlisted}
                        aria-label={`Shortlist episode ${s.ep}`}
                        onClick={() => toggleShortlist(s.ep, !s.shortlisted)}
                        className="size-11"
                      >
                        <Star
                          className={cn("size-5", s.shortlisted && "fill-current text-accent")}
                          aria-hidden="true"
                        />
                      </Button>
                    </td>
                    <th
                      scope="row"
                      data-pinned
                      className="sticky left-12 z-10 w-[9.5rem] bg-card p-2 font-medium text-text sm:w-[13rem]"
                    >
                      {/* A set width: the table squeezes cells to their narrowest otherwise. */}
                      <div className="w-[7.5rem] sm:w-[11rem]">
                        <a
                          href={comicHref(s.ep)}
                          target="_blank"
                          rel="noreferrer"
                          aria-describedby="insights-new-tab"
                          className="underline"
                        >
                          {s.title}
                        </a>
                        {shortlistError?.ep === s.ep ? (
                          <span role="alert" className="mt-1 block text-xs font-normal text-danger">
                            {shortlistError.message}
                          </span>
                        ) : null}
                      </div>
                    </th>
                    {COLUMNS.map((c) => (
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
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">
            What the columns mean
          </summary>
          <dl className="mt-2 space-y-2 text-sm">
            {FIGURES.map((c) => (
              <div key={c.key}>
                <dt className="font-medium text-text">{c.label}</dt>
                <dd className="text-sub">{c.meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
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
  column: { key: SortKey; label: string };
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
        onClick={() => onSort(column.key)}
        onFocus={keepClearOfPinned}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center gap-1 whitespace-nowrap rounded px-1 text-left hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          active && "text-text"
        )}
      >
        {column.label}
        <span aria-hidden="true" className="inline-block w-3">
          {active ? (sort.dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}
