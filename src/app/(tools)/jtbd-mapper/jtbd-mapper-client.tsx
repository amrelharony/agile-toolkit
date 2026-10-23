"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { BookPlus, Check, CornerDownRight, Pencil, Plus, Trash2, User } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { undoable } from "@/lib/utils/undoable";
import { sendHandoff } from "@/lib/handoffs/send";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { JTBD_ACTIONS } from "@/lib/history/event-actions";
import { generateJtbdPrompts } from "@/lib/ai-prompts/jtbd-mapper";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { JobStory, Story, Workspace } from "@/lib/stores/workspace-types";
import { JobAddForm, JobRowEditor, sameJob, useJobAddForm, withJobValues } from "./job-form";
import type { JobValues } from "./job-form";
import {
  JOB_TOOL,
  descendantIds,
  jobLinks,
  jobSentence,
  jobTree,
  storiesByJob,
  storyTitleFor,
} from "./jobs";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { jtbdSummary } from "./verdict";

/** How a job's backlog story stands, as the row's link names it. */
const STORY_STATE: Record<Story["status"], string> = {
  backlog: "on the backlog",
  todo: "to do",
  in_progress: "in progress",
  review: "in review",
  done: "done",
};

/** Deep enough for any real job map; stops a hand-edited chain from blowing the stack. */
const MAX_DEPTH = 30;

const EMPTY_JOBS: JobStory[] = [];

export function JtbdMapperClient() {
  const jobs = useWorkspaceStore((s) => s.jobStories ?? EMPTY_JOBS);
  const stories = useWorkspaceStore((s) => s.stories);
  // A whole-array replace over the synced collection, reading the store at
  // the moment it writes so two quick edits can't overwrite each other.
  const setJobs = (update: (prev: JobStory[]) => JobStory[]) => {
    const cur = useWorkspaceStore.getState().jobStories ?? [];
    useWorkspaceStore.setState({ jobStories: update(cur) });
  };
  const { log } = useHistoryLogger("jtbd-mapper");
  const exportRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function add(v: JobValues) {
    const job: JobStory = { id: crypto.randomUUID(), ...v };
    setJobs((s) => [...s, job]);
    log(JTBD_ACTIONS.JOB_STORY_ADDED, {
      jobId: job.id,
      situation: job.situation,
      motivation: job.motivation,
      outcome: job.outcome,
      parentJobId: job.parentJobId,
      description: job.description,
    });
  }
  const form = useJobAddForm(add, jobs);

  function save(job: JobStory, v: JobValues) {
    setEditingId(null);
    if (sameJob(job, v)) return;
    setJobs((s) => s.map((j) => (j.id === job.id ? withJobValues(j, v) : j)));
    log(JTBD_ACTIONS.JOB_STORY_UPDATED, { jobId: job.id, patch: v });
  }

  /** "Add a job under this": the add form takes the parent and gets focus. */
  function addUnder(job: JobStory) {
    form.update({ parentJobId: job.id });
    const first = form.formRef.current?.querySelector<HTMLElement>("input");
    first?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus();
  }

  // A job with sub-jobs asks what happens to them: removed with it, or
  // kept and moved up a level. Either way Undo puts everything back.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const pendingJob = pendingRemoveId ? jobs.find((j) => j.id === pendingRemoveId) : undefined;
  const pendingNested = pendingRemoveId ? descendantIds(jobs, pendingRemoveId).size : 0;

  const requestRemove = (id: string) => {
    if (descendantIds(jobs, id).size > 0) setPendingRemoveId(id);
    else removeJob(id, "all");
  };

  function removeJob(id: string, nested: "all" | "keep") {
    const current = useWorkspaceStore.getState().jobStories ?? [];
    const job = current.find((j) => j.id === id);
    if (!job) return;
    const logRemoved = () =>
      log(JTBD_ACTIONS.JOB_STORY_REMOVED, {
        jobId: id,
        situation: job.situation,
        motivation: job.motivation,
        outcome: job.outcome,
      });

    if (nested === "keep") {
      const index = current.indexOf(job);
      const children = current.filter((j) => j.parentJobId === id).map((j) => j.id);
      // The children move to the removed job's own parent (or the top level).
      const newParent =
        job.parentJobId && current.some((j) => j.id === job.parentJobId)
          ? job.parentJobId
          : undefined;
      const moved = new Set(children);
      undoable({
        label: `Removed a job story; ${children.length} nested ${children.length === 1 ? "story" : "stories"} moved up a level`,
        description: jobSentence(job),
        apply: () => {
          setJobs((s) =>
            s
              .filter((j) => j.id !== id)
              .map((j) => {
                if (!moved.has(j.id)) return j;
                const next = { ...j };
                if (newParent) next.parentJobId = newParent;
                else delete next.parentJobId;
                return next;
              })
          );
          logRemoved();
        },
        revert: () =>
          setJobs((s) => {
            const out = s.map((j) =>
              // Only the children still where the removal put them go back.
              moved.has(j.id) && (j.parentJobId ?? undefined) === newParent
                ? { ...j, parentJobId: id }
                : j
            );
            if (!out.some((j) => j.id === id)) out.splice(Math.min(index, out.length), 0, job);
            return out;
          }),
      });
      return;
    }

    const toDelete = descendantIds(current, id);
    toDelete.add(id);
    // Remember each removed story's position for Undo.
    const removed = current.flatMap((j, index) => (toDelete.has(j.id) ? [{ job: j, index }] : []));
    const count = removed.length - 1;
    undoable({
      label:
        count > 0
          ? `Removed a job story and ${count} nested ${count === 1 ? "story" : "stories"}`
          : "Removed a job story",
      description: jobSentence(job),
      apply: () => {
        setJobs((s) => s.filter((j) => !toDelete.has(j.id)));
        logRemoved();
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
  }

  /** "Create story": a backlog story titled from the job, which links back to it. */
  function createStory(job: JobStory) {
    sendHandoff(
      "backlog-story",
      { title: storyTitleFor(job), sourceRef: { tool: JOB_TOOL, id: job.id } },
      {
        // The story's sourceRef is the link (see storiesByJob), so there is
        // nothing to record on the job.
        getLinks: () => jobLinks(job.id, useWorkspaceStore.getState().stories),
        setLinks: () => {},
      }
    );
  }

  const loadExample = () => {
    const example = buildExample();
    const ids = new Set(example.map((j) => j.id));
    setJobs((s) => [...s.filter((j) => !ids.has(j.id)), ...example]);
    // An earlier empty "Add" shouldn't leave errors under the example.
    form.reset();
  };
  // Only the example's jobs go; a job of the user's filed under one of them
  // moves to the top level instead of dangling.
  const clearExample = () =>
    setJobs((s) =>
      s
        .filter((j) => !isExampleId(j.id))
        .map((j) => {
          if (!isExampleId(j.parentJobId)) return j;
          const next = { ...j };
          delete next.parentJobId;
          return next;
        })
    );

  const tree = useMemo(() => jobTree(jobs), [jobs]);
  const byJob = useMemo(() => storiesByJob(stories), [stories]);
  const summary = jtbdSummary(jobs, stories);

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
      headers: ["Situation", "Motivation", "Outcome", "Parent", "Description", "Backlog story"],
      rows: jobs.map((j) => {
        const parent = j.parentJobId ? jobs.find((p) => p.id === j.parentJobId) : undefined;
        const story = byJob.get(j.id);
        return [
          j.situation,
          j.motivation,
          j.outcome,
          parent ? jobSentence(parent) : "",
          j.description ?? "",
          story ? (STORY_STATE[story.status] ?? story.status) : "",
        ];
      }),
    }),
    [jobs, byJob]
  );

  const renderRow = (job: JobStory, depth: number, seen: ReadonlySet<string>): React.ReactNode => {
    // jobTree already breaks cycles; this guards the recursion regardless.
    if (seen.has(job.id) || depth > MAX_DEPTH) return null;
    const nextSeen = new Set(seen).add(job.id);
    const children = tree.children.get(job.id) ?? [];
    return (
      <li key={job.id} className="space-y-2">
        <div className="rounded-lg border border-l-[3px] border-border border-l-accent-3 bg-bg p-3">
          {editingId === job.id ? (
            <JobRowEditor
              job={job}
              jobs={jobs}
              onSave={(v) => save(job, v)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <JobRow
              job={job}
              story={byJob.get(job.id)}
              onCreateStory={() => createStory(job)}
              onAddUnder={() => addUnder(job)}
              onEdit={() => setEditingId(job.id)}
              onRemove={() => requestRemove(job.id)}
            />
          )}
        </div>
        {children.length > 0 && (
          <ul
            className="ml-2 space-y-2 border-l border-border pl-3 sm:pl-6"
            aria-label={`Under: when ${job.situation || "(situation)"}`}
          >
            {children.map((c) => renderRow(c, depth + 1, nextSeen))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ToolPageWrapper
      toolId="jtbd-mapper"
      title="Job Story Mapper"
      description='"When ___, I want to ___, so I can ___" job stories: map the jobs, then turn them into backlog stories.'
      category="Sprint Planning & Estimation"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(jobs) && <ExampleNotice onClear={clearExample} />}

        <SectionCard title="Add a job story" icon={Plus}>
          <JobAddForm form={form} jobs={jobs} />
        </SectionCard>

        {jobs.length === 0 ? (
          <EmptyState icon={User} action={<LoadExampleButton onLoad={loadExample} />}>
            No job stories yet. Write the first one above: when it happens, what they want to do,
            and what that lets them do. Or load an example to see a job map.
          </EmptyState>
        ) : (
          <SectionCard
            title={`Job stories (${jobs.length})`}
            icon={User}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="jtbd-mapper"
                  csvData={csvData}
                  jsonData={jobs}
                  markdown={toMarkdown(jobs, stories)}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <p className="mb-3 text-sm font-medium text-text">{summary}</p>
            <ul className="space-y-2" aria-label="Job stories">
              {tree.roots.map((j) => renderRow(j, 0, new Set()))}
            </ul>
          </SectionCard>
        )}
      </div>

      <RemoveJobDialog
        job={pendingJob}
        nested={pendingNested}
        onClose={() => setPendingRemoveId(null)}
        onRemove={(nested) => {
          if (pendingRemoveId) removeJob(pendingRemoveId, nested);
          setPendingRemoveId(null);
        }}
      />
    </ToolPageWrapper>
  );
}

/** One job: the sentence, its notes, its backlog story, and the actions. */
function JobRow({
  job,
  story,
  onCreateStory,
  onAddUnder,
  onEdit,
  onRemove,
}: {
  job: JobStory;
  story: Story | undefined;
  onCreateStory: () => void;
  onAddUnder: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const when = `when ${job.situation || "(situation)"}`;
  const example = isExampleId(job.id);
  const route = getHandoffRoute("backlog-story");
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
      <User className="mt-0.5 h-4 w-4 shrink-0 text-accent-3" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <p className="break-words text-sm text-text">
          <span className="text-sub">When </span>
          <span className="font-medium">{job.situation || "(situation)"}</span>
          <span className="text-sub">, I want to </span>
          <span className="font-medium">{job.motivation || "(motivation)"}</span>
          <span className="text-sub">, so I can </span>
          <span className="font-medium">{job.outcome || "(outcome)"}</span>
          <span className="text-sub">.</span>
        </p>
        {job.description && (
          <p className="whitespace-pre-wrap break-words text-xs text-sub">{job.description}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {story ? (
          <Link
            href={route.targetHref(story.id)}
            className="min-touch-coarse inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-success underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Story {STORY_STATE[story.status] ?? story.status}
            <span className="sr-only"> (open in Sprint Planning)</span>
          </Link>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCreateStory}
            disabled={example}
            title={example ? "Clear the example to make stories from your own jobs." : undefined}
            aria-label={`Create story: ${when}`}
            className="min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:text-accent"
          >
            <BookPlus aria-hidden="true" />
            Create story
          </Button>
        )}
        <IconButton
          label={`Add a job under: ${when}`}
          icon={<CornerDownRight className="h-4 w-4" />}
          className="text-sub hover:text-accent"
          onClick={onAddUnder}
        />
        <IconButton
          label={`Edit job story: ${when}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Remove job story: ${when}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

/**
 * Removing a job that has sub-jobs: take them with it, or keep them and
 * move them up a level. Cancel has focus, so Enter never removes anything.
 */
function RemoveJobDialog({
  job,
  nested,
  onClose,
  onRemove,
}: {
  job: JobStory | undefined;
  nested: number;
  onClose: () => void;
  onRemove: (nested: "all" | "keep") => void;
}) {
  const stories = nested === 1 ? "story" : "stories";
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Remove a job with {nested} nested job {stories}?
          </DialogTitle>
          <DialogDescription>
            {job ? `“${jobSentence(job)}” ` : ""}has {nested} job {stories} under it. Remove{" "}
            {nested === 1 ? "it" : "them"} too, or keep {nested === 1 ? "it" : "them"} and move up a
            level.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => onRemove("keep")}>
            Keep nested, remove this one
          </Button>
          <Button type="button" variant="destructive" onClick={() => onRemove("all")}>
            Remove {nested + 1} job stories
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
