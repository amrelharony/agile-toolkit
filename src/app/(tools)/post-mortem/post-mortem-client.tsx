"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ScrollText,
  ListChecks,
  AlertTriangle,
  BookOpenCheck,
  Activity,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { POST_MORTEM_ACTIONS } from "@/lib/history/event-actions";
import { generatePostMortemPrompts } from "@/lib/ai-prompts/post-mortem";
import { chartTheme } from "@/components/charts/chart-theme";
import {
  durationsFromTimeRanges,
  kaplanMeier,
  medianSurvivalTime,
} from "@/lib/analytics/survival";

type PMStatus = "draft" | "review" | "published";
type ActionStatus = "open" | "in_progress" | "done";

interface ActionItem {
  id: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: ActionStatus;
}

interface TimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

interface PostMortem {
  id: string;
  title: string;
  incidentDate: string;
  status: PMStatus;
  summary?: string;
  contributingFactors: string[];
  timeline: TimelineEntry[];
  actions: ActionItem[];
  description?: string;
  /** ISO timestamp when the post-mortem was created (raised). Optional for
   *  backward compatibility with persisted records that pre-date this field. */
  createdAt?: string;
  /** ISO timestamp when status first transitioned to "published". */
  publishedAt?: string;
}

interface PMState {
  postmortems: PostMortem[];
}

const DEFAULT_STATE: PMState = { postmortems: [] };

const STATUS_BADGE: Record<PMStatus, string> = {
  draft: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  review: "bg-accent/10 text-accent border-accent/30",
  published: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  open: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_progress: "bg-accent/10 text-accent border-accent/30",
  done: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isThisQuarter(iso: string): boolean {
  // Parse YYYY-MM-DD as a *local* date so an incident on the first or last
  // day of a quarter doesn't get bumped into the wrong bucket by UTC drift.
  const d = parseLocalDate(iso);
  if (!d) return false;
  const now = new Date();
  const q = (m: number) => Math.floor(m / 3);
  return d.getFullYear() === now.getFullYear() && q(d.getMonth()) === q(now.getMonth());
}

function isOverdue(a: ActionItem): boolean {
  if (a.status === "done" || !a.dueDate) return false;
  const due = new Date(a.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

interface NewPMDraft {
  title: string;
  incidentDate: string;
  description: string;
}

function emptyDraft(): NewPMDraft {
  return { title: "", incidentDate: todayIso(), description: "" };
}

export function PostMortemClient() {
  const [state, setState] = usePersisted<PMState>(
    "agile-toolkit:post-mortem",
    DEFAULT_STATE
  );
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
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, ...patch } : p
      ),
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
        p.id === id
          ? { ...p, contributingFactors: [...p.contributingFactors, trimmed] }
          : p
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
              contributingFactors: p.contributingFactors.filter(
                (_, i) => i !== idx
              ),
            }
          : p
      ),
    }));
    log(POST_MORTEM_ACTIONS.POSTMORTEM_UPDATED, {
      postmortemId: id,
      fields: ["contributingFactors"],
    });
  };

  const addTimelineEntry = (id: string, author: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      author: author.trim() || "anonymous",
      text: trimmed,
    };
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id ? { ...p, timeline: [...p.timeline, entry] } : p
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
        p.id === id
          ? { ...p, timeline: p.timeline.filter((e) => e.id !== entryId) }
          : p
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

  const updateAction = (
    id: string,
    actionId: string,
    patch: Partial<ActionItem>
  ) => {
    setState((s) => ({
      postmortems: s.postmortems.map((p) =>
        p.id === id
          ? {
              ...p,
              actions: p.actions.map((a) =>
                a.id === actionId ? { ...a, ...patch } : a
              ),
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
        p.id === id
          ? { ...p, actions: p.actions.filter((a) => a.id !== actionId) }
          : p
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
      state.postmortems.filter(
        (p) => p.status === "published" && isThisQuarter(p.incidentDate)
      ).length,
    [state.postmortems]
  );
  const overdueActions = useMemo(
    () =>
      state.postmortems.reduce(
        (sum, p) => sum + p.actions.filter(isOverdue).length,
        0
      ),
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
        .filter((p) => p.createdAt || p.incidentDate)
        .map((p) => ({
          raisedAt: p.createdAt ?? p.incidentDate,
          resolvedAt: p.status === "published" ? p.publishedAt : undefined,
        })),
    );
    return kaplanMeier(obs);
  }, [state.postmortems, publishedDurations.length]);

  const medianTimeToPublish = useMemo(
    () => medianSurvivalTime(survivalCurve),
    [survivalCurve],
  );

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve],
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
          titleSuffix={
            medianTimeToPublish !== null ? `Median ${medianTimeToPublish}d` : undefined
          }
          className="mb-6"
        >
          <div className="h-40 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={survivalChartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  label={{
                    value: "days",
                    fill: chartTheme.axisColor,
                    fontSize: 10,
                    position: "insideBottom",
                    offset: -2,
                  }}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  contentStyle={chartTheme.tooltipStyle}
                  formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still unpublished"]}
                  labelFormatter={(v) => `${v}d`}
                />
                <Line
                  type="stepAfter"
                  dataKey="survival"
                  stroke={chartTheme.colors.cyan}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-sub mt-2">
            Kaplan-Meier estimate over {publishedDurations.length} published
            post-mortem{publishedDurations.length === 1 ? "" : "s"} (drafts and
            in-review are right-censored). Y-axis: probability the post-mortem
            is still unpublished after N days.
          </p>
        </SectionCard>
      )}

      <SectionCard
        title="Create a post-mortem"
        icon={Plus}
        titleSize="lg"
        className="mb-6"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="pm-title" className="text-xs text-sub">
                Title
              </Label>
              <Input
                id="pm-title"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
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
                onChange={(e) =>
                  setDraft((d) => ({ ...d, incidentDate: e.target.value }))
                }
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
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
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
          No post-mortems yet. Create one above to capture the incident
          summary, contributing factors, and follow-up actions.
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
              onAddTimelineEntry={(author, text) =>
                addTimelineEntry(pm.id, author, text)
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

function PostMortemEditor({
  pm,
  onUpdate,
  onSetStatus,
  onRemove,
  onAddFactor,
  onRemoveFactor,
  onAddTimelineEntry,
  onRemoveTimelineEntry,
  onAddAction,
  onUpdateAction,
  onRemoveAction,
}: {
  pm: PostMortem;
  onUpdate: (patch: Partial<PostMortem>) => void;
  onSetStatus: (s: PMStatus) => void;
  onRemove: () => void;
  onAddFactor: (text: string) => void;
  onRemoveFactor: (idx: number) => void;
  onAddTimelineEntry: (author: string, text: string) => void;
  onRemoveTimelineEntry: (id: string) => void;
  onAddAction: (text: string) => void;
  onUpdateAction: (id: string, patch: Partial<ActionItem>) => void;
  onRemoveAction: (id: string) => void;
}) {
  const [summaryDraft, setSummaryDraft] = useState(pm.summary ?? "");
  useEffect(() => setSummaryDraft(pm.summary ?? ""), [pm.summary]);

  const [factorDraft, setFactorDraft] = useState("");
  const [tlAuthor, setTlAuthor] = useState("");
  const [tlText, setTlText] = useState("");
  const [actionDraft, setActionDraft] = useState("");

  const openCount = pm.actions.filter((a) => a.status !== "done").length;

  return (
    <SectionCard
      title={pm.title}
      icon={ScrollText}
      titleSize="lg"
      titleSuffix={
        <Badge variant="outline" className={STATUS_BADGE[pm.status]}>
          {pm.status}
        </Badge>
      }
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={pm.status}
            onValueChange={(v) => onSetStatus(v as PMStatus)}
          >
            <SelectTrigger
              className="h-8 w-32 text-xs bg-surface border-border"
              aria-label={`Status for ${pm.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="review">In review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Delete ${pm.title}`}
            className="h-8 w-8 p-0 text-sub hover:text-danger"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="text-xs text-sub flex items-center gap-3">
          <span>
            Incident date:{" "}
            <span className="font-data text-text">{pm.incidentDate}</span>
          </span>
          <span>
            {pm.actions.length} actions · {openCount} open
          </span>
        </div>
        {pm.description && (
          <p className="text-xs text-sub whitespace-pre-wrap break-words">
            {pm.description}
          </p>
        )}

        <div>
          <Label className="text-xs text-sub">Summary</Label>
          <Textarea
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            onBlur={() => {
              if (summaryDraft.trim() !== (pm.summary ?? "")) {
                onUpdate({ summary: summaryDraft.trim() || undefined });
              }
            }}
            placeholder="What happened, in plain language. Skip blame."
            rows={4}
            className="bg-surface border-border resize-y text-xs"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub flex items-center gap-1">
              <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
              Contributing factors
            </span>
          </div>
          {pm.contributingFactors.length === 0 ? (
            <p className="text-xs text-sub italic mb-2">
              Add at least 2-3 factors. A single 'root cause' usually means the
              real story isn't told yet.
            </p>
          ) : (
            <ul className="space-y-1.5 mb-2">
              {pm.contributingFactors.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-md border border-border bg-bg text-xs"
                >
                  <span className="font-data text-sub shrink-0">{i + 1}.</span>
                  <span className="flex-1 text-text whitespace-pre-wrap break-words">
                    {f}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveFactor(i)}
                    className="h-6 w-6 p-0 text-sub hover:text-danger"
                    aria-label={`Remove factor ${i + 1}`}
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={factorDraft}
              onChange={(e) => setFactorDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddFactor(factorDraft);
                  setFactorDraft("");
                }
              }}
              placeholder="A contributing factor…"
              className="bg-surface border-border flex-1"
              aria-label="New contributing factor"
            />
            <Button
              onClick={() => {
                onAddFactor(factorDraft);
                setFactorDraft("");
              }}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Factor
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub">
              Timeline ({pm.timeline.length})
            </span>
          </div>
          {pm.timeline.length === 0 && (
            <p className="text-xs text-sub italic mb-2">
              Reconstruct the incident timeline. One line per significant event.
            </p>
          )}
          {pm.timeline.length > 0 && (
            <ul className="space-y-1.5 mb-2 max-h-48 overflow-y-auto pr-2">
              {pm.timeline.map((e) => (
                <li
                  key={e.id}
                  className="text-xs border-l-2 border-accent/40 pl-2 flex items-start gap-2"
                >
                  <div className="flex-1">
                    <span className="font-data text-sub mr-2">
                      {new Date(e.ts).toLocaleString()}
                    </span>
                    <span className="text-accent mr-2">{e.author}:</span>
                    <span className="text-text whitespace-pre-wrap break-words">
                      {e.text}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveTimelineEntry(e.id)}
                    className="h-6 w-6 p-0 text-sub hover:text-danger"
                    aria-label="Remove entry"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={tlAuthor}
              onChange={(e) => setTlAuthor(e.target.value)}
              placeholder="Author"
              className="bg-surface border-border sm:w-32"
              aria-label="Timeline entry author"
            />
            <Input
              value={tlText}
              onChange={(e) => setTlText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddTimelineEntry(tlAuthor, tlText);
                  setTlText("");
                }
              }}
              placeholder="What happened…"
              className="bg-surface border-border flex-1"
              aria-label="Timeline entry text"
            />
            <Button
              onClick={() => {
                onAddTimelineEntry(tlAuthor, tlText);
                setTlText("");
              }}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Entry
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub">
              Action items ({pm.actions.length})
            </span>
          </div>
          {pm.actions.length > 0 && (
            <ul className="space-y-2 mb-2">
              {pm.actions.map((a) => (
                <ActionItemRow
                  key={a.id}
                  action={a}
                  overdue={isOverdue(a)}
                  onUpdate={(patch) => onUpdateAction(a.id, patch)}
                  onRemove={() => onRemoveAction(a.id)}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onAddAction(actionDraft);
                  setActionDraft("");
                }
              }}
              placeholder="A follow-up action…"
              className="bg-surface border-border flex-1"
              aria-label="New action item"
            />
            <Button
              onClick={() => {
                onAddAction(actionDraft);
                setActionDraft("");
              }}
              variant="outline"
              className="border-border text-sub hover:text-accent hover:border-accent/40"
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Action
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function ActionItemRow({
  action,
  overdue,
  onUpdate,
  onRemove,
}: {
  action: ActionItem;
  overdue: boolean;
  onUpdate: (patch: Partial<ActionItem>) => void;
  onRemove: () => void;
}) {
  const [textDraft, setTextDraft] = useState(action.text);
  const [ownerDraft, setOwnerDraft] = useState(action.owner ?? "");
  const [dueDraft, setDueDraft] = useState(action.dueDate ?? "");
  useEffect(() => setTextDraft(action.text), [action.text]);
  useEffect(() => setOwnerDraft(action.owner ?? ""), [action.owner]);
  useEffect(() => setDueDraft(action.dueDate ?? ""), [action.dueDate]);

  return (
    <li
      className={`p-2 rounded-md border ${
        overdue ? "border-danger/40 bg-danger/5" : "border-border bg-bg"
      } space-y-2`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={action.status === "done"}
          onChange={(e) => {
            // Unchecking from done shouldn't drop work back to "open" — if
            // it had been in_progress before, prefer that. Use in_progress
            // as the safer fallback for "uncheck after marking done".
            if (e.target.checked) {
              onUpdate({ status: "done" });
            } else {
              onUpdate({
                status: action.status === "done" ? "in_progress" : "open",
              });
            }
          }}
          aria-label={`Toggle done for ${action.text}`}
          className="mt-1 shrink-0 accent-emerald-400"
        />
        <Textarea
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={() => {
            const next = textDraft.trim();
            if (next && next !== action.text) onUpdate({ text: next });
            else if (!next) setTextDraft(action.text);
          }}
          rows={1}
          className="bg-surface border-border resize-none text-xs flex-1"
          aria-label="Action text"
        />
        <Badge variant="outline" className={ACTION_STATUS_BADGE[action.status]}>
          {action.status === "in_progress" ? "wip" : action.status}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0 text-sub hover:text-danger"
          aria-label="Remove action"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-sub">
            Owner
          </Label>
          <Input
            value={ownerDraft}
            onChange={(e) => setOwnerDraft(e.target.value)}
            onBlur={() => {
              const next = ownerDraft.trim();
              if (next !== (action.owner ?? "")) {
                onUpdate({ owner: next || undefined });
              }
            }}
            placeholder="@owner"
            className="bg-surface border-border h-8 text-xs"
            aria-label="Owner"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-sub">
            Due
          </Label>
          <Input
            type="date"
            value={dueDraft}
            onChange={(e) => setDueDraft(e.target.value)}
            onBlur={() => {
              if (dueDraft !== (action.dueDate ?? "")) {
                onUpdate({ dueDate: dueDraft || undefined });
              }
            }}
            className="bg-surface border-border font-data h-8 text-xs"
            aria-label="Due date"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-sub">
            Status
          </Label>
          <Select
            value={action.status}
            onValueChange={(v) => onUpdate({ status: v as ActionStatus })}
          >
            <SelectTrigger
              className="h-8 text-xs bg-surface border-border"
              aria-label="Action status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </li>
  );
}
