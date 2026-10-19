"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { undoable } from "@/lib/utils/undoable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, User, Layers, GitBranch, AlertCircle } from "lucide-react";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { JTBD_ACTIONS } from "@/lib/history/event-actions";
import { generateJtbdPrompts } from "@/lib/ai-prompts/jtbd-mapper";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

interface JobStory {
  id: string;
  situation: string;
  motivation: string;
  outcome: string;
  parentJobId?: string;
  description?: string;
}

function renderJobLabel(j: JobStory): string {
  return `When ${j.situation || "(situation)"}, I want to ${j.motivation || "(motivation)"}, so I can ${j.outcome || "(outcome)"}.`;
}

/**
 * Ids of every job nested under `id` (children, grandchildren, ...), not
 * including `id`. Stops on cycles.
 */
function descendantIds(jobs: JobStory[], id: string): Set<string> {
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of jobs) {
      if (j.parentJobId && found.has(j.parentJobId) && !found.has(j.id)) {
        found.add(j.id);
        grew = true;
      }
    }
  }
  found.delete(id);
  return found;
}

/**
 * Compute the deepest descendant chain. Uses a visited set so a corrupted
 * import with cyclic parentJobId doesn't loop forever.
 */
function computeMaxDepth(jobs: JobStory[]): number {
  const childrenByParent = new Map<string, JobStory[]>();
  for (const j of jobs) {
    if (j.parentJobId) {
      const list = childrenByParent.get(j.parentJobId) ?? [];
      list.push(j);
      childrenByParent.set(j.parentJobId, list);
    }
  }
  const roots = jobs.filter((j) => !j.parentJobId);
  let maxDepth = roots.length === 0 ? 0 : 1;

  const walk = (id: string, depth: number, visited: Set<string>) => {
    if (visited.has(id)) return;
    visited.add(id);
    if (depth > maxDepth) maxDepth = depth;
    for (const c of childrenByParent.get(id) ?? []) {
      walk(c.id, depth + 1, visited);
    }
  };
  for (const r of roots) walk(r.id, 1, new Set());
  return maxDepth;
}

export function JtbdMapperClient() {
  const jobs = useWorkspaceStore(useShallow((s) => s.jobStories ?? []));
  // Mirrors the old usePersisted [value, setter] over the synced collection
  // (whole-array replace), so every setJobs(...) call site below is unchanged.
  const setJobs = (updater: JobStory[] | ((prev: JobStory[]) => JobStory[])) => {
    const cur = useWorkspaceStore.getState().jobStories ?? [];
    const next = typeof updater === "function" ? updater(cur) : updater;
    useWorkspaceStore.setState({ jobStories: next });
  };
  const { log } = useHistoryLogger("jtbd-mapper");

  // Form state for adding a new story.
  const [situation, setSituation] = useState("");
  const [motivation, setMotivation] = useState("");
  const [outcome, setOutcome] = useState("");
  const [description, setDescription] = useState("");
  const [parentJobId, setParentJobId] = useState<string>("__none__");

  // Editing state — track which job is being edited.
  const [editingId, setEditingId] = useState<string | null>(null);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, JobStory[]>();
    for (const j of jobs) {
      if (j.parentJobId) {
        const list = map.get(j.parentJobId) ?? [];
        list.push(j);
        map.set(j.parentJobId, list);
      }
    }
    return map;
  }, [jobs]);

  const rootJobs = useMemo(() => jobs.filter((j) => !j.parentJobId), [jobs]);
  const maxDepth = useMemo(() => computeMaxDepth(jobs), [jobs]);
  const jobsWithoutChildren = useMemo(
    () => jobs.filter((j) => !childrenByParent.has(j.id)).length,
    [jobs, childrenByParent]
  );

  const addJob = () => {
    if (!situation.trim() && !motivation.trim() && !outcome.trim()) return;
    const id = crypto.randomUUID();
    // Bound each clause of the job-story sentence. The renderer line-clamps
    // these on display but stored values were unbounded — a paste could
    // bloat the export CSV beyond what Excel/Sheets handles cleanly.
    const desc = description.trim().slice(0, 4000);
    // Validate parentJobId against the existing job set so a stale
    // persisted value can't orphan-link a new story to a deleted parent.
    const validParent =
      parentJobId === "__none__" || !parentJobId
        ? undefined
        : jobs.some((j) => j.id === parentJobId)
          ? parentJobId
          : undefined;
    const job: JobStory = {
      id,
      situation: situation.trim().slice(0, 500),
      motivation: motivation.trim().slice(0, 500),
      outcome: outcome.trim().slice(0, 500),
      parentJobId: validParent,
      description: desc.length > 0 ? desc : undefined,
    };
    setJobs((s) => [...s, job]);
    log(JTBD_ACTIONS.JOB_STORY_ADDED, {
      jobId: id,
      situation: job.situation,
      motivation: job.motivation,
      outcome: job.outcome,
      parentJobId: job.parentJobId,
      description: job.description,
    });
    setSituation("");
    setMotivation("");
    setOutcome("");
    setDescription("");
    setParentJobId("__none__");
  };

  const updateJob = (id: string, patch: Partial<JobStory>) => {
    // BUG-T4-jtbd-mapper-1: if the patch reparents this job, walk the
    // proposed parent's ancestry to ensure assigning `patch.parentJobId`
    // wouldn't create a cycle. Reject silently (preserve current parent)
    // when a cycle would result. Bare equality check covers the
    // self-parent case.
    if (patch.parentJobId !== undefined && patch.parentJobId !== null) {
      const newParent = patch.parentJobId;
      if (newParent === id) {
        // self-parent: drop the patch.parentJobId field.
        patch = { ...patch };
        delete patch.parentJobId;
      } else {
        const byId = new Map(jobs.map((j) => [j.id, j]));
        const seen = new Set<string>([id]);
        let cursor: string | undefined | null = newParent;
        let cycle = false;
        while (cursor) {
          if (seen.has(cursor)) {
            cycle = true;
            break;
          }
          seen.add(cursor);
          cursor = byId.get(cursor)?.parentJobId;
        }
        if (cycle) {
          patch = { ...patch };
          delete patch.parentJobId;
        }
      }
    }
    setJobs((s) => s.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    log(JTBD_ACTIONS.JOB_STORY_UPDATED, { jobId: id, patch });
  };

  // Removing a job also removes everything nested under it, so a job with
  // children asks first (with the count). Either way Undo puts the removed
  // stories back where they were.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const pendingJob = pendingRemoveId ? jobs.find((j) => j.id === pendingRemoveId) : undefined;
  const pendingNested = pendingRemoveId ? descendantIds(jobs, pendingRemoveId).size : 0;

  const requestRemoveJob = (id: string) => {
    if (descendantIds(jobs, id).size > 0) setPendingRemoveId(id);
    else removeJob(id);
  };

  const removeJob = (id: string) => {
    const current = useWorkspaceStore.getState().jobStories ?? [];
    const job = current.find((j) => j.id === id);
    if (!job) return;
    const toDelete = descendantIds(current, id);
    toDelete.add(id);
    // Remember each removed story's position for Undo.
    const removed = current.flatMap((j, index) => (toDelete.has(j.id) ? [{ job: j, index }] : []));
    const nested = removed.length - 1;
    undoable({
      label:
        nested > 0
          ? `Removed a job story and ${nested} nested ${nested === 1 ? "story" : "stories"}`
          : "Removed a job story",
      description: renderJobLabel(job),
      apply: () => {
        setJobs((s) => s.filter((j) => !toDelete.has(j.id)));
        log(JTBD_ACTIONS.JOB_STORY_REMOVED, {
          jobId: id,
          situation: job.situation,
          motivation: job.motivation,
          outcome: job.outcome,
        });
      },
      revert: () =>
        setJobs((s) => {
          const out = [...s];
          const present = new Set(s.map((j) => j.id));
          for (const r of removed) {
            if (present.has(r.job.id)) continue;
            out.splice(Math.min(r.index, out.length), 0, r.job);
          }
          return out;
        }),
    });
  };

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Job Story Mapper",
      prompts: generateJtbdPrompts({ jobs }, workspace),
    }),
    [jobs, workspace]
  );

  const csvData = useMemo(
    () => ({
      headers: ["Situation", "Motivation", "Outcome", "Parent", "Description"],
      rows: jobs.map((j) => {
        const parent = j.parentJobId ? jobs.find((p) => p.id === j.parentJobId) : undefined;
        return [
          j.situation,
          j.motivation,
          j.outcome,
          parent ? renderJobLabel(parent) : "",
          j.description ?? "",
        ];
      }),
    }),
    [jobs]
  );

  const renderRow = (
    job: JobStory,
    depth: number,
    seen: Set<string> = new Set()
  ): React.ReactNode => {
    // Cycle guard: a hand-edited localStorage payload could carry a
    // `parentJobId` cycle (A → B → A). Without this, renderRow would
    // recurse forever and crash the tab. computeMaxDepth uses a
    // visited set; the render path needs the same protection.
    if (seen.has(job.id) || depth > 30) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(job.id);
    const isEditing = editingId === job.id;
    const children = childrenByParent.get(job.id) ?? [];
    return (
      <div key={job.id} className="space-y-2">
        <div
          className="rounded-lg border border-border bg-bg p-3"
          style={{ borderLeftColor: "var(--accent3)", borderLeftWidth: 3 }}
        >
          {isEditing ? (
            <JobRowEditor job={job} onCommit={updateJob} onDone={() => setEditingId(null)} />
          ) : (
            <div className="flex items-start gap-2">
              <User className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--accent3)" }} />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm text-text break-words">
                  <span className="text-sub">When </span>
                  <span className="font-medium">{job.situation || "(situation)"}</span>
                  <span className="text-sub">, I want to </span>
                  <span className="font-medium">{job.motivation || "(motivation)"}</span>
                  <span className="text-sub">, so I can </span>
                  <span className="font-medium">{job.outcome || "(outcome)"}</span>
                  <span className="text-sub">.</span>
                </p>
                {job.description && (
                  <p className="text-xs text-sub whitespace-pre-wrap break-words">
                    {job.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(job.id)}
                  className="h-7 px-2 text-xs text-sub hover:text-accent"
                  aria-label={`Edit job story: when ${job.situation || "(situation)"}`}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => requestRemoveJob(job.id)}
                  className="h-7 w-7 p-0 text-sub hover:text-danger"
                  aria-label={`Remove job story: when ${job.situation || "(situation)"}`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>
        {children.length > 0 && (
          <div className="pl-6 space-y-2 border-l border-border ml-2">
            {children.map((c) => renderRow(c, depth + 1, nextSeen))}
          </div>
        )}
      </div>
    );
  };

  return (
    <ToolPageWrapper
      toolId="jtbd-mapper"
      title="Job Story Mapper"
      description='"When ___ I want to ___ so I can ___" job-story builder linked to opportunities.'
      category="Sprint Planning & Estimation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton filename="jtbd-mapper" csvData={csvData} jsonData={jobs} />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={User}
          label="Job stories"
          value={jobs.length}
          valueClassName="text-accent"
        />
        <StatCard variant="compact" icon={GitBranch} label="Top-level" value={rootJobs.length} />
        <StatCard variant="compact" icon={Layers} label="Max depth" value={maxDepth} />
        <StatCard
          variant="compact"
          icon={AlertCircle}
          label="Without children"
          value={jobsWithoutChildren}
          hint="leaf jobs"
        />
      </KpiGrid>

      <div className="rounded-lg border border-border bg-surface p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-sub mb-3">Add job story</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <Input
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder="When... (situation)"
            className="bg-bg border-border text-sm"
            aria-label="When (situation)"
          />
          <Input
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            placeholder="I want to... (motivation)"
            className="bg-bg border-border text-sm"
            aria-label="I want to (motivation)"
          />
          <Input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="So I can... (outcome)"
            className="bg-bg border-border text-sm"
            aria-label="So I can (outcome)"
          />
        </div>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          rows={2}
          className="bg-bg border-border text-sm resize-none mb-2"
          aria-label="Description"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={parentJobId} onValueChange={setParentJobId}>
            <SelectTrigger
              className="bg-bg border-border text-sm sm:flex-1"
              aria-label="Parent job (optional)"
            >
              <SelectValue placeholder="Parent job (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No parent (top-level)</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id} className="text-xs">
                  {renderJobLabel(j).slice(0, 80)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={addJob}
            className="gap-2 bg-accent text-bg hover:bg-accent/90 sm:w-auto w-full"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon={User}>
          No job stories yet. Capture your first one above using the when/want/so format.
        </EmptyState>
      ) : (
        <div className="space-y-2">{rootJobs.map((j) => renderRow(j, 0))}</div>
      )}

      <ConfirmDialog
        open={pendingRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null);
        }}
        title="Remove this job and everything under it?"
        description={
          pendingJob
            ? `“${renderJobLabel(pendingJob)}” and the ${pendingNested} job ${pendingNested === 1 ? "story" : "stories"} nested under it will be removed.`
            : undefined
        }
        confirmLabel={`Remove ${pendingNested + 1} job ${pendingNested === 0 ? "story" : "stories"}`}
        onConfirm={() => {
          if (pendingRemoveId) removeJob(pendingRemoveId);
        }}
      />
    </ToolPageWrapper>
  );
}

/**
 * Local-draft inline editor for a job story. Holds keystrokes in component
 * state and only commits to the parent (which writes localStorage and logs
 * a history entry) on blur or "Done", avoiding the per-keystroke storage
 * write + log-flood and the cursor-jump that came with `value={job.x}`.
 */
function JobRowEditor({
  job,
  onCommit,
  onDone,
}: {
  job: JobStory;
  onCommit: (id: string, patch: Partial<JobStory>) => void;
  onDone: () => void;
}) {
  const [situation, setSituation] = useState(job.situation);
  const [motivation, setMotivation] = useState(job.motivation);
  const [outcome, setOutcome] = useState(job.outcome);
  // Description: store raw value, trim only when committing on blur.
  const [description, setDescription] = useState(job.description ?? "");

  // Sync external changes (e.g. another tab) into local draft when the
  // corresponding input isn't focused — otherwise we'd wipe mid-edit typing.
  const sitRef = useRef<HTMLInputElement>(null);
  const motRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const lastSitRef = useRef(job.situation);
  const lastMotRef = useRef(job.motivation);
  const lastOutRef = useRef(job.outcome);
  const lastDescRef = useRef(job.description ?? "");
  useEffect(() => {
    if (document.activeElement === sitRef.current) return;
    if (job.situation === lastSitRef.current) return;
    setSituation(job.situation);
    lastSitRef.current = job.situation;
  }, [job.situation]);
  useEffect(() => {
    if (document.activeElement === motRef.current) return;
    if (job.motivation === lastMotRef.current) return;
    setMotivation(job.motivation);
    lastMotRef.current = job.motivation;
  }, [job.motivation]);
  useEffect(() => {
    if (document.activeElement === outRef.current) return;
    if (job.outcome === lastOutRef.current) return;
    setOutcome(job.outcome);
    lastOutRef.current = job.outcome;
  }, [job.outcome]);
  useEffect(() => {
    const next = job.description ?? "";
    if (document.activeElement === descRef.current) return;
    if (next === lastDescRef.current) return;
    setDescription(next);
    lastDescRef.current = next;
  }, [job.description]);

  const commitField = <K extends keyof JobStory>(key: K, value: JobStory[K]) => {
    if (job[key] === value) return;
    onCommit(job.id, { [key]: value } as Partial<JobStory>);
  };

  const commitDescription = () => {
    const trimmed = description.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    if (next === (job.description ?? undefined)) return;
    onCommit(job.id, { description: next });
    lastDescRef.current = trimmed;
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Input
          ref={sitRef}
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          onBlur={() => {
            commitField("situation", situation);
            lastSitRef.current = situation;
          }}
          placeholder="When..."
          className="bg-surface border-border text-xs"
          aria-label="When (situation)"
        />
        <Input
          ref={motRef}
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          onBlur={() => {
            commitField("motivation", motivation);
            lastMotRef.current = motivation;
          }}
          placeholder="I want to..."
          className="bg-surface border-border text-xs"
          aria-label="I want to (motivation)"
        />
        <Input
          ref={outRef}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => {
            commitField("outcome", outcome);
            lastOutRef.current = outcome;
          }}
          placeholder="So I can..."
          className="bg-surface border-border text-xs"
          aria-label="So I can (outcome)"
        />
      </div>
      <Input
        ref={descRef}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commitDescription}
        placeholder="Description (optional)"
        className="bg-surface border-border text-xs"
        aria-label="Description"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Flush any pending edits before collapsing the editor.
            commitField("situation", situation);
            commitField("motivation", motivation);
            commitField("outcome", outcome);
            commitDescription();
            onDone();
          }}
          className="text-sub"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
