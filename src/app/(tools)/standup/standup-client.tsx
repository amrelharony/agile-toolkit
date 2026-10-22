"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { generateStandupPrompts } from "@/lib/ai-prompts/standup";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STANDUP_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  Calendar,
  FileText,
} from "lucide-react";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function todayStr() {
  return todayLocalISO();
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function ageLabel(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "< 1 day";
  if (hours < 72) return `${Math.floor(hours / 24)}d`;
  return `${Math.floor(hours / 24)}d`;
}

function ageColor(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "text-success";
  if (hours < 72) return "text-warning";
  return "text-danger";
}

function ageBg(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "border-success/30 bg-success/5";
  if (hours < 72) return "border-warning/30 bg-warning/5";
  return "border-danger/30 bg-danger/5";
}

function generateDayDigest(entries: StandupEntry[], date: string): string {
  const dayEntries = entries.filter((e) => e.date === date);
  if (dayEntries.length === 0) return `# Standup — ${date}\n\nNo entries.`;

  const lines: string[] = [`# Standup — ${date}`, ""];
  for (const e of dayEntries) {
    lines.push(`## ${e.member}`);
    lines.push(`**Yesterday:** ${e.yesterday || "—"}`);
    lines.push(`**Today:** ${e.today || "—"}`);
    if (e.blockers) lines.push(`**Blockers:** ${e.blockers}`);
    lines.push("");
  }
  return lines.join("\n");
}

function generateWeeklyDigest(entries: StandupEntry[]): string {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const dates = Array.from(new Set(sorted.map((e) => e.date))).slice(0, 5);
  const members = Array.from(new Set(sorted.map((e) => e.member)));

  const lines: string[] = ["# Weekly Standup Digest", ""];
  for (const member of members) {
    lines.push(`## ${member}`);
    const memberEntries = dates.flatMap((d) =>
      entries.filter((e) => e.date === d && e.member === member)
    );
    if (memberEntries.length === 0) {
      lines.push("_No entries_");
    } else {
      for (const e of memberEntries) {
        lines.push(`**${e.date}**`);
        lines.push(`- Yesterday: ${e.yesterday || "—"}`);
        lines.push(`- Today: ${e.today || "—"}`);
        if (e.blockers) lines.push(`- Blockers: ${e.blockers}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function EntryCard({
  entry,
  isResolved,
  onResolve,
}: {
  entry: StandupEntry;
  isResolved: boolean;
  onResolve: () => void;
}) {
  const hasBlocker = entry.blockers.trim().length > 0;
  return (
    <Card className="bg-surface-deep border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-accent" />
            </div>
            <span className="font-medium text-text">{entry.member}</span>
          </div>
          {hasBlocker && !isResolved && (
            <Badge className="bg-danger/15 text-danger border-danger/30 gap-1">
              <AlertTriangle className="w-3 h-3" />
              Blocker
            </Badge>
          )}
          {isResolved && (
            <Badge className="bg-success/15 text-success border-success/30 gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Resolved
            </Badge>
          )}
        </div>

        {entry.yesterday && (
          <div>
            <p className="text-xs text-sub mb-1 uppercase tracking-wider">Yesterday</p>
            <p className="text-sm text-text">{entry.yesterday}</p>
          </div>
        )}
        {entry.today && (
          <div>
            <p className="text-xs text-sub mb-1 uppercase tracking-wider">Today</p>
            <p className="text-sm text-text">{entry.today}</p>
          </div>
        )}
        {hasBlocker && (
          <div
            className={`rounded-md border p-3 ${
              isResolved ? "border-border bg-card" : "border-danger/30 bg-danger/5"
            }`}
          >
            <p className="text-xs text-sub mb-1 uppercase tracking-wider">Blockers</p>
            <p className={`text-sm ${isResolved ? "text-sub line-through" : "text-danger"}`}>
              {entry.blockers}
            </p>
            {!isResolved && (
              <button
                onClick={onResolve}
                className="mt-2 text-xs text-success hover:underline flex items-center gap-1 min-touch-coarse py-1"
              >
                <CheckCircle2 className="w-3 h-3" />
                Mark resolved
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 1 — Today                                                             */
/* -------------------------------------------------------------------------- */

function TodayTab({
  entries,
  members,
  resolvedBlockers,
  onResolve,
}: {
  entries: StandupEntry[];
  members: string[];
  resolvedBlockers: string[];
  onResolve: (id: string) => void;
}) {
  const today = todayStr();
  const todayEntries = entries.filter((e) => e.date === today);
  const submittedMembers = new Set(todayEntries.map((e) => e.member));
  const missingMembers = members.filter((m) => !submittedMembers.has(m));

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <p className="text-fluid-h3 font-data font-bold text-accent">{todayEntries.length}</p>
          <p className="text-xs text-sub mt-0.5">Submitted</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <p className="text-fluid-h3 font-data font-bold text-warning">{missingMembers.length}</p>
          <p className="text-xs text-sub mt-0.5">Missing</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <p className="text-fluid-h3 font-data font-bold text-danger">
            {
              todayEntries.filter((e) => e.blockers.trim() && !resolvedBlockers.includes(e.id))
                .length
            }
          </p>
          <p className="text-xs text-sub mt-0.5">Blockers</p>
        </div>
      </div>

      {/* Entries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {todayEntries.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            isResolved={resolvedBlockers.includes(e.id)}
            onResolve={() => onResolve(e.id)}
          />
        ))}
      </div>

      {/* Missing members */}
      {missingMembers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-sub uppercase tracking-wider">Not yet submitted</p>
          <div className="flex flex-wrap gap-2">
            {missingMembers.map((m) => (
              <div
                key={m}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border text-sub text-sm"
              >
                <User className="w-3.5 h-3.5" />
                {m}
              </div>
            ))}
          </div>
        </div>
      )}

      {todayEntries.length === 0 && missingMembers.length === 0 && (
        <p className="text-center text-sub py-8 text-sm">
          No entries today and no team members configured yet.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 2 — History                                                           */
/* -------------------------------------------------------------------------- */

function HistoryTab({ entries, members }: { entries: StandupEntry[]; members: string[] }) {
  const [filterMember, setFilterMember] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());

  // Today is always on offer: it's the default pick, and without its option
  // the dropdown showed another day while the list was for today.
  const allDates = useMemo(
    () =>
      Array.from(new Set([todayStr(), ...entries.map((e) => e.date)])).sort((a, b) =>
        b.localeCompare(a)
      ),
    [entries]
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) => e.date === selectedDate && (filterMember === "all" || e.member === filterMember)
      ),
    [entries, selectedDate, filterMember]
  );

  const digestText = useMemo(
    () => generateDayDigest(entries, selectedDate),
    [entries, selectedDate]
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-sub" />
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Digest date"
            className="bg-surface-deep border border-border rounded-md px-3 py-1.5 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {allDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-sub" />
          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            aria-label="Filter by member"
            className="bg-surface-deep border border-border rounded-md px-3 py-1.5 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">All members</option>
            {members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          <ExportButton filename={`standup-${selectedDate}`} clipboardText={digestText} />
        </div>
      </div>

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="table-wrap-responsive">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">
                  Member
                </th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">
                  Yesterday
                </th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">
                  Today
                </th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3">
                  Blockers
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 text-text font-medium whitespace-nowrap">{e.member}</td>
                  <td className="py-3 pr-4 text-sub max-w-xs">
                    {e.yesterday || <span className="opacity-40">—</span>}
                  </td>
                  <td className="py-3 pr-4 text-sub max-w-xs">
                    {e.today || <span className="opacity-40">—</span>}
                  </td>
                  <td className="py-3 text-sub max-w-xs">
                    {e.blockers ? (
                      <span className="text-danger">{e.blockers}</span>
                    ) : (
                      <span className="opacity-40">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-center text-sub py-8 text-sm">
          No entries for {selectedDate}
          {filterMember !== "all" ? ` from ${filterMember}` : ""}.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 3 — Blockers Dashboard                                                */
/* -------------------------------------------------------------------------- */

/** An open blocker can be raised as an impediment. */
const BLOCKER_ROUTES = ["impediment"] as const;

function BlockersTab({
  entries,
  resolvedBlockers,
  onResolve,
  onLinksChange,
}: {
  entries: StandupEntry[];
  resolvedBlockers: string[];
  onResolve: (id: string) => void;
  /** Record where a blocker was sent; without it there is no Send to. */
  onLinksChange?: (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
}) {
  const blockerEntries = useMemo(
    () =>
      entries
        .filter((e) => e.blockers.trim() && !resolvedBlockers.includes(e.id))
        .sort((a, b) => a.timestamp - b.timestamp),
    [entries, resolvedBlockers]
  );

  const resolvedEntries = useMemo(
    () => entries.filter((e) => e.blockers.trim() && resolvedBlockers.includes(e.id)),
    [entries, resolvedBlockers]
  );

  return (
    <div className="space-y-6">
      {/* Open blockers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-danger" />
          <h3 className="text-sm font-medium text-text uppercase tracking-wider">Open Blockers</h3>
          {blockerEntries.length > 0 && (
            <Badge className="bg-danger/15 text-danger border-danger/30">
              {blockerEntries.length}
            </Badge>
          )}
        </div>

        {blockerEntries.length === 0 ? (
          <div className="text-center py-8 text-sub text-sm bg-surface border border-border rounded-lg">
            <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2 opacity-60" />
            No open blockers — all clear!
          </div>
        ) : (
          <div className="space-y-3">
            {blockerEntries.map((e) => (
              <div key={e.id} className={`border rounded-lg p-4 ${ageBg(e.timestamp)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-3.5 h-3.5 text-sub shrink-0" />
                      <span className="font-medium text-text text-sm">{e.member}</span>
                      <span className="text-sub text-xs">·</span>
                      <span className="text-sub text-xs">{e.date}</span>
                      <div className="flex items-center gap-1 ml-auto">
                        <Clock className={`w-3 h-3 ${ageColor(e.timestamp)}`} />
                        <span className={`text-xs font-data ${ageColor(e.timestamp)}`}>
                          {ageLabel(e.timestamp)}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-text">{e.blockers}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                    {onLinksChange && (
                      <SendToMenu
                        routes={BLOCKER_ROUTES}
                        item={{
                          title: e.blockers,
                          raisedBy: e.member,
                          sourceRef: { tool: "standup", id: e.id },
                        }}
                        sentTo={e.sentTo}
                        onLinksChange={(update) => onLinksChange(e.id, update)}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onResolve(e.id)}
                      className="shrink-0 text-success hover:text-success hover:bg-success/10 gap-1.5 text-xs"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Resolve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved blockers */}
      {resolvedEntries.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <h3 className="text-sm font-medium text-sub uppercase tracking-wider">Resolved</h3>
          </div>
          <div className="space-y-2">
            {resolvedEntries.map((e) => (
              <div
                key={e.id}
                className="border border-border rounded-lg p-3 flex items-center gap-3 opacity-50"
              >
                <User className="w-3.5 h-3.5 text-sub" />
                <span className="text-sm text-sub font-medium">{e.member}</span>
                <span className="text-xs text-sub">·</span>
                <span className="text-sm text-sub line-through flex-1">{e.blockers}</span>
                <span className="text-xs text-sub">{e.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function StandupClient() {
  const entries = useWorkspaceStore(useShallow((s) => s.standupEntries ?? []));
  const teamMembers = useWorkspaceStore(useShallow((s) => s.teamMembers ?? []));
  const upsertStandupEntry = useWorkspaceStore((s) => s.upsertStandupEntry);
  const removeStandupEntry = useWorkspaceStore((s) => s.removeStandupEntry);
  const upsertTeamMember = useWorkspaceStore((s) => s.upsertTeamMember);
  const removeTeamMember = useWorkspaceStore((s) => s.removeTeamMember);

  // Roster is unified with the workspace team (shared across tools).
  const members = useMemo(() => teamMembers.map((m) => m.name), [teamMembers]);
  // resolvedBlockers folds into the entity now; derive the id list the
  // subcomponents still consume so their props stay unchanged.
  const resolvedBlockers = useMemo(
    () => entries.filter((e) => e.blockerResolved).map((e) => e.id),
    [entries]
  );

  const addMember = (name: string) => {
    const norm = name.trim().toLowerCase();
    if (!norm) return;
    if (teamMembers.some((m) => m.name.trim().toLowerCase() === norm)) return;
    upsertTeamMember({ id: `member_${crypto.randomUUID()}`, name: name.trim() });
  };
  // Undo brings the member back to the roster (at the end). Owner links the
  // store cleared on removal (stories, OKRs, impediments, canvas cards) stay
  // cleared.
  const removeMember = (name: string) => {
    const norm = name.trim().toLowerCase();
    const tm = teamMembers.find((m) => m.name.trim().toLowerCase() === norm);
    if (!tm) return;
    undoable({
      label: `Removed “${shortName(tm.name)}”`,
      apply: () => removeTeamMember(tm.id),
      revert: () => {
        const back = (useWorkspaceStore.getState().teamMembers ?? []).some((m) => m.id === tm.id);
        if (!back) upsertTeamMember(tm);
      },
    });
  };
  const hasEntry = (member: string, date: string) =>
    entries.some((e) => e.member === member && e.date === date);
  const addEntry = (entry: Omit<StandupEntry, "id" | "timestamp">) =>
    upsertStandupEntry({ ...entry, id: crypto.randomUUID(), timestamp: Date.now() });
  const upsertEntry = (entry: Omit<StandupEntry, "id" | "timestamp">) => {
    const existing = entries.find((e) => e.member === entry.member && e.date === entry.date);
    // Preserve the original id + raise timestamp on edit. The resolved flag
    // carries over ONLY while the blocker text is unchanged — a re-submit
    // that reports a NEW blocker must not be born "resolved" (it would be
    // struck through and vanish from Open Blockers / the KPI / the badge).
    upsertStandupEntry(
      existing
        ? {
            ...entry,
            id: existing.id,
            timestamp: existing.timestamp,
            blockerResolved:
              entry.blockers.trim() === existing.blockers.trim() ? existing.blockerResolved : false,
            // Same for where the blocker was sent: a new blocker starts unsent.
            sentTo:
              entry.blockers.trim() === existing.blockers.trim() ? existing.sentTo : undefined,
          }
        : { ...entry, id: crypto.randomUUID(), timestamp: Date.now() }
    );
  };
  const resolveBlocker = (entryId: string) => {
    const e = entries.find((x) => x.id === entryId);
    if (e) upsertStandupEntry({ ...e, blockerResolved: true });
  };
  // Where a blocker was sent. Reads the entry fresh, so an edit made since
  // the last render isn't overwritten.
  const updateBlockerLinks = (
    entryId: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    const e = (useWorkspaceStore.getState().standupEntries ?? []).find((x) => x.id === entryId);
    if (e) upsertStandupEntry({ ...e, sentTo: update(e.sentTo) });
  };
  const resetRaw = () => useWorkspaceStore.setState({ standupEntries: [] });
  // Example entries are written like any other entry but never logged, so
  // they don't count as a submitted standup in history, XP or streaks. The
  // shared team roster is left alone; clearing removes only example entries.
  const loadExample = () => {
    for (const e of buildExample()) upsertStandupEntry(e);
  };
  const clearExample = () => {
    for (const e of entries) if (isExampleId(e.id)) removeStandupEntry(e.id);
  };
  const { log } = useHistoryLogger("standup");

  // Form state — split into two non-fighting fields: a select for picking an
  // existing team member, and a free-text override for ad-hoc names. The
  // override wins on submit, so typing always beats the dropdown.
  const [formMember, setFormMember] = useState("");
  const [customMemberDraft, setCustomMemberDraft] = useState("");
  const [yesterday, setYesterday] = useState("");
  const [today, setToday] = useState("");
  const [blockers, setBlockers] = useState("");

  // New member input
  const [newMember, setNewMember] = useState("");

  // An entry that would replace one already posted today, held until the
  // user confirms the overwrite. Kept after the dialog closes so its copy
  // doesn't blank out mid exit-animation.
  const [pendingReplace, setPendingReplace] = useState<Omit<
    StandupEntry,
    "id" | "timestamp"
  > | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Submit needs a member AND something to say. Both used to be possible
  // to miss: with a roster but nothing picked the button stayed enabled
  // and silently did nothing, and an all-blank form posted an empty entry.
  // The reason is shown under the disabled button instead.
  const typedMember = customMemberDraft.trim() || formMember.trim();
  const hasContent = Boolean(yesterday.trim() || today.trim() || blockers.trim());
  const submitBlockedReason = !typedMember
    ? "Pick a team member or type a name."
    : !hasContent
      ? "Add at least one update: yesterday, today or a blocker."
      : null;

  const commitEntry = (payload: Omit<StandupEntry, "id" | "timestamp">, replace: boolean) => {
    if (replace) upsertEntry(payload);
    else addEntry(payload);
    log(STANDUP_ACTIONS.ENTRY_ADDED, {
      member: payload.member,
      date: payload.date,
      hasBlocker: payload.blockers.trim().length > 0,
    });
    setYesterday("");
    setToday("");
    setBlockers("");
    setCustomMemberDraft("");
  };

  const handleSubmit = () => {
    // Prior code silently fell back to `members[0]` if both fields were
    // empty — a user who cleared the dropdown and forgot to type a name
    // got their standup posted under whoever was alphabetically first.
    // Require explicit selection. The button is disabled (with the reason
    // shown) in that state; this guard only covers programmatic calls.
    const typed = typedMember;
    if (!typed || !hasContent) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[standup] submit ignored —", submitBlockedReason);
      }
      return;
    }
    // BUG-T8-standup-1: if the user typed a custom name that's not on
    // the roster, ADD them to the roster too. The prior flow posted
    // the entry but left the right-column roster empty of this person,
    // so `missingMembers` didn't include them and the green-dot
    // "submitted today" indicator never appeared.
    //
    // Canonicalize to the ROSTER's casing when a case-insensitive match
    // exists: `addMember` dedupes case-insensitively but everything else
    // (hasEntry, submittedMembers, digests, history filter) matches
    // exactly, so typing "alice" against a roster "Alice" used to split
    // one person into two identities (double entries, wrong green dot).
    const norm = typed.toLowerCase();
    const rosterMatch = teamMembers.find((m) => m.name.trim().toLowerCase() === norm);
    const member = rosterMatch ? rosterMatch.name.trim() : typed;
    if (!rosterMatch) {
      addMember(member);
    }
    const date = todayStr();
    const payload = { member, date, yesterday, today, blockers };
    if (hasEntry(member, date)) {
      // Ask before replacing today's entry; the form keeps its values if
      // the user backs out.
      setPendingReplace(payload);
      setConfirmReplaceOpen(true);
      return;
    }
    commitEntry(payload, false);
  };

  const reset = () => {
    resetRaw();
    log(STANDUP_ACTIONS.STANDUP_RESET, {});
  };
  // Clearing wipes every day's entries, so confirm first (with the count),
  // then offer Undo — unless there is nothing to lose.
  const requestReset = () => {
    if (entries.length === 0) reset();
    else setConfirmClearOpen(true);
  };
  const confirmReset = () => {
    const cleared = useWorkspaceStore.getState().standupEntries ?? [];
    undoable({
      label: `Deleted ${cleared.length} standup ${cleared.length === 1 ? "entry" : "entries"}`,
      apply: reset,
      // Entries posted since the clear are kept, and win over a restored
      // entry for the same member and day (one entry per member per day).
      revert: () =>
        useWorkspaceStore.setState((s) => {
          const now = s.standupEntries ?? [];
          const taken = new Set(now.map((e) => `${e.date} ${e.member}`));
          const restored = cleared.filter((e) => !taken.has(`${e.date} ${e.member}`));
          return { standupEntries: [...restored, ...now] };
        }),
    });
  };

  /* -- CSV export of all entries ------------------------------------------ */
  const csvData = useMemo(
    () => ({
      headers: ["Date", "Member", "Yesterday", "Today", "Blockers"],
      rows: [...entries]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((e) => [e.date, e.member, e.yesterday, e.today, e.blockers]),
    }),
    [entries]
  );

  /* -- Weekly digest text -------------------------------------------------- */
  const weeklyDigest = useMemo(() => generateWeeklyDigest(entries), [entries]);

  /* -- Today's standup as Markdown ----------------------------------------- */
  const markdown = useMemo(() => toMarkdown(entries), [entries]);

  /* -- AI prompt config --------------------------------------------------- */
  const promptConfig = useMemo(
    () => ({
      toolName: "Daily Standup",
      prompts: generateStandupPrompts({ entries, members, resolvedBlockers }),
    }),
    [entries, members, resolvedBlockers]
  );

  // ── Cross-tool signal: blocker activity from impediments tool ────────
  // Counts blockers raised in the last 7 days so the standup facilitator
  // sees external activity at a glance. Subscribes to the history store's
  // events array so external logging is picked up.
  const events = useHistoryStore((s) => s.events);
  const recentBlockerCount = useMemo(
    () =>
      selectEvents({
        toolId: "impediments",
        action: "impediment_raised",
        sinceDays: 7,
        limit: 100,
      }).length,
    [events]
  );

  return (
    <ToolPageWrapper
      toolId="standup"
      title="Standup Tracker"
      description="Log daily standups, track blockers, and generate digests for async teams."
      category="Ceremonies"
    >
      {hasExampleItems(entries) && <ExampleNotice onClear={clearExample} />}
      <div className="space-y-6">
        {/* ---- Top controls ---- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-sub">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {todayStr()}
            </div>
            {recentBlockerCount > 0 && (
              <Badge
                className="bg-danger/15 text-danger border-danger/30 gap-1.5"
                title="Blockers logged in the Impediments tool in the last 7 days. Bring these up during standup."
              >
                <AlertTriangle className="w-3 h-3" />
                Recent blocker activity: {recentBlockerCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="danger-ghost" size="sm" onClick={requestReset}>
              Clear Entries
            </Button>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="standup-all"
              csvData={csvData}
              clipboardText={weeklyDigest}
              markdown={markdown}
            />
          </div>
        </div>

        {/* ---- Two-column layout: form + team ---- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Entry form */}
          <div className="lg:col-span-2">
            <SectionCard
              title="Today's Standup"
              icon={Mic}
              titleSize="lg"
              className="h-full"
              headerClassName="pb-4"
              contentClassName="space-y-4"
            >
              {/* Member selector */}
              <div>
                <label
                  htmlFor="standup-member"
                  className="text-xs text-sub uppercase tracking-wider mb-1.5 block"
                >
                  Team member
                </label>
                <div className="flex gap-2">
                  <select
                    id="standup-member"
                    value={formMember}
                    onChange={(e) => {
                      setFormMember(e.target.value);
                      // Picking from the dropdown clears any ad-hoc draft so
                      // the picked name takes effect immediately.
                      if (e.target.value) setCustomMemberDraft("");
                    }}
                    className="flex-1 bg-surface-deep border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="">Select member…</option>
                    {members.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="Or type name"
                    aria-label="Or type a team member name"
                    value={customMemberDraft}
                    onChange={(e) => setCustomMemberDraft(e.target.value)}
                    className="flex-1 input-toolkit"
                  />
                </div>
              </div>

              {/* Yesterday */}
              <div>
                <label
                  htmlFor="standup-yesterday"
                  className="text-xs text-sub uppercase tracking-wider mb-1.5 block"
                >
                  Yesterday
                </label>
                <Textarea
                  id="standup-yesterday"
                  value={yesterday}
                  onChange={(e) => setYesterday(e.target.value)}
                  placeholder="What did you complete yesterday?"
                  rows={2}
                  className="input-toolkit resize-none"
                />
              </div>

              {/* Today */}
              <div>
                <label
                  htmlFor="standup-today"
                  className="text-xs text-sub uppercase tracking-wider mb-1.5 block"
                >
                  Today
                </label>
                <Textarea
                  id="standup-today"
                  value={today}
                  onChange={(e) => setToday(e.target.value)}
                  placeholder="What will you work on today?"
                  rows={2}
                  className="input-toolkit resize-none"
                />
              </div>

              {/* Blockers */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label
                    htmlFor="standup-blockers"
                    className="text-xs text-sub uppercase tracking-wider"
                  >
                    Blockers
                  </label>
                  {blockers.trim() && (
                    <span className="inline-flex items-center gap-1 text-danger text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      Will be flagged
                    </span>
                  )}
                </div>
                <Textarea
                  id="standup-blockers"
                  value={blockers}
                  onChange={(e) => setBlockers(e.target.value)}
                  placeholder="Any impediments or blockers? (leave blank if none)"
                  rows={2}
                  className={`bg-surface-deep border-border text-text resize-none focus:border-accent/50 ${
                    blockers.trim() ? "border-danger/40 focus:border-danger/60" : ""
                  }`}
                />
              </div>

              <div className="space-y-1.5">
                <Button
                  variant="toolkit"
                  onClick={handleSubmit}
                  disabled={submitBlockedReason !== null}
                  aria-describedby={submitBlockedReason ? "standup-submit-hint" : undefined}
                  className="w-full"
                >
                  Submit Standup
                </Button>
                {submitBlockedReason && (
                  <p id="standup-submit-hint" className="text-xs text-sub text-center">
                    {submitBlockedReason}
                  </p>
                )}
                {entries.length === 0 && (
                  <div className="flex justify-center pt-1">
                    <LoadExampleButton onLoad={loadExample} />
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Team members */}
          <div>
            <SectionCard
              title="Team Members"
              icon={FileText}
              headerClassName="pb-4"
              contentClassName="space-y-3"
            >
              {/* Add member */}
              <div className="flex gap-2">
                <Input
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newMember.trim()) {
                      addMember(newMember.trim());
                      setNewMember("");
                    }
                  }}
                  placeholder="Add member…"
                  aria-label="New team member name"
                  className="input-toolkit text-sm"
                />
                <Button
                  size="icon"
                  variant="toolkit"
                  onClick={() => {
                    if (newMember.trim()) {
                      addMember(newMember.trim());
                      setNewMember("");
                    }
                  }}
                  className="shrink-0"
                  aria-label="Add member"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>

              {/* Member list */}
              <div className="space-y-1.5">
                {members.map((m) => {
                  const submittedToday = entries.some(
                    (e) => e.member === m && e.date === todayStr()
                  );
                  return (
                    <div
                      key={m}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-card border border-border"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            submittedToday ? "bg-[#22c55e]" : "bg-card-hover"
                          }`}
                        />
                        <span className="text-sm text-text">{m}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMember(m)}
                        className="text-sub hover:text-danger transition-colors min-touch-coarse inline-flex items-center justify-center"
                        aria-label={`Remove ${m}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {members.length === 0 && (
                  <p className="text-xs text-sub text-center py-3">No members yet</p>
                )}
              </div>

              {/* Weekly digest button */}
              <div className="pt-2 border-t border-border">
                <ExportButton filename="weekly-digest" clipboardText={weeklyDigest} />
              </div>
            </SectionCard>
          </div>
        </div>

        {/* ---- Tabs ---- */}
        <Tabs defaultValue="today">
          <TabsList className="bg-surface-deep border border-border h-10">
            <TabsTrigger
              value="today"
              className="data-[state=active]:bg-surface data-[state=active]:text-text text-sub"
            >
              Today
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-surface data-[state=active]:text-text text-sub"
            >
              History
            </TabsTrigger>
            <TabsTrigger
              value="blockers"
              className="data-[state=active]:bg-surface data-[state=active]:text-text text-sub"
            >
              Blockers
              {entries.filter((e) => e.blockers.trim() && !resolvedBlockers.includes(e.id)).length >
                0 && (
                <span className="ml-1.5 bg-[#ef4444] text-white text-xs rounded-full w-4 h-4 inline-flex items-center justify-center font-data">
                  {
                    entries.filter((e) => e.blockers.trim() && !resolvedBlockers.includes(e.id))
                      .length
                  }
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-4">
            <TodayTab
              entries={entries}
              members={members}
              resolvedBlockers={resolvedBlockers}
              onResolve={resolveBlocker}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryTab entries={entries} members={members} />
          </TabsContent>

          <TabsContent value="blockers" className="mt-4">
            <BlockersTab
              entries={entries}
              resolvedBlockers={resolvedBlockers}
              onResolve={resolveBlocker}
              onLinksChange={updateBlockerLinks}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title={`Delete all ${entries.length} standup ${entries.length === 1 ? "entry" : "entries"}?`}
        description="Every day's entries and blockers will be removed. Team members stay on the roster."
        confirmLabel="Delete entries"
        onConfirm={confirmReset}
      />
      <ConfirmDialog
        open={confirmReplaceOpen}
        onOpenChange={setConfirmReplaceOpen}
        title={`Replace ${pendingReplace?.member ?? ""}'s standup?`}
        description={`${pendingReplace?.member ?? "This member"} already submitted a standup for ${pendingReplace?.date ?? "today"}. Submitting again replaces that entry.`}
        confirmLabel="Replace entry"
        onConfirm={() => {
          if (pendingReplace) commitEntry(pendingReplace, true);
        }}
      />
    </ToolPageWrapper>
  );
}
