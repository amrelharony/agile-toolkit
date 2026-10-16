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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ShieldCheck, X, Link as LinkIcon, FileCheck } from "lucide-react";
import { generateControlMapPrompts } from "@/lib/ai-prompts/control-map";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CONTROL_MAP_ACTIONS } from "@/lib/history/event-actions";
import { toast } from "@/lib/utils/toast";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Workspace,
  ComplianceControl as Control,
  ControlFramework as Framework,
  ControlStatus as Status,
} from "@/lib/stores/workspace-types";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ControlMapState {
  controls: Control[];
}

const DEFAULT_STATE: ControlMapState = { controls: [] };

const CM_ID = "controlMap:current"; // MUST match CM_ID in control-map.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// control writes round-trip into the UI. Drop-in [state, setState].
function useControlMap(): [
  ControlMapState,
  (u: ControlMapState | ((p: ControlMapState) => ControlMapState)) => void,
] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.controlMaps ?? []).find((d) => d.id === CM_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertControlMap);
  const state: ControlMapState = doc ? { controls: doc.controls } : DEFAULT_STATE;
  const setState = (u: ControlMapState | ((p: ControlMapState) => ControlMapState)) => {
    const cur = (useWorkspaceStore.getState().controlMaps ?? []).find((d) => d.id === CM_ID);
    const curState: ControlMapState = cur ? { controls: cur.controls } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: CM_ID, controls: next.controls });
  };
  return [state, setState];
}

const FRAMEWORK_OPTIONS: { value: Framework; label: string }[] = [
  { value: "soc2", label: "SOC 2" },
  { value: "iso27001", label: "ISO 27001" },
  { value: "hipaa", label: "HIPAA" },
  { value: "gdpr", label: "GDPR" },
  { value: "custom", label: "Custom" },
];

const FRAMEWORK_LABEL: Record<Framework, string> = Object.fromEntries(
  FRAMEWORK_OPTIONS.map((o) => [o.value, o.label])
) as Record<Framework, string>;

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "implemented", label: "Implemented" },
  { value: "verified", label: "Verified" },
];

const STATUS_TONE: Record<Status, "default" | "warning" | "success"> = {
  not_started: "default",
  in_progress: "warning",
  implemented: "success",
  verified: "success",
};

/* ── Local draft hook ───────────────────────────────────────────────────── */

function useDraftField(
  value: string,
  commit: (next: string) => void,
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
) {
  const [draft, setDraft] = useState(value);
  const lastRef = useRef(value);
  useEffect(() => {
    // Skip the sync if the user is currently editing this field — otherwise a
    // parent re-render arriving mid-typing would wipe the in-progress draft
    // and bounce the cursor.
    if (
      inputRef?.current &&
      typeof document !== "undefined" &&
      document.activeElement === inputRef.current
    ) {
      return;
    }
    if (value === lastRef.current) return;
    setDraft(value);
    lastRef.current = value;
  }, [value, inputRef]);
  const onBlur = () => {
    if (draft !== lastRef.current) {
      lastRef.current = draft;
      commit(draft);
    }
  };
  return { draft, setDraft, onBlur };
}

/**
 * Sanitize an evidence URL. If the user types something without a scheme,
 * default to https. Reject anything that isn't http/https (especially
 * `javascript:` / `data:` / `file:`) to prevent XSS via the rendered <a href>.
 * Returns the normalized URL string, or null if invalid.
 */
function sanitizeEvidenceUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Add scheme if missing — also normalize scheme-relative "//host/...".
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    ? value
    : `https://${value.replace(/^\/\//, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return parsed.toString();
}

/* ── Per-control row ────────────────────────────────────────────────────── */

function ControlRow({
  c,
  update,
  logUpdate,
  logEvidence,
  remove,
}: {
  c: Control;
  update: (id: string, patch: Partial<Control>) => void;
  logUpdate: (id: string, fields: string[]) => void;
  logEvidence: (id: string, url: string) => void;
  remove: (id: string) => void;
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const description = useDraftField(
    c.description ?? "",
    (next) => {
      const trimmed = next.trim();
      update(c.id, { description: trimmed.length ? trimmed : undefined });
      logUpdate(c.id, ["description"]);
    },
    descriptionRef
  );
  const owner = useDraftField(
    c.owner ?? "",
    (next) => {
      const trimmed = next.trim();
      update(c.id, { owner: trimmed.length ? trimmed : undefined });
      logUpdate(c.id, ["owner"]);
    },
    ownerRef
  );
  const [newLink, setNewLink] = useState("");

  const addEvidence = () => {
    const trimmed = newLink.trim();
    if (!trimmed) return;
    const safe = sanitizeEvidenceUrl(trimmed);
    if (!safe) {
      toast.error("Evidence URL must be http(s) and well-formed");
      return;
    }
    update(c.id, { evidenceLinks: [...c.evidenceLinks, safe] });
    logEvidence(c.id, safe);
    setNewLink("");
  };

  const removeEvidence = (idx: number) => {
    update(c.id, {
      evidenceLinks: c.evidenceLinks.filter((_, i) => i !== idx),
    });
    logUpdate(c.id, ["evidenceLinks"]);
  };

  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-data text-xs">
            {FRAMEWORK_LABEL[c.framework]}
          </Badge>
          <span className="font-data text-text text-sm">{c.controlId}</span>
          <span className="text-text font-medium text-sm flex-1 min-w-0 truncate">{c.title}</span>
          <Select
            value={c.status}
            onValueChange={(v) => {
              update(c.id, { status: v as Status });
              logUpdate(c.id, ["status"]);
            }}
          >
            <SelectTrigger
              className="h-8 w-36 bg-bg border-border text-xs capitalize"
              aria-label={`Status for ${c.controlId}`}
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
            onClick={() => remove(c.id)}
            className="text-sub hover:text-danger"
            aria-label={`Remove ${c.controlId}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
          <Input
            ref={ownerRef}
            value={owner.draft}
            onChange={(e) => owner.setDraft(e.target.value)}
            onBlur={owner.onBlur}
            placeholder="Owner..."
            className="bg-bg border-border text-xs"
            aria-label={`Owner for ${c.controlId}`}
          />
          <Textarea
            ref={descriptionRef}
            rows={2}
            value={description.draft}
            onChange={(e) => description.setDraft(e.target.value)}
            onBlur={description.onBlur}
            placeholder="Description (optional)..."
            className="bg-bg border-border text-xs"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-sub flex items-center gap-1">
            <LinkIcon className="w-3 h-3" /> Evidence ({c.evidenceLinks.length})
          </div>
          {c.evidenceLinks.length > 0 && (
            <ul className="space-y-1">
              {c.evidenceLinks.map((url, i) => (
                <li key={`${c.id}-evidence-${i}`} className="flex items-center gap-2 text-xs">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline truncate flex-1 min-w-0"
                  >
                    {url}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEvidence(i)}
                    className="h-6 w-6 p-0 text-sub hover:text-danger"
                    aria-label="Remove evidence link"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Input
              value={newLink}
              onChange={(e) => setNewLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEvidence();
                }
              }}
              placeholder="https://wiki/runbook..."
              className="bg-bg border-border text-xs h-8"
              aria-label={`New evidence link for ${c.controlId}`}
            />
            <Button
              size="sm"
              onClick={addEvidence}
              disabled={!newLink.trim()}
              className="h-8 px-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        {STATUS_TONE[c.status] === "success" && (
          <div className="text-xs text-success/80">Implemented &amp; ready for audit review.</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function ControlMapClient() {
  const [state, setState] = useControlMap();
  const { log } = useHistoryLogger("control-map");

  // Add-form draft state.
  const [controlId, setControlId] = useState("");
  const [framework, setFramework] = useState<Framework>("soc2");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<Status>("not_started");
  const [description, setDescription] = useState("");

  const addControl = () => {
    if (!controlId.trim() || !title.trim()) return;
    const control: Control = {
      id: crypto.randomUUID(),
      controlId: controlId.trim(),
      framework,
      title: title.trim(),
      owner: owner.trim() || undefined,
      status,
      evidenceLinks: [],
      description: description.trim() || undefined,
    };
    setState((s) => ({ controls: [control, ...s.controls] }));
    log(CONTROL_MAP_ACTIONS.CONTROL_ADDED, {
      controlDbId: control.id,
      controlId: control.controlId,
      framework: control.framework,
      title: control.title,
      description: control.description,
    });
    setControlId("");
    setTitle("");
    setOwner("");
    setDescription("");
    setStatus("not_started");
  };

  const update = (id: string, patch: Partial<Control>) => {
    setState((s) => ({
      controls: s.controls.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };
  const logUpdate = (id: string, fields: string[]) => {
    log(CONTROL_MAP_ACTIONS.CONTROL_UPDATED, { controlDbId: id, fields });
  };
  const logEvidence = (id: string, url: string) => {
    log(CONTROL_MAP_ACTIONS.EVIDENCE_ADDED, { controlDbId: id, url });
  };
  const remove = (id: string) => {
    const c = state.controls.find((x) => x.id === id);
    setState((s) => ({ controls: s.controls.filter((x) => x.id !== id) }));
    log(CONTROL_MAP_ACTIONS.CONTROL_REMOVED, {
      controlDbId: id,
      controlId: c?.controlId,
      framework: c?.framework,
    });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const totalControls = state.controls.length;

  const verifiedCount = useMemo(
    () => state.controls.filter((c) => c.status === "verified").length,
    [state.controls]
  );
  const pctVerified = totalControls === 0 ? 0 : (verifiedCount / totalControls) * 100;

  const evidenceCount = useMemo(
    () => state.controls.reduce((acc, c) => acc + c.evidenceLinks.length, 0),
    [state.controls]
  );

  const byFramework = useMemo(() => {
    const map = new Map<Framework, { total: number; implemented: number }>();
    for (const c of state.controls) {
      const cell = map.get(c.framework) ?? { total: 0, implemented: 0 };
      cell.total++;
      if (c.status === "implemented" || c.status === "verified") cell.implemented++;
      map.set(c.framework, cell);
    }
    // Sort entries in canonical FRAMEWORK_OPTIONS order so the dashboard
    // always displays SOC 2 → ISO 27001 → HIPAA → GDPR → Custom regardless of
    // which framework was added first.
    const order = new Map<Framework, number>(FRAMEWORK_OPTIONS.map((o, i) => [o.value, i]));
    return Array.from(map.entries())
      .map(([fw, v]) => ({ framework: fw, ...v }))
      .sort((a, b) => (order.get(a.framework) ?? 0) - (order.get(b.framework) ?? 0));
  }, [state.controls]);

  const gapsCount = useMemo(
    () =>
      state.controls.filter((c) => c.status === "not_started" || c.status === "in_progress").length,
    [state.controls]
  );

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
      toolName: "Compliance Control Map",
      prompts: generateControlMapPrompts(
        {
          controls: state.controls.map((c) => ({
            controlId: c.controlId,
            framework: FRAMEWORK_LABEL[c.framework],
            title: c.title,
            status: c.status,
            owner: c.owner,
            evidenceCount: c.evidenceLinks.length,
            description: c.description,
          })),
          totalControls,
          pctVerified,
          byFramework: byFramework.map((b) => ({
            framework: FRAMEWORK_LABEL[b.framework],
            total: b.total,
            implemented: b.implemented,
          })),
        },
        workspace
      ),
    }),
    [state.controls, totalControls, pctVerified, byFramework, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="control-map"
      title="Compliance Control Map"
      description="Map team controls to SOC 2 / ISO 27001 / HIPAA / GDPR with evidence links and per-framework completion."
      category="Security & Compliance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="control-map"
          csvData={{
            headers: [
              "Control ID",
              "Framework",
              "Title",
              "Status",
              "Owner",
              "Evidence Count",
              "Evidence URLs",
              "Description",
            ],
            rows: state.controls.map((c) => [
              c.controlId,
              FRAMEWORK_LABEL[c.framework],
              c.title,
              c.status,
              c.owner ?? "",
              c.evidenceLinks.length,
              c.evidenceLinks.join(" | "),
              c.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={ShieldCheck}
          label="Total controls"
          value={totalControls}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="% verified"
          value={`${pctVerified.toFixed(0)}%`}
          tone={pctVerified >= 80 ? "success" : pctVerified >= 50 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          label="Open gaps"
          value={gapsCount}
          tone={gapsCount > 0 ? "warning" : "default"}
        />
        <StatCard variant="compact" icon={FileCheck} label="Evidence items" value={evidenceCount} />
      </KpiGrid>

      {byFramework.length > 0 && (
        <SectionCard
          title="Compliance dashboard"
          icon={ShieldCheck}
          className="mb-6 bg-surface border-border"
        >
          <div className="space-y-3">
            {byFramework.map((f) => {
              const pct = Math.min(100, (f.implemented / Math.max(1, f.total)) * 100);
              return (
                <div key={f.framework}>
                  <div className="flex items-center justify-between mb-1 text-xs">
                    <span className="text-text font-medium">{FRAMEWORK_LABEL[f.framework]}</span>
                    <span className="text-sub font-data">
                      {f.implemented} / {f.total}{" "}
                      <span className="text-accent">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="New control" icon={ShieldCheck} className="mb-6 bg-surface border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-sub">Control ID</Label>
            <Input
              value={controlId}
              onChange={(e) => setControlId(e.target.value)}
              placeholder="CC6.1, A.9.4.2..."
              className="bg-bg border-border font-data"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Framework</Label>
            <Select value={framework} onValueChange={(v) => setFramework(v as Framework)}>
              <SelectTrigger className="bg-bg border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRAMEWORK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-sub">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Logical access removal on termination"
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Owner (optional)</Label>
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Security team, IT-ops..."
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Initial status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger className="bg-bg border-border capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the control does, who it protects..."
              className="bg-bg border-border text-sm"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
            <Button
              onClick={addControl}
              disabled={!controlId.trim() || !title.trim()}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Add control
            </Button>
          </div>
        </div>
      </SectionCard>

      <div className="space-y-2">
        {state.controls
          .slice()
          .sort((a, b) => {
            // Group by framework, then by control ID for natural order.
            if (a.framework !== b.framework) {
              return a.framework.localeCompare(b.framework);
            }
            return a.controlId.localeCompare(b.controlId);
          })
          .map((c) => (
            <ControlRow
              key={c.id}
              c={c}
              update={update}
              logUpdate={logUpdate}
              logEvidence={logEvidence}
              remove={remove}
            />
          ))}
        {state.controls.length === 0 && (
          <EmptyState icon={ShieldCheck}>
            No controls yet. Add a control above to begin mapping coverage.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
