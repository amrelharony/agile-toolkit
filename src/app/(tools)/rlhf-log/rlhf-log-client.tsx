"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { Bot, Plus, Trash2, Beaker, Sparkles } from "lucide-react";
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
import type { RlhfPair, Workspace } from "@/lib/stores/workspace-types";
import { generateRlhfPrompts } from "@/lib/ai-prompts/rlhf-log";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RLHF_ACTIONS } from "@/lib/history/event-actions";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { redactPii, looksLikePii } from "@/lib/utils/redact-pii";
import { PROVIDER_META, MODELS_BY_PROVIDER, findModel } from "@/lib/llm/pricing";
import type { ProviderId } from "@/lib/llm/types";

// Lazy-load — adapter chunks stay async for users who only log
// pairs they generated elsewhere.
const AiRunPanel = dynamic(() => import("@/components/shared/ai-run-panel"), {
  ssr: false,
  loading: () => (
    <div className="text-xs text-sub p-2 border border-border rounded">Loading panel…</div>
  ),
});

// A single (provider, model) pick that the user can switch independently
// for the A side and the B side of a pair.
interface PairPick {
  provider: ProviderId;
  model: string;
}

export function RlhfLogClient() {
  const list = useWorkspaceStore((s) => s.rlhfPairs ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertRlhfPair);
  const removeOne = useWorkspaceStore((s) => s.removeRlhfPair);
  const { log } = useHistoryLogger("rlhf-log");
  const exportRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [winner, setWinner] = useState<RlhfPair["winner"]>("A");
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  // BUG-T7-rlhf-log-1: opt-in PII redaction. When true, emails, common
  // API key prefixes, phone numbers and credit-card-shaped digits are
  // stripped from prompt/responses BEFORE persist + export.
  const [redact, setRedact] = useState(true);

  // --- BYOK pair generator state ---
  // The configured providers (each with a saved key + a default model) drive
  // the picker. We enumerate `provider:model` combo strings as the Select
  // value so the existing Select primitive's flat-string model fits cleanly.
  const llmProviders = useLlmStore(useShallow((s) => s.providers));
  const openLlmSettings = useLlmUiStore((s) => s.openSettings);
  const configured = useMemo(() => {
    return (
      Object.entries(llmProviders) as [ProviderId, { apiKey: string; model: string } | undefined][]
    )
      .filter(([, cfg]) => !!cfg && cfg.apiKey.length > 0)
      .map(([id, cfg]) => ({ id, model: cfg!.model, apiKey: cfg!.apiKey }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [llmProviders]);
  // Default picks: A uses the first configured provider with its saved
  // model; B uses the second if available, else the same provider's second
  // listed model, else the same model (degenerate case, user can switch).
  const initialPicks = useMemo<{ a: PairPick | null; b: PairPick | null }>(() => {
    if (configured.length === 0) return { a: null, b: null };
    const a: PairPick = { provider: configured[0].id, model: configured[0].model };
    let b: PairPick;
    if (configured.length >= 2) {
      b = { provider: configured[1].id, model: configured[1].model };
    } else {
      const models = MODELS_BY_PROVIDER[a.provider];
      const altModel = models.find((m) => m.id !== a.model)?.id ?? a.model;
      b = { provider: a.provider, model: altModel };
    }
    return { a, b };
  }, [configured]);
  const [pickA, setPickA] = useState<PairPick | null>(initialPicks.a);
  const [pickB, setPickB] = useState<PairPick | null>(initialPicks.b);
  // Re-default when the configured set changes. The prior implementation
  // ran setState calls inside the render body guarded by a useRef sentinel
  // — React tolerates this for "derived state" but it forces an extra
  // render pass and any logic upstream that depends on referential
  // stability of state ends up seeing two values in one tick. Moved into
  // a useEffect keyed on the comma-joined provider list; the seed and the
  // drop-stale paths both run there.
  const configuredKey = configured.map((p) => p.id).join(",");
  useEffect(() => {
    if (pickA && !configured.some((p) => p.id === pickA.provider)) setPickA(initialPicks.a);
    if (pickB && !configured.some((p) => p.id === pickB.provider)) setPickB(initialPicks.b);
    if (!pickA && initialPicks.a) setPickA(initialPicks.a);
    if (!pickB && initialPicks.b) setPickB(initialPicks.b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuredKey]);
  const [pairPrompt, setPairPrompt] = useState("");
  // Monotonic counter — bumping it fires both panels in lockstep via
  // AiRunPanel's runTrigger prop.
  const [runCounter, setRunCounter] = useState(0);

  // onResult handlers — autofill the existing A/B textareas with the
  // streamed output. Capped at 4000 chars apiece to match the loose
  // budget the manual flow used.
  //
  // Stable identities via useCallback so the panels don't see fresh
  // closures every render (their onResult ref pattern handles staleness,
  // but stability is essentially free here and avoids triggering any
  // future logic that might key off identity).
  const handleResultA = useCallback((r: { text: string }) => {
    setA(r.text.trim().slice(0, 4000));
  }, []);
  const handleResultB = useCallback((r: { text: string }) => {
    setB(r.text.trim().slice(0, 4000));
  }, []);

  // Looking up the apiKey for a given pick — needed because PairPick only
  // tracks (provider, model); the key lives in llm-store.
  const apiKeyFor = (pId: ProviderId): string | null => llmProviders[pId]?.apiKey ?? null;

  function runPair() {
    if (!pairPrompt.trim()) return;
    if (!pickA || !pickB) return;
    if (!apiKeyFor(pickA.provider) || !apiKeyFor(pickB.provider)) return;
    // Carry the pair prompt into the existing form's `prompt` field so
    // the user doesn't have to re-paste it before logging.
    setPrompt(pairPrompt);
    setRunCounter((c) => c + 1);
  }

  const canRunPair =
    pairPrompt.trim().length > 0 &&
    pickA !== null &&
    pickB !== null &&
    apiKeyFor(pickA.provider) !== null &&
    apiKeyFor(pickB.provider) !== null;

  function add() {
    if (!prompt.trim() || !a.trim() || !b.trim()) return;
    const maybeRedact = (s: string) => (redact ? redactPii(s) : s);
    const item: RlhfPair = {
      id: crypto.randomUUID(),
      prompt: maybeRedact(prompt.trim()),
      responseA: maybeRedact(a.trim()),
      responseB: maybeRedact(b.trim()),
      winner,
      reviewer: reviewer.trim() || undefined,
      reason: reason.trim() ? maybeRedact(reason.trim()) : undefined,
      loggedAt: new Date().toISOString(),
    };
    upsert(item);
    log(RLHF_ACTIONS.PAIR_LOGGED, { winner });
    setPrompt("");
    setA("");
    setB("");
    setReason("");
    setReviewer("");
    setWinner("A");
  }
  // Inline indicator so the user knows redaction would change something.
  const pendingPii =
    (prompt && looksLikePii(prompt)) || (a && looksLikePii(a)) || (b && looksLikePii(b));

  function remove(id: string) {
    removeOne(id);
    log(RLHF_ACTIONS.PAIR_REMOVED, { id });
  }

  const winA = list.filter((x) => x.winner === "A").length;
  const winB = list.filter((x) => x.winner === "B").length;
  const ties = list.filter((x) => x.winner === "tie").length;

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
        rlhfPairs: s.rlhfPairs,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "RLHF Feedback Log",
      prompts: generateRlhfPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  const csvData = {
    headers: ["Date", "Prompt", "A", "B", "Winner", "Reviewer", "Reason"],
    // BUG-T7-rlhf-log-2: export full prompt/response text. The prior
    // `.slice(0, 100)` silently truncated training-dataset rows to
    // first 100 chars with no marker — the CSV was useless for fine-
    // tuning. The shared exportToCSV helper handles quoting/escaping.
    rows: list.map((x) => [
      x.loggedAt.slice(0, 10),
      x.prompt,
      x.responseA,
      x.responseB,
      x.winner,
      x.reviewer ?? "",
      x.reason ?? "",
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="rlhf-log"
      title="RLHF Feedback Log"
      description="Pairwise comparisons used as a dataset for RLHF or DPO training: prompt, A, B, winner, reviewer, reason."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <KPI label="A wins" value={String(winA)} />
          <KPI label="B wins" value={String(winB)} />
          <KPI label="Ties" value={String(ties)} />
        </div>

        {/* BYOK pair generator — use two different (provider, model) combos
            to produce side-A and side-B candidates from a single prompt,
            then autofill the existing log form below. The headline RLHF
            collection workflow. */}
        <SectionCard title="Generate pair (BYOK)" icon={Beaker}>
          <p className="text-xs text-sub mb-3">
            Pick two (provider, model) combos and run the same prompt through both. Responses
            autofill the A and B textareas below — you only need to set the winner + reason.
          </p>
          {configured.length === 0 ? (
            <div className="flex flex-col items-start gap-2 p-3 border border-dashed border-border rounded text-sub text-sm">
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
                value={pairPrompt}
                onChange={(e) => setPairPrompt(e.target.value)}
                placeholder="Shared prompt fed to both A and B…"
                rows={3}
                className="font-mono text-xs"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <PairPicker label="A" pick={pickA} onPick={setPickA} configured={configured} />
                <PairPicker label="B" pick={pickB} onPick={setPickB} configured={configured} />
              </div>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <Button
                  size="sm"
                  onClick={runPair}
                  disabled={!canRunPair}
                  className="gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
                >
                  <Beaker className="w-4 h-4" />
                  Generate A &amp; B
                </Button>
                <span className="text-xs text-sub">
                  {canRunPair
                    ? "Both panels stream in parallel; responses autofill below."
                    : pairPrompt.trim().length === 0
                      ? "Add a prompt above."
                      : "Pick provider + model for each side."}
                </span>
              </div>
              {/* Two side-by-side panels. The providerOverride pins each to
                  its picked combo; runTrigger fires both in lockstep on
                  "Generate A & B"; onResult autofills the existing A/B
                  textareas in the log form below. */}
              {pickA && pickB && pairPrompt.trim().length > 0 && (
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-mono mb-1">
                      Side A · {PROVIDER_META[pickA.provider].name} ·{" "}
                      {findModel(pickA.provider, pickA.model)?.label ?? pickA.model}
                    </div>
                    <AiRunPanel
                      prompt={pairPrompt}
                      compact
                      runTrigger={runCounter}
                      providerOverride={{
                        provider: pickA.provider,
                        model: pickA.model,
                        apiKey: apiKeyFor(pickA.provider) ?? "",
                      }}
                      toolName="RLHF pair: A"
                      onResult={handleResultA}
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-pink-400 font-mono mb-1">
                      Side B · {PROVIDER_META[pickB.provider].name} ·{" "}
                      {findModel(pickB.provider, pickB.model)?.label ?? pickB.model}
                    </div>
                    <AiRunPanel
                      prompt={pairPrompt}
                      compact
                      runTrigger={runCounter}
                      providerOverride={{
                        provider: pickB.provider,
                        model: pickB.model,
                        apiKey: apiKeyFor(pickB.provider) ?? "",
                      }}
                      toolName="RLHF pair: B"
                      onResult={handleResultB}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="Log pairwise comparison" icon={Plus}>
          <Textarea
            placeholder="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="font-mono text-xs"
            rows={2}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Textarea
              placeholder="Response A"
              value={a}
              onChange={(e) => setA(e.target.value)}
              rows={4}
            />
            <Textarea
              placeholder="Response B"
              value={b}
              onChange={(e) => setB(e.target.value)}
              rows={4}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <Select value={winner} onValueChange={(v) => setWinner(v as RlhfPair["winner"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A wins</SelectItem>
                <SelectItem value="B">B wins</SelectItem>
                <SelectItem value="tie">Tie</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Reviewer (optional)"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs text-sub flex items-center gap-2">
              <input
                type="checkbox"
                checked={redact}
                onChange={(e) => setRedact(e.target.checked)}
                aria-label="Redact PII before saving"
              />
              Redact emails / API keys / phone numbers before saving + exporting
            </label>
            {pendingPii && redact && (
              <span className="text-[11px] text-amber-300">
                PII detected — will be redacted on save.
              </span>
            )}
            {pendingPii && !redact && (
              <span className="text-[11px] text-red-300">
                PII detected in this entry — will be stored and exported as-is.
              </span>
            )}
          </div>
          <Button onClick={add} className="mt-2 gap-1">
            <Plus className="w-4 h-4" />
            Log pair
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Pairs (${list.length})`}
            icon={Bot}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="rlhf-log"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list]
                .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime())
                .slice(0, 30)
                .map((x) => (
                  <li
                    key={x.id}
                    className="border border-border bg-surface-deep rounded p-3 text-sm"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-sub font-mono">
                        {x.loggedAt.slice(0, 10)} · {x.reviewer ?? "—"}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor:
                              x.winner === "tie"
                                ? "#88888820"
                                : x.winner === "A"
                                  ? "#00f0ff20"
                                  : "#ff00aa20",
                            color:
                              x.winner === "tie"
                                ? "#888"
                                : x.winner === "A"
                                  ? "#00f0ff"
                                  : "#ff00aa",
                          }}
                        >
                          {x.winner}
                        </span>
                        <button
                          onClick={() => remove(x.id)}
                          aria-label="Remove pair"
                          className="text-sub hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    </div>
                    <p className="text-xs text-text mb-2 truncate">Prompt: {x.prompt}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="bg-surface rounded p-2 border border-cyan-500/20">
                        <span className="text-cyan-400 text-[10px] uppercase">A</span>
                        <div className="text-sub mt-1">{x.responseA.slice(0, 200)}</div>
                      </div>
                      <div className="bg-surface rounded p-2 border border-pink-500/20">
                        <span className="text-pink-400 text-[10px] uppercase">B</span>
                        <div className="text-sub mt-1">{x.responseB.slice(0, 200)}</div>
                      </div>
                    </div>
                    {x.reason && <p className="text-xs text-sub mt-2 italic">Reason: {x.reason}</p>}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/**
 * Combined (provider, model) picker. Uses a flat "providerId:modelId"
 * combo string as the Select's value so the existing Select primitive
 * (which is string-keyed) works cleanly with the structured pick.
 *
 * Lists every model from every CONFIGURED provider grouped under that
 * provider's display name. Models from non-configured providers are
 * hidden — even if the user picked one we couldn't supply a key.
 */
function PairPicker({
  label,
  pick,
  onPick,
  configured,
}: {
  label: string;
  pick: PairPick | null;
  onPick: (p: PairPick) => void;
  configured: { id: ProviderId; model: string; apiKey: string }[];
}) {
  const value = pick ? `${pick.provider}:${pick.model}` : "";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-sub font-mono">Side {label}</span>
      <Select
        value={value}
        onValueChange={(v) => {
          const [prov, ...modelParts] = v.split(":");
          const model = modelParts.join(":"); // model ids may contain `:` (none today, but cheap to be safe)
          if (!prov || !model) return;
          onPick({ provider: prov as ProviderId, model });
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Pick provider + model" />
        </SelectTrigger>
        <SelectContent>
          {configured.map((p) =>
            // Group header + that provider's models. Radix Select doesn't
            // have a built-in group component in our wrapper, so we use a
            // disabled header row trick: a non-selectable label that just
            // labels the cluster.
            MODELS_BY_PROVIDER[p.id].map((m) => (
              <SelectItem key={`${p.id}:${m.id}`} value={`${p.id}:${m.id}`}>
                <span className="font-mono text-[10px] text-accent uppercase tracking-wider mr-1">
                  {PROVIDER_META[p.id].name}
                </span>
                {m.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </label>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold mt-1 font-data">{value}</div>
    </div>
  );
}
