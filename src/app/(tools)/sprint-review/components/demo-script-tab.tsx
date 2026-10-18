"use client";

/**
 * Tab 1 — Demo Script. Sprint info, an editable feature list (name, time,
 * description, acceptance criteria), and a live-generated markdown demo script
 * with an export button.
 */

import { useId, useMemo } from "react";
import { Plus, Trash2, Presentation, Clock } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Label } from "@/components/ui/label";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_REVIEW_ACTIONS } from "@/lib/history/event-actions";
import { useSprintReviewStore } from "../use-sprint-review-store";
import { SectionLabel, NumCell } from "./form-fields";

export function DemoScriptTab() {
  const uid = useId();
  const {
    sprintName,
    sprintNumber,
    features,
    setSprintName,
    setSprintNumber,
    addFeature: addFeatureRaw,
    removeFeature: removeFeatureRaw,
    updateFeature,
  } = useSprintReviewStore();
  const { log } = useHistoryLogger("sprint-review");

  const addFeature: typeof addFeatureRaw = (...args) => {
    addFeatureRaw(...args);
    log(SPRINT_REVIEW_ACTIONS.ITEM_ADDED, {});
  };
  const removeFeature: typeof removeFeatureRaw = (id) => {
    const feature = features.find((f) => f.id === id);
    removeFeatureRaw(id);
    log(SPRINT_REVIEW_ACTIONS.ITEM_REMOVED, {
      featureId: id,
      name: feature?.name,
    });
  };

  const totalMinutes = features.reduce((s, f) => s + (f.timeMinutes || 0), 0);

  const script = useMemo(() => {
    const lines: string[] = [];
    lines.push(`# Sprint ${sprintNumber} Review — ${sprintName}`);
    lines.push(`**Estimated Duration:** ${totalMinutes} minutes`);
    lines.push("");
    features.forEach((f, i) => {
      lines.push(`## ${i + 1}. ${f.name || "Untitled Feature"} (${f.timeMinutes || 0} min)`);
      if (f.description) lines.push(`**Description:** ${f.description}`);
      if (f.acceptanceCriteria) lines.push(`**Acceptance Criteria:** ${f.acceptanceCriteria}`);
      lines.push("");
    });
    return lines.join("\n");
  }, [sprintName, sprintNumber, features, totalMinutes]);

  return (
    <div className="space-y-6">
      {/* Sprint info */}
      <SectionCard
        title="Sprint Info"
        icon={Presentation}
        contentClassName="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-sprint-name`} className="text-sub text-xs">
            Sprint Name
          </Label>
          <BlurInput
            id={`${uid}-sprint-name`}
            value={sprintName}
            onCommit={setSprintName}
            placeholder="e.g. Sprint Alpha"
            className="input-toolkit"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-sprint-number`} className="text-sub text-xs">
            Sprint Number
          </Label>
          <BlurInput
            id={`${uid}-sprint-number`}
            value={sprintNumber}
            onCommit={setSprintNumber}
            placeholder="e.g. 12"
            className="input-toolkit"
          />
        </div>
      </SectionCard>

      {/* Features list */}
      <SectionCard
        title="Features to Demo"
        icon={Clock}
        titleSuffix={`— Total: ${totalMinutes} min`}
        actions={
          <Button size="sm" variant="toolkit" onClick={addFeature} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Feature
          </Button>
        }
        contentClassName="space-y-4"
      >
        {features.length === 0 && (
          <p className="text-sm text-sub text-center py-4">No features yet. Add one above.</p>
        )}
        {features.map((f, i) => (
          <div
            key={f.id}
            className="border border-border rounded-lg p-4 space-y-3 bg-surface-deep/50"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-accent font-medium">Feature {i + 1}</span>
              <Button
                variant="danger-ghost"
                size="icon"
                onClick={() => removeFeature(f.id)}
                aria-label={`Delete feature ${i + 1}`}
                className="min-touch-coarse h-7 w-7"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1.5">
                <SectionLabel htmlFor={`${uid}-${f.id}-name`}>Feature Name</SectionLabel>
                <BlurInput
                  id={`${uid}-${f.id}-name`}
                  value={f.name}
                  onCommit={(v) => updateFeature(f.id, { name: v })}
                  placeholder="e.g. User Login Flow"
                  className="input-toolkit"
                />
              </div>
              <div className="space-y-1.5 w-28">
                <SectionLabel htmlFor={`${uid}-${f.id}-time`}>Time (min)</SectionLabel>
                <NumCell
                  id={`${uid}-${f.id}-time`}
                  value={f.timeMinutes}
                  onCommit={(n) => updateFeature(f.id, { timeMinutes: n })}
                  min={1}
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <SectionLabel htmlFor={`${uid}-${f.id}-description`}>Brief Description</SectionLabel>
              <BlurInput
                id={`${uid}-${f.id}-description`}
                value={f.description}
                onCommit={(v) => updateFeature(f.id, { description: v })}
                placeholder="What was built?"
                className="input-toolkit"
              />
            </div>
            <div className="space-y-1.5">
              <SectionLabel htmlFor={`${uid}-${f.id}-criteria`}>Acceptance Criteria</SectionLabel>
              <BlurTextarea
                id={`${uid}-${f.id}-criteria`}
                value={f.acceptanceCriteria}
                onCommit={(v) => updateFeature(f.id, { acceptanceCriteria: v })}
                placeholder="Given... When... Then..."
                rows={2}
                className="bg-surface-deep border-border text-text resize-none focus:border-accent/50"
              />
            </div>
          </div>
        ))}
      </SectionCard>

      {/* Generated script */}
      {features.length > 0 && (
        <SectionCard
          title="Generated Demo Script"
          actions={<ExportButton filename="demo-script" clipboardText={script} />}
        >
          <pre className="text-sm text-sub whitespace-pre-wrap font-mono leading-relaxed bg-surface-deep/60 rounded-lg p-4 border border-border">
            {script}
          </pre>
        </SectionCard>
      )}
    </div>
  );
}
