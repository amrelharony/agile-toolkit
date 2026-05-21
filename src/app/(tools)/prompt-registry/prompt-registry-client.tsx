"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { GitMerge, Plus, Trash2, CheckCircle2, Play, ChevronDown, ChevronRight } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PromptVersion, Workspace } from "@/lib/stores/workspace-types";
import { generatePromptRegistryPrompts } from "@/lib/ai-prompts/prompt-registry";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PROMPT_REGISTRY_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useActiveLlm } from "@/lib/llm/use-active-llm";

// Lazy-load the run panel so prompt-registry stays out of the BYOK adapter
// chunk for users who never use the Test feature.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2">Loading run panel…</div>
  ),
});

const STATUSES: PromptVersion["status"][] = ["draft", "review", "production", "deprecated"];
const STATUS_COLORS: Record<PromptVersion["status"], string> = {
  draft: "#888", review: "#ffaa00", production: "#00ff88", deprecated: "#ff6b6b",
};

// R5: numeric-segment semver compare in DESC order. The previous
// `b.version.localeCompare(a.version)` ordered `1.10.0` BEFORE `1.9.0`
// because the lexicographic compare sees `1` < `9` at position 2. Split
// on `.` and compare each segment as a number.
function compareSemverDesc(a: string, b: string): number {
  const pa = String(a ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? "").split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da; // descending — newest version first
  }
  return 0;
}

export function PromptRegistryClient() {
  const list = useWorkspaceStore((s) => s.prompts ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertPrompt);
  const removeOne = useWorkspaceStore((s) => s.removePrompt);
  const { log } = useHistoryLogger("prompt-registry");
  const exportRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [changeNote, setChangeNote] = useState("");
  // Which prompt version (by id) currently has its inline test panel expanded.
  // null = none expanded. Only one panel open at a time keeps the list scannable
  // and avoids the surprise of three streaming panels firing in parallel from
  // a single tool page.
  const [testingId, setTestingId] = useState<string | null>(null);

  const llm = useActiveLlm();

  function add() {
    if (!name.trim() || !body.trim()) return;
    const item: PromptVersion = {
      id: crypto.randomUUID(),
      name: name.trim(),
      version: version.trim() || "1.0.0",
      body: body.trim(),
      status: "draft",
      author: author.trim() || undefined,
      changeNote: changeNote.trim() || undefined,
    };
    upsert(item);
    log(PROMPT_REGISTRY_ACTIONS.PROMPT_DRAFTED, { name: item.name, version: item.version });
    setName(""); setVersion("1.0.0"); setBody(""); setChangeNote(""); setAuthor("");
  }

  function publish(p: PromptVersion) {
    const next: PromptVersion = { ...p, status: "production", publishedAt: new Date().toISOString() };
    upsert(next);
    log(PROMPT_REGISTRY_ACTIONS.PROMPT_PUBLISHED, { name: p.name, version: p.version });
    emitSignal({ kind: "prompt.versionPublished", at: next.publishedAt!, toolId: "prompt-registry", payload: next });
  }

  function setStatus(p: PromptVersion, s: PromptVersion["status"]) {
    upsert({ ...p, status: s });
    if (s === "deprecated") log(PROMPT_REGISTRY_ACTIONS.PROMPT_DEPRECATED, { name: p.name });
  }

  function remove(id: string) {
    removeOne(id);
    log(PROMPT_REGISTRY_ACTIONS.PROMPT_REMOVED, { id });
  }

  const inProd = list.filter((p) => p.status === "production");
  const drafts = list.filter((p) => p.status === "draft" || p.status === "review");

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prompts: s.prompts, llmEvals: s.llmEvals,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Prompt Registry",
    prompts: generatePromptRegistryPrompts({ items: list }, workspace),
  }), [list, workspace]);

  const csvData = {
    headers: ["Name", "Version", "Status", "Eval", "Author", "Published", "Body"],
    rows: list.map((p) => [p.name, p.version, p.status, p.evalScore ?? "", p.author ?? "", p.publishedAt ?? "", p.body.slice(0, 200)]),
  };

  return (
    <ToolPageWrapper
      toolId="prompt-registry"
      title="Prompt Registry"
      description="Versioned prompt catalog with draft → review → production → deprecated lifecycle and per-version notes."
    >
      <div ref={exportRef} className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPI label="Total" value={String(list.length)} />
          <KPI label="In production" value={String(inProd.length)} tone="ok" />
          <KPI label="Drafts/Review" value={String(drafts.length)} />
          <KPI label="Deprecated" value={String(list.filter((p) => p.status === "deprecated").length)} />
        </div>

        <SectionCard title="Draft new prompt version" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input placeholder="Prompt name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Version (e.g. 1.4.0)" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <Textarea placeholder="Prompt body" value={body} onChange={(e) => setBody(e.target.value)} className="mt-2 font-mono text-xs" rows={6} />
          <Input placeholder="Change note (what changed vs previous?)" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} className="mt-2" />
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Save draft</Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Versions (${list.length})`}
            icon={GitMerge}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="prompt-registry" csvData={csvData} jsonData={list} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list].sort((a, b) => a.name.localeCompare(b.name) || compareSemverDesc(a.version, b.version)).map((p) => {
                // Defensive lookup — a corrupted persisted record could carry
                // an unknown status string ("staging", "wip" from a future
                // schema, etc.). Falling back to draft's grey keeps the badge
                // readable rather than rendering broken CSS like `#undefined20`.
                const statusColor = STATUS_COLORS[p.status] ?? STATUS_COLORS.draft;
                const isTesting = testingId === p.id;
                return (
                <li key={p.id} className="border border-border bg-surface-deep rounded p-3">
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm text-text">{p.name}@{p.version}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: statusColor + "20", color: statusColor }}>
                        {p.status}
                      </span>
                      {typeof p.evalScore === "number" && <span className="text-xs text-sub">eval: {(p.evalScore * 100).toFixed(0)}%</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {/* Test button — only meaningful when a BYOK provider is
                          configured. We keep the button visible (but disabled
                          with a tooltip) when off so the affordance is
                          discoverable; clicking it does nothing without a
                          provider, but the tooltip points the user at AI
                          settings. */}
                      <button
                        onClick={() => setTestingId(isTesting ? null : p.id)}
                        disabled={!llm.isReady}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-sub hover:text-accent hover:border-accent/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-sub disabled:hover:border-border"
                        title={llm.isReady ? (isTesting ? "Hide test panel" : "Run this prompt with your BYOK provider") : "Configure an AI provider in settings to test prompts inline"}
                        aria-label={isTesting ? "Hide test panel" : "Test prompt"}
                        aria-expanded={isTesting}
                      >
                        {isTesting ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Play className="w-3 h-3" />
                        Test
                      </button>
                      <Select value={p.status} onValueChange={(v) => setStatus(p, v as PromptVersion["status"])}>
                        <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {p.status !== "production" && (
                        <button onClick={() => publish(p)} className="text-emerald-400 hover:text-emerald-300" aria-label="Publish">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => remove(p.id)} className="text-sub hover:text-red-400" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  {p.changeNote && <p className="text-xs text-sub italic mb-1">{p.changeNote}</p>}
                  <pre className="text-xs text-sub bg-surface rounded p-2 overflow-x-auto whitespace-pre-wrap">{p.body.slice(0, 400)}{p.body.length > 400 ? "…" : ""}</pre>
                  {/* Inline test panel — uses the user's active BYOK provider
                      to run the *full* prompt body (we don't truncate the
                      preview's 400-char clip; the panel sees the real text).
                      Lazy-loaded via next/dynamic so the adapter chunk only
                      lands when at least one panel is open. */}
                  {isTesting && llm.isReady && (
                    <AiRunPanel
                      prompt={p.body}
                      toolName={`Prompt Registry: ${p.name}@${p.version}`}
                    />
                  )}
                </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "danger" }) {
  const colorClass = tone === "danger" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
