"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Crown, Plus, Trash2, CheckCircle2 } from "lucide-react";
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
import type { DACIDecision, Workspace } from "@/lib/stores/workspace-types";
import { generateDaciPrompts } from "@/lib/ai-prompts/daci";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DACI_ACTIONS } from "@/lib/history/event-actions";
import { emitSignal } from "@/lib/signals/signal-bus";

const STATUSES: DACIDecision["status"][] = ["open", "decided", "implemented", "revisit"];

export function DaciClient() {
  const list = useWorkspaceStore((s) => s.daciDecisions ?? []);
  const upsert = useWorkspaceStore((s) => s.upsertDACIDecision);
  const removeOne = useWorkspaceStore((s) => s.removeDACIDecision);
  const { log } = useHistoryLogger("daci");
  const exportRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<Omit<DACIDecision, "id" | "date">>({
    title: "",
    context: "",
    driver: "",
    approver: "",
    contributors: [],
    informed: [],
    options: [],
    recommendation: "",
    status: "open",
  });
  // BUG-T2-daci-1: keep raw string buffers for list-typed inputs so
  // typing "Alice, Bob" doesn't get split-and-filter'd on every keystroke
  // (the old onChange immediately stripped trailing commas/whitespace,
  // making the inputs effectively unusable). Commit to the structured
  // array shape only on blur or just-before-add.
  //
  // `null` means "no raw buffer — display the committed array"; it is NOT the
  // same as `""`, which means "the user has deliberately emptied the field".
  // With a plain `""` sentinel the field could never be cleared: onChange set
  // the buffer to `""`, the state was already `""` so React bailed out of the
  // re-render, and React's controlled-input restore wrote the old joined value
  // straight back into the DOM node.
  const [contribDraft, setContribDraft] = useState<string | null>(null);
  const [informedDraft, setInformedDraft] = useState<string | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<string | null>(null);
  // splitList: trim + drop empty entries from a separator-delimited string.
  const splitList = (raw: string, sep: string | RegExp): string[] =>
    raw
      .split(sep)
      .map((x) => x.trim())
      .filter(Boolean);

  function add() {
    if (!draft.title.trim()) return;
    // Apply any in-progress list drafts so trailing characters the user
    // hasn't blurred yet still make it into the record. Gate on `!== null`,
    // not on truthiness: an empty buffer is a real edit ("I cleared this"),
    // and falling back to the committed array there re-added the very names
    // the user had just deleted.
    const contributors =
      contribDraft !== null ? splitList(contribDraft, ",") : (draft.contributors ?? []);
    const informed =
      informedDraft !== null ? splitList(informedDraft, ",") : (draft.informed ?? []);
    const options = optionsDraft !== null ? splitList(optionsDraft, /\n/) : (draft.options ?? []);
    const item: DACIDecision = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      ...draft,
      contributors,
      informed,
      options,
    };
    upsert(item);
    log(DACI_ACTIONS.DECISION_ADDED, { title: item.title });
    emitSignal({ kind: "decision.daciCreated", at: item.date, toolId: "daci", payload: item });
    setDraft({
      title: "",
      context: "",
      driver: "",
      approver: "",
      contributors: [],
      informed: [],
      options: [],
      recommendation: "",
      status: "open",
    });
    setContribDraft(null);
    setInformedDraft(null);
    setOptionsDraft(null);
  }

  function decide(d: DACIDecision) {
    const next: DACIDecision = { ...d, status: "decided" };
    upsert(next);
    log(DACI_ACTIONS.DECISION_DECIDED, { title: d.title });
  }

  function setStatus(d: DACIDecision, s: DACIDecision["status"]) {
    upsert({ ...d, status: s });
    log(DACI_ACTIONS.DECISION_UPDATED, { id: d.id, status: s });
  }

  function remove(id: string) {
    removeOne(id);
    log(DACI_ACTIONS.DECISION_REMOVED, { id });
  }

  const open = list.filter((x) => x.status === "open").length;

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
        daciDecisions: s.daciDecisions,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "DACI Decisions",
      prompts: generateDaciPrompts({ items: list }, workspace),
    }),
    [list, workspace]
  );

  // CSV export carries the full DACI shape, not just Driver/Approver. The
  // prior export silently dropped Contributors, Informed, Context, Options,
  // and the date — a user re-importing the file or sharing it with a
  // stakeholder would see a half-empty decision record.
  const csvData = {
    headers: [
      "Date",
      "Title",
      "Context",
      "Driver",
      "Approver",
      "Contributors",
      "Informed",
      "Options",
      "Recommendation",
      "Status",
    ],
    rows: list.map((d) => [
      d.date ?? "",
      d.title,
      d.context ?? "",
      d.driver ?? "",
      d.approver ?? "",
      (d.contributors ?? []).join("; "),
      (d.informed ?? []).join("; "),
      (d.options ?? []).join("; "),
      d.recommendation ?? "",
      d.status,
    ]),
  };

  return (
    <ToolPageWrapper
      toolId="daci"
      title="DACI Decision Doc"
      description="Assign Driver / Approver / Contributors / Informed roles to each decision (Atlassian/Intuit framework)."
    >
      <div ref={exportRef} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <KPI label="Total" value={String(list.length)} />
          <KPI label="Open" value={String(open)} tone={open > 0 ? "danger" : "ok"} />
          <KPI
            label="Decided"
            value={String(
              list.filter((x) => x.status === "decided" || x.status === "implemented").length
            )}
            tone="ok"
          />
        </div>

        <SectionCard title="Draft new decision" icon={Plus}>
          <Input
            placeholder="Decision title"
            aria-label="Decision title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Textarea
            placeholder="Context — why are we deciding this?"
            aria-label="Context"
            value={draft.context ?? ""}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <Input
              placeholder="Driver (the one making it happen)"
              aria-label="Driver"
              value={draft.driver ?? ""}
              onChange={(e) => setDraft({ ...draft, driver: e.target.value })}
            />
            <Input
              placeholder="Approver (final say)"
              aria-label="Approver"
              value={draft.approver ?? ""}
              onChange={(e) => setDraft({ ...draft, approver: e.target.value })}
            />
            <Input
              placeholder="Contributors (comma-separated)"
              aria-label="Contributors (comma-separated)"
              value={contribDraft ?? (draft.contributors ?? []).join(", ")}
              onChange={(e) => setContribDraft(e.target.value)}
              onBlur={() => {
                if (contribDraft === null) return;
                setDraft({ ...draft, contributors: splitList(contribDraft, ",") });
                setContribDraft(null);
              }}
            />
            <Input
              placeholder="Informed (comma-separated)"
              aria-label="Informed (comma-separated)"
              value={informedDraft ?? (draft.informed ?? []).join(", ")}
              onChange={(e) => setInformedDraft(e.target.value)}
              onBlur={() => {
                if (informedDraft === null) return;
                setDraft({ ...draft, informed: splitList(informedDraft, ",") });
                setInformedDraft(null);
              }}
            />
          </div>
          <Textarea
            placeholder="Options considered (one per line)"
            aria-label="Options considered (one per line)"
            value={optionsDraft ?? (draft.options ?? []).join("\n")}
            onChange={(e) => setOptionsDraft(e.target.value)}
            onBlur={() => {
              if (optionsDraft === null) return;
              setDraft({ ...draft, options: splitList(optionsDraft, /\n/) });
              setOptionsDraft(null);
            }}
            className="mt-2"
            rows={3}
          />
          <Textarea
            placeholder="Recommendation"
            aria-label="Recommendation"
            value={draft.recommendation ?? ""}
            onChange={(e) => setDraft({ ...draft, recommendation: e.target.value })}
            className="mt-2"
            rows={2}
          />
          <Button onClick={add} className="mt-3 gap-1">
            <Plus className="w-4 h-4" />
            Add decision
          </Button>
        </SectionCard>

        {list.length > 0 && (
          <SectionCard
            title={`Decisions (${list.length})`}
            icon={Crown}
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="daci-decisions"
                  csvData={csvData}
                  jsonData={list}
                  targetRef={exportRef}
                />
              </>
            }
          >
            <ul className="space-y-2">
              {[...list]
                .sort((a, b) => {
                  // BUG-T2-daci-3: NaN-safe date sort. A persisted DACI with
                  // missing/malformed `date` would otherwise crash NaN-NaN=NaN
                  // through compare; default to epoch so they sink to the bottom.
                  const tb = Date.parse(b.date ?? "");
                  const ta = Date.parse(a.date ?? "");
                  return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
                })
                .map((d) => (
                  <li
                    key={d.id}
                    className="border border-border bg-surface-deep rounded p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-text">{d.title}</span>
                      <span className="flex items-center gap-2">
                        <Select
                          value={d.status}
                          onValueChange={(v) => setStatus(d, v as DACIDecision["status"])}
                        >
                          <SelectTrigger
                            className="h-7 w-32 text-xs min-touch-coarse"
                            aria-label={`Status for ${d.title}`}
                          >
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
                            aria-label={`Mark decided: ${d.title}`}
                            title="Mark decided"
                            className="text-success hover:text-success"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => remove(d.id)}
                          aria-label={`Remove decision: ${d.title}`}
                          className="text-sub hover:text-danger"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </span>
                    </div>
                    {d.context && <p className="text-xs text-sub italic mb-1">{d.context}</p>}
                    <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                      {d.driver && (
                        <div>
                          <span className="text-cyan-400 font-bold">D:</span> {d.driver}
                        </div>
                      )}
                      {d.approver && (
                        <div>
                          <span className="text-pink-400 font-bold">A:</span> {d.approver}
                        </div>
                      )}
                      {d.contributors && d.contributors.length > 0 && (
                        <div>
                          <span className="text-success font-bold">C:</span>{" "}
                          {d.contributors.join(", ")}
                        </div>
                      )}
                      {d.informed && d.informed.length > 0 && (
                        <div>
                          <span className="text-warning font-bold">I:</span> {d.informed.join(", ")}
                        </div>
                      )}
                    </div>
                    {d.recommendation && (
                      <p className="text-xs text-text mt-2">
                        <span className="text-sub">Rec:</span> {d.recommendation}
                      </p>
                    )}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </ToolPageWrapper>
  );
}

function KPI({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger";
}) {
  const colorClass =
    tone === "danger" ? "text-danger" : tone === "ok" ? "text-success" : "text-text";
  return (
    <div className="rounded-md border border-border bg-surface-deep p-3">
      <div className="text-xs text-sub uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold mt-1 font-data ${colorClass}`}>{value}</div>
    </div>
  );
}
