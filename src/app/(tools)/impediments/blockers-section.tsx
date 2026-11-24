"use client";

/**
 * Impediment Tracker's "Blockers: where the time goes": every blocked spell
 * on a story or a Flow-board card and every impediment raised in the
 * window, by cluster, ranked on a Pareto chart (lib/impediments/blockers,
 * which Amr's tool.impediments.list_blockers reads too); inside the team
 * against outside it; how blocked time hit the work that finished; the
 * blockers not clustered yet, each with a cluster to pick; and a cluster
 * raised as one impediment. Every write has Undo; Amr's clusters wait for
 * the person to accept them.
 */

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Layers, Plus } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ChartFigure } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { AiSource } from "@/lib/ai/task-types";
import {
  CLUSTER_BLOCKERS_MAX,
  CLUSTER_KNOWN_MAX,
  CLUSTER_TEXT_MAX,
  cleanClusters,
  fitClusterInput,
  impedimentsClusterTask,
  type ClusterBlockersInput,
} from "@/lib/ai/tasks/impediments.lite";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  blockedWorkSentence,
  blockersByMonth,
  cleanClusterName,
  clusterImpediment,
  clusterKey,
  clusterSideOf,
  lastDays,
  openImpedimentFor,
  readBlockers,
  type BlockerRow,
} from "@/lib/impediments/blockers";
import { DEFAULT_BLOCKER_CLUSTERS } from "@/lib/impediments/clusters";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BLOCKER_CLUSTER_MAX,
  KANBAN_BOARD_ID,
  type BlockSide,
  type Impediment,
  type KanbanBoard,
  type Story,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import type { Validation } from "@/lib/utils/form";
import { exampleId, isExampleId } from "@/lib/utils/example-id";
import { undoable } from "@/lib/utils/undoable";
import {
  clusterWrite,
  sameCluster,
  undoChanges,
  type BlockerData,
  type ClusterChange,
  type ClusterTarget,
  type ClusterWrite,
} from "./blocker-writes";
import { dayLabel } from "./helpers";

// Recharts loads with the chart, not the page.
const BlockersParetoChart = dynamic(
  () => import("./blockers-chart").then((m) => m.BlockersParetoChart),
  { ssr: false }
);

/**
 * Focus what `find` returns once React has re-rendered: a clustered row
 * leaves the list, and focus would otherwise drop to <body>.
 */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

const NO_STORIES: Story[] = [];
const NO_BOARDS: KanbanBoard[] = [];

const SIDE_LABEL: Record<BlockSide, string> = { internal: "Inside", external: "Outside" };

type View = "30" | "90" | "180" | "months";

const VIEWS: { value: View; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "months", label: "By month" },
];

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const NEW_CLUSTER = "__new__";

/** "Not clustered yet" rows shown before "Show all". */
export const UNCLUSTERED_ROWS_SHOWN = 20;

/** A new cluster's name: there, and short enough. */
export function validateClusterName(name: string): Validation<string, "cluster"> {
  const clean = cleanClusterName(name);
  if (!clean) return { ok: false, errors: { cluster: "Name the cluster." } };
  if (name.trim().replace(/\s+/g, " ").length > BLOCKER_CLUSTER_MAX)
    return { ok: false, errors: { cluster: `At most ${BLOCKER_CLUSTER_MAX} characters.` } };
  return { ok: true, values: clean };
}

const targetOf = (r: BlockerRow): ClusterTarget => ({
  kind: r.kind,
  id: r.id,
  ...(r.spellFrom ? { spellFrom: r.spellFrom } : {}),
});

/** What the AI reads for a blocker: an impediment's title and description, a spell's cause, else the item. */
function blockerText(r: BlockerRow): string {
  const text =
    r.kind === "impediment"
      ? [r.title, r.cause].filter(Boolean).join(". ")
      : r.cause || `Blocked: ${r.title}`;
  return cutText(text.replace(/\s+/g, " ").trim(), CLUSTER_TEXT_MAX) || "Blocked";
}

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** One suggested cluster, mapped back to its blockers. */
interface ClusterSuggestion {
  name: string;
  side: BlockSide;
  targets: ClusterTarget[];
  titles: string[];
}

function currentData(): BlockerData {
  const s = useWorkspaceStore.getState();
  return {
    impediments: s.impediments ?? [],
    stories: s.stories ?? [],
    board: (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID) ?? null,
  };
}

/** One write per collection: the impediments that change, the stories, and the board. */
function applyWrite(w: ClusterWrite) {
  if (w.impediments.length) {
    const byId = new Map(w.impediments.map((i) => [i.id, i]));
    useWorkspaceStore.setState((s) => ({
      impediments: s.impediments.map((i) => byId.get(i.id) ?? i),
    }));
  }
  if (w.stories.length) useWorkspaceStore.getState().bulkUpsertStories(w.stories);
  if (w.board) useWorkspaceStore.getState().upsertKanbanBoard(w.board);
}

export function BlockersSection({
  impediments,
  today,
  onShowImpediment,
  actions,
}: {
  /** The tracker's impediments, as the page shows them. */
  impediments: readonly Impediment[];
  today: string;
  /** Takes the person to an impediment's card in the tracker's list (a raised cluster's). */
  onShowImpediment?: (id: string) => void;
  /** Beside the title: the page's export, while there is no list of impediments to carry it. */
  actions?: ReactNode;
}) {
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const boards = useWorkspaceStore((s) => s.kanbanBoards) ?? NO_BOARDS;
  const cards = useMemo(() => boards.find((b) => b.id === KANBAN_BOARD_ID)?.cards ?? [], [boards]);
  const { log } = useHistoryLogger("impediments");
  const [view, setView] = useState<View>("90");
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState("");
  const [suggested, setSuggested] = useState<{
    items: ClusterSuggestion[];
    source: AiSource;
    left: number;
  } | null>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<{ byShortId: Map<string, BlockerRow>; sent: Set<string>; left: number }>({
    byShortId: new Map(),
    sent: new Set(),
    left: 0,
  });

  const windowDays = view === "months" ? 180 : Number(view);
  const read = useMemo(
    // The page's own example lives in the workspace, so it is read here too.
    () =>
      readBlockers(stories, cards, impediments, lastDays(windowDays, today, now), {
        includeExamples: true,
      }),
    [stories, cards, impediments, windowDays, today, now]
  );
  const months = useMemo(
    () => (view === "months" ? blockersByMonth(read.rows, read.pareto.measure) : []),
    [view, read]
  );
  // Newest first (the read sorts them), so the AI's fitter trims the oldest.
  const unclustered = read.unclustered;
  const [allRows, setAllRows] = useState(false);
  const shownRows = allRows ? unclustered : unclustered.slice(0, UNCLUSTERED_ROWS_SHOWN);
  const listRef = useRef<HTMLUListElement>(null);
  const verdictRef = useRef<HTMLParagraphElement>(null);
  /** Every cluster on offer: the defaults, then the ones the team named. */
  const known = useMemo(() => {
    const seen = new Set(DEFAULT_BLOCKER_CLUSTERS.map((c) => clusterKey(c.label)));
    const own: string[] = [];
    for (const name of [...impediments.map((i) => i.cluster), ...read.rows.map((r) => r.cluster)]) {
      const key = clusterKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      own.push(cleanClusterName(name as string));
    }
    return { defaults: DEFAULT_BLOCKER_CLUSTERS.map((c) => c.label), own };
  }, [impediments, read.rows]);

  const byDays = read.pareto.measure === "blocked_days";
  const unit = byDays ? "blocked days" : "impediments raised";

  /* ── Writes ── */

  function writeClusters(changes: ClusterChange[], label: string): number {
    const w = clusterWrite(currentData(), changes);
    if (w.before.length === 0) return 0;
    undoable({
      label,
      kind: "success",
      apply: () => applyWrite(w),
      revert: () => {
        const data = currentData();
        applyWrite(clusterWrite(data, undoChanges(w.before, data)));
      },
    });
    return w.before.length;
  }

  function pick(row: BlockerRow, cluster: string, side?: BlockSide) {
    // A cluster the team named keeps the side it was given: written on every row it goes on.
    const sideTo = side ?? clusterSideOf(cluster, read.rows, impediments) ?? undefined;
    const at = shownRows.findIndex((r) => r.key === row.key);
    const n = writeClusters(
      sameCluster([targetOf(row)], cluster, sideTo),
      `Put “${row.title}” under ${cluster}`
    );
    if (n === 0) return;
    log(IMPEDIMENT_ACTIONS.BLOCKERS_CLUSTERED, { blockers: 1, clusters: 1, source: "manual" });
    setStatus(`Put “${row.title}” under ${cluster}.`);
    // The row leaves the list: focus the row that took its place, else the one
    // before it, else the verdict, rather than dropping to the page.
    focusSoon(() => {
      const selects = listRef.current?.querySelectorAll<HTMLElement>("select");
      if (!selects || selects.length === 0) return verdictRef.current;
      return selects[Math.min(Math.max(at, 0), selects.length - 1)];
    });
  }

  function acceptClusters(list: ClusterSuggestion[], source: AiSource) {
    const changes = list.flatMap((s) => sameCluster(s.targets, s.name, s.side));
    const n = writeClusters(
      changes,
      list.length === 1
        ? `Clustered ${changes.length} under ${list[0].name}`
        : `Clustered ${changes.length} blockers`
    );
    if (n === 0) return;
    // "rules" for the no-AI suggestions, as the other tools' AI moments log it.
    log(IMPEDIMENT_ACTIONS.BLOCKERS_CLUSTERED, {
      blockers: n,
      clusters: list.length,
      source: source === "ai" ? "ai" : "rules",
    });
    setStatus(`Clustered ${n} ${n === 1 ? "blocker" : "blockers"}.`);
    // Clustering the last ones takes the whole "Not clustered yet" block (its
    // list, its button) away: focus goes to the verdict rather than the page.
    focusSoon(() => {
      const at = document.activeElement;
      return !at || at === document.body || !at.isConnected ? verdictRef.current : null;
    });
  }

  function raise(cluster: string) {
    const members = read.rows.filter((r) => clusterKey(r.cluster) === clusterKey(cluster));
    // A cluster made only of the example's rows raises an example row, which "Clear example" takes too.
    const uuid = crypto.randomUUID();
    const id =
      members.length > 0 && members.every((r) => isExampleId(r.id)) ? exampleId(uuid) : uuid;
    const item = clusterImpediment(read.rows, cluster, { id, today, from: read.window.from });
    const size = members.length;
    undoable({
      label: `Raised “${item.title}”`,
      kind: "success",
      apply: () => useWorkspaceStore.getState().upsertImpediment(item),
      revert: () => useWorkspaceStore.getState().removeImpediment(item.id),
    });
    log(IMPEDIMENT_ACTIONS.CLUSTER_RAISED, { impedimentId: item.id, size });
    setStatus(`Raised “${item.title}” as an impediment.`);
  }

  /* ── Amr ── */

  const buildInput = (): ClusterBlockersInput => {
    const byShortId = new Map<string, BlockerRow>();
    const blockers = unclustered.slice(0, CLUSTER_BLOCKERS_MAX).map((r, i) => {
      const id = `b${i + 1}`;
      byShortId.set(id, r);
      return { id, text: blockerText(r) };
    });
    const fitted = fitClusterInput({
      blockers,
      known: [...known.own, ...known.defaults].slice(0, CLUSTER_KNOWN_MAX),
    });
    sentRef.current = {
      byShortId,
      sent: new Set(fitted.blockers.map((b) => b.id)),
      left: unclustered.length - fitted.blockers.length,
    };
    return fitted;
  };

  const showClusters = (
    answer: { clusters: { name: string; side: BlockSide; ids: string[] }[] },
    source: AiSource
  ) => {
    const { byShortId, sent, left } = sentRef.current;
    const items = cleanClusters(answer.clusters, sent).flatMap((c) => {
      const rows = c.ids.flatMap((id) => {
        const r = byShortId.get(id);
        return r ? [r] : [];
      });
      if (rows.length === 0) return [];
      return [
        {
          name: cleanClusterName(c.name),
          side: c.side,
          targets: rows.map(targetOf),
          titles: rows.map((r) => r.title),
        },
      ];
    });
    setSuggested({ items, source, left });
  };

  return (
    <section aria-label="Blockers: where the time goes">
      <SectionCard
        title="Blockers: where the time goes"
        icon={Layers}
        actions={actions}
        contentClassName="space-y-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-text" aria-hidden="true">
              Window
            </span>
            <ToggleGroup
              label="Blockers window"
              size="sm"
              options={VIEWS}
              value={view}
              onValueChange={(v: View) => setView(v)}
            />
          </div>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-text empty:hidden">
          {status}
        </p>
        {/* Focus lands here once the last blocker to cluster has gone. */}
        <p ref={verdictRef} tabIndex={-1} className="text-sm font-medium text-text outline-none">
          {read.verdict}
        </p>

        {read.rows.length === 0 ? (
          <p className="text-sm text-sub">
            Nothing was blocked in the last {windowDays} days. Stories and cards flagged as blocked
            on the Sprint and Flow boards show here, with the impediments raised.
          </p>
        ) : (
          <>
            {read.pareto.clusters.length > 0 && view !== "months" && (
              <ChartFigure
                label="Blocker clusters, most first"
                summary={read.pareto.sentence ?? ""}
                caption="Blocker clusters"
                table={{
                  columns: [
                    "Cluster",
                    "Inside or outside",
                    "Blocked items",
                    "Blocked days",
                    "Impediments",
                    "Days open",
                  ],
                  rows: read.pareto.clusters.map((c) => [
                    c.cluster,
                    SIDE_LABEL[c.side],
                    c.items,
                    c.blockedDays,
                    c.impediments,
                    c.daysOpen,
                  ]),
                }}
                plotClassName="min-h-[160px]"
              >
                <BlockersParetoChart
                  unit={unit}
                  data={read.pareto.clusters.map((c) => ({
                    name: c.cluster,
                    value: byDays ? c.blockedDays : c.impediments,
                    vital: c.vital,
                  }))}
                />
              </ChartFigure>
            )}

            {view === "months" && (
              <ul className="space-y-1 text-sm" aria-label="Top clusters per month">
                {months.map((m) => (
                  <li key={m.month} className="text-text">
                    <span className="font-medium">{monthLabel(m.month)}:</span>{" "}
                    {m.top
                      .map((t) => `${t.cluster} ${byDays ? days(t.value) : `${t.value}`}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            )}

            {read.pareto.clusters.length > 0 && (
              <ul className="space-y-2" aria-label="Clusters to raise">
                {read.pareto.clusters
                  .filter((c) => c.vital)
                  .map((c) => {
                    const open = openImpedimentFor(impediments, c.cluster);
                    return (
                      <li key={c.cluster} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 break-words text-text">
                          {c.cluster}{" "}
                          <span className="text-xs text-sub">
                            ({SIDE_LABEL[c.side].toLowerCase()}
                            {byDays ? `, ${days(c.blockedDays)}` : `, ${c.impediments} raised`})
                          </span>
                        </span>
                        {open && onShowImpediment ? (
                          <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-sub">
                            Raised as
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto max-w-full whitespace-normal break-words px-1 text-left md-fine:h-auto"
                              aria-label={`Open “${open.title}”`}
                              onClick={() => onShowImpediment(open.id)}
                            >
                              “{open.title}”
                            </Button>
                          </span>
                        ) : open ? (
                          <span className="text-xs text-sub">Raised as “{open.title}”</span>
                        ) : (
                          // A long cluster name wraps inside the button: it never pushes a phone sideways.
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-auto max-w-full whitespace-normal break-words py-1.5 text-left md-fine:h-auto"
                            onClick={() => raise(c.cluster)}
                          >
                            <Plus aria-hidden="true" />
                            Raise “{c.cluster}” as an impediment
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}

            <p className="text-sm text-text">
              {read.split.externalPct === null
                ? "Nothing clustered inside or outside the team yet."
                : `Inside the team: ${byDays ? days(read.split.internal.blockedDays) : `${read.split.internal.impediments} impediments`}. Outside it: ${byDays ? days(read.split.external.blockedDays) : `${read.split.external.impediments} impediments`} (${read.split.externalPct}%).`}
            </p>
          </>
        )}

        <div className="space-y-1">
          <p className="text-sm text-text">
            {read.blockedWork
              ? blockedWorkSentence(read.blockedWork)
              : `Blocked time counts from ${dayLabel(read.trackingSince, true)}. Finish 5 items started since then to see how blocked time hit them.`}
          </p>
          {read.untracked > 0 && (
            <p className="text-xs text-sub">
              {read.untracked} {read.untracked === 1 ? "item was" : "items were"} blocked before
              tracking began: blocked since before tracking, so{" "}
              {read.untracked === 1 ? "its" : "their"} time isn&apos;t counted.
            </p>
          )}
        </div>

        {unclustered.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2" ref={askRef}>
              <h3 className="text-sm font-semibold text-text">
                Not clustered yet ({unclustered.length})
              </h3>
              <AiButton
                task={impedimentsClusterTask}
                label="Cluster with AI"
                fallbackLabel="Group by keywords"
                variant="outline"
                input={buildInput}
                onResult={(answer, meta) => showClusters(answer, meta.source)}
              />
            </div>
            {suggested && suggested.items.length > 0 && (
              <AiSuggestions
                items={suggested.items}
                source={suggested.source}
                title="Clusters to accept"
                acceptLabel="Accept"
                itemKey={(s) => s.name}
                render={(s) => ({
                  title: `${s.name} (${SIDE_LABEL[s.side].toLowerCase()}): ${s.targets.length} ${s.targets.length === 1 ? "blocker" : "blockers"}`,
                  detail: s.titles.slice(0, 3).join(" · "),
                })}
                onAccept={(s) => acceptClusters([s], suggested.source)}
                onAcceptAll={(list) => acceptClusters(list, suggested.source)}
                onDismiss={() => setSuggested(null)}
                returnFocus={() =>
                  askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')
                }
              />
            )}
            {suggested && suggested.left > 0 && (
              <p className="text-xs text-sub">
                {suggested.left} {suggested.left === 1 ? "blocker didn't" : "blockers didn't"} fit:
                cluster {suggested.left === 1 ? "it" : "them"} next.
              </p>
            )}
            <ul
              ref={listRef}
              className="divide-y divide-border rounded-lg border border-border"
              aria-label="Blockers to cluster"
            >
              {shownRows.map((r) => (
                <UnclusteredRow key={r.key} row={r} known={known} onPick={pick} />
              ))}
            </ul>
            {unclustered.length > UNCLUSTERED_ROWS_SHOWN && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAllRows((v) => !v)}>
                {allRows ? "Show fewer" : `Show all ${unclustered.length}`}
              </Button>
            )}
          </div>
        )}
      </SectionCard>
    </section>
  );
}

function UnclusteredRow({
  row,
  known,
  onPick,
}: {
  row: BlockerRow;
  known: { defaults: string[]; own: string[] };
  onPick: (row: BlockerRow, cluster: string, side?: BlockSide) => void;
}) {
  // Choosing is apart from writing: on Windows a closed select changes on
  // each arrow key, and a write on change would take the row away mid-way.
  const [choice, setChoice] = useState("");
  const [name, setName] = useState("");
  const [side, setSide] = useState<BlockSide>("internal");
  const [error, setError] = useState<string | null>(null);
  const adding = choice === NEW_CLUSTER;
  const kind = row.kind === "impediment" ? "Impediment" : row.kind === "story" ? "Story" : "Card";

  const save = () => {
    const v = validateClusterName(name);
    if (!v.ok) {
      setError(v.errors.cluster ?? "Name the cluster.");
      return;
    }
    onPick(row, v.values, side);
    setChoice("");
    setName("");
    setError(null);
  };

  return (
    <li className="space-y-2 px-3 py-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_18rem] sm:items-center">
        <div className="min-w-0">
          <p className="break-words text-sm text-text">{row.title}</p>
          <p className="break-words text-xs text-sub">
            {kind}
            {row.cause && row.kind !== "impediment" ? ` · ${row.cause}` : ""}
            {row.kind !== "impediment"
              ? ` · ${days(Math.round(row.blockedDays * 10) / 10)} blocked`
              : ""}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            aria-label={`Cluster for ${row.title}`}
            className={`${SELECT_CLASS} min-w-0 flex-1`}
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setError(null);
            }}
          >
            <option value="">Pick a cluster</option>
            <optgroup label="Usual clusters">
              {known.defaults.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
            {known.own.length > 0 && (
              <optgroup label="Your clusters">
                {known.own.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW_CLUSTER}>New cluster…</option>
          </select>
          {!adding && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={!choice}
              aria-label={`Set the cluster for ${row.title}`}
              onClick={() => choice && onPick(row, choice)}
            >
              Set
            </Button>
          )}
        </div>
      </div>
      {adding && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <label className="text-sm text-text" htmlFor={`cluster-${row.key}`}>
              New cluster
            </label>
            <Input
              id={`cluster-${row.key}`}
              value={name}
              maxLength={BLOCKER_CLUSTER_MAX}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
            {error && (
              <p className="text-xs text-danger" role="alert">
                {error}
              </p>
            )}
          </div>
          <ToggleGroup
            label="Inside or outside the team"
            size="sm"
            options={[
              { value: "internal", label: "Inside" },
              { value: "external", label: "Outside" },
            ]}
            value={side}
            onValueChange={(v: BlockSide) => setSide(v)}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save}>
              Save cluster
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setChoice("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
