"use client";

import { useState, useMemo, useEffect, useId } from "react";
import {
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type Announcements,
  type DragStartEvent,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SonifiedDndContext as DndContext } from "@/lib/sonification/sonified-dnd-context";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { generateStoryMapperPrompts } from "@/lib/ai-prompts/story-mapper";
import { undoable } from "@/lib/utils/undoable";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace, StoryMap } from "@/lib/stores/workspace-types";
import { EditableName } from "@/components/shared/editable-name";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { STORY_MAPPER_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Plus, Trash2, GripVertical, Pencil, Map, ArrowRightLeft } from "lucide-react";
import { buildExampleSlices, buildExampleSteps } from "./example";
import { toMarkdown } from "./markdown";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface StoryCard {
  id: string;
  title: string;
  description: string;
  color: string;
}

/** stepId -> StoryCard[] */
type StepCards = Record<string, StoryCard[]>;

interface Slice {
  id: string;
  name: string;
  cards: StepCards;
}

interface Step {
  id: string;
  name: string;
}

interface StoryMapState {
  steps: Step[];
  slices: Slice[];
  addStep: () => void;
  removeStep: (stepId: string) => void;
  renameStep: (stepId: string, name: string) => void;
  addSlice: () => void;
  removeSlice: (sliceId: string) => void;
  renameSlice: (sliceId: string, name: string) => void;
  addCard: (sliceId: string, stepId: string) => void;
  updateCard: (sliceId: string, stepId: string, card: StoryCard) => void;
  removeCard: (sliceId: string, stepId: string, cardId: string) => void;
  moveCard: (
    fromSliceId: string,
    fromStepId: string,
    toSliceId: string,
    toStepId: string,
    cardId: string,
    toIndex?: number
  ) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const CARD_COLORS = [
  { value: "#00f0ff", label: "Cyan" },
  { value: "#a78bfa", label: "Purple" },
  { value: "#34d399", label: "Green" },
  { value: "#fb923c", label: "Orange" },
  { value: "#f472b6", label: "Pink" },
];

function makeId() {
  return crypto.randomUUID();
}

// The default map is the example map (./example). R5: its ids are fixed, so
// server-render and client-hydrate produce the same DOM; random UUIDs at
// module-eval time produced an SSR/client mismatch on the very first visit
// (before any persisted state existed). User-added rows use makeId(). Maps
// saved before the ids gained their `example-` prefix keep their old ids.
const buildDefaultSteps: () => Step[] = buildExampleSteps;
const buildDefaultSlices: (steps: Step[]) => Slice[] = buildExampleSlices;

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

// The story map is a singleton synced workspace document (was an isolated
// localStorage zustand store), so MCP-written maps round-trip into the UI.
// `useStoryMapStore` preserves the prior store's API — including selector
// access (e.g. useStoryMapStore((s) => s.addCard)) — and the mutator bodies
// below are byte-for-byte unchanged: `set` is a shim that merges a partial
// onto the synced doc. MUST match SM_ID in src/lib/actions/tools/story-mapper.ts.
const SM_ID = "story-mapper:current";

function defaultStoryMap(): StoryMap {
  const steps = buildDefaultSteps();
  return { id: SM_ID, steps, slices: buildDefaultSlices(steps) };
}

function currentStoryMap(): StoryMap {
  return (
    (useWorkspaceStore.getState().storyMaps ?? []).find((m) => m.id === SM_ID) ?? defaultStoryMap()
  );
}

/** zustand-like `set` over the synced StoryMap doc: accepts a partial or an
 *  updater returning a partial; merges onto the freshest doc (id preserved).
 *  Reading freshest via getState() avoids clobbering on rapid sequential
 *  mutations. Lets the mutator bodies stay identical to the original store. */
function set(updater: Partial<StoryMap> | ((s: StoryMap) => Partial<StoryMap>)): void {
  const cur = currentStoryMap();
  const partial = typeof updater === "function" ? updater(cur) : updater;
  useWorkspaceStore.getState().upsertStoryMap({ ...cur, ...partial });
}

const storyMapApi: Omit<StoryMapState, "steps" | "slices"> = {
  addStep: () =>
    set((s) => {
      const newStep: Step = { id: makeId(), name: "New Step" };
      return {
        steps: [...s.steps, newStep],
        slices: s.slices.map((sl) => ({
          ...sl,
          cards: { ...sl.cards, [newStep.id]: [] },
        })),
      };
    }),

  removeStep: (stepId) =>
    set((s) => {
      if (s.steps.length <= 1) return s;
      return {
        steps: s.steps.filter((st) => st.id !== stepId),
        slices: s.slices.map((sl) => {
          const cards = { ...sl.cards };
          delete cards[stepId];
          return { ...sl, cards };
        }),
      };
    }),

  renameStep: (stepId, name) =>
    set((s) => ({
      steps: s.steps.map((st) => (st.id === stepId ? { ...st, name } : st)),
    })),

  addSlice: () =>
    set((s) => {
      const emptyCards: StepCards = {};
      for (const st of s.steps) emptyCards[st.id] = [];
      return {
        slices: [...s.slices, { id: makeId(), name: "New Slice", cards: emptyCards }],
      };
    }),

  removeSlice: (sliceId) =>
    set((s) => {
      if (s.slices.length <= 1) return s;
      return { slices: s.slices.filter((sl) => sl.id !== sliceId) };
    }),

  renameSlice: (sliceId, name) =>
    set((s) => ({
      slices: s.slices.map((sl) => (sl.id === sliceId ? { ...sl, name } : sl)),
    })),

  addCard: (sliceId, stepId) =>
    set((s) => ({
      slices: s.slices.map((sl) => {
        if (sl.id !== sliceId) return sl;
        const existing = sl.cards[stepId] ?? [];
        const newCard: StoryCard = {
          id: makeId(),
          title: "New Story",
          description: "",
          color: CARD_COLORS[0].value,
        };
        return {
          ...sl,
          cards: { ...sl.cards, [stepId]: [...existing, newCard] },
        };
      }),
    })),

  updateCard: (sliceId, stepId, card) =>
    set((s) => ({
      slices: s.slices.map((sl) => {
        if (sl.id !== sliceId) return sl;
        return {
          ...sl,
          cards: {
            ...sl.cards,
            [stepId]: (sl.cards[stepId] ?? []).map((c) => (c.id === card.id ? card : c)),
          },
        };
      }),
    })),

  removeCard: (sliceId, stepId, cardId) =>
    set((s) => ({
      slices: s.slices.map((sl) => {
        if (sl.id !== sliceId) return sl;
        return {
          ...sl,
          cards: {
            ...sl.cards,
            [stepId]: (sl.cards[stepId] ?? []).filter((c) => c.id !== cardId),
          },
        };
      }),
    })),

  moveCard: (fromSliceId, fromStepId, toSliceId, toStepId, cardId, toIndex) =>
    set((s) => {
      // Same-cell reorders need NO index adjustment: removing the card first
      // already shifts everything after it left by one, so splicing at the
      // raw over-index reproduces dnd-kit's arrayMove semantics — i.e. the
      // exact ordering the sortable preview showed during the drag. A prior
      // "decrement when source precedes target" correction here made every
      // downward drop land one slot above the preview.
      let movedCard: StoryCard | null = null;
      const slices = s.slices.map((sl) => {
        if (sl.id !== fromSliceId) return sl;
        const fromCards = sl.cards[fromStepId] ?? [];
        const idx = fromCards.findIndex((c) => c.id === cardId);
        if (idx === -1) return sl;
        movedCard = fromCards[idx];
        return {
          ...sl,
          cards: {
            ...sl.cards,
            [fromStepId]: fromCards.filter((c) => c.id !== cardId),
          },
        };
      });

      if (!movedCard) return s;

      const card = movedCard as StoryCard;
      return {
        slices: slices.map((sl) => {
          if (sl.id !== toSliceId) return sl;
          const toCards = [...(sl.cards[toStepId] ?? [])];
          const insertAt = toIndex !== undefined ? toIndex : toCards.length;
          toCards.splice(insertAt, 0, card);
          return {
            ...sl,
            cards: { ...sl.cards, [toStepId]: toCards },
          };
        }),
      };
    }),

  reset: () => {
    const steps = buildDefaultSteps();
    const slices = buildDefaultSlices(steps);
    set({ steps, slices });
  },
};

/* -- Undo helpers ---------------------------------------------------------- */
// Put a removed card, step or slice back where it was. Each reads the freshest
// doc and does nothing if the item is already back, so a toast Undo can never
// duplicate it.

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function restoreCard(sliceId: string, stepId: string, card: StoryCard, index: number) {
  const cur = currentStoryMap();
  const present = cur.slices.some((sl) =>
    Object.values(sl.cards).some((cards) => cards.some((c) => c.id === card.id))
  );
  // Its cell is gone if the slice or step was removed meanwhile.
  const cellExists =
    cur.slices.some((sl) => sl.id === sliceId) && cur.steps.some((st) => st.id === stepId);
  if (present || !cellExists) return;
  set({
    slices: cur.slices.map((sl) => {
      if (sl.id !== sliceId) return sl;
      const cards = [...(sl.cards[stepId] ?? [])];
      cards.splice(Math.min(index, cards.length), 0, card);
      return { ...sl, cards: { ...sl.cards, [stepId]: cards } };
    }),
  });
}

function restoreStep(step: Step, index: number, cardsBySlice: Record<string, StoryCard[]>) {
  const cur = currentStoryMap();
  if (cur.steps.some((st) => st.id === step.id)) return;
  const steps = [...cur.steps];
  steps.splice(Math.min(index, steps.length), 0, step);
  set({
    steps,
    slices: cur.slices.map((sl) => ({
      ...sl,
      cards: { ...sl.cards, [step.id]: cardsBySlice[sl.id] ?? [] },
    })),
  });
}

function restoreSlice(slice: Slice, index: number) {
  const cur = currentStoryMap();
  if (cur.slices.some((sl) => sl.id === slice.id)) return;
  // Re-key its cells to today's steps: steps added since get an empty cell,
  // steps removed since don't come back as orphaned keys.
  const cards: StepCards = {};
  for (const st of cur.steps) cards[st.id] = slice.cards[st.id] ?? [];
  const slices = [...cur.slices];
  slices.splice(Math.min(index, slices.length), 0, { ...slice, cards });
  set({ slices });
}

/* -- Example map ----------------------------------------------------------- */

/**
 * Put the example map in front of the (card-less) steps and slices already
 * there, so nothing the user named is lost: "Load an example" only shows
 * while the map has no stories.
 */
function loadExampleMap() {
  const cur = currentStoryMap();
  const exSteps = buildExampleSteps();
  const exSlices = buildExampleSlices(exSteps);
  const steps = [...exSteps, ...cur.steps.filter((st) => !exSteps.some((e) => e.id === st.id))];
  const withCells = (sl: Slice): Slice => ({
    ...sl,
    cards: Object.fromEntries(steps.map((st) => [st.id, sl.cards[st.id] ?? []])),
  });
  set({
    steps,
    slices: [...exSlices, ...cur.slices.filter((sl) => !exSlices.some((e) => e.id === sl.id))].map(
      withCells
    ),
  });
}

/**
 * The map without its example rows: every example card, then each example
 * step or slice left with no stories. A step or slice holding the user's own
 * cards stays, whatever its id. Can leave the map with no steps or slices,
 * which is its empty state.
 */
function withoutExample(map: { steps: Step[]; slices: Slice[] }): {
  steps: Step[];
  slices: Slice[];
} {
  const slices = map.slices.map((sl) => ({
    ...sl,
    cards: Object.fromEntries(
      Object.entries(sl.cards).map(([stepId, cards]) => [
        stepId,
        cards.filter((c) => !isExampleId(c.id)),
      ])
    ),
  }));
  const steps = map.steps.filter(
    (st) => !isExampleId(st.id) || slices.some((sl) => (sl.cards[st.id] ?? []).length > 0)
  );
  const removedSteps = map.steps.filter((st) => !steps.includes(st)).map((st) => st.id);
  return {
    steps,
    slices: slices
      .filter((sl) => !isExampleId(sl.id) || steps.some((st) => (sl.cards[st.id] ?? []).length > 0))
      .map((sl) => {
        const cards = { ...sl.cards };
        for (const id of removedSteps) delete cards[id];
        return { ...sl, cards };
      }),
  };
}

// Selector-overload hook mirroring the prior zustand store: callable bare
// (returns the full state) or with a selector (returns the selected slice).
// steps/slices come from the reactive synced doc; the mutators are stable
// module functions, so selector identities are stable across renders.
function useStoryMapStore(): StoryMapState;
function useStoryMapStore<T>(selector: (s: StoryMapState) => T): T;
function useStoryMapStore<T>(selector?: (s: StoryMapState) => T): T | StoryMapState {
  const doc = useWorkspaceStore(
    useShallow((ws) => (ws.storyMaps ?? []).find((m) => m.id === SM_ID))
  );
  const cur = doc ?? defaultStoryMap();
  const full: StoryMapState = { steps: cur.steps, slices: cur.slices, ...storyMapApi };
  return selector ? selector(full) : full;
}

/* -------------------------------------------------------------------------- */
/*  EditableName moved to @/components/shared/editable-name                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  CardEditDialog                                                             */
/* -------------------------------------------------------------------------- */

function CardEditDialog({
  card,
  sliceId,
  stepId,
  trigger,
}: {
  card: StoryCard;
  sliceId: string;
  stepId: string;
  trigger: React.ReactNode;
}) {
  // BUG-RD3-story-mapper-1: scope the hook to a single action so the
  // dialog doesn't re-render every time ANY card, step, or slice
  // anywhere in the map changes — that re-render was blurring open
  // EditableName inputs mid-edit when a sibling card got dragged.
  const updateCard = useStoryMapStore((s) => s.updateCard);
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [color, setColor] = useState(card.color);

  useEffect(() => {
    if (open) {
      setTitle(card.title);
      setDescription(card.description);
      setColor(card.color);
    }
  }, [open, card]);

  const save = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    updateCard(sliceId, stepId, {
      ...card,
      title: trimmedTitle,
      description: description.trim(),
      color,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-surface border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-text font-display">Edit Story Card</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label
              htmlFor={`${uid}-title`}
              className="text-xs text-sub font-medium uppercase tracking-wider"
            >
              Title
            </label>
            <Input
              id={`${uid}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Story title…"
              className="bg-card border-border text-text focus:border-accent/50"
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={`${uid}-description`}
              className="text-xs text-sub font-medium uppercase tracking-wider"
            >
              Description
            </label>
            <textarea
              id={`${uid}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="As a user, I want to…"
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-sub/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <p
              id={`${uid}-color`}
              className="text-xs text-sub font-medium uppercase tracking-wider"
            >
              Color
            </p>
            <div role="group" aria-labelledby={`${uid}-color`} className="flex gap-2">
              {CARD_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={color === c.value}
                  onClick={() => setColor(c.value)}
                  className="min-touch-coarse w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c.value,
                    outline: color === c.value ? `2px solid ${c.value}` : "none",
                    outlineOffset: 2,
                    opacity: color === c.value ? 1 : 0.45,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="text-sub hover:text-text"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!title.trim()}
              className="bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30"
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  DraggableCard                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Encodes the drag id as "sliceId::stepId::cardId". The sentinel
 * `__cell__` is used as cardId for the empty-cell droppable so we can drop
 * into a step that contains no cards.
 */
const EMPTY_CELL_SENTINEL = "__cell__";

function encodeDragId(sliceId: string, stepId: string, cardId: string) {
  return `${sliceId}::${stepId}::${cardId}`;
}

function encodeCellDropId(sliceId: string, stepId: string) {
  return `${sliceId}::${stepId}::${EMPTY_CELL_SENTINEL}`;
}

function decodeDragId(id: string) {
  const parts = id.split("::");
  return { sliceId: parts[0], stepId: parts[1], cardId: parts[2] };
}

/** moveCard's signature, passed down so menu moves are logged like drags. */
type MoveCardFn = StoryMapState["moveCard"];

/**
 * Non-drag alternative to drag and drop (WCAG 2.5.7): move a card up or
 * down within its cell, or to the end of any other cell, from a menu.
 */
function CardMoveMenu({
  card,
  sliceId,
  stepId,
  index,
  count,
  onMove,
}: {
  card: StoryCard;
  sliceId: string;
  stepId: string;
  index: number;
  count: number;
  onMove: MoveCardFn;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-card-move={card.id}
          className="min-touch-coarse p-1 rounded text-sub hover:text-accent hover:bg-accent/10 transition-colors inline-flex items-center justify-center"
          title="Move"
          aria-label={`Move ${card.title}`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <CardMoveMenuItems
          card={card}
          sliceId={sliceId}
          stepId={stepId}
          index={index}
          count={count}
          onMove={onMove}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounted only while the menu is open, so cards don't subscribe to the map. */
function CardMoveMenuItems({
  card,
  sliceId,
  stepId,
  index,
  count,
  onMove,
}: {
  card: StoryCard;
  sliceId: string;
  stepId: string;
  index: number;
  count: number;
  onMove: MoveCardFn;
}) {
  const steps = useStoryMapStore((s) => s.steps);
  const slices = useStoryMapStore((s) => s.slices);
  const uid = useId();

  const move = (toSliceId: string, toStepId: string, toIndex?: number) => {
    onMove(sliceId, stepId, toSliceId, toStepId, card.id, toIndex);
    // A move to another cell remounts the card there and unmounts this
    // menu: return focus to the moved card's menu button, not <body>.
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLElement>("[data-card-move]"))
        .find((el) => el.dataset.cardMove === card.id)
        ?.focus();
    });
  };

  return (
    <>
      <DropdownMenuItem disabled={index === 0} onSelect={() => move(sliceId, stepId, index - 1)}>
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={index >= count - 1}
        onSelect={() => move(sliceId, stepId, index + 1)}
      >
        Move down
      </DropdownMenuItem>
      {slices.map((sl, i) => (
        <DropdownMenuGroup key={sl.id} aria-labelledby={`${uid}-${i}`}>
          <DropdownMenuSeparator />
          <DropdownMenuLabel id={`${uid}-${i}`} className="text-xs text-sub">
            Move to {sl.name}
          </DropdownMenuLabel>
          {steps.map((st) => (
            <DropdownMenuItem
              key={st.id}
              disabled={sl.id === sliceId && st.id === stepId}
              onSelect={() => move(sl.id, st.id)}
            >
              {st.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
    </>
  );
}

function DraggableCard({
  card,
  sliceId,
  stepId,
  index,
  count,
  onMove,
}: {
  card: StoryCard;
  sliceId: string;
  stepId: string;
  index: number;
  count: number;
  onMove: MoveCardFn;
}) {
  // BUG-RD3-story-mapper-1: scope selector — see CardEditDialog above.
  const removeCard = useStoryMapStore((s) => s.removeCard);
  const dragId = encodeDragId(sliceId, stepId, card.id);

  const deleteCard = () =>
    undoable({
      label: `Deleted “${shortName(card.title)}”`,
      apply: () => removeCard(sliceId, stepId, card.id),
      revert: () => restoreCard(sliceId, stepId, card, index),
    });

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dragId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderColor: `${card.color}40` }}
      className="group relative rounded-md border text-sm p-2.5 bg-surface-deep hover:bg-surface transition-colors cursor-default"
    >
      {/* Drag handle — stays visible on touch devices since hover doesn't exist.
          It is the drag activator: focusable, and it gets both the sortable
          attributes and the listeners, so the KeyboardSensor (Space to pick
          up, arrows to move, Space to drop) receives its keydown. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="min-touch-coarse absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center text-sub/30 hover:text-sub cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity"
        aria-label={`Drag ${card.title}`}
      >
        <GripVertical
          className="w-4 h-4 [@media(pointer:coarse)]:w-5 [@media(pointer:coarse)]:h-5"
          aria-hidden="true"
        />
      </button>

      <div className="pl-5 pr-8 [@media(pointer:coarse)]:pl-7">
        {/* Color dot + title */}
        <div className="flex items-start gap-1.5">
          <span
            className="mt-1 flex-shrink-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: card.color }}
          />
          <span className="font-medium text-text leading-snug line-clamp-2">{card.title}</span>
        </div>
        {card.description && (
          <p className="mt-1 text-xs text-sub line-clamp-2 pl-3.5">{card.description}</p>
        )}
      </div>

      {/* Action buttons (top-right) — always visible on coarse pointers. */}
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity">
        <CardEditDialog
          card={card}
          sliceId={sliceId}
          stepId={stepId}
          trigger={
            <button
              type="button"
              className="min-touch-coarse p-1 rounded text-sub hover:text-accent hover:bg-accent/10 transition-colors inline-flex items-center justify-center"
              title="Edit"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Edit ${card.title}`}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
        />
        <CardMoveMenu
          card={card}
          sliceId={sliceId}
          stepId={stepId}
          index={index}
          count={count}
          onMove={onMove}
        />
        <button
          type="button"
          onClick={deleteCard}
          className="btn-danger-ghost min-touch-coarse p-1 rounded inline-flex items-center justify-center"
          title="Delete card"
          aria-label={`Delete ${card.title}`}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  StaticCard (used in DragOverlay)                                          */
/* -------------------------------------------------------------------------- */

function StaticCard({ card }: { card: StoryCard }) {
  return (
    <div
      className="rounded-md border text-sm p-2.5 bg-surface-deep shadow-xl"
      style={{ borderColor: `${card.color}40` }}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 flex-shrink-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: card.color }}
        />
        <span className="font-medium text-text leading-snug">{card.title}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CellDropZone                                                              */
/* -------------------------------------------------------------------------- */

/** The droppable container for a single (slice, step) cell */
function CellDropZone({
  sliceId,
  stepId,
  cards,
  onMove,
}: {
  sliceId: string;
  stepId: string;
  cards: StoryCard[];
  onMove: MoveCardFn;
}) {
  // BUG-RD3-story-mapper-1: scope selector — see CardEditDialog above.
  const addCard = useStoryMapStore((s) => s.addCard);
  // Memoize: SortableContext reinitializes on identity change of items.
  const sortableIds = useMemo(
    () => cards.map((c) => encodeDragId(sliceId, stepId, c.id)),
    [cards, sliceId, stepId]
  );
  // Register the cell itself as droppable so a card can be dragged INTO an
  // empty step (or to the bottom of a non-empty step). Without this, only
  // existing cards were valid drop targets and empty cells were unreachable.
  const { setNodeRef, isOver } = useDroppable({
    id: encodeCellDropId(sliceId, stepId),
  });

  return (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`min-h-[40px] space-y-1.5 rounded transition-colors ${
          isOver && cards.length === 0 ? "bg-accent/5 ring-1 ring-accent/30" : ""
        }`}
      >
        {cards.map((card, i) => (
          <DraggableCard
            key={card.id}
            card={card}
            sliceId={sliceId}
            stepId={stepId}
            index={i}
            count={cards.length}
            onMove={onMove}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => addCard(sliceId, stepId)}
        className="mt-1.5 w-full flex items-center gap-1 text-xs text-sub/50 hover:text-accent hover:bg-accent/5 rounded px-1.5 py-1 transition-colors group"
      >
        <Plus className="w-3 h-3 flex-shrink-0 group-hover:text-accent" aria-hidden="true" />
        <span>Add card</span>
      </button>
    </SortableContext>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function StoryMapperClient() {
  const {
    steps,
    slices,
    addStep: addStepRaw,
    removeStep: removeStepRaw,
    renameStep,
    addSlice: addSliceRaw,
    removeSlice: removeSliceRaw,
    renameSlice,
    moveCard: moveCardRaw,
    reset: resetRaw,
  } = useStoryMapStore();
  const { log } = useHistoryLogger("story-mapper");

  const addStep: typeof addStepRaw = (...args) => {
    addStepRaw(...args);
    log(STORY_MAPPER_ACTIONS.STEP_ADDED, {});
  };
  // Removing a step takes its cards in every slice with it; Undo puts the
  // step back at its position with those cards.
  const removeStep: typeof removeStepRaw = (id) => {
    const index = steps.findIndex((s) => s.id === id);
    const step = steps[index];
    if (!step) return;
    const cardsBySlice = Object.fromEntries(slices.map((sl) => [sl.id, sl.cards[id] ?? []]));
    const cardCount = Object.values(cardsBySlice).reduce((n, cards) => n + cards.length, 0);
    undoable({
      label:
        `Removed step “${shortName(step.name)}”` +
        (cardCount > 0 ? ` and ${cardCount} card${cardCount === 1 ? "" : "s"}` : ""),
      apply: () => {
        removeStepRaw(id);
        log(STORY_MAPPER_ACTIONS.STEP_REMOVED, { stepId: id, name: step.name });
      },
      revert: () => restoreStep(step, index, cardsBySlice),
    });
  };
  const addSlice: typeof addSliceRaw = (...args) => {
    addSliceRaw(...args);
    log(STORY_MAPPER_ACTIONS.SLICE_ADDED, {});
  };
  const removeSlice: typeof removeSliceRaw = (id) => {
    const index = slices.findIndex((s) => s.id === id);
    const slice = slices[index];
    if (!slice) return;
    undoable({
      label: `Removed slice “${shortName(slice.name)}”`,
      apply: () => {
        removeSliceRaw(id);
        log(STORY_MAPPER_ACTIONS.SLICE_REMOVED, { sliceId: id, name: slice.name });
      },
      revert: () => restoreSlice(slice, index),
    });
  };
  const moveCard: typeof moveCardRaw = (...args) => {
    moveCardRaw(...args);
    log(STORY_MAPPER_ACTIONS.CARD_MOVED, {});
  };
  const reset = () => {
    const prev = { steps, slices };
    undoable({
      label: "Reset the story map",
      apply: () => {
        resetRaw();
        log(STORY_MAPPER_ACTIONS.STORY_MAP_RESET, {});
      },
      revert: () => set(prev),
    });
  };

  // Reset replaces the whole map, so it asks first, unless the map is still
  // the untouched example or empty, and there is nothing to lose.
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const storyCount = slices.reduce(
    (acc, sl) => acc + steps.reduce((a, st) => a + (sl.cards[st.id]?.length ?? 0), 0),
    0
  );
  const isExampleMap = useMemo(() => {
    const example = defaultStoryMap();
    return (
      JSON.stringify(example.steps) === JSON.stringify(steps) &&
      JSON.stringify(example.slices) === JSON.stringify(slices)
    );
  }, [steps, slices]);
  const isEmptyMap = steps.length === 0 && slices.length === 0;

  // Example cards on the map. Their steps and slices don't count: those can
  // end up holding the user's own cards, and the notice would never go away.
  const hasExampleCards = slices.some((sl) =>
    steps.some((st) => (sl.cards[st.id] ?? []).some((c) => isExampleId(c.id)))
  );
  // Neither is logged: the example isn't the user's own work.
  const clearExample = () => {
    const prev = { steps, slices };
    undoable({
      label: "Cleared the example",
      apply: () => set(withoutExample(currentStoryMap())),
      revert: () => set(prev),
    });
  };

  const markdown = useMemo(() => toMarkdown({ steps, slices }), [steps, slices]);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // PointerSensor handles mouse + touch + pen. KeyboardSensor adds a11y so
  // keyboard-only users can reorder cards (Tab to focus, Space to pick up,
  // arrows to move, Space to drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Live-region announcements in words. dnd-kit's defaults read the raw
  // "sliceId::stepId::cardId" drag ids aloud.
  const accessibility = useMemo(() => {
    const cardTitle = (cardId: string) => {
      for (const sl of slices) {
        for (const cards of Object.values(sl.cards)) {
          const found = cards.find((c) => c.id === cardId);
          if (found) return found.title;
        }
      }
      return "story card";
    };
    const cellName = (id: UniqueIdentifier) => {
      const { sliceId, stepId } = decodeDragId(String(id));
      const step = steps.find((st) => st.id === stepId)?.name ?? "step";
      const slice = slices.find((sl) => sl.id === sliceId)?.name ?? "slice";
      return `${step}, ${slice}`;
    };
    const cardName = (id: UniqueIdentifier) => `"${cardTitle(decodeDragId(String(id)).cardId)}"`;
    const target = (id: UniqueIdentifier) => {
      const { cardId } = decodeDragId(String(id));
      return cardId === EMPTY_CELL_SENTINEL
        ? `the end of ${cellName(id)}`
        : `${cardName(id)} in ${cellName(id)}`;
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => `Picked up ${cardName(active.id)} in ${cellName(active.id)}.`,
      onDragOver: ({ active, over }) => {
        if (!over) return `${cardName(active.id)} is no longer over a drop area.`;
        if (over.id === active.id) return `${cardName(active.id)} is back in its original place.`;
        return `${cardName(active.id)} is over ${target(over.id)}.`;
      },
      onDragEnd: ({ active, over }) => {
        if (!over || over.id === active.id) return `${cardName(active.id)} was dropped. Not moved.`;
        return `${cardName(active.id)} was moved to ${cellName(over.id)}.`;
      },
      onDragCancel: ({ active }) =>
        `Moving ${cardName(active.id)} was cancelled. It is back in ${cellName(active.id)}.`,
    };
    return { announcements };
  }, [steps, slices]);

  /* -- Find the card being dragged for the overlay ---- */
  const activeCard = useMemo<StoryCard | null>(() => {
    if (!activeDragId) return null;
    const { sliceId, stepId, cardId } = decodeDragId(activeDragId);
    if (!sliceId || !stepId || !cardId || cardId === EMPTY_CELL_SENTINEL) return null;
    const slice = slices.find((sl) => sl.id === sliceId);
    if (!slice) return null;
    return (slice.cards[stepId] ?? []).find((c) => c.id === cardId) ?? null;
  }, [activeDragId, slices]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = decodeDragId(String(active.id));
    const to = decodeDragId(String(over.id));

    const targetSlice = slices.find((sl) => sl.id === to.sliceId);
    if (!targetSlice) return;
    const targetCards = targetSlice.cards[to.stepId] ?? [];

    // When dropping on the cell sentinel (empty step or below the last card),
    // append; otherwise insert at the target card's index.
    let toIndex: number | undefined;
    if (to.cardId === EMPTY_CELL_SENTINEL) {
      toIndex = undefined;
    } else {
      const idx = targetCards.findIndex((c) => c.id === to.cardId);
      toIndex = idx >= 0 ? idx : undefined;
    }

    moveCard(from.sliceId, from.stepId, to.sliceId, to.stepId, from.cardId, toIndex);
  };

  /* -- Export data ---- */
  // Emit an ordered array keyed by step position, NOT an object keyed by
  // step name. The board is keyed by step ID and `addStep` hardcodes the
  // name "New Step" with no uniqueness check, so `Object.fromEntries` used
  // to collapse two same-named columns into one key and silently drop an
  // entire column's cards — disagreeing with the clipboard export, which
  // iterates `steps` directly. Nothing imports this JSON back.
  const jsonData = useMemo(
    () => ({
      steps: steps.map((s) => s.name),
      slices: slices.map((sl) => ({
        name: sl.name,
        stories: steps.map((st) => ({
          step: st.name,
          cards: (sl.cards[st.id] ?? []).map((c) => ({
            title: c.title,
            description: c.description,
          })),
        })),
      })),
    }),
    [steps, slices]
  );

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
      toolName: "User Story Map",
      prompts: generateStoryMapperPrompts({ steps, slices }, workspace),
    }),
    [steps, slices, workspace]
  );

  const clipboardText = useMemo(() => {
    const lines: string[] = ["User Story Map", ""];
    const stepNames = steps.map((s) => s.name).join(" | ");
    lines.push(`Journey: ${stepNames}`);
    lines.push("=".repeat(60));
    for (const sl of slices) {
      lines.push(`\n[${sl.name}]`);
      for (const st of steps) {
        const cards = sl.cards[st.id] ?? [];
        if (cards.length === 0) continue;
        lines.push(`  ${st.name}:`);
        for (const c of cards) {
          lines.push(`    - ${c.title}${c.description ? ` (${c.description})` : ""}`);
        }
      }
    }
    return lines.join("\n");
  }, [steps, slices]);

  /* -- Column width heuristic ---- */
  const colWidth = Math.max(160, Math.min(260, Math.floor(960 / steps.length)));

  return (
    <ToolPageWrapper
      toolId="story-mapper"
      title="User Story Mapper"
      description="Map user journeys horizontally as steps, slice vertically by release priority, and fill cells with story cards."
      category="Sprint Planning & Estimation"
    >
      {hasExampleCards && <ExampleNotice onClear={clearExample} />}
      <DndContext
        sensors={sensors}
        accessibility={accessibility}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-4">
          {/* ---- Toolbar ---- */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sub text-sm">
              <Map className="w-4 h-4 text-accent" />
              <span>
                {steps.length} steps · {slices.length} slices · {storyCount} stories
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="story-map"
                clipboardText={clipboardText}
                jsonData={jsonData}
                markdown={markdown}
              />
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={() => (isExampleMap || isEmptyMap ? reset() : setConfirmResetOpen(true))}
              >
                Reset
              </Button>
            </div>
          </div>

          {storyCount === 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-sub">
              <p className="min-w-0 flex-1">
                No stories yet. Add the steps of the user&apos;s journey along the top, release
                slices down the side, then fill the cells with story cards.
              </p>
              <LoadExampleButton onLoad={loadExampleMap} />
            </div>
          )}

          {/* ---- Board ---- */}
          <ScrollArea className="w-full rounded-xl border border-border bg-surface">
            <div className="p-4" style={{ minWidth: steps.length * (colWidth + 12) + 180 }}>
              {/* Header row: Steps */}
              <div className="flex items-stretch">
                {/* Slice label column spacer */}
                <div className="flex-shrink-0 w-40 mr-3" />

                {/* Step headers */}
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className="group flex-shrink-0 mr-3 last:mr-0"
                    style={{ width: colWidth }}
                  >
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-t-lg bg-accent/10 border border-accent/20 border-b-0">
                      <EditableName
                        value={step.name}
                        onChange={(name) => renameStep(step.id, name)}
                        className="flex-1 text-sm font-semibold text-accent truncate"
                      />
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(step.id)}
                          className="btn-danger-ghost min-touch-coarse flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 p-0.5 rounded inline-flex items-center justify-center"
                          title="Remove step"
                          aria-label={`Remove step ${step.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Add step button */}
                <div className="flex-shrink-0 flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addStep}
                    className="gap-1 text-xs text-accent hover:bg-accent/10 h-8"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Step
                  </Button>
                </div>
              </div>

              {/* Slice rows */}
              {slices.map((slice, sliceIdx) => (
                <div key={slice.id} className="flex items-stretch mt-3">
                  {/* Slice label */}
                  <div className="group flex-shrink-0 w-40 mr-3 flex flex-col justify-start">
                    <div className="flex items-start gap-1 px-2 py-1.5 rounded-lg bg-surface-deep border border-border h-full">
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="mb-1 text-xs border-border text-sub">
                          Slice {sliceIdx + 1}
                        </Badge>
                        <EditableName
                          value={slice.name}
                          onChange={(name) => renameSlice(slice.id, name)}
                          className="block text-sm font-medium text-text"
                        />
                      </div>
                      {slices.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSlice(slice.id)}
                          className="btn-danger-ghost min-touch-coarse flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 p-0.5 rounded inline-flex items-center justify-center"
                          title="Remove slice"
                          aria-label={`Remove slice ${slice.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cells */}
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className="flex-shrink-0 mr-3 last:mr-0 rounded-lg border border-border bg-surface-deep/60 p-2"
                      style={{ width: colWidth }}
                    >
                      <CellDropZone
                        sliceId={slice.id}
                        stepId={step.id}
                        cards={slice.cards[step.id] ?? []}
                        onMove={moveCard}
                      />
                    </div>
                  ))}
                </div>
              ))}

              {/* Add slice row */}
              <div className="mt-3 flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addSlice}
                  className="gap-1 text-xs text-accent hover:bg-accent/10 h-8"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Slice
                </Button>
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Drag overlay */}
        <DragOverlay>{activeCard ? <StaticCard card={activeCard} /> : null}</DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Reset the story map?"
        description={`Its ${storyCount} ${storyCount === 1 ? "story" : "stories"}, ${steps.length} step${steps.length === 1 ? "" : "s"} and ${slices.length} slice${slices.length === 1 ? "" : "s"} are replaced with the example map.`}
        confirmLabel="Reset map"
        onConfirm={reset}
      />
    </ToolPageWrapper>
  );
}
