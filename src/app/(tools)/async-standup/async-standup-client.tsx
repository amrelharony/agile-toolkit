"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Plus, Trash2, AlertTriangle, Users, Calendar, FileDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AsyncUpdate } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ASYNC_STANDUP_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { Badge } from "@/components/ui/badge";
import { generateAsyncStandupPrompts } from "@/lib/ai-prompts/async-standup";
import { todayLocalISO } from "@/lib/utils/formatters";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

/** Flatten user-typed newlines so they don't break a markdown bullet's
 * single-line layout when copied to Slack/email. */
function singleLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

function buildDigestMarkdown(updates: AsyncUpdate[], date: string): string {
  const todayUpdates = updates.filter((u) => u.date === date);
  if (todayUpdates.length === 0) {
    return `# Async Standup — ${date}\n\nNo updates posted today.`;
  }
  const lines: string[] = [`# Async Standup — ${date}`, ""];
  const blocked = todayUpdates.filter((u) => u.blockers && u.blockers.trim().length > 0);
  if (blocked.length > 0) {
    lines.push("## Blockers");
    for (const u of blocked) {
      lines.push(`- **${u.member}**: ${singleLine(u.blockers ?? "")}`);
    }
    lines.push("");
  }
  // Group by member.
  const byMember = new Map<string, AsyncUpdate[]>();
  for (const u of todayUpdates) {
    const list = byMember.get(u.member) ?? [];
    list.push(u);
    byMember.set(u.member, list);
  }
  for (const [member, ms] of Array.from(byMember.entries())) {
    lines.push(`## ${member}`);
    for (const u of ms) {
      if (u.yesterday.trim()) lines.push(`- **Yesterday**: ${singleLine(u.yesterday)}`);
      if (u.today.trim()) lines.push(`- **Today**: ${singleLine(u.today)}`);
      if (u.blockers && u.blockers.trim()) lines.push(`- **Blockers**: ${singleLine(u.blockers)}`);
      if (u.description) lines.push(`- ${singleLine(u.description)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Build a 14-day window of dates ending on `endISO`, oldest-first. */
function last14Days(endISO: string): string[] {
  const result: string[] = [];
  const end = new Date(`${endISO}T00:00:00`);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    result.push(todayLocalISO(d));
  }
  return result;
}

export function AsyncStandupClient() {
  const updates = useWorkspaceStore(useShallow((s) => s.asyncUpdates ?? []));
  const upsertAsyncUpdate = useWorkspaceStore((s) => s.upsertAsyncUpdate);
  const removeAsyncUpdate = useWorkspaceStore((s) => s.removeAsyncUpdate);
  const { log } = useHistoryLogger("async-standup");

  const [member, setMember] = useState("");
  const [yesterday, setYesterday] = useState("");
  const [today, setToday] = useState("");
  const [blockers, setBlockers] = useState("");
  const [description, setDescription] = useState("");

  // Re-render every minute so `todayISO` rolls over at midnight without
  // requiring a page reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayISO = todayLocalISO();

  const todaysUpdates = useMemo(
    () => updates.filter((u) => u.date === todayISO),
    [updates, todayISO]
  );

  const blockerUpdates = useMemo(
    () => todaysUpdates.filter((u) => u.blockers && u.blockers.trim().length > 0),
    [todaysUpdates]
  );

  const membersToday = useMemo(
    () => new Set(todaysUpdates.map((u) => u.member)).size,
    [todaysUpdates]
  );

  const last14 = useMemo(() => last14Days(todayISO), [todayISO]);
  const updatesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of updates) {
      map.set(u.date, (map.get(u.date) ?? 0) + 1);
    }
    return map;
  }, [updates]);
  const avgPerDay = useMemo(() => {
    const totalsInWindow = last14.reduce((acc, d) => acc + (updatesByDay.get(d) ?? 0), 0);
    return totalsInWindow / last14.length;
  }, [last14, updatesByDay]);

  const groupedByMemberToday = useMemo(() => {
    const map = new Map<string, AsyncUpdate[]>();
    for (const u of todaysUpdates) {
      const list = map.get(u.member) ?? [];
      list.push(u);
      map.set(u.member, list);
    }
    return map;
  }, [todaysUpdates]);

  const addUpdate = () => {
    if (!member.trim()) return;
    const id = crypto.randomUUID();
    const desc = description.trim();
    const blk = blockers.trim();
    // Recompute today's date here so an update posted moments after midnight
    // is filed on the correct day even if the render closure was stale.
    const dateNow = todayLocalISO();
    const upd: AsyncUpdate = {
      id,
      member: member.trim(),
      date: dateNow,
      yesterday: yesterday.trim(),
      today: today.trim(),
      blockers: blk.length > 0 ? blk : undefined,
      description: desc.length > 0 ? desc : undefined,
    };
    upsertAsyncUpdate(upd);
    log(ASYNC_STANDUP_ACTIONS.UPDATE_POSTED, {
      updateId: id,
      member: upd.member,
      date: upd.date,
      hasBlockers: Boolean(upd.blockers),
      description: upd.description,
    });
    setYesterday("");
    setToday("");
    setBlockers("");
    setDescription("");
  };

  const removeUpdate = (id: string) => {
    const u = updates.find((x) => x.id === id);
    removeAsyncUpdate(id);
    log(ASYNC_STANDUP_ACTIONS.UPDATE_REMOVED, {
      updateId: id,
      member: u?.member,
      date: u?.date,
    });
  };

  const generateDigest = async () => {
    // Recompute "today" so a digest generated right after midnight uses the
    // current local day rather than the day rendered by a stale closure.
    const dateNow = todayLocalISO();
    const todaysNow = updates.filter((u) => u.date === dateNow);
    const blockersNow = todaysNow.filter((u) => u.blockers && u.blockers.trim().length > 0);
    const md = buildDigestMarkdown(updates, dateNow);
    const ok = await copyToClipboard(md);
    if (ok) toast.success("Digest copied to clipboard");
    else toast.error("Failed to copy digest");
    log(ASYNC_STANDUP_ACTIONS.DIGEST_GENERATED, {
      date: dateNow,
      updateCount: todaysNow.length,
      blockerCount: blockersNow.length,
    });
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Async Standup Digest",
      prompts: generateAsyncStandupPrompts({ updates }),
    }),
    [updates]
  );

  // ── Cross-tool signal: blockers raised in the impediments tool ────────
  // Renders inline with the digest header so async readers see the
  // blocker pulse without opening another tab. Subscribes to the history
  // store so external logging is reflected immediately.
  const events = useHistoryStore((s) => s.events);
  const recentImpedimentCount = useMemo(
    () =>
      selectEvents({
        toolId: "impediments",
        action: "impediment_raised",
        sinceDays: 7,
        limit: 100,
      }).length,
    [events]
  );

  const csvData = useMemo(
    () => ({
      headers: ["Date", "Member", "Yesterday", "Today", "Blockers", "Description"],
      rows: updates.map((u) => [
        u.date,
        u.member,
        u.yesterday,
        u.today,
        u.blockers ?? "",
        u.description ?? "",
      ]),
    }),
    [updates]
  );

  return (
    <ToolPageWrapper
      toolId="async-standup"
      title="Async Standup Digest"
      description="Async-first standup with auto-generated daily digest and blocker rollup."
      category="Ceremonies"
    >
      <ActionRow>
        <Button
          variant="outline"
          size="sm"
          onClick={generateDigest}
          className="gap-2 border-border hover:border-accent/40 hover:bg-accent/5 text-sub hover:text-accent"
        >
          <FileDown className="w-4 h-4" aria-hidden="true" />
          Generate Digest
        </Button>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="async-standup" csvData={csvData} jsonData={updates} />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Mail}
          label="Today's updates"
          value={todaysUpdates.length}
          valueClassName="text-accent"
        />
        <StatCard variant="compact" icon={Users} label="Members today" value={membersToday} />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Blockers"
          value={blockerUpdates.length}
          tone={blockerUpdates.length > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Calendar}
          label="Avg / day"
          value={avgPerDay.toFixed(1)}
          hint="last 14 days"
        />
      </KpiGrid>

      {blockerUpdates.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>Blockers today:</strong>{" "}
          {blockerUpdates.map((u) => `${u.member} — ${u.blockers ?? ""}`.slice(0, 80)).join(" · ")}
        </CalloutAlert>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-sub mb-3">
          Post update for {todayISO}
        </div>
        <div className="space-y-2">
          <Input
            value={member}
            onChange={(e) => setMember(e.target.value)}
            placeholder="Member name"
            className="bg-bg border-border text-sm"
            aria-label="Member name"
          />
          <Textarea
            value={yesterday}
            onChange={(e) => setYesterday(e.target.value)}
            placeholder="Yesterday..."
            rows={2}
            className="bg-bg border-border text-sm resize-none"
            aria-label="Yesterday"
          />
          <Textarea
            value={today}
            onChange={(e) => setToday(e.target.value)}
            placeholder="Today..."
            rows={2}
            className="bg-bg border-border text-sm resize-none"
            aria-label="Today"
          />
          <Textarea
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Blockers (optional)..."
            rows={2}
            className="bg-bg border-border text-sm resize-none"
            aria-label="Blockers"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description / extra context (optional)..."
            rows={2}
            className="bg-bg border-border text-sm resize-none"
            aria-label="Description"
          />
          <div className="flex justify-end">
            <Button
              onClick={addUpdate}
              disabled={!member.trim()}
              className="gap-2 bg-accent text-bg hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Post update
            </Button>
          </div>
        </div>
      </div>

      {/* 14-day calendar */}
      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-sub">Last 14 days</div>
          <div className="text-xs text-sub">Darker = more updates that day</div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {last14.map((d) => {
            const count = updatesByDay.get(d) ?? 0;
            const isToday = d === todayISO;
            const intensity = Math.min(1, count / 5);
            const bg =
              count === 0
                ? "rgba(255,255,255,0.04)"
                : `rgba(0, 240, 255, ${0.12 + 0.55 * intensity})`;
            return (
              <div
                key={d}
                className="rounded-md p-2 text-center border border-border"
                style={{
                  background: bg,
                  outline: isToday ? "1px solid var(--accent)" : undefined,
                }}
                title={`${d}: ${count} update${count === 1 ? "" : "s"}`}
              >
                <div className="text-[10px] text-sub font-data">{d.slice(5)}</div>
                <div className="font-data text-sm text-text">{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's digest preview */}
      {todaysUpdates.length === 0 ? (
        <EmptyState icon={Mail}>
          No updates posted for {todayISO} yet. Post your first one above.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-xs uppercase tracking-wider text-sub">Today&apos;s digest</div>
            {recentImpedimentCount > 0 && (
              <Badge
                className="bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30 gap-1.5 text-[10px]"
                title="Blockers raised in the Impediments tool in the last 7 days. Surface them in your digest."
              >
                <AlertTriangle className="w-3 h-3" />
                {recentImpedimentCount} blocker{recentImpedimentCount === 1 ? "" : "s"} raised (7d)
              </Badge>
            )}
          </div>
          {Array.from(groupedByMemberToday.entries()).map(([m, list]) => (
            <div key={m} className="rounded-lg border border-border bg-surface p-3">
              <div className="text-sm font-medium text-text mb-2">{m}</div>
              <div className="space-y-2">
                {list.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-md border border-border bg-bg p-2 text-xs space-y-1"
                  >
                    {u.yesterday && (
                      <div>
                        <span className="text-sub">Yesterday: </span>
                        <span className="text-text">{u.yesterday}</span>
                      </div>
                    )}
                    {u.today && (
                      <div>
                        <span className="text-sub">Today: </span>
                        <span className="text-text">{u.today}</span>
                      </div>
                    )}
                    {u.blockers && (
                      <div>
                        <span className="text-danger">Blockers: </span>
                        <span className="text-text">{u.blockers}</span>
                      </div>
                    )}
                    {u.description && (
                      <div className="text-sub whitespace-pre-wrap">{u.description}</div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeUpdate(u.id)}
                        className="min-touch-coarse h-6 w-6 p-0 text-sub hover:text-danger"
                        aria-label="Remove update"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ToolPageWrapper>
  );
}
