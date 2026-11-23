"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { Anchor, MessagesSquare, MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BoardDnd, DragPreview, DraggableCard, DropColumn } from "@/app/(tools)/kanban/board-dnd";
import { useCardReferences } from "@/app/(tools)/planning-poker/use-card-references";
import {
  TALK_LANE,
  UNPLACED_LANE,
  guideScaleOf,
  itemsIn,
  laneId,
  laneOf,
  readLane,
  roomLine,
  type Lane,
} from "@/lib/relative-sizing/model";
import type { SizingBoard, SizingItem } from "@/lib/relative-sizing/state";
import { cn } from "@/lib/utils";

interface LaneInfo {
  id: string;
  lane: Lane;
  label: string;
  hint?: string;
}

/** The lanes in board order: not placed, each bucket, then Talk about it. */
export function lanesOf(board: SizingBoard): LaneInfo[] {
  return [
    { id: UNPLACED_LANE, lane: { kind: "unplaced" }, label: "Not placed" },
    ...board.buckets.map((b) => ({
      id: b.id,
      lane: { kind: "bucket", bucketId: b.id } as Lane,
      label: b.label,
      hint:
        b.points !== undefined
          ? `${b.points} ${b.points === 1 ? "point" : "points"}`
          : "No points yet",
    })),
    { id: TALK_LANE, lane: { kind: "talk" }, label: "Talk about it" },
  ];
}

/**
 * The board: a card per story in "Not placed", a column per bucket, and
 * "Talk about it" for the cards moved too often or put far apart. A card
 * moves by its grip (mouse, pen or finger) or its "Move to…" menu
 * (keyboard, screen reader, phone). The Estimation Guide's reference
 * stories show as dashed cards in their bucket, on this screen only. On a
 * phone the buckets stack, so the page never scrolls sideways.
 */
export function SizingBoardView({
  board,
  onMove,
  talk,
}: {
  board: SizingBoard;
  /** A card was moved to a lane (by drag or menu). */
  onMove: (itemId: string, lane: Lane, focus: () => void) => void;
  /** What shows under Talk about it's cards: the panel with its questions and sends. */
  talk?: (item: SizingItem) => ReactNode;
}) {
  const lanes = lanesOf(board);
  const references = useCardReferences(
    guideScaleOf(board.bucketSet),
    board.buckets.map((b) => b.label)
  );
  const triggers = useRef(new Map<string, HTMLElement | null>());
  const focusCard = (id: string) => () =>
    requestAnimationFrame(() => triggers.current.get(id)?.focus());
  const titleOf = useCallback(
    (id: string) => board.items.find((i) => i.id === id)?.title ?? "",
    [board.items]
  );

  const card = (item: SizingItem) => (
    <DraggableCard key={item.id} id={item.id} className="min-w-0">
      {(grip) => (
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-md border bg-card p-2",
            item.contested ? "border-warning/50" : "border-border"
          )}
          data-card-id={item.id}
        >
          <div className="flex min-w-0 items-start gap-1.5">
            {grip}
            <p className="min-w-0 flex-1 break-words text-sm text-text">
              {item.id === board.anchorItemId && (
                <span className="mr-1 inline-flex items-center gap-0.5 text-xs font-semibold text-accent">
                  <Anchor className="h-3 w-3" aria-hidden="true" />
                  Anchor:
                </span>
              )}
              {item.title}
            </p>
          </div>
          <p className="text-xs text-sub">
            {[
              item.dealtTo ? `${item.dealtTo} places it` : "",
              item.moves > 0 ? `moved ${item.moves} ${item.moves === 1 ? "time" : "times"}` : "",
              item.contested && item.bucketId
                ? `last in ${board.buckets.find((b) => b.id === item.bucketId)?.label ?? ""}`
                : "",
              item.room ? `the room: ${roomLine(board, item.room.counts)}` : "",
              item.storyId ? "" : "not in the backlog",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <MoveMenu
            item={item}
            lanes={lanes}
            triggerRef={(el) => triggers.current.set(item.id, el)}
            onMove={(lane) => onMove(item.id, lane, focusCard(item.id))}
          />
          {item.contested && talk?.(item)}
        </div>
      )}
    </DraggableCard>
  );

  const column = (info: LaneInfo) => {
    const list = itemsIn(board, info.lane);
    const ref = info.lane.kind === "bucket" ? references(info.label) : null;
    return (
      <DropColumn
        key={info.id}
        id={info.id}
        className={cn(
          "flex min-w-0 flex-col gap-2 border p-2",
          info.lane.kind === "talk"
            ? "border-warning/40 bg-warning/10"
            : info.lane.kind === "unplaced"
              ? "border-dashed border-border bg-surface"
              : "border-border bg-surface"
        )}
      >
        <section aria-label={info.lane.kind === "bucket" ? `Bucket ${info.label}` : info.label}>
          <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold text-text">
            <span className="inline-flex items-center gap-1">
              {info.lane.kind === "talk" && (
                <MessagesSquare className="h-4 w-4 text-warning" aria-hidden="true" />
              )}
              {info.label}
            </span>
            <span className="text-xs font-normal text-sub">
              {list.length}
              {info.hint ? ` · ${info.hint}` : ""}
            </span>
          </h3>
          {ref && ref.stories.length > 0 && (
            <ul className="mt-2 space-y-1" aria-label={`Reference stories for ${info.label}`}>
              {ref.stories.slice(0, 2).map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-sub"
                >
                  Reference: {s.title}
                </li>
              ))}
            </ul>
          )}
          {list.length === 0 ? (
            <p className="mt-2 text-xs text-sub">
              {info.lane.kind === "talk"
                ? "Cards moved too often, or put far apart, wait here."
                : info.lane.kind === "unplaced"
                  ? "Every card is placed."
                  : "Empty."}
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">{list.map(card)}</div>
          )}
        </section>
      </DropColumn>
    );
  };

  return (
    <BoardDnd
      titleOf={titleOf}
      renderOverlay={(id) => <DragPreview title={titleOf(id)} />}
      onMove={(itemId, columnId) => {
        const lane = readLane(board, columnId);
        const item = board.items.find((i) => i.id === itemId);
        if (!lane || !item || laneId(laneOf(item)) === columnId) return;
        onMove(itemId, lane, focusCard(itemId));
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {lanes.filter((l) => l.lane.kind !== "talk").map(column)}
      </div>
      <div className="mt-3">{column(lanes[lanes.length - 1])}</div>
    </BoardDnd>
  );
}

/** "Move to…": every other lane, from the keyboard as well as the mouse. */
function MoveMenu({
  item,
  lanes,
  triggerRef,
  onMove,
}: {
  item: SizingItem;
  lanes: LaneInfo[];
  triggerRef: (el: HTMLElement | null) => void;
  onMove: (lane: Lane) => void;
}) {
  const here = laneId(laneOf(item));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          className="min-touch-coarse h-7 gap-1 self-start px-2 text-xs"
        >
          <MoveRight aria-hidden="true" />
          Move to…
          <span className="sr-only">: {item.title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs font-medium text-sub">Move to</DropdownMenuLabel>
        {lanes.map((l) => (
          <DropdownMenuItem
            key={l.id}
            disabled={l.id === here}
            aria-label={l.id === here ? `${l.label} (here now)` : l.label}
            onSelect={() => onMove(l.lane)}
          >
            {l.label}
            {l.id === here && <span className="ml-auto text-xs text-sub">here</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
