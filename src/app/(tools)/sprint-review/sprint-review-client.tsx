"use client";

import { useEffect, useMemo, useRef } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSprintReviewPrompts } from "@/lib/ai-prompts/sprint-review";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { todayLocalISO } from "@/lib/utils/formatters";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Presentation, MessageSquare, CheckSquare, BarChart3 } from "lucide-react";
import type { FeedbackCategory } from "./types";
import { useSprintReviewStore } from "./use-sprint-review-store";
import { DemoScriptTab } from "./components/demo-script-tab";
import { FeedbackTab } from "./components/feedback-tab";
import { ShowcaseChecklistTab } from "./components/showcase-checklist-tab";
import { VelocitySummaryTab } from "./components/velocity-summary-tab";

export function SprintReviewClient() {
  const {
    sprintName,
    sprintNumber,
    features,
    meetingDate,
    feedbackItems,
    checklistItems,
    committed,
    completed,
    totalBacklog,
    backlogDone,
    setMeetingDate,
    reset,
  } = useSprintReviewStore();

  // Initialize meetingDate on first client mount to avoid SSR/client time
  // drift. Only set when empty so we don't clobber user edits or persisted data.
  //
  // R5: previously re-fired every time `meetingDate` flipped to "" (user
  // intent to clear), immediately re-stamping today's date back — the
  // user couldn't ever blank the date input. Guard with a one-shot ref
  // so the auto-init runs exactly once on first mount.
  const meetingDateInitRef = useRef(false);
  useEffect(() => {
    if (meetingDateInitRef.current) return;
    meetingDateInitRef.current = true;
    if (!meetingDate) {
      setMeetingDate(todayLocalISO());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build combined markdown export
  const fullExport = useMemo(() => {
    const totalMinutes = features.reduce((s, f) => s + (f.timeMinutes || 0), 0);
    const completionRate = committed > 0 ? Math.round((completed / committed) * 100) : 0;
    const releaseProgress = totalBacklog > 0 ? Math.round((backlogDone / totalBacklog) * 100) : 0;
    const checkedCount = checklistItems.filter((c) => c.checked).length;

    const lines: string[] = [];
    lines.push(`# Sprint ${sprintNumber} Review Kit — ${sprintName}`);
    lines.push(`_Date: ${meetingDate}_`);
    lines.push("");

    // Demo Script
    lines.push("---");
    lines.push("## Demo Script");
    lines.push(`**Estimated Duration:** ${totalMinutes} minutes`);
    lines.push("");
    features.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.name || "Untitled Feature"} (${f.timeMinutes || 0} min)`);
      if (f.description) lines.push(`**Description:** ${f.description}`);
      if (f.acceptanceCriteria) lines.push(`**Acceptance Criteria:** ${f.acceptanceCriteria}`);
      lines.push("");
    });

    // Feedback
    lines.push("---");
    lines.push("## Stakeholder Feedback");
    if (feedbackItems.length === 0) {
      lines.push("_No feedback recorded._");
    } else {
      (["positive", "concern", "suggestion"] as FeedbackCategory[]).forEach((cat) => {
        const items = feedbackItems.filter((f) => f.category === cat);
        if (items.length > 0) {
          lines.push(`\n### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
          items.forEach((item) => {
            lines.push(`- **${item.stakeholder || "Unknown"}:** ${item.feedback || "—"}`);
          });
        }
      });
    }
    lines.push("");

    // Checklist
    lines.push("---");
    lines.push("## Showcase Checklist");
    lines.push(`Progress: ${checkedCount}/${checklistItems.length}`);
    lines.push("");
    checklistItems.forEach((c) => {
      lines.push(`- [${c.checked ? "x" : " "}] ${c.label}`);
    });
    lines.push("");

    // Velocity
    lines.push("---");
    lines.push("## Velocity Summary");
    lines.push(`- **Committed:** ${committed} points`);
    lines.push(`- **Completed:** ${completed} points`);
    lines.push(`- **Completion Rate:** ${completionRate}%`);
    lines.push(`- **Total Backlog:** ${totalBacklog} points`);
    lines.push(`- **Done to Date:** ${backlogDone} points`);
    lines.push(`- **Release Progress:** ${releaseProgress}%`);
    lines.push("");
    lines.push(`_Generated ${new Date().toLocaleDateString()}_`);

    return lines.join("\n");
  }, [
    sprintName,
    sprintNumber,
    features,
    meetingDate,
    feedbackItems,
    checklistItems,
    committed,
    completed,
    totalBacklog,
    backlogDone,
  ]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Review",
      prompts: generateSprintReviewPrompts({
        sprintName,
        sprintNumber: Number(sprintNumber),
        features: features.map((f) => ({
          name: f.name,
          description: f.description,
          timeMinutes: f.timeMinutes,
        })),
        feedbackItems: feedbackItems.map((f) => ({
          stakeholder: f.stakeholder,
          feedback: f.feedback,
          category: f.category,
        })),
        checklistItems: checklistItems.map((c) => ({ label: c.label, checked: c.checked })),
        committed,
        completed,
      }),
    }),
    [sprintName, sprintNumber, features, feedbackItems, checklistItems, committed, completed]
  );

  // ── Cross-tool signal: review activity in the last 30 days ────────────
  // Counts past demo additions + feedback captures so the user gets a
  // sense of cadence without leaving the page. Subscribes to the history
  // store's events so external logging is reflected immediately.
  const events = useHistoryStore((s) => s.events);
  const recentDemoCount = useMemo(
    () =>
      selectEvents({
        toolId: "sprint-review",
        action: "item_added",
        sinceDays: 30,
        limit: 200,
      }).length,
    [events]
  );
  const recentFeedbackCount = useMemo(
    () =>
      selectEvents({
        toolId: "sprint-review",
        action: "feedback_added",
        sinceDays: 30,
        limit: 200,
      }).length,
    [events]
  );

  return (
    <ToolPageWrapper
      toolId="sprint-review"
      title="Sprint Review Kit"
      description="Generate demo scripts, collect stakeholder feedback, run showcase checklists, and review velocity."
      category="Ceremonies"
    >
      <div className="space-y-6">
        {(recentDemoCount > 0 || recentFeedbackCount > 0) && (
          <CalloutAlert tone="info" className="mb-0">
            Last 30 days: <strong>{recentDemoCount}</strong> demo item
            {recentDemoCount === 1 ? "" : "s"} added
            {recentFeedbackCount > 0 && (
              <>
                {" · "}
                <strong>{recentFeedbackCount}</strong> feedback item
                {recentFeedbackCount === 1 ? "" : "s"} captured
              </>
            )}
            .
          </CalloutAlert>
        )}
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-sub">
            Sprint <span className="text-accent font-data font-semibold">#{sprintNumber}</span> —{" "}
            {sprintName}
          </div>
          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename={`sprint-${sprintNumber}-review`}
              clipboardText={fullExport}
              csvData={{
                // Single combined CSV — features + feedback share one sheet
                // with a Type column so spreadsheet users can filter without
                // juggling two downloads. Numeric/date columns stay typed
                // where they apply; cross-type columns degrade to "" on the
                // other row kind.
                headers: [
                  "Type",
                  "Name / Stakeholder",
                  "Description",
                  "Acceptance Criteria",
                  "Feedback",
                  "Category",
                  "Time (min)",
                ],
                rows: [
                  ...features.map(
                    (f) =>
                      [
                        "Feature",
                        f.name,
                        f.description,
                        f.acceptanceCriteria,
                        "",
                        "",
                        f.timeMinutes,
                      ] as (string | number)[]
                  ),
                  ...feedbackItems.map(
                    (fb) =>
                      ["Feedback", fb.stakeholder, "", "", fb.feedback, fb.category, ""] as (
                        | string
                        | number
                      )[]
                  ),
                ],
              }}
            />
            <Button variant="danger-ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="demo">
          <TabsList className="bg-surface-deep border border-border p-1 h-auto flex-wrap gap-1">
            <TabsTrigger
              value="demo"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <Presentation className="w-3.5 h-3.5" />
              Demo Script
            </TabsTrigger>
            <TabsTrigger
              value="feedback"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Stakeholder Feedback
            </TabsTrigger>
            <TabsTrigger
              value="checklist"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Showcase Checklist
            </TabsTrigger>
            <TabsTrigger
              value="velocity"
              className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent text-sub gap-1.5"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Velocity Summary
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="demo">
              <DemoScriptTab />
            </TabsContent>
            <TabsContent value="feedback">
              <FeedbackTab />
            </TabsContent>
            <TabsContent value="checklist">
              <ShowcaseChecklistTab />
            </TabsContent>
            <TabsContent value="velocity">
              <VelocitySummaryTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </ToolPageWrapper>
  );
}
