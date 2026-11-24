"use client";

/**
 * One box of a product canvas, on the sectioned kit's card: Enter adds a
 * line, a line is edited in place, and a delete comes with Undo (which
 * links again the lines that linked to it). Under each line, what its box
 * takes: a fact-or-guess mark, a question's answer, the
 * lines it links to, a hypothesis's picks, a Shape Up scope's nice-to-have
 * mark (shown as "~" before it), and how its test stands in the Hypothesis
 * Tracker. Beside it, "Send to…" for a guess or a Lean UX hypothesis (to be
 * tested) and a scope (to the backlog), never on the example, nor while a
 * [placeholder] is left.
 *
 * Every change goes through the canvas model (`write`), which refuses what
 * the box or the canvas can't take; the card then shows the reason.
 */

import { useRef } from "react";
import Link from "next/link";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { SectionItemsCard } from "@/components/sectioned/section-items-card";
import { linkedTest, type LinkedTest } from "@/lib/hypotheses/model";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { sectionDef, type ProductSectionDef } from "@/lib/product-canvas/formats";
import {
  DETAIL_MAX,
  canSend,
  findItem,
  formatOf,
  hypothesisPicks,
  isGuess,
  itemsOf,
  lineLinkedTo,
  linkersOf,
  newItemId,
  textMaxOf,
  validateLaunchDate,
  withItemPatch,
  withLinksRestored,
  withSectionItems,
  type CanvasWrite,
  type ItemPatch,
  type LinkerLine,
} from "@/lib/product-canvas/model";
import {
  guessHypothesisSource,
  leanUxHypothesisSource,
  scopeSource,
} from "@/lib/product-canvas/sends";
import type { HandoffLink, HandoffRouteId } from "@/lib/handoffs/types";
import { todayIso } from "@/lib/sprints/series";
import type { Hypothesis, ProductCanvas, ProductCanvasItem } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";

/** What a canvas's parts get from the page. */
export interface CanvasHandle {
  canvas: ProductCanvas;
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[];
  /** The canvas as the store holds it now (null once it is gone). */
  read: () => ProductCanvas | null;
  /** Change the canvas through the model; the store is written only when it is ok. */
  write: (fn: (c: ProductCanvas, now: string) => CanvasWrite) => CanvasWrite;
  /** Log to history (nothing for an example canvas). */
  log: (action: string, payload?: Record<string, unknown>) => void;
  /**
   * The canvases read beside this one, as the store holds them now: the
   * team's with the team's, the example's with the example's (an idea's
   * look-alikes and merges, a pitch's cycle).
   */
  world: () => ProductCanvas[];
  /** Save rows as they are: several canvases a merge or a cycle's dates changed, or an Undo. */
  put: (rows: readonly ProductCanvas[]) => void;
  /** Show another canvas. */
  open: (id: string) => void;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export const shortText = (text: string, max = 48) => {
  const t = oneLine(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A chip-style choice: a native radio or checkbox, hidden, with its label as the target. */
const CHIP =
  "min-touch-coarse inline-flex max-w-full items-center rounded-md border border-border px-2 py-1 text-xs text-sub transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent";

function EvidenceToggle({ handle, item }: { handle: CanvasHandle; item: ProductCanvasItem }) {
  const name = `pc-evidence-${handle.canvas.id}-${item.id}`;
  const set = (evidence: "fact" | "assumption") => {
    const w = handle.write((c, now) => withItemPatch(c, item.id, { evidence }, now));
    if (w.ok)
      handle.log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
        canvasId: handle.canvas.id,
        field: "evidence",
      });
  };
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
      <legend className="sr-only">Is “{shortText(item.text)}” a fact or a guess?</legend>
      {(["assumption", "fact"] as const).map((v) => (
        <label key={v} className="relative inline-flex cursor-pointer">
          <input
            type="radio"
            name={name}
            value={v}
            checked={(item.evidence ?? "assumption") === v}
            onChange={() => set(v)}
            className="peer sr-only"
          />
          <span className={CHIP}>{v === "fact" ? "Fact" : "Guess"}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** A Shape Up scope's nice-to-have mark: a checkbox chip. */
function NiceToHaveToggle({ handle, item }: { handle: CanvasHandle; item: ProductCanvasItem }) {
  const set = (niceToHave: boolean) => {
    const w = handle.write((c, now) => withItemPatch(c, item.id, { niceToHave }, now));
    if (w.ok)
      handle.log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
        canvasId: handle.canvas.id,
        field: "nice_to_have",
      });
  };
  return (
    <label className="relative inline-flex cursor-pointer">
      <input
        type="checkbox"
        checked={item.niceToHave === true}
        onChange={(e) => set(e.target.checked)}
        className="peer sr-only"
      />
      <span className={CHIP}>
        Nice to have<span className="sr-only">: “{shortText(item.text)}”</span>
      </span>
    </label>
  );
}

function AnswerField({ handle, item }: { handle: CanvasHandle; item: ProductCanvasItem }) {
  return (
    <BlurTextarea
      rows={3}
      value={item.detail ?? ""}
      maxLength={DETAIL_MAX}
      placeholder="Our answer"
      aria-label={`Answer to “${shortText(item.text, 80)}”`}
      className="max-h-72 text-sm [field-sizing:content]"
      onCommit={(text) => {
        const detail = text.trim() ? text : null;
        if ((item.detail ?? "") === (detail ?? "")) return;
        const w = handle.write((c, now) => withItemPatch(c, item.id, { detail }, now));
        if (w.ok)
          handle.log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
            canvasId: handle.canvas.id,
            field: "answer",
          });
      }}
    />
  );
}

/** Which lines this one links to: a checkbox per line of the boxes it may link to. */
function LinkPicker({
  handle,
  def,
  item,
}: {
  handle: CanvasHandle;
  def: ProductSectionDef;
  item: ProductCanvasItem;
}) {
  const format = formatOf(handle.canvas);
  const targets = (def.linksTo ?? []).flatMap((s) =>
    itemsOf(handle.canvas, s).filter((t) => t.text.trim())
  );
  const verb = def.id === "eases" ? "Eases" : def.id === "adds" ? "Adds" : "For";
  const links = item.links ?? [];
  const labels = (def.linksTo ?? []).map((s) => sectionDef(format, s)?.label ?? s);
  if (targets.length === 0) {
    return <p className="text-xs text-sub">Add a line to “{labels.join("”, “")}” to link it.</p>;
  }
  const toggle = (id: string) => {
    const next = links.includes(id) ? links.filter((l) => l !== id) : [...links, id];
    const w = handle.write((c, now) => withItemPatch(c, item.id, { links: next }, now));
    if (w.ok)
      handle.log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, {
        canvasId: handle.canvas.id,
        field: "links",
      });
  };
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
      <legend className="mb-1 text-xs text-sub">{verb}:</legend>
      {targets.map((t) => (
        <label key={t.id} className="relative inline-flex max-w-full cursor-pointer">
          <input
            type="checkbox"
            checked={links.includes(t.id)}
            onChange={() => toggle(t.id)}
            className="peer sr-only"
          />
          <span className={cn(CHIP, "truncate")}>{shortText(t.text, 40)}</span>
        </label>
      ))}
    </fieldset>
  );
}

const TEST_LABEL: Record<string, string> = {
  drafted: "Drafted in the Hypothesis Tracker",
  running: "Being tested",
  validated: "Tested: it held",
  invalidated: "Tested: it didn't hold",
  inconclusive: "Tested: no clear answer",
};

/** How a sent line's test stands, linking to the tracker. */
export function TestChip({ test }: { test: LinkedTest }) {
  if (test.state === "none") return null;
  const label = test.state === "testing" ? TEST_LABEL[test.status] : TEST_LABEL[test.result];
  return (
    <Link
      href="/hypothesis-tracker"
      data-test-state={test.state === "testing" ? test.status : test.result}
      className="inline-flex min-touch-coarse items-center rounded-md border border-border px-2 py-1 text-xs text-sub hover:text-accent"
    >
      {label}
    </Link>
  );
}

/** A Lean UX hypothesis's picks, and whether its learn-first and test are there. */
function HypothesisParts({ canvas, item }: { canvas: ProductCanvas; item: ProductCanvasItem }) {
  const picks = hypothesisPicks(canvas, item);
  const learn = lineLinkedTo(canvas, "learn-first", item.id);
  const test = lineLinkedTo(canvas, "smallest-test", item.id);
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs text-sub" aria-label="Built from">
      {(
        [
          ["Outcome", picks.outcomes],
          ["User", picks.users],
          ["Benefit", picks.benefits],
          ["Solution", picks.solutions],
        ] as const
      ).map(([label, pick]) => (
        <li key={label} className="rounded-md border border-border px-2 py-0.5">
          {label}: {pick ? shortText(pick.text, 32) : "gone"}
        </li>
      ))}
      <li className="rounded-md border border-border px-2 py-0.5">
        {learn ? "Has a learn-first" : "No learn-first yet"}
      </li>
      <li className="rounded-md border border-border px-2 py-0.5">
        {test ? "Has a smallest test" : "No smallest test yet"}
      </li>
    </ul>
  );
}

export function CanvasBox({
  handle,
  def,
  className,
}: {
  handle: CanvasHandle;
  def: ProductSectionDef;
  className?: string;
}) {
  const { canvas, hypotheses, write, log } = handle;
  const items = itemsOf(canvas, def.id);
  const logBox = () =>
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, section: def.id });

  const onChange = (next: ProductCanvasItem[]): string | void => {
    if (def.id === "launch-date" && next[0]) {
      const v = validateLaunchDate(next[0].text, todayIso(), { typed: true });
      if (!v.ok) return v.errors.date;
    }
    const w = write((c, now) => withSectionItems(c, def.id, next, now));
    if (!w.ok) return w.message;
    logBox();
  };
  // A delete drops every link to the line it takes out (an ease's pain, a
  // hypothesis's picks, a test's hypothesis). The lines that held one are
  // kept here, by the deleted line's id, so its Undo links them again.
  const linkers = useRef(new Map<string, LinkerLine[]>());
  const update = (
    fn: (items: readonly ProductCanvasItem[]) => ProductCanvasItem[]
  ): string | void => {
    const memory = linkers.current;
    const w = write((c, now) => {
      const before = itemsOf(c, def.id);
      const next = fn(before);
      const kept = new Set(next.map((i) => i.id));
      for (const i of before) {
        if (kept.has(i.id)) continue;
        const lines = linkersOf(c, i.id);
        if (lines.length > 0) memory.set(i.id, lines);
      }
      const done = withSectionItems(c, def.id, next, now);
      if (!done.ok) return done;
      const had = new Set(before.map((i) => i.id));
      let canvas = done.canvas;
      for (const i of next) {
        const lines = had.has(i.id) ? undefined : memory.get(i.id);
        if (!lines) continue;
        memory.delete(i.id);
        const relinked = withLinksRestored(canvas, i.id, lines, now);
        if (relinked.ok) canvas = relinked.canvas;
      }
      return { ok: true, canvas };
    });
    if (!w.ok) return w.message;
    logBox();
  };

  const setLinks =
    (item: ProductCanvasItem, route: HandoffRouteId) =>
    (change: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      let before: HandoffLink | undefined;
      const w = write((c, now) => {
        const found = findItem(c, item.id);
        before = found?.item.sentTo?.find((l) => l.route === route);
        const patch: ItemPatch = { sentTo: change(found?.item.sentTo) };
        return withItemPatch(c, item.id, patch, now);
      });
      if (!w.ok) return;
      const after = findItem(w.canvas, item.id)?.item.sentTo?.find((l) => l.route === route);
      if (after && after.targetId !== before?.targetId) {
        log(PRODUCT_CANVAS_ACTIONS.ITEM_SENT, { canvasId: canvas.id, section: def.id, route });
      }
    };

  const renderExtras = (item: ProductCanvasItem) => {
    const test = linkedTest(item.sentTo, hypotheses);
    const parts = [
      def.evidence ? <EvidenceToggle key="evidence" handle={handle} item={item} /> : null,
      def.niceToHave ? <NiceToHaveToggle key="nice" handle={handle} item={item} /> : null,
      def.qa ? <AnswerField key="answer" handle={handle} item={item} /> : null,
      def.linksTo && def.id !== "hypotheses" ? (
        <LinkPicker key="links" handle={handle} def={def} item={item} />
      ) : null,
      def.id === "hypotheses" ? <HypothesisParts key="parts" canvas={canvas} item={item} /> : null,
      test.state !== "none" ? <TestChip key="test" test={test} /> : null,
    ].filter(Boolean);
    return parts.length > 0 ? <div className="space-y-2">{parts}</div> : null;
  };

  const freshLinks = (item: ProductCanvasItem) => () => {
    const fresh = handle.read();
    return fresh ? findItem(fresh, item.id)?.item.sentTo : undefined;
  };

  const renderActions = (item: ProductCanvasItem) => {
    if (def.niceToHave) {
      // A Shape Up scope: a piece of work for the backlog.
      return (
        <SendToMenu
          routes={["backlog-story"]}
          item={scopeSource(canvas, item)}
          sentTo={item.sentTo}
          itemLabels={{ "backlog-story": "Backlog story" }}
          getLinks={freshLinks(item)}
          onLinksChange={setLinks(item, "backlog-story")}
          disabled={!canSend(canvas, item)}
        />
      );
    }
    const hypothesis = def.id === "hypotheses";
    if (!hypothesis && !isGuess(def, item)) return null;
    const source = hypothesis
      ? leanUxHypothesisSource(canvas, item)
      : guessHypothesisSource(canvas, item);
    return (
      <SendToMenu
        routes={["hypothesis"]}
        item={source}
        sentTo={item.sentTo}
        itemLabels={{ hypothesis: hypothesis ? "Hypothesis to test" : "Test this guess" }}
        getLinks={freshLinks(item)}
        onLinksChange={setLinks(item, "hypothesis")}
        disabled={!canSend(canvas, item)}
      />
    );
  };

  /** A nice-to-have scope reads "~" before its words. */
  const itemLabel = def.niceToHave
    ? (item: ProductCanvasItem) =>
        item.niceToHave ? (
          <span className="font-mono text-sub" title="Nice to have">
            ~<span className="sr-only"> nice to have:</span>
          </span>
        ) : null
    : undefined;

  return (
    <SectionItemsCard<ProductCanvasItem>
      def={def}
      items={items}
      itemMax={textMaxOf(def)}
      onChange={onChange}
      update={update}
      makeItem={(text) => ({
        id: newItemId(),
        text,
        ...(def.evidence ? { evidence: "assumption" as const } : {}),
      })}
      renderExtras={renderExtras}
      renderActions={renderActions}
      itemLabel={itemLabel}
      className={className}
    />
  );
}
