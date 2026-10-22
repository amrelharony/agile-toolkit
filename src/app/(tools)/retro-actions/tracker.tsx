"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportButton } from "@/components/shared/export-button";
import { EmptyState } from "@/components/shared/empty-state";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import type { HandoffLink } from "@/lib/handoffs/types";
import { carriedOverCard } from "@/app/(tools)/retro/archive";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";
import {
  RETRO_CURRENT_ID,
  collectRetroActions,
  summarizeRetroActions,
  withActionDone,
  withActionPatch,
  type RetroAction,
} from "@/lib/retro/actions";
import { actionsToMarkdown } from "./markdown";

export const TOOL_ID = "retro-actions";

/** MUST match RETRO_ACTION_ROUTES in retro/components/retro-card-item.tsx. */
const ROUTES = ["impediment", "kanban"] as const;

const NO_BOARDS: RetroBoard[] = [];

type Filter = "open" | "overdue" | "done" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

/** The owner, edited in a draft and saved on blur or Enter. */
function OwnerCell({ action, onSave }: { action: RetroAction; onSave: (owner: string) => void }) {
  const [draft, setDraft] = useState(action.assignee);
  useEffect(() => setDraft(action.assignee), [action.assignee]);
  const commit = () => {
    if (draft.trim() !== action.assignee.trim()) onSave(draft.trim());
  };
  return (
    <Input
      aria-label={`Owner of ${action.text}`}
      className="h-8 w-32"
      placeholder="Owner"
      maxLength={60}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * Retro Actions: every action item the team agreed, across the current
 * retro and the archives, with owner, due date and done — done also when
 * the impediment or Kanban card it was sent to is finished. Open items can
 * be carried onto the current retro board or sent to another tool.
 */
export function RetroActionsTracker() {
  const hydrated = useWorkspaceHydrated();
  const boards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  // Read so a resolved impediment or a finished Kanban card re-renders the list.
  const impediments = useWorkspaceStore((s) => s.impediments);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const upsertRetroBoard = useWorkspaceStore((s) => s.upsertRetroBoard);
  const { log } = useHistoryLogger(TOOL_ID);
  const [today] = useState(() => todayIso());
  const [filter, setFilter] = useState<Filter>("open");
  const [owner, setOwner] = useState("all");
  const ownerId = useId();
  const filterId = useId();

  const actions = useMemo(
    () =>
      collectRetroActions(boards, {
        today,
        targetDone: (link) => getHandoffRoute(link.route).isDone?.(link.targetId) ?? false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targets live in these slices
    [boards, today, impediments, kanbanBoards]
  );
  const summary = useMemo(() => summarizeRetroActions(actions), [actions]);
  const owners = useMemo(
    () =>
      Array.from(new Set(actions.map((a) => a.assignee.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [actions]
  );
  const shown = useMemo(
    () =>
      actions.filter((a) => {
        if (filter === "open" && a.done) return false;
        if (filter === "overdue" && !a.overdue) return false;
        if (filter === "done" && !a.done) return false;
        if (owner !== "all" && a.assignee.trim() !== owner) return false;
        return true;
      }),
    [actions, filter, owner]
  );
  const groups = useMemo(() => {
    const out: { boardId: string; label: string; actions: RetroAction[] }[] = [];
    for (const a of shown) {
      const last = out[out.length - 1];
      if (last && last.boardId === a.boardId) last.actions.push(a);
      else out.push({ boardId: a.boardId, label: a.retroLabel, actions: [a] });
    }
    return out;
  }, [shown]);
  const markdown = useMemo(() => actionsToMarkdown(actions, summary), [actions, summary]);

  const boardOf = (a: RetroAction) =>
    (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === a.boardId);

  const setDone = (a: RetroAction, done: boolean) => {
    const board = boardOf(a);
    const next = board && withActionDone(board, a.id, done);
    if (!next) return;
    upsertRetroBoard(next);
    log(done ? RETRO_ACTIONS_ACTIONS.ACTION_DONE : RETRO_ACTIONS_ACTIONS.ACTION_REOPENED, {
      boardId: a.boardId,
      cardId: a.id,
      text: a.text,
    });
  };

  const patch = (a: RetroAction, p: Parameters<typeof withActionPatch>[2]) => {
    const board = boardOf(a);
    const next = board && withActionPatch(board, a.id, p);
    if (next) upsertRetroBoard(next);
  };

  const patchLinks = (
    a: RetroAction,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => {
    const board = boardOf(a);
    if (!board) return;
    upsertRetroBoard({
      ...board,
      cards: board.cards.map((c) => (c.id === a.id ? { ...c, sentTo: update(c.sentTo) } : c)),
    });
  };

  const carryOver = (a: RetroAction) => {
    const current = (useWorkspaceStore.getState().retroBoards ?? []).find(
      (b) => b.id === RETRO_CURRENT_ID && !b.archivedAt
    );
    if (!current?.format) {
      toast.error("Open the Retro board and pick a format first.");
      return;
    }
    const original = boardOf(a)?.cards.find((c) => c.id === a.id);
    if (!original) return;
    const card = carriedOverCard(
      original,
      current.format.columns.map((c) => c.key),
      crypto.randomUUID()
    );
    upsertRetroBoard({ ...current, cards: [...current.cards, card] });
    log(RETRO_ACTIONS_ACTIONS.ACTION_CARRIED_OVER, { cardId: a.id, boardId: a.boardId });
    toast.success("Carried over to the current retro");
  };

  if (!hydrated) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
      >
        Loading retro actions…
      </p>
    );
  }

  if (actions.length === 0) {
    return (
      <EmptyState icon={ListChecks}>
        No action items yet. In the Retro board, mark a card as an action item and give it an owner;
        it appears here, across every retro, until it&apos;s done.{" "}
        <Link href="/retro" className="font-medium text-accent hover:underline">
          Open the Retro board
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
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
                  onClick={() => setFilter(f.id)}
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
              Owner
            </label>
            <select
              id={ownerId}
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="all">Everyone</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
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
        groups.map((group) => (
          <section key={group.boardId} aria-label={group.label} className="space-y-2">
            <h2 className="text-sm font-semibold text-text">{group.label}</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {group.actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={a.done}
                    disabled={a.closedByTarget}
                    aria-label={`Done: ${a.text}`}
                    onChange={(e) => setDone(a, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1 basis-56">
                    <span
                      className={cn(
                        "block break-words text-sm",
                        a.done ? "text-sub line-through" : "text-text"
                      )}
                    >
                      {a.text}
                    </span>
                    <span className="block text-xs text-sub">
                      {a.overdue && <span className="font-medium text-warning">Overdue · </span>}
                      {a.closedByTarget && (
                        <span className="text-success">Done in the linked tool · </span>
                      )}
                      {a.carriedFrom && "Carried over · "}
                      {a.doneAt && a.done && !a.closedByTarget
                        ? `Done ${a.doneAt.slice(0, 10)}`
                        : a.current
                          ? "This retro"
                          : "Past retro"}
                    </span>
                  </span>
                  <OwnerCell action={a} onSave={(assignee) => patch(a, { assignee })} />
                  <Input
                    type="date"
                    aria-label={`Due date of ${a.text}`}
                    className="h-8 w-40"
                    value={a.dueDate ?? ""}
                    onChange={(e) =>
                      patch(a, { dueDate: e.target.value ? e.target.value : undefined })
                    }
                  />
                  {!a.current && !a.done && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => carryOver(a)}
                    >
                      Carry over
                    </Button>
                  )}
                  <SendToMenu
                    routes={ROUTES}
                    item={{
                      title: a.text,
                      owner: a.assignee || undefined,
                      sourceRef: { tool: "retro", id: a.id, doc: a.boardId },
                    }}
                    sentTo={a.sentTo}
                    onLinksChange={(update) => patchLinks(a, update)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

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
    </div>
  );
}
