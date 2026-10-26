"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Clock, Flag, Plus, Sparkles, TrendingUp } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ADKAR_ACTIONS } from "@/lib/history/event-actions";
import { generateAdkarPrompts } from "@/lib/ai-prompts/adkar";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AdkarDoc,
  AdkarElement,
  AdkarGroup,
  AdkarInitiative,
  AdkarScore,
  AdkarStageEntry,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { needMore } from "@/lib/analytics/min-sample";
import { todayIso } from "@/lib/sprints/series";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import {
  ADKAR_DOC_ID,
  ADKAR_ELEMENTS,
  ELEMENT_LABEL,
  adkarVerdict,
  advance,
  barrierPoint,
  completedStages,
  daysInStage,
  initiativeBarrier,
  longestInCurrentStage,
  medianDaysInStage,
  newGroup,
  newInitiative,
  normalizeAdkarDoc,
  stageCounts,
  stepBack,
  withDetails,
  withGroupPatch,
  withGroupScore,
  withInitiative,
  withStartDate,
  type NewInitiative,
} from "@/lib/adkar/model";
import { buildExample, type AdkarExample } from "./example";
import { InitiativeCard } from "./initiative-card";
import { InitiativeForm } from "./initiative-form";
import { adkarToMarkdown, stageChartText } from "./markdown";
import { useLegacyAdkarMove } from "./use-legacy-adkar";

export const TOOL_ID = "adkar";

/**
 * Logged when an initiative steps back a stage. Not in ADKAR_ACTIONS
 * (lib/history/event-actions.ts) yet; named like the events that are.
 */
const STAGE_STEPPED_BACK = "stage_stepped_back";

// Recharts loads with the chart, not the page.
const AdkarStageFunnelChart = dynamic(
  () => import("./charts").then((m) => m.AdkarStageFunnelChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

/** A change to the doc. */
type DocUpdate = (doc: AdkarDoc) => AdkarDoc;

/** Writes to the workspace: the doc the next steps and tool.adkar.* read. */
function writeStore(update: DocUpdate) {
  const { adkarDocs, upsertAdkarDoc } = useWorkspaceStore.getState();
  const current = normalizeAdkarDoc(
    (adkarDocs ?? []).find((d) => d.id === ADKAR_DOC_ID),
    todayIso()
  );
  upsertAdkarDoc({ ...update(current), id: ADKAR_DOC_ID });
}

/**
 * Undo for a stage move: take back the entry the move added, when it is
 * still the last one, and the stage it left. Other edits made since stay.
 */
function undoMove(i: AdkarInitiative, entry: AdkarStageEntry, from: AdkarElement): AdkarInitiative {
  const last = i.stageHistory[i.stageHistory.length - 1];
  if (!last || last.stage !== entry.stage || last.enteredAt !== entry.enteredAt) return i;
  return { ...i, currentStage: from, stageHistory: i.stageHistory.slice(0, -1) };
}

export function AdkarClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="ADKAR Change Tracker"
      description="Move each change initiative through Awareness → Desire → Knowledge → Ability → Reinforcement, and score the groups it affects to find where adoption is stuck."
      category="Outcomes & Pulse"
    >
      <AdkarTool />
    </ToolPageWrapper>
  );
}

/**
 * ADKAR: initiatives on dated stage moves (forward and back) from their
 * start date, groups scored per element with the barrier point named, the
 * time spent per stage, and the verdict on what's held up. The data lives
 * in the workspace (adkarDocs), moved once from the old blob; the example
 * lives in this page's memory only.
 */
export function AdkarTool() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => (s.adkarDocs ?? []).find((d) => d.id === ADKAR_DOC_ID));
  const moving = useLegacyAdkarMove(stored);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<AdkarExample | null>(null);
  const preview = example !== null;
  const doc = useMemo(
    () => normalizeAdkarDoc(example?.doc ?? stored, today),
    [example, stored, today]
  );
  const initiatives = doc.initiatives;
  const resetBefore = useRef<AdkarDoc | undefined>(undefined);

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between.
  const write = (update: DocUpdate) => {
    if (!preview) return writeStore(update);
    setExample((ex) => ex && { doc: update(normalizeAdkarDoc(ex.doc, today)) });
  };
  const record: typeof log = preview ? () => undefined : log;
  const change = (id: string, fn: (i: AdkarInitiative) => AdkarInitiative | null) =>
    write((d) => withInitiative(d, id, fn));

  /* ── Initiatives ─────────────────────────────────────────────────── */

  const add = (values: NewInitiative) => {
    const i = newInitiative(values, crypto.randomUUID());
    write((d) => ({ ...d, initiatives: [i, ...d.initiatives] }));
    record(ADKAR_ACTIONS.INITIATIVE_ADDED, { initiativeId: i.id, name: i.name, owner: i.owner });
    announce(`Added ${i.name} at Awareness`);
  };

  const edit = (i: AdkarInitiative, values: NewInitiative) => {
    change(i.id, (x) => {
      const next = withDetails(x, {
        name: values.name,
        owner: values.owner ?? null,
        description: values.description ?? null,
      });
      return values.startDate === x.startDate
        ? next
        : (withStartDate(next, values.startDate, today) ?? next);
    });
    announce(`Saved ${values.name}`);
  };

  const move = (i: AdkarInitiative, direction: "advance" | "back", on: string) => {
    const next = direction === "advance" ? advance(i, on, today) : stepBack(i, on, today);
    if (!next) return;
    const entry = next.stageHistory[next.stageHistory.length - 1];
    const label = `${i.name}: ${direction === "advance" ? "moved on" : "stepped back"} to ${ELEMENT_LABEL[next.currentStage]}`;
    undoable({
      label,
      apply: () => {
        change(i.id, (x) =>
          x.currentStage === i.currentStage
            ? direction === "advance"
              ? advance(x, on, today)
              : stepBack(x, on, today)
            : null
        );
        record(direction === "advance" ? ADKAR_ACTIONS.STAGE_ADVANCED : STAGE_STEPPED_BACK, {
          initiativeId: i.id,
          from: i.currentStage,
          to: next.currentStage,
          on,
        });
      },
      revert: () => change(i.id, (x) => undoMove(x, entry, i.currentStage)),
    });
    announce(label);
  };

  const remove = (i: AdkarInitiative) => {
    removeWithUndo<AdkarInitiative>({
      label: `Deleted “${i.name}”`,
      update: (fn) => write((d) => ({ ...d, initiatives: fn(d.initiatives) })),
      match: (x) => x.id === i.id,
    });
    record(ADKAR_ACTIONS.INITIATIVE_REMOVED, { initiativeId: i.id, name: i.name });
    announce(`Deleted ${i.name}`);
  };

  /* ── Groups ──────────────────────────────────────────────────────── */

  const addGroup = (i: AdkarInitiative, name: string) => {
    const group = newGroup(name, crypto.randomUUID());
    change(i.id, (x) => ({ ...x, groups: [...(x.groups ?? []), group] }));
    announce(`Added the group ${group.name} to ${i.name}`);
  };

  const score = (
    i: AdkarInitiative,
    groupId: string,
    element: AdkarElement,
    value: AdkarScore | null
  ) => {
    let barrier = "";
    change(i.id, (x) => {
      const next = withGroupScore(x, groupId, element, value, today);
      const g = next.groups?.find((y) => y.id === groupId);
      const b = barrierPoint(g?.scores);
      barrier = b.element ? ` Barrier: ${ELEMENT_LABEL[b.element]}.` : "";
      return next;
    });
    const group = i.groups?.find((g) => g.id === groupId)?.name ?? "The group";
    announce(
      `${group}, ${ELEMENT_LABEL[element]}: ${value === null ? "not scored" : `${value} of 5`}.${barrier}`
    );
  };

  const patchGroup = (
    i: AdkarInitiative,
    groupId: string,
    patch: Parameters<typeof withGroupPatch>[2]
  ) => change(i.id, (x) => withGroupPatch(x, groupId, patch));

  const removeGroup = (i: AdkarInitiative, g: AdkarGroup) => {
    removeWithUndo<AdkarGroup>({
      label: `Deleted the group “${g.name}”`,
      update: (fn) => change(i.id, (x) => ({ ...x, groups: fn(x.groups ?? []) })),
      match: (y) => y.id === g.id,
    });
    announce(`Deleted the group ${g.name}`);
  };

  /* ── Reset and the example ───────────────────────────────────────── */

  const reset = () => {
    const { adkarDocs, upsertAdkarDoc } = useWorkspaceStore.getState();
    resetBefore.current = (adkarDocs ?? []).find((d) => d.id === ADKAR_DOC_ID);
    upsertAdkarDoc({ id: ADKAR_DOC_ID, initiatives: [] });
    log(ADKAR_ACTIONS.ADKAR_RESET, {});
    announce("Cleared every initiative");
  };
  const undoReset = () => {
    const before = resetBefore.current;
    if (before) useWorkspaceStore.getState().upsertAdkarDoc(before);
  };

  const loadExample = () => setExample(buildExample());
  const clearExample = () => setExample(null);

  /* ── Numbers, exports and prompts ────────────────────────────────── */

  const counts = stageCounts(initiatives);
  const held = initiatives.filter((i) => initiativeBarrier(i) !== null).length;
  const median = medianDaysInStage(initiatives, today);
  const longest = longestInCurrentStage(initiatives, today);
  const verdict = adkarVerdict(initiatives, today);
  const chart = stageChartText(initiatives);
  const markdown = adkarToMarkdown(initiatives, today);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "ADKAR Change Tracker",
      prompts: generateAdkarPrompts(
        {
          initiatives: initiatives.map((i) => ({
            name: i.name,
            currentStage: i.currentStage,
            stagesCompleted: completedStages(i),
            owner: i.owner,
            startDate: i.startDate,
            description: i.description,
          })),
          perStage: counts,
          pctReinforcement: initiatives.length > 0 ? counts.reinforcement / initiatives.length : 0,
          avgDaysPerStage: median.median,
        },
        workspace
      ),
    }),
    [initiatives, counts, median.median, workspace]
  );

  if (!hydrated) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading the change initiatives…
      </p>
    );
  }

  const storedHasData = (stored?.initiatives?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: three changes a platform team is rolling out. Nothing in it is saved, and your
            own initiatives stay as they are.
          </p>
        </div>
      )}

      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="adkar"
          markdown={markdown}
          clipboardText={markdown}
          csvData={{
            headers: [
              "Name",
              "Current stage",
              "Days in stage",
              "Owner",
              "Start date",
              "Barrier",
              "Description",
            ],
            rows: initiatives.map((i) => {
              const b = initiativeBarrier(i);
              return [
                i.name,
                ELEMENT_LABEL[i.currentStage],
                daysInStage(i, today),
                i.owner ?? "",
                i.startDate,
                b ? `${ELEMENT_LABEL[b.element]} (${b.groupName}: ${b.score}/5)` : "",
                (i.description ?? "").replace(/\n/g, " "),
              ];
            }),
          }}
          jsonData={initiatives}
        />
        {!preview && (
          <ResetButton
            label="Clear all"
            title="Clear every initiative?"
            description="Every initiative, its groups and its history go."
            confirmLabel="Clear initiatives"
            doneLabel="Cleared every initiative"
            disabled={!storedHasData}
            onReset={reset}
            onUndo={undoReset}
          />
        )}
      </ActionRow>

      <p className="text-sm font-medium text-text">{verdict}</p>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Sparkles}
          label="Initiatives"
          value={initiatives.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Flag}
          label="Held at a barrier"
          value={initiatives.length > 0 ? `${held}/${initiatives.length}` : "—"}
          tone={held > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Median days in a stage"
          value={median.median !== null ? `${median.median}d` : "—"}
          hint={
            median.median !== null
              ? `over ${median.periods} finished stages`
              : `${needMore(median.periods, "average")} more finished ${needMore(median.periods, "average") === 1 ? "stage" : "stages"} needed`
          }
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Longest in its stage"
          value={longest ? `${longest.days}d` : "—"}
          hint={
            longest
              ? `${longest.initiative.name} · ${ELEMENT_LABEL[longest.initiative.currentStage]}`
              : undefined
          }
        />
      </KpiGrid>

      <CalloutAlert tone="info">
        <strong>ADKAR</strong>: <em>Awareness</em> of the need, <em>Desire</em> to take part,{" "}
        <em>Knowledge</em> of how, <em>Ability</em> in real work, <em>Reinforcement</em> so it
        sticks. Score each affected group 1-5 per element; the first element at 3 or lower is its
        barrier point.
      </CalloutAlert>

      <SectionCard title="Add an initiative" icon={Plus}>
        <InitiativeForm
          today={today}
          onSave={add}
          submitLabel="Add initiative"
          submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          offerAddToRoster={!preview}
        />
      </SectionCard>

      {initiatives.length === 0 ? (
        moving ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
          >
            Moving your initiatives into the workspace…
          </p>
        ) : (
          <EmptyState
            icon={Sparkles}
            action={!preview ? <LoadExampleButton onLoad={loadExample} /> : undefined}
          >
            No initiatives yet. Add the first change you&apos;re tracking above; it starts at
            Awareness on its start date.
          </EmptyState>
        )
      ) : (
        <>
          <ul className="space-y-3">
            {initiatives.map((i) => (
              <li key={i.id}>
                <InitiativeCard
                  initiative={i}
                  today={today}
                  preview={preview}
                  handlers={{
                    onEdit: (values) => edit(i, values),
                    onMove: (direction, on) => move(i, direction, on),
                    onRemove: () => remove(i),
                    onAddGroup: (name) => addGroup(i, name),
                    onScore: (groupId, element, value) => score(i, groupId, element, value),
                    onGroupPatch: (groupId, patch) => patchGroup(i, groupId, patch),
                    onRemoveGroup: (g) => removeGroup(i, g),
                  }}
                />
              </li>
            ))}
          </ul>

          <SectionCard title="Initiatives by current stage" icon={TrendingUp}>
            <ChartFigure
              label="Initiatives by current stage"
              summary={chart.summary}
              table={chart.table}
              plotClassName="h-64"
            >
              <AdkarStageFunnelChart
                data={ADKAR_ELEMENTS.map((el) => ({ stage: ELEMENT_LABEL[el], count: counts[el] }))}
              />
            </ChartFigure>
          </SectionCard>
        </>
      )}
    </div>
  );
}
