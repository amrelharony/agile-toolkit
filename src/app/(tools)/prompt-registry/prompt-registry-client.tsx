"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { GitMerge, Plus, Trash2, CheckCircle2 } from "lucide-react";
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

const STATUSES: PromptVersion["status"][] = ["draft", "review", "production", "deprecated"];
const STATUS_COLORS: Record<PromptVersion["status"], string> = {
  draft: "#888", review: "#ffaa00", production: "#00ff88", deprecated: "#ff6b6b",
};

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
              {[...list].sort((a, b) => a.name.localeCompare(b.name) || b.version.localeCompare(a.version)).map((p) => (
                <li key={p.id} className="border border-border bg-surface-deep rounded p-3">
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm text-text">{p.name}@{p.version}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: STATUS_COLORS[p.status] + "20", color: STATUS_COLORS[p.status] }}>
                        {p.status}
                      </span>
                      {typeof p.evalScore === "number" && <span className="text-xs text-sub">eval: {(p.evalScore * 100).toFixed(0)}%</span>}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
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
                </li>
              ))}
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
