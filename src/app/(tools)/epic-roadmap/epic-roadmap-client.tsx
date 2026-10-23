"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChartGantt, ListTree, Milestone, Pencil, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateEpicRoadmapPrompts } from "@/lib/ai-prompts/epic-roadmap";
import { plural } from "@/lib/charts/chart-text";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Epic, Story } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { EPIC_ROADMAP_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import {
  EpicAddForm,
  EpicEditor,
  changedFields,
  newEpicDraft,
  useEpicAddForm,
  withEpicValues,
  type EpicValues,
} from "./epic-form";
import { EpicStories } from "./epic-stories";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { colorVar, nextColor } from "./palette";
import { QuarterPicker } from "./pickers";
import { MAX_QUARTERS_SPAN, normalizeQuarter, quartersBetween, requestedSpan } from "./quarters";
import { SCHEDULE_LABEL, rollupLabel, type EpicSchedule } from "./rollup";
import { RoadmapTimeline } from "./timeline";
import {
  byStart,
  epicViews,
  fitRange,
  inView,
  roadmapVerdict,
  timelineSummary,
  type EpicView,
} from "./view";

const ER_ID = "epicRoadmap:current"; // MUST match ER_ID in lib/actions/tools/epic-roadmap.ts.
const EMPTY_EPICS: Epic[] = [];

// The synced workspace singleton wrapping the epics[] array. Writes read
// the store at the moment they run, so an agent's add between two clicks
// isn't overwritten.
function useEpics(): [Epic[], (u: (p: Epic[]) => Epic[]) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.epicRoadmaps ?? []).find((d) => d.id === ER_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertEpicRoadmap);
  const epics = doc?.epics ?? EMPTY_EPICS;
  const setEpics = (u: (p: Epic[]) => Epic[]) => {
    const cur =
      (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];
    upsert({ id: ER_ID, epics: u(cur) });
  };
  return [epics, setEpics];
}

/** Link a story to an epic, or unlink it (`epicId` undefined), as stored now. */
function setStoryEpic(storyId: string, epicId: string | undefined) {
  const ws = useWorkspaceStore.getState();
  const story = ws.stories.find((s) => s.id === storyId);
  if (!story || story.epicId === epicId) return;
  const next: Story = { ...story };
  if (epicId) next.epicId = epicId;
  else delete next.epicId;
  ws.upsertStory(next);
}

const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const keyOf = (v: EpicView) => v.epic.id;

const SCHEDULE_TONE: Record<EpicSchedule, string> = {
  unscheduled: "text-warning",
  upcoming: "text-sub",
  "in-progress": "text-sub",
  ending: "text-warning",
  overdue: "text-danger",
  done: "text-success",
};

export function EpicRoadmapClient() {
  const [epics, setEpics] = useEpics();
  const stories = useWorkspaceStore((s) => s.stories);
  const { log } = useHistoryLogger("epic-roadmap");
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openStories, setOpenStories] = useState<ReadonlySet<string>>(new Set());
  // The view range: fitted to the epics until the user picks quarters.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  // "Now" moves on hourly, so a tab left open past a quarter's end (or the
  // 14-day window below) catches up without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const views = useMemo(() => epicViews(epics, stories, now), [epics, stories, now]);
  // Earliest start first; the order on screen stays put while dates are
  // edited, and "Re-sort" catches it up.
  const { ordered, isStale, resort } = useStableOrder(views, keyOf, byStart);
  const allQuarters = useMemo(() => epics.flatMap((e) => [e.startQuarter, e.endQuarter]), [epics]);

  function add(v: EpicValues) {
    const epic: Epic = {
      id: crypto.randomUUID(),
      title: v.title,
      startQuarter: v.startQuarter,
      endQuarter: v.endQuarter,
      progress: 0,
      color: v.color,
      ...(v.owner ? { owner: v.owner } : {}),
      ...(v.description ? { description: v.description } : {}),
    };
    setEpics((s) => [...s, epic]);
    log(EPIC_ROADMAP_ACTIONS.EPIC_ADDED, { epicId: epic.id, title: epic.title });
    form.reset(newEpicDraft(nextColor([...epics, epic]), now));
  }
  const form = useEpicAddForm(() => newEpicDraft(nextColor(epics), now), add);

  function save(epic: Epic, v: EpicValues) {
    setEditingId(null);
    const fields = changedFields(epic, withEpicValues(epic, v));
    if (fields.length === 0) return;
    setEpics((s) => s.map((e) => (e.id === epic.id ? withEpicValues(e, v) : e)));
    log(EPIC_ROADMAP_ACTIONS.EPIC_UPDATED, { epicId: epic.id, fields });
  }

  // Removing an epic unlinks its stories (they stay where they are); Undo
  // brings the epic back and relinks the ones nobody has moved since.
  function remove(epic: Epic) {
    const current =
      (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];
    const index = Math.max(
      0,
      current.findIndex((e) => e.id === epic.id)
    );
    const storyIds = useWorkspaceStore
      .getState()
      .stories.filter((s) => s.epicId === epic.id)
      .map((s) => s.id);
    undoable({
      label: `Deleted “${short(epic.title)}”`,
      description:
        storyIds.length > 0
          ? `${plural(storyIds.length, "linked story", "linked stories")} unlinked; ${
              storyIds.length === 1 ? "it stays" : "they stay"
            } where ${storyIds.length === 1 ? "it is" : "they are"}.`
          : undefined,
      apply: () => {
        setEpics((s) => s.filter((e) => e.id !== epic.id));
        storyIds.forEach((id) => setStoryEpic(id, undefined));
        log(EPIC_ROADMAP_ACTIONS.EPIC_REMOVED, { epicId: epic.id, title: epic.title });
      },
      revert: () => {
        setEpics((s) =>
          s.some((e) => e.id === epic.id) ? s : [...s.slice(0, index), epic, ...s.slice(index)]
        );
        for (const id of storyIds) {
          const story = useWorkspaceStore.getState().stories.find((s) => s.id === id);
          if (story && !story.epicId) setStoryEpic(id, epic.id);
        }
      },
    });
  }

  function link(epic: Epic, story: Story) {
    const previous = story.epicId;
    undoable({
      label: `Linked “${short(story.title)}” to “${short(epic.title)}”`,
      apply: () => {
        setStoryEpic(story.id, epic.id);
        log(EPIC_ROADMAP_ACTIONS.EPIC_UPDATED, { epicId: epic.id, fields: ["stories"] });
      },
      revert: () => setStoryEpic(story.id, previous),
    });
  }

  function unlink(epic: Epic, story: Story) {
    undoable({
      label: `Unlinked “${short(story.title)}”`,
      apply: () => {
        setStoryEpic(story.id, undefined);
        log(EPIC_ROADMAP_ACTIONS.EPIC_UPDATED, { epicId: epic.id, fields: ["stories"] });
      },
      revert: () => setStoryEpic(story.id, epic.id),
    });
  }

  const toggleStories = (id: string) =>
    setOpenStories((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loadExample = () => {
    const example = buildExample(now);
    const ids = new Set(example.map((e) => e.id));
    setEpics((s) => [...s.filter((e) => !ids.has(e.id)), ...example]);
    setRange(null);
    form.reset(newEpicDraft(nextColor([...epics, ...example]), now));
  };
  const clearExample = () => setEpics((s) => s.filter((e) => !isExampleId(e.id)));

  const fitted = fitRange(epics, now);
  const from = range?.from ?? fitted.from;
  const to = range?.to ?? fitted.to;
  const columns = useMemo(() => quartersBetween(from, to), [from, to]);
  const span = requestedSpan(from, to);
  const viewEnd = columns[columns.length - 1] ?? to;
  const unscheduled = views.filter((v) => v.schedule === "unscheduled").length;
  const outside = views.filter(
    (v) => v.schedule !== "unscheduled" && !inView(v.epic, from, viewEnd)
  ).length;

  const verdict = roadmapVerdict(views);

  const promptConfig = useMemo(
    () => ({
      toolName: "Epic Roadmap",
      // The rolled-up progress, so the prompt sees what the page shows.
      prompts: generateEpicRoadmapPrompts({
        epics: views.map((v) => ({ ...v.epic, progress: v.rollup.pct })),
        columns,
      }),
    }),
    [views, columns]
  );

  // ── Cross-tool signals: recent sprint completions + OKR updates ─────────
  // Epic timelines depend on both sprint outcomes (capacity to deliver) and
  // OKR shifts (whether the epic still maps to current objectives). When
  // either has changed in the last 14 days, prompt the user to revisit the
  // roadmap. `selectEvents` reads the clock itself, so the memos also
  // re-run when `now` ticks over.
  const events = useHistoryStore((s) => s.events);
  const recentSprintAdds = useMemo(
    () => selectEvents({ toolId: "velocity", action: "sprint_added", sinceDays: 14, limit: 50 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, now]
  );
  const recentOkrUpdates = useMemo(
    () => selectEvents({ toolId: "okrs", action: "progress_updated", sinceDays: 14, limit: 50 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, now]
  );

  const csvData = {
    headers: ["Epic", "Description", "Start Q", "End Q", "Progress", "Progress from", "Owner"],
    rows: views.map((v) => [
      v.epic.title,
      v.epic.description ?? "",
      v.epic.startQuarter,
      v.epic.endQuarter,
      `${v.rollup.pct}%`,
      rollupLabel(v.rollup),
      v.epic.owner ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="epic-roadmap"
      title="Epic Roadmap"
      description="Timeline view of epics across quarters, with progress rolled up from their stories."
      category="Portfolio & Scaling"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(epics) && <ExampleNotice onClear={clearExample} />}

        {(recentSprintAdds.length > 0 || recentOkrUpdates.length > 0) && (
          <CalloutAlert tone="info">
            {recentSprintAdds.length} sprint{recentSprintAdds.length === 1 ? "" : "s"} added,{" "}
            {recentOkrUpdates.length} OKR update{recentOkrUpdates.length === 1 ? "" : "s"} in last
            14 days &mdash; review epic timelines.
          </CalloutAlert>
        )}

        {epics.length === 0 ? (
          <EmptyState icon={Milestone} action={<LoadExampleButton onLoad={loadExample} />}>
            No epics yet. Add one below (it starts in this quarter), or load an example roadmap.
          </EmptyState>
        ) : (
          <>
            <SectionCard
              title="Roadmap"
              icon={ChartGantt}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="epic-roadmap"
                    csvData={csvData}
                    jsonData={epics}
                    markdown={toMarkdown(views, now)}
                    targetRef={exportRef}
                  />
                </>
              }
            >
              <p className="mb-3 text-sm font-medium text-text">{verdict}</p>
              <div className="mb-3 flex flex-wrap items-start gap-3">
                <QuarterPicker
                  label="View from"
                  value={normalizeQuarter(from)}
                  onChange={(q) => setRange({ from: q, to })}
                  now={now}
                  also={allQuarters}
                  className="w-full sm:w-44"
                />
                <QuarterPicker
                  label="View to"
                  value={normalizeQuarter(to)}
                  onChange={(q) => setRange({ from, to: q })}
                  now={now}
                  also={allQuarters}
                  error={span === 0 ? "End the view on or after its start." : undefined}
                  className="w-full sm:w-44"
                />
                {range && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    onClick={() => setRange(null)}
                  >
                    Fit to epics
                  </Button>
                )}
              </div>
              {span > MAX_QUARTERS_SPAN && (
                <p className="mb-3 text-xs text-warning">
                  Showing the first {MAX_QUARTERS_SPAN} quarters of {span}. Narrow the view to see
                  every epic.
                </p>
              )}
              {(outside > 0 || unscheduled > 0) && (
                <p className="mb-3 text-xs text-sub">
                  {outside > 0 &&
                    `${plural(outside, "epic")} ${outside === 1 ? "falls" : "fall"} outside this view. `}
                  {unscheduled > 0 &&
                    `${plural(unscheduled, "epic")} ${unscheduled === 1 ? "has" : "have"} no valid quarters: edit to place ${unscheduled === 1 ? "it" : "them"}.`}
                </p>
              )}
              {columns.length > 0 && (
                <RoadmapTimeline
                  views={ordered}
                  columns={columns}
                  summary={timelineSummary(views, from, viewEnd, now)}
                  now={now}
                />
              )}
            </SectionCard>

            <SectionCard title={`Epics (${epics.length})`} icon={Milestone}>
              <ResortChip isStale={isStale} onResort={resort} what="Dates" />
              <ul className="divide-y divide-border" aria-label="Epics, earliest start first">
                {ordered.map((v) => (
                  <li key={v.epic.id} className="space-y-3 py-3">
                    {editingId === v.epic.id ? (
                      <EpicEditor
                        epic={v.epic}
                        color={v.color}
                        rollup={v.rollup}
                        also={allQuarters}
                        now={now}
                        onSave={(values) => save(v.epic, values)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <EpicRow
                        view={v}
                        panelId={`epic-stories-${v.epic.id}`}
                        storiesOpen={openStories.has(v.epic.id)}
                        onToggleStories={() => toggleStories(v.epic.id)}
                        onEdit={() => setEditingId(v.epic.id)}
                        onRemove={() => remove(v.epic)}
                      />
                    )}
                    {openStories.has(v.epic.id) && (
                      <EpicStories
                        id={`epic-stories-${v.epic.id}`}
                        view={v}
                        stories={stories}
                        epics={epics}
                        onLink={(s) => link(v.epic, s)}
                        onUnlink={(s) => unlink(v.epic, s)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </SectionCard>
          </>
        )}

        <SectionCard title="Add an epic" icon={Plus}>
          <EpicAddForm form={form} also={allQuarters} now={now} />
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}

/** One epic: colour, name, quarters, owner, schedule, progress and its source, actions. */
function EpicRow({
  view,
  panelId,
  storiesOpen,
  onToggleStories,
  onEdit,
  onRemove,
}: {
  view: EpicView;
  /** The id of the stories panel the "Stories" button opens. */
  panelId: string;
  storiesOpen: boolean;
  onToggleStories: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { epic, rollup, schedule, color, linked } = view;
  const start = normalizeQuarter(epic.startQuarter);
  const end = normalizeQuarter(epic.endQuarter);
  const quarters =
    !start || !end ? "No valid quarters" : start === end ? start : `${start} → ${end}`;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span
        aria-hidden="true"
        className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
        style={{ background: colorVar(color) }}
      />
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p className="break-words text-sm font-medium text-text">{epic.title}</p>
        <p className="text-xs text-sub">
          <span className="font-data">{quarters}</span>
          {" · "}
          {epic.owner ? `Owner: ${epic.owner}` : "No owner"}
          {" · "}
          <span className={SCHEDULE_TONE[schedule]}>{SCHEDULE_LABEL[schedule]}</span>
        </p>
        {epic.description && (
          <p className="whitespace-pre-wrap break-words text-xs text-sub">{epic.description}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-data text-lg leading-tight text-text">{rollup.pct}%</p>
        <p className={cn("text-xs", rollup.source === "typed" ? "text-warning" : "text-sub")}>
          {rollup.source === "typed" ? "Typed: no stories linked" : rollupLabel(rollup)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={storiesOpen}
          aria-controls={storiesOpen ? panelId : undefined}
          aria-label={`Stories (${linked.length}) in ${epic.title}`}
          onClick={onToggleStories}
          className="min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:text-accent"
        >
          <ListTree aria-hidden="true" />
          Stories ({linked.length})
        </Button>
        <IconButton
          label={`Edit ${epic.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${epic.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </div>
    </div>
  );
}
