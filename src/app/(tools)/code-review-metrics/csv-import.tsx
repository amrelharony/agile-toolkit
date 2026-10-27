"use client";

import { useId, useRef, useState } from "react";
import { FileUp, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { plural } from "@/lib/charts/chart-text";
import {
  REVIEW_IMPORT_MAX,
  nowWallClock,
  parseReviewCsv,
  type ReviewCsvResult,
} from "@/lib/quality/review";
import type { PrSample } from "@/lib/stores/workspace-types";

/** At most this many row errors are listed; the rest are counted. */
const ERRORS_SHOWN = 20;

/**
 * Paste a CSV, check it, then import the rows that passed. Checking goes
 * through parseReviewCsv (lib/quality/review, on lib/utils/csv): a blank
 * number is a row error, never 0; a PR number logged already is skipped;
 * zone-suffixed times are read in this browser's time zone. Rows with
 * errors are listed by line, inline, and never imported.
 */
export function CsvImport({
  existing,
  newId,
  onImport,
}: {
  existing: readonly PrSample[];
  /** Ids for the imported rows (example ids while the example is open). */
  newId: () => string;
  onImport: (samples: PrSample[], skipped: number) => void;
}) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<ReviewCsvResult | null>(null);
  const resultId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const check = () =>
    setChecked(parseReviewCsv(text, { existing, now: nowWallClock(), localize: true, newId }));

  const skipped = checked ? checked.errors.length + checked.duplicates.length + checked.notRead : 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-sub">
        Columns, with a header row in any order or without one in this order:{" "}
        <code>
          prNumber, author, openedAt, mergedAt, reviewerCount, commentCount, linesChanged,
          description, firstReviewAt
        </code>
        . Times as <code>2026-05-09T14:30</code>; one with a zone (<code>…Z</code>) is read in your
        time zone. Comma, tab or semicolon separated; up to {REVIEW_IMPORT_MAX} rows.
      </p>
      <Field label="CSV rows" hideLabel>
        {(props) => (
          <Textarea
            {...props}
            ref={textRef}
            aria-describedby={
              [props["aria-describedby"], checked ? resultId : undefined]
                .filter(Boolean)
                .join(" ") || undefined
            }
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setChecked(null);
            }}
            placeholder="#1234,alice,2026-05-01T09:00,2026-05-01T17:30,2,14,120,Refactor auth"
            className="font-data text-xs"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={check} disabled={!text.trim()}>
          <ListChecks aria-hidden="true" />
          Check rows
        </Button>
        {checked && checked.samples.length > 0 && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onImport(checked.samples, skipped);
              setText("");
              setChecked(null);
              // This button goes once the rows are in: back to the box for the next paste.
              textRef.current?.focus();
            }}
          >
            <FileUp aria-hidden="true" />
            Import {plural(checked.samples.length, "pull request")}
          </Button>
        )}
      </div>
      {checked && (
        <div id={resultId} role="status" className="space-y-1 text-xs">
          <p className="text-text">
            {checked.samples.length === 0
              ? "No rows ready to import."
              : `${plural(checked.samples.length, "row")} ready to import.`}
            {checked.duplicates.length > 0 &&
              ` ${plural(checked.duplicates.length, "row")} skipped as already logged (${checked.duplicates
                .map((d) => `row ${d.row}: PR ${d.prNumber}`)
                .join(", ")}).`}
            {checked.notRead > 0 &&
              ` ${plural(checked.notRead, "row")} past the first ${REVIEW_IMPORT_MAX} not read.`}
          </p>
          {checked.errors.length > 0 && (
            <ul className="space-y-0.5 text-danger" aria-label="Rows that can't be imported">
              {checked.errors.slice(0, ERRORS_SHOWN).map((e) => (
                <li key={`${e.row}:${e.message}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
              {checked.errors.length > ERRORS_SHOWN && (
                <li>
                  …and {plural(checked.errors.length - ERRORS_SHOWN, "more row")} with errors.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
