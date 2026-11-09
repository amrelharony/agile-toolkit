"use client";

/**
 * An allocation round without a live room (Buy-a-Feature, the $100 Test):
 * for when live rounds are off (flag off, no Supabase, no WebCrypto, a
 * squad guest, a sheet the protocol can't carry) or not wanted. Two ways
 * in:
 *
 *  - "Paper splits": type one person's split from their paper and press
 *    Add split. It is folded into the totals through the same
 *    `addAllocation` a live round uses and the boxes clear, so the spread
 *    shows from 5 splits as it would live. Only the totals before the last
 *    split are kept, for "Undo last split".
 *  - "Totals only": type each item's total and how many people split the
 *    budget (`foldAllocationTotals`). The spread is then unknown, and the
 *    saved result says so (`spreadKnown: false`).
 *
 * Same minN rule (never under the tool's floor), same reveal rules and the
 * same `onSave` as a live round, with `source: "facilitator"`. Nothing per
 * person is saved. Once a round is saved its boxes lock until "Enter
 * another round" (or Undo), so an edit can't quietly become a second round.
 *
 * Nothing typed is dropped quietly: Show totals adds a split still in the
 * boxes first (or says why it can't), typing hides results that no longer
 * match, and switching between the two ways in asks first when it would
 * discard splits or totals. A sheet that can't be counted at all
 * (`allocationCountProblem`, e.g. a budget under 10) gets its reason
 * instead of the boxes.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Calculator, Check, Plus, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { focusFirstInvalid } from "@/lib/utils/form";
import { effectiveMinN } from "@/lib/realtime/vote-room/aggregate";
import {
  addAllocation,
  allocationAmount,
  allocationCountProblem,
  allocationDraftProblem,
  allocationItemMax,
  emptyAllocationTally,
  foldAllocationTotals,
  revealAllocation,
  toAllocationResult,
  type AllocationDraft,
  type AllocationRoundResult,
  type AllocationSheet,
  type AllocationTally,
} from "@/lib/realtime/vote-room/allocation";
import { VOTE_LIMITS, type AllocationRoomTool } from "@/lib/realtime/vote-room/protocol";
import { AllocationResults } from "./allocation-results";
import { announceToolMoment } from "@/lib/agent/mascot/tool-moments";
import { useSaveRound, type SaveAllocationRound } from "./save-round";

export interface FacilitatorAllocationProps {
  tool: AllocationRoomTool;
  sheet: AllocationSheet;
  /** Never below the tool's floor (`voteMinNFloor`), which is also the default. */
  minN?: number;
  /**
   * Totals only, once per round. Return an undo to get Undo in the kit's
   * toast, or false when nothing was stored (the round stays open).
   */
  onSave: SaveAllocationRound;
  /** Shown under the results, before Save round (e.g. what the tool will do with them). */
  renderResults?: (result: AllocationRoundResult) => ReactNode;
}

type Mode = "splits" | "totals";

const WHOLE_RE = /^\d+$/;
const NOT_WHOLE = "Enter a whole number, 0 or more.";

function blankBoxes(sheet: AllocationSheet): Record<string, string> {
  return Object.fromEntries(sheet.items.map((x) => [x.id, ""]));
}

/** Whether any box holds something (a split or totals not counted yet). */
function anyTyped(boxes: Record<string, string>): boolean {
  return Object.values(boxes).some((v) => v.trim() !== "");
}

const MODE_NAME: Record<Mode, string> = { splits: "Paper splits", totals: "Totals only" };

/** Box ids whose number input holds text it can't read ("5a"): not blank, not 0. */
function unreadableBoxes(root: HTMLElement | null, attr: string): Set<string> {
  const out = new Set<string>();
  root?.querySelectorAll<HTMLInputElement>(`input[${attr}]`).forEach((el) => {
    const id = el.getAttribute(attr);
    if (el.validity?.badInput === true && id) out.add(id);
  });
  return out;
}

/** Blank is 0, digits are the number, anything else is null. */
function readBox(raw: string | undefined): number | null {
  const t = (raw ?? "").trim();
  if (t === "") return 0;
  return WHOLE_RE.test(t) ? Number(t) : null;
}

export function FacilitatorAllocation({
  tool,
  sheet,
  minN,
  onSave,
  renderResults,
}: FacilitatorAllocationProps) {
  const need = effectiveMinN(minN, tool);
  const spreadNeed = Math.max(need, VOTE_LIMITS.minNSpread);
  const money = (n: number) => allocationAmount(n, sheet.unit);
  const announce = useAnnounce();
  const modeId = useId();
  const [mode, setMode] = useState<Mode>("splits");
  const [boxes, setBoxes] = useState<Record<string, string>>(() => blankBoxes(sheet));
  const [people, setPeople] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tally, setTally] = useState<AllocationTally>(() =>
    emptyAllocationTally("facilitator", sheet)
  );
  const [previous, setPrevious] = useState<AllocationTally | null>(null);
  const [result, setResult] = useState<AllocationRoundResult | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  /** The way in the host asked for, while "discard what's typed?" is open. */
  const [switchTo, setSwitchTo] = useState<Mode | null>(null);
  const { save, isSaved } = useSaveRound(onSave);
  const formRef = useRef<HTMLFormElement>(null);
  const saved = isSaved(result?.roundId);

  const reset = () => {
    setBoxes(blankBoxes(sheet));
    setPeople("");
    setErrors({});
    setFormError(null);
    setTally(emptyAllocationTally("facilitator", sheet));
    setPrevious(null);
    setResult(null);
  };

  // A new sheet starts a new round.
  const signature = `${sheet.id}|${sheet.budget}|${sheet.spendAll}|${sheet.items.map((x) => `${x.id}:${x.cap ?? ""}`).join("|")}`;
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });

  const setBox = (id: string, value: string) => {
    if (saved) return;
    setBoxes((b) => ({ ...b, [id]: value }));
    clearError(id);
    setFormError(null);
    // Results shown no longer match what's typed, so they can't be saved as they are.
    setResult(null);
  };

  /** What switching the way in would discard, in one sentence; null when nothing. */
  const discardText = (): string | null => {
    if (mode === "splits" && tally.ballots > 0) {
      const n = tally.ballots;
      const typed = anyTyped(boxes) ? ", and so is the split in the boxes" : "";
      return n === 1
        ? `The split added so far is discarded${typed}.`
        : `The ${n} splits added so far are discarded${typed}.`;
    }
    if (mode === "splits") return anyTyped(boxes) ? "The split in the boxes is cleared." : null;
    return anyTyped(boxes) || people.trim() !== "" ? "The totals typed so far are cleared." : null;
  };

  const applyMode = (next: Mode) => {
    setMode(next);
    reset();
  };

  // Switching starts the entry over: ask first when that would discard work.
  const switchMode = (next: Mode) => {
    if (saved || next === mode) return;
    if (discardText()) setSwitchTo(next);
    else applyMode(next);
  };

  /** The boxes as whole amounts, or null after marking the ones that aren't. */
  const readBoxes = (): number[] | null => {
    const unreadable = unreadableBoxes(formRef.current, "data-allocation-box");
    const nextErrors: Record<string, string> = {};
    const amounts = sheet.items.map((item) => {
      const n = unreadable.has(item.id) ? null : readBox(boxes[item.id]);
      if (n === null) nextErrors[item.id] = NOT_WHOLE;
      return n ?? 0;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return null;
    }
    return amounts;
  };

  /** Add the split in the boxes: the new tally, or null (and why, on screen) when it isn't added. */
  const addSplit = (): AllocationTally | null => {
    const amounts = readBoxes();
    if (!amounts) return null;
    const draft: AllocationDraft = Object.fromEntries(
      sheet.items.map((x, i) => [x.id, amounts[i]])
    );
    const problem = allocationDraftProblem(draft, sheet);
    if (problem) {
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (problem.itemId) {
        const item = sheet.items.find((x) => x.id === problem.itemId);
        // The limit the box's hint names: its cap, or the budget when that is lower.
        setErrors({
          [problem.itemId]:
            item?.cap !== undefined
              ? `At most ${money(allocationItemMax(item, sheet.budget))} on this one.`
              : `That's more than ${money(sheet.budget)}.`,
        });
        setFocusPending(true);
        return null;
      }
      setFormError(
        problem.problem === "empty"
          ? "This split gives nothing: type at least one amount."
          : problem.problem === "under-budget"
            ? `A split gives out all ${money(sheet.budget)}: this one is ${money(sheet.budget - sum)} short.`
            : `This split gives ${money(sum)}, ${money(sum - sheet.budget)} more than ${money(sheet.budget)}.`
      );
      return null;
    }
    const next = addAllocation(tally, amounts, sheet);
    if (!next) {
      setFormError(`Enter at most ${VOTE_LIMITS.maxTallyBallots} splits.`);
      return null;
    }
    setPrevious(tally);
    setTally(next);
    setBoxes(blankBoxes(sheet));
    setResult(null);
    setFormError(null);
    announce(`Split ${next.ballots} added. Its amounts are cleared; only the totals are kept.`);
    return next;
  };

  const undoSplit = () => {
    if (!previous || saved) return;
    setTally(previous);
    setPrevious(null);
    setResult(null);
    setFormError(null);
    announce(`Last split taken out. ${previous.ballots} left.`);
  };

  const showFrom = (t: AllocationTally) => {
    const revealed = revealAllocation(t, need);
    const next = revealed
      ? toAllocationResult(sheet, revealed, {
          tool,
          roundId: `tally-${Date.now().toString(36)}`,
          closedAt: new Date().toISOString(),
          minN: need,
          ballots: t.ballots,
          source: "facilitator",
          spreadKnown: t.spreadKnown,
        })
      : null;
    if (!next) {
      setFormError(
        `Results show from ${need} people, so small groups' splits stay hidden. You've entered ${t.ballots}.`
      );
      return;
    }
    setFormError(null);
    setResult(next);
    announceToolMoment(tool, "round_revealed");
  };

  /** Totals only: why these totals can't come from `n` valid splits (on an item, or overall), or null. */
  const totalsProblem = (
    totals: number[],
    n: number
  ): { itemId?: string; message: string } | null => {
    for (let i = 0; i < totals.length; i++) {
      const max = n * allocationItemMax(sheet.items[i], sheet.budget);
      if (totals[i] > max) {
        return { itemId: sheet.items[i].id, message: `At most ${money(max)} from ${n} people.` };
      }
    }
    const sum = totals.reduce((a, b) => a + b, 0);
    if (sheet.spendAll && sum !== n * sheet.budget) {
      return {
        message: `Everyone gives out all ${money(sheet.budget)}, so the totals add up to ${money(n * sheet.budget)} for ${n} people. These add up to ${money(sum)}.`,
      };
    }
    if (sum > n * sheet.budget) {
      return {
        message: `The totals add up to ${money(sum)}, more than ${n} people × ${money(sheet.budget)}.`,
      };
    }
    if (sum < n) {
      return { message: `Everyone gave something, so the totals add up to at least ${money(n)}.` };
    }
    return null;
  };

  const showTotals = () => {
    if (mode === "splits") {
      // A split still in the boxes is the last paper: count it first, or say why it can't be.
      // A box holding text it can't read ("5a") is blank to React, so ask the boxes too.
      if (anyTyped(boxes) || unreadableBoxes(formRef.current, "data-allocation-box").size > 0) {
        const next = addSplit();
        if (next) showFrom(next);
        return;
      }
      showFrom(tally);
      return;
    }
    const amounts = readBoxes();
    const n = readBox(people);
    if (!amounts) return;
    if (n === null || n < 1) {
      setErrors({ people: "Enter how many people split the budget: a whole number, 1 or more." });
      setFocusPending(true);
      return;
    }
    if (n > VOTE_LIMITS.maxTallyBallots) {
      setErrors({ people: `At most ${VOTE_LIMITS.maxTallyBallots}.` });
      setFocusPending(true);
      return;
    }
    if (n < need) {
      setFormError(
        `Results show from ${need} people, so small groups' splits stay hidden. You've entered ${n}.`
      );
      return;
    }
    const problem = totalsProblem(amounts, n);
    if (problem?.itemId) {
      setErrors({ [problem.itemId]: problem.message });
      setFormError(null);
      setFocusPending(true);
      return;
    }
    if (problem) {
      setFormError(problem.message);
      return;
    }
    const folded = foldAllocationTotals(
      emptyAllocationTally("facilitator", sheet),
      amounts,
      n,
      sheet
    );
    if (!folded) {
      setFormError("These totals can't come from that many splits. Check them.");
      return;
    }
    showFrom(folded);
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saved) return;
    // Enter in a paper split's box adds the split; in totals mode it shows the totals.
    if (mode === "splits") addSplit();
    else showTotals();
  };

  // Checked after every hook: a sheet the counting can't use gets its reason, never boxes.
  const countProblem = allocationCountProblem(sheet);
  if (countProblem) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
        These splits can&apos;t be counted: {countProblem}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-labelledby={modeId} className="flex flex-wrap items-center gap-2">
        <span id={modeId} className="text-sm text-sub">
          Enter:
        </span>
        <Button
          type="button"
          size="sm"
          variant={mode === "splits" ? "toolkit" : "outline"}
          aria-pressed={mode === "splits"}
          disabled={saved}
          onClick={() => switchMode("splits")}
        >
          Paper splits
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "totals" ? "toolkit" : "outline"}
          aria-pressed={mode === "totals"}
          disabled={saved}
          onClick={() => switchMode("totals")}
        >
          Totals only
        </Button>
      </div>

      <form ref={formRef} onSubmit={onFormSubmit} noValidate className="space-y-4">
        <p className="text-sm text-sub">
          {mode === "splits"
            ? `Type one person's split from their paper, then Add split: it is added to the totals and cleared. A blank box is ${money(0)}. Results show from ${need} splits, and how the amounts were spread from ${spreadNeed}.`
            : `Type what each item got in all, and how many people split ${money(sheet.budget)} each. A blank box is ${money(0)}. Results show from ${need} people; with totals only, how the amounts were spread isn't known.`}
        </p>
        <fieldset disabled={saved} className="min-w-0 space-y-3">
          <legend className="sr-only">
            {mode === "splits" ? "One person's split" : "Each item's total"}
          </legend>
          <ol className="grid gap-3 sm:grid-cols-2">
            {sheet.items.map((item, i) => (
              <li key={item.id} className="rounded-lg border border-border bg-card p-3">
                <Field
                  label={`${i + 1}. ${item.text}`}
                  hint={
                    item.cap !== undefined && mode === "splits"
                      ? `At most ${money(allocationItemMax(item, sheet.budget))}.`
                      : undefined
                  }
                  error={errors[item.id]}
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      data-allocation-box={item.id}
                      value={boxes[item.id] ?? ""}
                      onChange={(e) => setBox(item.id, e.target.value)}
                    />
                  )}
                </Field>
              </li>
            ))}
          </ol>
          {mode === "totals" && (
            <Field label="People who split the budget" error={errors.people} className="max-w-xs">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={VOTE_LIMITS.maxTallyBallots}
                  step={1}
                  data-allocation-box="people"
                  value={people}
                  onChange={(e) => {
                    if (saved) return;
                    setPeople(e.target.value);
                    clearError("people");
                    setFormError(null);
                    setResult(null);
                  }}
                />
              )}
            </Field>
          )}
        </fieldset>

        {/* Not a live region: Add split and Undo announce the change themselves. */}
        {mode === "splits" && (
          <p className="text-sm text-text">
            {tally.ballots === 0
              ? "No splits added yet."
              : `${tally.ballots} ${tally.ballots === 1 ? "split" : "splits"} added.`}
          </p>
        )}
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        {saved ? (
          <p className="text-sm text-sub">
            This round is saved. Enter another round to type new splits.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mode === "splits" && (
              <>
                <Button type="submit" variant="outline" className="gap-1.5">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add split
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={undoSplit}
                  disabled={!previous}
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  Undo last split
                </Button>
              </>
            )}
            <Button
              type={mode === "totals" ? "submit" : "button"}
              variant="toolkit"
              className="gap-1.5"
              onClick={mode === "splits" ? showTotals : undefined}
            >
              <Calculator className="h-4 w-4" aria-hidden="true" />
              Show totals
            </Button>
          </div>
        )}
      </form>

      {result && (
        <div className="space-y-3">
          <AllocationResults
            sheet={sheet}
            revealed={result.items.map((x) => ({
              total: x.total,
              backers: x.backers,
              bands: x.bands,
            }))}
            minN={result.minN}
            ballots={result.ballots}
            spreadKnown={result.spreadKnown}
          />
          {renderResults?.(result)}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={() => save(result)}
              disabled={saved}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saved ? "Round saved" : "Save round"}
            </Button>
            {saved && (
              <Button type="button" variant="outline" className="gap-1.5" onClick={reset}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Enter another round
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={switchTo !== null}
        onOpenChange={(open) => {
          if (!open) setSwitchTo(null);
        }}
        title={`Switch to ${MODE_NAME[switchTo ?? "totals"]}?`}
        description={discardText() ?? undefined}
        confirmLabel="Switch"
        onConfirm={() => {
          if (switchTo) applyMode(switchTo);
          setSwitchTo(null);
        }}
      />
    </div>
  );
}
