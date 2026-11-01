"use client";

import { useMemo, useRef, useState } from "react";
import { AlertOctagon, CalendarClock, PieChart, Plus, Table2, Users } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Card, CardContent } from "@/components/ui/card";
import { useStableOrder } from "@/hooks/use-stable-order";
import { usePersisted } from "@/lib/utils/use-persisted";
import { removeWithUndo } from "@/lib/utils/undoable";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STAKEHOLDER_MAP_ACTIONS } from "@/lib/history/event-actions";
import { generateStakeholderMapPrompts } from "@/lib/ai-prompts/stakeholder-map";
import { todayIso } from "@/lib/sprints/series";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { buildExample } from "./example";
import { StakeholderDetail, StakeholderMap, type PlaceHow } from "./map";
import { sentimentText, stakeholdersToMarkdown } from "./markdown";
import {
  QUADRANTS,
  QUADRANT_DESCRIPTION,
  QUADRANT_LABEL,
  STORAGE_KEY,
  daysToTouch,
  isPlaced,
  normalizeStakeholders,
  positionText,
  quadrantOf,
  stakeholderVerdict,
  touchStatus,
  type Quadrant,
  type Stakeholder,
} from "./model";
import { StakeholderForm, type NewStakeholder } from "./stakeholder-form";
import { StakeholderRow } from "./stakeholder-row";

type ListUpdate = (list: readonly Stakeholder[]) => Stakeholder[];

const noLog = () => undefined;

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** "Last contact 12 days ago", "No contact logged". */
function lastContactText(s: Stakeholder, today: string): string {
  if (!s.lastContactAt) return "No contact logged";
  const ago = -(daysToTouch({ nextTouchAt: s.lastContactAt }, today) ?? 0);
  return ago <= 0 ? "Last contact today" : `Last contact ${days(ago)} ago`;
}

/** "Next touch in 4 days", "Next touch 3 days overdue", "No touch planned". */
function nextTouchText(s: Stakeholder, today: string): string {
  const d = daysToTouch(s, today);
  if (d === null) return "No touch planned";
  if (d < 0) return `Next touch ${days(-d)} overdue`;
  if (d === 0) return "Next touch today";
  return `Next touch in ${days(d)}`;
}

/**
 * Stakeholder Map: who matters, where they sit on Interest × Authority
 * (drag or arrow-key a dot; nobody is placed until you place them), how
 * they feel now versus how you need them to, and when you last spoke and
 * next will.
 */
export function StakeholderMapClient() {
  const [stored, setStored] = usePersisted<unknown>(STORAGE_KEY, []);
  const { log } = useHistoryLogger("stakeholder-map");
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
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

  // The example lives here only: nothing in it reaches the saved map.
  const [example, setExample] = useState<Stakeholder[] | null>(null);
  const preview = example !== null;
  const stakeholders = useMemo(() => example ?? normalizeStakeholders(stored), [example, stored]);
  // Fixed for the render an edit starts in, so its Undo goes back to the same place.
  const write = preview
    ? (fn: ListUpdate) => setExample((ex) => ex && fn(ex))
    : (fn: ListUpdate) => setStored((prev: unknown) => fn(normalizeStakeholders(prev)));
  const record: typeof log = preview ? noLog : log;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = stakeholders.find((s) => s.id === selectedId) ?? null;

  /* ── Changes ──────────────────────────────────────────────────────── */

  const addStakeholder = (values: NewStakeholder) => {
    const s: Stakeholder = { id: crypto.randomUUID(), ...values };
    write((prev) => [s, ...prev]);
    record(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_ADDED, {
      stakeholderId: s.id,
      name: s.name,
      sentiment: s.currentSentiment,
    });
    announce(
      isPlaced(s) ? `Added ${s.name}: ${positionText(s)}` : `Added ${s.name}, not placed yet`
    );
  };

  const updateStakeholder = (id: string, patch: Partial<Stakeholder>) => {
    write((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    record(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_UPDATED, {
      stakeholderId: id,
      fields: Object.keys(patch),
    });
  };

  const place = (id: string, at: { interest: number; authority: number }, how: PlaceHow) => {
    const s = stakeholders.find((x) => x.id === id);
    if (!s) return;
    updateStakeholder(id, at);
    // A drag and the arrow keys announce as they go; the picker says where it went.
    if (how === "pick") announce(`${s.name}: ${positionText(at)}`);
    setSelectedId(id);
  };

  const removeStakeholder = (s: Stakeholder) => {
    removeWithUndo<Stakeholder>({
      label: `Removed ${s.name}`,
      update: write,
      match: (x) => x.id === s.id,
    });
    if (selectedId === s.id) setSelectedId(null);
    record(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_REMOVED, { stakeholderId: s.id, name: s.name });
    announce(`Removed ${s.name}`);
  };

  const loadExample = () => {
    setExample(buildExample(today));
    setSelectedId(null);
    announce("Loaded an example");
  };
  const clearExample = () => {
    setExample(null);
    setSelectedId(null);
  };

  const resetSnapshot = useRef<unknown>(null);
  const reset = () => {
    resetSnapshot.current = stored;
    setStored([]);
    setSelectedId(null);
    log(STAKEHOLDER_MAP_ACTIONS.STAKEHOLDER_RESET, { stakeholders: stakeholders.length });
  };
  const undoReset = () => setStored(resetSnapshot.current ?? []);

  /* ── Numbers ──────────────────────────────────────────────────────── */

  const quadrants = useMemo(() => {
    const out: Record<Quadrant, Stakeholder[]> = {
      manageClosely: [],
      keepSatisfied: [],
      keepInformed: [],
      monitor: [],
    };
    for (const s of stakeholders) {
      const q = quadrantOf(s);
      if (q) out[q].push(s);
    }
    return out;
  }, [stakeholders]);
  const unplaced = stakeholders.filter((s) => !isPlaced(s)).length;
  const blockers = stakeholders.filter((s) => s.currentSentiment === "blocker").length;
  const champions = stakeholders.filter((s) => s.currentSentiment === "champion").length;
  const overdueTouches = stakeholders.filter((s) => touchStatus(s, today) === "overdue").length;
  const verdict = stakeholderVerdict(stakeholders, today);
  const markdown = stakeholdersToMarkdown(stakeholders, today);

  // Touches due, soonest first; editing a date marks the order stale
  // instead of moving the row under the cursor.
  const withTouch = stakeholders.filter((s) => s.nextTouchAt);
  const {
    ordered: touches,
    isStale,
    resort,
  } = useStableOrder(
    withTouch,
    (s) => s.id,
    (a, b) => (a.nextTouchAt as string).localeCompare(b.nextTouchAt as string)
  );

  const columns: DataTableColumn<Stakeholder>[] = [
    { key: "name", header: "Name", primary: true, cell: (s) => s.name, sortValue: (s) => s.name },
    {
      key: "quadrant",
      header: "Quadrant",
      cell: (s) => {
        const q = quadrantOf(s);
        return q ? QUADRANT_LABEL[q] : "Not placed";
      },
      sortValue: (s) => {
        const q = quadrantOf(s);
        return q ? QUADRANT_LABEL[q] : null;
      },
    },
    {
      key: "interest",
      header: "Interest",
      align: "right",
      cell: (s) => s.interest ?? "—",
      sortValue: (s) => s.interest,
    },
    {
      key: "authority",
      header: "Authority",
      align: "right",
      cell: (s) => s.authority ?? "—",
      sortValue: (s) => s.authority,
    },
    { key: "sentiment", header: "Now → needed", cell: (s) => sentimentText(s) },
    {
      key: "last",
      header: "Last contact",
      cell: (s) => s.lastContactAt ?? "—",
      sortValue: (s) => s.lastContactAt,
    },
    {
      key: "next",
      header: "Next touch",
      cell: (s) => s.nextTouchAt ?? "—",
      sortValue: (s) => s.nextTouchAt,
    },
  ];

  // Every stakeholder, placed or not: the prompt counts them as the cards do.
  const promptConfig = useMemo(
    () => ({
      toolName: "Stakeholder Map",
      prompts: generateStakeholderMapPrompts({ stakeholders, today }, workspace),
    }),
    [stakeholders, today, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="stakeholder-map"
      title="Stakeholder Map"
      description="Map stakeholders by Interest × Authority, compare how they feel with how you need them to, and keep up the contact."
      category="Outcomes & Pulse"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="stakeholder-map"
          markdown={markdown}
          csvData={{
            headers: [
              "Name",
              "Role",
              "Interest",
              "Authority",
              "Quadrant",
              "Current sentiment",
              "Desired sentiment",
              "Last contact",
              "Next touch",
              "Strategy",
              "Description",
            ],
            rows: stakeholders.map((s) => {
              const q = quadrantOf(s);
              return [
                s.name,
                s.role ?? "",
                s.interest ?? "",
                s.authority ?? "",
                q ? QUADRANT_LABEL[q] : "Not placed",
                s.currentSentiment ?? "",
                s.desiredSentiment ?? "",
                s.lastContactAt ?? "",
                s.nextTouchAt ?? "",
                s.strategy ?? "",
                s.description ?? "",
              ];
            }),
          }}
          jsonData={stakeholders}
        />
        <ResetButton
          label="Clear all"
          title="Remove every stakeholder?"
          description={`${stakeholders.length === 1 ? "1 stakeholder" : `${stakeholders.length} stakeholders`}, with their places, sentiment, contacts and strategies.`}
          confirmLabel="Remove all"
          doneLabel="Removed every stakeholder"
          onReset={reset}
          onUndo={undoReset}
          disabled={preview || stakeholders.length === 0}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: seven stakeholders around a checkout redesign. Nothing in it is saved, and your
            own map stays as it is.
          </p>
        </div>
      )}

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Users}
          label="Total"
          value={stakeholders.length}
          hint={unplaced > 0 ? `${unplaced} not placed yet` : undefined}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={PieChart}
          label="Manage Closely"
          value={quadrants.manageClosely.length}
        />
        <StatCard
          variant="compact"
          icon={AlertOctagon}
          label="Blockers"
          value={blockers}
          hint={champions > 0 ? `${champions} champion${champions === 1 ? "" : "s"}` : undefined}
          tone={blockers > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={CalendarClock}
          label="Touches overdue"
          value={overdueTouches}
          tone={overdueTouches > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      <SectionCard title="Add a stakeholder" icon={Plus} className="mb-4">
        <StakeholderForm onAdd={addStakeholder} />
      </SectionCard>

      {stakeholders.length === 0 ? (
        <EmptyState icon={PieChart} action={<LoadExampleButton onLoad={loadExample} />}>
          No stakeholders mapped yet. Add your first one above to see the matrix fill in.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm font-medium text-text">{verdict}</p>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 mb-6">
            <Card className="bg-surface border-border">
              <CardContent className="p-4">
                <div className="text-sm font-semibold text-text mb-3">Interest × Authority</div>
                <StakeholderMap
                  stakeholders={stakeholders}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onPlace={place}
                />
              </CardContent>
            </Card>

            <div className="space-y-2">
              <StakeholderDetail
                stakeholder={selected}
                lastContactText={selected ? lastContactText(selected, today) : ""}
                nextTouchText={selected ? nextTouchText(selected, today) : ""}
              />
              {QUADRANTS.map((q) => (
                <Card key={q} className="bg-surface border-border">
                  <CardContent className="p-3">
                    <div className="text-xs uppercase tracking-wider text-sub">
                      {QUADRANT_LABEL[q]}
                    </div>
                    <div className="text-sm font-data text-text mt-0.5">
                      {quadrants[q].length} stakeholder
                      {quadrants[q].length === 1 ? "" : "s"}
                    </div>
                    <div className="text-xs text-sub mt-1">{QUADRANT_DESCRIPTION[q]}</div>
                    {quadrants[q].length > 0 && (
                      <div className="text-xs text-text mt-2 break-words">
                        {quadrants[q].map((s) => s.name).join(", ")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {touches.length > 0 && (
            <SectionCard title="Touches due" icon={CalendarClock} className="mb-4">
              <ResortChip isStale={isStale} onResort={resort} what="Dates" />
              <ul className="divide-y divide-border rounded-lg border border-border">
                {touches.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 break-words text-text">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-sub"> · {s.nextTouchAt}</span>
                    </span>
                    <span
                      className={
                        touchStatus(s, today) === "overdue"
                          ? "text-xs text-danger"
                          : "text-xs text-sub"
                      }
                    >
                      {nextTouchText(s, today)}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SectionCard title="All stakeholders" icon={Table2} className="mb-4">
            <DataTable
              columns={columns}
              rows={stakeholders}
              rowKey={(s) => s.id}
              onRowClick={(s) => setSelectedId(s.id)}
            />
          </SectionCard>

          <div className="space-y-2">
            {stakeholders.map((s) => (
              <StakeholderRow
                key={s.id}
                stakeholder={s}
                today={today}
                onPatch={(patch) => updateStakeholder(s.id, patch)}
                onPlace={(at) => place(s.id, at, "pick")}
                onRemove={() => removeStakeholder(s)}
              />
            ))}
          </div>
        </>
      )}
    </ToolPageWrapper>
  );
}
