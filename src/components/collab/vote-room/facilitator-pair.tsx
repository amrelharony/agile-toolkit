"use client";

/**
 * A pair round (Kano) without a live room: collect paper answers and enter,
 * per item, how many people gave each pair of answers. One P × P grid per
 * item (rows: the answer to the first question, columns: to the second),
 * where each paper answer pair is one tick in one box.
 *
 * Same aggregate code as a live round (`foldPairCounts` over the scale
 * fold), same minN rule (never under the tool's floor) and the same
 * `onSave`, with `source: "facilitator"`. Only counts are entered, never who
 * answered what. A blank box counts as nobody; text a number box can't read
 * is refused, not read as blank. Once a round is saved its boxes lock until
 * "Enter another round" (or Undo).
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Calculator, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { focusFirstInvalid } from "@/lib/utils/form";
import { effectiveMinN } from "@/lib/realtime/vote-room/aggregate";
import {
  emptyPairTally,
  foldPairCounts,
  jointIndex,
  revealPairs,
  toPairResult,
  type PairRoundResult,
  type PairSheet,
} from "@/lib/realtime/vote-room/pair";
import { VOTE_LIMITS, type PairRoomTool } from "@/lib/realtime/vote-room/protocol";
import { PairResults } from "./pair-results";
import { useSaveRound, type SavePairRound } from "./save-round";

export interface FacilitatorPairProps {
  tool: PairRoomTool;
  sheet: PairSheet;
  /** Never below the tool's floor (`voteMinNFloor`), which is also the default. */
  minN?: number;
  /**
   * Totals only, once per round. Return an undo to get Undo in the kit's
   * toast, or false when nothing was stored (the boxes stay open).
   */
  onSave: SavePairRound;
  /** Shown under the results, before Save round (Kano: each feature's category). */
  renderResults?: (result: PairRoundResult) => ReactNode;
}

type Cells = Record<string, string[]>;

const WHOLE_RE = /^\d+$/;
const COUNT_ERROR = "Enter whole numbers, 0 or more, in every box.";

function blankCells(sheet: PairSheet): Cells {
  const width = sheet.answers.length * sheet.answers.length;
  return Object.fromEntries(sheet.items.map((x) => [x.id, new Array<string>(width).fill("")]));
}

export function FacilitatorPair({
  tool,
  sheet,
  minN,
  onSave,
  renderResults,
}: FacilitatorPairProps) {
  const need = effectiveMinN(minN, tool);
  const points = sheet.answers.length;
  const [cells, setCells] = useState<Cells>(() => blankCells(sheet));
  /** Item id → the boxes (joint indexes) that can't be read. */
  const [bad, setBad] = useState<Record<string, number[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<PairRoundResult | null>(null);
  const [focusPending, setFocusPending] = useState(false);
  const { save, isSaved } = useSaveRound(onSave);
  const formRef = useRef<HTMLFormElement>(null);
  const saved = isSaved(result?.roundId);

  const signature = `${sheet.id}|${sheet.answers.join("|")}|${sheet.items.map((x) => x.id).join("|")}`;
  useEffect(() => {
    setCells(blankCells(sheet));
    setBad({});
    setFormError(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  const setCell = (itemId: string, j: number, value: string) => {
    if (saved) return;
    setCells((c) => ({ ...c, [itemId]: c[itemId].map((v, k) => (k === j ? value : v)) }));
    setBad((b) => {
      if (!b[itemId]?.includes(j)) return b;
      return { ...b, [itemId]: b[itemId].filter((k) => k !== j) };
    });
    // Changed counts: the totals shown are stale.
    setResult(null);
    setFormError(null);
  };

  const showTotals = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saved) return;
    // A number box reports text it can't read ("5a") as "": ask the box itself.
    const unreadable = new Set<string>();
    formRef.current?.querySelectorAll<HTMLInputElement>("input[data-pair-cell]").forEach((el) => {
      if (el.validity?.badInput === true && el.dataset.pairCell)
        unreadable.add(el.dataset.pairCell);
    });
    const nextBad: Record<string, number[]> = {};
    let overCap = false;
    const joints = sheet.items.map((item) =>
      (cells[item.id] ?? []).map((raw, j) => {
        const trimmed = raw.trim();
        if (unreadable.has(`${item.id}:${j}`) || (trimmed !== "" && !WHOLE_RE.test(trimmed))) {
          nextBad[item.id] = [...(nextBad[item.id] ?? []), j];
          return 0;
        }
        const n = trimmed === "" ? 0 : Number(trimmed);
        if (n > VOTE_LIMITS.maxTallyBallots) overCap = true;
        return n;
      })
    );
    setBad(nextBad);
    if (Object.keys(nextBad).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return;
    }
    // People who answered: the item with the most answer pairs.
    const ballots = Math.max(0, ...joints.map((row) => row.reduce((a, b) => a + b, 0)));
    const tally = overCap
      ? null
      : foldPairCounts(emptyPairTally("facilitator", sheet), joints, ballots);
    if (!tally) {
      setFormError(`Enter at most ${VOTE_LIMITS.maxTallyBallots} people.`);
      return;
    }
    if (tally.ballots < need) {
      setFormError(
        `Results show from ${need} answers, so small groups' answers stay hidden. You've entered ${tally.ballots}.`
      );
      return;
    }
    setFormError(null);
    setResult(
      toPairResult(sheet, revealPairs(tally, need), {
        tool,
        roundId: `tally-${Date.now().toString(36)}`,
        closedAt: new Date().toISOString(),
        minN: need,
        ballots: tally.ballots,
        source: "facilitator",
      })
    );
  };

  const startOver = () => {
    setCells(blankCells(sheet));
    setBad({});
    setFormError(null);
    setResult(null);
  };

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={showTotals} noValidate className="space-y-4">
        <p className="text-sm text-sub">
          Collect paper answers, then for each item count how many people gave each pair of answers:
          the row is the answer to &ldquo;{sheet.prompts.first}&rdquo;, the column the answer to
          &ldquo;{sheet.prompts.second}&rdquo;. A blank box counts as nobody. Results show from{" "}
          {need} answers.
        </p>
        <ol className="space-y-3">
          {sheet.items.map((item, i) => (
            <li key={item.id}>
              <fieldset
                className="space-y-2 rounded-lg border border-border bg-card p-3"
                disabled={saved}
              >
                <legend className="px-1 text-sm font-medium text-text">
                  {i + 1}. {item.text}
                  {/* A real space, so the group's name reads "… (optional)". */}
                  {item.optional === true && (
                    <>
                      {" "}
                      <span className="text-xs text-sub">(optional)</span>
                    </>
                  )}
                </legend>
                <div className="scroll-x-snap">
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th scope="col" className="py-1 pr-2 text-left font-medium text-sub">
                          First ↓, second →
                        </th>
                        {sheet.answers.map((b) => (
                          <th
                            key={b}
                            scope="col"
                            className="px-1 py-1 text-center font-medium text-sub"
                          >
                            {b}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.answers.map((a, f) => (
                        <tr key={a}>
                          <th scope="row" className="py-1 pr-2 text-left font-normal text-sub">
                            {a}
                          </th>
                          {sheet.answers.map((b, g) => {
                            const j = jointIndex(f, g, points);
                            const invalid = bad[item.id]?.includes(j) === true;
                            return (
                              <td key={b} className="px-1 py-1">
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={VOTE_LIMITS.maxTallyBallots}
                                  step={1}
                                  className="w-16"
                                  aria-label={`${item.text}: ${a}, then ${b}`}
                                  aria-invalid={invalid || undefined}
                                  data-pair-cell={`${item.id}:${j}`}
                                  value={cells[item.id]?.[j] ?? ""}
                                  onChange={(e) => setCell(item.id, j, e.target.value)}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bad[item.id]?.length ? (
                  <p className="text-xs text-danger" role="alert">
                    {COUNT_ERROR}
                  </p>
                ) : null}
              </fieldset>
            </li>
          ))}
        </ol>
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        {saved ? (
          <p className="text-sm text-sub">
            This round is saved. Enter another round to type new counts.
          </p>
        ) : (
          <Button type="submit" variant="toolkit" className="gap-1.5">
            <Calculator className="h-4 w-4" aria-hidden="true" />
            Show totals
          </Button>
        )}
      </form>

      {result && (
        <div className="space-y-3">
          <PairResults
            sheet={sheet}
            revealed={result.items.map((x) => ({ responses: x.responses, joint: x.joint }))}
            minN={result.minN}
            ballots={result.ballots}
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
              <Button type="button" variant="outline" className="gap-1.5" onClick={startOver}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Enter another round
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
