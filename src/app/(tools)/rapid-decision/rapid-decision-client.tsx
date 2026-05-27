"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Users, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RAPIDDecision, Workspace } from "@/lib/stores/workspace-types";
import { generateRapidPrompts } from "@/lib/ai-prompts/rapid-decision";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RAPID_ACTIONS } from "@/lib/history/event-actions";

const STATUSES: RAPIDDecision["status"][] = ["open", "decided", "implemented"];

export function RapidDecisionClient() {
  const list = useWorkspaceStore((s) => s.rapidDecisions ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertRAPIDDecision);
  const removeOne = useWorkspaceStore((s) => s.removeRAPIDDecision);
  const { log } = useHistoryLogger("rapid-decision");
  const exportRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Omit<RAPIDDecision, "id" | "date">>({
    title: "",
    context: "",
    recommend: "",
    agree: [],
    perform: [],
    input: [],
    decide: "",
    status: "open",
  });
  // BUG-T6-rapid-decision-2: keep raw string buffers for the three list
  // inputs (agree/perform/input). The previous per-keystroke split-and-
  // filter pattern made it impossible to type names that include commas
  // or to add a second entry without trickery.
  const [agreeDraft, setAgreeDraft] = useState("");
  const [performDraft, setPerformDraft] = useState("");
  const [inputDraft, setInputDraft] = useState("");
  const splitList = (raw: string): string[] =>
    raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  function add() {
    if (!draft.title.trim()) return;
    // Apply any in-progress list drafts so trailing characters still land.
    const agree = agreeDraft.trim() ? splitList(agreeDraft) : (draft.agree ?? []);
    const perform = performDraft.trim() ? splitList(performDraft) : (draft.perform ?? []);
    const input = inputDraft.trim() ? splitList(inputDraft) : (draft.input ?? []);
    const item: RAPIDDecision = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      ...draft,
      agree,
      perform,
      input,
    };
    upsert(item);
    log(RAPID_ACTIONS.DECISION_ADDED, { title: item.title });
    // BUG-T6-rapid-decision-1: do NOT emitSignal here — the signal-bridge
    // already watches the workspace store and fires `decision.rapidCreated`
    // on add. Direct emit + bridge emit = double-fire for every subscriber.
    setDraft({
      title: "",
      context: "",
      recommend: "",
      agree: [],
      perform: [],
      input: [],
      decide: "",
      status: "open",
    });
    setAgreeDraft("");
    setPerformDraft("");
    setInputDraft("");
  }

  function decide(d: RAPIDDecision) {
    const next: RAPIDDecision = { ...d, status: "decided" };
    upsert(next);
    log(RAPID_ACTIONS.DECISION_DECIDED, { title: d.title });
  }

  function remove(id: string) {
    removeOne(id);
    log(RAPID_ACTIONS.DECISION_REMOVED, { id });
  }

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
        rapidDecisions: s.rapidDecisions,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "RAPID Decisions",
      prompts: generateRapidPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  // Full RAPID shape, not just Recommend/Decide. The dropped fields
  // (Agree, Perform, Input, Context, date) are the rows that matter for
  // re-import and stakeholder share — a slim CSV gave a misleading
  // picture of who actually owned each role on each decision.
  const csvData = {
    headers: [
      "Date",
      "Title",
      "Context",
      "Recommend",
      "Agree",
      "Perform",
      "Input",
      "Decide",
      "Status",
    ],
    rows: list.map((d) => [
      d.date ?? "",
      d.title,
      d.context ?? "",
      d.recommend ?? "",
      (d.agree ?? []).join("; "),
      (d.perform ?? []).join("; "),
      (d.input ?? []).join("; "),
      d.decide ?? "",
      d.status,
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="rapid-decision"
      title="RAPID Decision Matrix"
      description="Bain's Recommend / Agree / Perform / Input / Decide model for governance-heavy decisions."
    >
      <div ref={exportRef} className="space-y-4">
        <SectionCard title="New decision" icon={Plus}>
          <Input
            placeholder="Decision title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Textarea
            placeholder="Context"
            value={draft.context ?? ""}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Input
              placeholder="Recommend (R) — owns the proposal"
              value={draft.recommend ?? ""}
              onChange={(e) => setDraft({ ...draft, recommend: e.target.value })}
            />
            <Input
              placeholder="Decide (D) — final say"
              value={draft.decide ?? ""}
              onChange={(e) => setDraft({ ...draft, decide: e.target.value })}
            />
            <Input
              placeholder="Agree (A) — must agree, comma-sep"
              value={agreeDraft || (draft.agree ?? []).join(", ")}
              onChange={(e) => setAgreeDraft(e.target.value)}
              onBlur={() => {
                setDraft({ ...draft, agree: splitList(agreeDraft) });
                setAgreeDraft("");
              }}
            />
            <Input
              placeholder="Perform (P) — execute, comma-sep"
              value={performDraft || (draft.perform ?? []).join(", ")}
              onChange={(e) => setPerformDraft(e.target.value)}
              onBlur={() => {
                setDraft({ ...draft, perform: splitList(performDraft) });
                setPerformDraft("");
              }}
            />
            <Input
              className="sm:col-span-2"
              placeholder="Input (I) — give input, comma-sep"
              value={inputDraft || (draft.input ?? []).join(", ")}
              onChange={(e) => setInputDraft(e.target.value)}
              onBlur={() => {
                setDraft({ ...draft, input: splitList(inputDraft) });
                setInputDraft("");
              }}
            />
          </div>
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Decisions (${list.length})`}
            icon={Users}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="rapid-decisions"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-2">
              {list.map((d) => (
                <li key={d.id} className="border border-border bg-surface-deep rounded p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-text">{d.title}</span>
                    <span className="flex items-center gap-2">
                      <Select
                        value={d.status}
                        onValueChange={(v) =>
                          upsert({ ...d, status: v as RAPIDDecision["status"] })
                        }
                      >
                        <SelectTrigger className="h-7 w-32 text-xs min-touch-coarse">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {d.status === "open" && (
                        <button
                          onClick={() => decide(d)}
                          className="text-emerald-400 hover:text-emerald-300"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => remove(d.id)}
                        aria-label="Remove decision"
                        className="text-sub hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </span>
                  </div>
                  {d.context && <p className="text-xs text-sub italic mb-1">{d.context}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                    {d.recommend && (
                      <div>
                        <span className="text-cyan-400 font-bold">R:</span> {d.recommend}
                      </div>
                    )}
                    {d.decide && (
                      <div>
                        <span className="text-pink-400 font-bold">D:</span> {d.decide}
                      </div>
                    )}
                    {d.agree && d.agree.length > 0 && (
                      <div>
                        <span className="text-emerald-400 font-bold">A:</span> {d.agree.join(", ")}
                      </div>
                    )}
                    {d.perform && d.perform.length > 0 && (
                      <div>
                        <span className="text-amber-400 font-bold">P:</span> {d.perform.join(", ")}
                      </div>
                    )}
                    {d.input && d.input.length > 0 && (
                      <div className="col-span-2">
                        <span className="text-purple-400 font-bold">I:</span> {d.input.join(", ")}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}
