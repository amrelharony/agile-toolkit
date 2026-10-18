"use client";

/**
 * Card for one active/mitigated incident: elapsed-time clock, commander/scribe
 * assignment (synced on blur, focus-guarded), copyable Slack + email comms
 * templates, the timeline log, and mitigate/resolve/delete controls.
 */

import { useEffect, useRef, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Siren, Clock, CheckCircle2, Copy } from "lucide-react";
import { toast } from "@/lib/utils/toast";
import type { Incident, IncidentStatus } from "../types";
import { SEVERITY_BADGE_CLASS, SEVERITY_LABEL, STATUS_BADGE_CLASS } from "../constants";
import { formatDuration } from "../helpers";

export function ActiveIncidentCard({
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
  onAssignRole: (id: string, role: "commander" | "scribe", value: string) => void;
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
    (incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : now) -
    new Date(incident.openedAt).getTime();

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
          : "text-warning"
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
          <Badge variant="outline" className={STATUS_BADGE_CLASS[incident.status]}>
            {incident.status}
          </Badge>
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <span className="font-data text-sm text-accent">
            <Clock className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
            <span className="sr-only">Elapsed time: </span>
            {formatDuration(elapsedMs)}
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {incident.description && (
          <p className="text-xs text-sub whitespace-pre-wrap break-words">{incident.description}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`ic-${incident.id}-commander`} className="text-xs text-sub">
              Commander
            </Label>
            <Input
              id={`ic-${incident.id}-commander`}
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
            <Label htmlFor={`ic-${incident.id}-scribe`} className="text-xs text-sub">
              Scribe
            </Label>
            <Input
              id={`ic-${incident.id}-scribe`}
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
              <span className="text-xs uppercase tracking-wider text-sub">Slack template</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(slackTemplate, "Slack template")}
                aria-label="Copy Slack template"
                className="h-6 px-2 text-xs text-sub hover:text-accent"
              >
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
              </Button>
            </div>
            <pre className="text-xs text-text whitespace-pre-wrap break-words font-data">
              {slackTemplate}
            </pre>
          </div>
          <div className="rounded-md border border-border bg-bg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wider text-sub">Email template</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(emailTemplate, "Email template")}
                aria-label="Copy email template"
                className="h-6 px-2 text-xs text-sub hover:text-accent"
              >
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
              </Button>
            </div>
            <pre className="text-xs text-text whitespace-pre-wrap break-words font-data">
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
                <li key={e.id} className="text-xs border-l-2 border-accent/40 pl-2">
                  <span className="font-data text-sub mr-2">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span className="text-accent mr-2">{e.author}:</span>
                  <span className="text-text whitespace-pre-wrap break-words">{e.text}</span>
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
            <Button onClick={submitEntry} className="gap-2 bg-accent text-bg hover:bg-accent/90">
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
              className="border-border text-sub hover:border-warning/50 hover:text-warning"
            >
              Mark mitigated
            </Button>
          )}
          {incident.status !== "resolved" && (
            <Button
              size="sm"
              onClick={() => onMarkStatus(incident.id, "resolved")}
              className="gap-2 bg-success/15 text-success hover:bg-success/25 border border-success/40"
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
