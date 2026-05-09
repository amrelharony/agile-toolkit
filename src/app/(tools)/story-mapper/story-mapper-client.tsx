"use client";

import { useState, useMemo, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
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
import { generateStoryMapperPrompts } from "@/lib/ai-prompts/story-mapper";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, GripVertical, Pencil, Map } from "lucide-react";

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

function buildDefaultSteps(): Step[] {
  return [
    { id: makeId(), name: "Discover" },
    { id: makeId(), name: "Learn" },
    { id: makeId(), name: "Use" },
  ];
}

function buildDefaultSlices(steps: Step[]): Slice[] {
  const [s1, s2, s3] = steps;
  return [
    {
      id: makeId(),
      name: "Walking Skeleton",
      cards: {
        [s1.id]: [
          {
            id: makeId(),
            title: "Browse product catalog",
            description: "Users can view available products in a list.",
            color: "#00f0ff",
          },
        ],
        [s2.id]: [
          {
            id: makeId(),
            title: "Read product details",
            description: "Users can click a product to see full details.",
            color: "#a78bfa",
          },
        ],
        [s3.id]: [],
      },
    },
    {
      id: makeId(),
      name: "MVP",
      cards: {
        [s1.id]: [],
        [s2.id]: [],
        [s3.id]: [
          {
            id: makeId(),
            title: "Add to cart",
            description: "Users can add items to a shopping cart.",
            color: "#34d399",
          },
        ],
      },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

const defaultSteps = buildDefaultSteps();
const defaultSlices = buildDefaultSlices(defaultSteps);

const useStoryMapStore = create<StoryMapState>()(
  persist(
    (set) => ({
      steps: defaultSteps,
      slices: defaultSlices,

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
            slices: [
              ...s.slices,
              { id: makeId(), name: "New Slice", cards: emptyCards },
            ],
          };
        }),

      removeSlice: (sliceId) =>
        set((s) => {
          if (s.slices.length <= 1) return s;
          return { slices: s.slices.filter((sl) => sl.id !== sliceId) };
        }),

      renameSlice: (sliceId, name) =>
        set((s) => ({
          slices: s.slices.map((sl) =>
            sl.id === sliceId ? { ...sl, name } : sl
          ),
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
                [stepId]: (sl.cards[stepId] ?? []).map((c) =>
                  c.id === card.id ? card : c
                ),
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
                [stepId]: (sl.cards[stepId] ?? []).filter(
                  (c) => c.id !== cardId
                ),
              },
            };
          }),
        })),

      moveCard: (fromSliceId, fromStepId, toSliceId, toStepId, cardId, toIndex) =>
        set((s) => {
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
    }),
    { name: "agile-toolkit:story-mapper" }
  )
);

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
  const { updateCard } = useStoryMapStore();
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
          <DialogTitle className="text-text font-display">
            Edit Story Card
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs text-sub font-medium uppercase tracking-wider">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Story title…"
              className="bg-card border-border text-text focus:border-accent/50"
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-sub font-medium uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="As a user, I want to…"
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-sub/50 focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-sub font-medium uppercase tracking-wider">
              Color
            </label>
            <div className="flex gap-2">
              {CARD_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
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

function DraggableCard({
  card,
  sliceId,
  stepId,
}: {
  card: StoryCard;
  sliceId: string;
  stepId: string;
}) {
  const { removeCard } = useStoryMapStore();
  const dragId = encodeDragId(sliceId, stepId, card.id);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dragId });

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
      {...attributes}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 text-sub/30 hover:text-sub cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        tabIndex={-1}
        aria-label="Drag handle"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <div className="pl-4 pr-8">
        {/* Color dot + title */}
        <div className="flex items-start gap-1.5">
          <span
            className="mt-1 flex-shrink-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: card.color }}
          />
          <span className="font-medium text-text leading-snug line-clamp-2">
            {card.title}
          </span>
        </div>
        {card.description && (
          <p className="mt-1 text-xs text-sub line-clamp-2 pl-3.5">
            {card.description}
          </p>
        )}
      </div>

      {/* Action buttons (top-right) */}
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <CardEditDialog
          card={card}
          sliceId={sliceId}
          stepId={stepId}
          trigger={
            <button
              type="button"
              className="p-1 rounded text-sub hover:text-accent hover:bg-accent/10 transition-colors"
              title="Edit"
              onClick={(e) => e.stopPropagation()}
            >
              <Pencil className="w-3 h-3" />
            </button>
          }
        />
        <button
          type="button"
          onClick={() => removeCard(sliceId, stepId, card.id)}
          className="btn-danger-ghost p-1 rounded"
          title="Delete card"
        >
          <Trash2 className="w-3 h-3" />
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
        <span className="font-medium text-text leading-snug">
          {card.title}
        </span>
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
}: {
  sliceId: string;
  stepId: string;
  cards: StoryCard[];
}) {
  const { addCard } = useStoryMapStore();
  // Memoize: SortableContext reinitializes on identity change of items.
  const sortableIds = useMemo(
    () => cards.map((c) => encodeDragId(sliceId, stepId, c.id)),
    [cards, sliceId, stepId],
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
        {cards.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            sliceId={sliceId}
            stepId={stepId}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => addCard(sliceId, stepId)}
        className="mt-1.5 w-full flex items-center gap-1 text-xs text-sub/50 hover:text-accent hover:bg-accent/5 rounded px-1.5 py-1 transition-colors group"
      >
        <Plus className="w-3 h-3 flex-shrink-0 group-hover:text-accent" />
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
  const removeStep: typeof removeStepRaw = (id) => {
    const step = steps.find((s) => s.id === id);
    removeStepRaw(id);
    log(STORY_MAPPER_ACTIONS.STEP_REMOVED, { stepId: id, name: step?.name });
  };
  const addSlice: typeof addSliceRaw = (...args) => {
    addSliceRaw(...args);
    log(STORY_MAPPER_ACTIONS.SLICE_ADDED, {});
  };
  const removeSlice: typeof removeSliceRaw = (id) => {
    const slice = slices.find((s) => s.id === id);
    removeSliceRaw(id);
    log(STORY_MAPPER_ACTIONS.SLICE_REMOVED, { sliceId: id, name: slice?.name });
  };
  const moveCard: typeof moveCardRaw = (...args) => {
    moveCardRaw(...args);
    log(STORY_MAPPER_ACTIONS.CARD_MOVED, {});
  };
  const reset = () => {
    resetRaw();
    log(STORY_MAPPER_ACTIONS.STORY_MAP_RESET, {});
  };

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // PointerSensor handles mouse + touch + pen. KeyboardSensor adds a11y so
  // keyboard-only users can reorder cards (Tab to focus, Space to pick up,
  // arrows to move, Space to drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

    moveCard(
      from.sliceId,
      from.stepId,
      to.sliceId,
      to.stepId,
      from.cardId,
      toIndex
    );
  };

  /* -- Export data ---- */
  const jsonData = useMemo(
    () => ({
      steps: steps.map((s) => s.name),
      slices: slices.map((sl) => ({
        name: sl.name,
        stories: Object.fromEntries(
          steps.map((st) => [
            st.name,
            (sl.cards[st.id] ?? []).map((c) => ({
              title: c.title,
              description: c.description,
            })),
          ])
        ),
      })),
    }),
    [steps, slices]
  );

  const promptConfig = useMemo(() => ({
    toolName: "User Story Map",
    prompts: generateStoryMapperPrompts({ steps, slices }),
  }), [steps, slices]);

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
      <DndContext
        sensors={sensors}
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
                {steps.length} steps · {slices.length} slices ·{" "}
                {slices.reduce(
                  (acc, sl) =>
                    acc +
                    steps.reduce(
                      (a, st) => a + (sl.cards[st.id]?.length ?? 0),
                      0
                    ),
                  0
                )}{" "}
                stories
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="story-map"
                clipboardText={clipboardText}
                jsonData={jsonData}
              />
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Reset
              </Button>
            </div>
          </div>

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
                          className="btn-danger-ghost flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded"
                          title="Remove step"
                        >
                          <Trash2 className="w-3 h-3" />
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
                        <Badge
                          variant="outline"
                          className="mb-1 text-[10px] border-border text-sub"
                        >
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
                          className="btn-danger-ghost flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 p-0.5 rounded"
                          title="Remove slice"
                        >
                          <Trash2 className="w-3 h-3" />
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
        <DragOverlay>
          {activeCard ? <StaticCard card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
    </ToolPageWrapper>
  );
}
