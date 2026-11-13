"use client";

/**
 * The saved rounds, newest first: each with its format, when and how many
 * answered, one line on what came out, and its totals on request (the vote
 * kit's own results view). From a row the host can send the result to the
 * Decision Log or the retro, delete it (with Undo), add the real answer to
 * a guess, or save value poker's agreed value to its backlog item (with Undo).
 */

import { useId, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { SavedRoundResults } from "@/components/collab/vote-room";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import type { HandoffLink } from "@/lib/stores/workspace-types";
import {
  RESULT_ROUTES,
  guessVerdict,
  presetName,
  resultKind,
  resultSummary,
  valuePicks,
  type SavedResult,
  type StoredNumberResult,
} from "@/lib/quick-vote/results";
import { asKitResult, resultHandoff } from "./model";

/** Each row's delete button: focus moves to the next one when a row goes. */
export const DELETE_RESULT_SELECTOR = 'button[aria-label^="Delete the result"]';

export interface ResultsListProps {
  results: readonly SavedResult[];
  /** The list, for moving focus after a delete. */
  listRef?: RefObject<HTMLUListElement>;
  readOnly: boolean;
  /** Backlog item names by id, for value poker. */
  itemName: (id: string) => string | null;
  onDelete: (saved: SavedResult) => void;
  onLinksChange: (
    id: string,
    update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
  ) => void;
  getLinks: (id: string) => readonly HandoffLink[] | undefined;
  /** Returns an error to show, or null when saved. */
  onRealAnswer: (saved: SavedResult, typed: string) => string | null;
  onSaveValue: (saved: SavedResult, value: number) => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ResultsList(props: ResultsListProps) {
  return (
    <ul ref={props.listRef} className="space-y-3" aria-label="Saved results, newest first">
      {props.results.map((saved) => (
        <ResultRow key={saved.id} saved={saved} {...props} />
      ))}
    </ul>
  );
}

function ResultRow({
  saved,
  readOnly,
  itemName,
  onDelete,
  onLinksChange,
  getLinks,
  onRealAnswer,
  onSaveValue,
}: ResultsListProps & { saved: SavedResult }) {
  const [open, setOpen] = useState(false);
  const r = saved.result;
  const kind = resultKind(r);
  const panelId = useId();
  const people = `${r.ballots} ${r.ballots === 1 ? "person" : "people"}`;
  const how = r.source === "live" ? "live room" : "counted by hand";

  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-sub">
            {presetName(saved)} · {when(saved.savedAt)} · {people}, {how}
          </p>
          <h3 className="break-words text-sm font-semibold text-text">{r.title}</h3>
          <p className="mt-0.5 text-sm text-sub">{resultSummary(saved)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SendToMenu
            routes={RESULT_ROUTES}
            item={resultHandoff(saved)}
            sentTo={saved.sentTo}
            getLinks={() => getLinks(saved.id)}
            onLinksChange={(update) => onLinksChange(saved.id, update)}
            disabled={readOnly}
            itemLabels={{ decision: "Decision Log", "retro-topic": "Retro topic" }}
          />
          <Button
            type="button"
            variant="danger-ghost"
            size="icon"
            disabled={readOnly}
            aria-label={`Delete the result “${r.title}”`}
            onClick={() => onDelete(saved)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      {kind === "number" && (
        <RealAnswer saved={saved} readOnly={readOnly} onRealAnswer={onRealAnswer} />
      )}
      {saved.presetId === "value-poker" && (
        <ValueSave
          saved={saved}
          readOnly={readOnly}
          itemName={itemName}
          onSaveValue={onSaveValue}
        />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        {open ? "Hide the totals" : "Show the totals"}
      </Button>
      <div id={panelId} hidden={!open}>
        {open && <SavedRoundResults result={asKitResult(r)} />}
      </div>
    </li>
  );
}

function RealAnswer({
  saved,
  readOnly,
  onRealAnswer,
}: {
  saved: SavedResult;
  readOnly: boolean;
  onRealAnswer: ResultsListProps["onRealAnswer"];
}) {
  const r = saved.result as StoredNumberResult;
  const [typed, setTyped] = useState(
    saved.realAnswer === undefined ? "" : String(saved.realAnswer)
  );
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="space-y-1.5">
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onRealAnswer(saved, typed));
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm text-text">
            Real answer{r.unit ? ` (${r.unit})` : ""}
          </label>
          <Input
            id={id}
            inputMode="decimal"
            className="w-32"
            value={typed}
            disabled={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={readOnly}>
          {saved.realAnswer === undefined ? "Add the real answer" : "Change it"}
        </Button>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {/* Announced by the page when it's added (a live region mounted with its text often isn't read). */}
      {saved.realAnswer !== undefined && !error && (
        <p className="text-sm text-text">{guessVerdict(r, saved.realAnswer)}</p>
      )}
    </div>
  );
}

function ValueSave({
  saved,
  readOnly,
  itemName,
  onSaveValue,
}: {
  saved: SavedResult;
  readOnly: boolean;
  itemName: ResultsListProps["itemName"];
  onSaveValue: ResultsListProps["onSaveValue"];
}) {
  const picks = valuePicks(saved.result);
  const [value, setValue] = useState<number>(saved.valueSaved ?? picks[picks.length - 1] ?? 5);
  const id = useId();
  const name = saved.backlogItemId ? itemName(saved.backlogItemId) : null;
  if (!saved.backlogItemId) {
    return (
      <p className="text-xs text-sub">
        This round valued no backlog item, so there is nothing to save.
      </p>
    );
  }
  if (!name) {
    return <p className="text-xs text-sub">Its backlog item has since been deleted.</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm text-text">
            Business value for “{name}”
          </label>
          <select
            id={id}
            value={value}
            disabled={readOnly}
            onChange={(e) => setValue(Number(e.target.value))}
            className="flex h-11 w-32 rounded-md border border-input bg-card px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 pointer-fine:md:h-9 pointer-fine:md:text-sm"
          >
            {FIBONACCI_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="toolkit"
          disabled={readOnly}
          onClick={() => onSaveValue(saved, value)}
        >
          Save the value
        </Button>
      </div>
      <p className="text-xs text-sub">
        {picks.length > 1
          ? `Tied between ${picks.join(" and ")}: agree one before you save it.`
          : picks.length === 1
            ? `Most picked: ${picks[0]}.`
            : "Nothing was picked."}
        {saved.valueSaved !== undefined && ` Saved ${saved.valueSaved} to the item.`}
      </p>
    </div>
  );
}
