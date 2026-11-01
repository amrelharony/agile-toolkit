"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { parseNumber } from "@/lib/utils/form";
import type { BuyAFeatureGame } from "@/lib/stores/workspace-types";
import { allocationAmount } from "@/lib/realtime/vote-room/allocation";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  PLAYERS_MAX,
  PLAYERS_MIN,
  UNIT_MAX,
  budgetProblem,
  budgetText,
  type BudgetCheck,
  type Pool,
} from "@/lib/buy-a-feature/game";

/**
 * A whole number saved when the box is left (or on Enter). Blank clears
 * the setting ("Not set"); a number out of range shows why under the box
 * and isn't saved, so the game never runs on a value nobody chose.
 */
function SettingNumber({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (next: number | undefined) => void;
}) {
  const shown = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(shown);
    setError(null);
  }, [shown]);

  const commit = () => {
    const n = parseNumber(draft);
    if (n === undefined) {
      setError(null);
      if (value !== undefined) onCommit(undefined);
      return;
    }
    if (!Number.isInteger(n) || n < min || n > max) {
      setError(
        `Enter a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`
      );
      return;
    }
    setError(null);
    if (n !== value) onCommit(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(shown);
      setError(null);
    }
  };

  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      {(props) => (
        <Input
          {...props}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          placeholder="Not set"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      )}
    </Field>
  );
}

/**
 * The game's settings: how many play and each one's budget (the pool is
 * the two multiplied), and the unit. Nothing is assumed: the team's size
 * and "about half the prices" are offered as chips, never applied
 * unasked. The line under them says what the pool can buy, or, when the
 * players could buy everything, why the game can't run yet.
 */
export function GameSettings({
  game,
  unit,
  pool,
  check,
  suggestedBudget,
  rosterSize,
  readOnly,
  onChange,
}: {
  game: BuyAFeatureGame | null;
  unit: string;
  pool: Pool | null;
  check: BudgetCheck | null;
  /** About half the prices per player, once the players are known; null otherwise. */
  suggestedBudget: number | null;
  rosterSize: number;
  readOnly: boolean;
  onChange: (patch: Partial<Pick<BuyAFeatureGame, "players" | "budgetPerPlayer" | "unit">>) => void;
}) {
  const money = (n: number) => allocationAmount(n, unit);
  const [unitDraft, setUnitDraft] = useState(game?.unit ?? "");
  useEffect(() => setUnitDraft(game?.unit ?? ""), [game?.unit]);
  const problem = check ? budgetProblem(check, unit) : null;
  const suggested = suggestedBudget;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-3">
      <legend className="sr-only">Game settings</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SettingNumber
          label="Players"
          hint="How many people play."
          value={game?.players}
          min={PLAYERS_MIN}
          max={PLAYERS_MAX}
          onCommit={(players) => onChange({ players })}
        />
        <SettingNumber
          label="Budget per player"
          hint={`Whole ${unit === "$" ? "dollars" : "units"}, ${BUDGET_MIN} to ${BUDGET_MAX.toLocaleString("en-US")}.`}
          value={game?.budgetPerPlayer}
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          onCommit={(budgetPerPlayer) => onChange({ budgetPerPlayer })}
        />
        <Field label="Unit" hint={`Up to ${UNIT_MAX} characters, like $ or pts.`}>
          {(props) => (
            <Input
              {...props}
              value={unitDraft}
              maxLength={UNIT_MAX}
              placeholder="$"
              onChange={(e) => setUnitDraft(e.target.value)}
              onBlur={() => {
                const next = unitDraft.trim();
                if (next !== (game?.unit ?? "")) onChange({ unit: next || undefined });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          )}
        </Field>
      </div>

      {(rosterSize > 0 && game?.players !== rosterSize) ||
      (suggested !== null && game?.budgetPerPlayer !== suggested) ? (
        <div className="flex flex-wrap gap-2">
          {rosterSize > 0 && game?.players !== rosterSize && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onChange({ players: rosterSize })}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Use the team&apos;s {rosterSize} {rosterSize === 1 ? "person" : "people"}
            </Button>
          )}
          {suggested !== null && game?.budgetPerPlayer !== suggested && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onChange({ budgetPerPlayer: suggested })}
            >
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              About half the prices: {money(suggested)} each
            </Button>
          )}
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : pool && check ? (
        <p className="text-sm text-text" data-testid="buy-a-feature-budget">
          {budgetText(check, pool, unit)}
        </p>
      ) : (
        <p className="text-sm text-sub">
          Set the players and each one&apos;s budget. The pool is the two multiplied, and it should
          cover about half of the prices, so nobody can have everything.
        </p>
      )}
      {pool && pool.overspent > 0 && (
        <p className="text-sm text-warning">
          The features hold {money(pool.overspent)} more than the pool. Raise the budget, or refund
          some purchases.
        </p>
      )}
    </fieldset>
  );
}
