"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, Code, ShieldCheck, FileCode, Gauge, Lock, CircleHelp } from "lucide-react";
import { generateDodBuilderPrompts } from "@/lib/ai-prompts/dod-builder";
import { ActionRow } from "@/components/shared/action-row";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DOD_ACTIONS } from "@/lib/history/event-actions";

type CategoryId = "code" | "testing" | "docs" | "performance" | "security" | "other";

interface DodItem {
  id: string;
  label: string;
  category: CategoryId;
  required: boolean;
}

interface SprintAdherence {
  sprintName: string;
  completedItemIds: string[];
}

interface DodState {
  items: DodItem[];
  history: SprintAdherence[];
}

const STARTER: DodItem[] = [
  { id: "seed-code-review", label: "Code reviewed by peer", category: "code", required: true },
  { id: "seed-unit-tests", label: "Unit tests added/updated", category: "testing", required: true },
  { id: "seed-ci", label: "Integration tests pass in CI", category: "testing", required: true },
  { id: "seed-docs", label: "README or inline docs updated", category: "docs", required: false },
  { id: "seed-perf", label: "Load-tested against SLO", category: "performance", required: false },
  { id: "seed-security", label: "Security review for sensitive changes", category: "security", required: false },
];

const CATEGORIES: { id: CategoryId; label: string; icon: typeof Code }[] = [
  { id: "code", label: "Code", icon: Code },
  { id: "testing", label: "Testing", icon: ShieldCheck },
  { id: "docs", label: "Docs", icon: FileCode },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "security", label: "Security", icon: Lock },
  { id: "other", label: "Other", icon: CircleHelp },
];

export function DodBuilderClient() {
  const [state, setState] = usePersisted<DodState>("agile-toolkit:dod-builder", { items: STARTER, history: [] });
  const [newLabel, setNewLabel] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("code");
  const { log } = useHistoryLogger("dod-builder");

  const addItem = () => {
    if (!newLabel.trim()) return;
    const item: DodItem = { id: nanoid(6), label: newLabel.trim(), category: activeCategory, required: false };
    setState((s) => ({ ...s, items: [...s.items, item] }));
    log(DOD_ACTIONS.CRITERION_ADDED, {
      itemId: item.id,
      label: item.label,
      category: item.category,
    });
    setNewLabel("");
  };

  const toggleRequired = (id: string) => {
    setState((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === id ? { ...x, required: !x.required } : x)),
    }));
    const item = state.items.find((x) => x.id === id);
    log(DOD_ACTIONS.CRITERION_TOGGLED, {
      itemId: id,
      label: item?.label,
      required: !(item?.required ?? false),
    });
  };

  const remove = (id: string) => {
    const item = state.items.find((x) => x.id === id);
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
    log(DOD_ACTIONS.CRITERION_REMOVED, { itemId: id, label: item?.label });
  };

  const adherence = useMemo(() => {
    if (state.history.length === 0) return null;
    const last = state.history[state.history.length - 1];
    const required = state.items.filter((i) => i.required);
    const passed = required.filter((i) => last.completedItemIds.includes(i.id));
    return required.length > 0 ? passed.length / required.length : 0;
  }, [state]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Definition of Done Builder",
      prompts: generateDodBuilderPrompts({ items: state.items, history: state.history }),
    }),
    [state]
  );

  return (
    <ToolPageWrapper
      toolId="dod-builder"
      title="Definition of Done Builder"
      description="Assemble your team's DoD across categories and track per-sprint adherence."
      category="Risk & Governance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="definition-of-done"
          csvData={{
            headers: ["Category", "Item", "Required"],
            rows: state.items.map((i) => [i.category, i.label, i.required ? "Yes" : "No"]),
          }}
          jsonData={state}
        />
      </ActionRow>

      {adherence !== null && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-sub">Last sprint DoD adherence</div>
              <div className="text-2xl font-data text-accent">{Math.round(adherence * 100)}%</div>
            </div>
            <Progress value={adherence * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as CategoryId)}>
        <TabsList className="bg-surface border border-border mb-4">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const count = state.items.filter((i) => i.category === c.id).length;
            return (
              <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {c.label}
                <span className="text-text/50 font-data text-xs">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATEGORIES.map((c) => (
          <TabsContent key={c.id} value={c.id} className="space-y-2">
            {state.items
              .filter((i) => i.category === c.id)
              .map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleRequired(item.id)}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
                      item.required
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-border text-sub hover:border-accent/30"
                    }`}
                  >
                    {item.required ? "Required" : "Optional"}
                  </button>
                  <span className="flex-1 text-text text-sm">{item.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(item.id)}
                    className="text-sub hover:text-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            <div className="flex gap-2 pt-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                placeholder={`Add ${c.label.toLowerCase()} item...`}
                className="bg-bg border-border"
              />
              <Button onClick={addItem} className="gap-2 bg-accent text-bg hover:bg-accent/90">
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </ToolPageWrapper>
  );
}
