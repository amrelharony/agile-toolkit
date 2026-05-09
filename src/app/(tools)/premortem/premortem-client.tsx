"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ScrollText, ChevronUp, ChevronDown } from "lucide-react";
import { generatePremortemPrompts } from "@/lib/ai-prompts/premortem";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PREMORTEM_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { usePersisted } from "@/lib/utils/use-persisted";

interface Cause {
  id: string;
  text: string;
  // Optional elaboration on the cause itself — distinct from `text` (the
  // one-line cause name) and `preventiveAction` (the response).
  description?: string;
  likelihood: number;
  impact: number;
  preventiveAction?: string;
  owner?: string;
}

interface State {
  scenario: string;
  causes: Cause[];
}

const DEFAULT_STATE: State = { scenario: "", causes: [] };

/**
 * Numeric input with a string draft buffer so typing a value doesn't snap
 * mid-edit. Commits on blur or Enter and clamps to [min, max].
 */
function NumCell({
  value,
  onChange,
  min,
  max,
  className,
  placeholder,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
      placeholder={placeholder}
      title={title}
    />
  );
}

export function PremortemClient() {
  const [state, setState] = usePersisted<State>("agile-toolkit:premortem", DEFAULT_STATE);
  const { log } = useHistoryLogger("premortem");
  // Track which causes have already emitted PREVENTION_ADDED so the audit
  // log records the milestone once (empty → non-empty), not on every blur.
  const preventionLoggedRef = useRef<Set<string>>(new Set());
  // Seed from persisted state on first hydration so a page reload doesn't
  // re-emit PREVENTION_ADDED for causes that already have a preventive
  // action saved. usePersisted hydrates in a post-mount effect, so the ref
  // can't be initialized synchronously from `state`.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (state.causes.length === 0) return;
    for (const c of state.causes) {
      if ((c.preventiveAction ?? "").trim().length > 0) {
        preventionLoggedRef.current.add(c.id);
      }
    }
    seededRef.current = true;
  }, [state.causes]);

  const add = () => {
    const cause = { id: nanoid(6), text: "", likelihood: 3, impact: 3 };
    setState((s) => ({ ...s, causes: [...s.causes, cause] }));
    log(PREMORTEM_ACTIONS.CAUSE_ADDED, { causeId: cause.id });
  };
  const update = (id: string, patch: Partial<Cause>) => {
    setState((s) => ({ ...s, causes: s.causes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  };
  // Separate from `update` so we can call it from onBlur on the
  // preventiveAction Textarea — emitting PREVENTION_ADDED on every keystroke
  // (the previous behaviour) flooded the history with one event per character.
  const commitPrevention = (id: string, action: string) => {
    const trimmed = action.trim();
    if (trimmed.length === 0) return;
    if (preventionLoggedRef.current.has(id)) return;
    preventionLoggedRef.current.add(id);
    const cause = state.causes.find((c) => c.id === id);
    log(PREMORTEM_ACTIONS.PREVENTION_ADDED, {
      causeId: id,
      owner: cause?.owner,
    });
  };
  const remove = (id: string) => {
    const cause = state.causes.find((c) => c.id === id);
    preventionLoggedRef.current.delete(id);
    setState((s) => ({ ...s, causes: s.causes.filter((c) => c.id !== id) }));
    log(PREMORTEM_ACTIONS.CAUSE_REMOVED, { causeId: id, text: cause?.text });
  };
  const move = (id: string, dir: -1 | 1) =>
    setState((s) => {
      const idx = s.causes.findIndex((c) => c.id === id);
      if (idx < 0) return s;
      const next = idx + dir;
      if (next < 0 || next >= s.causes.length) return s;
      const copy = s.causes.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return { ...s, causes: copy };
    });

  // Previously we exposed a `ranked` (likelihood × impact, desc) memo for the
  // CSV export, but the export now follows display order (preserving manual
  // reorders), so the rank-by-score derivation is no longer needed anywhere.

  const promptConfig = useMemo(
    () => ({
      toolName: "Premortem Facilitator",
      prompts: generatePremortemPrompts({ scenario: state.scenario, causes: state.causes }),
    }),
    [state]
  );

  return (
    <ToolPageWrapper
      toolId="premortem"
      title="Premortem Facilitator"
      description="Imagine this project failed — what would have caused it? Rank causes and turn them into preventive actions."
      category="Risk & Governance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="premortem"
          csvData={{
            headers: ["Cause", "Description", "Likelihood", "Impact", "Score", "Preventive Action", "Owner"],
            // Use display order (state.causes), not the ranked-by-score order.
            // The user can manually reorder causes via the up/down buttons,
            // and re-sorting on export would silently destroy that intent.
            rows: state.causes.map((c) => [c.text, c.description ?? "", c.likelihood, c.impact, c.likelihood * c.impact, c.preventiveAction ?? "", c.owner ?? ""]),
          }}
          jsonData={state}
        />
        <Button onClick={add} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Cause
        </Button>
      </ActionRow>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-accent" />
            Imagined Failure Scenario
          </div>
          <Textarea
            rows={3}
            value={state.scenario}
            onChange={(e) => setState((s) => ({ ...s, scenario: e.target.value }))}
            placeholder={`It's 6 months from now. The project shipped but is widely considered a failure. Describe what that looks like in concrete terms.`}
            className="bg-bg border-border"
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {state.causes.map((c, idx) => {
          const score = c.likelihood * c.impact;
          return (
            <Card key={c.id} className="bg-surface border-border">
              <CardContent className="p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_80px_80px_80px_auto] gap-2 items-center">
                  <div className="flex flex-col">
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-sub" onClick={() => move(c.id, -1)}>
                      <ChevronUp className="w-3 h-3" />
                    </Button>
                    <span className="text-[10px] text-sub font-data text-center">{idx + 1}</span>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-sub" onClick={() => move(c.id, 1)}>
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </div>
                  <Input
                    value={c.text}
                    onChange={(e) => update(c.id, { text: e.target.value })}
                    placeholder="Cause of failure..."
                    className="bg-bg border-border"
                  />
                  <NumCell
                    value={c.likelihood}
                    onChange={(n) => update(c.id, { likelihood: n })}
                    min={1}
                    max={5}
                    placeholder="L"
                    className="bg-bg border-border font-data"
                    title="Likelihood 1-5"
                  />
                  <NumCell
                    value={c.impact}
                    onChange={(n) => update(c.id, { impact: n })}
                    min={1}
                    max={5}
                    placeholder="I"
                    className="bg-bg border-border font-data"
                    title="Impact 1-5"
                  />
                  <span className="px-2 py-1 rounded-md font-data text-sm text-center text-accent border border-accent/40 bg-accent/10">
                    {score}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove(c.id)} className="text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {/* Description — elaboration on the cause itself, distinct
                    from preventive action below. */}
                <Textarea
                  rows={2}
                  value={c.description ?? ""}
                  onChange={(e) => update(c.id, { description: e.target.value })}
                  placeholder="Description (optional) — context, signals, dependencies..."
                  className="bg-bg border-border text-sm"
                />
                <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-2">
                  <Textarea
                    rows={1}
                    value={c.preventiveAction ?? ""}
                    onChange={(e) => update(c.id, { preventiveAction: e.target.value })}
                    onBlur={(e) => commitPrevention(c.id, e.target.value)}
                    placeholder="Preventive action..."
                    className="bg-bg border-border text-sm"
                  />
                  <Input
                    value={c.owner ?? ""}
                    onChange={(e) => update(c.id, { owner: e.target.value })}
                    placeholder="Owner"
                    className="bg-bg border-border text-sm"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
