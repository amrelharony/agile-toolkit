"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { ScanSearch, Plus, Trash2, CheckCircle2, Beaker } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RedTeamFinding, Workspace } from "@/lib/stores/workspace-types";
import { generateAIRedTeamPrompts } from "@/lib/ai-prompts/ai-red-team";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { AI_RED_TEAM_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useActiveLlm } from "@/lib/llm/use-active-llm";

// Lazy-load — adapter chunks stay async, so users who only log findings
// manually never pay the BYOK runtime cost.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

const SEVERITIES: RedTeamFinding["severity"][] = ["low", "medium", "high", "critical"];
const COLORS: Record<RedTeamFinding["severity"], string> = {
  low: "#00ff88",
  medium: "#ffaa00",
  high: "#ff6b6b",
  critical: "#ff00aa",
};

/** loggedAt as epoch ms; an unparseable timestamp counts as the oldest. */
function loggedMs(x: RedTeamFinding): number {
  const t = new Date(x.loggedAt).getTime();
  return Number.isFinite(t) ? t : -Infinity;
}

export function AIRedTeamClient() {
  const list = useWorkspaceStore((s) => s.redTeamFindings ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertRedTeamFinding);
  const removeOne = useWorkspaceStore((s) => s.removeRedTeamFinding);
  const { log } = useHistoryLogger("ai-red-team");
  const exportRef = useRef<HTMLDivElement>(null);

  const [vector, setVector] = useState("");
  const [prompt, setPrompt] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [severity, setSeverity] = useState<RedTeamFinding["severity"]>("medium");
  // Inline live-probe expander. Off by default — clicking the BYOK test
  // button toggles the panel below the prompt textarea.
  const [probeOpen, setProbeOpen] = useState(false);
  const llm = useActiveLlm();

  function add() {
    if (!vector.trim()) return;
    const item: RedTeamFinding = {
      id: crypto.randomUUID(),
      attackVector: vector.trim(),
      promptUsed: prompt.trim() || undefined,
      successful,
      severity,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(AI_RED_TEAM_ACTIONS.FINDING_LOGGED, {
      vector: item.attackVector,
      successful: item.successful,
    });
    emitSignal({
      kind: "redTeam.findingOpened",
      at: item.loggedAt,
      toolId: "ai-red-team",
      payload: item,
    });
    setVector("");
    setPrompt("");
    setSuccessful(false);
    setSeverity("medium");
  }

  function resolve(id: string) {
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const next: RedTeamFinding = { ...item, resolvedAt: new Date().toISOString() };
    upsert(next);
    log(AI_RED_TEAM_ACTIONS.FINDING_RESOLVED, { id });
    // R5: drop the user-typed `promptUsed` from the emitted signal —
    // it's a potentially-sensitive attack prompt and downstream
    // subscribers (analytics, console loggers) shouldn't see it.
    emitSignal({
      kind: "redTeam.findingClosed",
      at: next.resolvedAt!,
      toolId: "ai-red-team",
      payload: { id: next.id, severity: next.severity, attackVector: next.attackVector },
    });
  }

  function remove(id: string) {
    removeOne(id);
    log(AI_RED_TEAM_ACTIONS.FINDING_REMOVED, { id });
  }

  const open = list.filter((x) => !x.resolvedAt);
  // Guard divide-by-zero — empty list would otherwise render "NaN%"
  // BUG-RD3-ai-red-team-1: clarify the metric. Including resolved
  // findings in the denominator AND numerator means "Success rate"
  // reads as a HISTORICAL success rate (over all attempts ever), which
  // is the more useful framing: it never drops below the historical
  // max even after every successful attack is mitigated, signalling
  // "this attack class worked once — keep monitoring". Update the
  // label so the KPI reads as that rather than implying current state.
  const succRate =
    list.length === 0
      ? 0
      : Math.round((list.filter((x) => x.successful).length / list.length) * 100);

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
        redTeamFindings: s.redTeamFindings,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "AI Red-Team Session Log",
      prompts: generateAIRedTeamPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  const csvData = {
    headers: ["Date", "Vector", "Severity", "Successful", "Prompt", "Mitigation", "Resolved"],
    rows: list.map((x) => [
      x.loggedAt.slice(0, 10),
      x.attackVector,
      x.severity,
      x.successful ? "yes" : "no",
      x.promptUsed ?? "",
      x.mitigation ?? "",
      x.resolvedAt ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="ai-red-team"
      title="AI Red-Team Session Log"
      description="Document adversarial testing: attack vectors, success rate, severity, and mitigation status."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Total findings" value={String(list.length)} />
          <KPI label="Open" value={String(open.length)} tone={open.length > 0 ? "danger" : "ok"} />
          <KPI
            label="Historical attack success"
            value={`${succRate}%`}
            tone={succRate > 30 ? "danger" : "default"}
          />
          <KPI
            label="Critical open"
            value={String(open.filter((x) => x.severity === "critical").length)}
            tone="danger"
          />
        </div>

        <SectionCard title="Log finding" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Attack vector (e.g. prompt injection)"
              aria-label="Attack vector"
              value={vector}
              onChange={(e) => setVector(e.target.value)}
            />
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as RedTeamFinding["severity"])}
            >
              <SelectTrigger aria-label="Severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={successful}
                onChange={(e) => setSuccessful(e.target.checked)}
              />
              <span>Attack succeeded</span>
            </label>
          </div>
          <Textarea
            placeholder="Prompt used (optional)"
            aria-label="Prompt used (optional)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-2 font-mono text-xs"
            rows={3}
          />
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Button onClick={add} className="gap-1">
              <Plus className="w-4 h-4" />
              Log finding
            </Button>
            {/* Test attack: pipes the typed prompt into AiRunPanel against
                the active BYOK provider. The user reads the response, ticks
                or unticks "Attack succeeded" above, then logs. Disabled
                with a tooltip when no provider is configured or no prompt
                has been typed. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setProbeOpen((v) => !v)}
              disabled={!llm.isReady || prompt.trim().length === 0}
              title={
                !llm.isReady
                  ? "Configure an AI provider in settings to live-test attacks"
                  : prompt.trim().length === 0
                    ? "Type a prompt to test"
                    : probeOpen
                      ? "Hide test panel"
                      : "Run the prompt against your BYOK provider — read the response and decide whether the attack succeeded"
              }
              aria-expanded={probeOpen}
              className="gap-1"
            >
              <Beaker className="w-4 h-4" />
              {probeOpen ? "Hide live probe" : "Test attack with BYOK"}
            </Button>
            {!llm.isReady && (
              <button
                type="button"
                onClick={llm.openSettings}
                className="text-xs text-sub hover:text-accent underline"
              >
                AI settings →
              </button>
            )}
          </div>
          {probeOpen && llm.isReady && prompt.trim().length > 0 && (
            <AiRunPanel
              prompt={prompt}
              toolName={`Red-team probe${vector.trim() ? `: ${vector.trim()}` : ""}`}
            />
          )}
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Findings (${list.length})`}
            icon={ScanSearch}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="ai-red-team"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list]
                // NaN-safe newest-first (same fix as hallucination-log): an
                // unparseable `loggedAt` (agents can pass any string) made the
                // comparator non-transitive and left valid rows out of order.
                // Treat it as -Infinity so it sinks to the bottom.
                .sort((a, b) => {
                  const ta = loggedMs(a);
                  const tb = loggedMs(b);
                  return ta === tb ? 0 : tb - ta;
                })
                .map((x) => (
                  <li
                    key={x.id}
                    className={`border rounded p-3 text-sm ${x.resolvedAt ? "bg-success/5 border-success/30" : "bg-surface-deep border-border"}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-xs uppercase font-bold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: COLORS[x.severity] + "20",
                            color: COLORS[x.severity],
                          }}
                        >
                          {x.severity}
                        </span>
                        {x.successful && (
                          <span className="text-xs text-danger font-bold">SUCCEEDED</span>
                        )}
                        <span className="text-text truncate">
                          {x.attackVector}
                          {x.resolvedAt && <span className="sr-only"> (resolved)</span>}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {!x.resolvedAt && (
                          <button
                            onClick={() => resolve(x.id)}
                            aria-label={`Mark resolved: ${x.attackVector}`}
                            title="Mark resolved"
                            className="min-touch-coarse -m-1 p-1 text-success hover:text-success"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => remove(x.id)}
                          aria-label={`Remove finding: ${x.attackVector}`}
                          className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    </div>
                    {x.promptUsed && (
                      <pre className="text-xs text-sub bg-surface rounded p-2 overflow-x-auto whitespace-pre-wrap mt-1">
                        {x.promptUsed.slice(0, 300)}
                      </pre>
                    )}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
