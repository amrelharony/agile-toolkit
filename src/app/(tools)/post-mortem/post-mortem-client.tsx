"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, ScrollText, AlertTriangle, BookOpenCheck, Activity } from "lucide-react";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { POST_MORTEM_ACTIONS } from "@/lib/history/event-actions";
import { generatePostMortemPrompts } from "@/lib/ai-prompts/post-mortem";
import { durationsFromTimeRanges, kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import type { ActionItem, PMStatus, PostMortem, TimelineEntry } from "./types";
import { insertByEventTime, isOverdue, isThisQuarter, todayIso } from "./helpers";
import { usePostMortemLog } from "./use-post-mortem-log";
import { PostMortemEditor } from "./components/post-mortem-editor";

// Recharts loads with the survival chart, not the page.
const TimeToPublishChart = dynamic(() => import("./charts").then((m) => m.TimeToPublishChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

interface NewPMDraft {
  title: string;
  incidentDate: string;
  description: string;
}

function emptyDraft(): NewPMDraft {
  return { title: "", incidentDate: todayIso(), description: "" };
}

export function PostMortemClient() {
  const [state, setState] = usePostMortemLog();
  const { log } = useHistoryLogger("post-mortem");
  const [draft, setDraft] = useState<NewPMDraft>(emptyDraft);

  const addPostMortem = () => {
    const title = draft.title.trim();
    if (!title) return;
    const pm: PostMortem = {
      id: crypto.randomUUID(),
      title,
      incidentDate: draft.incidentDate || todayIso(),
      status: "draft",
      contributingFactors: [],
      timeline: [],
      actions: [],
      description: draft.description.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ postmortems: [pm, ...s.postmortems] }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_ADDED, {
      postmortemId: pm.id,
      title: pm.title,
      incidentDate: pm.incidentDate,
      description: pm.description,
    });
    setDraft(emptyDraft());
  };

  const removePostMortem = (id: string) => {
    const pm = state.postmortems.find((p) => p.id === id);
    setState((s) => ({ postmortems: s.postmortems.filter((p) => p.id !== id) }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_REMOVED, {
      postmortemId: id,
      title: pm?.title,
    });
  };

  const updatePostMortem = (id: string, patch: Partial<PostMortem>) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      fields: Object.keys(patch),
    });
  };

  const setStatus = (id: string, status: PMStatus) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) => {
        if (p.id !== id) return p;
        const patch: Partial<PostMortem> = { status };
        // Stamp `publishedAt` only on the first transition into published —
        // re-entering published from review→published→review→published would
        // otherwise reset the time-to-publish duration.
        if (status === "published" && !p.publishedAt) {
          patch.publishedAt = new Date().toISOString();
        }
        return { ...p, ...patch };
      }),
    }));
    if (status === "published") {
      log(POST_MORTEM_ACTIONS.POSTMORTEM_PUBLISHED, { postmortemId: id });
    } else {
      log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
        postmortemId: id,
        fields: ["status"],
        status,
      });
    }
  };

  const addContributingFactor = (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, contributingFactors: [...p.contributingFactors, trimmed] } : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      fields: ["contributingFactors"],
    });
  };

  const removeContributingFactor = (id: string, idx: number) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id
          ? {
              ...p,
              contributingFactors: p.contributingFactors.filter((_, i) => i !== idx),
            }
          : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      fields: ["contributingFactors"],
    });
  };

  /**
   * `eventTime` is a `datetime-local` value (local time) for when the event
   * happened; blank means now. Entries used to be stamped with the time they
   * were typed in, so a timeline rebuilt after the incident had every event
   * at "now".
   */
  const addTimelineEntry = (id: string, author: string, text: string, eventTime?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const at = eventTime ? new Date(eventTime) : new Date();
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      ts: (Number.isFinite(at.getTime()) ? at : new Date()).toISOString(),
      author: author.trim() || "anonymous",
      text: trimmed,
    };
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, timeline: insertByEventTime(p.timeline, entry) } : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.TIMELINE_ADDED, {
      postmortemId: id,
      entryId: entry.id,
      author: entry.author,
    });
  };

  const removeTimelineEntry = (id: string, entryId: string) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, timeline: p.timeline.filter((e) => e.id !== entryId) } : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      fields: ["timeline"],
    });
  };

  const addAction = (id: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const action: ActionItem = {
      id: crypto.randomUUID(),
      text: trimmed,
      status: "open",
    };
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, actions: [...p.actions, action] } : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.ACTION_ADDED, {
      postmortemId: id,
      actionId: action.id,
      text: action.text,
    });
  };

  const updateAction = (id: string, actionId: string, patch: Partial<ActionItem>) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id
          ? {
              ...p,
              actions: p.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
            }
          : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      actionId,
      fields: Object.keys(patch),
    });
  };

  const removeAction = (id: string, actionId: string) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, actions: p.actions.filter((a) => a.id !== actionId) } : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.ACTION_REMOVED, {
      postmortemId: id,
      actionId,
    });
  };

  const drafts = useMemo(
    () => state.postmortems.filter((p) => p.status === "draft").length,
    [state.postmortems]
  );
  const inReview = useMemo(
    () => state.postmortems.filter((p) => p.status === "review").length,
    [state.postmortems]
  );
  const publishedThisQuarter = useMemo(
    () =>
      state.postmortems.filter((p) => p.status === "published" && isThisQuarter(p.incidentDate))
        .length,
    [state.postmortems]
  );
  const overdueActions = useMemo(
    () => state.postmortems.reduce((sum, p) => sum + p.actions.filter(isOverdue).length, 0),
    [state.postmortems]
  );

  // ── Tier-2: KM survival on time-to-publish (raised → published) ──
  // Pre-existing post-mortems lack `createdAt`; we fall back to
  // `incidentDate` so they still contribute to the curve. Pre-existing
  // published post-mortems also lack `publishedAt`; we drop those from the
  // event set rather than guess (would bias the median downward).
  const publishedDurations = useMemo(() => {
    return state.postmortems
      .filter((p) => p.status === "published" && p.publishedAt)
      .map((p) => {
        const startStr = p.createdAt ?? p.incidentDate;
        const start = new Date(startStr).getTime();
        const end = new Date(p.publishedAt!).getTime();
        return Math.max(0, Math.round((end - start) / 86_400_000));
      })
      .filter((d) => Number.isFinite(d));
  }, [state.postmortems]);

  const survivalCurve = useMemo(() => {
    if (publishedDurations.length < 4) return [];
    const obs = durationsFromTimeRanges(
      state.postmortems
        // Drop published items missing `publishedAt` entirely — including them
        // would have `durationsFromTimeRanges` censor them as "still alive
        // through today", biasing the curve toward longer survival.
        .filter(
          (p) => (p.createdAt || p.incidentDate) && (p.status !== "published" || p.publishedAt)
        )
        .map((p) => ({
          raisedAt: p.createdAt ?? p.incidentDate,
          resolvedAt: p.status === "published" ? p.publishedAt : undefined,
        }))
    );
    return kaplanMeier(obs);
  }, [state.postmortems, publishedDurations.length]);

  const medianTimeToPublish = useMemo(() => medianSurvivalTime(survivalCurve), [survivalCurve]);

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve]
  );

  // CSV — flatten all action items across post-mortems.
  const csvRows: (string | number)[][] = useMemo(() => {
    const rows: (string | number)[][] = [];
    for (const p of state.postmortems) {
      if (p.actions.length === 0) {
        rows.push([
          p.title,
          p.status,
          p.incidentDate,
          p.summary ?? "",
          "",
          "",
          "",
          "",
          p.description ?? "",
        ]);
        continue;
      }
      for (const a of p.actions) {
        rows.push([
          p.title,
          p.status,
          p.incidentDate,
          p.summary ?? "",
          a.text,
          a.owner ?? "",
          a.dueDate ?? "",
          a.status,
          p.description ?? "",
        ]);
      }
    }
    return rows;
  }, [state.postmortems]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Blameless Post-Mortem",
      prompts: generatePostMortemPrompts({
        postmortems: state.postmortems.map((p) => ({
          title: p.title,
          status: p.status,
          incidentDate: p.incidentDate,
          summary: p.summary,
          contributingFactors: p.contributingFactors,
          actionCount: p.actions.length,
          openActionCount: p.actions.filter((a) => a.status !== "done").length,
          description: p.description,
        })),
        drafts,
        inReview,
        publishedThisQuarter,
        overdueActions,
      }),
    }),
    [state.postmortems, drafts, inReview, publishedThisQuarter, overdueActions]
  );

  return (
    <ToolPageWrapper
      toolId="post-mortem"
      title="Blameless Post-Mortem"
      description="Author structured post-mortems with contributing factors, timeline, and tracked action items."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="post-mortem"
          csvData={{
            headers: [
              "Post-mortem",
              "Status",
              "Incident date",
              "Summary",
              "Action",
              "Owner",
              "Due",
              "Action status",
              "Description",
            ],
            rows: csvRows,
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={ScrollText}
          label="Drafts"
          value={drafts}
          hint="not yet in review"
        />
        <StatCard
          variant="compact"
          icon={BookOpenCheck}
          label="In review"
          value={inReview}
          tone={inReview > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={BookOpenCheck}
          label="Published (qtr)"
          value={publishedThisQuarter}
          hint="this quarter"
          tone={publishedThisQuarter > 0 ? "success" : "default"}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Overdue actions"
          value={overdueActions}
          tone={overdueActions > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      {survivalChartData.length > 1 && (
        <SectionCard
          title="Time-to-publish survival curve"
          icon={Activity}
          titleSuffix={medianTimeToPublish !== null ? `Median ${medianTimeToPublish}d` : undefined}
          className="mb-6"
        >
          <div className="h-40 -mx-2">
            <TimeToPublishChart data={survivalChartData} />
          </div>
          <p className="text-xs text-sub mt-2">
            Kaplan-Meier estimate over {publishedDurations.length} published post-mortem
            {publishedDurations.length === 1 ? "" : "s"} (drafts and in-review are right-censored).
            Y-axis: probability the post-mortem is still unpublished after N days.
          </p>
        </SectionCard>
      )}

      <SectionCard title="Create a post-mortem" icon={Plus} titleSize="lg" className="mb-6">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="pm-title" className="text-xs text-sub">
                Title
              </Label>
              <Input
                id="pm-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPostMortem();
                }}
                placeholder="e.g. Checkout 500 spike — 2026-05-08"
                className="bg-surface border-border"
              />
            </div>
            <div>
              <Label htmlFor="pm-date" className="text-xs text-sub">
                Incident date
              </Label>
              <Input
                id="pm-date"
                type="date"
                value={draft.incidentDate}
                onChange={(e) => setDraft((d) => ({ ...d, incidentDate: e.target.value }))}
                className="bg-surface border-border font-data"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pm-desc" className="text-xs text-sub">
              Description (optional)
            </Label>
            <Textarea
              id="pm-desc"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="One-line context: severity, blast radius, customer impact"
              rows={2}
              className="bg-surface border-border resize-none text-xs"
            />
          </div>
          <Button
            onClick={addPostMortem}
            className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Create post-mortem
          </Button>
        </div>
      </SectionCard>

      {state.postmortems.length === 0 ? (
        <EmptyState icon={ScrollText}>
          No post-mortems yet. Create one above to capture the incident summary, contributing
          factors, and follow-up actions.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {state.postmortems.map((pm) => (
            <PostMortemEditor
              key={pm.id}
              pm={pm}
              onUpdate={(patch) => updatePostMortem(pm.id, patch)}
              onSetStatus={(status) => setStatus(pm.id, status)}
              onRemove={() => removePostMortem(pm.id)}
              onAddFactor={(t) => addContributingFactor(pm.id, t)}
              onRemoveFactor={(i) => removeContributingFactor(pm.id, i)}
              onAddTimelineEntry={(author, text, eventTime) =>
                addTimelineEntry(pm.id, author, text, eventTime)
              }
              onRemoveTimelineEntry={(eId) => removeTimelineEntry(pm.id, eId)}
              onAddAction={(t) => addAction(pm.id, t)}
              onUpdateAction={(aId, patch) => updateAction(pm.id, aId, patch)}
              onRemoveAction={(aId) => removeAction(pm.id, aId)}
            />
          ))}
        </div>
      )}
    </ToolPageWrapper>
  );
}
