"use client";

import { useMemo, useState } from "react";
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

type AgendaStatus = "open" | "discussed" | "action_required";

interface AgendaItem {
  id: string;
  text: string;
  status: AgendaStatus;
  action?: string;
  owner?: string;
  dueDate?: string;
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
  open: "border-amber-500/40 bg-amber-500/5 text-amber-200",
  discussed: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
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
    const prior = meetings
      .filter(
        (m) =>
          pairKey(m) === pk &&
          m.id !== newMeeting.id &&
          m.date <= newMeeting.date
      )
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aHas = a.agenda.length > 0 ? 1 : 0;
        const bHas = b.agenda.length > 0 ? 1 : 0;
        return bHas - aHas;
      })[0];
    if (prior) {
      const carry = prior.agenda
        .filter((a) => a.status === "open")
        .map((a) => ({
          id: crypto.randomUUID(),
          text: a.text,
          status: "open" as AgendaStatus,
        }));
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
      s.map((m) =>
        m.id === activeMeeting.id ? { ...m, agenda: [...m.agenda, item] } : m
      )
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
              agenda: m.agenda.map((a) =>
                a.id === itemId ? { ...a, status: next } : a
              ),
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
              agenda: m.agenda.map((a) =>
                a.id === itemId ? { ...a, ...patch } : a
              ),
            }
          : m
      )
    );
  };

  const removeAgendaItem = (itemId: string) => {
    if (!activeMeeting) return;
    setMeetings((s) =>
      s.map((m) =>
        m.id === activeMeeting.id
          ? { ...m, agenda: m.agenda.filter((a) => a.id !== itemId) }
          : m
      )
    );
  };

  const updateNotes = (val: string) => {
    if (!activeMeeting) return;
    setMeetings((s) =>
      s.map((m) =>
        m.id === activeMeeting.id ? { ...m, notes: val } : m
      )
    );
  };

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
    const yearMonth = `${todayDate.getFullYear()}-${String(
      todayDate.getMonth() + 1
    ).padStart(2, "0")}`;
    return meetings.filter((m) => m.date.startsWith(yearMonth)).length;
  }, [meetings]);

  const overdueActions = useMemo(() => {
    const today = todayLocalISO();
    return meetings
      .flatMap((m) => m.agenda)
      .filter(
        (a) =>
          a.status === "action_required" &&
          a.dueDate &&
          a.dueDate < today
      ).length;
  }, [meetings]);

  const discussedPct = useMemo(() => {
    const total = meetings.reduce((acc, m) => acc + m.agenda.length, 0);
    if (total === 0) return 0;
    const discussed = meetings
      .flatMap((m) => m.agenda)
      .filter(
        (a) => a.status === "discussed" || a.status === "action_required"
      ).length;
    return Math.round((discussed / total) * 100);
  }, [meetings]);

  // Count anywhere "growth" surfaces in a 1:1 — agenda text/action *and*
  // meeting-level notes/description. The KPI label is "Growth themes", so
  // it covers themes mentioned outside discrete agenda items too.
  const growthThemes = useMemo(() => {
    const re = /growth/i;
    let count = 0;
    for (const m of meetings) {
      if (re.test(m.notes ?? "") || re.test(m.description ?? "")) count += 1;
      for (const a of m.agenda) {
        if (re.test(a.text) || re.test(a.action ?? "")) count += 1;
      }
    }
    return count;
  }, [meetings]);

  const promptConfig = useMemo(
    () => ({
      toolName: "1:1 Meeting Tracker",
      prompts: generateOneOnOnePrompts({ meetings }),
    }),
    [meetings]
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
        <ExportButton
          filename="one-on-one"
          csvData={csvData}
          jsonData={meetings}
        />
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
          label="Discussed"
          value={`${discussedPct}%`}
          hint="of agenda items"
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
        <div className="text-xs uppercase tracking-wider text-sub mb-3">
          Start a new 1:1
        </div>
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
              <div className="text-xs uppercase tracking-wider text-accent">
                Active 1:1
              </div>
              <div className="text-sm font-medium text-text">
                {activeMeeting.manager} ↔ {activeMeeting.report} ·{" "}
                {activeMeeting.date}
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

          <div className="text-xs uppercase tracking-wider text-sub mb-2">
            Agenda
          </div>
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
                No agenda items yet. Carry-forward items from the prior 1:1
                appear here automatically when one exists.
              </p>
            ) : (
              activeMeeting.agenda.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-md border p-2 text-xs ${STATUS_TONE[a.status]}`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => toggleAgendaStatus(a.id)}
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-data border border-current/40 shrink-0 hover:opacity-80"
                      aria-label={`Cycle status for ${a.text}`}
                    >
                      {STATUS_LABELS[a.status]}
                    </button>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="text-text break-words">{a.text}</div>
                      {a.status === "action_required" && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                          <Input
                            value={a.action ?? ""}
                            onChange={(e) =>
                              updateAgendaItem(a.id, { action: e.target.value })
                            }
                            placeholder="Action..."
                            className="bg-bg border-border text-xs h-7"
                            aria-label="Action"
                          />
                          <Input
                            value={a.owner ?? ""}
                            onChange={(e) =>
                              updateAgendaItem(a.id, { owner: e.target.value })
                            }
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
                      className="h-6 w-6 p-0 text-sub hover:text-danger"
                      aria-label="Remove agenda item"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="text-xs uppercase tracking-wider text-sub mb-2">
            Notes
          </div>
          <Textarea
            value={activeMeeting.notes ?? ""}
            onChange={(e) => updateNotes(e.target.value)}
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
            <div className="text-xs uppercase tracking-wider text-sub">
              Past meetings
            </div>
            {pastMeetings.map((m) => {
              const expanded = expandedPast.has(m.id);
              return (
                <div
                  key={m.id}
                  className="rounded-lg border border-border bg-surface"
                >
                  <button
                    onClick={() => togglePastExpanded(m.id)}
                    className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-bg/40"
                    aria-expanded={expanded}
                  >
                    <div className="flex items-center gap-2 min-w-0">
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
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMeetingId(m.id);
                        }}
                        className="text-xs text-sub hover:text-accent"
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMeeting(m.id);
                        }}
                        className="h-7 w-7 p-0 text-sub hover:text-danger"
                        aria-label="Remove meeting"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-3 pb-3 space-y-1.5">
                      {m.description && (
                        <div className="text-xs text-sub whitespace-pre-wrap">
                          {m.description}
                        </div>
                      )}
                      {m.agenda.map((a) => (
                        <div
                          key={a.id}
                          className={`rounded-md border p-2 text-xs ${STATUS_TONE[a.status]}`}
                        >
                          <span className="text-[10px] uppercase tracking-wider mr-2 font-data">
                            {STATUS_LABELS[a.status]}
                          </span>
                          <span className="text-text">{a.text}</span>
                          {a.action && (
                            <div className="text-[11px] mt-1 text-sub">
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
