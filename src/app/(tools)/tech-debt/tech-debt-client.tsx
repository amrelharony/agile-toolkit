"use client";

import { useEffect, useMemo } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { WorkspaceSyncButton } from "@/components/shared/workspace-sync-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Wrench } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TechDebtItem } from "@/lib/stores/workspace-types";
import { generateTechDebtPrompts } from "@/lib/ai-prompts/tech-debt";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { TECH_DEBT_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";

function emptyItem(): TechDebtItem {
  return {
    id: nanoid(8),
    title: "",
    impact: 3,
    effort: 3,
    interestRate: 1,
    raisedAt: todayLocalISO(),
  };
}

function ageDays(item: TechDebtItem): number {
  return Math.floor((Date.now() - new Date(item.raisedAt).getTime()) / (1000 * 60 * 60 * 24));
}

function priorityScore(item: TechDebtItem): number {
  const interest = (item.interestRate ?? 0) * ageDays(item);
  return item.impact * 4 - item.effort + interest * 0.5;
}

export function TechDebtClient() {
  const [items, setItems] = usePersisted<TechDebtItem[]>("agile-toolkit:tech-debt", []);
  const workspaceDebt = useWorkspaceStore((s) => s.techDebt);
  const upsertDebt = useWorkspaceStore((s) => s.upsertTechDebt);
  const { log } = useHistoryLogger("tech-debt");

  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  const add = () => {
    const item = emptyItem();
    setItems((s) => [item, ...s]);
    log(TECH_DEBT_ACTIONS.ITEM_ADDED, { itemId: item.id });
  };
  const update = (id: string, patch: Partial<TechDebtItem>) => {
    const prev = items.find((x) => x.id === id);
    setItems((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (patch.resolvedAt && !prev?.resolvedAt) {
      log(TECH_DEBT_ACTIONS.ITEM_RESOLVED, { itemId: id, title: prev?.title });
    } else {
      log(TECH_DEBT_ACTIONS.ITEM_UPDATED, { itemId: id, fields: Object.keys(patch) });
    }
  };
  const remove = (id: string) => {
    const item = items.find((x) => x.id === id);
    setItems((s) => s.filter((x) => x.id !== id));
    log(TECH_DEBT_ACTIONS.ITEM_REMOVED, { itemId: id, title: item?.title });
  };

  const handleImport = () => {
    const fresh = workspaceDebt.filter((w) => !items.find((i) => i.id === w.id));
    setItems((s) => [...fresh, ...s]);
    return fresh.length;
  };
  const handlePush = () => {
    let n = 0;
    for (const i of items) {
      if (i.title.trim()) {
        upsertDebt(i);
        n++;
      }
    }
    return n;
  };

  const ranked = useMemo(() => items.slice().sort((a, b) => priorityScore(b) - priorityScore(a)), [items]);
  const totalInterestPerSprint = useMemo(
    () => items.filter((i) => !i.resolvedAt).reduce((a, b) => a + (b.interestRate ?? 0), 0),
    [items]
  );

  const hotspotMatrix = useMemo(() => {
    const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
    for (const i of items.filter((x) => !x.resolvedAt)) grid[i.impact - 1][i.effort - 1]++;
    return grid;
  }, [items]);

  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      if (!i.area) continue;
      m.set(i.area, (m.get(i.area) ?? 0) + i.impact);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Technical Debt Tracker",
      prompts: generateTechDebtPrompts({ items: ranked, totalInterestPerSprint }),
    }),
    [ranked, totalInterestPerSprint]
  );

  return (
    <ToolPageWrapper
      toolId="tech-debt"
      title="Technical Debt Tracker"
      description="Register tech debt with impact × effort, track interest cost per sprint, and find hotspots."
      category="Risk & Governance"
    >
      <ActionRow>
        <WorkspaceSyncButton toolName="Tech Debt" onImport={handleImport} onPush={handlePush} />
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="tech-debt"
          csvData={{
            headers: ["Title", "Area", "Impact", "Effort", "Interest/Sprint", "Age (d)", "Score"],
            rows: ranked.map((i) => [i.title, i.area ?? "", i.impact, i.effort, i.interestRate ?? 0, ageDays(i), priorityScore(i).toFixed(1)]),
          }}
          jsonData={items}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Debt
        </Button>
      </ActionRow>

      <KpiGrid cols={3}>
        <StatCard
          variant="compact"
          label="Open Items"
          value={items.filter((i) => !i.resolvedAt).length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Interest/Sprint"
          value={totalInterestPerSprint.toFixed(1)}
          valueClassName="text-amber-300"
          hint="velocity-units bleed"
        />
        <StatCard
          variant="compact"
          label="Top Hotspot"
          value={areas[0]?.[0] ?? "—"}
          valueClassName="text-lg truncate"
          hint={areas[0] ? `${areas[0][1]} impact points` : "Add areas to items"}
        />
      </KpiGrid>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-text mb-3">Impact × Effort Heatmap</div>
          <div className="grid grid-cols-6 gap-1 text-[10px]">
            <div />
            {[1, 2, 3, 4, 5].map((i) => <div key={`h${i}`} className="text-center text-sub font-data">E{i}</div>)}
            {[5, 4, 3, 2, 1].map((imp) => (
              <div key={`row${imp}`} style={{ display: "contents" }}>
                <div className="text-sub font-data text-right pr-1">I{imp}</div>
                {[1, 2, 3, 4, 5].map((eff) => {
                  const count = hotspotMatrix[imp - 1][eff - 1];
                  const intensity = Math.min(1, count / 5);
                  return (
                    <div key={`${imp}-${eff}`} className="h-8 rounded flex items-center justify-center font-data text-xs border"
                      style={{ background: `rgba(0,240,255,${intensity * 0.5})`, borderColor: `rgba(0,240,255,${intensity * 0.6})`, color: count ? "#00f0ff" : "#555" }}>
                      {count || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-xs text-sub mt-2">Top-left (high impact, low effort) = best paydown targets.</div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {ranked.map((i) => (
          <Card key={i.id} className="bg-surface border-border">
            <CardContent className="p-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_80px_80px_80px_60px_auto] gap-2 items-center">
                <Input value={i.title} onChange={(e) => update(i.id, { title: e.target.value })} placeholder="Debt item" className="bg-bg border-border" />
                <Input value={i.area ?? ""} onChange={(e) => update(i.id, { area: e.target.value })} placeholder="Area" className="bg-bg border-border" />
                <Select value={String(i.impact)} onValueChange={(v) => update(i.id, { impact: Number(v) as TechDebtItem["impact"] })}>
                  <SelectTrigger className="bg-bg border-border font-data"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>Impact {n}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={String(i.effort)} onValueChange={(v) => update(i.id, { effort: Number(v) as TechDebtItem["effort"] })}>
                  <SelectTrigger className="bg-bg border-border font-data"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>Effort {n}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.5" value={i.interestRate ?? 0} onChange={(e) => update(i.id, { interestRate: Number(e.target.value) })} placeholder="Int/sprint" className="bg-bg border-border font-data" />
                <div className="font-data text-sm text-accent text-center">{priorityScore(i).toFixed(0)}</div>
                <Button variant="ghost" size="sm" onClick={() => remove(i.id)} className="text-sub hover:text-danger">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <EmptyState icon={Wrench}>
            No debt logged. Click &ldquo;New Debt&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
