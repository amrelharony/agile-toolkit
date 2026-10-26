"use client";

import { useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import type { CharterVersionRule, WorkingAgreement } from "@/lib/stores/workspace-types";
import {
  dayLabel,
  diffIsEmpty,
  diffVersions,
  draftRules,
  hasUnpublishedChanges,
  latestVersion,
  type VersionDiff,
} from "@/lib/working-agreement/model";
import { CATEGORY_LABEL } from "./catalog";

const DRAFT = "draft";

/** A diff as a list a person reads: what was added, removed, reworded or moved. */
export function DiffList({ diff, label }: { diff: VersionDiff; label: string }) {
  if (diffIsEmpty(diff)) return <p className="text-sm text-sub">No changes.</p>;
  return (
    <ul className="space-y-1 text-sm" aria-label={label}>
      {diff.added.map((r) => (
        <li key={`a:${r.id}`}>
          <span className="font-medium text-success">Added: </span>
          {r.text}
        </li>
      ))}
      {diff.removed.map((r) => (
        <li key={`r:${r.id}`}>
          <span className="font-medium text-danger">Removed: </span>
          <span className="line-through decoration-danger/60">{r.text}</span>
        </li>
      ))}
      {diff.reworded.map((c) => (
        <li key={`w:${c.after.id}`}>
          <span className="font-medium text-warning">Reworded: </span>
          <span className="text-sub line-through">{c.before.text}</span> → {c.after.text}
        </li>
      ))}
      {diff.recategorised.map((c) => (
        <li key={`c:${c.after.id}`}>
          <span className="font-medium text-info">Moved: </span>
          {c.after.text} ({CATEGORY_LABEL[c.before.category]} → {CATEGORY_LABEL[c.after.category]})
        </li>
      ))}
      {diff.redescribed.map((c) => (
        <li key={`d:${c.after.id}`}>
          <span className="font-medium text-sub">Description changed: </span>
          {c.after.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * The charter's name and purpose, Publish, what changed since the latest
 * version, and any two versions (or a version and the draft) compared.
 * Publish is offered only when there is something new to publish.
 */
export function VersionsPanel({
  doc,
  onTeamName,
  onDescription,
  onPublish,
}: {
  doc: WorkingAgreement;
  onTeamName: (name: string) => void;
  onDescription: (description: string) => void;
  onPublish: () => void;
}) {
  const versions = doc.versions ?? [];
  const latest = latestVersion(doc);
  const changed = hasUnpublishedChanges(doc);
  const next = doc.meta.version + 1;
  const reason =
    doc.rules.length === 0
      ? "Add a rule first."
      : changed
        ? null
        : `Nothing changed since v${doc.meta.version}.`;
  const sinceLatest = latest ? diffVersions(latest.rules, draftRules(doc)) : null;

  // The pair being compared; null until picked: the version before the
  // latest against the latest, or the one version against the draft.
  const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
  const fromId = useId();
  const toId = useId();
  const rulesOf = (key: string): CharterVersionRule[] | undefined =>
    key === DRAFT ? draftRules(doc) : versions.find((v) => String(v.version) === key)?.rules;
  const n = versions.length;
  const defaults =
    n >= 2
      ? { from: String(versions[n - 2].version), to: String(versions[n - 1].version) }
      : n === 1
        ? { from: String(versions[0].version), to: DRAFT }
        : null;
  const pair = picked && rulesOf(picked.from) && rulesOf(picked.to) ? picked : defaults;
  const compared = pair ? diffVersions(rulesOf(pair.from), rulesOf(pair.to) ?? []) : null;
  const nameOf = (key: string) => (key === DRAFT ? "the draft" : `v${key}`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="space-y-2">
          <BlurInput
            value={doc.meta.teamName ?? ""}
            onCommit={onTeamName}
            placeholder="Team name (optional)"
            maxLength={120}
            aria-label="Team name"
          />
          <BlurTextarea
            value={doc.meta.description ?? ""}
            onCommit={onDescription}
            placeholder="What this charter is for (optional)"
            rows={2}
            maxLength={2000}
            className="resize-none text-xs"
            aria-label="Charter description"
          />
        </div>
        <div className="flex flex-col gap-1 md:items-end">
          <Button type="button" onClick={onPublish} disabled={reason !== null} className="gap-2">
            <Send className="h-4 w-4" aria-hidden="true" />
            Publish v{next}
          </Button>
          <p className="text-xs text-sub">
            {reason ??
              (latest
                ? `Snapshots the rules as v${next}; v${latest.version} stays to compare with.`
                : doc.meta.version > 0
                  ? `v${doc.meta.version} was published before versions were kept, so there's nothing to compare it with.`
                  : "Snapshots the rules as v1, so later versions can be compared with it.")}
          </p>
        </div>
      </div>

      {latest && sinceLatest && !diffIsEmpty(sinceLatest) && (
        <div className="rounded-md border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold text-text">Changes since v{latest.version}</h3>
          <DiffList diff={sinceLatest} label={`Changes since v${latest.version}`} />
        </div>
      )}

      {versions.length > 0 && (
        <div className="space-y-3 rounded-md border border-border bg-card p-3">
          <h3 className="text-sm font-semibold text-text">Published versions</h3>
          <ul className="space-y-1 text-sm text-text" aria-label="Published versions">
            {[...versions].reverse().map((v) => (
              <li key={v.version}>
                v{v.version}
                <span className="text-sub">
                  {" "}
                  · {dayLabel(v.publishedAt, true)} · {v.rules.length}{" "}
                  {v.rules.length === 1 ? "rule" : "rules"}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={fromId} className="text-xs font-medium text-sub">
                Compare
              </label>
              <select
                id={fromId}
                className="flex h-9 rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={pair?.from ?? ""}
                onChange={(e) => pair && setPicked({ ...pair, from: e.target.value })}
              >
                {versions.map((v) => (
                  <option key={v.version} value={String(v.version)}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={toId} className="text-xs font-medium text-sub">
                with
              </label>
              <select
                id={toId}
                className="flex h-9 rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={pair?.to ?? DRAFT}
                onChange={(e) => pair && setPicked({ ...pair, to: e.target.value })}
              >
                {versions.map((v) => (
                  <option key={v.version} value={String(v.version)}>
                    v{v.version}
                  </option>
                ))}
                <option value={DRAFT}>The draft</option>
              </select>
            </div>
          </div>
          {compared && pair ? (
            <DiffList
              diff={compared}
              label={`Changes from ${nameOf(pair.from)} to ${nameOf(pair.to)}`}
            />
          ) : (
            <p className="text-sm text-sub">Pick two versions to compare.</p>
          )}
        </div>
      )}
    </div>
  );
}
