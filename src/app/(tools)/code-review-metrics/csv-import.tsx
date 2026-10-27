"use client";

import { useId, useRef, useState } from "react";
import { FileUp, ListChecks } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
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
 * errors are listed by line, inline, and never imported. The page checks
 * the PR numbers against the log once more on import (onImport), for a PR
 * logged between the check and the import.
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
  const announce = useAnnounce();

  const check = () => {
    const result = parseReviewCsv(text, { existing, now: nowWallClock(), localize: true, newId });
    setChecked(result);
    // The result appears with its text in one render, which a live region
    // there would miss: the page's announcer reads the sentence out.
    announce(checkSummary(result));
  };

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
        <div id={resultId} className="space-y-1 text-xs">
          <p className="text-text">{checkSummary(checked)}</p>
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

/**
 * The check in one sentence, shown and announced: what is ready, how many
 * rows have errors (listed under it), and what was skipped and why.
 */
export function checkSummary(checked: ReviewCsvResult): string {
  const parts = [
    checked.samples.length === 0
      ? "No rows ready to import."
      : `${plural(checked.samples.length, "row")} ready to import.`,
  ];
  if (checked.errors.length > 0) {
    parts.push(`${plural(checked.errors.length, "row")} can't be imported (listed below).`);
  }
  if (checked.duplicates.length > 0) {
    const which = checked.duplicates.map((d) => `row ${d.row}: PR ${d.prNumber}`).join(", ");
    parts.push(`${plural(checked.duplicates.length, "row")} skipped as already logged (${which}).`);
  }
  if (checked.notRead > 0) {
    parts.push(`${plural(checked.notRead, "row")} past the first ${REVIEW_IMPORT_MAX} not read.`);
  }
  return parts.join(" ");
}
