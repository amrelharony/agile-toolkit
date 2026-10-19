"use client";

/**
 * Tab 4 — Velocity Summary. Sprint velocity + release-progress inputs with
 * derived completion-rate / release-progress bars and an exportable markdown
 * summary card.
 */

import { useId, useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useSprintReviewStore } from "../use-sprint-review-store";
import { NumCell } from "./form-fields";

export function VelocitySummaryTab() {
  const {
    committed,
    completed,
    totalBacklog,
    backlogDone,
    sprintName,
    sprintNumber,
    setCommitted,
    setCompleted,
    setTotalBacklog,
    setBacklogDone,
  } = useSprintReviewStore();
  const uid = useId();

  const completionRate = committed > 0 ? Math.round((completed / committed) * 100) : 0;
  const releaseProgress = totalBacklog > 0 ? Math.round((backlogDone / totalBacklog) * 100) : 0;

  const card = useMemo(
    () =>
      [
        `# Velocity Summary — Sprint ${sprintNumber}: ${sprintName}`,
        "",
        `## Sprint Velocity`,
        `- **Committed:** ${committed} points`,
        `- **Completed:** ${completed} points`,
        `- **Completion Rate:** ${completionRate}%`,
        "",
        `## Release Progress`,
        `- **Total Backlog:** ${totalBacklog} points`,
        `- **Done to Date:** ${backlogDone} points`,
        `- **Release Progress:** ${releaseProgress}%`,
        "",
        `_Generated ${new Date().toLocaleDateString()}_`,
      ].join("\n"),
    [
      sprintName,
      sprintNumber,
      committed,
      completed,
      completionRate,
      totalBacklog,
      backlogDone,
      releaseProgress,
    ]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Sprint velocity inputs */}
        <SectionCard title="Sprint Velocity" icon={BarChart3} contentClassName="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-committed`} className="text-sub text-xs">
              Committed Points
            </Label>
            <NumCell
              id={`${uid}-committed`}
              value={committed}
              onCommit={setCommitted}
              min={0}
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-completed`} className="text-sub text-xs">
              Completed Points
            </Label>
            <NumCell
              id={`${uid}-completed`}
              value={completed}
              onCommit={setCompleted}
              min={0}
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-sub">
              <span>Completion Rate</span>
              <span
                className="font-data font-bold"
                style={{
                  color:
                    completionRate >= 90 ? "#00ff88" : completionRate >= 70 ? "#ffaa00" : "#ef4444",
                }}
              >
                {completionRate}%
              </span>
            </div>
            <Progress value={completionRate} className="h-2 bg-card" />
          </div>
        </SectionCard>

        {/* Release progress inputs */}
        <SectionCard
          title="Release Progress"
          icon={BarChart3}
          iconClassName="text-accent-green"
          contentClassName="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-total`} className="text-sub text-xs">
              Total Backlog Points
            </Label>
            <NumCell
              id={`${uid}-total`}
              value={totalBacklog}
              onCommit={setTotalBacklog}
              min={0}
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-done`} className="text-sub text-xs">
              Done to Date
            </Label>
            <NumCell
              id={`${uid}-done`}
              value={backlogDone}
              onCommit={setBacklogDone}
              min={0}
              className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-sub">
              <span>Release Progress</span>
              <span
                className="font-data font-bold"
                style={{
                  color:
                    releaseProgress >= 75
                      ? "#00ff88"
                      : releaseProgress >= 40
                        ? "#ffaa00"
                        : "#00f0ff",
                }}
              >
                {releaseProgress}%
              </span>
            </div>
            <Progress value={releaseProgress} className="h-2 bg-card" />
          </div>
        </SectionCard>
      </div>

      {/* Generated velocity card */}
      <SectionCard
        title="Velocity Summary Card"
        actions={<ExportButton filename="velocity-summary" clipboardText={card} />}
      >
        <pre className="text-sm text-sub whitespace-pre-wrap font-mono leading-relaxed bg-surface-deep/60 rounded-lg p-4 border border-border">
          {card}
        </pre>
      </SectionCard>
    </div>
  );
}
