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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Siren,
  Activity,
  Clock,
  CheckCircle2,
  Copy,
  ShieldAlert,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { INCIDENT_ACTIONS } from "@/lib/history/event-actions";
import { generateIncidentCommanderPrompts } from "@/lib/ai-prompts/incident-commander";
import { toast } from "@/lib/utils/toast";

type Severity = "sev1" | "sev2" | "sev3" | "sev4";
type IncidentStatus = "active" | "mitigated" | "resolved";

interface TimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  commander?: string;
  scribe?: string;
  description?: string;
  timeline: TimelineEntry[];
}

interface IncidentState {
  incidents: Incident[];
}

const DEFAULT_STATE: IncidentState = { incidents: [] };

const SEVERITY_LABEL: Record<Severity, string> = {
  sev1: "SEV-1",
  sev2: "SEV-2",
  sev3: "SEV-3",
  sev4: "SEV-4",
};

const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  sev1: "bg-danger/15 text-danger border-danger/40",
  sev2: "bg-danger/10 text-danger border-danger/30",
  sev3: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  sev4: "bg-accent/10 text-accent border-accent/30",
};

const STATUS_BADGE_CLASS: Record<IncidentStatus, string> = {
  active: "bg-danger/10 text-danger border-danger/30",
  mitigated: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  resolved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

const SEVERITY_MATRIX: { sev: Severity; rule: string }[] = [
  { sev: "sev1", rule: "Full team paged · 24/7 response · exec comms" },
  { sev: "sev2", rule: "Oncall paged · response within 30 min" },
  { sev: "sev3", rule: "Business-hours response · comms in #incidents" },
  { sev: "sev4", rule: "Backlog · address in next sprint" },
];

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function mttrHours(i: Incident): number | null {
  if (!i.resolvedAt) return null;
  const ms = new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface IncidentDraft {
  title: string;
  severity: Severity;
  commander: string;
  scribe: string;
  description: string;
}

function emptyDraft(): IncidentDraft {
  return {
    title: "",
    severity: "sev3",
    commander: "",
    scribe: "",
    description: "",
  };
}

export function IncidentCommanderClient() {
  const [state, setState] = usePersisted<IncidentState>(
    "agile-toolkit:incident-commander",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("incident-commander");
  const [draft, setDraft] = useState<IncidentDraft>(emptyDraft);
  const [now, setNow] = useState<number>(() => Date.now());

  // Live MTTR ticker for active incidents — updates every 10s.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const addIncident = () => {
    const title = draft.title.trim();
    if (!title) return;
    const incident: Incident = {
      id: crypto.randomUUID(),
      title,
      severity: draft.severity,
      status: "active",
      openedAt: nowIso(),
      commander: draft.commander.trim() || undefined,
      scribe: draft.scribe.trim() || undefined,
      description: draft.description.trim() || undefined,
      timeline: [],
    };
    setState((s) => ({ incidents: [incident, ...s.incidents] }));
    log(INCIDENT_ACTIONS.INCIDENT_OPENED, {
      incidentId: incident.id,
      title: incident.title,
      severity: incident.severity,
      commander: incident.commander,
      scribe: incident.scribe,
      description: incident.description,
    });
    setDraft(emptyDraft());
  };

  const markStatus = (id: string, status: IncidentStatus) => {
    setState((s) => ({
      incidents: s.incidents.map((i) => {
        if (i.id !== id) return i;
        const patch: Partial<Incident> = { status };
        if (status === "resolved" && !i.resolvedAt) patch.resolvedAt = nowIso();
        return { ...i, ...patch };
      }),
    }));
    if (status === "resolved") {
      log(INCIDENT_ACTIONS.INCIDENT_RESOLVED, { incidentId: id });
    } else {
      log(INCIDENT_ACTIONS.INCIDENT_UPDATED, { incidentId: id, status });
    }
  };

  const removeIncident = (id: string) => {
    const inc = state.incidents.find((i) => i.id === id);
    setState((s) => ({ incidents: s.incidents.filter((i) => i.id !== id) }));
    log(INCIDENT_ACTIONS.INCIDENT_RESET, {
      incidentId: id,
      title: inc?.title,
    });
  };

  const assignRole = (
    id: string,
    role: "commander" | "scribe",
    value: string
  ) => {
    const trimmed = value.trim();
    setState((s) => ({
      incidents: s.incidents.map((i) =>
        i.id === id ? { ...i, [role]: trimmed || undefined } : i
      ),
    }));
    log(INCIDENT_ACTIONS.ROLE_ASSIGNED, {
      incidentId: id,
      role,
      value: trimmed || null,
    });
  };

  const addTimelineEntry = (id: string, author: string, text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      author: author.trim() || "anonymous",
      text: trimmedText,
    };
    setState((s) => ({
      incidents: s.incidents.map((i) =>
        i.id === id ? { ...i, timeline: [...i.timeline, entry] } : i
      ),
    }));
    log(INCIDENT_ACTIONS.TIMELINE_LOGGED, {
      incidentId: id,
      entryId: entry.id,
      author: entry.author,
    });
  };

  const active = useMemo(
    () => state.incidents.filter((i) => i.status !== "resolved"),
    [state.incidents]
  );
  const recent = useMemo(
    () =>
      [...state.incidents]
        .sort(
          (a, b) =>
            new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        )
        .slice(0, 10),
    [state.incidents]
  );

  // Bucket `now` to the hour so avgMttr/bySeverity recompute only when the
  // hour rolls over, not every 10s tick (which would invalidate downstream
  // memos like promptConfig on every interval fire).
  const nowHourBucket = Math.floor(now / 3600000);

  // Avg MTTR over the last 7 days of resolved incidents.
  const avgMttrHours = useMemo(() => {
    const cutoff = nowHourBucket * 3600000 - 7 * 24 * 60 * 60 * 1000;
    const samples = state.incidents
      .filter((i) => i.resolvedAt)
      .filter((i) => new Date(i.resolvedAt!).getTime() >= cutoff)
      .map(mttrHours)
      .filter((v): v is number => v !== null);
    if (samples.length === 0) return null;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }, [state.incidents, nowHourBucket]);

  // Severity counts over the last 30 days.
  const bySeverity = useMemo<Record<Severity, number>>(() => {
    const cutoff = nowHourBucket * 3600000 - 30 * 24 * 60 * 60 * 1000;
    const counts: Record<Severity, number> = {
      sev1: 0,
      sev2: 0,
      sev3: 0,
      sev4: 0,
    };
    for (const i of state.incidents) {
      if (new Date(i.openedAt).getTime() >= cutoff) counts[i.severity] += 1;
    }
    return counts;
  }, [state.incidents, nowHourBucket]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Incident Commander",
      prompts: generateIncidentCommanderPrompts({
        incidents: state.incidents.map((i) => ({
          title: i.title,
          severity: i.severity,
          status: i.status,
          openedAt: i.openedAt,
          resolvedAt: i.resolvedAt,
          commander: i.commander,
          scribe: i.scribe,
          description: i.description,
          timelineCount: i.timeline.length,
        })),
        openCount: active.length,
        avgMttrHours,
        bySeverity,
      }),
    }),
    [state.incidents, active.length, avgMttrHours, bySeverity]
  );

  return (
    <ToolPageWrapper
      toolId="incident-commander"
      title="Incident Commander"
      description="Live-incident scaffolding with severity matrix, comms templates, and timeline log. Built for engineering leaders."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="incident-commander"
          csvData={{
            headers: [
              "Title",
              "Severity",
              "Status",
              "Opened",
              "Resolved",
              "Commander",
              "Scribe",
              "Timeline #",
              "MTTR (h)",
              "Description",
            ],
            rows: state.incidents.map((i) => [
              i.title,
              i.severity,
              i.status,
              i.openedAt,
              i.resolvedAt ?? "",
              i.commander ?? "",
              i.scribe ?? "",
              i.timeline.length,
              mttrHours(i)?.toFixed(2) ?? "",
              i.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Siren}
          label="Open"
          value={active.length}
          hint="active or mitigated"
          tone={active.length > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg MTTR (7d)"
          value={avgMttrHours === null ? "—" : `${avgMttrHours.toFixed(1)}h`}
          hint={avgMttrHours === null ? "No resolutions" : "resolved"}
        />
        <StatCard
          variant="compact"
          icon={ShieldAlert}
          label="SEV-1/2 (30d)"
          value={bySeverity.sev1 + bySeverity.sev2}
          hint={`${bySeverity.sev1} sev1 · ${bySeverity.sev2} sev2`}
          tone={bySeverity.sev1 + bySeverity.sev2 > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Activity}
          label="Total (30d)"
          value={
            bySeverity.sev1 + bySeverity.sev2 + bySeverity.sev3 + bySeverity.sev4
          }
          hint="all severities"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <SectionCard title="Declare an incident" icon={Plus} titleSize="lg">
          <div className="space-y-3">
            <div>
              <Label htmlFor="ic-title" className="text-xs text-sub">
                Title
              </Label>
              <Input
                id="ic-title"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") addIncident();
                }}
                placeholder="e.g. Checkout 500s spiking"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="ic-sev" className="text-xs text-sub">
                  Severity
                </Label>
                <Select
                  value={draft.severity}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, severity: v as Severity }))
                  }
                >
                  <SelectTrigger id="ic-sev" className="bg-surface border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ic-cmd" className="text-xs text-sub">
                  Commander
                </Label>
                <Input
                  id="ic-cmd"
                  value={draft.commander}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, commander: e.target.value }))
                  }
                  placeholder="optional"
                  className="bg-surface border-border"
                />
              </div>
              <div>
                <Label htmlFor="ic-scribe" className="text-xs text-sub">
                  Scribe
                </Label>
                <Input
                  id="ic-scribe"
                  value={draft.scribe}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, scribe: e.target.value }))
                  }
                  placeholder="optional"
                  className="bg-surface border-border"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="ic-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="ic-desc"
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                rows={2}
                placeholder="What's the user-visible symptom? Any blast-radius hints?"
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              onClick={addIncident}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Siren className="w-4 h-4" aria-hidden="true" />
              Declare incident
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Severity matrix" icon={ShieldAlert} titleSize="lg">
          <ul className="space-y-2 text-xs">
            {SEVERITY_MATRIX.map((m) => (
              <li
                key={m.sev}
                className="flex items-start gap-2 p-2 rounded-md border border-border bg-bg"
              >
                <Badge
                  variant="outline"
                  className={`${SEVERITY_BADGE_CLASS[m.sev]} font-data shrink-0`}
                >
                  {SEVERITY_LABEL[m.sev]}
                </Badge>
                <span className="text-sub">{m.rule}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {active.length === 0 ? (
        <EmptyState icon={CheckCircle2} className="mb-6">
          No active incidents. When a new one is declared it will appear here
          with timeline log and comms templates.
        </EmptyState>
      ) : (
        <div className="space-y-4 mb-6">
          {active.map((incident) => (
            <ActiveIncidentCard
              key={incident.id}
              incident={incident}
              now={now}
              onMarkStatus={markStatus}
              onAssignRole={assignRole}
              onRemove={removeIncident}
              onAddTimelineEntry={addTimelineEntry}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <SectionCard title="Recent incidents" titleSize="lg">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">MTTR</th>
                  <th className="py-2 pr-3">Commander</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((i) => {
                  const m = mttrHours(i);
                  return (
                    <tr key={i.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-text">
                        <span className="line-clamp-1">{i.title}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={`${SEVERITY_BADGE_CLASS[i.severity]} font-data`}
                        >
                          {SEVERITY_LABEL[i.severity]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={STATUS_BADGE_CLASS[i.status]}
                        >
                          {i.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-data text-sub">
                        {new Date(i.openedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {m === null ? "—" : `${m.toFixed(2)}h`}
                      </td>
                      <td className="py-2 pr-3 text-sub">
                        {i.commander ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIncident(i.id)}
                          aria-label={`Remove ${i.title}`}
                          className="h-7 w-7 p-0 text-sub hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

function ActiveIncidentCard({
  incident,
  now,
  onMarkStatus,
  onAssignRole,
  onRemove,
  onAddTimelineEntry,
}: {
  incident: Incident;
  now: number;
  onMarkStatus: (id: string, status: IncidentStatus) => void;
  onAssignRole: (
    id: string,
    role: "commander" | "scribe",
    value: string
  ) => void;
  onRemove: (id: string) => void;
  onAddTimelineEntry: (id: string, author: string, text: string) => void;
}) {
  const [author, setAuthor] = useState("");
  const [entryText, setEntryText] = useState("");
  const [commanderDraft, setCommanderDraft] = useState(incident.commander ?? "");
  const [scribeDraft, setScribeDraft] = useState(incident.scribe ?? "");
  const commanderInputRef = useRef<HTMLInputElement>(null);
  const scribeInputRef = useRef<HTMLInputElement>(null);
  const lastCommanderRef = useRef(incident.commander ?? "");
  const lastScribeRef = useRef(incident.scribe ?? "");

  // Sync external changes into local draft (e.g. another tab edits the role),
  // but only when the input isn't currently focused — otherwise we'd wipe
  // mid-edit typing on every render that touches `incident`.
  useEffect(() => {
    const next = incident.commander ?? "";
    if (document.activeElement === commanderInputRef.current) return;
    if (next === lastCommanderRef.current) return;
    setCommanderDraft(next);
    lastCommanderRef.current = next;
  }, [incident.commander]);
  useEffect(() => {
    const next = incident.scribe ?? "";
    if (document.activeElement === scribeInputRef.current) return;
    if (next === lastScribeRef.current) return;
    setScribeDraft(next);
    lastScribeRef.current = next;
  }, [incident.scribe]);

  const elapsedMs =
    (incident.resolvedAt
      ? new Date(incident.resolvedAt).getTime()
      : now) - new Date(incident.openedAt).getTime();

  const slackTemplate =
    `:rotating_light: ${SEVERITY_LABEL[incident.severity]} INCIDENT — ${incident.title}\n` +
    `Status: ${incident.status}\n` +
    `Commander: ${incident.commander ?? "(unassigned)"} · Scribe: ${incident.scribe ?? "(unassigned)"}\n` +
    `Started: ${new Date(incident.openedAt).toLocaleString()}\n` +
    `Updates will follow in this thread.`;

  const emailTemplate =
    `Subject: [${SEVERITY_LABEL[incident.severity]}] ${incident.title}\n\n` +
    `Team,\n\nWe are currently responding to a ${SEVERITY_LABEL[incident.severity]} incident: ${incident.title}.\n` +
    `Incident commander: ${incident.commander ?? "TBD"}.\n` +
    `Scribe: ${incident.scribe ?? "TBD"}.\n` +
    `Status: ${incident.status}.\n\n` +
    `We will follow up with another update within 30 minutes or sooner if status changes.`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const submitEntry = () => {
    if (!entryText.trim()) return;
    onAddTimelineEntry(incident.id, author, entryText);
    setEntryText("");
  };

  return (
    <SectionCard
      title={incident.title}
      icon={Siren}
      iconClassName={
        incident.severity === "sev1" || incident.severity === "sev2"
          ? "text-danger"
          : "text-amber-300"
      }
      titleSize="lg"
      titleSuffix={
        <span className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`${SEVERITY_BADGE_CLASS[incident.severity]} font-data`}
          >
            {SEVERITY_LABEL[incident.severity]}
          </Badge>
          <Badge
            variant="outline"
            className={STATUS_BADGE_CLASS[incident.status]}
          >
            {incident.status}
          </Badge>
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <span
            className="font-data text-sm text-accent"
            aria-label="elapsed time"
          >
            <Clock className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
            {formatDuration(elapsedMs)}
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {incident.description && (
          <p className="text-xs text-sub whitespace-pre-wrap break-words">
            {incident.description}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-sub">Commander</Label>
            <Input
              ref={commanderInputRef}
              value={commanderDraft}
              onChange={(e) => setCommanderDraft(e.target.value)}
              onBlur={() => {
                if (commanderDraft.trim() !== (incident.commander ?? "")) {
                  onAssignRole(incident.id, "commander", commanderDraft);
                  lastCommanderRef.current = commanderDraft.trim();
                }
              }}
              placeholder="Assign commander…"
              className="bg-surface border-border"
            />
          </div>
          <div>
            <Label className="text-xs text-sub">Scribe</Label>
            <Input
              ref={scribeInputRef}
              value={scribeDraft}
              onChange={(e) => setScribeDraft(e.target.value)}
              onBlur={() => {
                if (scribeDraft.trim() !== (incident.scribe ?? "")) {
                  onAssignRole(incident.id, "scribe", scribeDraft);
                  lastScribeRef.current = scribeDraft.trim();
                }
              }}
              placeholder="Assign scribe…"
              className="bg-surface border-border"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-bg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wider text-sub">
                Slack template
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(slackTemplate, "Slack template")}
                className="h-6 px-2 text-xs text-sub hover:text-accent"
              >
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
              </Button>
            </div>
            <pre className="text-[11px] text-text whitespace-pre-wrap break-words font-data">
              {slackTemplate}
            </pre>
          </div>
          <div className="rounded-md border border-border bg-bg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wider text-sub">
                Email template
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(emailTemplate, "Email template")}
                className="h-6 px-2 text-xs text-sub hover:text-accent"
              >
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
              </Button>
            </div>
            <pre className="text-[11px] text-text whitespace-pre-wrap break-words font-data">
              {emailTemplate}
            </pre>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-sub">
              Timeline ({incident.timeline.length})
            </span>
          </div>
          {incident.timeline.length === 0 && (
            <p className="text-xs text-sub italic mb-2">
              No entries yet. Log status updates as the incident unfolds.
            </p>
          )}
          {incident.timeline.length > 0 && (
            <ul className="space-y-1.5 mb-3 max-h-48 overflow-y-auto pr-2">
              {incident.timeline.map((e) => (
                <li
                  key={e.id}
                  className="text-xs border-l-2 border-accent/40 pl-2"
                >
                  <span className="font-data text-sub mr-2">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span className="text-accent mr-2">{e.author}:</span>
                  <span className="text-text whitespace-pre-wrap break-words">
                    {e.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author"
              className="bg-surface border-border sm:w-32"
              aria-label="Timeline entry author"
            />
            <Input
              value={entryText}
              onChange={(e) => setEntryText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitEntry();
              }}
              placeholder="Status update…"
              className="bg-surface border-border flex-1"
              aria-label="Timeline entry text"
            />
            <Button
              onClick={submitEntry}
              className="gap-2 bg-accent text-bg hover:bg-accent/90"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> Entry
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          {incident.status !== "mitigated" && incident.status !== "resolved" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMarkStatus(incident.id, "mitigated")}
              className="border-border text-sub hover:border-amber-500/50 hover:text-amber-300"
            >
              Mark mitigated
            </Button>
          )}
          {incident.status !== "resolved" && (
            <Button
              size="sm"
              onClick={() => onMarkStatus(incident.id, "resolved")}
              className="gap-2 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/40"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Mark resolved
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(incident.id)}
            className="ml-auto text-sub hover:text-danger"
          >
            <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" /> Delete
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
