"use client";

/**
 * Kickoff: a new team or a new piece of work starts on the same page, in
 * one of six formats (Team Alignment Map, Project Poster, Team Canvas,
 * Inception deck, Trade-off sliders, Problem framing). The team fills it in
 * together (or collects answers from phones without names), drafts with Amr
 * or without AI, orders the trade-offs, agrees it, and sends what came out
 * to the tools that keep it: worries to the Risk Register, rules to the
 * Working Agreement, assumptions to the Hypothesis Tracker, scope to the
 * backlog, the problem statement to the Opportunity Tree or Root Cause, the
 * slider order to the Decision Log.
 *
 * Kickoffs live in the workspace (kickoffs), so Amr, the hand-off routes
 * and the next steps read the same records. `?kickoff=<id>` opens one.
 *
 * Store writes stamp nothing: every change to the words stamps `updatedAt`
 * here (lib/kickoff/model), a send's link doesn't. Deletes have Undo, and so
 * does every accepted suggestion. Example kickoffs carry example ids: Clear
 * example removes them, they are never sent, and changes to them aren't
 * logged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaneTakeoff, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ProductGoalLine, useActiveProductGoal } from "@/components/product-goal/product-goal-line";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { focusAfterClearingExample } from "@/components/tool-frame/after-clear-example";
import { Button } from "@/components/ui/button";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { generateKickoffPrompts } from "@/lib/ai-prompts/kickoff";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  KICKOFF_TOO_BIG,
  blankKickoff,
  fitsRow,
  formatOf,
  newKickoffId,
  normalizeKickoff,
  readKickoffs,
} from "@/lib/kickoff/model";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kickoff } from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { buildExample } from "./example";
import type { LiveCollectRoom } from "./collect-room";
import type { KickoffHandle, KickoffWrite } from "./kickoff-handle";
import { KickoffView } from "./kickoff-view";
import { kickoffToMarkdown } from "./markdown";
import { StartKickoff, type StartDraft, type StartValues } from "./start-form";

const TOOL_ID = "kickoff";
const NONE: readonly unknown[] = [];

const ws = () => useWorkspaceStore.getState();
const fresh = (id: string) => normalizeKickoff((ws().kickoffs ?? []).find((k) => k.id === id));
const nowIso = () => new Date().toISOString();
const short = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A file name's part from a title: "Checkout squad!" → "checkout-squad". */
export function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "kickoff";
}

/** Rehydrate a persisted store once, quietly: blocked storage leaves its defaults. */
function useRehydrate(store: {
  persist: { hasHydrated: () => boolean; rehydrate: () => unknown };
}) {
  useEffect(() => {
    const { persist } = store;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: the defaults stand */
    });
  }, [store]);
}

export function KickoffClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.kickoffs) ?? NONE;
  const kickoffs = useMemo(() => readKickoffs(stored), [stored]);
  const roster = useTeamRoster();
  const activeGoal = useActiveProductGoal();
  const vision = useProductGoalPrefs((s) => s.vision);
  useRehydrate(useProductGoalPrefs);

  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The kickoff whose collect room is live (it is the one shown), and whether its round holds unsaved answers. */
  const [liveRoom, setLiveRoom] = useState<({ kickoffId: string } & LiveCollectRoom) | null>(null);
  const liveRef = useRef(liveRoom);
  liveRef.current = liveRoom;
  /** A change of what shows that would end the live room, waiting on the host's answer. */
  const [pending, setPending] = useState<{ go: () => void; deletes: boolean } | null>(null);
  /**
   * Run `go` (which shows `targetId`, or deletes the shown kickoff), or,
   * when it would end the live room on the kickoff shown, ask first: the
   * room ends for every phone in it, and answers not saved are lost.
   */
  const guard = useCallback((targetId: string | null, go: () => void, deletes = false) => {
    const live = liveRef.current;
    if (live && (deletes || live.kickoffId !== targetId)) setPending({ go, deletes });
    else go();
  }, []);
  /** The start form: open with what it starts from, or closed (null). */
  const [creating, setCreating] = useState<Partial<StartDraft> | null>(null);
  const [startKey, setStartKey] = useState(0);
  const headingRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const focus = useRef<"shown" | "start" | null>(null);
  const select = (id: string | null) => {
    focus.current = "shown";
    setSelectedId(id);
  };

  const openFromUrl = useCallback(
    (params: URLSearchParams) => {
      const id = params.get("kickoff");
      if (!id) return;
      dropSearchParam("kickoff");
      guard(id, () => {
        setSelectedId(id);
        setCreating(null);
        focus.current = "shown";
      });
    },
    [guard]
  );

  const selected = kickoffs.find((k) => k.id === selectedId) ?? kickoffs[0] ?? null;
  // Pin what shows: with nothing picked, the newest kickoff shows, and a
  // change to another one (Amr's verb, another tab) re-sorts the list. The
  // view, and a live room in it, stays on the one shown.
  if (hydrated && selected && selected.id !== selectedId) setSelectedId(selected.id);
  const example = hasExampleItems(kickoffs);

  useEffect(() => {
    const want = focus.current;
    if (!want) return;
    focus.current = null;
    const target =
      want === "start"
        ? startRef.current?.querySelector<HTMLElement>("button, input, textarea")
        : (headingRef.current ??
          startRef.current?.querySelector<HTMLElement>("button, input, textarea"));
    target?.focus();
  });

  /** Log a change unless it's to the example. */
  const logFor = useCallback(
    (kickoffId: string) => (action: string, payload?: Record<string, unknown>) => {
      if (!isExampleId(kickoffId)) log(action, payload);
    },
    [log]
  );

  const handleFor = useCallback(
    (k: Kickoff): KickoffHandle => ({
      kickoff: k,
      example: isExampleId(k.id),
      read: () => fresh(k.id),
      write: (fn): KickoffWrite => {
        const cur = fresh(k.id);
        if (!cur) return { ok: false, message: "This kickoff isn't here any more." };
        const next = fn(cur, nowIso());
        if (!next || next === cur) return { ok: false, message: null };
        if (!fitsRow(next)) return { ok: false, message: KICKOFF_TOO_BIG };
        ws().upsertKickoff(next);
        return { ok: true, kickoff: next };
      },
      log: logFor(k.id),
    }),
    [logFor]
  );

  const create = (values: StartValues) => {
    const k = blankKickoff({
      id: newKickoffId(),
      format: values.format,
      title: values.title,
      brief: values.brief,
      ...(values.date ? { date: values.date } : {}),
      participants: values.participants,
      roster,
      now: nowIso(),
    });
    ws().upsertKickoff(k);
    log(KICKOFF_ACTIONS.KICKOFF_CREATED, { kickoffId: k.id, format: k.format });
    setCreating(null);
    // With a live room on the one shown, the new kickoff waits in the list until the host says.
    guard(k.id, () => select(k.id));
    announce(`Started “${short(k.title)}”, a ${formatOf(k).name}.`);
  };

  const startAnother = (k: Kickoff) => {
    setCreating({ title: k.title, brief: k.brief ?? "" });
    setStartKey((n) => n + 1);
    focus.current = "start";
  };

  const remove = (k: Kickoff) => {
    const at = kickoffs.findIndex((x) => x.id === k.id);
    const neighbour = kickoffs[at + 1] ?? kickoffs[at - 1];
    const saved = (ws().kickoffs ?? []).find((x) => x.id === k.id) ?? k;
    undoable({
      label: `Deleted “${short(k.title)}”`,
      apply: () => {
        ws().removeKickoff(k.id);
        if (!isExampleId(k.id)) {
          log(KICKOFF_ACTIONS.KICKOFF_REMOVED, { kickoffId: k.id, format: k.format });
        }
      },
      revert: () => {
        if (!(ws().kickoffs ?? []).some((x) => x.id === k.id)) ws().upsertKickoff(saved);
        guard(k.id, () => setSelectedId(k.id));
      },
    });
    select(neighbour?.id ?? null);
  };

  const loadExample = () => {
    for (const k of buildExample()) ws().upsertKickoff(k);
    setSelectedId(null);
  };
  // The kickoff shown stays unless it was an example (then the newest left shows).
  const clearExample = () => {
    let removed: Kickoff[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = (ws().kickoffs ?? []).filter((k) => isExampleId(k.id));
        for (const k of removed) ws().removeKickoff(k.id);
      },
      revert: () => {
        const kept = ws().kickoffs ?? [];
        for (const k of removed) if (!kept.some((x) => x.id === k.id)) ws().upsertKickoff(k);
      },
    });
    focusAfterClearingExample();
  };

  /** The live room on the kickoff shown says when it opens, holds unsaved answers, or ends. */
  const onRoomChange = useCallback(
    (kickoffId: string) => (room: LiveCollectRoom | null) =>
      setLiveRoom(room ? { kickoffId, unsaved: room.unsaved, end: room.end } : null),
    []
  );
  const liveTitle = liveRoom
    ? (kickoffs.find((k) => k.id === liveRoom.kickoffId)?.title ?? "")
    : "";

  const context = useMemo(
    () => ({
      ...(activeGoal ? { goal: activeGoal.statement } : {}),
      ...(vision?.trim() ? { vision } : {}),
    }),
    [activeGoal, vision]
  );
  const markdown = kickoffToMarkdown(selected, { today: todayIso() });
  const promptConfig = useMemo(
    () => ({ toolName: "Kickoff", prompts: generateKickoffPrompts(selected) }),
    [selected]
  );

  const startCard = (
    <SectionCard title="Start a kickoff" icon={Plus}>
      <div ref={startRef}>
        <StartKickoff
          key={startKey}
          initial={creating ?? undefined}
          onStart={create}
          onCancel={kickoffs.length > 0 ? () => setCreating(null) : undefined}
        />
      </div>
    </SectionCard>
  );

  return (
    <ToolPageWrapper
      toolId="kickoff"
      title="Kickoff"
      description="Start a new team or piece of work on the same page."
    >
      <OnSearchParams onChange={openFromUrl} />
      {!hydrated ? (
        <WorkspaceLoading>Loading kickoffs…</WorkspaceLoading>
      ) : (
        <div className="space-y-5">
          {example && <ExampleNotice onClear={clearExample} />}
          <ProductGoalLine goal={activeGoal} />

          {kickoffs.length === 0 ? (
            <>
              <EmptyState
                icon={PlaneTakeoff}
                action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
              >
                No kickoff yet. Pick a format below, or load an example.
              </EmptyState>
              {startCard}
            </>
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <nav aria-label="Kickoffs" className="space-y-2">
                <ul className="space-y-1.5">
                  {kickoffs.map((k) => {
                    const current = selected?.id === k.id;
                    return (
                      <li key={k.id}>
                        <button
                          type="button"
                          aria-current={current ? "true" : undefined}
                          onClick={() =>
                            guard(k.id, () => {
                              setCreating(null);
                              select(k.id);
                            })
                          }
                          className={cn(
                            "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            current
                              ? "border-accent bg-accent/10"
                              : "border-border bg-card hover:border-accent/40"
                          )}
                        >
                          <span className="block break-words text-sm font-medium text-text">
                            {k.title || formatOf(k).name}
                          </span>
                          <span className="block text-xs text-sub">
                            {formatOf(k).name} · {k.status === "agreed" ? "Agreed" : "Draft"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {creating === null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => {
                      setCreating({});
                      setStartKey((n) => n + 1);
                      focus.current = "start";
                    }}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New kickoff
                  </Button>
                )}
              </nav>
              <div className="min-w-0 space-y-4">
                {creating !== null && startCard}
                {selected && (
                  // Not a card: its sections are cards, and a phone has no width to spare.
                  <section aria-labelledby={`${selected.id}-heading`} className="min-w-0 space-y-3">
                    <h2
                      id={`${selected.id}-heading`}
                      className="flex items-start gap-2 text-lg font-semibold text-text"
                    >
                      <PlaneTakeoff
                        className="mt-1 h-5 w-5 shrink-0 text-accent"
                        aria-hidden="true"
                      />
                      <span
                        ref={headingRef}
                        tabIndex={-1}
                        className="min-w-0 break-words rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {selected.title || formatOf(selected).name}
                      </span>
                    </h2>
                    <KickoffView
                      key={selected.id}
                      handle={handleFor(selected)}
                      context={context}
                      onStartAnother={() => startAnother(selected)}
                      onRemove={() => guard(null, () => remove(selected), true)}
                      onRoomChange={onRoomChange(selected.id)}
                    />
                  </section>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename={`kickoff-${slugOf(selected?.title ?? "")}`}
              markdown={markdown}
              clipboardText={markdown}
            />
          </div>
          <ConfirmDialog
            open={pending !== null}
            onOpenChange={(open) => {
              if (!open) setPending(null);
            }}
            title="End the live room?"
            description={[
              `The room on “${short(liveTitle) || "this kickoff"}” is still live.`,
              `${pending?.deletes ? "Deleting the kickoff" : "Showing another kickoff"} ends it for everyone in it${
                liveRoom?.unsaved
                  ? ", and the answers in its round aren't saved, so they'd be lost."
                  : "."
              }`,
            ].join(" ")}
            confirmLabel={pending?.deletes ? "End it and delete" : "End it and switch"}
            cancelLabel="Keep the room"
            onConfirm={() => {
              const go = pending?.go;
              if (!go) return;
              const end = liveRef.current?.end;
              if (!end) {
                go();
                return;
              }
              // End the room first, so everyone in it hears "The host ended
              // the room" now; then switch or delete (after 3 s whatever happens).
              let done = false;
              const once = () => {
                if (done) return;
                done = true;
                go();
              };
              void end().then(once);
              window.setTimeout(once, 3000);
            }}
          />
        </div>
      )}
    </ToolPageWrapper>
  );
}
