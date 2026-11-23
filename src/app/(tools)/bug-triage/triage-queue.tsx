"use client";

import { useRef, useState } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { SourceLink } from "@/components/handoff/source-link";
import type { AiSource } from "@/lib/ai/task-types";
import {
  bugTriageSeverityTask,
  severityAsk,
  type SeverityOutput,
  type SeveritySuggestion,
} from "@/lib/ai/tasks/bug-triage.lite";
import type { BugReport } from "@/lib/stores/workspace-types";
import { PRIORITY_LABEL, SEVERITY_LABEL, ageDays } from "@/lib/bug-triage/model";
import { TriageForm, type Placement } from "./triage-form";
import { ageText } from "./bug-detail";

/** A suggestion the page kept: for a bug it asked about, with a duplicate it knows. */
export interface KeptSuggestion extends SeveritySuggestion {
  title: string;
  duplicateTitle?: string;
}

/**
 * Amr's answer as the page shows it: only the bugs it asked about, and a
 * duplicate only when it names another bug the page has.
 */
export function keptSuggestions(
  data: SeverityOutput,
  asked: readonly BugReport[],
  all: readonly BugReport[]
): KeptSuggestion[] {
  const askedById = new Map(asked.map((b) => [b.id, b]));
  const titles = new Map(all.map((b) => [b.id, b.title]));
  const seen = new Set<string>();
  const out: KeptSuggestion[] = [];
  for (const s of data.suggestions) {
    const bug = askedById.get(s.id);
    if (!bug || seen.has(s.id)) continue;
    seen.add(s.id);
    const dup =
      s.duplicateOf && s.duplicateOf !== s.id && titles.has(s.duplicateOf)
        ? s.duplicateOf
        : undefined;
    const { duplicateOf: _d, ...rest } = s;
    void _d;
    out.push({
      ...rest,
      title: bug.title,
      ...(dup ? { duplicateOf: dup, duplicateTitle: titles.get(dup) } : {}),
    });
  }
  return out;
}

/**
 * The bugs waiting to be triaged, oldest first. The first one is open, with
 * its quick checks; another opens on a tap. A bug that reads like an older
 * open one says so, with "Close as duplicate". Amr (or the rules, without
 * AI) suggests a severity and a priority for them all, to accept one by one.
 */
export function TriageQueue({
  queue,
  bugs,
  today,
  hints,
  onPlace,
  onAccept,
  onDuplicate,
  onOpen,
}: {
  queue: readonly BugReport[];
  bugs: readonly BugReport[];
  today: string;
  hints: ReadonlyMap<string, string>;
  onPlace: (bug: BugReport, placed: Placement) => void;
  onAccept: (s: KeptSuggestion) => void;
  onDuplicate: (bug: BugReport, of: string) => void;
  onOpen: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ items: KeptSuggestion[]; source: AiSource } | null>(
    null
  );
  const askRef = useRef<HTMLDivElement>(null);
  /** The bugs the last ask carried: an answer about any other is dropped. */
  const askedRef = useRef<Set<string>>(new Set());
  const active = queue.find((b) => b.id === activeId) ?? queue[0];
  const titles = new Map(bugs.map((b) => [b.id, b.title]));
  // Only the suggestions for bugs still waiting.
  const waiting = new Set(queue.map((b) => b.id));
  const items = suggested?.items.filter((s) => waiting.has(s.id)) ?? [];

  if (queue.length === 0) {
    return (
      <p className="text-sm text-sub" data-field="queue-empty" tabIndex={-1}>
        Nothing waiting: every open bug is on the grid.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div ref={askRef}>
        <AiButton
          task={bugTriageSeverityTask}
          label="Ask Amr for severities"
          fallbackLabel="Suggest severities without AI"
          variant="outline"
          input={() => {
            const ask = severityAsk(queue, bugs);
            // Nothing the ask can carry: the button says to fill in the tool first.
            if (!ask) throw new Error("nothing to ask about");
            askedRef.current = new Set(ask.bugs.map((b) => b.id));
            return ask;
          }}
          onResult={(data, meta) => {
            const asked = queue.filter((b) => askedRef.current.has(b.id));
            setSuggested({ items: keptSuggestions(data, asked, bugs), source: meta.source });
          }}
        />
      </div>
      {suggested && items.length > 0 && (
        <AiSuggestions
          items={items}
          source={suggested.source}
          title="Severities to check"
          acceptLabel="Place"
          itemKey={(s) => s.id}
          render={(s) => ({
            title: `${s.title}: ${SEVERITY_LABEL[s.severity]} × ${PRIORITY_LABEL[s.priority]}`,
            detail: `${s.reason}${s.duplicateTitle ? ` Looks like “${s.duplicateTitle}”.` : ""}`,
          })}
          onAccept={(s) => onAccept(s)}
          onDismiss={() => setSuggested(null)}
          returnFocus={() =>
            askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')
          }
        />
      )}
      <ul className="space-y-2" aria-label="Bugs to triage, oldest first">
        {queue.map((bug) => {
          const open = bug.id === active?.id;
          const like = hints.get(bug.id);
          const age = ageDays(bug, today);
          return (
            <li
              key={bug.id}
              data-queue-bug={bug.id}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium text-text">{bug.title}</p>
                  <p className="text-xs text-sub">
                    Logged {ageText(age)}
                    {bug.area ? ` · ${bug.area}` : ""}
                    {bug.reportedBy ? ` · found by ${bug.reportedBy}` : ""}
                  </p>
                  <SourceLink sourceRef={bug.sourceRef} />
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => onOpen(bug.id)}
                  >
                    Details
                  </Button>
                  {!open && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      aria-label={`Triage “${bug.title}”`}
                      onClick={() => setActiveId(bug.id)}
                    >
                      Triage
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              {like && titles.has(like) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 px-2 py-1.5">
                  <p className="min-w-0 flex-1 basis-48 text-sm text-text">
                    Looks like: “{titles.get(like)}”
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => onDuplicate(bug, like)}
                  >
                    <Copy aria-hidden="true" />
                    Close as duplicate
                  </Button>
                </div>
              )}
              {open && (
                <div className="mt-3 border-t border-border pt-3">
                  <TriageForm key={bug.id} bug={bug} onSave={(placed) => onPlace(bug, placed)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
