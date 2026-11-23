"use client";

/**
 * "Actions from the last retro", shown while the team writes cards: each
 * action the previous retro agreed, with "Carry over" (copies it onto this
 * board as an action item) and "Send to…" (an impediment, a Kanban card or
 * a backlog story). Sending records the link on the archived card, so the
 * next look shows where it went. An action that got done (marked in Retro
 * Actions, or its impediment resolved, its Kanban card finished, its story
 * done) says so, and isn't offered for carrying over: that is the
 * follow-through the retro starts by checking.
 */

import { useId, useMemo } from "react";
import { Check, CheckCircle2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { isExampleId } from "@/components/tool-frame/example-data";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { isActionDone } from "@/lib/retro/actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroCard as StoredRetroCard } from "@/lib/stores/workspace-types";
import type { HandoffLink } from "@/lib/handoffs/types";
import type { RetroCard } from "../types";
import { pastRetros, retroActionItems } from "../archive";
import { ExampleNotSent, RETRO_ACTION_ROUTES } from "./retro-card-item";

/** Whether a hand-off target (an impediment, a Kanban card, a story) is finished. */
const targetDone = (link: HandoffLink) =>
  getHandoffRoute(link.route).isDone?.(link.targetId) ?? false;

function formatDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
}

/** Update one card's links on an archived retro, read fresh. */
function setArchivedCardLinks(
  retroId: string,
  cardId: string,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
) {
  const ws = useWorkspaceStore.getState();
  const board = (ws.retroBoards ?? []).find((b) => b.id === retroId);
  if (!board || !board.cards.some((c) => c.id === cardId)) return;
  ws.upsertRetroBoard({
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? { ...c, sentTo: update(c.sentTo) } : c)),
  });
}

export function LastRetroActions({
  retroId,
  cards,
  onCarryOver,
}: {
  /**
   * The archive this board follows (useBoardFacts picks it, so this panel
   * and the facts' "Last retro's actions" agree); null for none.
   */
  retroId: string | null;
  /** This board's cards, to tell which actions are already carried over. */
  cards: readonly RetroCard[];
  onCarryOver: (action: StoredRetroCard) => void;
}) {
  const boards = useWorkspaceStore((s) => s.retroBoards);
  // Re-read when a target finishes, for "Done".
  useWorkspaceStore((s) => s.impediments);
  useWorkspaceStore((s) => s.kanbanBoards);
  useWorkspaceStore((s) => s.stories);
  const previous = useMemo(
    () => (retroId ? (pastRetros(boards ?? []).find((b) => b.id === retroId) ?? null) : null),
    [boards, retroId]
  );
  const actions = useMemo(() => (previous ? retroActionItems(previous) : []), [previous]);
  const headingId = useId();
  if (!previous || actions.length === 0) return null;

  const carried = new Set(cards.map((c) => c.carriedFrom).filter(Boolean));
  const day = formatDay(previous.archivedAt);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card p-3 space-y-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <History className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 id={headingId} className="text-sm font-semibold text-text">
          Actions from the last retro
        </h2>
        <span className="text-xs text-sub">
          {previous.format?.name}
          {day ? ` · ${day}` : ""}
        </span>
      </div>
      <p className="text-xs text-sub">
        Check how each one went. Carry over the ones that are still open.
      </p>
      <ul className="space-y-1.5">
        {actions.map((action) => {
          const done = isActionDone(action, targetDone);
          return (
            <li
              key={action.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-cardH px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 break-words text-sm text-text">{action.text}</span>
              {action.assignee && <span className="text-xs text-sub">{action.assignee}</span>}
              {done && (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Done
                </span>
              )}
              {/* A done action isn't carried: its copy would be open work again. */}
              {carried.has(action.id) ? (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Carried over
                </span>
              ) : done ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCarryOver(action)}
                  aria-label={`Carry over ${action.text}`}
                  className="min-touch-coarse h-7 px-2 text-xs text-sub hover:text-accent"
                >
                  Carry over
                </Button>
              )}
              {isExampleId(action.id) ? (
                <ExampleNotSent />
              ) : (
                <SendToMenu
                  routes={RETRO_ACTION_ROUTES}
                  item={{
                    title: action.text,
                    owner: action.assignee || undefined,
                    sourceRef: { tool: "retro", id: action.id, doc: previous.id },
                  }}
                  sentTo={action.sentTo}
                  onLinksChange={(update) => setArchivedCardLinks(previous.id, action.id, update)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
