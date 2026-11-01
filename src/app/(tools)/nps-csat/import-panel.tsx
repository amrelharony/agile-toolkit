"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import type { SurveyKind } from "@/lib/nps/score";
import { IMPORT_CAP, previewImport, type ImportRow } from "./import";

/** The longest file read: a 1000-row export is far below it; this stops a wrong file freezing the tab. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const KINDS: { value: SurveyKind; label: string }[] = [
  { value: "nps", label: "NPS (0–10)" },
  { value: "csat", label: "CSAT (1–5)" },
];

const rowsText = (n: number) => (n === 1 ? "1 row" : `${n} rows`);

/**
 * "Import responses": a CSV file or rows pasted from a spreadsheet,
 * previewed before anything is saved: how many are ready, which are
 * copies of stored responses (skipped), and which rows can't be read and
 * why. A file with no kind column needs NPS or CSAT picked for all of it,
 * and each new file (or text cleared or pasted over) is picked afresh.
 */
export function ImportPanel({
  existing,
  today,
  onImport,
  onClose,
}: {
  existing: readonly NpsResponse[];
  today: string;
  onImport: (rows: ImportRow[], duplicates: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [kind, setKind] = useState<SurveyKind | null>(null);
  const [tried, setTried] = useState(false);
  const preview = useMemo(
    () => previewImport(text, { kind, today, existing }),
    [text, kind, today, existing]
  );
  const kindMissing = preview.needsKind && !kind;
  const nothing = !preview.problem && !kindMissing && preview.ready.length === 0;

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is over 5 MB: export fewer rows, or paste them instead.");
      return;
    }
    try {
      setText(await file.text());
      setFileName(file.name);
      setFileError(null);
      setTried(false);
      // Another file: its survey is picked again, never carried over from the last.
      setKind(null);
    } catch {
      setFileError("That file couldn't be read.");
    }
  };

  const submit = () => {
    setTried(true);
    if (preview.problem || kindMissing || preview.ready.length === 0) return;
    onImport(preview.ready, preview.duplicates.length);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-sub">
        The first row names the columns: <span className="font-data">date</span> (YYYY-MM-DD) and{" "}
        <span className="font-data">score</span>, and optionally{" "}
        <span className="font-data">kind</span> (NPS or CSAT),{" "}
        <span className="font-data">respondent</span>, <span className="font-data">verbatim</span>{" "}
        and <span className="font-data">tags</span>. Up to {IMPORT_CAP} rows at a time.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="CSV file" error={fileError ?? undefined} hint={fileName ?? undefined}>
          {(props) => (
            <Input
              {...props}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              onChange={readFile}
              className="max-w-full"
            />
          )}
        </Field>
      </div>
      <Field label="Or paste rows" hint="From a spreadsheet or a CSV, header row first.">
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              setTried(false);
              if (!e.target.value.trim()) setKind(null);
            }}
            onPaste={(e) => {
              // Rows pasted over the whole text are another file: pick its survey again.
              const t = e.currentTarget;
              if (t.selectionStart === 0 && t.selectionEnd === t.value.length) setKind(null);
            }}
            className="font-data text-xs"
            placeholder={"date,score,verbatim\n2026-10-03,9,Quick delivery"}
          />
        )}
      </Field>

      {preview.needsKind && (
        <div
          className="flex flex-col gap-1.5"
          data-scale-invalid={tried && kindMissing ? "true" : undefined}
        >
          <span className="text-sm text-text" aria-hidden="true">
            No kind column: every row is
          </span>
          <ToggleGroup label="Every row is" options={KINDS} value={kind} onValueChange={setKind} />
          {tried && kindMissing && (
            <p className="text-xs text-danger" role="alert">
              Pick NPS or CSAT for the whole file.
            </p>
          )}
        </div>
      )}

      {text.trim() && (
        <div role="status" className="space-y-2 rounded-md border border-border bg-bg p-3 text-sm">
          {preview.problem ? (
            <p className="text-danger">{preview.problem}</p>
          ) : kindMissing ? (
            <p className="text-sub">
              {rowsText(preview.rows)} read. Pick the survey to check them.
            </p>
          ) : (
            <p className="text-text">
              <span className="font-medium">{preview.ready.length} ready to import</span>
              {preview.duplicates.length > 0 &&
                `, ${preview.duplicates.length} already saved (skipped)`}
              {preview.skipped.length > 0 && `, ${rowsText(preview.skipped.length)} can't be read`}.
            </p>
          )}
          {preview.overCap > 0 && (
            <p className="text-warning">
              Only the first {IMPORT_CAP} rows are read; {rowsText(preview.overCap)} more were left
              out. Import the rest as another file.
            </p>
          )}
          {preview.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-sub">
                Rows that can&apos;t be read
              </summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-sub">
                {preview.skipped.map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}.
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.duplicates.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-sub">Already saved</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-sub">
                {preview.duplicates.map((d) => (
                  <li key={d.line}>
                    Line {d.line}: {d.response.date}, {d.response.kind.toUpperCase()}{" "}
                    {d.response.score}
                    {d.response.respondent ? `, ${d.response.respondent}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {tried && nothing && !preview.problem && (
        <p className="text-xs text-danger" role="alert">
          {text.trim() ? "No row is ready to import." : "Choose a file or paste rows first."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="gap-1" onClick={submit}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {preview.ready.length > 0
            ? `Import ${preview.ready.length === 1 ? "1 response" : `${preview.ready.length} responses`}`
            : "Import"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
