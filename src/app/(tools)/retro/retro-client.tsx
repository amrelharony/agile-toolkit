"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  Trash2,
  Plus,
  Download,
  RotateCcw,
  ChevronRight,
  Timer,
  Check,
  ArrowLeft,
  CheckSquare,
  Square,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateRetroPrompts } from "@/lib/ai-prompts/retro";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger, type HistoryLogger } from "@/lib/history/use-history-logger";
import { RETRO_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { retroFormats, type RetroFormat, type RetroColumn } from "@/lib/constants/retro-formats";

// ── Types ────────────────────────────────────────────────────

type BoardPhase = "write" | "vote" | "discuss" | "actions";

interface RetroCard {
  id: string;
  columnKey: string;
  text: string;
  votes: number;
  groupedWith: string | null; // id of parent card, null if standalone
  isActionItem: boolean;
  assignee: string;
  discussing: boolean;
}

interface BoardState {
  format: RetroFormat;
  phase: BoardPhase;
  cards: RetroCard[];
  userVotes: number; // votes cast by "this user"
  timerSeconds: number;
  timerRunning: boolean;
  discussingIndex: number; // index into sorted discuss list
}

const MAX_VOTES = 3;

const PHASES: { key: BoardPhase; label: string; description: string }[] = [
  { key: "write", label: "Write", description: "Add cards to each column" },
  { key: "vote", label: "Vote", description: "Vote on cards (max 3)" },
  { key: "discuss", label: "Discuss", description: "Work through top-voted cards" },
  { key: "actions", label: "Actions", description: "Assign action items" },
];

// ── Helpers ──────────────────────────────────────────────────

function makeId() {
  return crypto.randomUUID();
}

function formatTimer(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function sortedByVotes(cards: RetroCard[]) {
  return [...cards].sort((a, b) => b.votes - a.votes);
}

// ── Phase Indicator ──────────────────────────────────────────

function PhaseIndicator({
  current,
  onAdvance,
}: {
  current: BoardPhase;
  onAdvance: () => void;
}) {
  const idx = PHASES.findIndex((p) => p.key === current);
  const isLast = idx === PHASES.length - 1;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map((phase, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "upcoming";
        return (
          <div key={phase.key} className="flex items-center gap-1">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                state === "active"
                  ? "bg-accent-cyan/20 text-accent border-accent-cyan shadow-neon-cyan"
                  : state === "done"
                  ? "bg-accent-green/10 text-accent-green border-accent-green/30"
                  : "bg-cardH text-sub border-border"
              }`}
            >
              {i + 1}. {phase.label}
            </span>
            {i < PHASES.length - 1 && (
              <ChevronRight className="w-3 h-3 text-sub" />
            )}
          </div>
        );
      })}
      {!isLast && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAdvance}
          className="ml-2 h-7 px-3 text-xs border-border text-sub hover:border-accent-cyan/50 hover:text-accent"
        >
          Next Phase <ChevronRight className="w-3 h-3 ml-1" />
        </Button>
      )}
    </div>
  );
}

// ── Timer Widget ─────────────────────────────────────────────

function TimerWidget({
  seconds,
  running,
  onToggle,
  onReset,
  onChange,
}: {
  seconds: number;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  onChange: (s: number) => void;
}) {
  const PRESETS = [300, 600, 900, 1800];

  return (
    <div className="flex items-center gap-2 text-sm">
      <Timer className="w-4 h-4 text-sub" />
      <span
        className={`font-mono text-base font-bold tabular-nums ${
          running && seconds <= 60
            ? "text-status-red animate-pulse"
            : running
            ? "text-accent"
            : "text-sub"
        }`}
      >
        {formatTimer(seconds)}
      </span>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => { onChange(p); }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-sub hover:border-accent-cyan/40 hover:text-accent transition-colors"
          >
            {p / 60}m
          </button>
        ))}
      </div>
      <button
        onClick={onToggle}
        className="text-xs px-2 py-0.5 rounded border border-border text-sub hover:border-accent-cyan/50 hover:text-accent transition-colors"
      >
        {running ? "Pause" : "Start"}
      </button>
      <button
        onClick={onReset}
        className="text-xs px-2 py-0.5 rounded border border-border text-sub hover:border-border transition-colors"
      >
        Reset
      </button>
    </div>
  );
}

// ── Retro Card ───────────────────────────────────────────────

function RetroCardItem({
  card,
  allCards,
  phase,
  canVote,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
}: {
  card: RetroCard;
  allCards: RetroCard[];
  column: RetroColumn;
  phase: BoardPhase;
  canVote: boolean;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: (id: string, parentId: string | null) => void;
  onToggleAction: (id: string) => void;
  onAssigneeChange: (id: string, val: string) => void;
  onToggleDiscussing: (id: string) => void;
}) {
  const otherCards = allCards.filter(
    (c) => c.id !== card.id && c.columnKey === card.columnKey && c.groupedWith === null
  );

  const isDiscussing = card.discussing;
  // Only top-level cards in the Discuss phase get the click-to-focus affordance.
  // Grouped child cards inherit visual state from the parent and aren't toggled.
  const isDiscussClickable = phase === "discuss" && card.groupedWith === null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onClick={
        isDiscussClickable
          ? (e) => {
              // Skip when the click bubbled from an inner interactive control
              // (vote button, delete, etc.) — we only want bare-card clicks
              // to toggle the discussing focus.
              if ((e.target as HTMLElement).closest("button, input, select, [role='button']") !== e.currentTarget) {
                const targetEl = e.target as HTMLElement;
                if (targetEl.closest("button, input, select, a")) return;
              }
              onToggleDiscussing(card.id);
            }
          : undefined
      }
      role={isDiscussClickable ? "button" : undefined}
      tabIndex={isDiscussClickable ? 0 : undefined}
      onKeyDown={
        isDiscussClickable
          ? (e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                onToggleDiscussing(card.id);
              }
            }
          : undefined
      }
      aria-pressed={isDiscussClickable ? isDiscussing : undefined}
      className={`group relative rounded-lg border p-3 transition-all duration-200 ${
        isDiscussClickable ? "cursor-pointer" : ""
      } ${
        isDiscussing
          ? "border-accent-cyan bg-accent-cyan/10 shadow-neon-cyan"
          : card.groupedWith !== null
          ? "border-border bg-cardH ml-6 opacity-80"
          : "border-border bg-card hover:border-border"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Action item checkbox in actions phase */}
        {phase === "actions" && card.groupedWith === null && (
          <button
            onClick={() => onToggleAction(card.id)}
            className="mt-0.5 shrink-0 text-sub hover:text-accent transition-colors"
          >
            {card.isActionItem ? (
              <CheckSquare className="w-4 h-4 text-accent" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
        )}

        <p
          className={`flex-1 text-sm leading-relaxed ${
            card.isActionItem && phase === "actions"
              ? "text-accent"
              : "text-text"
          }`}
        >
          {card.text}
        </p>

        <div className="flex items-center gap-1 shrink-0">
          {/* Vote button */}
          {(phase === "vote" || phase === "discuss" || phase === "actions") && (
            <button
              onClick={() => onVote(card.id)}
              disabled={!canVote && phase === "vote"}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-all ${
                phase === "vote" && canVote
                  ? "text-sub hover:text-accent-magenta hover:bg-accent-magenta/10 cursor-pointer"
                  : phase === "vote" && !canVote
                  ? "text-sub cursor-not-allowed opacity-50"
                  : "text-sub cursor-default"
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  card.votes > 0 ? "fill-accent-magenta text-accent-magenta" : ""
                }`}
              />
              <span>{card.votes}</span>
            </button>
          )}

          {/* Delete */}
          {phase === "write" && (
            <button
              onClick={() => onDelete(card.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-sub hover:text-status-red transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Group with selector */}
      {phase === "write" && otherCards.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <Select
            value={card.groupedWith ?? "__none__"}
            onValueChange={(val) => onGroup(card.id, val === "__none__" ? null : val)}
          >
            <SelectTrigger className="min-touch-coarse h-6 text-[10px] bg-cardH border-border text-sub">
              <SelectValue placeholder="Group with…" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="__none__" className="text-xs text-sub">
                No group
              </SelectItem>
              {otherCards.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs text-text">
                  {c.text.length > 40 ? c.text.slice(0, 40) + "…" : c.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Assignee input in actions phase */}
      {phase === "actions" && card.isActionItem && (
        <div className="mt-2 pt-2 border-t border-accent-cyan/20">
          <Input
            value={card.assignee}
            onChange={(e) => onAssigneeChange(card.id, e.target.value)}
            placeholder="Assign to…"
            className="h-6 text-xs bg-cardH border-border text-sub placeholder:text-sub"
          />
        </div>
      )}
    </motion.div>
  );
}

// ── Column ───────────────────────────────────────────────────

function RetroColumnPanel({
  column,
  cards,
  allCards,
  phase,
  userVotes,
  onAdd,
  onVote,
  onDelete,
  onGroup,
  onToggleAction,
  onAssigneeChange,
  onToggleDiscussing,
}: {
  column: RetroColumn;
  cards: RetroCard[];
  allCards: RetroCard[];
  phase: BoardPhase;
  userVotes: number;
  onAdd: (columnKey: string, text: string) => void;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onGroup: (id: string, parentId: string | null) => void;
  onToggleAction: (id: string) => void;
  onAssigneeChange: (id: string, val: string) => void;
  onToggleDiscussing: (id: string) => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canVote = userVotes < MAX_VOTES;

  const displayCards =
    phase === "discuss" || phase === "actions" ? sortedByVotes(cards) : cards;

  function handleSubmit() {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    onAdd(column.key, trimmed);
    setInputVal("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 border-x border-border mb-0"
        style={{ borderTopColor: column.color }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{column.icon}</span>
          <span
            className="text-sm font-bold"
            style={{ color: column.color, textShadow: `0 0 8px ${column.color}55` }}
          >
            {column.label}
          </span>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] bg-cardH border-border text-sub"
        >
          {cards.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 bg-card border border-t-0 border-border rounded-b-lg p-2 space-y-2 min-h-[120px]">
        <AnimatePresence initial={false}>
          {displayCards
            .filter((c) => c.groupedWith === null)
            .map((card) => {
              // Include grouped children right after parent
              const children = displayCards.filter((c) => c.groupedWith === card.id);
              return (
                <div key={card.id} className="space-y-1">
                  <RetroCardItem
                    card={card}
                    allCards={allCards}
                    column={column}
                    phase={phase}
                    canVote={canVote}
                    onVote={onVote}
                    onDelete={onDelete}
                    onGroup={onGroup}
                    onToggleAction={onToggleAction}
                    onAssigneeChange={onAssigneeChange}
                    onToggleDiscussing={onToggleDiscussing}
                  />
                  {children.map((child) => (
                    <RetroCardItem
                      key={child.id}
                      card={child}
                      allCards={allCards}
                      column={column}
                      phase={phase}
                      canVote={canVote}
                      onVote={onVote}
                      onDelete={onDelete}
                      onGroup={onGroup}
                      onToggleAction={onToggleAction}
                      onAssigneeChange={onAssigneeChange}
                      onToggleDiscussing={onToggleDiscussing}
                    />
                  ))}
                </div>
              );
            })}
        </AnimatePresence>

        {/* Add card input — only in write phase */}
        {phase === "write" && (
          <div className="flex gap-1.5 pt-1">
            <Input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Add a card…"
              className="h-8 text-xs bg-cardH border-border text-text placeholder:text-sub focus:border-accent-cyan/50"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSubmit}
              disabled={!inputVal.trim()}
              className="min-touch-coarse h-8 w-8 p-0 text-sub hover:text-accent hover:bg-accent-cyan/10"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Format Selection ─────────────────────────────────────────

function FormatSelector({ onSelect }: { onSelect: (format: RetroFormat) => void }) {
  return (
    <ToolPageWrapper
      toolId="retro"
      title="Retro Board"
      description="Run collaborative retrospectives with your team. Choose a format to get started — multiplayer sync coming soon."
      category="Ceremonies"
    >
      <div className="space-y-6">
        <h2 className="text-lg font-display font-bold text-text">
          Choose a Format
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {retroFormats.map((fmt) => (
            <Card
              key={fmt.id}
              className="bg-card border-border hover:border-accent-cyan/40 transition-all duration-200 cursor-pointer group"
              onClick={() => onSelect(fmt)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-text group-hover:text-accent transition-colors">
                  {fmt.name}
                </CardTitle>
                <CardDescription className="text-xs text-sub line-clamp-2">
                  {fmt.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {fmt.columns.map((col) => (
                    <span
                      key={col.key}
                      className="text-[10px] px-2 py-0.5 rounded-full border font-medium"
                      style={{
                        color: col.color,
                        borderColor: `${col.color}55`,
                        backgroundColor: `${col.color}15`,
                      }}
                    >
                      {col.icon} {col.label}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          size="lg"
          onClick={() => onSelect(retroFormats[0])}
          className="bg-accent-cyan text-bg font-bold hover:bg-accent-cyan/90 shadow-neon-cyan"
        >
          Quick Start: Start / Stop / Continue
        </Button>
      </div>
    </ToolPageWrapper>
  );
}

// ── Export helpers ────────────────────────────────────────────

function buildExportText(state: BoardState): string {
  const lines: string[] = [
    `# Retrospective: ${state.format.name}`,
    `Date: ${new Date().toLocaleDateString()}`,
    "",
  ];

  for (const col of state.format.columns) {
    const colCards = state.cards.filter(
      (c) => c.columnKey === col.key && c.groupedWith === null
    );
    lines.push(`## ${col.label}`);
    if (colCards.length === 0) {
      lines.push("  (no cards)");
    } else {
      sortedByVotes(colCards).forEach((card) => {
        lines.push(`- [${card.votes} votes] ${card.text}`);
        if (card.isActionItem) {
          lines.push(
            `  → ACTION ITEM${card.assignee ? ` | Assigned to: ${card.assignee}` : ""}`
          );
        }
        const children = state.cards.filter((c) => c.groupedWith === card.id);
        children.forEach((child) => lines.push(`  • ${child.text}`));
      });
    }
    lines.push("");
  }

  const actionItems = state.cards.filter((c) => c.isActionItem);
  if (actionItems.length > 0) {
    lines.push("## Action Items Summary");
    actionItems.forEach((c) => {
      lines.push(`- [ ] ${c.text}${c.assignee ? ` (@${c.assignee})` : ""}`);
    });
  }

  return lines.join("\n");
}

function buildExportJson(state: BoardState) {
  return {
    format: state.format.name,
    date: new Date().toISOString(),
    columns: state.format.columns.map((col) => ({
      label: col.label,
      cards: state.cards
        .filter((c) => c.columnKey === col.key)
        .map((c) => ({
          text: c.text,
          votes: c.votes,
          isActionItem: c.isActionItem,
          assignee: c.assignee || undefined,
        })),
    })),
  };
}

// ── Board ────────────────────────────────────────────────────

function Board({
  state,
  onUpdate,
  onReset,
  logger,
}: {
  state: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  onReset: () => void;
  logger: HistoryLogger;
}) {
  const { log } = logger;
  const [copied, setCopied] = useState(false);

  // Timer tick — only depend on timerRunning, not timerSeconds, to avoid
  // interval churn on every tick. Functional updater accesses latest state.
  useEffect(() => {
    if (!state.timerRunning) return;
    const id = setInterval(() => {
      onUpdate((prev) => ({
        ...prev,
        timerSeconds: Math.max(0, prev.timerSeconds - 1),
        timerRunning: prev.timerSeconds <= 1 ? false : prev.timerRunning,
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.timerRunning, onUpdate]);

  const handleAdvancePhase = useCallback(() => {
    let transition: { from: BoardPhase; to: BoardPhase } | null = null;
    onUpdate((prev) => {
      const idx = PHASES.findIndex((p) => p.key === prev.phase);
      const next = PHASES[idx + 1];
      if (!next) return prev;
      sonify("retro", "phase-advance");
      transition = { from: prev.phase, to: next.key };
      return { ...prev, phase: next.key };
    });
    if (transition) log(RETRO_ACTIONS.PHASE_ADVANCED, transition);
  }, [onUpdate, log]);

  const handleAddCard = useCallback(
    (columnKey: string, text: string) => {
      sonify("retro", "card-add");
      const cardId = makeId();
      onUpdate((prev) => ({
        ...prev,
        cards: [
          ...prev.cards,
          {
            id: cardId,
            columnKey,
            text,
            votes: 0,
            groupedWith: null,
            isActionItem: false,
            assignee: "",
            discussing: false,
          },
        ],
      }));
      log(RETRO_ACTIONS.CARD_ADDED, { cardId, columnKey, text });
    },
    [onUpdate, log]
  );

  const handleVote = useCallback(
    (id: string) => {
      let nextVoteCount: number | null = null;
      onUpdate((prev) => {
        if (prev.phase !== "vote") return prev;
        if (prev.userVotes >= MAX_VOTES) return prev;
        sonify("retro", "vote");
        const card = prev.cards.find((c) => c.id === id);
        nextVoteCount = (card?.votes ?? 0) + 1;
        return {
          ...prev,
          userVotes: prev.userVotes + 1,
          cards: prev.cards.map((c) =>
            c.id === id ? { ...c, votes: c.votes + 1 } : c
          ),
        };
      });
      // Log AFTER the updater runs (post-commit) so StrictMode's double-invoke
      // of the pure updater doesn't double-log.
      if (nextVoteCount !== null) {
        log(RETRO_ACTIONS.CARD_VOTED, { cardId: id, voteCount: nextVoteCount });
      }
    },
    [onUpdate, log]
  );

  const handleDelete = useCallback(
    (id: string) => {
      let cascadedCount = 0;
      onUpdate((prev) => {
        // Collect every id that should disappear: the deleted card and every
        // card grouped under it. Then sweep groupedWith on survivors so a
        // parent that pointed at a now-deleted child doesn't keep a dangling
        // reference (used by exports and the AI prompt).
        const removed = new Set<string>([id]);
        for (const c of prev.cards) if (c.groupedWith === id) removed.add(c.id);
        cascadedCount = removed.size - 1;
        return {
          ...prev,
          cards: prev.cards
            .filter((c) => !removed.has(c.id))
            .map((c) =>
              c.groupedWith && removed.has(c.groupedWith) ? { ...c, groupedWith: null } : c
            ),
        };
      });
      log(RETRO_ACTIONS.CARD_REMOVED, { cardId: id, cascadedCount });
    },
    [onUpdate, log]
  );

  const handleGroup = useCallback(
    (id: string, parentId: string | null) => {
      // Track which branch the updater took so we can log post-commit.
      // Use distinct nullable refs instead of a single union variable so
      // TS's control-flow analysis (which doesn't cross closures) doesn't
      // narrow the variable to its initial literal.
      let didGroup: { sourceId: string; targetId: string } | null = null;
      let didUngroup: { cardId: string } | null = null;
      onUpdate((prev) => {
        if (parentId === null) {
          didUngroup = { cardId: id };
          return {
            ...prev,
            cards: prev.cards.map((c) => (c.id === id ? { ...c, groupedWith: null } : c)),
          };
        }
        // Reject self-grouping and reject grouping under a card that doesn't
        // exist or sits in another column. Walk the parent chain to also
        // reject cycles — without this, an imported state can produce a
        // groupedWith loop that the renderer hides but every consumer
        // (export, AI prompt, multiplayer sync) trips over.
        const child = prev.cards.find((c) => c.id === id);
        const parent = prev.cards.find((c) => c.id === parentId);
        if (!child || !parent || parent.id === id) return prev;
        if (parent.columnKey !== child.columnKey) return prev;
        let cursor: string | null = parent.groupedWith;
        const seen = new Set<string>([parent.id]);
        while (cursor) {
          if (cursor === id || seen.has(cursor)) return prev;
          seen.add(cursor);
          cursor = prev.cards.find((c) => c.id === cursor)?.groupedWith ?? null;
        }
        didGroup = { sourceId: id, targetId: parentId };
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === id ? { ...c, groupedWith: parentId } : c
          ),
        };
      });
      if (didGroup) log(RETRO_ACTIONS.CARDS_GROUPED, didGroup);
      else if (didUngroup) log(RETRO_ACTIONS.CARDS_UNGROUPED, didUngroup);
    },
    [onUpdate, log]
  );

  const handleToggleAction = useCallback(
    (id: string) => {
      let nextIsActionItem: boolean | null = null;
      onUpdate((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        nextIsActionItem = !(card?.isActionItem ?? false);
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === id ? { ...c, isActionItem: !c.isActionItem } : c
          ),
        };
      });
      if (nextIsActionItem !== null) {
        log(RETRO_ACTIONS.ACTION_TOGGLED, {
          cardId: id,
          isActionItem: nextIsActionItem,
        });
      }
    },
    [onUpdate, log]
  );

  const handleAssigneeChange = useCallback(
    (id: string, val: string) => {
      onUpdate((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id ? { ...c, assignee: val } : c
        ),
      }));
    },
    [onUpdate]
  );

  const handleToggleDiscussing = useCallback(
    (id: string) => {
      onUpdate((prev) => {
        if (prev.phase !== "discuss") return prev;
        const target = prev.cards.find((c) => c.id === id);
        if (!target) return prev;
        const next = !target.discussing;
        return {
          ...prev,
          // Toggling a card "into" discussion focuses just that one — clear any
          // others so the highlight ring stays meaningful at a glance.
          cards: prev.cards.map((c) =>
            c.id === id
              ? { ...c, discussing: next }
              : next && c.discussing
              ? { ...c, discussing: false }
              : c
          ),
        };
      });
    },
    [onUpdate]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Retrospective Board",
    prompts: generateRetroPrompts({
      formatName: state.format.name,
      columns: state.format.columns,
      cards: state.cards,
    }),
  }), [state.format, state.cards]);

  const handleExport = useCallback(async () => {
    const text = buildExportText(state);
    const json = buildExportJson(state);

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }

    // Download JSON. Revoke is deferred — Firefox/Safari can cancel the
    // download if the blob URL is revoked synchronously after click().
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retro-${state.format.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [state]);

  const totalCards = state.cards.filter((c) => c.groupedWith === null).length;
  const actionCount = state.cards.filter((c) => c.isActionItem).length;
  const colCount = state.format.columns.length;

  const gridClass =
    colCount <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : colCount === 3
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      : colCount === 4
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

  return (
    <ToolPageWrapper
      toolId="retro"
      title={`Retro Board — ${state.format.name}`}
      description={state.format.description}
      category="Ceremonies"
    >
      <div className="space-y-5">
        {/* ── Board Header ─────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <PhaseIndicator current={state.phase} onAdvance={handleAdvancePhase} />
            <div className="flex items-center gap-3 text-xs text-sub">
              <span>{totalCards} cards</span>
              {state.phase === "vote" && (
                <span className="text-accent font-semibold">
                  {MAX_VOTES - state.userVotes} votes remaining
                </span>
              )}
              {state.phase === "actions" && actionCount > 0 && (
                <span className="text-accent-green font-semibold">
                  {actionCount} action item{actionCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TimerWidget
              seconds={state.timerSeconds}
              running={state.timerRunning}
              onToggle={() =>
                onUpdate((prev) => ({ ...prev, timerRunning: !prev.timerRunning }))
              }
              onReset={() =>
                onUpdate((prev) => ({
                  ...prev,
                  timerSeconds: 300,
                  timerRunning: false,
                }))
              }
              onChange={(s) =>
                onUpdate((prev) => ({
                  ...prev,
                  timerSeconds: s,
                  timerRunning: false,
                }))
              }
            />
          </div>
        </div>

        {/* ── Phase hint ───────────────────────────────────── */}
        <div className="text-xs text-sub px-1">
          {PHASES.find((p) => p.key === state.phase)?.description}
          {state.phase === "discuss" && (
            <span className="ml-2 text-accent">
              Cards sorted by votes — click a card to mark it as discussing.
            </span>
          )}
        </div>

        {/* ── Columns ──────────────────────────────────────── */}
        <div className={`grid ${gridClass} gap-4`}>
          {state.format.columns.map((col) => {
            const colCards = state.cards.filter((c) => c.columnKey === col.key);
            return (
              <RetroColumnPanel
                key={col.key}
                column={col}
                cards={colCards}
                allCards={state.cards}
                phase={state.phase}
                userVotes={state.userVotes}
                onAdd={handleAddCard}
                onVote={handleVote}
                onDelete={handleDelete}
                onGroup={handleGroup}
                onToggleAction={handleToggleAction}
                onAssigneeChange={handleAssigneeChange}
                onToggleDiscussing={handleToggleDiscussing}
              />
            );
          })}
        </div>

        {/* ── Footer actions ───────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <AiPromptGenerator config={promptConfig} />
          <Button
            onClick={handleExport}
            variant="outline"
            className="border-border text-sub hover:border-accent-cyan/50 hover:text-accent"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2 text-accent-green" /> Copied!
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" /> Export Board
              </>
            )}
          </Button>
          <Button
            onClick={onReset}
            variant="ghost"
            className="text-sub hover:text-status-red hover:bg-status-red/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" /> New Retro
          </Button>
          <Button
            onClick={() =>
              onUpdate((prev) => ({
                ...prev,
                cards: [],
                userVotes: 0,
                phase: "write",
                timerRunning: false,
                timerSeconds: 300,
              }))
            }
            variant="ghost"
            className="text-sub hover:text-sub"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Clear Board
          </Button>
          <span className="ml-auto text-xs text-sub">
            {state.format.name} · Local session
          </span>
        </div>
      </div>
    </ToolPageWrapper>
  );
}

// ── Root Client ──────────────────────────────────────────────

export function RetroClient() {
  const [boardState, setBoardState] = useState<BoardState | null>(null);
  const logger = useHistoryLogger("retro");

  const handleSelectFormat = useCallback(
    (format: RetroFormat) => {
      // Switching formats wipes every card — confirm first when there's work to lose.
      if (
        boardState &&
        boardState.cards.length > 0 &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Switching to "${format.name}" will clear all ${boardState.cards.length} cards on the current board. Continue?`
        )
      ) {
        return;
      }
      setBoardState({
        format,
        phase: "write",
        cards: [],
        userVotes: 0,
        timerSeconds: 300,
        timerRunning: false,
        discussingIndex: 0,
      });
      logger.log(RETRO_ACTIONS.FORMAT_CHANGED, { format: format.name });
    },
    [logger, boardState]
  );

  const handleReset = useCallback(() => {
    setBoardState(null);
    logger.log(RETRO_ACTIONS.RETRO_RESET, {});
  }, [logger]);

  const handleUpdate = useCallback(
    (updater: (prev: BoardState) => BoardState) => {
      setBoardState((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  if (!boardState) {
    return <FormatSelector onSelect={handleSelectFormat} />;
  }

  return (
    <Board
      state={boardState}
      onUpdate={handleUpdate}
      onReset={handleReset}
      logger={logger}
    />
  );
}
