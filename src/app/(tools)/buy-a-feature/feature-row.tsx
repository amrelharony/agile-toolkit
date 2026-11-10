"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "@/components/motion/transition-link";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { parseNumber } from "@/lib/utils/form";
import { allocationAmount } from "@/lib/realtime/vote-room/allocation";
import { fundedShare, isFunded, remaining, type FeatureLedger } from "@/lib/buy-a-feature/game";
import { EditFeatureForm, type FeatureValues } from "./feature-form";

/**
 * Buy at the table: the amount box starts blank (no "10" to buy by
 * accident), takes whole amounts, and says why it refuses one instead of
 * ignoring it. `onBuy` returns that reason, or null once it bought.
 */
function BuyBox({
  title,
  disabled,
  onBuy,
}: {
  title: string;
  disabled: boolean;
  onBuy: (amount: number | undefined) => string | null;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = onBuy(parseNumber(amount));
    setError(problem);
    if (!problem) setAmount("");
  };
  return (
    <form onSubmit={submit} noValidate className="flex items-start gap-1">
      <Field label={`Amount to buy of ${title}`} hideLabel error={error ?? undefined}>
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="Amount"
            value={amount}
            disabled={disabled}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            className="h-9 w-24 text-sm"
          />
        )}
      </Field>
      <Button type="submit" size="sm" className="h-9" disabled={disabled}>
        Buy <span className="sr-only">{title}</span>
      </Button>
    </form>
  );
}

/**
 * One feature in the market: what it raised of its price (a bar in the
 * theme's colours, capped at 100%), what it still needs or that it's
 * funded, Buy, Refund, Edit (title and price, in place) and Delete (the
 * page offers Undo). A funded feature sent to the backlog links to it.
 */
export function FeatureRow({
  f,
  unit,
  inBacklog,
  readOnly,
  canBuy,
  onBuy,
  onRefund,
  onEdit,
  onDelete,
}: {
  f: FeatureLedger;
  unit: string;
  /** The feature's story is in the backlog. */
  inBacklog: boolean;
  readOnly: boolean;
  /** Why buying is off (no pool yet; the market says it once), or null. */
  canBuy: string | null;
  onBuy: (amount: number | undefined) => string | null;
  onRefund: () => void;
  onEdit: (v: FeatureValues) => void;
  onDelete: () => void;
}) {
  // Save, Cancel and Escape put focus back on Edit.
  const edit = useInlineEdit();
  const money = (n: number) => allocationAmount(n, unit);
  const share = fundedShare(f);
  const pct = share === null ? null : Math.round(share * 100);
  const funded = isFunded(f);
  // A Buy that funds the feature removes its box, and a Refund removes its
  // button: focus would fall to the page, so it goes to the row's Edit
  // (only then: focus that is still somewhere is left alone).
  const keepFocus = useRef(false);
  useEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) edit.triggerRef.current?.focus();
  });
  const buy = (amount: number | undefined) => {
    const why = onBuy(amount);
    if (why === null) keepFocus.current = true;
    return why;
  };

  if (edit.editing) {
    return (
      <li className="rounded border border-border bg-surface-deep p-3">
        <EditFeatureForm
          initial={{ title: f.title, price: f.price === null ? "" : String(f.price) }}
          onCancel={() => edit.stop({ refocus: true })}
          onSave={(v) => {
            edit.stop({ refocus: true });
            onEdit(v);
          }}
        />
      </li>
    );
  }

  return (
    <li className="space-y-2 rounded border border-border bg-surface-deep p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-text">{f.title}</span>
        <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          {f.price === null ? (
            <span className="rounded-md border border-border px-2 py-0.5 font-semibold text-sub">
              Not priced
            </span>
          ) : funded ? (
            <span className="rounded-md border border-success/40 bg-success/10 px-2 py-0.5 font-semibold text-success">
              Funded
            </span>
          ) : (
            <span className="text-sub">{money(remaining(f))} to go</span>
          )}
          <span className="font-mono text-sub">
            {money(f.raised)}
            {f.price !== null && ` of ${money(f.price)} (${pct}%)`}
          </span>
        </span>
      </div>
      {f.price !== null && (
        <div
          className="h-2 w-full overflow-hidden rounded bg-surface"
          role="progressbar"
          aria-label={`${f.title} funding progress`}
          aria-valuenow={pct ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={funded ? "h-2 bg-success" : "h-2 bg-accent"}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {f.overStored > 0 && (
        <p className="text-xs text-sub">
          It once took {money(f.overStored)} more than its price; only the price counts.
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {!funded && f.price !== null && (
          <BuyBox title={f.title} disabled={readOnly || canBuy !== null} onBuy={buy} />
        )}
        {f.raised > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 gap-1"
            disabled={readOnly}
            onClick={() => {
              keepFocus.current = true;
              onRefund();
            }}
            aria-label={`Refund ${money(f.raised)} from ${f.title}`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Refund
          </Button>
        )}
        {inBacklog && (
          <Link
            href="/sprint-planning"
            className="inline-flex h-9 items-center text-xs font-medium text-success hover:underline"
          >
            <span className="sr-only">{f.title}:</span> In the backlog · Open
          </Link>
        )}
        <span className="ml-auto flex items-center">
          <IconButton
            ref={edit.triggerRef}
            label={`Edit ${f.title}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            disabled={readOnly}
            onClick={edit.start}
          />
          <IconButton
            label={`Delete ${f.title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            disabled={readOnly}
            onClick={onDelete}
          />
        </span>
      </div>
    </li>
  );
}
