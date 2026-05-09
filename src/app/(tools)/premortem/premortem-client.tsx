"use client";

import { useMemo } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ScrollText, ChevronUp, ChevronDown } from "lucide-react";
import { generatePremortemPrompts } from "@/lib/ai-prompts/premortem";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PREMORTEM_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { usePersisted } from "@/lib/utils/use-persisted";

interface Cause {
  id: string;
  text: string;
  likelihood: number;
  impact: number;
  preventiveAction?: string;
  owner?: string;
}

interface State {
  scenario: string;
  causes: Cause[];
}

const DEFAULT_STATE: State = { scenario: "", causes: [] };

export function PremortemClient() {
  const [state, setState] = usePersisted<State>("agile-toolkit:premortem", DEFAULT_STATE);
  const { log } = useHistoryLogger("premortem");

  const add = () => {
    const cause = { id: nanoid(6), text: "", likelihood: 3, impact: 3 };
    setState((s) => ({ ...s, causes: [...s.causes, cause] }));
    log(PREMORTEM_ACTIONS.CAUSE_ADDED, { causeId: cause.id });
  };
  const update = (id: string, patch: Partial<Cause>) => {
    setState((s) => ({ ...s, causes: s.causes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    if (patch.preventiveAction !== undefined && patch.preventiveAction.trim().length > 0) {
      log(PREMORTEM_ACTIONS.PREVENTION_ADDED, {
        causeId: id,
        owner: patch.owner,
      });
    }
  };
  const remove = (id: string) => {
    const cause = state.causes.find((c) => c.id === id);
    setState((s) => ({ ...s, causes: s.causes.filter((c) => c.id !== id) }));
    log(PREMORTEM_ACTIONS.CAUSE_REMOVED, { causeId: id, text: cause?.text });
  };
  const move = (id: string, dir: -1 | 1) =>
    setState((s) => {
      const idx = s.causes.findIndex((c) => c.id === id);
      if (idx < 0) return s;
      const next = idx + dir;
      if (next < 0 || next >= s.causes.length) return s;
      const copy = s.causes.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return { ...s, causes: copy };
    });

  const ranked = useMemo(
    () => state.causes.slice().sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact),
    [state.causes]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Premortem Facilitator",
      prompts: generatePremortemPrompts({ scenario: state.scenario, causes: state.causes }),
    }),
    [state]
  );

  return (
    <ToolPageWrapper
      toolId="premortem"
      title="Premortem Facilitator"
      description="Imagine this project failed — what would have caused it? Rank causes and turn them into preventive actions."
      category="Risk & Governance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="premortem"
          csvData={{
            headers: ["Cause", "Likelihood", "Impact", "Score", "Preventive Action", "Owner"],
            rows: ranked.map((c) => [c.text, c.likelihood, c.impact, c.likelihood * c.impact, c.preventiveAction ?? "", c.owner ?? ""]),
          }}
          jsonData={state}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Cause
        </Button>
      </ActionRow>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-accent" />
            Imagined Failure Scenario
          </div>
          <Textarea
            rows={3}
            value={state.scenario}
            onChange={(e) => setState((s) => ({ ...s, scenario: e.target.value }))}
            placeholder={`It's 6 months from now. The project shipped but is widely considered a failure. Describe what that looks like in concrete terms.`}
            className="bg-bg border-border"
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {state.causes.map((c, idx) => {
          const score = c.likelihood * c.impact;
          return (
            <Card key={c.id} className="bg-surface border-border">
              <CardContent className="p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_80px_80px_80px_auto] gap-2 items-center">
                  <div className="flex flex-col">
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-sub" onClick={() => move(c.id, -1)}>
                      <ChevronUp className="w-3 h-3" />
                    </Button>
                    <span className="text-[10px] text-sub font-data text-center">{idx + 1}</span>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-sub" onClick={() => move(c.id, 1)}>
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </div>
                  <Input
                    value={c.text}
                    onChange={(e) => update(c.id, { text: e.target.value })}
                    placeholder="Cause of failure..."
                    className="bg-bg border-border"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={c.likelihood}
                    onChange={(e) => update(c.id, { likelihood: Number(e.target.value) })}
                    placeholder="L"
                    className="bg-bg border-border font-data"
                    title="Likelihood 1-5"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={c.impact}
                    onChange={(e) => update(c.id, { impact: Number(e.target.value) })}
                    placeholder="I"
                    className="bg-bg border-border font-data"
                    title="Impact 1-5"
                  />
                  <span className="px-2 py-1 rounded-md font-data text-sm text-center text-accent border border-accent/40 bg-accent/10">
                    {score}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove(c.id)} className="text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-2">
                  <Textarea
                    rows={1}
                    value={c.preventiveAction ?? ""}
                    onChange={(e) => update(c.id, { preventiveAction: e.target.value })}
                    placeholder="Preventive action..."
                    className="bg-bg border-border text-sm"
                  />
                  <Input
                    value={c.owner ?? ""}
                    onChange={(e) => update(c.id, { owner: e.target.value })}
                    placeholder="Owner"
                    className="bg-bg border-border text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
