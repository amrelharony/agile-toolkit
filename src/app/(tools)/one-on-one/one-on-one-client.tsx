"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BlurInput } from "@/components/shared/blur-fields";
import {
  Coffee,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  AlertCircle,
  Sprout,
  CalendarRange,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONE_ON_ONE_ACTIONS } from "@/lib/history/event-actions";
import { generateOneOnOnePrompts } from "@/lib/ai-prompts/one-on-one";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type AgendaStatus = "open" | "discussed" | "action_required";

interface AgendaItem {
  id: string;
  text: string;
  status: AgendaStatus;
  action?: string;
  owner?: string;
  dueDate?: string;
  /**
   * Id of the item in an earlier 1:1 that this one was carried over from.
   * The earlier item is then superseded: the follow-up lives here, so it
   * isn't counted twice in "Action items overdue".
   */
  carriedFrom?: string;
}

interface Meeting {
  id: string;
  manager: string;
  report: string;
  date: string; // YYYY-MM-DD
  agenda: AgendaItem[];
  notes?: string;
  description?: string;
}

const STORAGE_KEY = "agile-toolkit:one-on-one";

const STATUS_LABELS: Record<AgendaStatus, string> = {
  open: "Open",
  discussed: "Discussed",
  action_required: "Action",
};

const NEXT_STATUS: Record<AgendaStatus, AgendaStatus> = {
  open: "discussed",
  discussed: "action_required",
  action_required: "open",
};

const STATUS_TONE: Record<AgendaStatus, string> = {
  open: "border-warning/40 bg-warning/5 text-warning",
  discussed: "border-success/40 bg-success/5 text-success",
  action_required: "border-accent/40 bg-accent/5 text-accent",
};

function pairKey(m: Pick<Meeting, "manager" | "report">): string {
  return `${m.manager.toLowerCase()}::${m.report.toLowerCase()}`;
}

export function OneOnOneClient() {
  const [meetings, setMeetings] = usePersisted<Meeting[]>(STORAGE_KEY, []);
  const { log } = useHistoryLogger("one-on-one");

  const [manager, setManager] = useState("");
  const [report, setReport] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");

  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [newAgendaText, setNewAgendaText] = useState("");
  const [expandedPast, setExpandedPast] = useState<Set<string>>(new Set());

  // Sort meetings newest-first by date.
  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => b.date.localeCompare(a.date)),
    [meetings]
  );

  const activeMeeting = useMemo(
    () => meetings.find((m) => m.id === activeMeetingId) ?? null,
    [meetings, activeMeetingId]
  );

  const startMeeting = () => {
    if (!manager.trim() || !report.trim()) return;
    const id = crypto.randomUUID();
    const desc = description.trim();
    const newMeeting: Meeting = {
      id,
      manager: manager.trim(),
      report: report.trim(),
      date,
      agenda: [],
      description: desc.length > 0 ? desc : undefined,
    };
    // Carry forward open agenda items from the most recent prior meeting
    // for the same pair (case-insensitive match). Only meetings *on or
    // before* the new meeting's date count as prior — otherwise scheduling
    // a back-dated meeting would inherit items from a future one. Ties on
    // date are broken by preferring the meeting with a non-empty agenda
    // (so an empty placeholder doesn't shadow a populated one).
    const pk = pairKey(newMeeting);
    // BUG-T5-one-on-one-6: prefer the most recent meeting with a
    // populated agenda over a strictly-newer empty meeting. The prior
    // sort only broke same-date ties on agenda-non-emptiness, so a
    // newest-date empty placeholder always won the lookup and
    // wiped any open items from the actual prior populated meeting.
    const candidates = meetings.filter(
      (m) => pairKey(m) === pk && m.id !== newMeeting.id && m.date <= newMeeting.date
    );
    const populated = candidates
      .filter((m) => m.agenda.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const newest = candidates.sort((a, b) => b.date.localeCompare(a.date))[0];
    const prior = populated ?? newest;
    if (prior) {
      // Carry over everything still unfinished: Open topics, and Actions
      // with their action, owner and due date so the follow-up doesn't drop
      // off. An Action stops carrying over once it is set to Discussed.
      const carry: AgendaItem[] = prior.agenda
        .filter((a) => a.status === "open" || a.status === "action_required")
        .map((a) =>
          a.status === "open"
            ? { id: crypto.randomUUID(), text: a.text, status: "open", carriedFrom: a.id }
            : {
                id: crypto.randomUUID(),
                text: a.text,
                status: "action_required",
                action: a.action,
                owner: a.owner,
                dueDate: a.dueDate,
                carriedFrom: a.id,
              }
        );
      newMeeting.agenda = carry;
    }
    setMeetings((s) => [...s, newMeeting]);
    log(ONE_ON_ONE_ACTIONS.MEETING_LOGGED, {
      meetingId: id,
      manager: newMeeting.manager,
      report: newMeeting.report,
      date: newMeeting.date,
      carriedItems: newMeeting.agenda.length,
    });
    setActiveMeetingId(id);
    setManager("");
    setReport("");
    setDescription("");
  };

  const removeMeeting = (id: string) => {
    const m = meetings.find((x) => x.id === id);
    setMeetings((s) => s.filter((x) => x.id !== id));
    if (activeMeetingId === id) setActiveMeetingId(null);
    log(ONE_ON_ONE_ACTIONS.MEETING_REMOVED, {
      meetingId: id,
      manager: m?.manager,
      report: m?.report,
    });
  };

  const addAgendaItem = () => {
    if (!activeMeeting) return;
    const text = newAgendaText.trim();
    if (!text) return;
    const item: AgendaItem = {
      id: crypto.randomUUID(),
      text,
      status: "open",
    };
    setMeetings((s) =>
      s.map((m) => (m.id === activeMeeting.id ? { ...m, agenda: [...m.agenda, item] } : m))
    );
    log(ONE_ON_ONE_ACTIONS.AGENDA_ITEM_ADDED, {
      meetingId: activeMeeting.id,
      itemId: item.id,
      text,
    });
    setNewAgendaText("");
  };

  const toggleAgendaStatus = (itemId: string) => {
    if (!activeMeeting) return;
    const current = activeMeeting.agenda.find((a) => a.id === itemId);
    if (!current) return;
    const next = NEXT_STATUS[current.status];
    setMeetings((s) =>
      s.map((m) =>
        m.id === activeMeeting.id
          ? {
              ...m,
              agenda: m.agenda.map((a) => (a.id === itemId ? { ...a, status: next } : a)),
            }
          : m
      )
    );
    log(ONE_ON_ONE_ACTIONS.ACTION_TOGGLED, {
      meetingId: activeMeeting.id,
      itemId,
      from: current.status,
      to: next,
    });
  };

  const updateAgendaItem = (itemId: string, patch: Partial<AgendaItem>) => {
    if (!activeMeeting) return;
    setMeetings((s) =>
      s.map((m) =>
        m.id === activeMeeting.id
          ? {
              ...m,
              agenda: m.agenda.map((a) => (a.id === itemId ? { ...a, ...patch } : a)),
            }
          : m
      )
    );
  };

  const removeAgendaItem = (itemId: string) => {
    if (!activeMeeting) return;
    setMeetings((s) =>
      s.map((m) =>
        m.id === activeMeeting.id ? { ...m, agenda: m.agenda.filter((a) => a.id !== itemId) } : m
      )
    );
  };

  // Persisted commit. Called from the draft textarea below on blur (not on
  // every keystroke) so we don't write to localStorage per character.
  const updateNotes = (val: string) => {
    if (!activeMeeting) return;
    setMeetings((s) => s.map((m) => (m.id === activeMeeting.id ? { ...m, notes: val } : m)));
  };

  // Local draft mirrors the active meeting's notes — typing only touches
  // this state. We sync the draft when the active meeting flips (open
  // another meeting), and flush on blur.
  const [notesDraft, setNotesDraft] = useState<string>("");
  const notesCommittedRef = useRef<string>("");
  useEffect(() => {
    // R5: depend ONLY on `activeMeeting?.id`. Including
    // `activeMeeting?.notes` re-fires the effect every time the local
    // draft was committed via `updateNotes` → `notes` changed →
    // `activeMeeting` re-derived → effect re-ran → setNotesDraft
    // overwrote the user's in-progress typing AFTER they had just
    // committed. Only sync when the user opens a DIFFERENT meeting.
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

  // KPIs.
  const meetingsThisMonth = useMemo(() => {
    const todayDate = new Date();
    const yearMonth = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    return meetings.filter((m) => m.date.startsWith(yearMonth)).length;
  }, [meetings]);

  const overdueActions = useMemo(() => {
    const today = todayLocalISO();
    const items = meetings.flatMap((m) => m.agenda);
    // An action carried over to a later 1:1 is counted there, not twice.
    const superseded = new Set(items.map((a) => a.carriedFrom).filter(Boolean));
    return items.filter(
      (a) =>
        a.status === "action_required" && a.dueDate && a.dueDate < today && !superseded.has(a.id)
    ).length;
  }, [meetings]);

  const discussedPct = useMemo(() => {
    const total = meetings.reduce((acc, m) => acc + m.agenda.length, 0);
    if (total === 0) return 0;
    const discussed = meetings
      .flatMap((m) => m.agenda)
      .filter((a) => a.status === "discussed" || a.status === "action_required").length;
    return Math.round((discussed / total) * 100);
  }, [meetings]);

  // Count anywhere "growth" surfaces in a 1:1 — agenda text/action *and*
  // meeting-level notes/description. The KPI label is "Growth themes", so
  // it covers themes mentioned outside discrete agenda items too.
  const growthThemes = useMemo(() => {
    // R11-fix: word-boundary regex. The previous /growth/i matched
    // "regrowth", "outgrowth", "growth-hacking" — false positives
    // that fed into AI prompts as a KPI, misdirecting manager
    // attention toward themes that weren't actually about employee
    // growth.
    const re = /\bgrowth\b/i;
    let count = 0;
    for (const m of meetings) {
      if (re.test(m.notes ?? "") || re.test(m.description ?? "")) count += 1;
      for (const a of m.agenda) {
        if (re.test(a.text) || re.test(a.action ?? "")) count += 1;
      }
    }
    return count;
  }, [meetings]);

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
      prompts: generateOneOnOnePrompts({ meetings }, workspace),
    }),
    [meetings, workspace]
  );

  const csvData = useMemo(
    () => ({
      headers: ["Meeting Date", "Manager", "Report", "Agenda", "Status", "Action", "Owner", "Due"],
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
            ])
          : [[m.date, m.manager, m.report, "", "", "", "", ""]]
      ),
    }),
    [meetings]
  );

  const pastMeetings = sortedMeetings.filter((m) => m.id !== activeMeetingId);

  return (
    <ToolPageWrapper
      toolId="one-on-one"
      title="1:1 Meeting Tracker"
      description="Manager-IC 1:1 log with rolling agenda, action items, and growth themes."
      category="Ceremonies"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="one-on-one" csvData={csvData} jsonData={meetings} />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={CalendarRange}
          label="Meetings this month"
          value={meetingsThisMonth}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={AlertCircle}
          label="Action items overdue"
          value={overdueActions}
          tone={overdueActions > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={CheckSquare}
          // BUG-T5-one-on-one-3: "Discussed" is misleading because
          // discussedPct also includes status="action_required" (a
          // discussed item that needs follow-up, NOT closed). The
          // closer term is "Addressed" — covers both paths.
          label="Addressed"
          value={`${discussedPct}%`}
          hint="discussed or action queued"
        />
        <StatCard
          variant="compact"
          icon={Sprout}
          label="Growth themes"
          value={growthThemes}
          hint='items mentioning "growth"'
        />
      </KpiGrid>

      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-sub mb-3">Start a new 1:1</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <Input
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            placeholder="Manager"
            className="bg-bg border-border text-sm"
            aria-label="Manager"
          />
          <Input
            value={report}
            onChange={(e) => setReport(e.target.value)}
            placeholder="Report"
            className="bg-bg border-border text-sm"
            aria-label="Report"
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-bg border-border text-sm"
            aria-label="Date"
          />
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          rows={2}
          className="bg-bg border-border text-sm resize-none mb-2"
          aria-label="Description"
        />
        <div className="flex justify-end">
          <Button
            onClick={startMeeting}
            disabled={!manager.trim() || !report.trim()}
            className="gap-2 bg-accent text-bg hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Start meeting
          </Button>
        </div>
      </div>

      {activeMeeting && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 mb-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-accent">Active 1:1</div>
              <div className="text-sm font-medium text-text">
                {activeMeeting.manager} ↔ {activeMeeting.report} · {activeMeeting.date}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveMeetingId(null)}
              className="text-sub hover:text-accent"
            >
              Close
            </Button>
          </div>

          <div className="text-xs uppercase tracking-wider text-sub mb-2">Agenda</div>
          <div className="flex gap-2 mb-3">
            <Input
              value={newAgendaText}
              onChange={(e) => setNewAgendaText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAgendaItem()}
              placeholder="New agenda item..."
              className="bg-bg border-border text-sm"
              aria-label="New agenda item"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addAgendaItem}
              className="gap-1 border-border"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>

          <div className="space-y-2 mb-4">
            {activeMeeting.agenda.length === 0 ? (
              <p className="text-xs text-sub">
                No agenda items yet. Carry-forward items from the prior 1:1 appear here
                automatically when one exists.
              </p>
            ) : (
              activeMeeting.agenda.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-md border p-2 text-xs ${STATUS_TONE[a.status]}`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggleAgendaStatus(a.id)}
                      className="text-xs uppercase tracking-wider px-1.5 py-0.5 rounded font-data border border-current/40 shrink-0 hover:opacity-80 min-touch-coarse inline-flex items-center justify-center"
                      aria-label={`${STATUS_LABELS[a.status]}: change status of ${a.text}`}
                    >
                      {STATUS_LABELS[a.status]}
                    </button>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="text-text break-words">{a.text}</div>
                      {a.status === "action_required" && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                          <BlurInput
                            value={a.action ?? ""}
                            onCommit={(v) => updateAgendaItem(a.id, { action: v })}
                            placeholder="Action..."
                            className="bg-bg border-border text-xs h-7"
                            aria-label="Action"
                          />
                          <BlurInput
                            value={a.owner ?? ""}
                            onCommit={(v) => updateAgendaItem(a.id, { owner: v })}
                            placeholder="Owner"
                            className="bg-bg border-border text-xs h-7"
                            aria-label="Owner"
                          />
                          <Input
                            type="date"
                            value={a.dueDate ?? ""}
                            onChange={(e) =>
                              updateAgendaItem(a.id, {
                                dueDate: e.target.value || undefined,
                              })
                            }
                            className="bg-bg border-border text-xs h-7"
                            aria-label="Due date"
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAgendaItem(a.id)}
                      className="h-6 w-6 p-0 text-sub hover:text-danger min-touch-coarse"
                      aria-label="Remove agenda item"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="text-xs uppercase tracking-wider text-sub mb-2">Notes</div>
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              if (notesDraft !== notesCommittedRef.current) {
                notesCommittedRef.current = notesDraft;
                updateNotes(notesDraft);
              }
            }}
            placeholder="Meeting notes..."
            rows={4}
            className="bg-bg border-border text-sm resize-y"
            aria-label="Meeting notes"
          />
        </div>
      )}

      {pastMeetings.length === 0 && !activeMeeting ? (
        <EmptyState icon={Coffee}>
          No 1:1s yet. Start one above to begin tracking your rolling agenda.
        </EmptyState>
      ) : (
        pastMeetings.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-sub">Past meetings</div>
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
                        <ChevronDown className="w-3.5 h-3.5 text-sub" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-sub" />
                      )}
                      <span className="text-sm text-text truncate">
                        {m.date} · {m.manager} ↔ {m.report}
                      </span>
                      <span className="text-xs text-sub">
                        {m.agenda.length} item{m.agenda.length === 1 ? "" : "s"}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 pr-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveMeetingId(m.id)}
                        className="text-xs text-sub hover:text-accent"
                        aria-label={`Open 1:1 from ${m.date}`}
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMeeting(m.id)}
                        className="h-7 w-7 p-0 text-sub hover:text-danger min-touch-coarse"
                        aria-label={`Remove 1:1 from ${m.date}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
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
                          <span className="text-xs uppercase tracking-wider mr-2 font-data">
                            {STATUS_LABELS[a.status]}
                          </span>
                          <span className="text-text">{a.text}</span>
                          {a.action && (
                            <div className="text-xs mt-1 text-sub">
                              → {a.action}
                              {a.owner && ` (${a.owner})`}
                              {a.dueDate && ` · due ${a.dueDate}`}
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
