"use client";

/**
 * Count hands, or collect paper answers, and enter the totals: the vote
 * round for when live rooms are off (flag off, no Supabase, no WebCrypto,
 * a squad guest) or not wanted.
 *
 * Same aggregate code, same minN rule and the same `onSave` as a live
 * round, with `source: "facilitator"`. Only counts are entered, never who
 * gave which answer. A blank box counts as nobody.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Calculator, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { focusFirstInvalid } from "@/lib/utils/form";
import {
  effectiveMinN,
  emptyTally,
  foldCounts,
  revealTally,
  toRoundResult,
  type VoteRoundResult,
} from "@/lib/realtime/vote-room/aggregate";
import {
  VOTE_LIMITS,
  type Questionnaire,
  type VoteRoomTool,
} from "@/lib/realtime/vote-room/protocol";
import { VoteResults } from "./vote-results";

export interface FacilitatorTallyProps {
  tool: VoteRoomTool;
  questionnaire: Questionnaire;
  minN?: number;
  onSave: (result: VoteRoundResult) => void;
}

type Cells = Record<string, string[]>;

function blankCells(q: Questionnaire): Cells {
  return Object.fromEntries(q.questions.map((x) => [x.id, q.scale.points.map(() => "")]));
}

const COUNT_ERROR = "Enter a whole number, 0 or more.";

export function FacilitatorTally({ tool, questionnaire, minN, onSave }: FacilitatorTallyProps) {
  const need = effectiveMinN(minN);
  const [cells, setCells] = useState<Cells>(() => blankCells(questionnaire));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<VoteRoundResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [focusPending, setFocusPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const signature = questionnaire.id + questionnaire.questions.map((x) => x.id).join("|");
  useEffect(() => {
    setCells(blankCells(questionnaire));
    setErrors({});
    setFormError(null);
    setResult(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    if (!focusPending) return;
    setFocusPending(false);
    focusFirstInvalid(formRef.current);
  }, [focusPending]);

  const cellKey = (qid: string, i: number) => `${qid}:${i}`;

  const setCell = (qid: string, i: number, value: string) => {
    setCells((c) => ({ ...c, [qid]: c[qid].map((v, j) => (j === i ? value : v)) }));
    setErrors((e) => {
      if (!e[cellKey(qid, i)]) return e;
      const next = { ...e };
      delete next[cellKey(qid, i)];
      return next;
    });
    // Changed counts: the totals shown are stale.
    setResult(null);
    setSaved(false);
    setFormError(null);
  };

  const showTotals = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    const counts: number[][] = [];
    for (const q of questionnaire.questions) {
      const row: number[] = [];
      (cells[q.id] ?? []).forEach((raw, i) => {
        const trimmed = raw.trim();
        const n = trimmed === "" ? 0 : Number(trimmed);
        if (!Number.isInteger(n) || n < 0 || n > VOTE_LIMITS.maxTallyBallots) {
          nextErrors[cellKey(q.id, i)] = COUNT_ERROR;
        }
        row.push(Number.isInteger(n) && n >= 0 ? n : 0);
      });
      counts.push(row);
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError(null);
      setFocusPending(true);
      return;
    }
    // People who answered: the question with the most answers.
    const ballots = Math.max(0, ...counts.map((row) => row.reduce((a, b) => a + b, 0)));
    const tally = foldCounts(emptyTally("facilitator", questionnaire), counts, ballots);
    if (!tally) {
      setFormError(`Enter at most ${VOTE_LIMITS.maxTallyBallots} people.`);
      return;
    }
    if (tally.ballots < need) {
      setFormError(
        `Results show from ${need} answers, so nobody's answer can be picked out. You've entered ${tally.ballots}.`
      );
      return;
    }
    setFormError(null);
    setResult(
      toRoundResult(questionnaire, revealTally(tally, need), {
        tool,
        roundId: `tally-${Date.now().toString(36)}`,
        closedAt: new Date().toISOString(),
        minN: need,
        ballots: tally.ballots,
        source: "facilitator",
      })
    );
  };

  const save = () => {
    if (!result || saved) return;
    setSaved(true);
    onSave(result);
  };

  const startOver = () => {
    setCells(blankCells(questionnaire));
    setErrors({});
    setFormError(null);
    setResult(null);
    setSaved(false);
  };

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={showTotals} noValidate className="space-y-4">
        <p className="text-sm text-sub">
          Count hands or collect paper answers, then enter how many people chose each answer. A
          blank box counts as nobody. Results show from {need} answers.
        </p>
        <ol className="space-y-3">
          {questionnaire.questions.map((q, qi) => (
            <li key={q.id}>
              <fieldset className="rounded-lg border border-border bg-card p-3">
                <legend className="px-1 text-sm font-medium text-text">
                  {qi + 1}. {q.text}
                  {q.optional === true && <span className="ml-1 text-xs text-sub">(optional)</span>}
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                  {questionnaire.scale.points.map((p, i) => (
                    <Field key={p.value} label={p.label} error={errors[cellKey(q.id, i)]}>
                      {(props) => (
                        <Input
                          {...props}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={cells[q.id]?.[i] ?? ""}
                          onChange={(e) => setCell(q.id, i, e.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        {formError && (
          <p className="text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <Button type="submit" variant="toolkit" className="gap-1.5">
          <Calculator className="h-4 w-4" aria-hidden="true" />
          Show totals
        </Button>
      </form>

      {result && (
        <div className="space-y-3">
          <VoteResults
            questionnaire={questionnaire}
            revealed={result.questions.map((x) => ({
              responses: x.responses,
              distribution: x.distribution,
            }))}
            minN={result.minN}
            ballots={result.ballots}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={save}
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
