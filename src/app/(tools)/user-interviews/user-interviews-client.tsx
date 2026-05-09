"use client";

import { useMemo, useState } from "react";
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
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { INTERVIEW_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { EmptyState } from "@/components/shared/empty-state";

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

export function UserInterviewsClient() {
  const [interviews, setInterviews] = usePersisted<Interview[]>("agile-toolkit:user-interviews", []);
  const [editing, setEditing] = useState<string | null>(null);
  const { log } = useHistoryLogger("user-interviews");

  const add = () => {
    const i = emptyInterview();
    setInterviews((s) => [i, ...s]);
    setEditing(i.id);
    log(INTERVIEW_ACTIONS.INTERVIEW_ADDED, { interviewId: i.id });
  };
  const update = (id: string, patch: Partial<Interview>) => setInterviews((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
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
          m.set(t, (m.get(t) ?? 0) + 1);
        }
      }
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [interviews]);

  const active = interviews.find((i) => i.id === editing) ?? null;

  const promptConfig = useMemo(
    () => ({
      toolName: "User Interview Log",
      prompts: generateUserInterviewsPrompts({ interviews, tagFrequency }),
    }),
    [interviews, tagFrequency]
  );

  return (
    <ToolPageWrapper
      toolId="user-interviews"
      title="User Interview Log"
      description="Capture quotes, tag themes, and synthesize research across multiple user interviews."
      category="Product Discovery"
    >
      <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="user-interviews"
          csvData={{
            headers: ["Date", "Participant", "Quote", "Tags"],
            rows: interviews.flatMap((i) => i.quotes.map((q) => [i.date, i.participant, q.text, q.tags.join(", ")])),
          }}
          jsonData={interviews}
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
                    borderColor: `rgba(0,240,255,${Math.min(1, n / 8)})`,
                    color: "var(--accent)",
                    background: `rgba(0,240,255,${Math.min(0.3, n / 20)})`,
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
              <div className="text-sm font-semibold text-text truncate">{i.participant || "(unnamed)"}</div>
              <div className="text-xs text-sub">{i.date} · {i.quotes.length} quote{i.quotes.length === 1 ? "" : "s"}</div>
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
                        placeholder="&quot;...&quot;"
                        className="bg-surface border-border text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          value={q.tags.join(", ")}
                          onChange={(e) => updateQuote(active.id, q.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                          placeholder="tags, comma-separated"
                          className="bg-surface border-border text-xs flex-1"
                        />
                        <Button variant="ghost" size="sm" onClick={() => removeQuote(active.id, q.id)} className="text-sub hover:text-danger">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addQuote(active.id)} className="gap-2 border-border text-sub hover:text-accent">
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
            <EmptyState>
              Select or create an interview to begin capturing quotes.
            </EmptyState>
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
