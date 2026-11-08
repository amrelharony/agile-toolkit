"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ListChecks, Plus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/shared/export-button";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { HandoffLink } from "@/lib/handoffs/types";
import { carriedOverCard } from "@/app/(tools)/retro/archive";
import { restoreRemovedCards } from "@/app/(tools)/retro/helpers";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  RETRO_CURRENT_ID,
  actionCard,
  collectRetroActions,
  followThroughByRetro,
  quickAddBoard,
  summarizeRetroActions,
  withActionDone,
  withActionPatch,
  withAddedAction,
  type NewRetroAction,
  type RetroAction,
  type RetroActionPatch,
} from "@/lib/retro/actions";
import { ActionRow } from "./action-row";
import { buildExample, type RetroActionsExample } from "./example";
import {
  CHART_MIN_RETROS,
  followThroughPoints,
  followThroughText,
  ratedRetros,
  settleRetros,
  type SprintNameOf,
} from "./follow-through";
import { actionsToMarkdown } from "./markdown";
import { EVERYONE, NO_OWNER, matchesOwner, ownerOptions } from "./owners";
import { QuickAddForm } from "./quick-add";
import { retroActionsVerdict } from "./verdict";

export const TOOL_ID = "retro-actions";

// Recharts loads with the chart, not the page; the fixed-height box
// reserves the space while it does.
const FollowThroughChart = dynamic(() => import("./charts").then((m) => m.FollowThroughChart), {
  ssr: false,
});

const NO_BOARDS: RetroBoard[] = [];
const NO_SPRINTS: Sprint[] = [];
const NOTHING_KEPT: ReadonlySet<string> = new Set();

type Filter = "open" | "overdue" | "done" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

function matchesFilter(a: RetroAction, filter: Filter): boolean {
  if (filter === "open") return !a.done;
  if (filter === "overdue") return a.overdue;
  if (filter === "done") return a.done;
  return true;
}

/** A change to one board; null when it doesn't apply (the card is gone). */
type BoardUpdate = (board: RetroBoard) => RetroBoard | null;
/** Apply an update to a board by id; true when it applied. */
type BoardWriter = (boardId: string, update: BoardUpdate) => boolean;

/**
 * The board without one card; null when the card isn't on it. Cards grouped
 * under it stay on the board, ungrouped: deleting an action here never takes
 * other cards with it.
 */
const withoutCard =
  (cardId: string): BoardUpdate =>
  (board) =>
    board.cards.some((c) => c.id === cardId)
      ? {
          ...board,
          cards: board.cards
            .filter((c) => c.id !== cardId)
            .map((c) => (c.groupedWith === cardId ? { ...c, groupedWith: null } : c)),
        }
      : null;

/**
 * Logged when an action is deleted here. Not in RETRO_ACTIONS_ACTIONS
 * (lib/history/event-actions.ts) yet; named like the events that are.
 */
const ACTION_REMOVED = "action_removed";

/**
 * The column a quick-added action goes in: the board's first, as the
 * agent's tool.retro_actions.add files it. A legacy board without a format
 * has no columns to name.
 */
function quickAddColumn(board: RetroBoard): { key: string; label?: string } {
  const first = board.format?.columns?.[0];
  return first ? { key: first.key, label: first.label } : { key: "start" };
}

/** Writes to the workspace: the boards the cockpit, the Retro page and the agent read. */
const writeStore: BoardWriter = (boardId, update) => {
  const { retroBoards, upsertRetroBoard } = useWorkspaceStore.getState();
  const board = (retroBoards ?? []).find((b) => b.id === boardId);
  const next = board ? update(board) : null;
  if (next) upsertRetroBoard(next);
  return next !== null;
};

/**
 * The doneAt for a done day picked by hand: noon on that day, local, so it
 * reads as the same day for teammates a few time zones away.
 */
const doneAtOn = (day: string): string => new Date(`${day}T12:00:00`).toISOString();

/**
 * Retro Actions: every action item the team agreed, across the current
 * retro and the archives, with owner, due date and done — done also when
 * the impediment or Kanban card it was sent to is finished. Actions can be
 * added here without opening the board (and deleted, with Undo), open ones
 * carried onto the current retro or sent to another tool, and each past
 * retro shows how much of what it agreed got done once the next one starts.
 */
export function RetroActionsTracker() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  // Read so a resolved impediment or a finished Kanban card re-renders the list.
  const impediments = useWorkspaceStore((s) => s.impediments);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const sprints = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const roster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [filter, setFilter] = useState<Filter>("open");
  const [owner, setOwner] = useState(EVERYONE);
  // Rows changed since the filters were last set stay on screen, so ticking
  // Done under "Open" doesn't whisk the row (and its Undo) away.
  const [kept, setKept] = useState<ReadonlySet<string>>(NOTHING_KEPT);
  // The row to move focus to once it's on screen: a carried copy, whose
  // original row goes from under the Carry over button just pressed.
  const [focusId, setFocusId] = useState<string | null>(null);
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<RetroActionsExample | null>(null);
  const preview = example !== null;
  const boards = example?.boards ?? stored;
  const ownerId = useId();
  const filterId = useId();

  const keep = (id: string) => setKept((s) => new Set(s).add(id));
  const chooseFilter = (next: Filter) => {
    setFilter(next);
    setKept(NOTHING_KEPT);
  };
  const chooseOwner = (next: string) => {
    setOwner(next);
    setKept(NOTHING_KEPT);
  };

  const writeExample: BoardWriter = (boardId, update) => {
    setExample((ex) => {
      const board = ex?.boards.find((b) => b.id === boardId);
      const next = ex && board ? update(board) : null;
      return ex && next
        ? { ...ex, boards: ex.boards.map((b) => (b.id === boardId ? next : b)) }
        : ex;
    });
    return true;
  };
  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write = preview ? writeExample : writeStore;
  const record: typeof log = preview ? () => undefined : log;

  const targetDone = useMemo(
    () =>
      (link: HandoffLink): boolean =>
        isExampleId(link.targetId)
          ? (example?.doneTargets.has(link.targetId) ?? false)
          : (getHandoffRoute(link.route).isDone?.(link.targetId) ?? false),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targets live in these slices
    [example, impediments, kanbanBoards]
  );
  const actions = useMemo(
    () => collectRetroActions(boards, { today, targetDone }),
    [boards, today, targetDone]
  );
  const followThrough = useMemo(
    () => followThroughByRetro(boards, { targetDone }),
    [boards, targetDone]
  );
  const summary = useMemo(() => summarizeRetroActions(actions), [actions]);
  // The retro being followed up is where a quick-added action goes, and it
  // isn't rated yet: the verdict, chart and export read the others.
  const target = quickAddBoard(boards);
  const { settled, pending } = settleRetros(followThrough, target);
  const verdict = retroActionsVerdict(summary, settled);

  const sprintName: SprintNameOf = (id) =>
    id ? (example?.sprintNames[id] ?? sprints.find((s) => s.id === id)?.name) : undefined;
  const sprintOfBoard = new Map(boards.map((b) => [b.id, sprintName(b.sprintId)]));
  const chart = followThroughText(settled, sprintName);
  const points = followThroughPoints(settled, sprintName);
  const rated = ratedRetros(settled);
  const inProgress = actions.filter((a) => a.current).length;
  const pendingSprint = pending ? sprintName(pending.sprintId) : undefined;
  const pendingNote =
    pending && pending.agreed > 0
      ? `The latest retro, ${pendingSprint ? `for ${pendingSprint}` : pending.retroLabel} (${pending.agreed === 1 ? "1 action" : `${pending.agreed} actions`}), isn't rated until the next retro starts.`
      : null;

  const owners = ownerOptions(actions, roster);
  // The chosen owner's option, by name key: its spelling can change under
  // the filter (an owner edited from "sam" to "Sam"), and the select needs
  // its exact value or it shows "Everyone" while the list stays filtered.
  const ownerOption =
    owner === EVERYONE || owner === NO_OWNER
      ? undefined
      : owners.find((o) => matchesOwner({ assignee: o.name }, owner));
  const ownerMissing = owner !== EVERYONE && owner !== NO_OWNER && !ownerOption;
  const unowned = actions.filter((a) => !a.done && !a.assignee.trim()).length;

  const shown = actions.filter(
    (a) => kept.has(a.id) || (matchesFilter(a, filter) && matchesOwner(a, owner))
  );
  const groups: { boardId: string; label: string; actions: RetroAction[] }[] = [];
  for (const a of shown) {
    const last = groups[groups.length - 1];
    if (last && last.boardId === a.boardId) last.actions.push(a);
    else groups.push({ boardId: a.boardId, label: a.retroLabel, actions: [a] });
  }
  const markdown = actionsToMarkdown(actions, summary, {
    followThrough: settled,
    sprintName,
    verdict,
  });

  /* ── Where a quick-added action goes ──────────────────────────────── */

  const targetLabel = !target
    ? ""
    : target.archivedAt
      ? (followThrough.find((r) => r.boardId === target.id)?.retroLabel ?? "the latest retro")
      : "the current retro";
  const targetSprint = target ? sprintName(target.sprintId) : undefined;
  const targetColumn = target ? quickAddColumn(target).label : undefined;
  // The column is named: on the Retro board the action is a card in it.
  const into = targetColumn ? `in the ${targetColumn} column of` : "on";
  const ofSprint = targetSprint ? ` (${targetSprint})` : "";
  const targetText = !target
    ? ""
    : preview
      ? // The example's boards, not the workspace's, which may well have a retro in progress.
        `In the example, it goes ${into} ${target.archivedAt ? `its latest retro: ${targetLabel}` : "its current retro"}${ofSprint}. Nothing is saved.`
      : target.archivedAt
        ? `No retro is in progress, so it goes ${into} the latest one: ${targetLabel}${ofSprint}.`
        : `Goes ${into} the current retro${ofSprint}.`;

  /* ── Changes ──────────────────────────────────────────────────────── */

  const cardOf = (a: RetroAction) =>
    boards.find((b) => b.id === a.boardId)?.cards.find((c) => c.id === a.id);

  const add = (values: NewRetroAction) => {
    const board = quickAddBoard(
      preview ? boards : (useWorkspaceStore.getState().retroBoards ?? [])
    );
    if (!board) return;
    const card = actionCard(values, quickAddColumn(board).key);
    keep(card.id);
    undoable({
      label: `Added “${card.text}”`,
      apply: () => {
        if (write(board.id, (b) => withAddedAction(b, card))) {
          record(RETRO_ACTIONS_ACTIONS.ACTION_ADDED, {
            boardId: board.id,
            cardId: card.id,
            text: card.text,
          });
        }
      },
      revert: () => write(board.id, withoutCard(card.id)),
    });
    announce(`Added “${card.text}” to ${targetLabel || "the retro"}`);
  };

  const setDone = (a: RetroAction, done: boolean) => {
    const card = cardOf(a);
    if (!card) return;
    // Undo puts back the done day it had, not a new one.
    const before: RetroActionPatch = { done: card.done, doneAt: card.doneAt };
    keep(a.id);
    undoable({
      label: done ? `Done: “${a.text}”` : `Reopened “${a.text}”`,
      apply: () => {
        if (write(a.boardId, (b) => withActionDone(b, a.id, done))) {
          record(done ? RETRO_ACTIONS_ACTIONS.ACTION_DONE : RETRO_ACTIONS_ACTIONS.ACTION_REOPENED, {
            boardId: a.boardId,
            cardId: a.id,
            text: a.text,
          });
        }
      },
      revert: () => write(a.boardId, (b) => withActionPatch(b, a.id, before)),
    });
    announce(done ? `Marked “${a.text}” done` : `Reopened “${a.text}”`);
  };

  const edit = (a: RetroAction, patch: RetroActionPatch, field: keyof RetroActionPatch) => {
    keep(a.id);
    if (write(a.boardId, (b) => withActionPatch(b, a.id, patch))) {
      record(RETRO_ACTIONS_ACTIONS.ACTION_EDITED, { boardId: a.boardId, cardId: a.id, field });
    }
  };

  const patchLinks = (
    a: RetroAction,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    write(a.boardId, (b) => ({
      ...b,
      cards: b.cards.map((c) => (c.id === a.id ? { ...c, sentTo: update(c.sentTo) } : c)),
    }));
  };

  const carryOver = (a: RetroAction) => {
    if (preview) return;
    const current = (useWorkspaceStore.getState().retroBoards ?? []).find(
      (b) => b.id === RETRO_CURRENT_ID && !b.archivedAt
    );
    if (!current?.format) {
      toast.error("Open the Retro board and pick a format first.");
      return;
    }
    const original = cardOf(a);
    if (!original) return;
    const card = carriedOverCard(
      original,
      current.format.columns.map((c) => c.key),
      crypto.randomUUID()
    );
    keep(card.id);
    undoable({
      label: `Carried “${a.text}” over to the current retro`,
      apply: () => {
        if (writeStore(RETRO_CURRENT_ID, (b) => withAddedAction(b, card))) {
          log(RETRO_ACTIONS_ACTIONS.ACTION_CARRIED_OVER, { cardId: a.id, boardId: a.boardId });
        }
      },
      revert: () => {
        writeStore(RETRO_CURRENT_ID, withoutCard(card.id));
        // The original row comes back as the copy goes: focus follows it.
        keep(a.id);
        setFocusId(a.id);
      },
    });
    setFocusId(card.id);
    announce(`Carried “${a.text}” over to the current retro`);
  };

  const remove = (a: RetroAction) => {
    const board = boards.find((b) => b.id === a.boardId);
    if (!board?.cards.some((c) => c.id === a.id)) return;
    // Undo puts it back in its place on the board, regrouping any card that
    // was grouped under it, and keeps edits made to other cards meanwhile.
    const before = board.cards;
    const removed = new Set([a.id]);
    // Focus moves to the next row on screen (or the one before) as this one goes.
    const at = shown.findIndex((s) => s.id === a.id);
    const neighbour = shown[at + 1] ?? shown[at - 1];
    keep(a.id);
    undoable({
      label: `Deleted “${a.text}”`,
      apply: () => {
        if (write(a.boardId, withoutCard(a.id))) {
          record(ACTION_REMOVED, { boardId: a.boardId, cardId: a.id, text: a.text });
        }
      },
      revert: () => {
        write(a.boardId, (b) => ({ ...b, cards: restoreRemovedCards(b.cards, before, removed) }));
        setFocusId(a.id);
      },
    });
    setFocusId(neighbour?.id ?? null);
    announce(`Deleted “${a.text}”`);
  };

  const loadExample = () => {
    setExample(buildExample());
    setKept(NOTHING_KEPT);
  };
  const clearExample = () => {
    setExample(null);
    setKept(NOTHING_KEPT);
  };

  if (!hydrated) {
    return <WorkspaceLoading>Loading retro actions…</WorkspaceLoading>;
  }

  return (
    <div className="space-y-4">
      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: a checkout team&apos;s last three retros. Nothing in it is saved, carried over
            or sent to another tool, and your own retros stay as they are.
          </p>
        </div>
      )}

      {target && (
        <SectionCard title="Add an action" icon={Plus}>
          <QuickAddForm onAdd={add} target={targetText} offerAddToRoster={!preview} />
        </SectionCard>
      )}

      {actions.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
        >
          {target
            ? "No action items yet. Add one above, or mark a card as an action item on the Retro board; "
            : "No retro yet. Hold one on the Retro board and mark the cards the team will act on as action items; "}
          they appear here, across every retro, until they&apos;re done.{" "}
          <Link href="/retro" className="font-medium text-accent hover:underline">
            Open the Retro board
          </Link>
        </EmptyState>
      ) : (
        <>
          <p className="text-sm font-medium text-text">{verdict}</p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p id={filterId} className="mb-1 text-xs font-medium text-sub">
                  Show
                </p>
                <div role="group" aria-labelledby={filterId} className="flex flex-wrap gap-1">
                  {FILTERS.map((f) => (
                    <Button
                      key={f.id}
                      type="button"
                      size="sm"
                      variant={filter === f.id ? "default" : "outline"}
                      aria-pressed={filter === f.id}
                      onClick={() => chooseFilter(f.id)}
                    >
                      {f.label}
                      <span className="ml-1 font-mono text-xs opacity-80">
                        {f.id === "open"
                          ? summary.open
                          : f.id === "overdue"
                            ? summary.overdue
                            : f.id === "done"
                              ? summary.done
                              : actions.length}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor={ownerId} className="mb-1 block text-xs font-medium text-sub">
                  Filter by owner
                </label>
                <select
                  id={ownerId}
                  className="flex h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={ownerOption?.name ?? owner}
                  onChange={(e) => chooseOwner(e.target.value)}
                >
                  <option value={EVERYONE}>Everyone</option>
                  {owners.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.open > 0 ? `${o.name} (${o.open} open)` : o.name}
                    </option>
                  ))}
                  {ownerMissing && <option value={owner}>{owner}</option>}
                  <option value={NO_OWNER}>
                    {unowned > 0 ? `No owner (${unowned} open)` : "No owner"}
                  </option>
                </select>
              </div>
            </div>
            <ExportButton filename="retro-actions" markdown={markdown} clipboardText={markdown} />
          </div>

          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-sub">
              Nothing matches. Try another filter.
            </p>
          ) : (
            groups.map((group) => {
              const sprint = sprintOfBoard.get(group.boardId);
              return (
                <section key={group.boardId} aria-label={group.label} className="space-y-2">
                  <h2 className="text-sm font-semibold text-text">
                    {group.label}
                    {sprint && <span className="font-normal text-sub"> · {sprint}</span>}
                  </h2>
                  <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                    {group.actions.map((a) => (
                      <ActionRow
                        key={a.id}
                        action={a}
                        preview={preview}
                        today={today}
                        takeFocus={focusId === a.id}
                        onFocusTaken={() => setFocusId(null)}
                        onDone={setDone}
                        onDoneDay={(row, day) => edit(row, { doneAt: doneAtOn(day) }, "doneAt")}
                        onText={(row, text) => edit(row, { text }, "text")}
                        onOwner={(row, assignee) => edit(row, { assignee }, "assignee")}
                        onDueDate={(row, dueDate) => edit(row, { dueDate }, "dueDate")}
                        onCarryOver={carryOver}
                        onDelete={remove}
                        onLinksChange={patchLinks}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          <SectionCard title="Follow-through per retro" icon={TrendingUp}>
            {rated.length >= CHART_MIN_RETROS ? (
              <ChartFigure
                label="Follow-through per retro"
                summary={chart.summary}
                table={chart.table}
                caption="Follow-through per retro"
                plotClassName="h-[220px]"
              >
                <FollowThroughChart data={points} />
              </ChartFigure>
            ) : (
              <NotEnoughData
                have={rated.length}
                need={CHART_MIN_RETROS}
                unit={["retro with actions", "retros with actions"]}
                action="Hold"
                what="the follow-through per retro"
              />
            )}
            {inProgress > 0 ? (
              <p className="mt-3 text-xs text-sub">
                The current retro ({inProgress === 1 ? "1 action" : `${inProgress} actions`})
                isn&apos;t rated until the next retro starts.
              </p>
            ) : (
              pendingNote && <p className="mt-3 text-xs text-sub">{pendingNote}</p>
            )}
          </SectionCard>

          <p className="text-sm text-sub">
            <Link
              href="/retro"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              Retro board
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>{" "}
            — the next retro opens with these actions to check.
          </p>
        </>
      )}
    </div>
  );
}
