"use client";

import { useMemo, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Archive, ArchiveRestore, Mountain, Plus, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton } from "@/components/ai";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { generateHillChartPrompts } from "@/lib/ai-prompts/hill-chart";
import { hillChartUpdateNoteTask, updateNoteInput } from "@/lib/ai/tasks/hill-chart.lite";
import type { UpdateNoteOutput } from "@/lib/ai/tasks/hill-chart.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { cheer } from "@/lib/celebrate/cheer";
import { findLink } from "@/lib/handoffs/registry";
import type { HandoffLink } from "@/lib/handoffs/types";
import { HILL_CHART_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  HILL_CHART_ID_PREFIX,
  HILL_CHECK_IN_ID_PREFIX,
  HILL_SCOPE_ID_PREFIX,
  checkIn,
  checkInsNewestFirst,
  daysSinceMove,
  hasRoomForScope,
  isStuck,
  lastCheckIn,
  localDay,
  moveScope,
  movement,
  movementText,
  newScope,
  overTheHill,
  readHillCharts,
  reachedDone,
  scopeMismatch,
  scopeSource,
  sideOf,
  type ScopeValues,
} from "@/lib/hill-chart/model";
import { EPIC_ROADMAP_ID } from "@/lib/roadmap/epic-source";
import { STORY_STATUS_LABEL, epicRollup, linkedStories, rollupLabel } from "@/lib/roadmap/rollup";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TOOL_TEXT_MAX,
  type Epic,
  type HillChart,
  type HillScope,
  type Sprint,
  type Story,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { ChartFields, SELECT_CLASS, ScopeFields, type LinkOption } from "./fields";
import {
  EMPTY_CHART,
  EMPTY_SCOPE,
  validateChart,
  validateScope,
  type ChartDraft,
  type ChartField,
  type ChartValues,
  type ScopeDraft,
  type ScopeField,
} from "./form";
import { HillView } from "./hill";
import { hillChartMarkdown } from "./markdown";
import { ScopeRow } from "./scope-row";
import { currentCharts, findChart, patchChart, removeChart, saveChart } from "./store";

export const TOOL_ID = "hill-chart";

const NO_STORIES: Story[] = [];
const NO_SPRINTS: Sprint[] = [];
const NO_EPICS: Epic[] = [];

const EXAMPLE_BLOCKED =
  "The example's scopes stay here: clear the example and add your own to raise them.";

const nowIso = () => new Date().toISOString();
const short = (text: string, max = 40) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Focus the element `find` returns once React has re-rendered. */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}
const byData = (attr: string, id: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
    (e) => e.getAttribute(attr) === id
  );

/**
 * Hill Chart: each piece of work (a scope) on a hill, uphill while the team
 * is still working out how to do it, downhill once it only needs doing. A
 * dot drags along the hill or takes arrow keys, and a number box under the
 * hill moves it too. Weekly check-ins keep the positions with a note, and
 * any earlier check-in shows what moved forward, back or not at all. A
 * scope that sits uphill for a week is stuck: it can be raised as an
 * impediment, with Undo. A linked story that disagrees shows "Check". Amr
 * drafts the week's update (a template without AI), which goes into the
 * chart only when it is saved as the check-in note. Everything lives in
 * workspace.hillCharts, which Amr's verbs and the next step read too.
 */
export function HillChartClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.hillCharts);
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const roadmaps = useWorkspaceStore((s) => s.epicRoadmaps);
  // Read so a scope's "Sent to … · Open" follows its impediment being resolved or removed.
  useWorkspaceStore((s) => s.impediments);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const charts = useMemo(() => readHillCharts(raw), [raw]);
  // "Now" moves on with each write, so days since a move stay true without a ticking clock.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `raw` is the trigger, on purpose.
  const now = useMemo(() => new Date(), [raw]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingScope, setEditingScope] = useState<string | null>(null);
  const [sinceId, setSinceId] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState("");
  const [update, setUpdate] = useState<
    (UpdateNoteOutput & { chartId: string; source: AiSource }) | null
  >(null);

  const visible = charts.filter((c) => showArchived || !c.archived || c.id === selectedId);
  const chart = charts.find((c) => c.id === selectedId) ?? charts.find((c) => !c.archived) ?? null;
  const hasExample = hasExampleItems(charts);

  const epics = (roadmaps ?? []).find((d) => d.id === EPIC_ROADMAP_ID)?.epics ?? NO_EPICS;
  const storyById = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const epicById = useMemo(() => new Map(epics.map((e) => [e.id, e])), [epics]);
  const storyOptions: LinkOption[] = useMemo(
    () =>
      stories
        .filter((s) => !isExampleId(s.id))
        .map((s) => ({ id: s.id, label: short(s.title || "Untitled story", 60) })),
    [stories]
  );
  const epicOptions: LinkOption[] = useMemo(
    () => epics.map((e) => ({ id: e.id, label: short(e.title || "Untitled epic", 60) })),
    [epics]
  );
  const sprintOptions: LinkOption[] = useMemo(
    () =>
      sprintsNewestFirst(sprints)
        .filter((s) => !isExampleId(s.id))
        .map((s) => ({ id: s.id, label: short(s.name || "Sprint", 60) })),
    [sprints]
  );

  const history = chart ? checkInsNewestFirst(chart) : [];
  const since = chart
    ? (chart.checkIns.find((c) => c.id === sinceId) ?? lastCheckIn(chart))
    : undefined;
  const moves = chart ? movement(chart, since) : [];
  const moveById = new Map(moves.map((m) => [m.scopeId, m]));
  const stuck = chart ? chart.scopes.filter((s) => isStuck(s, now)) : [];
  const stuckIds = new Set(stuck.map((s) => s.id));
  const today = localDay(now);
  const checkedToday = chart ? chart.checkIns.some((c) => localDay(c.at) === today) : false;

  const markdown = useMemo(
    () => (chart ? hillChartMarkdown(chart, now, stories) : "# Hill chart\n\nNo charts yet.\n"),
    [chart, now, stories]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Hill Chart",
      prompts: chart
        ? generateHillChartPrompts({
            title: chart.title,
            scopes: chart.scopes.map((s) => ({
              title: s.title,
              position: s.position,
              side: sideOf(s.position),
              daysSinceMove: daysSinceMove(s, now),
              stuck: isStuck(s, now),
            })),
            checkIns: checkInsNewestFirst(chart).map((c) => ({
              day: localDay(c.at),
              ...(c.note ? { note: c.note } : {}),
            })),
          })
        : [],
    }),
    [chart, now]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's changes aren't the team's history.
  const record = (chartId: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(chartId)) log(action, { chartId, ...payload });
  };

  const createChart = (v: ChartValues) => {
    const at = nowIso();
    const id = `${HILL_CHART_ID_PREFIX}${nanoid(8)}`;
    saveChart({ id, ...v, scopes: [], checkIns: [], createdAt: at, updatedAt: at });
    record(id, HILL_CHART_ACTIONS.CHART_CREATED, {
      ...(v.sprintId ? { sprintId: v.sprintId } : {}),
      ...(v.epicId ? { epicId: v.epicId } : {}),
    });
    setSelectedId(id);
    setCreating(false);
    announce(`Started the hill chart “${short(v.title)}”`);
  };

  /** A change to the chart with Undo (the chart as it was comes back). */
  const changeChart = (c: HillChart, label: string, fn: (x: HillChart) => HillChart) => {
    const before = findChart(c.id);
    if (!before) return;
    undoable({
      label,
      apply: () => {
        patchChart(c.id, fn);
        record(c.id, HILL_CHART_ACTIONS.CHART_UPDATED, {});
      },
      revert: () => saveChart(before),
    });
    announce(label);
  };

  const toggleArchive = (c: HillChart) => {
    const archiving = !c.archived;
    changeChart(c, `${archiving ? "Archived" : "Restored"} “${short(c.title)}”`, (x) => {
      const next = { ...x };
      if (archiving) next.archived = true;
      else delete next.archived;
      return next;
    });
    if (archiving && !showArchived) setSelectedId(null);
  };

  const removeWholeChart = (c: HillChart) => {
    let removed: HillChart | null = null;
    const label = `Deleted the hill chart “${short(c.title)}”`;
    undoable({
      label,
      apply: () => {
        removed = removeChart(c.id);
        record(c.id, HILL_CHART_ACTIONS.CHART_REMOVED, {});
      },
      revert: () => {
        if (removed) saveChart(removed);
      },
    });
    setSelectedId(null);
    announce(label);
  };

  const addScope = (c: HillChart, values: ScopeValues) => {
    const current = findChart(c.id);
    if (!current) return;
    if (!hasRoomForScope(current)) {
      announce("This chart is full: 30 scopes. Remove one first.");
      return;
    }
    const scope = newScope(values, `${HILL_SCOPE_ID_PREFIX}${nanoid(8)}`, nowIso());
    patchChart(c.id, (x) => ({ ...x, scopes: [...x.scopes, scope] }));
    record(c.id, HILL_CHART_ACTIONS.SCOPE_ADDED, {
      scopeId: scope.id,
      ...(scope.storyId ? { storyId: scope.storyId } : {}),
      ...(scope.epicId ? { epicId: scope.epicId } : {}),
    });
    announce(`Added “${short(scope.title)}” at ${scope.position}`);
  };

  /** One move, saved once it ends (the hill or the number box). */
  const move = (c: HillChart, scopeId: string, position: number) => {
    const before = findChart(c.id)?.scopes.find((s) => s.id === scopeId);
    if (!before) return;
    const saved = patchChart(c.id, (x) => moveScope(x, scopeId, position, nowIso()));
    const after = saved?.scopes.find((s) => s.id === scopeId);
    if (!after || after.position === before.position) return;
    record(c.id, HILL_CHART_ACTIONS.SCOPE_MOVED, {
      scopeId,
      from: before.position,
      to: after.position,
    });
    if (reachedDone(before.position, after.position) && !isExampleId(c.id)) {
      log(HILL_CHART_ACTIONS.SCOPE_DONE, { chartId: c.id, scopeId });
      cheer(TOOL_ID, "milestone");
    }
    announce(`Saved: ${short(after.title)} at ${after.position}, ${sideOf(after.position)}`);
  };

  const editScope = (c: HillChart, scope: HillScope, values: ScopeValues) => {
    patchChart(c.id, (x) => {
      const moved = values.position !== scope.position;
      const next = moved ? moveScope(x, scope.id, values.position, nowIso()) : x;
      return {
        ...next,
        scopes: next.scopes.map((s) => {
          if (s.id !== scope.id) return s;
          const edited: HillScope = { ...s, title: values.title };
          for (const k of ["storyId", "epicId", "note"] as const) {
            if (values[k]) edited[k] = values[k];
            else delete edited[k];
          }
          return edited;
        }),
      };
    });
    if (values.position !== scope.position) {
      record(c.id, HILL_CHART_ACTIONS.SCOPE_MOVED, {
        scopeId: scope.id,
        from: scope.position,
        to: values.position,
      });
      if (reachedDone(scope.position, values.position) && !isExampleId(c.id)) {
        log(HILL_CHART_ACTIONS.SCOPE_DONE, { chartId: c.id, scopeId: scope.id });
        cheer(TOOL_ID, "milestone");
      }
    }
    record(c.id, HILL_CHART_ACTIONS.CHART_UPDATED, {});
    announce(`Saved “${short(values.title)}”`);
    focusSoon(() => byData("data-scope-title", scope.id));
  };

  const removeScope = (c: HillChart, scope: HillScope) => {
    const list = c.scopes;
    const at = list.findIndex((s) => s.id === scope.id);
    const near = list[at + 1] ?? list[at - 1];
    const label = `Deleted “${short(scope.title)}”`;
    removeWithUndo<HillScope>({
      label,
      update: (fn) => patchChart(c.id, (x) => ({ ...x, scopes: fn(x.scopes) })),
      match: (s) => s.id === scope.id,
    });
    record(c.id, HILL_CHART_ACTIONS.SCOPE_REMOVED, { scopeId: scope.id });
    if (editingScope === scope.id) setEditingScope(null);
    announce(label);
    focusSoon(() => (near ? byData("data-scope-delete", near.id) : null));
  };

  const doCheckIn = (c: HillChart) => {
    const before = findChart(c.id);
    if (!before || before.scopes.length === 0) return;
    const replacing = before.checkIns.some((x) => localDay(x.at) === localDay(new Date()));
    const moved = movement(before, lastCheckIn(before)).filter(
      (m) => m.direction === "forward" || m.direction === "back"
    ).length;
    undoable({
      label: replacing ? "Replaced today's check-in" : "Checked in",
      apply: () => {
        patchChart(c.id, (x) =>
          checkIn(x, new Date(), checkNote, `${HILL_CHECK_IN_ID_PREFIX}${nanoid(8)}`)
        );
        record(c.id, HILL_CHART_ACTIONS.CHECKED_IN, {
          scopes: before.scopes.length,
          moved,
        });
      },
      revert: () => saveChart(before),
    });
    setCheckNote("");
    setSinceId(null);
    announce(
      `${replacing ? "Replaced today's check-in" : "Checked in"}: ${before.scopes.length} scopes saved, ${moved} moved since the last one`
    );
  };

  /** The links store for a scope's sends: a new impediment link is logged as raised. */
  const scopeLinks = (c: HillChart, scopeId: string) => ({
    getLinks: () => findChart(c.id)?.scopes.find((s) => s.id === scopeId)?.sentTo,
    onLinksChange: (fn: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      let raised: HandoffLink | undefined;
      patchChart(c.id, (x) => ({
        ...x,
        scopes: x.scopes.map((s) => {
          if (s.id !== scopeId) return s;
          const before = findLink(s.sentTo, "impediment");
          const next = fn(s.sentTo);
          const after = findLink(next, "impediment");
          if (after && after.targetId !== before?.targetId) raised = after;
          return next.length > 0 ? { ...s, sentTo: next } : { ...s, sentTo: undefined };
        }),
      }));
      if (raised) {
        record(c.id, HILL_CHART_ACTIONS.SCOPE_RAISED, {
          scopeId,
          impedimentId: raised.targetId,
        });
      }
    },
  });

  const loadExample = () => {
    const ex = buildExample(new Date());
    saveChart(ex);
    setSelectedId(ex.id);
  };
  const clearExample = () => {
    let removed: HillChart[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentCharts()
          .filter((c) => isExampleId(c.id))
          .map((c) => removeChart(c.id))
          .filter((c): c is HillChart => c !== null);
      },
      revert: () => removed.forEach(saveChart),
    });
    setSelectedId(null);
  };

  const chartForm = useItemForm<ChartDraft, ChartValues, ChartField>({
    initial: EMPTY_CHART,
    validate: validateChart,
    onSave: createChart,
  });
  const scopeForm = useItemForm<ScopeDraft, ScopeValues, ScopeField>({
    initial: EMPTY_SCOPE,
    validate: validateScope,
    onSave: (values) => {
      if (chart) addScope(chart, values);
    },
  });

  const onParams = (params: URLSearchParams) => {
    const id = params.get("chart");
    if (!id) return;
    setSelectedId(id);
    setSinceId(null);
    dropSearchParam("chart");
  };

  const PAGE = {
    toolId: "hill-chart",
    title: "Hill Chart",
    description:
      "Where each piece of work stands: still working it out, or getting it done. Check in weekly and see what is stuck.",
    category: "Flow & Delivery",
  } as const;

  if (!hydrated) {
    return (
      <ToolPageWrapper {...PAGE}>
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the hill charts…
        </p>
      </ToolPageWrapper>
    );
  }

  const newChartCard = (
    <SectionCard title="New hill chart" icon={Plus}>
      <ItemForm
        form={chartForm}
        submitLabel="Start chart"
        onCancel={charts.length > 0 ? () => setCreating(false) : undefined}
      >
        <ChartFields form={chartForm} sprints={sprintOptions} epics={epicOptions} />
      </ItemForm>
    </SectionCard>
  );

  return (
    <ToolPageWrapper
      toolId="hill-chart"
      title={PAGE.title}
      description={PAGE.description}
      category={PAGE.category}
    >
      <OnSearchParams onChange={onParams} />
      <div className="space-y-4">
        {hasExample && (
          <div>
            <ExampleNotice onClear={clearExample} />
            <p className="-mt-2 text-xs text-sub">
              Example: a team building self-service refunds, four weekly check-ins in. Its stuck
              scope is never raised anywhere.
            </p>
          </div>
        )}

        {charts.length === 0 ? (
          <>
            {newChartCard}
            <EmptyState icon={Mountain} action={<LoadExampleButton onLoad={loadExample} />}>
              No hill charts yet. Start one for a sprint or an epic above, add its pieces of work,
              and place each on the hill: uphill while you are still working it out, downhill once
              it only needs doing.
            </EmptyState>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Chart" className="min-w-0 flex-1 sm:max-w-sm">
                {(props) => (
                  <select
                    {...props}
                    className={SELECT_CLASS}
                    value={chart?.id ?? ""}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      setSinceId(null);
                      setEditingScope(null);
                    }}
                  >
                    {visible.map((c) => (
                      <option key={c.id} value={c.id}>
                        {short(c.title, 60)}
                        {c.archived ? " (archived)" : ""}
                      </option>
                    ))}
                    {!chart && <option value="">No chart in use</option>}
                  </select>
                )}
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setCreating((v) => !v)}
                aria-expanded={creating}
              >
                <Plus aria-hidden="true" />
                New chart
              </Button>
            </div>

            {creating && newChartCard}

            <ActionRow>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="hill-chart"
                markdown={markdown}
                clipboardText={markdown}
                jsonData={chart ?? charts}
                context={chart ? `Hill chart for ${chart.title}` : undefined}
              />
            </ActionRow>

            {!chart ? (
              <EmptyState icon={Mountain}>
                Every chart is archived. Tick Show archived to open one, or start a new chart.
              </EmptyState>
            ) : (
              <ChartBody
                key={chart.id}
                chart={chart}
                now={now}
                stuckIds={stuckIds}
                stories={stories}
                storyById={storyById}
                epicById={epicById}
                storyOptions={storyOptions}
                epicOptions={epicOptions}
                sprints={sprints}
                history={history}
                since={since}
                moveById={moveById}
                checkedToday={checkedToday}
                checkNote={checkNote}
                setCheckNote={setCheckNote}
                setSinceId={setSinceId}
                update={update && update.chartId === chart.id ? update : null}
                setUpdate={(u) => setUpdate(u ? { ...u, chartId: chart.id } : null)}
                editingScope={editingScope}
                setEditingScope={setEditingScope}
                onMove={(id, p) => move(chart, id, p)}
                onEdit={(s, v) => editScope(chart, s, v)}
                onRemove={(s) => removeScope(chart, s)}
                onCheckIn={() => doCheckIn(chart)}
                onArchive={() => toggleArchive(chart)}
                onDelete={() => removeWholeChart(chart)}
                scopeLinks={(id) => scopeLinks(chart, id)}
                scopeForm={
                  <section aria-label="Add a scope">
                    <SectionCard title="Add a scope" icon={Plus}>
                      {hasRoomForScope(chart) ? (
                        <ItemForm form={scopeForm} submitLabel="Add scope">
                          <ScopeFields
                            form={scopeForm}
                            stories={storyOptions}
                            epics={epicOptions}
                          />
                        </ItemForm>
                      ) : (
                        <p className="text-sm text-sub">
                          This chart holds 30 scopes, its most. Remove one, or start a chart for the
                          rest.
                        </p>
                      )}
                    </SectionCard>
                  </section>
                }
              />
            )}
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}

interface ChartBodyProps {
  chart: HillChart;
  now: Date;
  stuckIds: ReadonlySet<string>;
  stories: readonly Story[];
  storyById: ReadonlyMap<string, Story>;
  epicById: ReadonlyMap<string, Epic>;
  storyOptions: readonly LinkOption[];
  epicOptions: readonly LinkOption[];
  sprints: readonly Sprint[];
  history: readonly { id: string; at: string; note?: string }[];
  since: { id: string; at: string } | undefined;
  moveById: ReadonlyMap<string, ReturnType<typeof movement>[number]>;
  checkedToday: boolean;
  checkNote: string;
  setCheckNote: (note: string) => void;
  setSinceId: (id: string | null) => void;
  update: (UpdateNoteOutput & { source: AiSource }) | null;
  setUpdate: (u: (UpdateNoteOutput & { source: AiSource }) | null) => void;
  editingScope: string | null;
  setEditingScope: (id: string | null) => void;
  onMove: (scopeId: string, position: number) => void;
  onEdit: (scope: HillScope, values: ScopeValues) => void;
  onRemove: (scope: HillScope) => void;
  onCheckIn: () => void;
  onArchive: () => void;
  onDelete: () => void;
  scopeLinks: (scopeId: string) => {
    getLinks: () => readonly HandoffLink[] | undefined;
    onLinksChange: (fn: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  };
  scopeForm: ReactNode;
}

/** The open chart: the hill, the check-in, what moved, and its scopes. */
function ChartBody({
  chart,
  now,
  stuckIds,
  stories,
  storyById,
  epicById,
  storyOptions,
  epicOptions,
  sprints,
  history,
  since,
  moveById,
  checkedToday,
  checkNote,
  setCheckNote,
  setSinceId,
  update,
  setUpdate,
  editingScope,
  setEditingScope,
  onMove,
  onEdit,
  onRemove,
  onCheckIn,
  onArchive,
  onDelete,
  scopeLinks,
  scopeForm,
}: ChartBodyProps) {
  const example = isExampleId(chart.id);
  const sprint = chart.sprintId ? sprints.find((s) => s.id === chart.sprintId) : undefined;
  const chartEpic = chart.epicId ? epicById.get(chart.epicId) : undefined;
  const over = overTheHill(chart);
  const today = localDay(now);
  const moves = chart.scopes.map((s) => moveById.get(s.id)).filter(Boolean) as ReturnType<
    typeof movement
  >;
  const forward = moves.filter((m) => m.direction === "forward");
  const back = moves.filter((m) => m.direction === "back");
  const unmoved = moves.filter((m) => m.direction === "unmoved");
  const added = moves.filter((m) => m.direction === "new");

  return (
    <div className="space-y-4">
      <SectionCard
        title={chart.title}
        icon={Mountain}
        titleSize="lg"
        actions={
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onArchive}>
              {chart.archived ? (
                <ArchiveRestore aria-hidden="true" />
              ) : (
                <Archive aria-hidden="true" />
              )}
              {chart.archived ? "Restore" : "Archive"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-sub hover:text-danger"
              onClick={onDelete}
              aria-label={`Delete the hill chart ${chart.title}`}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {chart.about && <p className="text-sm text-text">{chart.about}</p>}
          {(sprint || chartEpic) && (
            <p className="text-xs text-sub">
              {sprint && <>For {sprint.name}. </>}
              {chartEpic && <>Follows the epic {chartEpic.title}.</>}
            </p>
          )}
          {chart.scopes.length === 0 ? (
            <p className="text-sm text-sub">
              No scopes on this hill yet. Add the pieces of work below: each starts at the foot of
              the hill, or wherever you say.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-text">
                {over} of {chart.scopes.length}{" "}
                {chart.scopes.length === 1 ? "scope is" : "scopes are"} over the hill
                {stuckIds.size > 0 ? `; ${stuckIds.size} stuck uphill` : ""}.
              </p>
              <HillView scopes={chart.scopes} stuckIds={stuckIds} onMove={onMove} />
              <p className="text-xs text-sub">
                The top of the hill is where the last unknown is solved. Drag a dot, use its arrow
                keys, or type its position below.
              </p>
            </>
          )}
          <p className="text-xs text-sub">After Basecamp&apos;s Shape Up.</p>
        </div>
      </SectionCard>

      {chart.scopes.length > 0 && (
        <section aria-label="Check in">
          <SectionCard title="Check in" titleSize="lg">
            <div className="space-y-3">
              <Field
                label="This week's note"
                hint={
                  checkedToday
                    ? "You checked in today: checking in again replaces today's."
                    : "Optional: what moved and what is stuck."
                }
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={checkNote}
                    maxLength={TOOL_TEXT_MAX.capture}
                    onChange={(e) => setCheckNote(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={onCheckIn}>
                  {checkedToday ? "Check in again" : "Check in"}
                </Button>
                <AiButton
                  task={hillChartUpdateNoteTask}
                  input={() =>
                    updateNoteInput(chart, Array.from(moveById.values()), today, new Date())
                  }
                  onResult={(data, meta) => setUpdate({ ...data, source: meta.source })}
                  label="Ask Amr for the week's update"
                  fallbackLabel="Draft the update"
                  variant="outline"
                />
              </div>
              {update && (
                <div
                  className="space-y-2 rounded-lg border border-border bg-surface p-3"
                  aria-label="The week's update"
                  role="region"
                >
                  <p className="text-xs text-sub">
                    {update.source === "ai" ? "Drafted by Amr." : "Drafted without AI."} Nothing is
                    saved until you use it as the note and check in.
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">
                    {update.update}
                  </p>
                  {update.questions.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                      {update.questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <CopyButton
                      text={[update.update, ...update.questions].join("\n")}
                      label="Copy the update"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCheckNote(update.update.slice(0, TOOL_TEXT_MAX.capture))}
                    >
                      Use as the note
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setUpdate(null)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </section>
      )}

      {history.length > 0 && chart.scopes.length > 0 && (
        <section aria-label="Moved since a check-in">
          <SectionCard title="Moved since a check-in" titleSize="lg">
            <div className="space-y-3">
              <Field label="Compare with">
                {(props) => (
                  <select
                    {...props}
                    className={SELECT_CLASS}
                    value={since?.id ?? ""}
                    onChange={(e) => setSinceId(e.target.value || null)}
                  >
                    {history.map((c) => (
                      <option key={c.id} value={c.id}>
                        {localDay(c.at)}
                        {c.note ? `: ${short(c.note, 40)}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <MoveGroup term="Forward" list={forward} />
                <MoveGroup term="Back" list={back} />
                <MoveGroup term="Not moved" list={unmoved} />
                {added.length > 0 && <MoveGroup term="New since then" list={added} />}
              </dl>
            </div>
          </SectionCard>
        </section>
      )}

      {chart.scopes.length > 0 && (
        <section aria-labelledby="hill-scopes" className="space-y-2">
          <h2 id="hill-scopes" className="text-sm font-semibold text-text">
            Scopes ({chart.scopes.length})
          </h2>
          <ul className="space-y-2" aria-label="Scopes, in the order added">
            {chart.scopes.map((s, i) => {
              const story = s.storyId ? storyById.get(s.storyId) : undefined;
              const epic = s.epicId ? epicById.get(s.epicId) : undefined;
              const links = scopeLinks(s.id);
              const m = moveById.get(s.id);
              return (
                <ScopeRow
                  key={s.id}
                  scope={s}
                  number={i + 1}
                  daysSinceMove={daysSinceMove(s, now)}
                  stuck={stuckIds.has(s.id)}
                  mismatch={scopeMismatch(s, story)}
                  story={
                    story
                      ? {
                          title: story.title || "Untitled story",
                          status: STORY_STATUS_LABEL[story.status] ?? story.status,
                          href: "/sprint-planning",
                        }
                      : undefined
                  }
                  epic={
                    epic
                      ? {
                          title: epic.title || "Untitled epic",
                          progress: rollupLabel(epicRollup(epic, linkedStories(epic.id, stories))),
                          href: `/epic-roadmap?epic=${encodeURIComponent(epic.id)}`,
                        }
                      : undefined
                  }
                  since={m ? movementText(m) : undefined}
                  stories={storyOptions}
                  epics={epicOptions}
                  editing={editingScope === s.id}
                  sendBlocked={example ? EXAMPLE_BLOCKED : null}
                  source={scopeSource(chart, s, now)}
                  getLinks={links.getLinks}
                  onLinksChange={links.onLinksChange}
                  onMove={(p) => onMove(s.id, p)}
                  onEdit={(on) => setEditingScope(on ? s.id : null)}
                  onSave={(v) => onEdit(s, v)}
                  onRemove={() => onRemove(s)}
                />
              );
            })}
          </ul>
        </section>
      )}

      {scopeForm}
    </div>
  );
}

function MoveGroup({
  term,
  list,
}: {
  term: string;
  list: readonly { scopeId: string; title: string; from: number | null; to: number }[];
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-2">
      <dt className="text-xs font-semibold uppercase tracking-wider text-sub">
        {term} ({list.length})
      </dt>
      <dd className="mt-1 text-text">
        {list.length === 0 ? (
          <span className="text-sub">None</span>
        ) : (
          <ul className="space-y-0.5">
            {list.map((m) => (
              <li key={m.scopeId}>
                {m.title}
                <span className="text-sub">
                  {m.from === null ? ` (at ${m.to})` : ` (${m.from} → ${m.to})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
