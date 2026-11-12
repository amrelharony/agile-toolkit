"use client";

/**
 * Interrupt Buffer: keep part of the sprint free for unplanned work, log
 * each interrupt as it lands, and see how much of the buffer is used. Once
 * it is spent, the Emergency Procedure walks the team through what to do.
 * The history shows how much each sprint used, to size the next buffer.
 *
 * The buffer is the sprint's own field (`Sprint.interruptBuffer`, also set
 * in Sprint Planning) and the interrupts are workspace records
 * (`interruptItems`), so the cockpit and Amr read the same numbers
 * (lib/sprints/interrupts `interruptBufferStatus`). The example is held in
 * memory and never reaches the workspace.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  CheckCircle2,
  History,
  ListPlus,
  Pencil,
  RotateCcw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiButton, AiSuggestions } from "@/components/ai";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { IconButton } from "@/components/ui/icon-button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  InterruptItem,
  InterruptKind,
  Sprint,
  SprintInterruptBuffer,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { updateSprint } from "@/lib/sprints/store";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { INTERRUPT_BUFFER_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { isExampleId } from "@/lib/utils/example-id";
import type { AiSource } from "@/lib/ai/task-types";
import { CLASSIFY_MAX, interruptClassifyTask } from "@/lib/ai/tasks/interrupt-buffer";
import {
  EMPTY_INTERRUPT_DRAFT,
  INTERRUPT_KIND_LABEL,
  bufferHistory,
  interruptBufferStatus,
  interruptSize,
  pointsText,
  sameBuffer,
  sprintInterrupts,
  suggestedBufferPoints,
  type InterruptDraft,
  type InterruptValues,
} from "@/lib/sprints/interrupts";
import { buildExample } from "./example";
import { interruptsCsv, toMarkdown } from "./markdown";
import { BufferForm, BufferGauge, EmergencyPanel, HistoryTable, InterruptForm } from "./parts";
import { emergencyFor, useInterruptBufferPrefs, type EmergencyRun } from "./store";

export const TOOL_ID = "interrupt-buffer";

const NO_ITEMS: InterruptItem[] = [];

/** Where the page's writes go: the workspace, or the example in memory. */
export interface BufferWriter {
  sprints(): Sprint[];
  items(): InterruptItem[];
  updateSprint(id: string, patch: Partial<Omit<Sprint, "id">>): void;
  putItem(item: InterruptItem): void;
  removeItem(id: string): void;
}

export const liveWriter: BufferWriter = {
  sprints: () => useWorkspaceStore.getState().sprints,
  items: () => useWorkspaceStore.getState().interruptItems ?? [],
  updateSprint: (id, patch) => {
    updateSprint(id, patch);
  },
  putItem: (item) => useWorkspaceStore.getState().upsertInterruptItem(item),
  removeItem: (id) => useWorkspaceStore.getState().removeInterruptItem(id),
};

interface ExampleState {
  sprints: Sprint[];
  items: InterruptItem[];
  selected: string;
  emergencies: Record<string, EmergencyRun>;
}
type ExampleStore = StoreApi<ExampleState>;

function exampleWriter(store: ExampleStore): BufferWriter {
  return {
    sprints: () => store.getState().sprints,
    items: () => store.getState().items,
    updateSprint: (id, patch) =>
      store.setState((s) => ({
        sprints: s.sprints.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      })),
    putItem: (item) =>
      store.setState((s) => ({
        items: s.items.some((x) => x.id === item.id)
          ? s.items.map((x) => (x.id === item.id ? item : x))
          : [...s.items, item],
      })),
    removeItem: (id) => store.setState((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  };
}

/** A sprint's run with a step ticked or unticked. */
export function withStep(run: EmergencyRun, stepId: string): EmergencyRun {
  return run.done.includes(stepId)
    ? { ...run, done: run.done.filter((d) => d !== stepId) }
    : { ...run, done: [...run.done, stepId] };
}

const short = (t: string, max = 40) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

export function InterruptBufferClient() {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const allItems = useWorkspaceStore((s) => s.interruptItems) ?? NO_ITEMS;
  const items = useMemo(() => allItems.filter((i) => !isExampleId(i.id)), [allItems]);
  const realSprints = useMemo(() => sprints.filter((s) => !isExampleId(s.id)), [sprints]);
  const emergencies = useInterruptBufferPrefs((s) => s.emergencies);
  useEffect(() => {
    void useInterruptBufferPrefs.persist.rehydrate();
  }, []);
  const { log } = useHistoryLogger(TOOL_ID);
  const [example, setExample] = useState<ExampleStore | null>(null);

  const setRun = (sprintId: string, run: EmergencyRun | undefined) =>
    useInterruptBufferPrefs.setState((s) => {
      const next = { ...(s.emergencies ?? {}) };
      if (run) next[sprintId] = run;
      else delete next[sprintId];
      return { emergencies: next };
    });

  let content: ReactNode;
  if (!hydrated) {
    content = (
      <p className="text-sm text-sub" role="status">
        Loading your sprints…
      </p>
    );
  } else if (example) {
    content = <ExampleBoard store={example} onExit={() => setExample(null)} />;
  } else if (!selected) {
    content = (
      <EmptyState
        icon={Zap}
        action={
          <div className="flex flex-wrap items-end justify-center gap-2">
            <SprintPicker sprints={realSprints} selectedId={undefined} onSelect={select} />
            <LoadExampleButton
              label="See an example sprint"
              onLoad={() => {
                const ex = buildExample();
                setExample(
                  createStore<ExampleState>(() => ({
                    ...ex,
                    selected: ex.sprints[0].id,
                    emergencies: {},
                  }))
                );
              }}
            />
          </div>
        }
      >
        <p className="text-sm">
          No sprint yet. The buffer belongs to a sprint: create one, then keep part of it free for
          unplanned work.
        </p>
      </EmptyState>
    );
  } else {
    content = (
      <BufferBoard
        sprints={realSprints}
        sprint={selected}
        items={items}
        writer={liveWriter}
        onSelect={select}
        run={emergencyFor(emergencies, selected.id)}
        onRun={(run) => setRun(selected.id, run)}
        log={log}
      />
    );
  }

  return (
    <ToolPageWrapper
      toolId="interrupt-buffer"
      title="Interrupt Buffer"
      description="Keep a buffer for unplanned work, log interrupts as they land, and know when to call the emergency procedure."
      category="Flow & Delivery"
    >
      {content}
    </ToolPageWrapper>
  );
}

function ExampleBoard({ store, onExit }: { store: ExampleStore; onExit: () => void }) {
  const sprints = useStore(store, (s) => s.sprints);
  const items = useStore(store, (s) => s.items);
  const selectedId = useStore(store, (s) => s.selected);
  const emergencies = useStore(store, (s) => s.emergencies);
  const writer = useMemo(() => exampleWriter(store), [store]);
  const sprint = sprints.find((s) => s.id === selectedId) ?? sprints[0];
  return (
    <div>
      <ExampleNotice onClear={onExit} />
      <p className="-mt-2 mb-4 text-xs text-sub">
        Nothing in the example is saved: your sprints and the cockpit stay as they are.
      </p>
      <BufferBoard
        sprints={sprints}
        sprint={sprint}
        items={items}
        writer={writer}
        onSelect={(id) => store.setState({ selected: id })}
        run={emergencies[sprint.id]}
        onRun={(run) =>
          store.setState((s) => {
            const next = { ...s.emergencies };
            if (run) next[sprint.id] = run;
            else delete next[sprint.id];
            return { emergencies: next };
          })
        }
        log={() => {}}
        example
      />
    </div>
  );
}

interface KindSuggestion {
  id: string;
  title: string;
  kind: InterruptKind;
  size?: number;
  reason?: string;
}

/** The page for one sprint. */
export function BufferBoard({
  sprints,
  sprint,
  items,
  writer,
  onSelect,
  run,
  onRun,
  log,
  example = false,
}: {
  sprints: Sprint[];
  sprint: Sprint;
  items: readonly InterruptItem[];
  writer: BufferWriter;
  onSelect: (id: string) => void;
  run: EmergencyRun | undefined;
  onRun: (run: EmergencyRun | undefined) => void;
  log: (action: string, payload?: Record<string, unknown>) => void;
  example?: boolean;
}) {
  const status = useMemo(() => interruptBufferStatus(sprint, items), [sprint, items]);
  const mine = useMemo(() => sprintInterrupts(items, sprint.id), [items, sprint.id]);
  const history = useMemo(() => bufferHistory(sprints, items), [sprints, items]);
  const suggested = useMemo(() => suggestedBufferPoints(sprints, items), [sprints, items]);
  const [editing, setEditing] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [kinds, setKinds] = useState<{ items: KindSuggestion[]; source: AiSource } | null>(null);

  const markdown = useMemo(
    () => toMarkdown({ sprint, status, items: mine, history }),
    [sprint, status, mine, history]
  );

  const fresh = (id: string) => writer.items().find((i) => i.id === id);

  const saveBuffer = (buffer: SprintInterruptBuffer | undefined) => {
    if (sameBuffer(buffer, sprint.interruptBuffer)) return;
    writer.updateSprint(sprint.id, { interruptBuffer: buffer });
    log(INTERRUPT_BUFFER_ACTIONS.BUFFER_SET, {
      sprintId: sprint.id,
      pct: buffer?.pct ?? null,
      points: buffer?.points ?? null,
    });
    setAnnounce(buffer ? "Buffer saved." : "Buffer cleared.");
  };

  const logInterrupt = (values: InterruptValues) => {
    const item: InterruptItem = {
      id: `${example ? "example-" : ""}interrupt_${nanoid(8)}`,
      sprintId: sprint.id,
      title: values.title,
      kind: values.kind,
      ...(values.size !== undefined ? { size: values.size } : {}),
      emergency: values.emergency,
      loggedAt: new Date().toISOString(),
    };
    writer.putItem(item);
    const after = interruptBufferStatus(sprint, [...writer.items()]);
    log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_LOGGED, {
      sprintId: sprint.id,
      interruptId: item.id,
      kind: item.kind,
      size: item.size ?? null,
      emergency: item.emergency,
    });
    setAnnounce(`Logged. ${after.summary}`);
  };

  const saveEdit = (id: string, values: InterruptValues) => {
    const current = fresh(id);
    if (!current) return;
    const next: InterruptItem = {
      ...current,
      title: values.title,
      kind: values.kind,
      emergency: values.emergency,
    };
    if (values.size !== undefined) next.size = values.size;
    else delete next.size;
    writer.putItem(next);
    log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_UPDATED, { interruptId: id });
    setEditing(null);
    setAnnounce("Interrupt saved.");
  };

  const toggleResolved = (item: InterruptItem) => {
    const current = fresh(item.id) ?? item;
    if (current.resolvedAt) {
      const { resolvedAt: _r, ...open } = current;
      void _r;
      writer.putItem(open);
      log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_UPDATED, { interruptId: item.id, reopened: true });
      setAnnounce(`Reopened “${short(item.title)}”.`);
    } else {
      writer.putItem({ ...current, resolvedAt: new Date().toISOString() });
      log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_RESOLVED, { interruptId: item.id });
      setAnnounce(`Resolved “${short(item.title)}”. It still counts against the buffer.`);
    }
  };

  const removeItem = (item: InterruptItem) => {
    const before = fresh(item.id) ?? item;
    undoable({
      label: `Deleted “${short(item.title)}”`,
      apply: () => writer.removeItem(item.id),
      revert: () => writer.putItem(before),
    });
    log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_REMOVED, { interruptId: item.id });
    setAnnounce("");
  };

  const startEmergency = () => {
    onRun({ startedAt: new Date().toISOString(), done: [] });
    log(INTERRUPT_BUFFER_ACTIONS.EMERGENCY_STARTED, {
      sprintId: sprint.id,
      usedPoints: status.usedPoints,
      bufferPoints: status.bufferPoints,
    });
  };

  const toggleStep = (stepId: string) => {
    if (run) onRun(withStep(run, stepId));
  };

  /** Amr's kinds for the sprint's interrupts, where they differ from what is logged. */
  const showKinds = (
    data: { items: { index: number; kind: InterruptKind; size?: number; reason?: string }[] },
    source: AiSource
  ) => {
    const asked = mine.slice(0, CLASSIFY_MAX);
    const list: KindSuggestion[] = [];
    for (const s of data.items) {
      const item = asked[s.index];
      if (!item) continue;
      const sizeNew = s.size !== undefined && item.size === undefined;
      if (s.kind === item.kind && !sizeNew) continue;
      list.push({
        id: item.id,
        title: item.title,
        kind: s.kind,
        ...(sizeNew ? { size: s.size } : {}),
        ...(s.reason ? { reason: s.reason } : {}),
      });
    }
    setKinds({ items: list, source });
    if (list.length === 0) setAnnounce("Every interrupt's kind already matches.");
  };

  const acceptKind = (s: KindSuggestion) => {
    const before = fresh(s.id);
    if (!before) return;
    const next: InterruptItem = {
      ...before,
      kind: s.kind,
      ...(s.size !== undefined ? { size: s.size } : {}),
    };
    undoable({
      label: `“${short(before.title)}” is now ${INTERRUPT_KIND_LABEL[s.kind].toLowerCase()}`,
      kind: "success",
      apply: () => writer.putItem(next),
      revert: () => writer.putItem(before),
    });
    log(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_UPDATED, { interruptId: s.id, kind: s.kind });
  };

  const draftFor = (item: InterruptItem): InterruptDraft => ({
    title: item.title,
    kind: item.kind,
    size: typeof item.size === "number" ? String(item.size) : "",
    emergency: item.emergency,
  });

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SprintPicker
          sprints={sprints}
          selectedId={sprint.id}
          onSelect={onSelect}
          allowCreate={!example}
        />
        <ExportButton
          filename={`interrupt-buffer-${sprint.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          markdown={markdown}
          clipboardText={markdown}
          csvData={interruptsCsv(mine)}
          jsonData={{ sprint: { id: sprint.id, name: sprint.name }, status, interrupts: mine }}
        />
      </div>

      <SectionCard title="The buffer" icon={Shield}>
        <div className="space-y-4">
          <BufferGauge status={status} />
          <BufferForm sprint={sprint} suggested={suggested} onSave={saveBuffer} />
          {!example && (
            <p className="text-xs text-sub">
              Sprint Planning shows the buffer too, so the team plans the rest.{" "}
              <Link href="/sprint-planning" className="text-accent hover:underline">
                Sprint Planning
              </Link>
            </p>
          )}
        </div>
      </SectionCard>

      {status.over && <EmergencyPanel run={run} onStart={startEmergency} onToggle={toggleStep} />}

      <SectionCard title="Log an interrupt" icon={ListPlus}>
        <InterruptForm initial={EMPTY_INTERRUPT_DRAFT} submitLabel="Log it" onSave={logInterrupt} />
      </SectionCard>

      <SectionCard
        title={`Interrupts in ${sprint.name}`}
        icon={Zap}
        actions={
          mine.length > 0 ? (
            <AiButton
              task={interruptClassifyTask}
              label="Check the kinds with Amr"
              fallbackLabel="Check the kinds by the words"
              variant="outline"
              input={() => ({
                titles: mine.slice(0, CLASSIFY_MAX).map((i) => i.title.slice(0, 300)),
              })}
              onResult={(data, meta) => showKinds(data, meta.source)}
            />
          ) : undefined
        }
      >
        <div className="space-y-3">
          {kinds && kinds.items.length > 0 && (
            <AiSuggestions
              items={kinds.items}
              source={kinds.source}
              title="Kinds to check"
              acceptLabel="Change"
              render={(s) => ({
                title: `${s.title}: ${INTERRUPT_KIND_LABEL[s.kind]}${s.size !== undefined ? `, ${pointsText(s.size)}` : ""}`,
                detail: s.reason,
              })}
              onAccept={acceptKind}
              onDismiss={() => setKinds(null)}
            />
          )}
          {mine.length === 0 ? (
            <p className="text-sm text-sub">
              Nothing logged in {sprint.name} yet. Log each piece of unplanned work as it lands.
            </p>
          ) : (
            <ul
              className="divide-y divide-border rounded-lg border border-border"
              aria-label={`Interrupts in ${sprint.name}`}
            >
              {mine.map((item) => (
                <li key={item.id} className="px-3 py-2">
                  {editing === item.id ? (
                    <InterruptForm
                      initial={draftFor(item)}
                      submitLabel="Save"
                      onSave={(v) => saveEdit(item.id, v)}
                      onCancel={() => setEditing(null)}
                      focusOnMount
                    />
                  ) : (
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={
                            item.resolvedAt
                              ? "break-words text-sm text-sub line-through"
                              : "break-words text-sm text-text"
                          }
                        >
                          {item.title}
                        </p>
                        <p className="text-xs text-sub">
                          {INTERRUPT_KIND_LABEL[item.kind] ?? item.kind}
                          {" · "}
                          {interruptSize(item) > 0 || item.size === 0
                            ? pointsText(interruptSize(item))
                            : "no size"}
                          {item.emergency && " · emergency"}
                          {" · logged "}
                          {item.loggedAt.slice(0, 10)}
                          {item.resolvedAt && ` · resolved ${item.resolvedAt.slice(0, 10)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <IconButton
                          label={
                            item.resolvedAt
                              ? `Reopen “${short(item.title)}”`
                              : `Resolve “${short(item.title)}”`
                          }
                          icon={
                            item.resolvedAt ? (
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            )
                          }
                          onClick={() => toggleResolved(item)}
                        />
                        <IconButton
                          label={`Edit “${short(item.title)}”`}
                          icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => setEditing(item.id)}
                        />
                        <IconButton
                          label={`Delete “${short(item.title)}”`}
                          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => removeItem(item)}
                        />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      {history.length > 0 && (
        <SectionCard title="Sprint history" icon={History}>
          <HistoryTable rows={history} />
          <p className="mt-2 text-xs text-sub">
            Look at where the interrupts came from at the{" "}
            <Link href="/retro" className="text-accent hover:underline">
              retro
            </Link>
            , and fix one source at a time.
          </p>
        </SectionCard>
      )}
    </div>
  );
}
