"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import {
  CalendarDays,
  CheckCircle2,
  GitBranch,
  ListChecks,
  OctagonAlert,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateScrumOfScrumsPrompts } from "@/lib/ai-prompts/scrum-of-scrums";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, SosEntry, Workspace } from "@/lib/stores/workspace-types";
import { edgeStatus, isOverdue } from "@/lib/dependencies/edges";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SCRUM_OF_SCRUMS_ACTIONS } from "@/lib/history/event-actions";
import { cn } from "@/lib/utils";
import { SelectField, uniqueTeams } from "../dependency-map/fields";
import { dayLabel, parseDay } from "../dependency-map/format";
import {
  currentDependencyMap,
  linkDependency,
  releaseEdges,
  restoreReleased,
  setEdgeStatus,
  unlink,
  updateDependencyMap,
  useDependencyMap,
  type EdgeHeir,
  type LinkResult,
  type ReleasedEdges,
} from "../dependency-map/link";
import { DependencyStatusChip } from "../dependency-map/status-chip";
import { useReturnFocus, type RefFor } from "../dependency-map/use-return-focus";
import { itemRef } from "../pi-planning/dependency-link";
import { piTeamNames, usePiState } from "../pi-planning/store";
import {
  KIND_LABEL,
  ageDays,
  carriedForward,
  entriesOn,
  isTracked,
  meetingDates,
  meetingDay,
  staleBlockers,
  statusOf,
  type EntryKind,
  type TrackedStatus,
} from "./agenda";
import { EntryAddForm, EntryEditor, type EntryValues } from "./entry-form";
import { buildExample, withoutExampleEdges } from "./example";
import {
  edgeForEntry,
  entryRef,
  impedimentLinks,
  ownEdgeIds,
  scopeOf,
  syncEntryEdge,
} from "./links";
import { toMinutes } from "./markdown";
import { meetingVerdict } from "./verdict";

/** Theme tokens per kind (text and the card's left edge). */
const KIND_TONE: Record<EntryKind, { text: string; border: string }> = {
  blocker: { text: "text-danger", border: "border-l-danger" },
  dependency: { text: "text-warning", border: "border-l-warning" },
  decision: { text: "text-accent-magenta", border: "border-l-accent-magenta" },
  update: { text: "text-accent", border: "border-l-accent" },
};

const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function ScrumOfScrumsClient() {
  const entries = useWorkspaceStore(useShallow((s) => s.sosEntries ?? []));
  const impediments = useWorkspaceStore((s) => s.impediments);
  const upsertSosEntry = useWorkspaceStore((s) => s.upsertSosEntry);
  const removeSosEntry = useWorkspaceStore((s) => s.removeSosEntry);
  const map = useDependencyMap();
  const [pi] = usePiState();
  const piTeams = useMemo(() => piTeamNames(pi), [pi]);
  const today = todayLocalISO();
  const { log } = useHistoryLogger("scrum-of-scrums");
  const exportRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [started, setStarted] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [editing, setEditing] = useState<string | null>(null);
  const { refFor, returnTo } = useReturnFocus();

  /** Close the editor and put focus back on the entry's Edit button. */
  const closeEditor = (id: string) => {
    setEditing(null);
    returnTo(`edit:${id}`);
  };

  const edgeOf = useMemo(
    () => new Map(entries.map((e) => [e.id, edgeForEntry(map, e)] as const)),
    [entries, map]
  );
  const status = useCallback(
    (e: SosEntry): TrackedStatus | null => statusOf(e, edgeOf.get(e.id)),
    [edgeOf]
  );

  const meetings = meetingDates(entries, started);
  // The latest meeting until the user picks or starts another.
  const selected = picked ?? meetings[0] ?? today;
  const carried = carriedForward(entries, selected, status);
  const groups = entriesOn(entries, selected);
  const stale = staleBlockers(entries, today, status);
  const openBlockers = entries.filter((e) => e.kind === "blocker" && status(e) === "open");
  const openDeps = entries.filter((e) => e.kind === "dependency" && status(e) === "open");
  const teams = uniqueTeams([...entries.flatMap((e) => [e.team, e.blockedBy]), ...piTeams]);

  /**
   * Who still shows an edge once entry `leavingId` lets go of it: a PI
   * item linked to it, else another entry showing it for the same wait.
   * That one inherits the edge, so it doesn't drop off the map under it.
   */
  const heirFor =
    (leavingId: string): EdgeHeir =>
    (edge) => {
      const item = pi.items.find((i) => i.kind === "dependency" && i.edgeId === edge.id);
      if (item) return itemRef(item);
      const graph = currentDependencyMap() ?? map;
      const other = (useWorkspaceStore.getState().sosEntries ?? []).find(
        (e) => e.id !== leavingId && edgeForEntry(graph, e)?.id === edge.id
      );
      return other ? entryRef(other) : undefined;
    };

  /* ── Entries ── */

  const add = (v: EntryValues) => {
    const entry: SosEntry = {
      id: nanoid(),
      ...v,
      status: "open",
      loggedAt: new Date().toISOString(),
    };
    upsertSosEntry(entry);
    if (entry.kind === "blocker") {
      log(SCRUM_OF_SCRUMS_ACTIONS.IMPEDIMENT_RAISED, { team: entry.team, text: entry.text });
    } else {
      log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_ADDED, { team: entry.team, kind: entry.kind });
    }
    // A backdated entry belongs to that meeting: show it there.
    if (entry.meetingDate !== selected) setPicked(entry.meetingDate);
  };

  const save = (entry: SosEntry, v: EntryValues) => {
    closeEditor(entry.id);
    const next: SosEntry = {
      ...entry,
      meetingDate: v.meetingDate,
      team: v.team,
      kind: v.kind,
      text: v.text,
    };
    if (v.blockedBy) next.blockedBy = v.blockedBy;
    else delete next.blockedBy;
    syncEntryEdge(entry, next, heirFor(entry.id));
    upsertSosEntry(next);
  };

  /**
   * Delete with Undo; a dependency this entry drew on the map goes with it,
   * and comes back, unless a PI item or another entry still shows it: then
   * it stays on the map with that one.
   */
  const remove = (entry: SosEntry) => {
    let released: ReleasedEdges = { taken: [], handed: [] };
    undoable({
      label: `Deleted ${KIND_LABEL[entry.kind].one.toLowerCase()} “${short(entry.text)}”`,
      apply: () => {
        released = releaseEdges(
          ownEdgeIds(currentDependencyMap() ?? map, entry),
          heirFor(entry.id)
        );
        removeSosEntry(entry.id);
        log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_REMOVED, { team: entry.team, kind: entry.kind });
      },
      revert: () => {
        upsertSosEntry(entry);
        restoreReleased(released);
      },
    });
  };

  /**
   * Resolve or reopen a blocker or dependency; a dependency on the map
   * changes there too. Reopening also reopens the edge the entry will show
   * once open, so it doesn't read as resolved straight away.
   */
  const setResolved = (entry: SosEntry, resolved: boolean) => {
    const next: SosEntry = { ...entry, status: resolved ? "resolved" : "open" };
    if (resolved) next.resolvedAt = todayLocalISO();
    else delete next.resolvedAt;
    upsertSosEntry(next);
    const edge = edgeForEntry(currentDependencyMap() ?? map, entry, { asOpen: true });
    if (edge) setEdgeStatus(edge.id, resolved ? "resolved" : "open");
    log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_ADDED, {
      team: entry.team,
      kind: entry.kind,
      statusChange: { from: entry.status, to: next.status },
    });
  };

  const raiseImpediment = (entry: SosEntry) => {
    const waits = entry.blockedBy ? `; blocked by ${entry.blockedBy}` : "";
    sendHandoff(
      "impediment",
      {
        title: entry.text,
        description: `Raised at the Scrum of Scrums on ${dayLabel(meetingDay(entry) || entry.meetingDate, true)} by ${entry.team}${waits}.`,
        raisedBy: entry.team,
        sourceRef: entryRef(entry),
      },
      {
        // The impediment records where it came from; the entry has no
        // sentTo of its own, so its links are read from that side.
        getLinks: () => impedimentLinks(useWorkspaceStore.getState().impediments, entry),
        setLinks: () => {},
      }
    );
  };

  const addToMap = (entry: SosEntry) => {
    if (!entry.blockedBy?.trim()) return;
    let result: LinkResult | null = null;
    undoable({
      label: "Added to the Dependency Map",
      description: `“${entry.team} needs ${entry.blockedBy}”`,
      apply: () => {
        result = linkDependency(
          {
            from: entry.team,
            to: entry.blockedBy as string,
            kind: "needs",
            note: entry.text,
            sourceRef: entryRef(entry),
          },
          undefined,
          scopeOf(entry)
        );
      },
      revert: () => {
        if (result) unlink(result);
      },
    });
  };

  /* ── Meetings ── */

  const startMeeting = () => {
    if (!parseDay(startDate)) return;
    setStarted((s) => (s.includes(startDate) ? s : [...s, startDate]));
    setPicked(startDate);
  };

  /* ── Example ── */

  const loadExample = () => {
    buildExample().forEach(upsertSosEntry);
    setPicked(null);
  };
  const clearExample = () => {
    entries.filter((e) => isExampleId(e.id)).forEach((e) => removeSosEntry(e.id));
    updateDependencyMap(withoutExampleEdges);
    setPicked(null);
  };

  /* ── AI prompts and export ── */

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
  const newestFirst = useMemo(
    () => [...entries].sort((a, b) => (b.loggedAt ?? "").localeCompare(a.loggedAt ?? "")),
    [entries]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Scrum of Scrums Tracker",
      prompts: generateScrumOfScrumsPrompts(
        {
          // The prompt reads `status`; give it the status that counts.
          entries: newestFirst.map((e) => ({ ...e, status: status(e) ?? e.status })),
          staleBlockers: stale,
        },
        workspace
      ),
    }),
    [newestFirst, stale, status, workspace]
  );

  const csvData = {
    headers: ["Date", "Team", "Kind", "Text", "Blocked By", "Status", "Resolved"],
    rows: newestFirst.map((e) => [
      e.meetingDate,
      e.team,
      e.kind,
      e.text,
      e.blockedBy ?? "",
      status(e) ?? "",
      e.resolvedAt ?? "",
    ]),
  };

  const rowProps = {
    today,
    teams,
    impediments,
    status,
    edgeOf,
    editing,
    setEditing,
    refFor,
    closeEditor,
    onSave: save,
    onRemove: remove,
    onResolved: setResolved,
    onRaise: raiseImpediment,
    onAddToMap: addToMap,
  };

  return (
    <ToolPageWrapper
      toolId="scrum-of-scrums"
      title="Scrum of Scrums Tracker"
      description="Cross-team coordination log with blockers, dependencies, and decisions per meeting."
      category="Portfolio & Scaling"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(entries) && <ExampleNotice onClear={clearExample} />}

        <ActionRow>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename={`scrum-of-scrums-${selected}`}
            csvData={csvData}
            jsonData={entries}
            markdown={toMinutes(entries, selected, today, status)}
            targetRef={exportRef}
          />
        </ActionRow>

        <KpiGrid cols={4} marginBottom="none">
          <StatCard
            variant="compact"
            label="Open blockers"
            value={openBlockers.length}
            tone={openBlockers.length > 0 ? "danger" : "default"}
          />
          <StatCard
            variant="compact"
            label="Open dependencies"
            value={openDeps.length}
            tone={openDeps.length > 0 ? "warning" : "default"}
          />
          <StatCard
            variant="compact"
            label="Stale blockers"
            value={stale.length}
            hint="open 3+ days"
            tone={stale.length > 0 ? "danger" : "default"}
          />
          <StatCard variant="compact" label="Meetings" value={meetingDates(entries).length} />
        </KpiGrid>

        {stale.length > 0 && (
          <CalloutAlert tone="danger">
            <strong>
              {stale.length} {stale.length === 1 ? "blocker has" : "blockers have"} been open 3 days
              or more:
            </strong>{" "}
            {stale
              .slice(0, 3)
              .map((e) => `${e.team}: ${short(e.text)}`)
              .join(" · ")}
          </CalloutAlert>
        )}

        <SectionCard title="Meeting" icon={CalendarDays}>
          <div className="flex flex-wrap items-end gap-3">
            {meetings.length > 0 && (
              <SelectField
                label="Show meeting"
                className="w-full sm:w-64"
                options={meetings.map((d) => {
                  const n = entries.filter((e) => meetingDay(e) === d).length;
                  return {
                    value: d,
                    label: `${dayLabel(d, true)} (${n} ${n === 1 ? "entry" : "entries"})`,
                  };
                })}
                value={selected}
                onChange={setPicked}
              />
            )}
            <Field label="New meeting on" hint="Open items carry forward to it.">
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  className="w-full sm:w-44"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="outline"
              className="gap-1"
              disabled={!parseDay(startDate)}
              onClick={startMeeting}
            >
              <Plus aria-hidden="true" />
              Start a meeting
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Log an entry" icon={GitBranch}>
          <EntryAddForm meetingDate={selected} teams={teams} onAdd={add} />
        </SectionCard>

        {entries.length === 0 ? (
          <EmptyState icon={ListChecks} action={<LoadExampleButton onLoad={loadExample} />}>
            No meetings logged yet. Log what each team brings above, or load an example to see an
            agenda with open items carried forward.
          </EmptyState>
        ) : (
          <SectionCard title={`Agenda — ${dayLabel(selected, true)}`} icon={ListChecks}>
            <div className="space-y-5">
              <p className="text-sm font-medium text-text">
                {meetingVerdict(entries, selected, today, status)}
              </p>
              {carried.length > 0 && (
                <EntryGroup
                  title={`Carried forward (${carried.length})`}
                  hint="Open blockers and dependencies from earlier meetings. Resolving one here resolves it everywhere."
                  entries={carried}
                  carried
                  {...rowProps}
                />
              )}
              {groups.map((g) => (
                <EntryGroup
                  key={g.kind}
                  title={`${KIND_LABEL[g.kind].many} (${g.entries.length})`}
                  entries={g.entries}
                  {...rowProps}
                />
              ))}
              {groups.length === 0 && (
                <p className="text-sm text-sub">
                  Nothing logged for this meeting yet. Log each team&rsquo;s blockers, dependencies,
                  decisions and updates above.
                </p>
              )}
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

interface RowProps {
  today: string;
  teams: readonly string[];
  impediments: Workspace["impediments"];
  status: (e: SosEntry) => TrackedStatus | null;
  edgeOf: ReadonlyMap<string, DependencyEdge | undefined>;
  editing: string | null;
  setEditing: (id: string | null) => void;
  refFor: RefFor;
  closeEditor: (id: string) => void;
  onSave: (entry: SosEntry, v: EntryValues) => void;
  onRemove: (entry: SosEntry) => void;
  onResolved: (entry: SosEntry, resolved: boolean) => void;
  onRaise: (entry: SosEntry) => void;
  onAddToMap: (entry: SosEntry) => void;
}

function EntryGroup({
  title,
  hint,
  entries,
  carried = false,
  ...row
}: RowProps & {
  title: string;
  hint?: string;
  entries: readonly SosEntry[];
  carried?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {hint && <p className="text-xs text-sub">{hint}</p>}
      <ul className="space-y-2" aria-label={title.replace(/ \(\d+\)$/, "")}>
        {entries.map((e) => (
          <li key={e.id}>
            {row.editing === e.id ? (
              <div className="rounded-lg border border-border bg-card p-3">
                <EntryEditor
                  entry={e}
                  teams={row.teams}
                  onSave={(v) => row.onSave(e, v)}
                  onCancel={() => row.closeEditor(e.id)}
                />
              </div>
            ) : (
              <EntryRow entry={e} carried={carried} {...row} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryRow({
  entry,
  carried,
  today,
  impediments,
  status,
  edgeOf,
  setEditing,
  refFor,
  onRemove,
  onResolved,
  onRaise,
  onAddToMap,
}: RowProps & { entry: SosEntry; carried: boolean }) {
  const tone = KIND_TONE[entry.kind];
  const s = status(entry);
  const resolved = s === "resolved";
  const edge = edgeOf.get(entry.id);
  const age = ageDays(entry, today);
  const name = `${KIND_LABEL[entry.kind].one.toLowerCase()} “${short(entry.text)}”`;
  const impediment =
    entry.kind === "blocker"
      ? liveLink(impedimentLinks(impediments, entry), "impediment")
      : undefined;
  const impedimentDone = impediment
    ? getHandoffRoute("impediment").isDone?.(impediment.targetId)
    : false;

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border border-l-4 border-border bg-surface p-3",
        tone.border,
        resolved && "opacity-70"
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <p className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className={cn("font-medium uppercase", tone.text)}>
              {KIND_LABEL[entry.kind].one}
            </span>
            <span className="font-semibold text-text">{entry.team}</span>
            {s && (
              <span className={resolved ? "text-success" : "text-sub"}>
                {resolved ? "Resolved" : "Open"}
              </span>
            )}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-text">{entry.text}</p>
          {entry.blockedBy && isTracked(entry.kind) && (
            <p className="text-xs text-warning">
              {entry.kind === "dependency" ? "Waits on" : "Blocked by"} {entry.blockedBy}
            </p>
          )}
          {isTracked(entry.kind) && (
            <p className="text-xs text-sub">
              {carried ? "Raised" : "Logged"}{" "}
              {dayLabel(meetingDay(entry) || entry.meetingDate, true)}
              {!resolved &&
                age !== null &&
                age > 0 &&
                ` · open ${age} ${age === 1 ? "day" : "days"}`}
            </p>
          )}
        </div>
        <span className="ml-auto flex shrink-0 items-center">
          {s && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("min-touch-coarse gap-1", resolved ? "text-sub" : "text-success")}
              aria-label={`${resolved ? "Reopen" : "Resolve"} ${name}`}
              onClick={() => onResolved(entry, !resolved)}
            >
              {resolved ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              {resolved ? "Reopen" : "Resolve"}
            </Button>
          )}
          <IconButton
            ref={refFor(`edit:${entry.id}`)}
            label={`Edit ${name}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => setEditing(entry.id)}
          />
          <IconButton
            label={`Delete ${name}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(entry)}
          />
        </span>
      </div>

      {entry.kind === "blocker" && (impediment || !resolved) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {impediment ? (
            <Link
              href={getHandoffRoute("impediment").targetHref(impediment.targetId)}
              className="text-sub underline-offset-2 hover:text-accent hover:underline"
            >
              Raised as an impediment{impedimentDone ? " · resolved" : " · open"}
            </Link>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-touch-coarse h-7 gap-1 px-2 text-xs"
              aria-label={`Raise impediment: ${short(entry.text)}`}
              onClick={() => onRaise(entry)}
            >
              <OctagonAlert aria-hidden="true" />
              Raise impediment
            </Button>
          )}
        </div>
      )}

      {entry.kind === "dependency" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {edge ? (
            <>
              <DependencyStatusChip status={edgeStatus(edge)} overdue={isOverdue(edge, today)} />
              {edge.due && <span className="text-sub">due {dayLabel(edge.due)}</span>}
              <Link
                href="/dependency-map"
                className="text-sub underline-offset-2 hover:text-accent hover:underline"
              >
                On the Dependency Map
              </Link>
            </>
          ) : entry.blockedBy?.trim() ? (
            !resolved && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-touch-coarse h-7 gap-1 px-2 text-xs"
                aria-label={`Add dependency to the map: ${entry.team} needs ${entry.blockedBy}`}
                onClick={() => onAddToMap(entry)}
              >
                <GitBranch aria-hidden="true" />
                Add dependency
              </Button>
            )
          ) : (
            <span className="text-sub">
              Edit it to name the team it waits on, then add it to the Dependency Map.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
