"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Shield, AlertTriangle } from "lucide-react";
import { generateThreatModelPrompts } from "@/lib/ai-prompts/threat-model";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { THREAT_MODEL_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

/* ── Types ──────────────────────────────────────────────────────────────── */

type Stride =
  | "spoofing"
  | "tampering"
  | "repudiation"
  | "information_disclosure"
  | "denial_of_service"
  | "elevation_of_privilege";

type Status = "open" | "mitigating" | "mitigated" | "accepted";

interface Threat {
  id: string;
  service: string;
  category: Stride;
  severity: number; // 1-5
  status: Status;
  mitigation?: string;
  raisedAt: string;
  mitigatedAt?: string;
  description?: string;
}

interface ThreatModelState {
  threats: Threat[];
}

const DEFAULT_STATE: ThreatModelState = { threats: [] };

const STRIDE_OPTIONS: { value: Stride; label: string }[] = [
  { value: "spoofing", label: "Spoofing" },
  { value: "tampering", label: "Tampering" },
  { value: "repudiation", label: "Repudiation" },
  { value: "information_disclosure", label: "Information Disclosure" },
  { value: "denial_of_service", label: "Denial of Service" },
  { value: "elevation_of_privilege", label: "Elevation of Privilege" },
];

const STRIDE_TAG: Record<Stride, string> = {
  spoofing: "S",
  tampering: "T",
  repudiation: "R",
  information_disclosure: "I",
  denial_of_service: "D",
  elevation_of_privilege: "E",
};

const STRIDE_LABEL: Record<Stride, string> = Object.fromEntries(
  STRIDE_OPTIONS.map((o) => [o.value, o.label])
) as Record<Stride, string>;

/**
 * Normalise a possibly-stale persisted category into a valid Stride.
 * A hand-edited localStorage payload (or a schema migration that left
 * an old category alias behind) used to render the badge as
 * "undefined · undefined" — masking the threat entirely. Default to
 * `spoofing` so the row remains visible and editable.
 */
function safeStride(value: unknown): Stride {
  if (typeof value === "string" && value in STRIDE_TAG) {
    return value as Stride;
  }
  return "spoofing";
}

const SEVERITY_COLOR: Record<number, string> = {
  1: "#34d399",
  2: "#a3e635",
  3: "#facc15",
  4: "#f59e0b",
  5: "#ef4444",
};

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mitigating", label: "Mitigating" },
  { value: "mitigated", label: "Mitigated" },
  { value: "accepted", label: "Accepted" },
];

/* ── Local draft hook for editable text fields ──────────────────────────── */

function useDraftField(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const lastRef = useRef(value);
  const draftRef = useRef(value);
  const inputRef = useRef<HTMLElement | null>(null);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    // Skip the resync if the user is currently typing into this field —
    // mid-edit clobbering would wipe in-progress text. We also skip if the
    // upstream value already matches what we last committed.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (inputRef.current && active === inputRef.current) return;
    if (value === lastRef.current) return;
    setDraft(value);
    lastRef.current = value;
  }, [value]);
  // On unmount, flush any uncommitted draft so unmounting the row (e.g. via
  // re-sort) doesn't lose typing.
  useEffect(() => {
    return () => {
      if (draftRef.current !== lastRef.current) {
        commitRef.current(draftRef.current);
      }
    };
  }, []);
  const onBlur = () => {
    if (draft !== lastRef.current) {
      lastRef.current = draft;
      commit(draft);
    }
  };
  return { draft, setDraft, onBlur, inputRef };
}

/* ── Per-row card ────────────────────────────────────────────────────────── */

function ThreatRow({
  t,
  update,
  logUpdate,
  remove,
}: {
  t: Threat;
  update: (id: string, patch: Partial<Threat>) => void;
  logUpdate: (id: string, fields: string[]) => void;
  remove: (id: string) => void;
}) {
  const mitigation = useDraftField(t.mitigation ?? "", (next) => {
    const trimmed = next.trim();
    update(t.id, { mitigation: trimmed.length ? trimmed : undefined });
    logUpdate(t.id, ["mitigation"]);
  });
  const description = useDraftField(t.description ?? "", (next) => {
    const trimmed = next.trim();
    update(t.id, { description: trimmed.length ? trimmed : undefined });
    logUpdate(t.id, ["description"]);
  });

  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const cat = safeStride(t.category);
            return (
              <Badge
                variant="outline"
                className="font-data uppercase tracking-wider text-[10px]"
                title={STRIDE_LABEL[cat]}
              >
                {STRIDE_TAG[cat]} · {STRIDE_LABEL[cat]}
              </Badge>
            );
          })()}
          <span
            className="inline-flex items-center gap-1 text-xs"
            title={`Severity ${t.severity}`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              // Clamp the persisted severity into [1,5] before lookup.
              // A hand-edited localStorage payload (or stale schema)
              // with severity outside that range used to render an
              // invisible dot — defaulting to severity 3 keeps the
              // badge readable and lets the user repair from the UI.
              style={{ background: SEVERITY_COLOR[Math.min(5, Math.max(1, Number(t.severity) || 3)) as 1|2|3|4|5] }}
              aria-hidden="true"
            />
            <span className="font-data text-sub">SEV {t.severity}</span>
          </span>
          <span className="text-text font-medium text-sm flex-1 min-w-0 truncate">
            {t.service}
          </span>
          <Select
            value={t.status}
            onValueChange={(v) => {
              const status = v as Status;
              const patch: Partial<Threat> = { status };
              // Preserve mitigatedAt on transitions out of "mitigated" — the
              // historical timestamp is meaningful even if we re-open the
              // threat later. Only stamp on first transition in.
              if (status === "mitigated" && !t.mitigatedAt) {
                patch.mitigatedAt = todayLocalISO();
              }
              update(t.id, patch);
              logUpdate(t.id, Object.keys(patch));
            }}
          >
            <SelectTrigger
              className="h-8 w-36 bg-bg border-border text-xs capitalize"
              aria-label={`Status for ${t.service}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => remove(t.id)}
            className="text-sub hover:text-danger"
            aria-label={`Remove ${t.service} threat`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        <Textarea
          ref={mitigation.inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={2}
          value={mitigation.draft}
          onChange={(e) => mitigation.setDraft(e.target.value)}
          onBlur={mitigation.onBlur}
          placeholder="Mitigation plan..."
          className="bg-bg border-border text-sm"
        />
        <Textarea
          ref={description.inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={2}
          value={description.draft}
          onChange={(e) => description.setDraft(e.target.value)}
          onBlur={description.onBlur}
          placeholder="Description (optional)..."
          className="bg-bg border-border text-xs"
        />
      </CardContent>
    </Card>
  );
}

/* ── Main client component ──────────────────────────────────────────────── */

export function ThreatModelClient() {
  const [state, setState] = usePersisted<ThreatModelState>(
    "agile-toolkit:threat-model",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("threat-model");

  // Add-form draft fields
  const [service, setService] = useState("");
  const [category, setCategory] = useState<Stride>("spoofing");
  const [severity, setSeverity] = useState(3);
  const [mitigation, setMitigation] = useState("");
  const [description, setDescription] = useState("");

  const addThreat = () => {
    if (!service.trim()) return;
    const threat: Threat = {
      id: crypto.randomUUID(),
      service: service.trim(),
      category,
      severity,
      status: "open",
      mitigation: mitigation.trim() || undefined,
      raisedAt: todayLocalISO(),
      description: description.trim() || undefined,
    };
    setState((s) => ({ threats: [threat, ...s.threats] }));
    log(THREAT_MODEL_ACTIONS.THREAT_ADDED, {
      threatId: threat.id,
      service: threat.service,
      category: threat.category,
      severity: threat.severity,
      description: threat.description,
    });
    setService("");
    setMitigation("");
    setDescription("");
    setSeverity(3);
  };

  const update = (id: string, patch: Partial<Threat>) => {
    setState((s) => ({
      threats: s.threats.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };
  const logUpdate = (id: string, fields: string[]) => {
    log(THREAT_MODEL_ACTIONS.THREAT_UPDATED, { threatId: id, fields });
  };
  const remove = (id: string) => {
    const t = state.threats.find((x) => x.id === id);
    setState((s) => ({ threats: s.threats.filter((x) => x.id !== id) }));
    log(THREAT_MODEL_ACTIONS.THREAT_REMOVED, {
      threatId: id,
      service: t?.service,
      category: t?.category,
    });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const services = useMemo(
    () => Array.from(new Set(state.threats.map((t) => t.service))).sort(),
    [state.threats]
  );

  const totalOpen = useMemo(
    () => state.threats.filter((t) => t.status === "open").length,
    [state.threats]
  );

  const bySeverity = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const t of state.threats) {
      if (t.status === "mitigated") continue;
      counts[t.severity] = (counts[t.severity] ?? 0) + 1;
    }
    return counts;
  }, [state.threats]);

  const mitigationRate = useMemo(() => {
    if (state.threats.length === 0) return 0;
    const mitigated = state.threats.filter((t) => t.status === "mitigated").length;
    return mitigated / state.threats.length;
  }, [state.threats]);

  const matrix = useMemo(() => {
    // Per-service x STRIDE category counts.
    const map = new Map<string, Record<Stride, number>>();
    for (const svc of services) {
      const row: Record<Stride, number> = {
        spoofing: 0,
        tampering: 0,
        repudiation: 0,
        information_disclosure: 0,
        denial_of_service: 0,
        elevation_of_privilege: 0,
      };
      map.set(svc, row);
    }
    for (const t of state.threats) {
      const row = map.get(t.service);
      // Same defensive normalisation as the badge — a stale category
      // would otherwise increment `row[undefined]` and silently inflate
      // the row's own count keyed by the literal string "undefined".
      if (row) row[safeStride(t.category)]++;
    }
    return map;
  }, [state.threats, services]);

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
      toolName: "Threat Model Registry",
      prompts: generateThreatModelPrompts(
        {
          threats: state.threats.map((t) => ({
            service: t.service,
            category: t.category,
            severity: t.severity,
            status: t.status,
            mitigation: t.mitigation,
            description: t.description,
          })),
          totalOpen,
          mitigationRate,
          servicesCount: services.length,
        },
        workspace
      ),
    }),
    [state.threats, totalOpen, mitigationRate, services.length, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="threat-model"
      title="Threat Model Registry"
      description="Track STRIDE-categorized threats per service, mitigation status, and per-service coverage gaps."
      category="Security & Compliance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="threat-model"
          csvData={{
            headers: [
              "Service",
              "Category",
              "Severity",
              "Status",
              "Mitigation",
              "Description",
              "Raised",
              "Mitigated",
            ],
            rows: state.threats.map((t) => [
              t.service,
              t.category,
              t.severity,
              t.status,
              t.mitigation ?? "",
              t.description ?? "",
              t.raisedAt,
              t.mitigatedAt ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Open threats"
          value={totalOpen}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Critical (4-5)"
          value={(bySeverity[4] ?? 0) + (bySeverity[5] ?? 0)}
          tone={(bySeverity[4] ?? 0) + (bySeverity[5] ?? 0) > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          label="Services covered"
          value={services.length}
        />
        <StatCard
          variant="compact"
          label="Mitigation rate"
          value={`${(mitigationRate * 100).toFixed(0)}%`}
          tone={mitigationRate >= 0.6 ? "success" : "default"}
        />
      </KpiGrid>

      <SectionCard
        title="New threat"
        icon={Shield}
        className="mb-6 bg-surface border-border"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-sub">Service</Label>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addThreat()}
              placeholder="auth-api, billing-svc..."
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">STRIDE category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Stride)}>
              <SelectTrigger className="bg-bg border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRIDE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">
              Severity{" "}
              <span className="font-data text-text">
                {severity}
                <span
                  className="ml-2 inline-block w-2 h-2 rounded-full align-middle"
                  style={{ background: SEVERITY_COLOR[severity] }}
                  aria-hidden="true"
                />
              </span>
            </Label>
            <Slider
              value={[severity]}
              onValueChange={(v) => setSeverity(v[0] ?? 3)}
              min={1}
              max={5}
              step={1}
              aria-label="Severity"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={addThreat}
              className="gap-2 w-full bg-accent text-bg hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" />
              Add threat
            </Button>
          </div>
          <div className="sm:col-span-2 lg:col-span-2 space-y-1">
            <Label className="text-xs text-sub">Mitigation (optional)</Label>
            <Textarea
              rows={2}
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              placeholder="Planned or applied control..."
              className="bg-bg border-border text-sm"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2 space-y-1">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Threat scenario, attack path, blast radius..."
              className="bg-bg border-border text-sm"
            />
          </div>
        </div>
      </SectionCard>

      {services.length > 0 && (
        <SectionCard
          title="STRIDE coverage matrix"
          icon={Shield}
          className="mb-6 bg-surface border-border"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-data">
              <thead>
                <tr>
                  <th className="text-left text-sub font-medium pb-2 pr-3">
                    Service
                  </th>
                  {STRIDE_OPTIONS.map((o) => (
                    <th
                      key={o.value}
                      className="text-center text-sub font-medium pb-2 px-2"
                      title={o.label}
                    >
                      {STRIDE_TAG[o.value]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.map((svc) => {
                  const row = matrix.get(svc)!;
                  return (
                    <tr key={svc}>
                      <td className="text-text pr-3 py-1.5 truncate max-w-[180px]">
                        {svc}
                      </td>
                      {STRIDE_OPTIONS.map((o) => {
                        const count = row[o.value];
                        return (
                          <td
                            key={o.value}
                            className="text-center px-2 py-1.5"
                          >
                            <span
                              className={
                                count === 0
                                  ? "text-sub/40"
                                  : "text-accent font-semibold"
                              }
                              aria-label={`${o.label} count for ${svc}`}
                            >
                              {count === 0 ? "—" : count}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <div className="space-y-2">
        {state.threats
          .slice()
          .sort((a, b) => b.severity - a.severity)
          .map((t) => (
            <ThreatRow
              key={t.id}
              t={t}
              update={update}
              logUpdate={logUpdate}
              remove={remove}
            />
          ))}
        {state.threats.length === 0 && (
          <EmptyState icon={Shield}>
            No threats logged yet. Add a service + STRIDE category above to start
            building the registry.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
