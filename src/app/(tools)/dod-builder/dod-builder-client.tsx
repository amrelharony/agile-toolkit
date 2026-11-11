"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "@/components/motion/transition-link";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { ArrowRight, BarChart3, ListChecks, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { generateDodBuilderPrompts } from "@/lib/ai-prompts/dod-builder";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DOD_ACTIONS } from "@/lib/history/event-actions";
import { pickDefaultSprint, todayIso } from "@/lib/sprints/series";
import { sprintHref, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DefinitionOfDone,
  DodCategory,
  DodCriterion,
  Story,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { toast } from "@/lib/utils/toast";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import {
  DOD_CATEGORIES,
  DOD_CATEGORY_LABEL,
  DOD_DOC_ID,
  adherenceBySprint,
  dodAdherence,
  dodVerdict,
  normalizeDefinitionOfDone,
  quotableAdherence,
  requiredCriteria,
} from "@/lib/dod/model";
import { useDefinitionOfDone } from "@/lib/dod/use-definition-of-done";
import {
  CHART_MIN_SPRINTS,
  adherenceChartText,
  adherenceControl,
  adherencePoints,
  adherenceTrend,
  controlSentence,
  trendSentence,
} from "./adherence";
import { AddCriterionForm } from "./criterion-form";
import { CriterionRow } from "./criterion-row";
import { buildExample, type DodExample } from "./example";
import { labelKey, type CriterionValues } from "./form";
import { dodMarkdown } from "./markdown";
import { COMMON_CRITERIA } from "./starter";

// Recharts loads with the charts, not the page.
const DodAdherenceChart = dynamic(() => import("./charts").then((m) => m.DodAdherenceChart), {
  ssr: false,
});
const DodControlChart = dynamic(() => import("./charts").then((m) => m.DodControlChart), {
  ssr: false,
});

export const TOOL_ID = "dod-builder";

const NO_STORIES: Story[] = [];

/** A change to the DoD, applied to the document as it is when it runs. */
type DocUpdate = (doc: DefinitionOfDone) => DefinitionOfDone;

const noLog = () => undefined;

/** Focus what `find` returns once React has re-rendered (a deleted or moved row took focus with it). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/** The control of criterion `id` that carries `attr` (data-criterion-edit or -category). */
const criterionControl = (attr: string, id: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
    (el) => el.getAttribute(attr) === id
  );

/** `c` with its words as edited; an emptied description goes. */
function withText(c: DodCriterion, label: string, description: string | undefined): DodCriterion {
  const next: DodCriterion = { ...c, label };
  if (description !== undefined) {
    if (description.trim()) next.description = description.trim();
    else delete next.description;
  }
  return next;
}

/**
 * The Definition of Done builder: the team's criteria (Required by default,
 * edited in place, deleted with Undo), and how many done stories meet
 * them, from the ticks on each story's Sprint board card, per sprint and
 * over time. The DoD is a workspace document, so the Sprint board, Release
 * Readiness, the Team charter and agents read the same one.
 */
export function DodBuilderClient() {
  const hydrated = useWorkspaceHydrated();
  const { doc: teamDoc, moving } = useDefinitionOfDone();
  const workspaceStories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const { sprints: workspaceSprints, selected, select } = useSelectedSprint();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<DodExample | null>(null);
  const [exampleSprintId, setExampleSprintId] = useState<string | undefined>(undefined);
  const preview = example !== null;
  // The old blob is read, not edited, until it has moved in (the hook
  // waits for the owner's first cloud pull): an edit now would be built
  // from this device's copy and could beat a newer DoD from the cloud.
  const locked = moving && !preview;
  const doc = example?.doc ?? teamDoc;
  const stories = example?.stories ?? workspaceStories;
  const sprints = example?.sprints ?? workspaceSprints;
  const sprint = example
    ? (example.sprints.find((s) => s.id === exampleSprintId) ??
      pickDefaultSprint(example.sprints, null))
    : selected;
  const resetSnapshot = useRef<DodCriterion[] | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  // The example counts its own rows; the team's numbers never count example rows.
  const opts = preview ? { examples: true } : undefined;
  const adherence = useMemo(
    () => dodAdherence(stories, doc, sprint?.id, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts follows `preview`
    [stories, doc, sprint?.id, preview]
  );
  const bySprint = useMemo(
    () => adherenceBySprint(stories, sprints, doc, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts follows `preview`
    [stories, sprints, doc, preview]
  );
  const points = adherencePoints(bySprint);
  const chart = adherenceChartText(points);
  const control = adherenceControl(points);
  const trend = adherenceTrend(points);
  const required = requiredCriteria(doc);
  const verdict = dodVerdict(doc, adherence, sprint?.name);
  const markdown = dodMarkdown(doc, {
    verdict,
    ...(sprint ? { sprint: { name: sprint.name, adherence } } : {}),
    bySprint,
  });

  /* ── Writes ───────────────────────────────────────────────────────── */

  /**
   * Writes the workspace's DoD, read fresh from the store. The page offers
   * no edit while the old blob is still moving in (`locked`), so a missing
   * document here is a new, empty one.
   */
  const writeStore = (update: DocUpdate) => {
    const { definitionsOfDone, upsertDefinitionOfDone } = useWorkspaceStore.getState();
    const current = (definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID);
    upsertDefinitionOfDone({ ...update(normalizeDefinitionOfDone(current)), id: DOD_DOC_ID });
  };
  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write: (update: DocUpdate) => void = preview
    ? (update) => setExample((ex) => (ex ? { ...ex, doc: update(ex.doc) } : ex))
    : writeStore;
  const record: typeof log = preview ? noLog : log;
  const newId = () => (preview ? exampleId(`dod-${nanoid(6)}`) : `dod_${nanoid(8)}`);

  const patch = (id: string, change: (c: DodCriterion) => DodCriterion) =>
    write((d) => ({ ...d, items: d.items.map((c) => (c.id === id ? change(c) : c)) }));

  const add = (v: CriterionValues) => {
    const criterion: DodCriterion = {
      id: newId(),
      label: v.label,
      category: v.category,
      required: v.required,
      ...(v.description ? { description: v.description } : {}),
    };
    write((d) => ({ ...d, items: [...d.items, criterion] }));
    record(DOD_ACTIONS.CRITERION_ADDED, {
      itemId: criterion.id,
      label: criterion.label,
      category: criterion.category,
      required: criterion.required,
    });
    announce(
      `Added “${criterion.label}” as ${criterion.required ? "required" : "optional"} under ${DOD_CATEGORY_LABEL[criterion.category]}`
    );
  };

  const startFromCommon = () => {
    const added = COMMON_CRITERIA.map((c) => ({ ...c, id: newId() }));
    const ids = new Set(added.map((c) => c.id));
    undoable({
      label: `Added ${added.length} common criteria`,
      apply: () => write((d) => ({ ...d, items: [...d.items, ...added] })),
      revert: () => write((d) => ({ ...d, items: d.items.filter((c) => !ids.has(c.id)) })),
    });
    announce(`Added ${added.length} common criteria`);
  };

  const editText = (c: DodCriterion, label: string, description: string | undefined) => {
    // The add form and update_criterion refuse a second copy; so does an edit in place.
    if (doc.items.some((x) => x.id !== c.id && labelKey(x.label) === labelKey(label))) {
      toast.error(`“${label}” is already in the Definition of Done.`);
      return;
    }
    patch(c.id, (x) => withText(x, label, description));
    record(DOD_ACTIONS.CRITERION_TOGGLED, { itemId: c.id, label });
  };

  const setRequired = (c: DodCriterion, value: boolean) => {
    patch(c.id, (x) => ({ ...x, required: value }));
    record(DOD_ACTIONS.CRITERION_TOGGLED, { itemId: c.id, label: c.label, required: value });
    announce(`“${c.label}” is ${value ? "required" : "optional"}`);
  };

  const setCategory = (c: DodCriterion, category: DodCategory) => {
    if (category === c.category) return;
    patch(c.id, (x) => ({ ...x, category }));
    announce(`Moved “${c.label}” to ${DOD_CATEGORY_LABEL[category]}`);
    // The row mounts again under its new category; its category stays focused.
    focusSoon(() => criterionControl("data-criterion-category", c.id));
  };

  const remove = (c: DodCriterion) => {
    // Focus moves to the next criterion as listed (or the one before, or the form).
    const listed = DOD_CATEGORIES.flatMap((cat) => doc.items.filter((x) => x.category === cat));
    const at = listed.findIndex((x) => x.id === c.id);
    const near = listed[at + 1] ?? listed[at - 1];
    removeWithUndo<DodCriterion>({
      label: `Deleted “${c.label}”`,
      description: "Stories keep their ticks, so Undo brings it back as it was.",
      update: (fn) => write((d) => ({ ...d, items: fn(d.items) })),
      match: (x) => x.id === c.id,
    });
    record(DOD_ACTIONS.CRITERION_REMOVED, { itemId: c.id, label: c.label });
    announce(`Deleted “${c.label}”`);
    focusSoon(() =>
      near
        ? criterionControl("data-criterion-edit", near.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  };

  const loadExample = () => {
    setExample(buildExample(today));
    setExampleSprintId(undefined);
  };
  const clearExample = () => setExample(null);

  const promptConfig = useMemo(
    () => ({
      toolName: "Definition of Done Builder",
      prompts: generateDodBuilderPrompts({ items: doc.items, history: doc.history }),
    }),
    [doc]
  );

  const page = (body: ReactNode) => (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Definition of Done Builder"
      description="The team's Definition of Done, ticked on each story's Sprint board card, and how many done stories meet it, sprint by sprint."
      category="Risk & Governance"
    >
      {body}
    </ToolPageWrapper>
  );

  if (!hydrated) {
    return page(
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading the Definition of Done…
      </p>
    );
  }

  const hasCriteria = doc.items.length > 0;
  const groups = DOD_CATEGORIES.map((cat) => ({
    cat,
    items: doc.items.filter((c) => c.category === cat),
  })).filter((g) => g.items.length > 0);

  return page(
    <>
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="definition-of-done"
          markdown={markdown}
          clipboardText={markdown}
          csvData={{
            headers: ["Category", "Criterion", "Description", "Required"],
            rows: doc.items.map((i) => [
              DOD_CATEGORY_LABEL[i.category],
              i.label,
              i.description ?? "",
              i.required ? "Yes" : "No",
            ]),
          }}
          jsonData={doc}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a checkout team&apos;s last six sprints. Nothing in it is saved, and your own
            Definition of Done stays as it is.
          </p>
        </div>
      )}

      {!hasCriteria && !preview && (
        <EmptyState
          icon={ShieldCheck}
          className="mb-4"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {!locked && (
                <Button type="button" size="sm" className="gap-1" onClick={startFromCommon}>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Start from common criteria
                </Button>
              )}
              <LoadExampleButton onLoad={loadExample} />
            </div>
          }
        >
          No Definition of Done yet. Add the criteria every story must meet below, or start from
          common ones; then tick them on each story&apos;s card on the Sprint board.
        </EmptyState>
      )}

      {hasCriteria && (
        <>
          <div className="mb-3 space-y-3">
            {sprints.length > 0 && (
              <SprintPicker
                sprints={sprints}
                selectedId={sprint?.id}
                onSelect={preview ? setExampleSprintId : select}
                allowCreate={false}
              />
            )}
            <p className="text-sm font-medium text-text">{verdict}</p>
          </div>
          <KpiGrid cols={4} gap="lg">
            <StatCard
              variant="compact"
              icon={ListChecks}
              label="Criteria"
              value={doc.items.length}
              hint={`${required.length} required`}
              valueClassName="text-accent"
            />
            <StatCard
              variant="compact"
              icon={ShieldCheck}
              label="Meeting the DoD"
              value={
                adherence.done > 0 && required.length > 0
                  ? `${adherence.meeting} of ${adherence.done}`
                  : "—"
              }
              hint={sprint ? `done stories in ${sprint.name}` : "done stories"}
            />
            <StatCard
              variant="compact"
              label="Adherence"
              value={quotableAdherence(adherence) ? `${adherence.pct}%` : "—"}
              hint={
                required.length === 0
                  ? "nothing required yet"
                  : adherence.pct === null
                    ? "no done stories"
                    : quotableAdherence(adherence)
                      ? "of done stories"
                      : "too few done stories for a %"
              }
            />
            <StatCard
              variant="compact"
              icon={BarChart3}
              label="Sprints tracked"
              value={bySprint.length}
              hint="with done stories"
            />
          </KpiGrid>
        </>
      )}

      <div className="space-y-6">
        <SectionCard title="Criteria" icon={Plus}>
          {locked ? (
            <p className="text-sm text-sub" role="status">
              Moving your Definition of Done into the workspace, so the Sprint board and agents can
              read it; you can edit it once it has moved. Your earlier copy is kept as a backup.
            </p>
          ) : (
            <div ref={addRef}>
              <AddCriterionForm criteria={doc.items} onAdd={add} />
            </div>
          )}
          {groups.length > 0 && (
            <div className="mt-5 space-y-4">
              {groups.map((g) => (
                <section key={g.cat} aria-label={DOD_CATEGORY_LABEL[g.cat]} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">
                    {DOD_CATEGORY_LABEL[g.cat]}{" "}
                    <span className="font-data font-normal">{g.items.length}</span>
                  </h3>
                  <ul className="space-y-2">
                    {g.items.map((c) => (
                      <CriterionRow
                        key={c.id}
                        criterion={c}
                        readOnly={locked}
                        onText={editText}
                        onRequired={setRequired}
                        onCategory={setCategory}
                        onDelete={remove}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {!preview && !locked && hasCriteria && (
            <div className="mt-4 flex justify-end">
              <ResetButton
                label="Clear the criteria"
                title="Clear the Definition of Done?"
                description={`${
                  doc.items.length === 1 ? "The one criterion" : `All ${doc.items.length} criteria`
                }. The ticks on stories stay, and come back with Undo.`}
                confirmLabel="Clear criteria"
                doneLabel="Cleared the Definition of Done"
                onReset={() => {
                  resetSnapshot.current = doc.items;
                  writeStore((d) => ({ ...d, items: [] }));
                  log(DOD_ACTIONS.DOD_RESET, { criteria: doc.items.length });
                }}
                onUndo={() => {
                  const items = resetSnapshot.current;
                  if (items) writeStore((d) => ({ ...d, items: [...items, ...d.items] }));
                }}
              />
            </div>
          )}
        </SectionCard>

        {hasCriteria && required.length > 0 && (
          <SectionCard
            title={sprint ? `Done stories in ${sprint.name}` : "Done stories"}
            icon={ShieldCheck}
          >
            {adherence.done === 0 ? (
              <p className="text-sm text-sub">No story is done yet.</p>
            ) : adherence.missing.length === 0 ? (
              <p className="text-sm text-success">Every done story meets the DoD.</p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Done stories missing the DoD">
                {adherence.missing.map((m) => (
                  <li key={m.id} className="py-2 text-sm">
                    <span className="font-medium text-text">{m.title}</span>
                    <span className="text-sub"> still needs {m.open.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-sub">
              {preview ? (
                "Each story's criteria are ticked on its card on the Sprint board."
              ) : (
                <Link
                  href={sprintHref("/kanban", sprint?.id)}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  Tick them on the Sprint board
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </p>
          </SectionCard>
        )}

        {hasCriteria && required.length > 0 && (
          <SectionCard title="Adherence by sprint" icon={BarChart3}>
            {points.length >= CHART_MIN_SPRINTS ? (
              <ChartFigure
                label="Adherence by sprint"
                summary={chart.summary}
                table={chart.table}
                caption="Done stories meeting the DoD, by sprint"
                plotClassName="h-[200px]"
              >
                <DodAdherenceChart data={points} />
              </ChartFigure>
            ) : (
              <NotEnoughData
                have={points.length}
                need={CHART_MIN_SPRINTS}
                unit={["sprint with done stories", "sprints with done stories"]}
                action="Finish"
                what="adherence by sprint"
              />
            )}
            <p className="mt-2 text-xs text-sub">
              Every sprint is checked against today&apos;s required criteria, so a criterion added
              later counts against earlier sprints too.
            </p>
            {points.length >= CHART_MIN_SPRINTS && (
              <AdvancedAnalysis
                summary="Advanced analysis: control limits and trend"
                className="mt-4"
              >
                {control ? (
                  <ChartFigure
                    label="Adherence by sprint, with control limits"
                    summary={controlSentence(points, control)}
                    table={chart.table}
                    caption="Adherence by sprint"
                    plotClassName="h-[200px]"
                  >
                    <DodControlChart data={points} control={control} />
                  </ChartFigure>
                ) : (
                  <NotEnoughData
                    have={points.length}
                    need="changePoint"
                    unit={["sprint", "sprints"]}
                    action="Finish"
                    what="control limits on adherence"
                  />
                )}
                {trend ? (
                  <p className="text-sm text-text">{trendSentence(trend)}</p>
                ) : (
                  <NotEnoughData
                    have={points.length}
                    need="trend"
                    unit={["sprint", "sprints"]}
                    action="Finish"
                    what="whether adherence is trending"
                  />
                )}
              </AdvancedAnalysis>
            )}
          </SectionCard>
        )}

        {doc.history.length > 0 && (
          <details className="rounded-lg border border-border bg-card">
            <summary className="min-h-11 cursor-pointer px-4 py-2 text-sm font-medium text-text">
              Before per-story checks ({doc.history.length}{" "}
              {doc.history.length === 1 ? "sprint" : "sprints"})
            </summary>
            <div className="scroll-x-snap relative border-t border-border px-4 py-3">
              <p className="mb-2 text-xs text-sub">
                Team-level tallies saved before each story carried its own ticks. Kept as they were,
                read-only.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub">
                    <th className="py-1 pr-3 font-medium">Sprint</th>
                    <th className="py-1 pr-3 font-medium">Required met</th>
                    <th className="py-1 font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.history.map((h, i) => (
                    <tr key={`${h.sprintName}-${h.ts}-${i}`} className="border-t border-border">
                      <td className="py-1 pr-3 text-text">{h.sprintName}</td>
                      <td className="py-1 pr-3 text-text">
                        {h.completed} of {h.totalRequired}
                      </td>
                      <td className="py-1 text-sub">{h.ts.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </>
  );
}
