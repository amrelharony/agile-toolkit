"use client";

/**
 * Backlog Health: is the backlog DEEP? It reads the workspace's backlog
 * stories (nothing to type), scores the four checks with plain reasons,
 * and flags the stories to fix: vague, no criteria or points near the top,
 * too big, stale. Each story can be fixed here: points, acceptance criteria
 * (free text and Given/When/Then), a split, or Drop, all with Undo where
 * something is removed. "Review with Amr" suggests flags, splits and
 * scenarios that the person adds one by one.
 *
 * The scan is lib/backlog/health, shared with Amr's verbs. The example is
 * held in memory and never reaches the workspace.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { ListChecks, Settings2, Stethoscope } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiButton, AiSuggestions } from "@/components/ai";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateBacklogHealthPrompts } from "@/lib/ai-prompts/backlog-health";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, Story, StoryGwt } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BACKLOG_HEALTH_ACTIONS } from "@/lib/history/event-actions";
import { deleteStoryKeepingUndo } from "@/lib/stories/delete";
import {
  STORY_GWT_MAX,
  newGwtId,
  withStoryDetails,
  withStoryGwt,
  type StoryDetails,
} from "@/lib/stories/fields";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";
import { undoable } from "@/lib/utils/undoable";
import { todayIso } from "@/lib/sprints/series";
import { stampRefinedWrite, withRefinedPutBack } from "@/lib/sprints/story-status";
import type { AiSource } from "@/lib/ai/task-types";
import {
  REVIEW_FLAG_LABEL,
  REVIEW_STORIES_MAX,
  backlogHealthReviewTask,
  fitReviewInput,
  type ReviewOutput,
} from "@/lib/ai/tasks/backlog-health";
import { backlogForHealth, backlogHealth, type HealthVerdict } from "@/lib/backlog/health";
import { buildExample } from "./example";
import { healthCsv, toMarkdown } from "./markdown";
import { CheckCard, SettingsForm, StoryRow } from "./parts";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  useBacklogHealthSettings,
  type HealthSettings,
} from "./store";

export const TOOL_ID = "backlog-health";

const NO_STORIES: Story[] = [];

/** Where the page's story writes go: the workspace, or the example in memory. */
export interface StoryWriter {
  stories(): Story[];
  upsertStory(story: Story): void;
  upsertStories(stories: readonly Story[]): void;
  removeStories(ids: readonly string[]): void;
  /** Delete one; returns how to put it back exactly (null: no such story). */
  deleteStory(id: string): (() => void) | null;
}

export const liveWriter: StoryWriter = {
  stories: () => useWorkspaceStore.getState().stories,
  upsertStory: (s) => useWorkspaceStore.getState().upsertStory(s),
  upsertStories: (list) => useWorkspaceStore.getState().bulkUpsertStories([...list]),
  removeStories: (ids) => useWorkspaceStore.getState().removeStories(ids),
  deleteStory: (id) => deleteStoryKeepingUndo(id),
};

type ExampleStore = StoreApi<{ stories: Story[] }>;

function exampleWriter(store: ExampleStore): StoryWriter {
  // Refined as the workspace store stamps it, so a fix in the example clears "stale" too.
  const put = (list: Story[], s: Story) => {
    const prev = list.find((x) => x.id === s.id);
    const next = stampRefinedWrite(s, prev);
    return prev ? list.map((x) => (x.id === s.id ? next : x)) : [...list, next];
  };
  return {
    stories: () => store.getState().stories,
    upsertStory: (s) => store.setState((st) => ({ stories: put(st.stories, s) })),
    upsertStories: (list) =>
      store.setState((st) => ({ stories: list.reduce((acc, s) => put(acc, s), st.stories) })),
    removeStories: (ids) =>
      store.setState((st) => ({ stories: st.stories.filter((s) => !ids.includes(s.id)) })),
    deleteStory: (id) => {
      const before = store.getState().stories;
      const index = before.findIndex((s) => s.id === id);
      if (index < 0) return null;
      const story = before[index];
      store.setState({ stories: before.filter((s) => s.id !== id) });
      return () =>
        store.setState((st) => {
          if (st.stories.some((s) => s.id === id)) return st;
          const next = [...st.stories];
          next.splice(Math.min(index, next.length), 0, story);
          return { stories: next };
        });
    },
  };
}

const short = (t: string, max = 40) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const VERDICT_TEXT: Record<HealthVerdict, string> = {
  healthy: "Healthy",
  "needs-work": "Needs work",
  unhealthy: "Unhealthy",
  empty: "Empty",
};

export function BacklogHealthClient() {
  const hydrated = useWorkspaceHydrated();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const backlogItems = useWorkspaceStore((s) => s.backlogItems);
  const stored = useBacklogHealthSettings((s) => s);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(useBacklogHealthSettings.persist.rehydrate()).then(() => setReady(true));
  }, []);
  const settings = useMemo(
    () => (ready ? normalizeSettings(stored) : DEFAULT_SETTINGS),
    [ready, stored]
  );
  const saveSettings = (s: HealthSettings) => useBacklogHealthSettings.setState(s);
  const { log } = useHistoryLogger(TOOL_ID);
  const [example, setExample] = useState<ExampleStore | null>(null);

  let content;
  if (!hydrated) {
    content = (
      <p className="text-sm text-sub" role="status">
        Loading your backlog…
      </p>
    );
  } else if (example) {
    content = (
      <ExampleBoard
        store={example}
        settings={settings}
        onSettings={saveSettings}
        onExit={() => setExample(null)}
      />
    );
  } else {
    content = (
      <HealthBoard
        stories={stories}
        backlogItems={backlogItems}
        writer={liveWriter}
        settings={settings}
        onSettings={saveSettings}
        log={log}
        onLoadExample={() => setExample(createStore(() => ({ stories: buildExample() })))}
      />
    );
  }

  return (
    <ToolPageWrapper
      toolId="backlog-health"
      title="Backlog Health"
      description="Check the backlog is DEEP: detailed near the top, estimated, emergent and prioritized."
      category="Sprint Planning & Estimation"
    >
      {content}
    </ToolPageWrapper>
  );
}

function ExampleBoard({
  store,
  settings,
  onSettings,
  onExit,
}: {
  store: ExampleStore;
  settings: HealthSettings;
  onSettings: (s: HealthSettings) => void;
  onExit: () => void;
}) {
  const stories = useStore(store, (s) => s.stories);
  const writer = useMemo(() => exampleWriter(store), [store]);
  return (
    <div>
      <ExampleNotice onClear={onExit} />
      <p className="-mt-2 mb-4 text-xs text-sub">
        The example backlog stays on this page: Sprint Planning and Refinement don&apos;t see it,
        and nothing is saved.
      </p>
      <HealthBoard
        stories={stories}
        writer={writer}
        settings={settings}
        onSettings={onSettings}
        log={() => {}}
        example
      />
    </div>
  );
}

type ReviewItem =
  | { kind: "split"; storyId: string; story: string; title: string }
  | { kind: "gwt"; storyId: string; story: string; given: string; when: string; then: string };

export function HealthBoard({
  stories,
  backlogItems,
  writer,
  settings,
  onSettings,
  log,
  example = false,
  onLoadExample,
}: {
  stories: readonly Story[];
  backlogItems?: readonly BacklogItem[];
  writer: StoryWriter;
  settings: HealthSettings;
  onSettings: (s: HealthSettings) => void;
  log: (action: string, payload?: Record<string, unknown>) => void;
  example?: boolean;
  onLoadExample?: () => void;
}) {
  const [today] = useState(() => todayIso());
  const backlog = useMemo(
    () => backlogForHealth(stories, backlogItems, { withExamples: example }),
    [stories, backlogItems, example]
  );
  const health = useMemo(
    () =>
      backlogHealth(backlog, {
        today,
        topN: settings.topN,
        tooBigPoints: settings.tooBigPoints,
        staleWeeks: settings.staleWeeks,
      }),
    [backlog, today, settings]
  );
  const [showAll, setShowAll] = useState(false);
  // Stories fixed in place this visit: they stay in the flagged list (as
  // "No flags.") until the filter changes, so a row never vanishes under the
  // person's hands, taking its open panel and their focus with it.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const keep = (id: string) => setKept((s) => (s.has(id) ? s : new Set(s).add(id)));
  const [announce, setAnnounce] = useState("");
  const [review, setReview] = useState<{ data: ReviewOutput; source: AiSource } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The scan ran: once a visit, for the team's own backlog.
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current || example || health.total === 0) return;
    logged.current = true;
    log(BACKLOG_HEALTH_ACTIONS.SCAN_RAN, {
      score: health.score,
      detailed: health.checks[0]?.score ?? null,
      estimated: health.checks[1]?.score ?? null,
      emergent: health.checks[2]?.score ?? null,
      prioritized: health.checks[3]?.score ?? null,
      flagged: health.flagged,
    });
  }, [example, health, log]);

  const markdown = useMemo(() => toMarkdown(health, today), [health, today]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Backlog Health",
      prompts: generateBacklogHealthPrompts({
        score: health.score,
        checks: health.checks,
        stories: health.stories
          .filter((s) => s.top)
          .map((s) => ({
            title: s.story.title,
            points: s.story.points,
            flags: s.flags.map((f) => f.id),
            criteria: s.story.acceptanceCriteria,
          })),
      }),
    }),
    [health]
  );
  const byId = useMemo(() => new Map(backlog.map((s) => [s.id, s])), [backlog]);

  const fresh = (id: string) => writer.stories().find((s) => s.id === id);

  const setPoints = (story: Story, points: number | undefined) => {
    const current = fresh(story.id);
    if (!current) return;
    keep(story.id);
    const next: Story = { ...current };
    if (points === undefined) delete next.points;
    else next.points = points;
    writer.upsertStory(next);
    log(BACKLOG_HEALTH_ACTIONS.STORY_UPDATED, { storyId: story.id, points: points ?? null });
    setAnnounce(`Points saved for “${short(story.title)}”.`);
  };

  const saveDetails = (story: Story, details: StoryDetails) => {
    const current = fresh(story.id);
    if (!current) return;
    keep(story.id);
    writer.upsertStory(withStoryDetails(current, details));
    log(BACKLOG_HEALTH_ACTIONS.STORY_UPDATED, { storyId: story.id, details: true });
  };

  const saveGwt = (story: Story, gwt: StoryGwt[]) => {
    const current = fresh(story.id);
    if (!current) return;
    const added = gwt.length - (current.gwt?.length ?? 0);
    keep(story.id);
    writer.upsertStory(withStoryGwt(current, gwt));
    if (added > 0) log(BACKLOG_HEALTH_ACTIONS.CRITERIA_ADDED, { storyId: story.id, count: added });
    else log(BACKLOG_HEALTH_ACTIONS.STORY_UPDATED, { storyId: story.id, gwt: gwt.length });
  };

  /** New backlog stories for a big one, with one Undo; the big one stays to drop. */
  const split = (story: Story, titles: string[]) => {
    const prefix = example ? "example-" : "";
    const made: Story[] = titles
      .map((t) => t.replace(/\s+/g, " ").trim().slice(0, STORY_TITLE_MAX))
      .filter(Boolean)
      .map((title) => ({
        id: `${prefix}story_${nanoid(8)}`,
        title,
        status: "backlog" as const,
        ...(typeof story.priorityScore === "number" ? { priorityScore: story.priorityScore } : {}),
        ...(story.epicId ? { epicId: story.epicId } : {}),
        ...(story.tags?.length ? { tags: [...story.tags] } : {}),
        ...(story.owner ? { owner: story.owner } : {}),
      }));
    if (made.length === 0) return;
    undoable({
      label: `Added ${made.length} ${made.length === 1 ? "story" : "stories"} from “${short(story.title)}”`,
      description: "Size and order them, then drop the big one when the team agrees.",
      kind: "success",
      apply: () => writer.upsertStories(made),
      revert: () => writer.removeStories(made.map((s) => s.id)),
    });
    log(BACKLOG_HEALTH_ACTIONS.STORY_SPLIT, { storyId: story.id, count: made.length });
  };

  const drop = (story: Story) => {
    let restore: (() => void) | null = null;
    undoable({
      label: `Dropped “${short(story.title)}” from the backlog`,
      apply: () => {
        restore = writer.deleteStory(story.id);
      },
      revert: () => restore?.(),
    });
    log(BACKLOG_HEALTH_ACTIONS.STORY_DROPPED, { storyId: story.id });
    setAnnounce("");
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  /* ── Review with Amr ─────────────────────────────────────────────── */

  // The page's own settings go with it, so the rules (or Amr) flag what the
  // page flags; trimmed to fit what a visitor's request may weigh.
  const reviewInput = () =>
    fitReviewInput({
      topN: Math.min(settings.topN, REVIEW_STORIES_MAX),
      tooBigPoints: settings.tooBigPoints,
      stories: backlog.slice(0, REVIEW_STORIES_MAX).map((s) => ({
        id: s.id.slice(0, 60),
        title: s.title.slice(0, 200),
        ...(s.notes?.trim() ? { description: s.notes.trim().slice(0, 500) } : {}),
        ...(typeof s.points === "number" && s.points >= 0 && s.points <= 1000
          ? { points: s.points }
          : {}),
        ...(s.acceptanceCriteria?.trim() || s.gwt?.length
          ? {
              criteria: [
                s.acceptanceCriteria?.trim(),
                ...(s.gwt ?? []).map((g) => `Given ${g.given}, when ${g.when}, then ${g.then}`),
              ]
                .filter(Boolean)
                .join(" / ")
                .slice(0, 500),
            }
          : {}),
      })),
    });

  // Only answers about stories still in the backlog count; their text is plain.
  const reviewed = (review?.data.stories ?? []).filter((r) => byId.has(r.id));
  const notes = reviewed.flatMap((r) =>
    r.flags.map((f) => ({ id: r.id, story: byId.get(r.id)?.title ?? "", ...f }))
  );
  const reviewItems: ReviewItem[] = reviewed.flatMap((r) => {
    const story = byId.get(r.id)?.title ?? "";
    return [
      ...r.splits.map((title) => ({ kind: "split" as const, storyId: r.id, story, title })),
      ...r.gwt.map((g) => ({ kind: "gwt" as const, storyId: r.id, story, ...g })),
    ];
  });

  const acceptReview = (item: ReviewItem) => {
    const current = fresh(item.storyId);
    if (!current) return;
    if (item.kind === "split") {
      split(current, [item.title]);
      return;
    }
    const rows = current.gwt ?? [];
    if (rows.length >= STORY_GWT_MAX) {
      setAnnounce(`“${short(current.title)}” already holds as many scenarios as a story keeps.`);
      return;
    }
    const added = newGwtId(new Set(rows.map((g) => g.id)));
    const row: StoryGwt = { id: added, given: item.given, when: item.when, then: item.then };
    // The story's refinedAt before the scenario and the stamp its write left.
    let before: string | undefined;
    let stamp: string | undefined;
    undoable({
      label: `Added a scenario to “${short(current.title)}”`,
      kind: "success",
      apply: () => {
        const now = fresh(current.id) ?? current;
        before = now.refinedAt;
        writer.upsertStory(withStoryGwt(now, [...(now.gwt ?? []), row]));
        stamp = fresh(current.id)?.refinedAt;
      },
      // Takes back only this scenario: edits made since stay. A stale story
      // is stale again, unless it was refined since.
      revert: () => {
        const now = fresh(current.id);
        if (now)
          writer.upsertStory(
            withRefinedPutBack(
              withStoryGwt(
                now,
                (now.gwt ?? []).filter((g) => g.id !== added)
              ),
              stamp,
              before
            )
          );
      },
    });
    log(BACKLOG_HEALTH_ACTIONS.CRITERIA_ADDED, { storyId: current.id, count: 1 });
  };

  /* ── Render ──────────────────────────────────────────────────────── */

  if (health.total === 0) {
    return (
      <EmptyState
        icon={Stethoscope}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link href="/sprint-planning">Add stories in Sprint Planning</Link>
            </Button>
            {onLoadExample && (
              <LoadExampleButton label="See an example backlog" onLoad={onLoadExample} />
            )}
          </div>
        }
      >
        <p className="text-sm">
          The backlog is empty, so there is nothing to check yet. Stories you add in Sprint
          Planning, Refinement or the Prioritizer show up here.
        </p>
      </EmptyState>
    );
  }

  const shown = showAll
    ? health.stories
    : health.stories.filter((s) => s.flags.length > 0 || kept.has(s.story.id));

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-lg font-semibold text-text focus:outline-none"
          >
            {health.score === null ? "DEEP score: can't tell yet" : `DEEP score ${health.score}%`}
            <span className="ml-2 text-sm font-normal text-sub">
              {VERDICT_TEXT[health.verdict]}
            </span>
          </h2>
          <p className="mt-1 text-sm text-text" data-field="summary">
            {health.summary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="backlog-health"
            markdown={markdown}
            clipboardText={markdown}
            csvData={healthCsv(health)}
            jsonData={{ score: health.score, verdict: health.verdict, checks: health.checks }}
          />
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2" aria-label="The four DEEP checks">
        {health.checks.map((c) => (
          <CheckCard key={c.id} check={c} />
        ))}
      </ul>

      <SectionCard
        title="Review with Amr"
        icon={ListChecks}
        actions={
          <AiButton
            task={backlogHealthReviewTask}
            label="Review the backlog with Amr"
            fallbackLabel="Review by the rules"
            input={reviewInput}
            onResult={(data, meta) => {
              setReview({ data, source: meta.source });
              if (data.stories.length === 0)
                setAnnounce("Nothing to suggest: every story looks fine.");
            }}
          />
        }
      >
        <p className="text-sm text-sub">
          Amr reads the top {Math.min(REVIEW_STORIES_MAX, health.total)} stories and suggests splits
          and Given/When/Then scenarios. You add the ones you want; each goes on its story with
          Undo.
        </p>
        {review && notes.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-medium text-sub">
              What {review.source === "ai" ? "Amr" : "the rules"} noticed
            </h3>
            <ul className="mt-1 space-y-1 text-sm">
              {notes.map((n, i) => (
                <li key={`${n.id}-${i}`} className="break-words">
                  <span className="font-medium text-text">{short(n.story, 60)}</span>
                  <span className="text-sub">
                    {" "}
                    · {REVIEW_FLAG_LABEL[n.flag]}: {n.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {review && reviewItems.length > 0 && (
          <AiSuggestions
            className="mt-3"
            items={reviewItems}
            source={review.source}
            title="Splits and scenarios to add"
            render={(it) =>
              it.kind === "split"
                ? { title: `New story: ${it.title}`, detail: `Split from “${short(it.story, 60)}”` }
                : {
                    title: `Given ${it.given}, when ${it.when}, then ${it.then}`,
                    detail: `Scenario for “${short(it.story, 60)}”`,
                  }
            }
            onAccept={acceptReview}
            onDismiss={() => setReview(null)}
          />
        )}
      </SectionCard>

      <SectionCard
        title={showAll ? "Every backlog story" : "Stories to look at"}
        icon={Stethoscope}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setShowAll((v) => !v);
              setKept(new Set());
            }}
          >
            {showAll ? "Only flagged stories" : `All ${health.total} stories`}
          </Button>
        }
      >
        <p className="mb-3 text-xs text-sub">
          Only the top {health.topN} need acceptance criteria and points; stories further down can
          stay rough. Fix a story here, or walk through them in{" "}
          <Link href="/refinement" className="text-accent hover:underline">
            Refinement
          </Link>
          .
        </p>
        {shown.length === 0 ? (
          <p className="text-sm text-sub">No story is flagged.</p>
        ) : (
          <ul
            className="divide-y divide-border rounded-lg border border-border"
            aria-label="Backlog stories"
          >
            {shown.map((row) => (
              <StoryRow
                key={row.story.id}
                row={row}
                onOpen={keep}
                onPoints={setPoints}
                onDetails={saveDetails}
                onGwt={saveGwt}
                onSplit={split}
                onDrop={drop}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <details className="rounded-lg border border-border bg-card p-3">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-text">
          <Settings2 className="h-4 w-4 text-sub" aria-hidden="true" />
          What counts as the top, too big and stale
        </summary>
        <div className="mt-3">
          <SettingsForm settings={settings} onSave={onSettings} />
        </div>
      </details>
    </div>
  );
}
