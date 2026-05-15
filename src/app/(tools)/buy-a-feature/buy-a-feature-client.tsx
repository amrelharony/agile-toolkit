"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CircleDollarSign, Plus, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { generateBuyAFeaturePrompts } from "@/lib/ai-prompts/buy-a-feature";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BUY_FEATURE_ACTIONS } from "@/lib/history/event-actions";

export function BuyAFeatureClient() {
  const all = useWorkspaceStore((s) => s.prioritizations ?? []);
  const items = useMemo(() => all.filter((x) => x.framework === "buy-feature"), [all]);
  const upsert = useWorkspaceStore((s) => s.upsertPrioritization);
  const removeOne = useWorkspaceStore((s) => s.removePrioritization);
  const { log } = useHistoryLogger("buy-a-feature");
  const exportRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  function add() {
    if (!title.trim()) return;
    const item: PrioritizationItem = {
      id: crypto.randomUUID(), framework: "buy-feature", title: title.trim(),
      score: 0,
      fields: { price: parseFloat(price) || 0, raised: 0 },
      status: "open", updatedAt: new Date().toISOString(),
    };
    upsert(item);
    log(BUY_FEATURE_ACTIONS.FEATURE_ADDED, { title, price: item.fields?.price });
    setTitle(""); setPrice("");
  }

  function buy(it: PrioritizationItem, amount: number) {
    if (amount <= 0) return;
    const next: PrioritizationItem = { ...it, score: (it.score ?? 0) + amount, fields: { ...(it.fields ?? {}), raised: (Number(it.fields?.raised) || 0) + amount }, updatedAt: new Date().toISOString() };
    upsert(next);
    log(BUY_FEATURE_ACTIONS.PURCHASE_RECORDED, { id: it.id, amount });
  }

  const sorted = [...items].sort((a, b) => (Number(b.fields?.raised) || 0) - (Number(a.fields?.raised) || 0));
  const totalRaised = items.reduce((s, x) => s + (Number(x.fields?.raised) || 0), 0);

  const workspace = useWorkspaceStore(useShallow((s): Workspace => ({
    teamMembers: s.teamMembers, sprints: s.sprints, stories: s.stories,
    impediments: s.impediments, risks: s.risks, okrs: s.okrs,
    decisions: s.decisions, techDebt: s.techDebt,
    maturityLevel: s.maturityLevel, teamName: s.teamName,
    prioritizations: s.prioritizations,
  })));

  const promptConfig = useMemo(() => ({
    toolName: "Buy-a-Feature",
    prompts: generateBuyAFeaturePrompts({ items: sorted }, workspace),
  }), [sorted, workspace]);

  const csvData = {
    headers: ["Title", "Price", "Raised", "% funded"],
    rows: items.map((it) => {
      const p = Number(it.fields?.price) || 0;
      const r = Number(it.fields?.raised) || 0;
      return [it.title, p, r, p > 0 ? Math.round((r / p) * 100) + "%" : "—"];
    }),
  };

  return (
    <ToolPageWrapper
      toolId="buy-a-feature"
      title="Buy-a-Feature Game"
      description="Innovation game where stakeholders spend fake currency to 'buy' features. Surfaces real tradeoff conversations under a fixed budget."
    >
      <div ref={exportRef} className="space-y-4">
        <KPI label="Total raised" value={`$${totalRaised.toLocaleString()}`} />

        <SectionCard title="Add feature" icon={Plus}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input className="sm:col-span-2" placeholder="Feature" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <Button onClick={add} className="mt-3 gap-1"><Plus className="w-4 h-4" />Add</Button>
        </SectionCard>

        {items.length > 0 && (
          <SectionCard
            title="Marketplace"
            icon={CircleDollarSign}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton filename="buy-a-feature" csvData={csvData} jsonData={items} targetRef={exportRef} />
              </>
            }
          >
            <ul className="space-y-2">
              {sorted.map((it) => {
                const price = Number(it.fields?.price) || 0;
                const raised = Number(it.fields?.raised) || 0;
                const pct = price > 0 ? Math.min(100, Math.round((raised / price) * 100)) : 0;
                return (
                  <li key={it.id} className="border border-border bg-surface-deep rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-text">{it.title}</span>
                      <span className="text-xs text-sub font-mono">${raised}/${price} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-surface h-2 rounded overflow-hidden mb-2">
                      <div className="h-2 bg-emerald-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <BuyButton onBuy={(n) => buy(it, n)} />
                      <button onClick={() => { removeOne(it.id); log(BUY_FEATURE_ACTIONS.FEATURE_REMOVED, { id: it.id }); }} aria-label="Remove feature" className="ml-auto text-sub hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
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

function BuyButton({ onBuy }: { onBuy: (n: number) => void }) {
  const [amount, setAmount] = useState("10");
  return (
    <div className="flex items-center gap-1">
      <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-20 text-xs" />
      <Button size="sm" onClick={() => onBuy(parseFloat(amount) || 0)}>Buy</Button>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3 inline-block">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold mt-1 font-data">{value}</div>
    </div>
  );
}
