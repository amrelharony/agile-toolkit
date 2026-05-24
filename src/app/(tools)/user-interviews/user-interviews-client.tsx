"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Quote, Plus, Trash2, Hash } from "lucide-react";
import { generateUserInterviewsPrompts } from "@/lib/ai-prompts/user-interviews";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { INTERVIEW_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { EmptyState } from "@/components/shared/empty-state";
import { redactPii } from "@/lib/utils/redact-pii";

interface Interview {
  id: string;
  date: string;
  participant: string;
  context?: string;
  quotes: { id: string; text: string; tags: string[] }[];
}

function emptyInterview(): Interview {
  return { id: nanoid(8), date: todayLocalISO(), participant: "", quotes: [] };
}

/** Parse a "tag1, tag2" string into a normalized array — trimmed,
 *  lowercased, and de-empty'd. Lowercasing canonicalizes tags so "UX" and
 *  "ux" become a single entry in frequency counts. */
function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Tag input that holds a local string draft so a trailing comma or space
 *  isn't dropped while the user is mid-type. Commits parsed tags to the
 *  parent on blur or Enter. Re-syncs from props when the underlying tag
 *  array changes (e.g. another quote update overrides). */
function TagInput({ tags, onCommit }: { tags: string[]; onCommit: (next: string[]) => void }) {
  const [draft, setDraft] = useState(tags.join(", "));
  // Re-sync from props only when the joined external value differs from our
  // current draft — otherwise we'd clobber the user's in-progress typing.
  useEffect(() => {
    const external = tags.join(", ");
    setDraft((cur) => (cur.trim() === external.trim() ? cur : external));
    // We intentionally re-run on the joined external value rather than the
    // tags array identity to avoid loops with new array references that
    // describe the same content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags.join(",")]);
  const commit = () => {
    onCommit(parseTags(draft));
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder="tags, comma-separated"
      className="bg-surface border-border text-xs flex-1"
    />
  );
}

export function UserInterviewsClient() {
  const [interviews, setInterviews] = usePersisted<Interview[]>(
    "agile-toolkit:user-interviews",
    []
  );
  const [editing, setEditing] = useState<string | null>(null);
  // BUG-T9-user-interviews-1: opt-in "anonymize on export" — strips
  // emails / phone numbers / API keys from the exported quotes (does
  // not touch participant names; user redacts those manually). The
  // banner above the table reminds the user that stored data is
  // unencrypted on this device.
  const [anonymizeOnExport, setAnonymizeOnExport] = useState(true);
  const { log } = useHistoryLogger("user-interviews");

  const add = () => {
    const i = emptyInterview();
    setInterviews((s) => [i, ...s]);
    setEditing(i.id);
    log(INTERVIEW_ACTIONS.INTERVIEW_ADDED, { interviewId: i.id });
  };
  const update = (id: string, patch: Partial<Interview>) =>
    setInterviews((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => {
    const interview = interviews.find((x) => x.id === id);
    setInterviews((s) => s.filter((x) => x.id !== id));
    if (editing === id) setEditing(null);
    log(INTERVIEW_ACTIONS.INTERVIEW_REMOVED, {
      interviewId: id,
      participant: interview?.participant,
    });
  };
  const addQuote = (iid: string) => {
    setInterviews((s) =>
      s.map((i) =>
        i.id === iid ? { ...i, quotes: [...i.quotes, { id: nanoid(6), text: "", tags: [] }] } : i
      )
    );
    log(INTERVIEW_ACTIONS.INSIGHT_ADDED, { interviewId: iid });
  };
  const updateQuote = (
    iid: string,
    qid: string,
    patch: Partial<{ text: string; tags: string[] }>
  ) =>
    setInterviews((s) =>
      s.map((i) =>
        i.id === iid
          ? { ...i, quotes: i.quotes.map((q) => (q.id === qid ? { ...q, ...patch } : q)) }
          : i
      )
    );
  const removeQuote = (iid: string, qid: string) =>
    setInterviews((s) =>
      s.map((i) => (i.id === iid ? { ...i, quotes: i.quotes.filter((q) => q.id !== qid) } : i))
    );

  const tagFrequency = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of interviews) {
      for (const q of i.quotes) {
        for (const t of q.tags) {
          // Normalize at counting time too, so legacy persisted entries with
          // mixed-case tags collapse into a single frequency bucket.
          const key = t.trim().toLowerCase();
          if (!key) continue;
          m.set(key, (m.get(key) ?? 0) + 1);
        }
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [interviews]);

  const active = interviews.find((i) => i.id === editing) ?? null;

  // After hydration / removal, an `editing` id pointing at a non-existent
  // interview leaves the right pane silently blank. Reset it once we notice.
  useEffect(() => {
    if (editing && !interviews.find((i) => i.id === editing)) {
      setEditing(null);
    }
  }, [editing, interviews]);

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "User Interview Log",
      prompts: generateUserInterviewsPrompts({ interviews, tagFrequency }, workspace),
    }),
    [interviews, tagFrequency, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="user-interviews"
      title="User Interview Log"
      description="Capture quotes, tag themes, and synthesize research across multiple user interviews."
      category="Product Discovery"
    >
      {/* BUG-T9-user-interviews-1: privacy banner. */}
      <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 flex items-start gap-2">
        <Quote className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          Stored unencrypted on this device (and synced to your account if signed in). Don&rsquo;t
          paste customer-identifiable quotes verbatim — redact names, employers, and other PII
          before saving. The toggle below also strips emails / phone numbers / API keys from
          exports.
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
        <label className="text-xs text-sub flex items-center gap-2">
          <input
            type="checkbox"
            checked={anonymizeOnExport}
            onChange={(e) => setAnonymizeOnExport(e.target.checked)}
            aria-label="Anonymize on export"
          />
          Anonymize on export
        </label>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="user-interviews"
          csvData={{
            headers: ["Date", "Participant", "Quote", "Tags"],
            rows: interviews.flatMap((i) =>
              i.quotes.map((q) => [
                i.date,
                anonymizeOnExport ? "[redacted]" : i.participant,
                anonymizeOnExport ? redactPii(q.text) : q.text,
                q.tags.join(", "),
              ])
            ),
          }}
          jsonData={
            anonymizeOnExport
              ? interviews.map((i) => ({
                  ...i,
                  participant: "[redacted]",
                  quotes: i.quotes.map((q) => ({ ...q, text: redactPii(q.text) })),
                }))
              : interviews
          }
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          New Interview
        </Button>
      </div>

      {tagFrequency.length > 0 && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
              <Hash className="w-4 h-4 text-accent" />
              Theme Frequency
            </div>
            <div className="flex flex-wrap gap-2">
              {tagFrequency.slice(0, 24).map(([tag, n]) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="font-data"
                  style={{
                    // Theme-aware accent — cyan in dark, blue in light. The
                    // hardcoded rgb(0,240,255) was invisible in light mode.
                    borderColor: "var(--accent)",
                    borderWidth: 1,
                    opacity: 0.4 + Math.min(0.6, n / 8),
                    color: "var(--accent)",
                    background: "var(--accent-bg)",
                  }}
                >
                  {tag} · {n}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-2">
          {interviews.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => setEditing(i.id)}
              className={`w-full text-left rounded-lg border p-3 transition hover:border-accent/40 ${editing === i.id ? "border-accent/60 bg-accent/5" : "border-border bg-surface"}`}
            >
              <div className="text-sm font-semibold text-text truncate">
                {i.participant || "(unnamed)"}
              </div>
              <div className="text-xs text-sub">
                {i.date} · {i.quotes.length} quote{i.quotes.length === 1 ? "" : "s"}
              </div>
            </button>
          ))}
        </div>

        <div>
          {active ? (
            <Card className="bg-surface border-border">
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-2">
                  <Input
                    value={active.participant}
                    onChange={(e) => update(active.id, { participant: e.target.value })}
                    placeholder="Participant name or pseudonym"
                    className="bg-bg border-border"
                  />
                  <Input
                    type="date"
                    value={active.date}
                    onChange={(e) => update(active.id, { date: e.target.value })}
                    className="bg-bg border-border"
                  />
                </div>
                <Textarea
                  rows={2}
                  value={active.context ?? ""}
                  onChange={(e) => update(active.id, { context: e.target.value })}
                  placeholder="Context (role, product use, what we were exploring)"
                  className="bg-bg border-border"
                />
                <div className="space-y-2">
                  <div className="text-xs uppercase text-sub flex items-center gap-1">
                    <Quote className="w-3.5 h-3.5" /> Quotes
                  </div>
                  {active.quotes.map((q) => (
                    <div key={q.id} className="rounded-md border border-border bg-bg p-2 space-y-2">
                      <Textarea
                        rows={2}
                        value={q.text}
                        onChange={(e) => updateQuote(active.id, q.id, { text: e.target.value })}
                        placeholder='"..."'
                        className="bg-surface border-border text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <TagInput
                          tags={q.tags}
                          onCommit={(next) => updateQuote(active.id, q.id, { tags: next })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeQuote(active.id, q.id)}
                          className="text-sub hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addQuote(active.id)}
                    className="gap-2 border-border text-sub hover:text-accent"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Quote
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => remove(active.id)}
                    className="gap-2 border-danger/40 text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Interview
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState>Select or create an interview to begin capturing quotes.</EmptyState>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
