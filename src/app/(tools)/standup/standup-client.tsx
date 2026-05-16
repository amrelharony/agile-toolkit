"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateStandupPrompts } from "@/lib/ai-prompts/standup";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STANDUP_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
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

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface StandupEntry {
  id: string;
  member: string;
  date: string; // YYYY-MM-DD
  yesterday: string;
  today: string;
  blockers: string;
  timestamp: number;
}

interface StandupStore {
  members: string[];
  entries: StandupEntry[];
  addMember: (name: string) => void;
  removeMember: (name: string) => void;
  addEntry: (entry: Omit<StandupEntry, "id" | "timestamp">) => void;
  /**
   * Returns true if an entry with the same (member, date) already exists.
   * Lets the form prompt the user before overwriting.
   */
  hasEntry: (member: string, date: string) => boolean;
  /**
   * Replaces the existing (member, date) entry with the new content; falls
   * back to addEntry behavior if no match is found.
   */
  upsertEntry: (entry: Omit<StandupEntry, "id" | "timestamp">) => void;
  resolveBlocker: (entryId: string) => void;
  resolvedBlockers: string[]; // entry IDs whose blockers are resolved
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useStandupStore = create<StandupStore>()(
  persist(
    (set, get) => ({
      members: ["Alice", "Bob", "Carol"],
      entries: [],
      resolvedBlockers: [],

      addMember: (name) =>
        set((s) => ({
          members: s.members.includes(name) ? s.members : [...s.members, name],
        })),

      removeMember: (name) =>
        set((s) => ({ members: s.members.filter((m) => m !== name) })),

      addEntry: (entry) =>
        set((s) => ({
          entries: [
            ...s.entries,
            { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
          ],
        })),

      hasEntry: (member, date) =>
        get().entries.some((e) => e.member === member && e.date === date),

      upsertEntry: (entry) =>
        set((s) => {
          const idx = s.entries.findIndex(
            (e) => e.member === entry.member && e.date === entry.date
          );
          if (idx === -1) {
            return {
              entries: [
                ...s.entries,
                { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
              ],
            };
          }
          // Preserve the original id so blocker resolution / history references
          // stay valid; refresh the timestamp to mark the latest update.
          const next = s.entries.slice();
          next[idx] = {
            ...entry,
            id: s.entries[idx].id,
            timestamp: Date.now(),
          };
          return { entries: next };
        }),

      resolveBlocker: (entryId) =>
        set((s) => ({
          resolvedBlockers: s.resolvedBlockers.includes(entryId)
            ? s.resolvedBlockers
            : [...s.resolvedBlockers, entryId],
        })),

      reset: () => set({ entries: [], resolvedBlockers: [] }),
    }),
    { name: "agile-toolkit:standup", storage: safeJSONStorage("standup") }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function todayStr() {
  return todayLocalISO();
}

function ageLabel(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "< 1 day";
  if (hours < 72) return `${Math.floor(hours / 24)}d`;
  return `${Math.floor(hours / 24)}d`;
}

function ageColor(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "text-[#22c55e]";
  if (hours < 72) return "text-[#eab308]";
  return "text-[#ef4444]";
}

function ageBg(timestamp: number) {
  const hours = (Date.now() - timestamp) / 3600_000;
  if (hours < 24) return "border-[#22c55e]/30 bg-[#22c55e]/5";
  if (hours < 72) return "border-[#eab308]/30 bg-[#eab308]/5";
  return "border-[#ef4444]/30 bg-[#ef4444]/5";
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
            <Badge className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30 gap-1">
              <AlertTriangle className="w-3 h-3" />
              Blocker
            </Badge>
          )}
          {isResolved && (
            <Badge className="bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30 gap-1">
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
              isResolved ? "border-border bg-card" : "border-[#ef4444]/30 bg-[#ef4444]/5"
            }`}
          >
            <p className="text-xs text-sub mb-1 uppercase tracking-wider">Blockers</p>
            <p
              className={`text-sm ${
                isResolved ? "text-sub line-through" : "text-[#ef4444]"
              }`}
            >
              {entry.blockers}
            </p>
            {!isResolved && (
              <button
                onClick={onResolve}
                className="mt-2 text-xs text-[#22c55e] hover:underline flex items-center gap-1"
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
          <p className="text-2xl font-data font-bold text-accent">
            {todayEntries.length}
          </p>
          <p className="text-xs text-sub mt-0.5">Submitted</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <p className="text-2xl font-data font-bold text-[#eab308]">
            {missingMembers.length}
          </p>
          <p className="text-xs text-sub mt-0.5">Missing</p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 text-center">
          <p className="text-2xl font-data font-bold text-[#ef4444]">
            {
              todayEntries.filter(
                (e) =>
                  e.blockers.trim() &&
                  !resolvedBlockers.includes(e.id)
              ).length
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
          <p className="text-xs text-sub uppercase tracking-wider">
            Not yet submitted
          </p>
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

function HistoryTab({
  entries,
  members,
}: {
  entries: StandupEntry[];
  members: string[];
}) {
  const [filterMember, setFilterMember] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());

  const allDates = useMemo(
    () =>
      Array.from(new Set(entries.map((e) => e.date))).sort((a, b) =>
        b.localeCompare(a)
      ),
    [entries]
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.date === selectedDate &&
          (filterMember === "all" || e.member === filterMember)
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
            className="bg-surface-deep border border-border rounded-md px-3 py-1.5 text-sm text-text focus:border-accent/50 focus:outline-none"
          >
            {allDates.length === 0 ? (
              <option value={todayStr()}>{todayStr()}</option>
            ) : (
              allDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-sub" />
          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            className="bg-surface-deep border border-border rounded-md px-3 py-1.5 text-sm text-text focus:border-accent/50 focus:outline-none"
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
          <ExportButton
            filename={`standup-${selectedDate}`}
            clipboardText={digestText}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">Member</th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">Yesterday</th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4">Today</th>
                <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3">Blockers</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 text-text font-medium whitespace-nowrap">{e.member}</td>
                  <td className="py-3 pr-4 text-sub max-w-xs">{e.yesterday || <span className="opacity-40">—</span>}</td>
                  <td className="py-3 pr-4 text-sub max-w-xs">{e.today || <span className="opacity-40">—</span>}</td>
                  <td className="py-3 text-sub max-w-xs">
                    {e.blockers ? (
                      <span className="text-[#ef4444]">{e.blockers}</span>
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

function BlockersTab({
  entries,
  resolvedBlockers,
  onResolve,
}: {
  entries: StandupEntry[];
  resolvedBlockers: string[];
  onResolve: (id: string) => void;
}) {
  const blockerEntries = useMemo(
    () =>
      entries
        .filter((e) => e.blockers.trim() && !resolvedBlockers.includes(e.id))
        .sort((a, b) => a.timestamp - b.timestamp),
    [entries, resolvedBlockers]
  );

  const resolvedEntries = useMemo(
    () =>
      entries.filter(
        (e) => e.blockers.trim() && resolvedBlockers.includes(e.id)
      ),
    [entries, resolvedBlockers]
  );

  return (
    <div className="space-y-6">
      {/* Open blockers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-[#ef4444]" />
          <h3 className="text-sm font-medium text-text uppercase tracking-wider">
            Open Blockers
          </h3>
          {blockerEntries.length > 0 && (
            <Badge className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30">
              {blockerEntries.length}
            </Badge>
          )}
        </div>

        {blockerEntries.length === 0 ? (
          <div className="text-center py-8 text-sub text-sm bg-surface border border-border rounded-lg">
            <CheckCircle2 className="w-8 h-8 text-[#22c55e] mx-auto mb-2 opacity-60" />
            No open blockers — all clear!
          </div>
        ) : (
          <div className="space-y-3">
            {blockerEntries.map((e) => (
              <div
                key={e.id}
                className={`border rounded-lg p-4 ${ageBg(e.timestamp)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-3.5 h-3.5 text-sub shrink-0" />
                      <span className="font-medium text-text text-sm">
                        {e.member}
                      </span>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onResolve(e.id)}
                    className="shrink-0 text-[#22c55e] hover:text-[#22c55e] hover:bg-[#22c55e]/10 gap-1.5 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Resolve
                  </Button>
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
            <CheckCircle2 className="w-4 h-4 text-[#22c55e]" />
            <h3 className="text-sm font-medium text-sub uppercase tracking-wider">
              Resolved
            </h3>
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
                <span className="text-sm text-sub line-through flex-1">
                  {e.blockers}
                </span>
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
  const {
    members,
    entries,
    resolvedBlockers,
    addMember,
    removeMember,
    addEntry,
    hasEntry,
    upsertEntry,
    resolveBlocker,
    reset: resetRaw,
  } = useStandupStore();
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

  const handleSubmit = () => {
    const member =
      customMemberDraft.trim() || formMember.trim() || members[0] || "";
    if (!member) return;
    const date = todayStr();
    const payload = { member, date, yesterday, today, blockers };
    if (hasEntry(member, date)) {
      const overwrite =
        typeof window === "undefined"
          ? true
          : window.confirm(
              `${member} already submitted standup for ${date}. Replace the existing entry?`
            );
      if (!overwrite) return;
      upsertEntry(payload);
    } else {
      addEntry(payload);
    }
    log(STANDUP_ACTIONS.ENTRY_ADDED, {
      member,
      date,
      hasBlocker: blockers.trim().length > 0,
    });
    setYesterday("");
    setToday("");
    setBlockers("");
    setCustomMemberDraft("");
  };

  const reset = () => {
    resetRaw();
    log(STANDUP_ACTIONS.STANDUP_RESET, {});
  };

  /* -- CSV export of all entries ------------------------------------------ */
  const csvData = useMemo(() => ({
    headers: ["Date", "Member", "Yesterday", "Today", "Blockers"],
    rows: [...entries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((e) => [e.date, e.member, e.yesterday, e.today, e.blockers]),
  }), [entries]);

  /* -- Weekly digest text -------------------------------------------------- */
  const weeklyDigest = useMemo(() => generateWeeklyDigest(entries), [entries]);

  /* -- AI prompt config --------------------------------------------------- */
  const promptConfig = useMemo(() => ({
    toolName: "Daily Standup",
    prompts: generateStandupPrompts({ entries, members, resolvedBlockers }),
  }), [entries, members, resolvedBlockers]);

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
                className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30 gap-1.5"
                title="Blockers logged in the Impediments tool in the last 7 days. Bring these up during standup."
              >
                <AlertTriangle className="w-3 h-3" />
                Recent blocker activity: {recentBlockerCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="danger-ghost"
              size="sm"
              onClick={reset}
            >
              Clear Entries
            </Button>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="standup-all"
              csvData={csvData}
              clipboardText={weeklyDigest}
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
                  <label className="text-xs text-sub uppercase tracking-wider mb-1.5 block">
                    Team member
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={formMember}
                      onChange={(e) => {
                        setFormMember(e.target.value);
                        // Picking from the dropdown clears any ad-hoc draft so
                        // the picked name takes effect immediately.
                        if (e.target.value) setCustomMemberDraft("");
                      }}
                      className="flex-1 bg-surface-deep border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent/50 focus:outline-none"
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
                      value={customMemberDraft}
                      onChange={(e) => setCustomMemberDraft(e.target.value)}
                      className="flex-1 input-toolkit"
                    />
                  </div>
                </div>

                {/* Yesterday */}
                <div>
                  <label className="text-xs text-sub uppercase tracking-wider mb-1.5 block">
                    Yesterday
                  </label>
                  <Textarea
                    value={yesterday}
                    onChange={(e) => setYesterday(e.target.value)}
                    placeholder="What did you complete yesterday?"
                    rows={2}
                    className="input-toolkit resize-none"
                  />
                </div>

                {/* Today */}
                <div>
                  <label className="text-xs text-sub uppercase tracking-wider mb-1.5 block">
                    Today
                  </label>
                  <Textarea
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
                    <span className="text-xs text-sub uppercase tracking-wider">
                      Blockers
                    </span>
                    {blockers.trim() && (
                      <span className="inline-flex items-center gap-1 text-[#ef4444] text-xs">
                        <AlertTriangle className="w-3 h-3" />
                        Will be flagged
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={blockers}
                    onChange={(e) => setBlockers(e.target.value)}
                    placeholder="Any impediments or blockers? (leave blank if none)"
                    rows={2}
                    className={`bg-surface-deep border-border text-text resize-none focus:border-accent/50 ${
                      blockers.trim()
                        ? "border-[#ef4444]/40 focus:border-[#ef4444]/60"
                        : ""
                    }`}
                  />
                </div>

                <Button
                  variant="toolkit"
                  onClick={handleSubmit}
                  disabled={
                    !customMemberDraft.trim() &&
                    !formMember.trim() &&
                    members.length === 0
                  }
                  className="w-full"
                >
                  Submit Standup
                </Button>
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
                  >
                    <Plus className="w-4 h-4" />
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
                          onClick={() => removeMember(m)}
                          className="text-sub hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {members.length === 0 && (
                    <p className="text-xs text-sub text-center py-3">
                      No members yet
                    </p>
                  )}
                </div>

                {/* Weekly digest button */}
                <div className="pt-2 border-t border-border">
                  <ExportButton
                    filename="weekly-digest"
                    clipboardText={weeklyDigest}
                  />
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
              {entries.filter(
                (e) =>
                  e.blockers.trim() && !resolvedBlockers.includes(e.id)
              ).length > 0 && (
                <span className="ml-1.5 bg-[#ef4444] text-white text-xs rounded-full w-4 h-4 inline-flex items-center justify-center font-data">
                  {
                    entries.filter(
                      (e) =>
                        e.blockers.trim() && !resolvedBlockers.includes(e.id)
                    ).length
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
            />
          </TabsContent>
        </Tabs>
      </div>
    </ToolPageWrapper>
  );
}
