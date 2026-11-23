"use client";

/**
 * The causal loop view: the things that go up or down, the arrows between
 * them, and the loops the arrows close. + means both move the same way, −
 * that they move opposite ways; an arrow can take time. A loop with an even
 * number of − arrows feeds itself (R), an odd number holds itself back (B).
 *
 * Things are added with Enter, edited in place, moved earlier or later (to
 * untangle the circle), marked as the root cause and deleted with Undo
 * (their arrows and their loops' names come back too). "Add from the whys
 * and causes" puts a why or a fishbone cause on the loop in one tap. Arrows
 * are drawn with the form, their sign flipped and deleted with Undo. Each
 * loop can be named; from two loops, the thing in the most of them is
 * pointed out. Ask Amr suggests arrows (without AI: a chain through the
 * things and one arrow back); each one accepted goes through the store,
 * with Undo. The diagram is read-only: these lists are where it's edited.
 */

import { useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { ArrowDown, ArrowUp, Plus, Repeat, Target, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { BlurInput } from "@/components/shared/blur-fields";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { loopLinksTask, type LoopLinksOutput } from "@/lib/ai/tasks/root-cause.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { ROOT_CAUSE_ACTIONS } from "@/lib/history/event-actions";
import { cleanText } from "@/lib/root-cause/model";
import {
  LOOPS_TRUNCATED_NOTE,
  LOOP_KIND_LABEL,
  LOOP_REFUSAL_TEXT,
  busiestNode,
  describeLoop,
  findLoops,
  loopHasText,
  loopLine,
  loopLinkProblem,
  loopName,
  loopNodeProblem,
  loopOf,
  withLoopLink,
  withLoopLinkPatch,
  withLoopName,
  withLoopNode,
  withLoopNodeMoved,
  withLoopNodeText,
  withLoopRestored,
  withoutLoopLink,
  withoutLoopNode,
  type LoopChange,
  type LoopRemoved,
  type NewLoopLink,
} from "@/lib/root-cause/loops";
import {
  LOOP_TEXT_MAX,
  TOOL_LIST_MAX,
  type LoopPolarity,
  type RootCauseAnalysis,
  type RootCauseLoop,
  type RootCauseLoopLink,
  type RootCauseLoopNode,
} from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { LoopDiagram, MOVES_LABEL } from "./loop-diagram";

/** A native select the size of the other fields: 44 px and 16 px text on a phone (no iOS zoom). */
const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-2 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

/** Whys and causes offered at once under "Add from the whys and causes", before "Show all". */
const CANDIDATES_SHOWN = 8;

const short = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const SIGN_OPTIONS: { value: LoopPolarity; label: string }[] = [
  { value: "same", label: "+ same way" },
  { value: "opposite", label: "− opposite ways" },
];

/** A new thing's words checked against the loop: the refusal's sentence, or null. */
export function validateLoopNode(loop: RootCauseLoop, text: string): string | null {
  const problem = loopNodeProblem(loop, text);
  return problem ? LOOP_REFUSAL_TEXT[problem] : null;
}

export interface LoopLinkDraft {
  from: string;
  to: string;
  polarity: LoopPolarity;
  delay: boolean;
}

/** What the page says when an arrow is refused. */
export function linkRefusalText(reason: keyof typeof LOOP_REFUSAL_TEXT): string {
  return reason === "duplicate"
    ? "That arrow is drawn already: flip its sign below instead."
    : LOOP_REFUSAL_TEXT[reason];
}

/** A new arrow checked against the loop: the refusal's sentence, or null. */
export function validateLoopLink(loop: RootCauseLoop, draft: LoopLinkDraft): string | null {
  if (!draft.from) return "Pick where the arrow starts.";
  if (!draft.to) return "Pick where the arrow goes.";
  const problem = loopLinkProblem(loop, draft);
  return problem ? linkRefusalText(problem) : null;
}

/** An arrow Amr suggested. */
type SuggestedLink = LoopLinksOutput["links"][number];

/**
 * An answer's arrows that could still go on: between two different things
 * on the loop, not drawn yet, one per from→to.
 */
export function newLinksFrom(
  loop: RootCauseLoop,
  links: readonly SuggestedLink[]
): SuggestedLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const pair = `${l.from}\u0000${l.to}`;
    const problem = loopLinkProblem(loop, l);
    if (seen.has(pair) || (problem && problem !== "links_full")) return false;
    seen.add(pair);
    return true;
  });
}

export interface CausalLoopProps {
  analysis: RootCauseAnalysis;
  /** Example analyses are read-only for AI. */
  readOnlyAi?: boolean;
  /** Change the analysis through the store, stamped; returns the saved one. */
  onWrite: (
    fn: (a: RootCauseAnalysis, now: string) => RootCauseAnalysis | null
  ) => RootCauseAnalysis | null;
  onLog: (action: string, payload?: Record<string, unknown>) => void;
  /** Name a thing on the loop as the root cause (logged and cheered once by the page). */
  onMarkRoot: (text: string) => void;
}

function NodeRow({
  node,
  index,
  count,
  isRoot,
  onEdit,
  onMove,
  onRemove,
  onMarkRoot,
  textRef,
  moveRef,
}: {
  node: RootCauseLoopNode;
  index: number;
  count: number;
  isRoot: boolean;
  onEdit: (text: string) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onMarkRoot: () => void;
  textRef: (el: HTMLButtonElement | null) => void;
  moveRef: (by: -1 | 1, el: HTMLButtonElement | null) => void;
}) {
  const edit = useInlineEdit();
  return (
    <li
      className={cn(
        "space-y-1.5 rounded-md border bg-bg px-2.5 py-2",
        isRoot ? "border-accent" : "border-border"
      )}
    >
      {edit.editing ? (
        <InlineItemEditor
          label="Edit thing"
          title={node.text}
          titleLabel="Thing that goes up or down"
          titleMaxLength={LOOP_TEXT_MAX.node}
          onDone={(next, { refocus }) => {
            edit.stop({ refocus });
            if (next) onEdit(next.title);
          }}
        />
      ) : (
        <button
          ref={(el) => {
            (edit.triggerRef as MutableRefObject<HTMLButtonElement | null>).current = el;
            textRef(el);
          }}
          type="button"
          onClick={edit.start}
          aria-label={`${node.text}. Edit`}
          className="block w-full break-words text-left text-sm text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:min-h-11 pointer-coarse:py-2"
        >
          {node.text}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          ref={(el) => moveRef(-1, el)}
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch-coarse h-7 w-7 p-0 text-sub"
          aria-label={`Move “${node.text}” earlier`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          ref={(el) => moveRef(1, el)}
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch-coarse h-7 w-7 p-0 text-sub"
          aria-label={`Move “${node.text}” later`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        {isRoot ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Root cause
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onMarkRoot}
            aria-label={`Mark “${node.text}” as the root cause`}
          >
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Root cause?
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-touch-coarse ml-auto h-7 px-2 text-sub hover:text-danger"
          onClick={onRemove}
          aria-label={`Delete “${node.text}”`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function CausalLoop({
  analysis,
  readOnlyAi = false,
  onWrite,
  onLog,
  onMarkRoot,
}: CausalLoopProps) {
  const announce = useAnnounce();
  const id = analysis.id;
  const loop = loopOf(analysis);
  const found = useMemo(() => findLoops(analysis.loop), [analysis.loop]);
  const busiest = useMemo(() => busiestNode(analysis.loop, found), [analysis.loop, found]);
  const text = useMemo(() => new Map(loop.nodes.map((n) => [n.id, n.text])), [loop.nodes]);
  const root = analysis.rootCause?.trim() ?? "";
  const nodesFull = loop.nodes.length >= TOOL_LIST_MAX.loopNodes;
  const linksFull = loop.links.length >= TOOL_LIST_MAX.loopLinks;

  const [nodeDraft, setNodeDraft] = useState("");
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<LoopLinkDraft>({
    from: "",
    to: "",
    polarity: "same",
    delay: false,
  });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<{ key: string; text: string } | null>(null);
  const [allCandidates, setAllCandidates] = useState(false);
  const [suggested, setSuggested] = useState<{ items: SuggestedLink[]; source: AiSource } | null>(
    null
  );
  const [noNew, setNoNew] = useState(false);

  const nodeInputRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  /** Each thing's text button, and its move buttons, by node id. */
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());

  const focusLater = (pick: () => HTMLElement | null | undefined) =>
    requestAnimationFrame(() => pick()?.focus());

  /** A loop change through the store: the saved analysis, or why it wasn't saved. */
  const change = <R extends string>(
    fn: (a: RootCauseAnalysis, now: string) => LoopChange<R>
  ): LoopChange<R | "not_found"> => {
    const box: { result: LoopChange<R> | null } = { result: null };
    onWrite((a, now) => {
      const result = fn(a, now);
      box.result = result;
      return result.ok ? result.analysis : null;
    });
    return box.result ?? { ok: false, reason: "not_found" };
  };

  const logUpdate = () =>
    onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "loop" });

  /* ── Things ── */

  const addNode = (words: string, from?: "why" | "cause"): boolean => {
    const nodeId = nanoid(8);
    const result = change((a, now) => withLoopNode(a, words, nodeId, now));
    if (!result.ok) {
      announce(LOOP_REFUSAL_TEXT[result.reason]);
      return false;
    }
    const count = result.analysis.loop?.nodes.length ?? 0;
    onLog(ROOT_CAUSE_ACTIONS.LOOP_NODE_ADDED, {
      analysisId: id,
      count,
      ...(from ? { from } : {}),
    });
    announce(`Added “${short(words)}” to the loop.`);
    return true;
  };

  const submitNode = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateLoopNode(loop, nodeDraft);
    if (problem) {
      setNodeError(problem);
      nodeInputRef.current?.focus();
      return;
    }
    if (addNode(nodeDraft)) {
      setNodeDraft("");
      setNodeError(null);
    }
    nodeInputRef.current?.focus();
  };

  const editNode = (nodeId: string, words: string) => {
    const result = change((a, now) => withLoopNodeText(a, nodeId, words, now));
    if (!result.ok) {
      announce(LOOP_REFUSAL_TEXT[result.reason]);
      return;
    }
    logUpdate();
  };

  const moveNode = (node: RootCauseLoopNode, by: -1 | 1) => {
    const saved = onWrite((a, now) => withLoopNodeMoved(a, node.id, by, now));
    if (!saved) return;
    logUpdate();
    const nodes = saved.loop?.nodes ?? [];
    const at = nodes.findIndex((n) => n.id === node.id);
    announce(`Moved “${short(node.text)}” to place ${at + 1} of ${nodes.length}.`);
    // Focus stays on the same arrow button, or the other one at an end.
    const end = by === -1 ? at === 0 : at === nodes.length - 1;
    focusLater(() => moveButtons.current.get(`${node.id}:${end ? -by : by}`));
  };

  const removeNode = (node: RootCauseLoopNode, index: number) => {
    const arrows = loop.links.filter((l) => l.from === node.id || l.to === node.id).length;
    const neighbour = loop.nodes[index + 1] ?? loop.nodes[index - 1] ?? null;
    const box: { removed: LoopRemoved | null } = { removed: null };
    undoable({
      label: `Deleted “${short(node.text)}”`,
      description:
        arrows > 0 ? `And its ${arrows === 1 ? "arrow" : `${arrows} arrows`}.` : undefined,
      apply: () => {
        onWrite((a, now) => {
          const r = withoutLoopNode(a, node.id, now);
          box.removed = r?.removed ?? null;
          return r?.analysis ?? null;
        });
        logUpdate();
      },
      revert: () => {
        const removed = box.removed;
        if (removed) onWrite((a, now) => withLoopRestored(a, removed, now));
      },
    });
    focusLater(
      () => (neighbour ? rowButtons.current.get(neighbour.id) : undefined) ?? nodeInputRef.current
    );
  };

  /** Whys and causes not on the loop yet, in their order, one per wording. */
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: { text: string; from: "why" | "cause" }[] = [];
    const lists: [readonly string[], "why" | "cause"][] = [
      [analysis.whys.map((w) => w.text), "why"],
      [analysis.causes.map((c) => c.text), "cause"],
    ];
    for (const [list, from] of lists) {
      for (const raw of list) {
        const t = loopLine(raw, LOOP_TEXT_MAX.node);
        const key = t.toLowerCase();
        if (!t || seen.has(key) || loopHasText(loop, t)) continue;
        seen.add(key);
        out.push({ text: t, from });
      }
    }
    return out;
  }, [analysis.whys, analysis.causes, loop]);
  const shownCandidates = allCandidates ? candidates : candidates.slice(0, CANDIDATES_SHOWN);

  /* ── Arrows ── */

  const linkLabel = (l: Pick<RootCauseLoopLink, "from" | "to">) =>
    `${text.get(l.from) ?? "?"} → ${text.get(l.to) ?? "?"}`;

  const closedBy = (saved: RootCauseAnalysis, linkId: string) =>
    findLoops(saved.loop).loops.filter((l) => l.linkIds.includes(linkId));

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    const problem = validateLoopLink(loop, linkDraft);
    if (problem) {
      setLinkError(problem);
      fromRef.current?.focus();
      return;
    }
    const linkId = nanoid(8);
    const link: NewLoopLink = {
      from: linkDraft.from,
      to: linkDraft.to,
      polarity: linkDraft.polarity,
      ...(linkDraft.delay ? { delay: true } : {}),
    };
    const result = change((a, now) => withLoopLink(a, link, linkId, now));
    if (!result.ok) {
      setLinkError(linkRefusalText(result.reason));
      return;
    }
    onLog(ROOT_CAUSE_ACTIONS.LOOP_LINK_ADDED, {
      analysisId: id,
      polarity: link.polarity,
      delay: link.delay === true,
    });
    const closed = closedBy(result.analysis, linkId);
    announce(
      closed.length > 0
        ? `Added the arrow. It closes ${closed.map((l) => l.label).join(", ")}.`
        : "Added the arrow."
    );
    setLinkError(null);
    // The next arrow starts where this one ended.
    setLinkDraft({ from: link.to, to: "", polarity: "same", delay: false });
    fromRef.current?.focus();
  };

  const flipLink = (l: RootCauseLoopLink) => {
    const polarity: LoopPolarity = l.polarity === "same" ? "opposite" : "same";
    const saved = onWrite((a, now) => withLoopLinkPatch(a, l.id, { polarity }, now));
    if (!saved) return;
    logUpdate();
    announce(`${linkLabel(l)}: now ${MOVES_LABEL[polarity].toLowerCase()}.`);
  };

  const toggleDelay = (l: RootCauseLoopLink) => {
    const delay = !l.delay;
    const saved = onWrite((a, now) => withLoopLinkPatch(a, l.id, { delay }, now));
    if (!saved) return;
    logUpdate();
    announce(`${linkLabel(l)}: ${delay ? "takes time" : "no delay"}.`);
  };

  const removeLink = (l: RootCauseLoopLink) => {
    const box: { removed: LoopRemoved | null } = { removed: null };
    undoable({
      label: `Deleted the arrow ${short(linkLabel(l), 60)}`,
      apply: () => {
        onWrite((a, now) => {
          const r = withoutLoopLink(a, l.id, now);
          box.removed = r?.removed ?? null;
          return r?.analysis ?? null;
        });
        logUpdate();
      },
      revert: () => {
        const removed = box.removed;
        if (removed) onWrite((a, now) => withLoopRestored(a, removed, now));
      },
    });
    focusLater(() => fromRef.current ?? headingRef.current);
  };

  /* ── Amr's arrows ── */

  const aiInput = () => ({
    problem: cleanText(`${analysis.title}. ${analysis.problem}`, 1000),
    nodes: loop.nodes.slice(0, TOOL_LIST_MAX.loopNodes).map((n) => ({
      id: n.id.slice(0, 64),
      text: n.text.slice(0, LOOP_TEXT_MAX.node),
    })),
    links: loop.links.slice(0, TOOL_LIST_MAX.loopLinks).map((l) => ({
      from: l.from.slice(0, 64),
      to: l.to.slice(0, 64),
      polarity: l.polarity,
    })),
  });

  const acceptArrow = (s: SuggestedLink) => {
    const problem = loopLinkProblem(loopOf(analysis), s);
    if (problem) {
      announce(linkRefusalText(problem));
      return;
    }
    const linkId = nanoid(8);
    undoable({
      label: "Added an arrow",
      description: short(linkLabel(s), 80),
      kind: "success",
      id: `root-cause-loop-arrows-${id}`,
      apply: () => {
        const result = change((a, now) =>
          withLoopLink(
            a,
            { from: s.from, to: s.to, polarity: s.polarity, ...(s.delay ? { delay: true } : {}) },
            linkId,
            now
          )
        );
        if (!result.ok) return;
        onLog(ROOT_CAUSE_ACTIONS.LOOP_LINK_ADDED, {
          analysisId: id,
          polarity: s.polarity,
          delay: s.delay === true,
        });
      },
      revert: () => onWrite((a, now) => withoutLoopLink(a, linkId, now)?.analysis ?? null),
    });
  };

  /* ── Loops ── */

  const nameLoop = (
    key: string,
    kind: keyof typeof LOOP_KIND_LABEL,
    label: string,
    words: string
  ) => {
    const result = change((a, now) => withLoopName(a, key, words, now));
    if (!result.ok) {
      setNameError({ key, text: LOOP_REFUSAL_TEXT[result.reason] });
      return;
    }
    setNameError(null);
    if (words.trim()) {
      onLog(ROOT_CAUSE_ACTIONS.LOOP_NAMED, { analysisId: id, kind });
      announce(`Named ${label}.`);
    } else {
      logUpdate();
      announce(`${label} has no name now.`);
    }
  };

  const busiestIsRoot = Boolean(busiest) && root !== "" && busiest!.text.trim() === root;

  return (
    <section aria-labelledby="causal-loop-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="causal-loop-heading"
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-sm font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Causal loop
        </h3>
        {!readOnlyAi && (
          <div ref={askRef}>
            <AiButton
              task={loopLinksTask}
              input={aiInput}
              label="Ask Amr for arrows"
              fallbackLabel="Suggest arrows without AI"
              disabledReason={
                loop.nodes.length < 2
                  ? "Add two things to the loop first."
                  : linksFull
                    ? LOOP_REFUSAL_TEXT.links_full
                    : undefined
              }
              onResult={(data, meta) => {
                const items = newLinksFrom(loopOf(analysis), data.links);
                setNoNew(items.length === 0);
                setSuggested(items.length > 0 ? { items, source: meta.source } : null);
                announce(
                  items.length === 0
                    ? "No new arrows to suggest."
                    : `${items.length} possible ${items.length === 1 ? "arrow" : "arrows"} below. Add the ones that hold.`
                );
              }}
            />
          </div>
        )}
      </div>
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text">
        <span className="font-semibold">Problem:</span> {analysis.title}
        {loop.nodes.length === 0 && (
          <span className="block text-xs text-sub">
            Add the things that go up or down around it: an amount, a wait, a feeling the team can
            see change.
          </span>
        )}
      </p>

      {noNew && (
        <p role="status" className="text-xs text-sub">
          No new arrows to suggest.
        </p>
      )}
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          itemKey={(s) => `${s.from}>${s.to}`}
          source={suggested.source}
          title="Possible arrows"
          render={(s) => ({
            title: `${linkLabel(s)} (${MOVES_LABEL[s.polarity].toLowerCase()}${s.delay ? ", takes time" : ""})`,
            detail: s.why,
          })}
          onAccept={acceptArrow}
          onDismiss={() => setSuggested(null)}
          returnFocus={() =>
            askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]') ??
            headingRef.current
          }
        />
      )}

      {/* ── Things that go up or down ── */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h4 className="text-sm font-semibold text-text">Things that go up or down</h4>
        {loop.nodes.length > 0 && (
          <ol aria-label="Things on the loop" className="space-y-1.5">
            {loop.nodes.map((n, i) => (
              <NodeRow
                key={n.id}
                node={n}
                index={i}
                count={loop.nodes.length}
                isRoot={root !== "" && n.text.trim() === root}
                onEdit={(words) => editNode(n.id, words)}
                onMove={(by) => moveNode(n, by)}
                onRemove={() => removeNode(n, i)}
                onMarkRoot={() => onMarkRoot(n.text)}
                textRef={(el) => {
                  if (el) rowButtons.current.set(n.id, el);
                  else rowButtons.current.delete(n.id);
                }}
                moveRef={(by, el) => {
                  if (el) moveButtons.current.set(`${n.id}:${by}`, el);
                  else moveButtons.current.delete(`${n.id}:${by}`);
                }}
              />
            ))}
          </ol>
        )}
        {nodesFull ? (
          <p className="text-xs text-sub">{LOOP_REFUSAL_TEXT.loop_full}</p>
        ) : (
          <form onSubmit={submitNode} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <label htmlFor={`loop-node-${id}`} className="sr-only">
                A thing that goes up or down
              </label>
              <Input
                id={`loop-node-${id}`}
                ref={nodeInputRef}
                value={nodeDraft}
                maxLength={LOOP_TEXT_MAX.node}
                aria-invalid={nodeError ? true : undefined}
                aria-describedby={nodeError ? `loop-node-error-${id}` : undefined}
                placeholder="Support tickets"
                onChange={(e) => {
                  setNodeDraft(e.target.value);
                  if (nodeError) setNodeError(null);
                }}
              />
              {nodeError && (
                <p id={`loop-node-error-${id}`} className="mt-1 text-xs text-danger">
                  {nodeError}
                </p>
              )}
            </div>
            <Button type="submit" size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add thing
            </Button>
          </form>
        )}
        {!nodesFull && candidates.length > 0 && (
          <div className="space-y-1.5">
            <p id={`loop-candidates-${id}`} className="text-xs font-medium text-sub">
              Add from the whys and causes
            </p>
            <ul aria-labelledby={`loop-candidates-${id}`} className="flex flex-wrap gap-1.5">
              {shownCandidates.map((c) => (
                <li key={c.text.toLowerCase()} className="min-w-0 max-w-full">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-8 max-w-full gap-1 whitespace-normal break-words px-2 py-1 text-left text-xs"
                    aria-label={`Add “${c.text}” to the loop`}
                    onClick={() => {
                      addNode(c.text, c.from);
                      focusLater(() => nodeInputRef.current);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {short(c.text, 60)}
                  </Button>
                </li>
              ))}
            </ul>
            {candidates.length > CANDIDATES_SHOWN && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                aria-expanded={allCandidates}
                onClick={() => setAllCandidates((v) => !v)}
              >
                {allCandidates ? "Show fewer" : `Show all ${candidates.length}`}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Arrows ── */}
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <h4 className="text-sm font-semibold text-text">Arrows</h4>
        {loop.links.length > 0 && (
          <ul aria-label="Arrows on the loop" className="space-y-1.5">
            {loop.links.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-2"
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-sm font-bold",
                    l.polarity === "same"
                      ? "border-accent text-accent"
                      : "border-warning text-warning"
                  )}
                  aria-hidden="true"
                >
                  {l.polarity === "same" ? "+" : "−"}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm text-text">
                  {linkLabel(l)}
                  <span className="block text-xs text-sub">
                    {MOVES_LABEL[l.polarity]}
                    {l.delay ? " · takes time" : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  aria-label={`Flip the sign of ${linkLabel(l)}`}
                  onClick={() => flipLink(l)}
                >
                  <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                  Flip
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={l.delay ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  aria-pressed={l.delay === true}
                  aria-label={`${linkLabel(l)} takes time`}
                  onClick={() => toggleDelay(l)}
                >
                  Takes time
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-touch-coarse h-7 px-2 text-sub hover:text-danger"
                  aria-label={`Delete the arrow ${linkLabel(l)}`}
                  onClick={() => removeLink(l)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {loop.nodes.length < 2 ? (
          <p className="text-xs text-sub">Add two things to draw an arrow between them.</p>
        ) : linksFull ? (
          <p className="text-xs text-sub">{LOOP_REFUSAL_TEXT.links_full}</p>
        ) : (
          <form onSubmit={submitLink} aria-label="Add an arrow" className="space-y-2" noValidate>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`loop-from-${id}`}
                  className="mb-1 block text-xs font-medium text-sub"
                >
                  From
                </label>
                <select
                  id={`loop-from-${id}`}
                  ref={fromRef}
                  value={linkDraft.from}
                  aria-invalid={linkError ? true : undefined}
                  aria-describedby={linkError ? `loop-link-error-${id}` : undefined}
                  onChange={(e) => {
                    setLinkDraft((d) => ({ ...d, from: e.target.value }));
                    setLinkError(null);
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">Pick a thing</option>
                  {loop.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {short(n.text, 60)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`loop-to-${id}`}
                  className="mb-1 block text-xs font-medium text-sub"
                >
                  To
                </label>
                <select
                  id={`loop-to-${id}`}
                  value={linkDraft.to}
                  onChange={(e) => {
                    setLinkDraft((d) => ({ ...d, to: e.target.value }));
                    setLinkError(null);
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">Pick a thing</option>
                  {loop.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {short(n.text, 60)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ToggleGroup
                label="How they move"
                size="sm"
                options={SIGN_OPTIONS}
                value={linkDraft.polarity}
                onValueChange={(polarity) => setLinkDraft((d) => ({ ...d, polarity }))}
              />
              <label className="inline-flex min-h-8 items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={linkDraft.delay}
                  onChange={(e) => setLinkDraft((d) => ({ ...d, delay: e.target.checked }))}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Takes time
              </label>
              <Button type="submit" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add arrow
              </Button>
            </div>
            {linkError && (
              <p id={`loop-link-error-${id}`} className="text-xs text-danger">
                {linkError}
              </p>
            )}
          </form>
        )}
      </div>

      {loop.nodes.length > 0 && (
        <LoopDiagram loop={loop} found={found} busiest={busiest} rootText={root} />
      )}

      {/* ── Loops ── */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-text">Loops</h4>
        {found.loops.length === 0 ? (
          <p className="text-xs text-sub">
            A loop closes when an arrow leads back to where it started.
          </p>
        ) : (
          <ol aria-label="Loops" className="space-y-2">
            {found.loops.map((l) => {
              const name = loopName(loop, l.key) ?? "";
              const fieldId = `loop-name-${id}-${l.label}`;
              const error = nameError?.key === l.key ? nameError.text : null;
              return (
                <li
                  key={l.key}
                  className="space-y-1.5 rounded-md border border-border bg-card p-2.5"
                >
                  <p className="text-sm text-text">
                    <span
                      className={cn(
                        "mr-1.5 inline-block rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold",
                        l.kind === "reinforcing"
                          ? "bg-warning/15 text-warning"
                          : "bg-accent/15 text-accent"
                      )}
                    >
                      {l.label}
                    </span>
                    <span className="sr-only">{LOOP_KIND_LABEL[l.kind]}: </span>
                    {describeLoop(loop, l)}
                    {l.delays > 0 && (
                      <span className="block text-xs text-sub">
                        {l.delays === 1 ? "One arrow takes time" : `${l.delays} arrows take time`}:
                        the effect shows late.
                      </span>
                    )}
                  </p>
                  <div>
                    <label htmlFor={fieldId} className="sr-only">
                      Name {l.label}
                    </label>
                    <BlurInput
                      id={fieldId}
                      value={name}
                      maxLength={LOOP_TEXT_MAX.name}
                      placeholder="Name this loop"
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                      onCommit={(words) => nameLoop(l.key, l.kind, l.label, words)}
                    />
                    {error && (
                      <p id={`${fieldId}-error`} className="mt-1 text-xs text-danger">
                        {error}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {found.truncated && <p className="text-xs text-sub">{LOOPS_TRUNCATED_NOTE}</p>}
        {busiest && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-text">
            <span>“{busiest.text}” sits in the most loops: acting there may change the most.</span>
            {!busiestIsRoot && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onMarkRoot(busiest.text)}
                aria-label={`Mark the thing in the most loops, “${busiest.text}”, as the root cause`}
              >
                <Target className="h-3.5 w-3.5" aria-hidden="true" />
                Mark as root cause
              </Button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
