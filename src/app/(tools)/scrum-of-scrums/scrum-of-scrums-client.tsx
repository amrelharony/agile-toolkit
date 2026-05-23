"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, GitBranch } from "lucide-react";
import { generateScrumOfScrumsPrompts } from "@/lib/ai-prompts/scrum-of-scrums";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SCRUM_OF_SCRUMS_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";

type EntryKind = "blocker" | "dependency" | "decision" | "update";

interface SosEntry {
  id: string;
  meetingDate: string;
  team: string;
  kind: EntryKind;
  text: string;
  blockedBy?: string;
  status: "open" | "resolved";
  resolvedAt?: string;
}

const KIND_COLORS: Record<EntryKind, string> = {
  blocker: "#ef4444",
  dependency: "#f59e0b",
  decision: "#a855f7",
  update: "#00f0ff",
};

function empty(): SosEntry {
  return {
    id: nanoid(),
    meetingDate: todayLocalISO(),
    team: "",
    kind: "update",
    text: "",
    status: "open",
  };
}

function ageDays(e: SosEntry): number | null {
  // Guard against malformed meetingDate (manual import, schema drift). NaN
  // would bleed into the staleBlockers filter and the rendered "age Nd" pill.
  const t = new Date(e.meetingDate).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

export function ScrumOfScrumsClient() {
  const [entries, setEntries] = usePersisted<SosEntry[]>("agile-toolkit:scrum-of-scrums", []);
  const [draft, setDraft] = useState<SosEntry>(() => empty());
  const { log } = useHistoryLogger("scrum-of-scrums");

  const add = () => {
    if (!draft.text.trim() || !draft.team.trim()) return;
    setEntries((s) => [draft, ...s]);
    if (draft.kind === "blocker") {
      log(SCRUM_OF_SCRUMS_ACTIONS.IMPEDIMENT_RAISED, {
        team: draft.team,
        text: draft.text,
      });
    } else {
      log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_ADDED, {
        team: draft.team,
        kind: draft.kind,
      });
    }
    setDraft(empty());
  };
  const update = (id: string, patch: Partial<SosEntry>) => {
    // Compute prev BEFORE the functional setter — React 18 batches the
    // updater into the next render, so reading `logPayload` synchronously
    // after `setEntries(...)` previously saw `null` 100% of the time.
    // Status-change events were silently dropped from the history log.
    // The trade-off is that we miss "freshest" entries if two concurrent
    // update() calls race, but that's only relevant for the same id (which
    // can't happen for status changes anyway — the UI gates on the row).
    const prev = entries.find((e) => e.id === id);
    setEntries((curr) => curr.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    if (patch.status && prev && patch.status !== prev.status) {
      log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_ADDED, {
        team: prev.team,
        kind: prev.kind,
        statusChange: { from: prev.status, to: patch.status },
      });
    }
  };
  const remove = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    setEntries((s) => s.filter((e) => e.id !== id));
    log(SCRUM_OF_SCRUMS_ACTIONS.TEAM_UPDATE_REMOVED, {
      team: entry?.team,
      kind: entry?.kind,
    });
  };
  const resolve = (id: string) => {
    update(id, { status: "resolved", resolvedAt: todayLocalISO() });
  };

  const staleBlockers = useMemo(
    () =>
      entries.filter((e) => {
        if (e.kind !== "blocker" || e.status !== "open") return false;
        const age = ageDays(e);
        return age !== null && age >= 3;
      }),
    [entries]
  );

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
        impediments: s.impediments, risks: s.risks, okrs: s.okrs,
        decisions: s.decisions, techDebt: s.techDebt,
        maturityLevel: s.maturityLevel, teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Scrum of Scrums Tracker",
      prompts: generateScrumOfScrumsPrompts({ entries, staleBlockers }, workspace),
    }),
    [entries, staleBlockers, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="scrum-of-scrums"
      title="Scrum of Scrums Tracker"
      description="Cross-team coordination log with blockers, dependencies, and decisions per meeting."
      category="Portfolio & Scaling"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="scrum-of-scrums"
          csvData={{
            headers: ["Date", "Team", "Kind", "Text", "Blocked By", "Status", "Resolved"],
            rows: entries.map((e) => [e.meetingDate, e.team, e.kind, e.text, e.blockedBy ?? "", e.status, e.resolvedAt ?? ""]),
          }}
          jsonData={entries}
        />
      </ActionRow>

      <KpiGrid cols={4} marginBottom="md">
        {(["blocker", "dependency", "decision", "update"] as EntryKind[]).map((k) => (
          <StatCard
            key={k}
            variant="compact"
            label={`${k}s open`}
            value={
              <span style={{ color: KIND_COLORS[k] }}>
                {entries.filter((e) => e.kind === k && e.status === "open").length}
              </span>
            }
          />
        ))}
      </KpiGrid>

      {staleBlockers.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>
            {staleBlockers.length} blocker{staleBlockers.length > 1 ? "s" : ""} aged ≥3 days:
          </strong>{" "}
          {staleBlockers.slice(0, 3).map((e) => `${e.team}: ${e.text.slice(0, 40)}`).join(" · ")}
        </CalloutAlert>
      )}

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-3 space-y-2">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent" />
            Log an entry
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_140px_140px_auto] gap-2">
            <Input
              type="date"
              value={draft.meetingDate}
              onChange={(e) => setDraft((d) => ({ ...d, meetingDate: e.target.value }))}
              className="bg-bg border-border"
            />
            <Input
              value={draft.team}
              onChange={(e) => setDraft((d) => ({ ...d, team: e.target.value }))}
              placeholder="Team name"
              className="bg-bg border-border"
            />
            <Select value={draft.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as EntryKind }))}>
              <SelectTrigger className="bg-bg border-border capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="blocker">Blocker</SelectItem>
                <SelectItem value="dependency">Dependency</SelectItem>
                <SelectItem value="decision">Decision</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={draft.blockedBy ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, blockedBy: e.target.value }))}
              placeholder="Blocked by (team)"
              className="bg-bg border-border"
            />
            <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Log
            </Button>
          </div>
          <Textarea
            rows={2}
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            placeholder="Describe the update, blocker, dependency, or decision..."
            className="bg-bg border-border"
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {entries.map((e) => (
          <Card
            key={e.id}
            className={`bg-surface border-border ${e.status === "resolved" ? "opacity-50" : ""}`}
            style={{ borderLeftWidth: 3, borderLeftColor: KIND_COLORS[e.kind] }}
          >
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center w-20 shrink-0">
                  <div className="text-[10px] uppercase font-data" style={{ color: KIND_COLORS[e.kind] }}>
                    {e.kind}
                  </div>
                  <div className="text-xs text-sub font-data">{e.meetingDate}</div>
                  <div className="text-[10px] text-sub">age {ageDays(e) ?? "—"}d</div>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-text">{e.team}</div>
                  <div className="text-sm text-text/80">{e.text}</div>
                  {e.blockedBy && (
                    <div className="text-xs text-amber-300">⇢ blocked by: {e.blockedBy}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {e.status === "open" && (
                    <Button variant="outline" size="sm" onClick={() => resolve(e.id)} className="border-accent/40 text-accent hover:bg-accent/10">
                      Resolve
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => remove(e.id)} className="text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ToolPageWrapper>
  );
}
