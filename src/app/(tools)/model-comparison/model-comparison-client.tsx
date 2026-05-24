"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { Cpu, Plus, Trash2, Beaker, Sparkles } from "lucide-react";
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
import type { ModelEntry, Workspace } from "@/lib/stores/workspace-types";
import { generateModelComparisonPrompts } from "@/lib/ai-prompts/model-comparison";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { MODEL_COMPARISON_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { PROVIDER_META, findModel } from "@/lib/llm/pricing";
import type { ProviderId } from "@/lib/llm/types";

// Lazy-load the run panel so the OpenAI/Anthropic/Gemini/GLM adapter chunks
// stay out of the eager bundle for users who never touch Live Compare.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

const STATUSES: ModelEntry["status"][] = ["production", "evaluation", "experimental", "deprecated"];

export function ModelComparisonClient() {
  const list = useWorkspaceStore((s) => s.models ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertModel);
  const removeOne = useWorkspaceStore((s) => s.removeModel);
  const { log } = useHistoryLogger("model-comparison");
  const exportRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [inputCost, setInputCost] = useState("");
  const [outputCost, setOutputCost] = useState("");
  const [contextWin, setContextWin] = useState("");
  const [latencyP50, setLatencyP50] = useState("");
  const [latencyP95, setLatencyP95] = useState("");
  const [evalScore, setEvalScore] = useState("");
  const [status, setStatus] = useState<ModelEntry["status"]>("evaluation");

  // --- Live Compare state ---
  // Read configured providers from BYOK store. Shallow so we re-render only
  // when the set of configured providers changes, not on every active-provider
  // flip or token-budget tweak.
  const llmProviders = useLlmStore(useShallow((s) => s.providers));
  const openLlmSettings = useLlmUiStore((s) => s.openSettings);
  // Stable, deterministic provider order so the grid layout doesn't shuffle
  // between renders. We sort by ProviderId alphabetically for predictability.
  const configuredProviders = useMemo(() => {
    return (
      Object.entries(llmProviders) as [ProviderId, { apiKey: string; model: string } | undefined][]
    )
      .filter(([, cfg]) => !!cfg && cfg.apiKey.length > 0)
      .map(([id, cfg]) => ({ id, model: cfg!.model, apiKey: cfg!.apiKey }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [llmProviders]);

  // Per-provider selection. Default: ALL configured providers selected.
  // Re-derived when the configured set changes so a newly-added provider
  // shows up enabled, and a removed one stops contributing to runs.
  const [selectedProviders, setSelectedProviders] = useState<Set<ProviderId>>(
    () => new Set(configuredProviders.map((p) => p.id))
  );
  // Re-sync the selection if a provider was just configured/removed in
  // settings while this page is open. The prior implementation ran the
  // setState inside the render body, gated by a useRef sentinel — that
  // works, but it forces an extra render pass and React warns about
  // setState-during-render. Moved into useEffect keyed on the comma-
  // joined provider list; semantics unchanged.
  const configuredKey = configuredProviders.map((p) => p.id).join(",");
  useEffect(() => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      // Drop selections for providers that no longer have a key. We iterate
      // via Array.from to side-step the project's ES3 downlevel-iteration
      // restriction on Set iteration.
      Array.from(next).forEach((id) => {
        if (!configuredProviders.some((p) => p.id === id)) next.delete(id);
      });
      // Add newly-configured providers as selected by default.
      configuredProviders.forEach((p) => {
        if (!prev.has(p.id)) next.add(p.id);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuredKey]);

  const [livePrompt, setLivePrompt] = useState("");
  // Monotonic counter incremented on "Run all". Each AiRunPanel watches this
  // via its `runTrigger` prop — bumping it fires every panel in lockstep.
  const [runCounter, setRunCounter] = useState(0);

  function add() {
    if (!name.trim() || !vendor.trim()) return;
    // Use `Number.isFinite(parsed) ? parsed : undefined` rather than the
    // `parsed || undefined` shortcut so a legitimate zero (free-tier model,
    // sub-millisecond latency benchmark) doesn't get coerced to "missing".
    const parseFloatField = (s: string): number | undefined => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const parseIntField = (s: string): number | undefined => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const trimmedName = name.trim();
    // Match by name (the existing dedup signal) so re-entering an existing
    // model genuinely triggers `model.upgraded` AND replaces the prior row.
    // BUG-RD3-model-comparison-1: the previous code minted a fresh UUID
    // unconditionally, so `upsert(item)` always appended — leaving two
    // rows with the same name in the catalog every time a user "edited"
    // a model by re-entering it. Reuse `prior.id` when one exists.
    const prior = list.find((m) => m.name === trimmedName);
    const item: ModelEntry = {
      id: prior?.id ?? crypto.randomUUID(),
      name: trimmedName,
      vendor: vendor.trim(),
      inputCostPer1k: parseFloatField(inputCost),
      outputCostPer1k: parseFloatField(outputCost),
      contextWindow: parseIntField(contextWin),
      latencyP50Ms: parseIntField(latencyP50),
      latencyP95Ms: parseIntField(latencyP95),
      evalScore: parseFloatField(evalScore),
      status,
    };
    upsert(item);
    log(MODEL_COMPARISON_ACTIONS.MODEL_ADDED, { name: item.name });
    if (prior) {
      emitSignal({
        kind: "model.upgraded",
        at: new Date().toISOString(),
        toolId: "model-comparison",
        payload: { name: item.name },
      });
    }
    setName("");
    setVendor("");
    setInputCost("");
    setOutputCost("");
    setContextWin("");
    setLatencyP50("");
    setLatencyP95("");
    setEvalScore("");
  }

  function remove(id: string) {
    removeOne(id);
    log(MODEL_COMPARISON_ACTIONS.MODEL_REMOVED, { id });
  }

  function toggleProvider(id: ProviderId) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeLiveProviders = configuredProviders.filter((p) => selectedProviders.has(p.id));
  // Disable Run all when nothing useful would happen: no prompt, no provider,
  // or all providers de-selected. Cheaper than letting the user click and
  // then realise the buttons inside the panels are also disabled.
  const canRunAll = livePrompt.trim().length > 0 && activeLiveProviders.length > 0;

  function runAll() {
    if (!canRunAll) return;
    // Single state bump fans out to every mounted AiRunPanel via runTrigger.
    setRunCounter((c) => c + 1);
    log(MODEL_COMPARISON_ACTIONS.MODEL_ADDED, {
      // Reuse an existing action verb — there's no dedicated "live-compared"
      // history action yet, and adding one would mean a Phase 19 schema bump
      // for a single log line. The activity feed still reads sensibly.
      name: `live-compare: ${activeLiveProviders.length} provider(s)`,
    });
  }

  const sorted = useMemo(
    () => [...list].sort((a, b) => (b.evalScore ?? 0) - (a.evalScore ?? 0)),
    [list]
  );

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
        models: s.models,
        llmEvals: s.llmEvals,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Model Comparison",
      prompts: generateModelComparisonPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  const csvData = {
    headers: [
      "Name",
      "Vendor",
      "Input/1k",
      "Output/1k",
      "Context",
      "p50ms",
      "p95ms",
      "Eval",
      "Status",
    ],
    rows: list.map((m) => [
      m.name,
      m.vendor,
      m.inputCostPer1k ?? "",
      m.outputCostPer1k ?? "",
      m.contextWindow ?? "",
      m.latencyP50Ms ?? "",
      m.latencyP95Ms ?? "",
      m.evalScore ?? "",
      m.status,
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="model-comparison"
      title="Model Comparison Matrix"
      description="Compare LLMs side-by-side: cost per 1k tokens, latency, context window, eval score, and lifecycle status."
    >
      <div className="space-y-6" ref={exportRef}>
        {/* Live Compare — the headline BYOK feature. Sits above "Add model"
            because the catalog you maintain below is supposed to be informed
            by what you observe here. */}
        <SectionCard title="Live Compare (BYOK)" icon={Beaker}>
          <p className="text-xs text-sub mb-3">
            {configuredProviders.length === 0
              ? "Configure one or more BYOK providers to run the same prompt across them and see results side-by-side."
              : `Run any prompt against ${configuredProviders.length} configured provider${configuredProviders.length === 1 ? "" : "s"} in parallel and compare streaming output, time-to-first-token, and cost.`}
          </p>
          {configuredProviders.length === 0 ? (
            <div className="flex flex-col items-start gap-2 p-4 border border-dashed border-border rounded text-sub text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-accent" />
                No BYOK providers configured yet.
              </span>
              <Button size="sm" variant="outline" onClick={openLlmSettings} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Open AI settings
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                value={livePrompt}
                onChange={(e) => setLivePrompt(e.target.value)}
                placeholder="Paste or type a prompt to test across all selected providers…"
                rows={4}
                className="font-mono text-xs"
              />

              {/* Provider picker — checkboxes per configured provider. The
                  underlying control is a real <input type="checkbox"> for
                  free keyboard support; the label wraps it for click-anywhere
                  affordance. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {configuredProviders.map((p) => {
                  const checked = selectedProviders.has(p.id);
                  const modelInfo = findModel(p.id, p.model);
                  return (
                    <label
                      key={p.id}
                      className={`inline-flex items-center gap-2 text-xs px-2.5 py-1.5 rounded border cursor-pointer transition-colors ${
                        checked
                          ? "border-accent/40 bg-accent/5 text-text"
                          : "border-border bg-surface text-sub hover:text-text"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProvider(p.id)}
                        className="accent-accent"
                      />
                      <span className="font-mono uppercase tracking-wider text-[10px] text-accent">
                        {PROVIDER_META[p.id].name}
                      </span>
                      <span className="text-sub normal-case">{modelInfo?.label ?? p.model}</span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={runAll}
                  disabled={!canRunAll}
                  className="gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
                >
                  <Beaker className="w-4 h-4" />
                  Run all ({activeLiveProviders.length})
                </Button>
                <span className="text-xs text-sub">
                  {activeLiveProviders.length === 0
                    ? "Select at least one provider."
                    : livePrompt.trim().length === 0
                      ? "Add a prompt above."
                      : `Each provider runs independently — total cost = sum of all panels.`}
                </span>
              </div>

              {activeLiveProviders.length > 0 && (
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {activeLiveProviders.map((p) => (
                    <AiRunPanel
                      key={p.id}
                      prompt={livePrompt}
                      compact
                      runTrigger={runCounter}
                      providerOverride={{
                        provider: p.id,
                        model: p.model,
                        apiKey: p.apiKey,
                      }}
                      toolName="Model Comparison: Live"
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="Add model" icon={Plus}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Input
              placeholder="Model name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
            <Input
              type="number"
              step="0.001"
              placeholder="Input $/1k tok"
              value={inputCost}
              onChange={(e) => setInputCost(e.target.value)}
            />
            <Input
              type="number"
              step="0.001"
              placeholder="Output $/1k tok"
              value={outputCost}
              onChange={(e) => setOutputCost(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Context window"
              value={contextWin}
              onChange={(e) => setContextWin(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Latency p50 ms"
              value={latencyP50}
              onChange={(e) => setLatencyP50(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Latency p95 ms"
              value={latencyP95}
              onChange={(e) => setLatencyP95(e.target.value)}
            />
            <Input
              type="number"
              step="0.001"
              placeholder="Eval score 0-1"
              value={evalScore}
              onChange={(e) => setEvalScore(e.target.value)}
            />
            <Select value={status} onValueChange={(v) => setStatus(v as ModelEntry["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add model
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Models (${list.length}) — sorted by eval score`}
            icon={Cpu}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="model-comparison"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <div className="table-wrap-responsive">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-sub uppercase">
                    <th className="p-2">Model</th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2 text-right">In $/1k</th>
                    <th className="p-2 text-right">Out $/1k</th>
                    <th className="p-2 text-right">Ctx</th>
                    <th className="p-2 text-right">p50</th>
                    <th className="p-2 text-right">p95</th>
                    <th className="p-2 text-right">Eval</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="p-2 font-mono text-xs">{m.name}</td>
                      <td className="p-2">{m.vendor}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {m.inputCostPer1k != null ? `$${m.inputCostPer1k}` : "—"}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {m.outputCostPer1k != null ? `$${m.outputCostPer1k}` : "—"}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {m.contextWindow?.toLocaleString() ?? "—"}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {m.latencyP50Ms ?? "—"}ms
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {m.latencyP95Ms ?? "—"}ms
                      </td>
                      <td className="p-2 text-right font-mono">
                        {m.evalScore != null ? `${(m.evalScore * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="p-2 text-xs text-sub">{m.status}</td>
                      <td className="p-2">
                        <button
                          onClick={() => remove(m.id)}
                          aria-label="Remove model"
                          className="text-sub hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
