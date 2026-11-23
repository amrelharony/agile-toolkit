"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { sourceLabel } from "@/lib/handoffs/registry";
import { BUG_PRIORITIES, BUG_SEVERITIES, type BugReport } from "@/lib/stores/workspace-types";
import {
  FIX_BY_DAYS,
  PRIORITY_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  SEVERITY_RANK,
  ageDays,
  bugLinks,
  fixByDay,
  isBugRoute,
  overTarget,
  type BugLinkSlices,
  type LinkState,
} from "@/lib/bug-triage/model";
import { SelectField } from "./fields";
import { dayText } from "./bug-detail";

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "triaged", label: "Triaged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const ALL = "all";

const WENT_WORD: Readonly<Record<LinkState, string>> = {
  live: "in progress",
  done: "done",
  gone: "gone",
};

/** Where a bug went, in a few words: "Backlog: done", "Interrupt: in progress". */
function wentShort(bug: BugReport, slices: BugLinkSlices): string {
  const parts = bugLinks(bug, slices)
    .filter(({ link }) => isBugRoute(link.route))
    .map(
      ({ link, state }) =>
        `${link.route === "interrupt" ? "Interrupt" : "Backlog"}: ${WENT_WORD[state]}`
    );
  return parts.length > 0 ? parts.join(", ") : "Nowhere yet";
}

/**
 * Every bug, filtered by status, severity, priority and area: its age, the
 * fix-by target with an "over target" word, and where it went. A row opens
 * the bug's panel, where it can be closed with a reason, reopened or
 * deleted.
 */
export function AllBugs({
  bugs,
  slices,
  today,
  onOpen,
}: {
  bugs: readonly BugReport[];
  slices: BugLinkSlices;
  today: string;
  onOpen: (id: string) => void;
}) {
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [area, setArea] = useState(ALL);
  const areas = useMemo(
    () =>
      Array.from(new Set(bugs.map((b) => b.area).filter((a): a is string => Boolean(a)))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [bugs]
  );
  const rows = bugs.filter(
    (b) =>
      (status === "all" || (status === "open" ? b.status !== "closed" : b.status === status)) &&
      (severity === ALL || b.severity === severity) &&
      (priority === ALL || b.priority === priority) &&
      (area === ALL || b.area === area)
  );

  const columns: DataTableColumn<BugReport>[] = [
    {
      key: "title",
      header: "Bug",
      primary: true,
      cell: (b) => (
        <span className="break-words">
          {b.title}
          {sourceLabel(b.sourceRef) && (
            <span className="block text-xs text-sub">{sourceLabel(b.sourceRef)}</span>
          )}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      cell: (b) => (b.severity ? SEVERITY_LABEL[b.severity] : "Not set"),
      sortValue: (b) => (b.severity ? SEVERITY_RANK[b.severity] : null),
    },
    {
      key: "priority",
      header: "Priority",
      cell: (b) => (b.priority ? PRIORITY_LABEL[b.priority] : "Not set"),
      sortValue: (b) => (b.priority ? BUG_PRIORITIES.indexOf(b.priority) : null),
    },
    {
      key: "status",
      header: "Status",
      hiddenBelow: "lg",
      cell: (b) => STATUS_LABEL[b.status],
    },
    {
      key: "age",
      header: "Age",
      sortValue: (b) => ageDays(b, today),
      cell: (b) => {
        const fixBy = fixByDay(b);
        const days = ageDays(b, today);
        return (
          <span>
            {days === 1 ? "1 day" : `${days} days`}
            {fixBy && b.status !== "closed" && (
              <span className="block text-xs text-sub">fix by {dayText(fixBy)}</span>
            )}
            {overTarget(b, today) && (
              <span className="block text-xs font-semibold text-danger">over target</span>
            )}
          </span>
        );
      },
    },
    {
      key: "went",
      header: "Went to",
      hiddenBelow: "md",
      cell: (b) => wentShort(b, slices),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField label="Status" value={status} options={STATUS_FILTERS} onChange={setStatus} />
        <SelectField
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: ALL, label: "Any" },
            ...BUG_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] })),
          ]}
        />
        <SelectField
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[
            { value: ALL, label: "Any" },
            ...BUG_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
          ]}
        />
        <SelectField
          label="Area"
          value={area}
          onChange={setArea}
          options={[{ value: ALL, label: "Any" }, ...areas.map((a) => ({ value: a, label: a }))]}
        />
      </div>
      <DataTable
        caption="All bugs"
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        onRowClick={(b) => onOpen(b.id)}
        emptyState="No bugs match these filters."
      />
      <p className="text-xs text-sub">
        Fix-by targets count from the day a bug is logged: critical {FIX_BY_DAYS.critical} days,
        major {FIX_BY_DAYS.major}, minor {FIX_BY_DAYS.minor}, cosmetic none.
      </p>
    </div>
  );
}
