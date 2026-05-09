"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Handshake,
  ListChecks,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Send,
} from "lucide-react";
import { generateWorkingAgreementPrompts } from "@/lib/ai-prompts/working-agreement";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WORKING_AGREEMENT_ACTIONS } from "@/lib/history/event-actions";

type RuleCategory =
  | "communication"
  | "meetings"
  | "decisions"
  | "work"
  | "conflict"
  | "other";

interface Rule {
  id: string;
  category: RuleCategory;
  text: string;
  agreedBy: string[];
  description?: string;
  /** Adoption check-in: is the rule still working in practice? */
  stillWorking?: boolean;
}

interface CharterMeta {
  teamName?: string;
  version: number;
  publishedAt?: string;
  description?: string;
}

interface State {
  rules: Rule[];
  meta: CharterMeta;
}

const CATEGORIES: { id: RuleCategory; label: string; color: string }[] = [
  { id: "communication", label: "Communication", color: "border-accent/40 bg-accent/10 text-accent" },
  { id: "meetings", label: "Meetings", color: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { id: "decisions", label: "Decisions", color: "border-purple-500/40 bg-purple-500/10 text-purple-300" },
  { id: "work", label: "Work", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { id: "conflict", label: "Conflict", color: "border-danger/40 bg-danger/10 text-danger" },
  { id: "other", label: "Other", color: "border-border bg-surface text-sub" },
];

const CATEGORY_CLASS: Record<RuleCategory, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.id] = c.color;
    return acc;
  },
  {} as Record<RuleCategory, string>
);

interface StarterRule {
  category: RuleCategory;
  text: string;
}

const STARTER_CATALOG: StarterRule[] = [
  { category: "communication", text: "Default to async comms; use sync only when alignment is needed" },
  { category: "communication", text: "Acknowledge messages within 4 working hours" },
  { category: "communication", text: "No back-channel decisions — bring discussions to the team channel" },
  { category: "meetings", text: "Cameras-on for retros and 1:1s, optional otherwise" },
  { category: "meetings", text: "Every meeting has a written agenda 24h before" },
  { category: "meetings", text: "Standups are timeboxed to 15 min, no exceptions" },
  { category: "decisions", text: "Use the consent model — silence is consent if you're in the meeting" },
  { category: "decisions", text: "Reversible decisions ship today; irreversible ones get an RFC" },
  { category: "work", text: "PRs are reviewed within one working day" },
  { category: "work", text: "No solo merges to main — at least one approval required" },
  { category: "work", text: "Friday afternoons are protected for deep work / no meetings" },
  { category: "conflict", text: "Disagree in private, decide in public, commit publicly" },
  { category: "conflict", text: "If two people are stuck, escalate to the EM/coach within 24h" },
  { category: "conflict", text: "Critique the work, not the person" },
];

const DEFAULT_STATE: State = {
  rules: [],
  meta: { version: 0 },
};

function newId(): string {
  return crypto.randomUUID();
}

function parseAgreedBy(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function WorkingAgreementClient() {
  const [state, setState] = usePersisted<State>(
    "agile-toolkit:working-agreement",
    DEFAULT_STATE
  );
  const [newRuleText, setNewRuleText] = useState("");
  const [newRuleDesc, setNewRuleDesc] = useState("");
  const [newRuleCategory, setNewRuleCategory] =
    useState<RuleCategory>("communication");
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [metaDescDraft, setMetaDescDraft] = useState("");
  const { log } = useHistoryLogger("working-agreement");

  // Hydrate the team-name + description drafts once persisted state shows
  // up. We mirror persisted values into local draft state so the inputs
  // feel responsive (commit on blur), then re-sync if persisted state
  // changes externally (e.g. devtools reset).
  useEffect(() => {
    setTeamNameDraft(state.meta.teamName ?? "");
  }, [state.meta.teamName]);
  useEffect(() => {
    setMetaDescDraft(state.meta.description ?? "");
  }, [state.meta.description]);

  const addRuleFromCatalog = (item: StarterRule) => {
    if (state.rules.some((r) => r.text === item.text && r.category === item.category)) {
      return;
    }
    const rule: Rule = {
      id: newId(),
      category: item.category,
      text: item.text,
      agreedBy: [],
    };
    setState((s) => ({ ...s, rules: [...s.rules, rule] }));
    log(WORKING_AGREEMENT_ACTIONS.RULE_ADDED, {
      ruleId: rule.id,
      category: rule.category,
      text: rule.text,
      source: "catalog",
    });
  };

  const addCustomRule = () => {
    const text = newRuleText.trim();
    if (!text) return;
    const description = newRuleDesc.trim() || undefined;
    const rule: Rule = {
      id: newId(),
      category: newRuleCategory,
      text,
      agreedBy: [],
      description,
    };
    setState((s) => ({ ...s, rules: [...s.rules, rule] }));
    log(WORKING_AGREEMENT_ACTIONS.RULE_ADDED, {
      ruleId: rule.id,
      category: rule.category,
      text: rule.text,
      description,
      source: "custom",
    });
    setNewRuleText("");
    setNewRuleDesc("");
  };

  const removeRule = (id: string) => {
    const r = state.rules.find((x) => x.id === id);
    setState((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== id) }));
    log(WORKING_AGREEMENT_ACTIONS.RULE_REMOVED, {
      ruleId: id,
      text: r?.text,
    });
  };

  const updateRuleText = (id: string, text: string) => {
    setState((s) => ({
      ...s,
      rules: s.rules.map((r) => (r.id === id ? { ...r, text } : r)),
    }));
  };

  const commitRuleText = (id: string) => {
    const r = state.rules.find((x) => x.id === id);
    if (!r) return;
    log(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, {
      ruleId: id,
      text: r.text,
    });
  };

  const updateAgreedBy = (id: string, raw: string) => {
    setState((s) => ({
      ...s,
      rules: s.rules.map((r) =>
        r.id === id ? { ...r, agreedBy: parseAgreedBy(raw) } : r
      ),
    }));
  };

  const commitAgreedBy = (id: string) => {
    const r = state.rules.find((x) => x.id === id);
    if (!r) return;
    log(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, {
      ruleId: id,
      agreedBy: r.agreedBy,
    });
  };

  const toggleStillWorking = (id: string) => {
    setState((s) => ({
      ...s,
      rules: s.rules.map((r) =>
        r.id === id
          ? { ...r, stillWorking: r.stillWorking === undefined ? true : !r.stillWorking }
          : r
      ),
    }));
    const r = state.rules.find((x) => x.id === id);
    log(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, {
      ruleId: id,
      stillWorking:
        r?.stillWorking === undefined ? true : !r.stillWorking,
    });
  };

  const publishCharter = () => {
    if (state.rules.length === 0) return;
    setState((s) => ({
      ...s,
      meta: {
        ...s.meta,
        version: s.meta.version + 1,
        publishedAt: new Date().toISOString(),
      },
    }));
    log(WORKING_AGREEMENT_ACTIONS.CHARTER_PUBLISHED, {
      version: state.meta.version + 1,
      ruleCount: state.rules.length,
      teamName: state.meta.teamName,
    });
  };

  const commitTeamName = () => {
    const teamName = teamNameDraft.trim() || undefined;
    if (teamName === state.meta.teamName) return;
    setState((s) => ({ ...s, meta: { ...s.meta, teamName } }));
  };

  const commitMetaDesc = () => {
    const description = metaDescDraft.trim() || undefined;
    if (description === state.meta.description) return;
    setState((s) => ({ ...s, meta: { ...s.meta, description } }));
  };

  const adherencePct = useMemo(() => {
    const checked = state.rules.filter((r) => r.stillWorking !== undefined);
    if (checked.length === 0) return 0;
    return (checked.filter((r) => r.stillWorking === true).length / checked.length) * 100;
  }, [state.rules]);

  const withAgreedByPct = useMemo(() => {
    if (state.rules.length === 0) return 0;
    const withNames = state.rules.filter((r) => r.agreedBy.length > 0).length;
    return (withNames / state.rules.length) * 100;
  }, [state.rules]);

  const byCategory = useMemo(() => {
    const m = new Map<RuleCategory, Rule[]>();
    for (const c of CATEGORIES) m.set(c.id, []);
    for (const r of state.rules) {
      const list = m.get(r.category) ?? [];
      list.push(r);
      m.set(r.category, list);
    }
    return m;
  }, [state.rules]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Working Agreement Builder",
      prompts: generateWorkingAgreementPrompts({
        rules: state.rules,
        meta: state.meta,
        adherencePct,
      }),
    }),
    [state.rules, state.meta, adherencePct]
  );

  return (
    <ToolPageWrapper
      toolId="working-agreement"
      title="Working Agreement Builder"
      description="Assemble your team charter from a starter catalog or add custom rules. Publish to bump the version, then run adoption check-ins to see what's still working."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="working-agreement"
          csvData={{
            headers: [
              "Category",
              "Rule",
              "Description",
              "Agreed By",
              "Still Working?",
            ],
            rows: state.rules.map((r) => [
              r.category,
              r.text,
              r.description ?? "",
              r.agreedBy.join("; "),
              r.stillWorking === undefined
                ? ""
                : r.stillWorking
                  ? "Yes"
                  : "No",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={ListChecks}
          label="Total rules"
          value={state.rules.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Handshake}
          label="Version"
          value={`v${state.meta.version}`}
          hint={
            state.meta.publishedAt
              ? new Date(state.meta.publishedAt).toLocaleDateString()
              : "unpublished"
          }
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Adherence"
          value={`${adherencePct.toFixed(0)}%`}
          hint="still working"
          tone={
            adherencePct === 0
              ? "default"
              : adherencePct < 60
                ? "danger"
                : adherencePct < 80
                  ? "warning"
                  : "success"
          }
        />
        <StatCard
          variant="compact"
          label="With agreement"
          value={`${withAgreedByPct.toFixed(0)}%`}
          hint="rules signed"
        />
      </KpiGrid>

      {state.rules.length === 0 && (
        <CalloutAlert tone="info" className="mb-4">
          <strong>Empty charter.</strong> Pick from the starter catalog below or
          add your first custom rule to begin.
        </CalloutAlert>
      )}

      {/* Charter meta + publish */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={teamNameDraft}
              onChange={(e) => setTeamNameDraft(e.target.value)}
              onBlur={commitTeamName}
              placeholder="Team name (optional)"
              className="bg-bg border-border"
              aria-label="Team name"
            />
            <Button
              onClick={publishCharter}
              disabled={state.rules.length === 0}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Publish v{state.meta.version + 1}
            </Button>
          </div>
          <Textarea
            value={metaDescDraft}
            onChange={(e) => setMetaDescDraft(e.target.value)}
            onBlur={commitMetaDesc}
            placeholder="Charter context / purpose (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Charter description"
          />
        </CardContent>
      </Card>

      {/* Starter catalog */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4">
          <div className="text-sm font-semibold text-text mb-2">
            Starter catalog
          </div>
          <div className="text-xs text-sub mb-3">
            Tap any rule to add it. Already-added rules are hidden.
          </div>
          <div className="flex flex-wrap gap-2">
            {STARTER_CATALOG.filter(
              (s) =>
                !state.rules.some(
                  (r) => r.text === s.text && r.category === s.category
                )
            ).map((s) => (
              <button
                key={`${s.category}::${s.text}`}
                onClick={() => addRuleFromCatalog(s)}
                className="text-left rounded-lg border border-border bg-bg hover:border-accent/40 hover:bg-accent/5 transition px-3 py-2 max-w-[320px]"
              >
                <Badge
                  variant="outline"
                  className={`${CATEGORY_CLASS[s.category]} text-[10px] mb-1`}
                >
                  {s.category}
                </Badge>
                <div className="text-xs text-text">{s.text}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom add */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-semibold text-text mb-1">
            Add custom rule
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2">
            <Select
              value={newRuleCategory}
              onValueChange={(v) => setNewRuleCategory(v as RuleCategory)}
            >
              <SelectTrigger className="bg-bg border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomRule()}
              placeholder="Rule text..."
              className="bg-bg border-border"
              aria-label="Rule text"
            />
            <Button
              onClick={addCustomRule}
              className="gap-2 bg-accent text-bg hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
          <Textarea
            value={newRuleDesc}
            onChange={(e) => setNewRuleDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addCustomRule();
            }}
            placeholder="Description (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Rule description"
          />
        </CardContent>
      </Card>

      {/* Rule list grouped by category */}
      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const list = byCategory.get(cat.id) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={cat.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`${cat.color} text-xs`}
                >
                  {cat.label}
                </Badge>
                <span className="text-xs font-data text-sub">
                  {list.length}
                </span>
              </div>
              {list.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-border bg-surface p-3 space-y-2"
                >
                  <div className="flex flex-col xs:flex-row gap-2">
                    <Input
                      value={r.text}
                      onChange={(e) => updateRuleText(r.id, e.target.value)}
                      onBlur={() => commitRuleText(r.id)}
                      className="bg-bg border-border text-sm"
                      aria-label="Rule text"
                    />
                    <div className="flex gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleStillWorking(r.id)}
                        className={`gap-1 ${
                          r.stillWorking === true
                            ? "text-emerald-400 hover:text-emerald-300"
                            : r.stillWorking === false
                              ? "text-danger hover:text-danger/80"
                              : "text-sub hover:text-text"
                        }`}
                        aria-label="Toggle still-working status"
                      >
                        {r.stillWorking === true ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : r.stillWorking === false ? (
                          <XCircle className="w-4 h-4" />
                        ) : (
                          <CircleDashed className="w-4 h-4" />
                        )}
                        <span className="text-xs">
                          {r.stillWorking === true
                            ? "Working"
                            : r.stillWorking === false
                              ? "Not working"
                              : "Check in"}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRule(r.id)}
                        className="text-sub hover:text-danger"
                        aria-label={`Remove ${r.text}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <Input
                    defaultValue={r.agreedBy.join(", ")}
                    onBlur={(e) => {
                      updateAgreedBy(r.id, e.target.value);
                      commitAgreedBy(r.id);
                    }}
                    placeholder="Agreed by (comma-separated names)..."
                    className="bg-bg border-border text-xs"
                    aria-label="Agreed by"
                  />
                  {r.description && (
                    <div className="text-sub text-[11px] whitespace-pre-wrap break-words">
                      {r.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
