"use client";

/**
 * Quick answers with no list at all: dice (one to six, four to twenty
 * sides), a coin, yes or no, a number in a range, a letter. The page saves
 * each in the recent picks and says it to screen readers (`onResult`).
 */

import { useState } from "react";
import { CaseUpper, Coins, Dices, Hash, HelpCircle, MonitorUp } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { PickKind } from "@/lib/picker/model";
import {
  DICE_SIDES,
  MAX_DICE,
  NUMBER_RANGE_LIMIT,
  coinText,
  diceLabel,
  diceResultText,
  randomLetter,
  randomNumber,
  rollDice,
  validateNumberRange,
  yesNo,
  type DiceSides,
  type NumberRangeDraft,
} from "@/lib/picker/randomizers";

export interface QuickPick {
  kind: PickKind;
  result: string;
  detail: string;
}

export interface QuickPanelProps {
  /** The last quick answer, shown large. */
  last: QuickPick | null;
  roomLive: boolean;
  onResult: (pick: QuickPick) => void;
  onShow: (title: string, body: string) => void;
}

const COUNT_OPTIONS = Array.from({ length: MAX_DICE }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
  ariaLabel: `${i + 1} ${i === 0 ? "die" : "dice"}`,
}));
const SIDE_OPTIONS = DICE_SIDES.map((s) => ({ value: s, label: `d${s}`, ariaLabel: `${s} sides` }));

export function QuickPanel({ last, roomLive, onResult, onShow }: QuickPanelProps) {
  const [count, setCount] = useState(1);
  const [sides, setSides] = useState<DiceSides>(6);
  const range = useItemForm<NumberRangeDraft, { min: number; max: number }, "min" | "max">({
    initial: { min: "1", max: "100" },
    validate: validateNumberRange,
    resetOnSave: false,
    onSave: ({ min, max }) =>
      onResult({
        kind: "number",
        result: String(randomNumber(min, max)),
        detail: `${min} to ${max}`,
      }),
  });

  return (
    <section aria-labelledby="picker-quick-heading" className="space-y-4">
      <h2 id="picker-quick-heading" className="text-base font-semibold text-text">
        Quick answers
      </h2>

      <div
        className="rounded-lg border border-border bg-card p-4 text-center"
        data-testid="picker-quick-result"
      >
        {last ? (
          <>
            <p className="break-words font-display text-3xl font-bold text-text">{last.result}</p>
            {last.detail && <p className="text-sm text-sub">{last.detail}</p>}
            {roomLive && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 gap-1.5"
                onClick={() => onShow(last.result, last.detail)}
              >
                <MonitorUp aria-hidden="true" />
                Show on everyone&apos;s screen
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-sub">Roll, flip or pick: the answer shows here.</p>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-text">Dice</h3>
        <div className="space-y-2">
          <ToggleGroup
            label="How many dice"
            options={COUNT_OPTIONS}
            value={count}
            onValueChange={setCount}
            size="sm"
          />
          <ToggleGroup
            label="Sides on each die"
            options={SIDE_OPTIONS}
            value={sides}
            onValueChange={(v) => setSides(v as DiceSides)}
            size="sm"
          />
        </div>
        <Button
          type="button"
          variant="toolkit"
          className="gap-1.5"
          onClick={() => {
            const roll = rollDice(count, sides);
            onResult({
              kind: "dice",
              result: diceResultText(roll),
              detail: diceLabel(count, sides),
            });
          }}
        >
          <Dices aria-hidden="true" />
          Roll {diceLabel(count, sides)}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => onResult({ kind: "coin", result: coinText(), detail: "Coin flip" })}
        >
          <Coins aria-hidden="true" />
          Flip a coin
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => onResult({ kind: "yes-no", result: yesNo(), detail: "Yes or no" })}
        >
          <HelpCircle aria-hidden="true" />
          Yes or no
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => onResult({ kind: "letter", result: randomLetter(), detail: "A to Z" })}
        >
          <CaseUpper aria-hidden="true" />
          Pick a letter
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <h3 className="mb-2 text-sm font-semibold text-text">A number in a range</h3>
        <ItemForm form={range} submitLabel="Pick a number" submitIcon={<Hash aria-hidden="true" />}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" error={range.errors.min}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={range.draft.min}
                  onChange={(e) => range.update({ min: e.target.value })}
                />
              )}
            </Field>
            <Field label="To" error={range.errors.max}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={range.draft.max}
                  onChange={(e) => range.update({ max: e.target.value })}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-sub">
            Whole numbers, both ends included, within {NUMBER_RANGE_LIMIT.toLocaleString("en-GB")}{" "}
            either side of zero.
          </p>
        </ItemForm>
      </div>
    </section>
  );
}
