"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Coffee,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { usePersisted } from "@/lib/utils/use-persisted";
import { removeWithUndo } from "@/lib/utils/undoable";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONE_ON_ONE_ACTIONS } from "@/lib/history/event-actions";
import { generateOneOnOnePrompts } from "@/lib/ai-prompts/one-on-one";
import { todayIso } from "@/lib/sprints/series";
import { findRosterMember, useTeamRoster } from "@/lib/team/use-team-roster";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { AGENDA_MAX, AgendaItemRow, STATUS_TONE } from "./agenda-item";
import { CadenceSection } from "./cadence-section";
import { DetailsForm } from "./details-form";
import { buildExample, type OneOnOneExample } from "./example";
import { oneOnOnesToMarkdown } from "./markdown";
import {
  CADENCE_KEY,
  STATUS_LABELS,
  STORAGE_KEY,
  addressedShare,
  cadenceByReport,
  cadenceVerdict,
  carriedAgenda,
  meetingsThisMonth,
  normalizeCadence,
  normalizeMeetings,
  overdueActions,
  priorMeeting,
  type AgendaItem,
  type AgendaStatus,
  type CadenceDays,
  type Meeting,
  type OneOnOneCadence,
} from "./model";
import { StartForm, type StartValues } from "./start-form";

type ListUpdate<T> = (list: readonly T[]) => T[];

const noLog = () => undefined;

/** The add-an-item form under the open 1:1's agenda: a topic is required. */
function AgendaAddForm({ onAdd }: { onAdd: (text: string) => void }) {
  const form = useItemForm<{ text: string }, string, "text">({
    initial: { text: "" },
    validate: (d): Validation<string, "text"> => {
      const text = d.text.replace(/\s+/g, " ").trim();
      if (!text) return { ok: false, errors: { text: "Write the topic." } };
      if (text.length > AGENDA_MAX)
        return { ok: false, errors: { text: `Keep it to ${AGENDA_MAX} characters.` } };
      return { ok: true, values: text };
    },
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add"
      submitIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
      className="space-y-2"
    >
      <Field label="New agenda item" hideLabel error={form.errors.text}>
        {(props) => (
          <Input
            {...props}
            value={form.draft.text}
            maxLength={AGENDA_MAX}
            onChange={(e) => form.update({ text: e.target.value })}
            placeholder="New agenda item..."
            className="bg-bg border-border text-sm"
          />
        )}
      </Field>
    </ItemForm>
  );
}

/**
 * The 1:1 tracker: a rolling agenda per manager–report pair (Open items and
 * unfinished Actions carry into the next 1:1), Done with the day it was
 * done, a cadence per report with an alert when a 1:1 is late, and a
 * timeline. The notes are private: they're in this browser (and the
 * owner's cloud copy), no agent reads them, and they leave the page only
 * through Export.
 */
export function OneOnOneClient() {
  const [stored, setStored] = usePersisted<unknown>(STORAGE_KEY, []);
  const [storedCadence, setStoredCadence] = usePersisted<unknown>(CADENCE_KEY, {});
  const { log } = useHistoryLogger("one-on-one");
  const roster = useTeamRoster();
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());

  // The example lives here only: nothing in it reaches the saved 1:1s.
  const [example, setExample] = useState<OneOnOneExample | null>(null);
  const preview = example !== null;
  const meetings = useMemo(() => example?.meetings ?? normalizeMeetings(stored), [example, stored]);
  const cadence = useMemo(
    () => example?.cadence ?? normalizeCadence(storedCadence),
    [example, storedCadence]
  );
  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place. The example's edits aren't the team's history.
  const writeMeetings = preview
    ? (fn: ListUpdate<Meeting>) => setExample((ex) => ex && { ...ex, meetings: fn(ex.meetings) })
    : (fn: ListUpdate<Meeting>) => setStored((prev: unknown) => fn(normalizeMeetings(prev)));
  const writeCadence = preview
    ? (fn: (c: OneOnOneCadence) => OneOnOneCadence) =>
        setExample((ex) => ex && { ...ex, cadence: fn(ex.cadence) })
    : (fn: (c: OneOnOneCadence) => OneOnOneCadence) =>
        setStoredCadence((prev: unknown) => fn(normalizeCadence(prev)));
  const record: typeof log = preview ? noLog : log;

  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  // The details form replaces "Edit details"; Save and Cancel give focus back.
  const details = useInlineEdit();
  const setEditingDetails = (on: boolean) => (on ? details.start() : details.stop());
  const editingDetails = details.editing;
  const [expandedPast, setExpandedPast] = useState<Set<string>>(new Set());
  // Opening a past 1:1 moves focus to it; closing it returns to its row.
  const { refFor, returnTo } = useReturnFocus();

  const activeMeeting = meetings.find((m) => m.id === activeMeetingId) ?? null;

  /* ── Changes ──────────────────────────────────────────────────────── */

  const startMeeting = (values: StartValues) => {
    const managerMember = findRosterMember(roster, values.manager);
    const reportMember = findRosterMember(roster, values.report);
    const id = crypto.randomUUID();
    const meeting: Meeting = {
      id,
      manager: managerMember?.name ?? values.manager,
      report: reportMember?.name ?? values.report,
      ...(managerMember ? { managerMemberId: managerMember.id } : {}),
      ...(reportMember ? { reportMemberId: reportMember.id } : {}),
      date: values.date,
      agenda: [],
      ...(values.description ? { description: values.description } : {}),
    };
    // Open topics and unfinished Actions carry over from the prior 1:1.
    const prior = priorMeeting(meetings, meeting);
    if (prior) meeting.agenda = carriedAgenda(prior, () => crypto.randomUUID());
    writeMeetings((list) => [...list, meeting]);
    record(ONE_ON_ONE_ACTIONS.MEETING_LOGGED, {
      meetingId: id,
      manager: meeting.manager,
      report: meeting.report,
      date: meeting.date,
      carriedItems: meeting.agenda.length,
    });
    setActiveMeetingId(id);
    setEditingDetails(false);
    announce(
      meeting.agenda.length > 0
        ? `Started the 1:1 with ${meeting.report}; ${meeting.agenda.length} carried over`
        : `Started the 1:1 with ${meeting.report}`
    );
  };

  const removeMeeting = (m: Meeting) => {
    removeWithUndo<Meeting>({
      label: `Deleted the 1:1 with ${m.report}${m.date ? ` on ${m.date}` : ""}`,
      update: writeMeetings,
      match: (x) => x.id === m.id,
    });
    if (activeMeetingId === m.id) setActiveMeetingId(null);
    record(ONE_ON_ONE_ACTIONS.MEETING_REMOVED, { meetingId: m.id });
    announce(`Deleted the 1:1 with ${m.report}`);
  };

  const patchMeeting = (meetingId: string, patch: Partial<Meeting>) =>
    writeMeetings((list) => list.map((m) => (m.id === meetingId ? { ...m, ...patch } : m)));

  const saveDetails = (m: Meeting, values: StartValues) => {
    const managerMember = findRosterMember(roster, values.manager);
    const reportMember = findRosterMember(roster, values.report);
    writeMeetings((list) =>
      list.map((x) => {
        if (x.id !== m.id) return x;
        const next: Meeting = {
          ...x,
          manager: managerMember?.name ?? values.manager,
          report: reportMember?.name ?? values.report,
          date: values.date,
          description: values.description,
          managerMemberId: managerMember?.id,
          reportMemberId: reportMember?.id,
        };
        return next;
      })
    );
    details.stop({ refocus: true });
    announce("Saved the 1:1's details");
  };

  const updateAgenda = (meetingId: string, fn: ListUpdate<AgendaItem>) =>
    writeMeetings((list) =>
      list.map((m) => (m.id === meetingId ? { ...m, agenda: fn(m.agenda) } : m))
    );

  const addAgendaItem = (meeting: Meeting, text: string) => {
    const item: AgendaItem = { id: crypto.randomUUID(), text, status: "open" };
    updateAgenda(meeting.id, (agenda) => [...agenda, item]);
    // The topic stays in the 1:1: the history log keeps only that one was added.
    record(ONE_ON_ONE_ACTIONS.AGENDA_ITEM_ADDED, { meetingId: meeting.id, itemId: item.id });
  };

  const patchItem = (meetingId: string, itemId: string, patch: Partial<AgendaItem>) =>
    updateAgenda(meetingId, (agenda) =>
      agenda.map((a) => (a.id === itemId ? { ...a, ...patch } : a))
    );

  // The done day an item had when it left Done on this page, so arrowing
  // through the status options (selection follows focus) and back to Done
  // keeps a backdated day instead of stamping today.
  const leftDone = useRef(new Map<string, string>());
  const setStatus = (meeting: Meeting, item: AgendaItem, status: AgendaStatus) => {
    if (item.status === status) return;
    // Done keeps the day it was done (today unless picked); leaving Done
    // drops it from the item.
    if (item.status === "done" && item.doneAt) leftDone.current.set(item.id, item.doneAt);
    const doneAt =
      status === "done" ? (item.doneAt ?? leftDone.current.get(item.id) ?? today) : undefined;
    patchItem(meeting.id, item.id, { status, doneAt });
    record(ONE_ON_ONE_ACTIONS.ACTION_TOGGLED, {
      meetingId: meeting.id,
      itemId: item.id,
      from: item.status,
      to: status,
    });
    announce(`${item.text}: ${STATUS_LABELS[status]}`);
  };

  const removeAgendaItem = (meeting: Meeting, item: AgendaItem) => {
    removeWithUndo<AgendaItem>({
      label: `Removed “${item.text}”`,
      update: (fn) => updateAgenda(meeting.id, fn),
      match: (a) => a.id === item.id,
    });
    announce(`Removed “${item.text}”`);
  };

  const setCadence = (key: string, days: CadenceDays | null) => {
    // A cadence saved under a name they had before a rename goes too, or
    // it would still count after this one is cleared.
    const aliases = reports.find((r) => r.key === key)?.aliases ?? [];
    writeCadence((c) => {
      const next = { ...c };
      for (const k of [key, ...aliases]) delete next[k];
      if (days !== null) next[key] = days;
      return next;
    });
  };

  // Notes: typing stays in the draft; the 1:1 is saved when focus leaves.
  const [notesDraft, setNotesDraft] = useState<string>("");
  const notesCommittedRef = useRef<string>("");
  useEffect(() => {
    // Only when a different 1:1 opens: re-syncing on every save would
    // overwrite what's being typed.
    const v = activeMeeting?.notes ?? "";
    setNotesDraft(v);
    notesCommittedRef.current = v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id]);

  const togglePastExpanded = (id: string) => {
    setExpandedPast((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadExample = () => {
    setExample(buildExample(today));
    setActiveMeetingId(null);
    setEditingDetails(false);
    announce("Loaded an example");
  };
  const clearExample = () => {
    setExample(null);
    setActiveMeetingId(null);
    setEditingDetails(false);
  };

  // A reset clears the 1:1s and the cadences; Undo puts both back.
  const resetSnapshot = useRef<{ meetings: unknown; cadence: unknown } | null>(null);
  const reset = () => {
    resetSnapshot.current = { meetings: stored, cadence: storedCadence };
    setStored([]);
    setStoredCadence({});
    setActiveMeetingId(null);
    log(ONE_ON_ONE_ACTIONS.ONE_ON_ONE_RESET, { meetings: meetings.length });
  };
  const undoReset = () => {
    const snap = resetSnapshot.current;
    if (!snap) return;
    setStored(snap.meetings);
    setStoredCadence(snap.cadence);
  };

  /* ── Numbers ──────────────────────────────────────────────────────── */

  const reports = useMemo(
    () => cadenceByReport(meetings, cadence, preview ? [] : roster, today),
    [meetings, cadence, preview, roster, today]
  );
  const verdict = cadenceVerdict(reports);
  const pastCadence = reports.filter((r) => r.overdueBy !== null).length;
  const addressed = addressedShare(meetings);
  const overdue = overdueActions(meetings, today);

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
      toolName: "1:1 Meeting Tracker",
      // The page's cadence rows and today, so the prompt states its numbers.
      prompts: generateOneOnOnePrompts({ meetings, reports, today }, workspace),
    }),
    [meetings, reports, today, workspace]
  );

  const csvData = useMemo(
    () => ({
      headers: [
        "Meeting Date",
        "Manager",
        "Report",
        "Agenda",
        "Status",
        "Action",
        "Owner",
        "Due",
        "Done on",
      ],
      rows: meetings.flatMap((m) =>
        m.agenda.length > 0
          ? m.agenda.map((a) => [
              m.date,
              m.manager,
              m.report,
              a.text,
              a.status,
              a.action ?? "",
              a.owner ?? "",
              a.dueDate ?? "",
              a.doneAt ?? "",
            ])
          : [[m.date, m.manager, m.report, "", "", "", "", "", ""]]
      ),
    }),
    [meetings]
  );
  const markdown = oneOnOnesToMarkdown(meetings, reports);

  // Past 1:1s, newest first; editing a date marks the order stale rather
  // than moving the row under the cursor.
  const past = meetings.filter((m) => m.id !== activeMeetingId);
  const {
    ordered: pastMeetings,
    isStale,
    resort,
  } = useStableOrder(
    past,
    (m) => m.id,
    (a, b) => b.date.localeCompare(a.date)
  );

  return (
    <ToolPageWrapper
      toolId="one-on-one"
      title="1:1 Meeting Tracker"
      description="Manager-IC 1:1 log with a rolling agenda, action items through to done, and a cadence alert per report."
      category="Ceremonies"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="one-on-one"
          markdown={markdown}
          csvData={csvData}
          jsonData={meetings}
        />
        <ResetButton
          label="Clear all"
          title="Clear every 1:1?"
          description={`${meetings.length === 1 ? "1 meeting" : `${meetings.length} meetings`}, their agendas and notes, and every report's cadence.`}
          confirmLabel="Clear 1:1s"
          doneLabel="Cleared every 1:1"
          onReset={reset}
          onUndo={undoReset}
          disabled={preview || meetings.length === 0}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: Mia&apos;s 1:1s with Raj and Lee over seven weeks. Nothing in it is saved, and
            your own 1:1s stay as they are.
          </p>
        </div>
      )}

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={CalendarRange}
          label="Meetings this month"
          value={meetingsThisMonth(meetings, today)}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={AlertCircle}
          label="Action items overdue"
          value={overdue}
          tone={overdue > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={CheckSquare}
          // "Addressed" covers every path off Open: discussed, given an
          // action, or done. A carried-over item counts once, in its copy.
          label="Addressed"
          value={addressed === null ? "—" : `${Math.round(addressed * 100)}%`}
          hint="discussed, actioned or done"
        />
        <StatCard
          variant="compact"
          icon={CalendarClock}
          label="Past their cadence"
          value={reports.some((r) => r.targetDays !== null) ? pastCadence : "—"}
          hint={`of ${reports.length === 1 ? "1 report" : `${reports.length} reports`}`}
          tone={pastCadence > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      {meetings.length > 0 && <p className="mb-4 text-sm font-medium text-text">{verdict}</p>}

      <SectionCard title="Start a new 1:1" icon={Plus} className="mb-4">
        <StartForm today={today} onStart={startMeeting} offerAddToRoster={!preview} />
      </SectionCard>

      {activeMeeting && (
        <section
          aria-label="Active 1:1"
          className="rounded-lg border border-accent/40 bg-accent/5 p-4 mb-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-accent">Active 1:1</div>
              {/* Focus lands here when a past 1:1 is opened (tabIndex -1: not a tab stop). */}
              <h3
                ref={refFor("active")}
                tabIndex={-1}
                className="text-sm font-medium text-text break-words rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {activeMeeting.manager} ↔ {activeMeeting.report} · {activeMeeting.date || "No date"}
              </h3>
              {activeMeeting.description && !editingDetails && (
                <p className="mt-1 text-xs text-sub whitespace-pre-wrap">
                  {activeMeeting.description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!editingDetails && (
                <Button
                  ref={details.triggerRef}
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-sub hover:text-text"
                  onClick={details.start}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit details
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Back to its row in Past meetings, which this brings back.
                  returnTo(`open:${activeMeeting.id}`);
                  setActiveMeetingId(null);
                  setEditingDetails(false);
                }}
                className="text-sub hover:text-accent"
              >
                Close
              </Button>
            </div>
          </div>

          {editingDetails && (
            <div className="mb-4 rounded-md border border-border bg-surface p-3">
              <DetailsForm
                meeting={activeMeeting}
                offerAddToRoster={!preview}
                onSave={(values) => saveDetails(activeMeeting, values)}
                onCancel={() => details.stop({ refocus: true })}
              />
            </div>
          )}

          <div className="text-xs uppercase tracking-wider text-sub mb-2">Agenda</div>
          <div className="mb-3">
            <AgendaAddForm onAdd={(text) => addAgendaItem(activeMeeting, text)} />
          </div>

          {activeMeeting.agenda.length === 0 ? (
            <p className="mb-4 text-xs text-sub">
              No agenda items yet. Carry-forward items from the prior 1:1 appear here automatically
              when one exists.
            </p>
          ) : (
            <ul className="mb-4 space-y-2" aria-label="Agenda">
              {activeMeeting.agenda.map((a) => (
                <AgendaItemRow
                  key={a.id}
                  item={a}
                  today={today}
                  offerAddToRoster={!preview}
                  onStatus={(status) => setStatus(activeMeeting, a, status)}
                  onPatch={(patch) => patchItem(activeMeeting.id, a.id, patch)}
                  onDelete={() => removeAgendaItem(activeMeeting, a)}
                />
              ))}
            </ul>
          )}

          <div className="text-xs uppercase tracking-wider text-sub mb-2">Notes</div>
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              if (notesDraft !== notesCommittedRef.current) {
                notesCommittedRef.current = notesDraft;
                patchMeeting(activeMeeting.id, { notes: notesDraft });
              }
            }}
            placeholder="Meeting notes (private to you)..."
            rows={4}
            className="bg-bg border-border text-sm resize-y"
            aria-label="Meeting notes"
          />
        </section>
      )}

      <div className="mb-4">
        <CadenceSection rows={reports} today={today} onCadence={setCadence} />
      </div>

      {meetings.length === 0 ? (
        <EmptyState icon={Coffee} action={<LoadExampleButton onLoad={loadExample} />}>
          No 1:1s yet. Start one above to begin tracking your rolling agenda.
        </EmptyState>
      ) : (
        pastMeetings.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-sub">Past meetings</div>
            <ResortChip isStale={isStale} onResort={resort} what="Dates" />
            {pastMeetings.map((m) => {
              const expanded = expandedPast.has(m.id);
              return (
                <div key={m.id} className="rounded-lg border border-border bg-surface">
                  {/* The disclosure toggle and the row actions are siblings:
                      buttons can't nest inside the toggle button. */}
                  <div className="w-full flex items-center justify-between gap-2 hover:bg-bg/40">
                    <button
                      type="button"
                      onClick={() => togglePastExpanded(m.id)}
                      className="flex flex-1 items-center gap-2 min-w-0 py-3 pl-3 text-left"
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-sub" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-sub" aria-hidden="true" />
                      )}
                      <span className="text-sm text-text truncate">
                        {m.date || "No date"} · {m.manager} ↔ {m.report}
                      </span>
                      <span className="text-xs text-sub shrink-0">
                        {m.agenda.length} item{m.agenda.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 pr-3">
                      <Button
                        ref={refFor(`open:${m.id}`)}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // This row leaves the list: focus goes to the opened 1:1.
                          returnTo("active");
                          setActiveMeetingId(m.id);
                          setEditingDetails(false);
                        }}
                        className="text-xs text-sub hover:text-accent"
                        aria-label={`Open 1:1 from ${m.date || "no date"}`}
                      >
                        Open
                      </Button>
                      <IconButton
                        label={`Remove 1:1 from ${m.date || "no date"}`}
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        className="h-7 w-7 text-sub hover:text-danger"
                        onClick={() => removeMeeting(m)}
                      />
                    </div>
                  </div>
                  {expanded && (
                    <div className="px-3 pb-3 space-y-1.5">
                      {m.description && (
                        <div className="text-xs text-sub whitespace-pre-wrap">{m.description}</div>
                      )}
                      {m.agenda.map((a) => (
                        <div
                          key={a.id}
                          className={`rounded-md border p-2 text-xs ${STATUS_TONE[a.status]}`}
                        >
                          <span className="text-xs uppercase tracking-wider mr-2 font-data text-sub">
                            {STATUS_LABELS[a.status]}
                          </span>
                          <span className="text-text">{a.text}</span>
                          {a.action && (
                            <div className="text-xs mt-1 text-sub">
                              → {a.action}
                              {a.owner && ` (${a.owner})`}
                              {a.dueDate && ` · due ${a.dueDate}`}
                              {a.status === "done" && a.doneAt && ` · done ${a.doneAt}`}
                            </div>
                          )}
                        </div>
                      ))}
                      {m.notes && (
                        <div className="text-xs text-sub whitespace-pre-wrap pt-2 border-t border-border">
                          {m.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </ToolPageWrapper>
  );
}
