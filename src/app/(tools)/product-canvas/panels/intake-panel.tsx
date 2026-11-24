"use client";

/**
 * An idea's own panel: where it stands in the inbox and what to do next.
 *
 * - How many asked for it and where it came from, and who asked.
 * - "Asked again": its demand goes up by one, and who asked joins the
 *   list when named.
 * - Triage: assess it, accept it, or decline it with a note saying why. An
 *   accepted idea is handed on from here, to the backlog and the
 *   Opportunity Tree, with its problem as the description and never who
 *   asked.
 * - Merge into another idea, with Undo: the demand and who asked move to
 *   the idea it repeats (following that one's merges to the root). Taking
 *   it out of the merge, with Undo, gives that demand back.
 *
 * Example ideas are never sent, merge only with other example ideas, and
 * aren't logged.
 */

import { useState } from "react";
import { Merge, Plus } from "lucide-react";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { SectionCard } from "@/components/shared/section-card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  IDEA_SOURCE_LABEL,
  IDEA_STATUS_LABEL,
  NOTE_MAX,
  REQUESTER_MAX,
} from "@/lib/product-canvas/fields";
import { ideasOf, isOpenIdea, mergeIdeas, rootOf, unmergeIdea } from "@/lib/product-canvas/intake";
import {
  withAskedAgain,
  withCanvasSentTo,
  withIdeaStatus,
  type TriageStatus,
} from "@/lib/product-canvas/model";
import { ideaSource } from "@/lib/product-canvas/sends";
import type { HandoffLink } from "@/lib/handoffs/types";
import { isExampleId } from "@/lib/utils/example-id";
import { undoable } from "@/lib/utils/undoable";
import { shortText, type CanvasHandle } from "../boxes";
import { SELECT_CLASS } from "../select-class";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function IntakePanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log, world, put, open } = handle;
  const intake = canvas.intake;
  const [requester, setRequester] = useState("");
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState(intake?.note ?? "");
  const [mergeInto, setMergeInto] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!intake) return null;
  const example = isExampleId(canvas.id);
  const ideas = ideasOf(world());
  const root = intake.status === "merged" ? rootOf(canvas.id, ideas) : null;
  // Ideas this one can go into: open ones whose merges don't lead back to it.
  const targets = ideas.filter(
    (c) => c.id !== canvas.id && isOpenIdea(c) && rootOf(c.id, ideas)?.id !== canvas.id
  );
  const sendable = !example && intake.status === "accepted" && Boolean(canvas.title.trim());

  const triage = (status: TriageStatus, typed?: string) => {
    const w = write((c, now) => withIdeaStatus(c, status, typed, now));
    if (!w.ok) {
      setProblem(w.message);
      return false;
    }
    setProblem(null);
    log(PRODUCT_CANVAS_ACTIONS.IDEA_TRIAGED, { canvasId: canvas.id, status });
    return true;
  };

  const askedAgain = () => {
    const w = write((c, now) => withAskedAgain(c, requester, now));
    if (!w.ok) {
      setProblem(w.message);
      return;
    }
    setProblem(null);
    setRequester("");
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, field: "demand" });
  };

  const merge = () => {
    const all = world();
    const into = all.find((c) => c.id === mergeInto);
    const me = all.find((c) => c.id === canvas.id);
    if (!into || !me) return;
    const m = mergeIdeas(me, into, all, new Date().toISOString());
    if (!m.ok) {
      setProblem(m.message);
      return;
    }
    setProblem(null);
    const saved = [me, all.find((c) => c.id === m.root.id) ?? m.root];
    undoable({
      label: `Merged “${shortText(canvas.title)}” into “${shortText(m.root.title)}”`,
      apply: () => {
        put([m.root, m.duplicate]);
        log(PRODUCT_CANVAS_ACTIONS.IDEAS_MERGED, { canvasId: m.root.id, merged: 1 });
      },
      revert: () => put(saved),
    });
    setMergeInto("");
  };

  /** Out of its merge, back to assessing: the ideas it went into give its asks back. */
  const unmerge = () => {
    const all = world();
    const me = all.find((c) => c.id === canvas.id);
    if (!me) return;
    const u = unmergeIdea(me, "assessing", undefined, all, new Date().toISOString());
    if (!u.ok) {
      setProblem(u.message);
      return;
    }
    setProblem(null);
    const saved = [me, ...u.carriers.map((c) => all.find((x) => x.id === c.id) ?? c)];
    undoable({
      label: `Took “${shortText(canvas.title)}” out of the merge`,
      apply: () => {
        put([u.duplicate, ...u.carriers]);
        log(PRODUCT_CANVAS_ACTIONS.IDEA_TRIAGED, { canvasId: canvas.id, status: "assessing" });
      },
      revert: () => put(saved),
    });
  };

  const setLinks = (change: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
    let before: readonly HandoffLink[] | undefined;
    const w = write((c, now) => {
      before = c.sentTo;
      return withCanvasSentTo(c, change(c.sentTo), now);
    });
    if (!w.ok) return;
    for (const link of w.canvas.sentTo ?? []) {
      if (!before?.some((b) => b.route === link.route && b.targetId === link.targetId)) {
        log(PRODUCT_CANVAS_ACTIONS.ITEM_SENT, { canvasId: canvas.id, route: link.route });
      }
    }
  };

  return (
    <SectionCard title="In the inbox" contentClassName="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-text" data-field="intake-line">
          <span className="font-medium">{IDEA_STATUS_LABEL[intake.status]}</span>
          {" · "}asked for {plural(intake.demand, "time")}
          {" · "}from {IDEA_SOURCE_LABEL[intake.source].toLowerCase()}
        </p>
        {intake.requesters.length > 0 ? (
          <p className="break-words text-xs text-sub">Who asked: {intake.requesters.join(", ")}</p>
        ) : (
          <p className="text-xs text-sub">Nobody named yet.</p>
        )}
        {intake.note && <p className="break-words text-xs text-sub">Note: {intake.note}</p>}
      </div>

      {intake.status === "merged" ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm text-text">
            {root ? (
              <>
                Merged into{" "}
                <button
                  type="button"
                  onClick={() => open(root.id)}
                  className="font-medium text-accent underline underline-offset-2"
                >
                  {root.title}
                </button>
                : its asks count there.
              </>
            ) : (
              "Merged into an idea that isn't here any more."
            )}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={unmerge}>
            Take it out of the merge
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Who asked again" hint="Optional." className="min-w-0 flex-1 basis-48">
              {(props) => (
                <Input
                  {...props}
                  value={requester}
                  maxLength={REQUESTER_MAX}
                  placeholder="Support inbox"
                  onChange={(e) => setRequester(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      askedAgain();
                    }
                  }}
                />
              )}
            </Field>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={askedAgain}
              className="gap-1.5"
            >
              <Plus aria-hidden="true" />
              Asked again
            </Button>
          </div>

          <div role="group" aria-label="Triage" className="flex flex-wrap gap-2">
            {intake.status !== "assessing" && (
              <Button type="button" size="sm" variant="outline" onClick={() => triage("assessing")}>
                {intake.status === "new" ? "Assess it" : "Back to assessing"}
              </Button>
            )}
            {intake.status !== "accepted" && (
              <Button type="button" size="sm" variant="toolkit" onClick={() => triage("accepted")}>
                Accept
              </Button>
            )}
            {intake.status !== "declined" && !declining && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNote(intake.note ?? "");
                  setDeclining(true);
                }}
              >
                Decline…
              </Button>
            )}
            {intake.status !== "new" && (
              <Button type="button" size="sm" variant="ghost" onClick={() => triage("new")}>
                Back to new
              </Button>
            )}
          </div>

          {declining && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Field label="Why not" hint="Whoever asks again gets this answer." required>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={note}
                    maxLength={NOTE_MAX}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="toolkit"
                  onClick={() => {
                    if (triage("declined", note)) setDeclining(false);
                  }}
                >
                  Decline the idea
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {intake.status === "accepted" && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-sub">Hand it on:</p>
              <SendToMenu
                routes={["backlog-story", "opportunity"]}
                item={ideaSource(canvas)}
                sentTo={canvas.sentTo}
                itemLabels={{ "backlog-story": "Backlog story", opportunity: "Opportunity" }}
                getLinks={() => handle.read()?.sentTo}
                onLinksChange={setLinks}
                disabled={!sendable}
              />
            </div>
          )}

          {targets.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="A repeat of" className="min-w-0 flex-1 basis-48">
                {(props) => (
                  <select
                    {...props}
                    className={SELECT_CLASS}
                    value={mergeInto}
                    onChange={(e) => setMergeInto(e.target.value)}
                  >
                    <option value="">Pick the idea it repeats</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {shortText(t.title, 60)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!mergeInto}
                onClick={merge}
                className="gap-1.5"
              >
                <Merge aria-hidden="true" />
                Merge
              </Button>
            </div>
          )}
        </>
      )}

      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </SectionCard>
  );
}
