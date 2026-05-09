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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Lightbulb } from "lucide-react";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { generateHypothesisTrackerPrompts } from "@/lib/ai-prompts/hypothesis-tracker";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { emit as sonify } from "@/lib/sonification/emit";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";

type Status = "drafted" | "running" | "validated" | "invalidated" | "inconclusive";

interface Hypothesis {
  id: string;
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  experiment?: string;
  outcome?: string;
  status: Status;
  raisedAt: string;
  resolvedAt?: string;
}

function empty(): Hypothesis {
  return {
    id: nanoid(8),
    believe: "",
    willDo: "",
    toLearn: "",
    successMetric: "",
    status: "drafted",
    raisedAt: todayLocalISO(),
  };
}

function setStatus(h: Hypothesis, status: Status): Hypothesis {
  const done = status === "validated" || status === "invalidated" || status === "inconclusive";
  return { ...h, status, resolvedAt: done ? (h.resolvedAt ?? todayLocalISO()) : undefined };
}

export function HypothesisTrackerClient() {
  const [items, setItems] = usePersisted<Hypothesis[]>("agile-toolkit:hypothesis-tracker", []);
  const { log } = useHistoryLogger("hypothesis-tracker");

  const add = () => {
    const item = empty();
    setItems((s) => [item, ...s]);
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_ADDED, { hypothesisId: item.id });
  };
  const update = (id: string, patch: Partial<Hypothesis>) => {
    setItems((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_UPDATED, {
      hypothesisId: id,
      fields: Object.keys(patch),
    });
  };
  const updateStatus = (id: string, status: Status) => {
    if (status === "validated") sonify("hypothesis-tracker", "validated");
    else if (status === "invalidated") sonify("hypothesis-tracker", "invalidated");
    else sonify("hypothesis-tracker", "status-change");
    const prev = items.find((x) => x.id === id);
    setItems((s) => s.map((x) => (x.id === id ? setStatus(x, status) : x)));
    log(HYPOTHESIS_ACTIONS.STATUS_CHANGED, {
      hypothesisId: id,
      from: prev?.status,
      to: status,
    });
  };
  const remove = (id: string) => {
    const item = items.find((x) => x.id === id);
    setItems((s) => s.filter((x) => x.id !== id));
    log(HYPOTHESIS_ACTIONS.HYPOTHESIS_REMOVED, {
      hypothesisId: id,
      believe: item?.believe,
    });
  };

  const validationRate = useMemo(() => {
    const closed = items.filter((i) => i.resolvedAt);
    if (closed.length === 0) return 0;
    return closed.filter((i) => i.status === "validated").length / closed.length;
  }, [items]);

  const survivalCurve = useMemo(() => {
    const obs = durationsFromTimeRanges(items.map((i) => ({ raisedAt: i.raisedAt, resolvedAt: i.resolvedAt })));
    return kaplanMeier(obs);
  }, [items]);

  const medianTimeToValidate = medianSurvivalTime(survivalCurve);

  const promptConfig = useMemo(
    () => ({
      toolName: "Hypothesis Tracker",
      prompts: generateHypothesisTrackerPrompts({ items, validationRate, medianTimeToValidate }),
    }),
    [items, validationRate, medianTimeToValidate]
  );

  return (
    <ToolPageWrapper
      toolId="hypothesis-tracker"
      title="Hypothesis Tracker"
      description="Frame product bets as testable hypotheses. Track validation rate and median time-to-learn."
      category="Product Discovery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="hypotheses"
          csvData={{
            headers: ["Believe", "Will do", "To learn", "Success metric", "Experiment", "Outcome", "Status", "Raised", "Resolved"],
            rows: items.map((i) => [i.believe, i.willDo, i.toLearn, i.successMetric, i.experiment ?? "", i.outcome ?? "", i.status, i.raisedAt, i.resolvedAt ?? ""]),
          }}
          jsonData={items}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Hypothesis
        </Button>
      </ActionRow>

      <KpiGrid cols={3}>
        <StatCard variant="compact" label="Total" value={items.length} />
        <StatCard
          variant="compact"
          label="Validation Rate"
          value={`${Math.round(validationRate * 100)}%`}
          hint="of closed hypotheses"
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Median Time to Learn"
          value={medianTimeToValidate !== null ? `${medianTimeToValidate}d` : "—"}
        />
      </KpiGrid>

      <div className="space-y-3">
        {items.map((h) => (
          <Card key={h.id} className="bg-surface border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] uppercase text-sub mb-1">We believe</div>
                    <Textarea rows={2} value={h.believe} onChange={(e) => update(h.id, { believe: e.target.value })} placeholder="... that users want X" className="bg-bg border-border text-sm" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-sub mb-1">We will do</div>
                    <Textarea rows={2} value={h.willDo} onChange={(e) => update(h.id, { willDo: e.target.value })} placeholder="... ship feature Y" className="bg-bg border-border text-sm" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-sub mb-1">To learn</div>
                    <Textarea rows={2} value={h.toLearn} onChange={(e) => update(h.id, { toLearn: e.target.value })} placeholder="... whether users engage" className="bg-bg border-border text-sm" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <Select value={h.status} onValueChange={(v) => updateStatus(h.id, v as Status)}>
                    <SelectTrigger className="bg-bg border-border w-36 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["drafted", "running", "validated", "invalidated", "inconclusive"] as Status[]).map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => remove(h.id)} className="text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  value={h.successMetric}
                  onChange={(e) => update(h.id, { successMetric: e.target.value })}
                  placeholder="Success metric (e.g. 30% DAU activation within 14 days)"
                  className="bg-bg border-border text-sm"
                />
                <Input
                  value={h.experiment ?? ""}
                  onChange={(e) => update(h.id, { experiment: e.target.value })}
                  placeholder="Experiment design"
                  className="bg-bg border-border text-sm"
                />
              </div>
              {h.resolvedAt && (
                <Textarea
                  rows={2}
                  value={h.outcome ?? ""}
                  onChange={(e) => update(h.id, { outcome: e.target.value })}
                  placeholder="Outcome: what did we learn?"
                  className="bg-bg border-border text-sm"
                />
              )}
              <div className="text-xs text-sub flex items-center gap-3">
                <Badge variant="outline" className="capitalize">{h.status}</Badge>
                <span>raised {h.raisedAt}</span>
                {h.resolvedAt && <span>resolved {h.resolvedAt}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <EmptyState icon={Lightbulb}>
            No hypotheses yet. Click &ldquo;New Hypothesis&rdquo; to start.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
