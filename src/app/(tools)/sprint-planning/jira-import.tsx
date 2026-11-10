"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/lib/stores/workspace-types";
import { JIRA_CSV_MAX_BYTES, JIRA_CSV_MAX_ROWS } from "@/lib/jira/csv-export";
import { storageRoomProblem } from "@/lib/stores/storage-room";
import {
  jiraImportBytes,
  jiraImportLabel,
  jiraImportSummary,
  jiraSiteFrom,
  pointsChangeText,
  previewJiraImport,
  readJiraSite,
  rowsText,
  type JiraImportPreview,
} from "./jira";

const thousands = (n: number) => n.toLocaleString("en-GB");

/** A disclosure's summary: 44 px tall to a finger (12 px text on a 16 px line, 14 px above and below). */
const SUMMARY = "cursor-pointer text-xs text-sub pointer-coarse:py-3.5";

/**
 * "Import from Jira (CSV)": a Jira Cloud CSV export, uploaded or pasted,
 * previewed before anything is saved. The preview lists the columns found
 * and what each becomes, the ones left out, the new stories, the points it
 * changes on stories already here (matched by ticket key), and the rows it
 * can't import and why. The optional site address gives each new story a
 * link to its issue; an earlier import's site is filled in. An import that
 * would bring this browser's storage near its quota is refused here, with
 * what to do. The page imports with one Undo.
 */
export function JiraImport({
  stories,
  storageUsed,
  onImport,
  onClose,
}: {
  /** The stories as stored now, to match ticket keys against. */
  stories: readonly Story[];
  /** The writer's storage reading (null: nothing is stored, as in the example). Read once, as the panel opens. */
  storageUsed: () => number | null;
  onImport: (preview: JiraImportPreview) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [site, setSite] = useState(() => jiraSiteFrom(stories));
  const [siteTouched, setSiteTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const [used] = useState(storageUsed);
  const fileField = useRef<HTMLInputElement>(null);
  useEffect(() => fileField.current?.focus(), []);

  // A chosen file is read as it is, never shown in the box: a 5 MB export
  // would make the page crawl. Typing in the box replaces the file.
  const text = file ? file.text : pasted;
  const siteRead = readJiraSite(site);
  const siteUrl = siteRead.ok ? siteRead.site : null;
  const preview = useMemo(
    () => previewJiraImport(text, { stories, site: siteUrl }),
    [text, stories, siteUrl]
  );
  const roomProblem = useMemo(
    () =>
      used === null ? null : storageRoomProblem(used, jiraImportBytes(preview), "These stories"),
    [used, preview]
  );
  const summary = jiraImportSummary(preview);
  const changes = preview.add.length + preview.update.length;
  const siteError = !siteRead.ok && (siteTouched || tried) ? siteRead.error : undefined;
  const blocker = !text.trim()
    ? "Choose a file or paste the CSV first."
    : !preview.problem && changes === 0
      ? "No row adds a story or changes points."
      : null;

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    if (chosen.size > JIRA_CSV_MAX_BYTES) {
      setFileError(
        "That file is over 5 MB. Export fewer issues at a time, such as one project or one sprint."
      );
      return;
    }
    try {
      setFile({ name: chosen.name, text: await chosen.text() });
      setPasted("");
      setFileError(null);
      setTried(false);
    } catch {
      setFileError("That file couldn't be read.");
    }
  };

  const submit = () => {
    setTried(true);
    if (!text.trim() || preview.problem || !siteRead.ok || roomProblem || changes === 0) return;
    onImport(preview);
  };

  return (
    <section
      aria-label="Import from Jira (CSV)"
      className="space-y-3 rounded-lg border border-border bg-surface/40 p-3"
    >
      <p className="text-sm text-sub">
        Upload or paste a Jira Cloud CSV export. In Jira, search for the issues, then export them as
        CSV. Each issue becomes a story in the backlog. The file is read in this browser, and only
        the stories are saved. Up to {thousands(JIRA_CSV_MAX_ROWS)} rows and 5 MB. Files from other
        trackers may work, untested.
      </p>
      <Field
        label="CSV file"
        hint={file ? `Reading ${file.name}. Paste below to use that instead.` : undefined}
        error={fileError ?? undefined}
      >
        {(control) => (
          <Input
            {...control}
            ref={fileField}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={readFile}
            className="max-w-full"
          />
        )}
      </Field>
      <Field label="Or paste the CSV" hint="Header row first, as Jira exports it.">
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              if (e.target.value.trim()) setFile(null);
              setTried(false);
            }}
            // 16 px on a touch screen (iOS zooms into smaller text), dense with a mouse.
            className="font-data pointer-fine:md:text-xs"
            placeholder={
              "Issue key,Summary,Story Points,Assignee,Description\nPAY-12,Pay with a saved card,5,Sam Lee,"
            }
          />
        )}
      </Field>
      <Field
        label="Jira site address (optional)"
        hint="Such as your-team.atlassian.net. Each new story then links to its issue."
        error={siteError}
      >
        {(control) => (
          <Input
            {...control}
            value={site}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="your-team.atlassian.net"
            onChange={(e) => setSite(e.target.value)}
            onBlur={() => setSiteTouched(true)}
          />
        )}
      </Field>

      {text.trim() && <JiraPreview preview={preview} summary={summary} roomProblem={roomProblem} />}

      {tried && blocker && (
        <p className="text-xs text-danger" role="alert">
          {blocker}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="gap-1" onClick={submit}>
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {jiraImportLabel(preview)}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** What the import will do: the counts, the columns, and the rows set aside. */
function JiraPreview({
  preview,
  summary,
  roomProblem,
}: {
  preview: JiraImportPreview;
  summary: string;
  roomProblem: string | null;
}) {
  const { mapped, unused, ignored, errors, update, unchanged } = preview;
  return (
    <div className="space-y-2 rounded-md border border-border bg-bg p-3 text-sm">
      {preview.problem ? (
        <p className="text-danger" role="status">
          {preview.problem}
        </p>
      ) : (
        <p className="text-text" role="status">
          {summary}
        </p>
      )}
      {preview.overCap > 0 && (
        <p className="text-warning">
          Only the first {thousands(JIRA_CSV_MAX_ROWS)} rows are read; {rowsText(preview.overCap)}{" "}
          more were left out. Import the rest as another file.
        </p>
      )}
      {roomProblem && <p className="text-danger">{roomProblem}</p>}
      {mapped.length + unused.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-sub">Columns found</h4>
          <ul className="mt-1 space-y-0.5 text-xs" aria-label="Columns found">
            {mapped.map((m) => (
              <li key={m.header} className="break-words text-text">
                <span className="font-data">{m.header}</span>: {m.becomes}
              </li>
            ))}
            {unused.map((u) => (
              <li key={u.header} className="break-words text-sub">
                <span className="font-data">{u.header}</span>: {u.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ignored.length > 0 && (
        <details>
          <summary className={SUMMARY}>
            {ignored.length === 1
              ? "1 other column, ignored"
              : `${ignored.length} other columns, ignored`}
          </summary>
          <p className="mt-1 break-words font-data text-xs text-sub">{ignored.join(", ")}</p>
        </details>
      )}
      {errors.length > 0 && (
        <details>
          <summary className={SUMMARY}>Rows that can&apos;t be imported</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-sub">
            {errors.map((e) => (
              <li key={e.line} className="break-words">
                Line {e.line}: {e.reason}.
              </li>
            ))}
          </ul>
        </details>
      )}
      {update.length + unchanged.length > 0 && (
        <details>
          <summary className={SUMMARY}>Already here, matched by ticket key</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-sub">
            {update.map((c) => (
              <li key={c.line} className="break-words">
                Line {c.line}: {pointsChangeText(c)}.
              </li>
            ))}
            {unchanged.map((k) => (
              <li key={k.line} className="break-words">
                Line {k.line}: {k.key} “{k.title}”, {k.why}.
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
