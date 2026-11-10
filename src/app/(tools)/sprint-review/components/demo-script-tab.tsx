"use client";

/**
 * Tab 1 — Demo Script. For a sprint, its done stories are the demo
 * candidates ("Add to demo" makes an item from the story); the script
 * itself is an ordered list edited in place, with a form to add an item of
 * the team's own and a copy of the script to share.
 */

import { useRef, useState } from "react";
import Link from "@/components/motion/transition-link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  Presentation,
  Trash2,
} from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { storyPoints } from "@/lib/sprints/plan";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import { fmt } from "@/lib/charts/chart-text";
import { removeWithUndo } from "@/lib/utils/undoable";
import type { Story } from "@/lib/stores/workspace-types";
import {
  demoCandidates,
  demoLength,
  demoMinutes,
  moveItem,
  shortName,
  withStoriesInDemo,
} from "../doc";
import { byData, focusMoved, focusSoon } from "../focus";
import { demoScript } from "../markdown";
import type { DemoFeature, ReviewSource } from "../types";
import { DemoAddForm, DemoEditor, type DemoValues } from "./demo-form";

const pts = (s: Story) =>
  typeof s.points === "number" && Number.isFinite(s.points)
    ? `${fmt(storyPoints(s))} ${s.points === 1 ? "pt" : "pts"}`
    : "Not estimated";

export function DemoScriptTab({ source }: { source: ReviewSource }) {
  const { doc, writer, facts, sprint, example } = source;
  const features = doc.features;
  const { log } = useHistoryLogger("sprint-review");
  const announce = useAnnounce();
  const [editingId, setEditingId] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const candidates = facts ? demoCandidates(facts.done, features) : [];
  const waiting = candidates.filter((c) => !c.inDemo).map((c) => c.story);
  const { minutes, untimed } = demoLength(features);

  // The example's edits stay in memory and out of the history.
  const record = (action: string, meta: Record<string, unknown>) => {
    if (!example) log(action, meta);
  };

  const updateFeatures = (fn: (list: readonly DemoFeature[]) => DemoFeature[]) =>
    writer.update((d) => ({ ...d, features: fn(d.features) }));

  function addStories(stories: Story[]) {
    if (stories.length === 0) return;
    writer.update((d) => withStoriesInDemo(d, stories));
    record(SPRINT_REVIEW_ACTIONS.ITEM_ADDED, { fromStories: stories.map((s) => s.id) });
    announce(
      stories.length === 1
        ? `Added “${shortName(stories[0].title)}” to the demo.`
        : `Added ${stories.length} done stories to the demo.`
    );
    // The button gives way to "In the demo": focus that (the first one when
    // they all went), so Tab carries on down the list.
    focusSoon(() => byData("demo-added", stories[0].id));
  }

  function add(values: DemoValues) {
    updateFeatures((list) => [...list, { id: crypto.randomUUID(), ...values }]);
    record(SPRINT_REVIEW_ACTIONS.ITEM_ADDED, { name: values.name });
    announce(`Added “${shortName(values.name)}” to the demo.`);
  }

  // Saved or cancelled, the editor closes: focus goes back to the item's Edit button.
  function closeEditor(f: DemoFeature) {
    setEditingId(null);
    focusSoon(() => byData("demo-edit", f.id));
  }

  function save(f: DemoFeature, values: DemoValues) {
    closeEditor(f);
    updateFeatures((list) => list.map((x) => (x.id === f.id ? { ...x, ...values } : x)));
  }

  function remove(f: DemoFeature, index: number) {
    // Focus moves on to the next item (else the previous one), or to the
    // add form once the script is empty.
    const neighbour = features[index + 1] ?? features[index - 1];
    removeWithUndo<DemoFeature>({
      label: f.name.trim()
        ? `Removed “${shortName(f.name)}” from the demo`
        : `Removed demo item ${index + 1}`,
      update: updateFeatures,
      match: (x) => x.id === f.id,
    });
    record(SPRINT_REVIEW_ACTIONS.ITEM_REMOVED, { featureId: f.id, name: f.name });
    focusSoon(() =>
      neighbour
        ? byData("demo-edit", neighbour.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  }

  function move(f: DemoFeature, index: number, delta: -1 | 1) {
    const to = Math.max(0, Math.min(features.length - 1, index + delta));
    if (to === index) return;
    updateFeatures((list) => moveItem(list, f.id, delta));
    announce(`Moved “${shortName(f.name || "Untitled item")}” to ${to + 1} of ${features.length}.`);
    focusMoved("demo-move", f.id, delta === -1 ? "up" : "down");
  }

  return (
    <div className="space-y-6">
      {sprint && facts && (
        <SectionCard
          title={`Done in ${sprint.name}`}
          icon={CheckCircle2}
          iconClassName="text-success"
          actions={
            waiting.length >= 2 ? (
              <Button type="button" size="sm" variant="outline" onClick={() => addStories(waiting)}>
                <Plus aria-hidden="true" />
                Add all {waiting.length} to the demo
              </Button>
            ) : undefined
          }
        >
          {candidates.length === 0 ? (
            <p className="text-sm text-sub">
              No stories are done in {sprint.name} yet. Done stories show up here, ready to add to
              the demo.{" "}
              {!example && (
                <Link
                  href={sprintHref("/kanban", sprint.id)}
                  className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                >
                  Open the sprint board
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-border" aria-label={`Stories done in ${sprint.name}`}>
              {candidates.map(({ story, inDemo }) => (
                <li key={story.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 basis-48 break-words text-sm text-text">
                    {story.title}
                  </span>
                  <span className="font-data text-xs text-sub">{pts(story)}</span>
                  {story.owner && <span className="text-xs text-sub">{story.owner}</span>}
                  {inDemo ? (
                    // Focusable from script only: "Add to demo" hands focus here.
                    <span
                      tabIndex={-1}
                      data-demo-added={story.id}
                      className="inline-flex items-center gap-1 rounded text-xs text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      In the demo
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => addStories([story])}
                      aria-label={`Add “${story.title}” to the demo`}
                      className="min-touch-coarse h-7 gap-1 px-2 text-xs text-sub hover:text-accent"
                    >
                      <Plus aria-hidden="true" />
                      Add to demo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Demo script"
        icon={Clock}
        titleSuffix={
          features.length > 0
            ? `— ${fmt(minutes)} min${untimed > 0 ? ` · ${untimed} not timed` : ""}`
            : undefined
        }
        contentClassName="space-y-4"
      >
        {features.length === 0 ? (
          <p className="text-sm text-sub">
            Nothing on the demo script yet.{" "}
            {waiting.length > 0
              ? "Add the done stories above, or an item of your own below."
              : "Add what you'll show below."}
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Demo script, in running order">
            {features.map((f, i) => (
              <li key={f.id} className="rounded-lg border border-border bg-surface-deep/50 p-3">
                {editingId === f.id ? (
                  <DemoEditor
                    feature={f}
                    onSave={(values) => save(f, values)}
                    onCancel={() => closeEditor(f)}
                  />
                ) : (
                  <DemoRow
                    feature={f}
                    index={i}
                    count={features.length}
                    onEdit={() => setEditingId(f.id)}
                    onRemove={() => remove(f, i)}
                    onMove={(delta) => move(f, i, delta)}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={addRef} className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium text-text">Add an item</h3>
          <DemoAddForm onAdd={add} />
        </div>
      </SectionCard>

      {features.length > 0 && (
        <SectionCard
          title="Demo script to share"
          icon={Presentation}
          actions={
            <ExportButton
              filename="demo-script"
              markdown={demoScript(doc, sprint?.name)}
              clipboardText={demoScript(doc, sprint?.name)}
            />
          }
        >
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-deep/60 p-4 font-mono text-sm leading-relaxed text-sub">
            {demoScript(doc, sprint?.name)}
          </pre>
        </SectionCard>
      )}
    </div>
  );
}

/** One demo item: order, name and time, what and acceptance, actions. */
function DemoRow({
  feature: f,
  index,
  count,
  onEdit,
  onRemove,
  onMove,
}: {
  feature: DemoFeature;
  index: number;
  count: number;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const minutes = demoMinutes(f);
  const name = f.name.trim() || "Untitled item";
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className="w-5 shrink-0 font-mono text-xs text-accent" aria-hidden="true">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-text">
          <span className={f.name.trim() ? "font-medium" : "italic text-sub"}>{name}</span>
          <span className="font-data text-xs text-sub">
            {minutes === null ? "Not timed" : `${fmt(minutes)} min`}
          </span>
        </p>
        {f.description.trim() && <p className="break-words text-xs text-sub">{f.description}</p>}
        {f.acceptanceCriteria.trim() && (
          <p className="whitespace-pre-wrap break-words text-xs text-sub">
            <span className="font-medium text-text">Acceptance: </span>
            {f.acceptanceCriteria}
          </p>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center">
        <IconButton
          label={`Move ${name} up`}
          icon={<ArrowUp className="h-4 w-4" />}
          className="text-sub hover:text-text"
          disabled={index === 0}
          data-demo-move={`${f.id}:up`}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={`Move ${name} down`}
          icon={<ArrowDown className="h-4 w-4" />}
          className="text-sub hover:text-text"
          disabled={index === count - 1}
          data-demo-move={`${f.id}:down`}
          onClick={() => onMove(1)}
        />
        <IconButton
          label={`Edit ${name}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          data-demo-edit={f.id}
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
