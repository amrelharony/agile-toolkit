"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Quote } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResortChip } from "@/components/shared/resort-chip";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useStableOrder } from "@/hooks/use-stable-order";
import { generateUserInterviewsPrompts } from "@/lib/ai-prompts/user-interviews";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { INTERVIEW_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  UI_ID,
  participantCount,
  quoteOpportunitySource,
  quotesTagged,
  themeCounts,
} from "@/lib/interviews/model";
import { treeNodes } from "@/lib/opportunity-tree/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Interview,
  InterviewQuote,
  OpportunityTree,
  UserInterviewLog,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { useShallow } from "zustand/react/shallow";
import { buildExample } from "./example";
import { applyInterviewValues, type InterviewValues, type QuoteValues } from "./form";
import { InterviewPane } from "./interview-pane";
import { interviewsToMarkdown } from "./markdown";
import { NewInterviewForm } from "./new-interview-form";
import { TaggedQuotes, ThemePanel } from "./themes";
import { anonymisedById, compareInterviews, forExport, interviewsVerdict } from "./view";

// Stable empty lists: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NO_LOGS: UserInterviewLog[] = [];
const NO_TREES: OpportunityTree[] = [];
const NONE: Interview[] = [];

const keyOf = (i: Interview) => i.id;
const nameOf = (i: Pick<Interview, "participant">) =>
  i.participant?.trim() || "an unnamed participant";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * User Interview Log: interviews and the tagged quotes from them. A theme
 * counts the participants who raised it, not the quotes (lib/interviews,
 * as tool.user_interviews counts it); a theme opens the quotes behind it
 * across interviews. Anonymising (on by default) numbers the participants
 * and redacts context and quotes in that view, every export and the AI
 * prompt. A quote can be raised as an opportunity on the Opportunity Tree,
 * with its redacted words and never the participant's name.
 */
export function UserInterviewsClient() {
  const hydrated = useWorkspaceHydrated();
  const logs = useWorkspaceStore((s) => s.userInterviewLogs) ?? NO_LOGS;
  const trees = useWorkspaceStore((s) => s.opportunityTrees) ?? NO_TREES;
  const interviews = logs.find((d) => d.id === UI_ID)?.interviews ?? NONE;
  const nodes = treeNodes(trees);
  const today = todayLocalISO();
  const { log } = useHistoryLogger("user-interviews");
  const announce = useAnnounce();
  // Only the owner's data leaves the browser (cloud sync is owner-only).
  const isOwner = useIsOwner();
  const [selected, setSelected] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [anonymise, setAnonymise] = useState(true);
  const paneRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const themes = useMemo(() => themeCounts(interviews), [interviews]);
  const people = useMemo(() => participantCount(interviews), [interviews]);
  const anon = useMemo(() => anonymisedById(interviews), [interviews]);
  const shownAs = (i: Interview) => (anonymise ? (anon.get(i.id) ?? i) : i);
  const tag = activeTag && themes.some((t) => t.tag === activeTag) ? activeTag : null;
  const listed = useMemo(
    () => (tag ? interviews.filter((i) => quotesTagged([i], tag).length > 0) : interviews),
    [interviews, tag]
  );
  // Newest first; editing a day doesn't move the row until "Re-sort".
  const { ordered, isStale, resort } = useStableOrder(listed, keyOf, compareInterviews);
  const active = interviews.find((i) => i.id === selected) ?? null;
  const quoteCount = interviews.reduce((n, i) => n + (i.quotes ?? []).length, 0);

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const currentList = () => (ws().userInterviewLogs ?? []).find((d) => d.id === UI_ID);
  const updateList = (fn: (list: readonly Interview[]) => Interview[]) => {
    const doc = currentList();
    ws().upsertUserInterviewLog({
      ...(doc ?? {}),
      id: UI_ID,
      interviews: fn(doc?.interviews ?? []),
    });
  };
  const patchInterview = (id: string, fn: (i: Interview) => Interview) =>
    updateList((list) => list.map((i) => (i.id === id ? fn(i) : i)));
  const freshInterview = (id: string) => currentList()?.interviews.find((i) => i.id === id);
  const patchQuote = (iid: string, qid: string, fn: (q: InterviewQuote) => InterviewQuote) =>
    patchInterview(iid, (i) => ({
      ...i,
      quotes: (i.quotes ?? []).map((q) => (q.id === qid ? fn(q) : q)),
    }));
  // Example rows aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };

  const open = (id: string) => {
    setSelected(id);
    // On a phone the pane sits under the list: focusing its heading brings it into view.
    requestAnimationFrame(() => paneRef.current?.focus());
  };

  function add(values: InterviewValues) {
    const i = applyInterviewValues(
      { id: nanoid(8), participant: "", date: today, quotes: [] },
      values
    );
    updateList((list) => [i, ...list]);
    record(i.id, INTERVIEW_ACTIONS.INTERVIEW_ADDED, { interviewId: i.id });
    setActiveTag(null);
    announce(`Added the interview with ${nameOf(i)}`);
    open(i.id);
  }

  function saveInterview(i: Interview, values: InterviewValues, fields: string[]) {
    const next = applyInterviewValues(i, values);
    if (JSON.stringify(next) === JSON.stringify(i)) return;
    patchInterview(i.id, () => next);
    record(i.id, INTERVIEW_ACTIONS.INTERVIEW_UPDATED, { interviewId: i.id, fields });
    announce(`Saved the interview with ${nameOf(next)}`);
  }

  function removeInterview(i: Interview) {
    const quotes = (i.quotes ?? []).length;
    let index = -1;
    let removed: Interview | undefined;
    undoable({
      label: `Deleted the interview with ${nameOf(i)} (${plural(quotes, "quote")})`,
      apply: () =>
        updateList((list) => {
          index = list.findIndex((x) => x.id === i.id);
          removed = list[index];
          return list.filter((x) => x.id !== i.id);
        }),
      revert: () => {
        const back = removed;
        if (!back) return;
        // Back in its place, and open again.
        updateList((list) => {
          const next = [...list];
          next.splice(Math.min(Math.max(index, 0), next.length), 0, back);
          return next;
        });
        setSelected(back.id);
      },
    });
    setSelected(null);
    record(i.id, INTERVIEW_ACTIONS.INTERVIEW_REMOVED, { interviewId: i.id, quotes });
    announce(`Deleted the interview with ${nameOf(i)}`);
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[data-new-interview], input")?.focus()
    );
  }

  function addQuote(i: Interview, values: QuoteValues) {
    const q: InterviewQuote = { id: nanoid(8), text: values.text, tags: values.tags };
    patchInterview(i.id, (x) => ({ ...x, quotes: [...(x.quotes ?? []), q] }));
    record(i.id, INTERVIEW_ACTIONS.INSIGHT_ADDED, { interviewId: i.id, quoteId: q.id });
    announce(`Added a quote from ${nameOf(i)}`);
  }

  function saveQuote(i: Interview, q: InterviewQuote, values: QuoteValues) {
    const next: InterviewQuote = { ...q, text: values.text, tags: values.tags };
    if (JSON.stringify(next) === JSON.stringify(q)) return;
    patchQuote(i.id, q.id, () => next);
    record(i.id, INTERVIEW_ACTIONS.INTERVIEW_UPDATED, {
      interviewId: i.id,
      quoteId: q.id,
      fields: ["quote"],
    });
    announce("Saved the quote");
  }

  function removeQuote(i: Interview, q: InterviewQuote) {
    removeWithUndo<InterviewQuote>({
      label: "Deleted the quote",
      description: `From the interview with ${nameOf(i)}`,
      update: (fn) => patchInterview(i.id, (x) => ({ ...x, quotes: fn(x.quotes ?? []) })),
      match: (x) => x.id === q.id,
    });
    record(i.id, INTERVIEW_ACTIONS.QUOTE_REMOVED, { interviewId: i.id, quoteId: q.id });
    announce("Deleted the quote");
  }

  function sendQuote(i: Interview, q: InterviewQuote, parentId: string | undefined) {
    const interview = freshInterview(i.id) ?? i;
    const quote = interview.quotes.find((x) => x.id === q.id) ?? q;
    const link = sendHandoff("opportunity", quoteOpportunitySource(quote, interview, parentId), {
      getLinks: () => freshInterview(i.id)?.quotes.find((x) => x.id === q.id)?.sentTo,
      setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
        patchQuote(i.id, q.id, (x) => ({ ...x, sentTo: update(x.sentTo) })),
    });
    if (!link) return;
    record(i.id, INTERVIEW_ACTIONS.QUOTE_SENT, {
      interviewId: i.id,
      quoteId: q.id,
      nodeId: link.targetId,
    });
    announce("The quote is now an opportunity on the Opportunity Tree");
  }

  const loadExample = () => updateList((list) => [...buildExample(today), ...list]);
  const clearExample = () => {
    if (selected && isExampleId(selected)) setSelected(null);
    updateList((list) => list.filter((i) => !isExampleId(i.id)));
  };

  /* ── Exports ── */

  // Newest first, as the list reads; the pseudonyms number by first interview either way.
  const exported = forExport([...interviews].sort(compareInterviews), anonymise);
  const csvData = {
    headers: ["Date", "Participant", "Context", "Quote", "Tags", "On the Opportunity Tree"],
    rows: exported.flatMap((i) => {
      const quotes = i.quotes ?? [];
      const base = [(i.date ?? "").slice(0, 10), i.participant ?? "", i.context ?? ""];
      if (quotes.length === 0) return [[...base, "", "", ""]];
      return quotes.map((q) => [
        ...base,
        q.text ?? "",
        (q.tags ?? []).join(", "),
        liveLink(q.sentTo, "opportunity") ? "yes" : "",
      ]);
    }),
  };
  const markdown = interviewsToMarkdown(interviews, { anonymise });

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
      // The prompt follows the toggle: anonymised interviews when it is on.
      prompts: generateUserInterviewsPrompts(
        {
          interviews: forExport(interviews, anonymise),
          tagFrequency: themes.map((t) => [t.tag, t.participants] as [string, number]),
        },
        workspace
      ),
    }),
    [interviews, anonymise, themes, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="user-interviews"
      title="User Interview Log"
      description="Capture quotes, tag themes, and see which themes most participants raise across interviews."
      category="Product Discovery"
    >
      <div className="space-y-6">
        {hasExampleItems(interviews) && <ExampleNotice onClear={clearExample} />}

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text">
          <Quote className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            Stored unencrypted in this browser{isOwner ? " and synced to your cloud workspace" : ""}
            . Redact names, employers and other details before saving. While “Anonymise” is on, the
            theme view, every export and the AI prompt number the participants and take emails,
            phone numbers and their names out of the context and the quotes.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3" ref={formRef}>
          <NewInterviewForm today={today} onAdd={add} />
          {interviews.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={anonymise}
                  onChange={(e) => setAnonymise(e.target.checked)}
                />
                Anonymise
              </label>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="user-interviews"
                csvData={csvData}
                jsonData={exported}
                markdown={markdown}
              />
            </div>
          )}
        </div>

        {interviews.length === 0 ? (
          hydrated && (
            <EmptyState icon={Quote} action={<LoadExampleButton onLoad={loadExample} />}>
              No interviews yet. Use “New interview” after each conversation, add the quotes that
              stood out and tag their themes, or load an example to see the themes counted.
            </EmptyState>
          )
        ) : (
          <>
            <p className="text-sm font-medium text-text">{interviewsVerdict(interviews)}</p>
            <KpiGrid cols={3}>
              <StatCard variant="compact" label="Interviews" value={interviews.length} />
              <StatCard
                variant="compact"
                label="Participants"
                value={people}
                hint="matched by name"
              />
              <StatCard variant="compact" label="Quotes" value={quoteCount} />
            </KpiGrid>

            {themes.length > 0 && (
              <ThemePanel
                themes={themes}
                people={people}
                active={tag}
                onToggle={(t) => setActiveTag((cur) => (cur === t ? null : t))}
              />
            )}
            {tag && (
              <TaggedQuotes
                tag={tag}
                interviews={interviews}
                shownAs={shownAs}
                onOpen={open}
                onClear={() => setActiveTag(null)}
              />
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr] lg:grid-cols-[320px_1fr]">
              <div className="min-w-0 space-y-2">
                {tag && (
                  <p className="text-xs text-sub" role="status">
                    {plural(ordered.length, "interview")} with “{tag}”
                  </p>
                )}
                <ResortChip isStale={isStale} onResort={resort} what="Dates" />
                <ul className="space-y-2" aria-label="Interviews, newest first">
                  {ordered.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => open(i.id)}
                        aria-pressed={selected === i.id}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          selected === i.id
                            ? "border-accent/60 bg-accent/5"
                            : "border-border bg-surface"
                        )}
                      >
                        <span className="block truncate text-sm font-semibold text-text">
                          {i.participant?.trim() || "(unnamed)"}
                        </span>
                        <span className="block text-xs text-sub">
                          {(i.date ?? "").slice(0, 10) || "undated"} ·{" "}
                          {plural((i.quotes ?? []).length, "quote")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="min-w-0">
                {active ? (
                  <InterviewPane
                    key={active.id}
                    ref={paneRef}
                    interview={active}
                    today={today}
                    nodes={nodes}
                    onSave={saveInterview}
                    onRemove={removeInterview}
                    onAddQuote={addQuote}
                    onSaveQuote={saveQuote}
                    onRemoveQuote={removeQuote}
                    onSendQuote={sendQuote}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-sub">
                    Pick an interview to see and add its quotes.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}
