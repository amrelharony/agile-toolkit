"use client";

/**
 * A single impediment card: title/description, severity/status/category +
 * age badges, raised/assigned meta, and (while unresolved) status controls
 * to escalate or resolve. Status transitions sonify and log to history.
 */

import { ArrowUpCircle, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emit as sonify } from "@/lib/sonification/emit";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import type { Impediment, Status } from "../types";
import { daysSince } from "../helpers";
import { useImpedimentStore } from "../use-impediment-store";
import { AgeIndicator, SeverityBadge, StatusBadge } from "./badges";

export function ImpedimentCard({ impediment }: { impediment: Impediment }) {
  const { updateStatus, remove } = useImpedimentStore();
  const age = daysSince(impediment.raisedDate);
  const { log } = useHistoryLogger("impediments");

  const handleResolve = () => {
    sonify("impediments", "impediment-resolved");
    const today = todayLocalISO();
    updateStatus(impediment.id, "Resolved", today);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_RESOLVED, {
      id: impediment.id,
      title: impediment.title,
      ageDays: age,
    });
  };

  const handleStatusChange = (next: Status) => {
    if (next === impediment.status) return;
    if (next === "Resolved") {
      handleResolve();
      return;
    }
    updateStatus(impediment.id, next);
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_STATUS_CHANGED, {
      id: impediment.id,
      title: impediment.title,
      from: impediment.status,
      to: next,
    });
  };

  const handleRemove = () => {
    log(IMPEDIMENT_ACTIONS.IMPEDIMENT_REMOVED, {
      id: impediment.id,
      title: impediment.title,
    });
    remove(impediment.id);
  };

  return (
    <div
      className={`border rounded-lg p-4 bg-surface-deep/50 space-y-3 transition-opacity ${
        impediment.status === "Resolved" ? "opacity-60" : ""
      }`}
      style={{
        borderColor:
          impediment.severity === "Critical"
            ? "rgba(239,68,68,0.4)"
            : impediment.severity === "High"
              ? "rgba(239,68,68,0.2)"
              : "rgba(255,255,255,0.1)",
      }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">{impediment.title}</p>
          {impediment.description && (
            <p className="text-xs text-sub mt-0.5 line-clamp-2">{impediment.description}</p>
          )}
        </div>
        <Button
          variant="danger-ghost"
          size="icon"
          onClick={handleRemove}
          className="min-touch-coarse h-7 w-7 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={impediment.severity} />
        <StatusBadge status={impediment.status} />
        <Badge className="bg-card border border-border text-sub text-xs">
          {impediment.category}
        </Badge>
        {impediment.status !== "Resolved" && <AgeIndicator days={age} />}
        {impediment.status === "Resolved" && impediment.resolvedDate && (
          <span className="text-xs text-sub">Resolved {impediment.resolvedDate}</span>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sub">
        {impediment.raisedBy && (
          <span>
            Raised by: <span className="text-text">{impediment.raisedBy}</span>
          </span>
        )}
        {impediment.assignedTo && (
          <span>
            Assigned: <span className="text-text">{impediment.assignedTo}</span>
          </span>
        )}
        <span>Raised: {impediment.raisedDate}</span>
      </div>

      {/* Status controls */}
      {impediment.status !== "Resolved" && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          <Select value={impediment.status} onValueChange={(v) => handleStatusChange(v as Status)}>
            <SelectTrigger className="min-touch-coarse h-7 text-xs bg-surface-deep border-border text-text w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border">
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="Escalated">Escalated</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          {impediment.status === "Open" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleStatusChange("Escalated")}
              className="h-7 text-xs gap-1 text-accent-amber hover:text-accent-amber hover:bg-accent-amber/10"
            >
              <ArrowUpCircle className="w-3 h-3" />
              Escalate
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResolve}
            className="h-7 text-xs gap-1 text-accent-green hover:text-accent-green hover:bg-accent-green/10 ml-auto"
          >
            <CheckCircle2 className="w-3 h-3" />
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}
