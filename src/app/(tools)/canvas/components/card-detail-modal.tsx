"use client";

/**
 * Card detail modal — full edit form for a `WhiteboardCard` (Phase 26).
 *
 * The on-canvas card surface only allows inline title editing. For
 * description / assignee / due / points / status the user has to expand
 * the card via Cmd+E (or the "Edit details" pill on the property panel)
 * which opens this modal.
 *
 * Saves write back through `onPatch(id, patch)`.
 *
 * R11-fix: the prior docstring + footer claimed "changes sync back to
 * the linked entity", but no reverse-direction subscriber exists in
 * `canvas-client.tsx`. The Story → Card direction works (peer/Story
 * edits propagate to the card), but Card → Story does NOT. The
 * footer text and claim have been corrected so users aren't misled
 * into believing their backlog row updates automatically. Wiring a
 * proper reverse subscriber is tracked separately (it needs
 * upsertStory / upsertRisk / upsertOkr / upsertDecision routing,
 * conflict resolution against peer edits, and a sourceRef-tool
 * dispatch table).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X, User, Calendar, Hash, Activity, Tag } from "lucide-react";
import type { WhiteboardCard, WhiteboardObject } from "@/lib/stores/workspace-types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

interface Props {
  card: WhiteboardCard;
  onPatch: (id: string, patch: Partial<WhiteboardObject>) => void;
  onClose: () => void;
}

export function CardDetailModal({ card, onPatch, onClose }: Props) {
  // Local form state mirrors the card's persisted state. We commit on
  // form submit / blur rather than per-keystroke so realtime peers
  // don't see flicker-typing while you're filling in the form.
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [assignee, setAssignee] = useState(card.assignee ?? "");
  const [due, setDue] = useState(card.due ?? "");
  const [points, setPoints] = useState<string>(
    typeof card.points === "number" ? String(card.points) : "",
  );
  const [status, setStatus] = useState(card.status ?? "");
  const [tagsInput, setTagsInput] = useState((card.tags ?? []).join(", "));

  // R10-deferred: open-snapshot for per-field merge. We compare the
  // form's eventual values back to THIS snapshot (not the current
  // `card` prop, which may have moved on via peer updates) to detect
  // which fields the user actually changed. On Save we send ONLY
  // those fields — fields the user didn't touch fall through to the
  // upsert's `...current` spread (see onSave below).
  //
  // R11-fix: re-baseline the snapshot when a peer edit lands AND the
  // user hasn't touched that field. The previous behaviour captured
  // only at mount, so a peer's edit invisible to the user was treated
  // as "user wants to keep the original value", which could blast the
  // peer change if the user happened to retype it verbatim. We track
  // "touched" per field and only re-baseline untouched fields when
  // `card.version` increments (peer broadcast).
  const openSnapshotRef = useRef({
    title: card.title,
    description: card.description ?? "",
    assignee: card.assignee ?? "",
    due: card.due ?? "",
    points: typeof card.points === "number" ? String(card.points) : "",
    status: card.status ?? "",
    tagsInput: (card.tags ?? []).join(", "),
  });
  // Track per-field touch so a peer edit doesn't trample the user's
  // in-progress changes when re-baselining.
  const touchedRef = useRef({
    title: false,
    description: false,
    assignee: false,
    due: false,
    points: false,
    status: false,
    tagsInput: false,
  });
  // Re-baseline non-touched fields on every card.version bump (peer
  // edit). Touched fields keep their original snapshot so the user's
  // patch still diffs against what they saw when they opened the modal.
  useEffect(() => {
    const t = touchedRef.current;
    const snap = openSnapshotRef.current;
    if (!t.title) snap.title = card.title;
    if (!t.description) snap.description = card.description ?? "";
    if (!t.assignee) snap.assignee = card.assignee ?? "";
    if (!t.due) snap.due = card.due ?? "";
    if (!t.points) snap.points = typeof card.points === "number" ? String(card.points) : "";
    if (!t.status) snap.status = card.status ?? "";
    if (!t.tagsInput) snap.tagsInput = (card.tags ?? []).join(", ");
  }, [card.version, card.title, card.description, card.assignee, card.due, card.points, card.status, card.tags]);

  // Suggest assignees from the workspace team members list — same data
  // source the rest of the toolkit uses.
  const teamMembers = useWorkspaceStore((s) => s.teamMembers ?? []);
  const assigneeSuggestions = useMemo(
    () => teamMembers.map((m) => m.name).filter(Boolean),
    [teamMembers],
  );

  // Status options — canonical Kanban set plus any custom statuses
  // already in use on existing stories (so the dropdown reflects the
  // workspace's actual vocabulary, not a hard-coded set).
  const stories = useWorkspaceStore((s) => s.stories ?? []);
  const statusOptions = useMemo(() => {
    const set = new Set<string>([
      "backlog",
      "todo",
      "in_progress",
      "review",
      "done",
    ]);
    for (const st of stories) {
      if (st.status) set.add(st.status);
    }
    return Array.from(set);
  }, [stories]);

  // Stable callback ref so the keydown effect doesn't re-register
  // whenever the parent re-creates `onClose` inline each render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't steal Esc from form fields — users expect Esc to clear
      // the IME composition / native autocomplete, not to discard the
      // form (and the textarea's in-progress draft).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.stopPropagation();
      onCloseRef.current();
    };
    // Non-capture phase — gives form fields a chance to handle Esc first.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // R11-fix: removed the standalone focus-restore effect — `useFocusTrap`
  // below now owns focus capture + restore (with the added
  // `document.contains` guard against triggers unmounted while the
  // modal was open).

  const onSave = () => {
    // Explicit parse path — `Number(" ")` is 0 (not NaN) so the trim
    // check is what actually distinguishes "empty" from "zero".
    const trimmedPoints = points.trim();
    const parsedPoints = trimmedPoints === "" ? undefined : Number(trimmedPoints);
    const validPoints =
      parsedPoints !== undefined && Number.isFinite(parsedPoints) && parsedPoints >= 0
        ? parsedPoints
        : undefined;
    // Strip zero-width / invisible chars before lowercase + slice so
    // "auth​" and "auth" dedupe correctly. Covers ZWSP, ZWNJ,
    // ZWJ, Word Joiner (U+2060), ZWNBSP/BOM, soft hyphen, and emoji
    // Variation Selector-16 (U+FE0F) — the last is critical because
    // pasted emoji often carries a trailing VS16 that hashes differently
    // from a typed emoji.
    const cleanTags = tagsInput
      .split(",")
      .map((t) =>
        t
          .trim()
          .toLowerCase()
          .replace(/[​-‍⁠﻿­️]/g, "")
          .slice(0, 24),
      )
      .filter((t) => t.length > 0)
      .slice(0, 8);
    const dedup = Array.from(new Set(cleanTags));
    // Persist `due` as a midnight-UTC ISO string so the date-only input
    // round-trips through `due.slice(0, 10)` without timezone drift.
    // (Constructing from a `YYYY-MM-DD` string via `new Date()` would
    // interpret it as UTC midnight already, but rolling our own avoids
    // any future runtime divergence.)
    const trimmedDue = due.trim();
    const dueISO = /^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)
      ? `${trimmedDue}T00:00:00.000Z`
      : trimmedDue || undefined;
    // R10-deferred: per-field touch detection. Compare to the
    // open-snapshot (not the LIVE card, which may have moved via a
    // peer broadcast) and include ONLY fields the user actually
    // changed. The store's upsert handler then merges these into the
    // current state, preserving peer-edited fields the user never
    // touched.
    const snap = openSnapshotRef.current;
    const patch: Partial<WhiteboardCard> = {};
    if (title !== snap.title) patch.title = title.trim() || "Untitled card";
    if (description !== snap.description) patch.description = description.trim() || undefined;
    if (assignee !== snap.assignee) patch.assignee = assignee.trim() || undefined;
    if (due !== snap.due) patch.due = dueISO;
    if (points !== snap.points) patch.points = validPoints;
    if (status !== snap.status) patch.status = status.trim() || undefined;
    if (tagsInput !== snap.tagsInput) patch.tags = dedup.length > 0 ? dedup : undefined;
    // Only fire onPatch if SOMETHING actually changed — avoids a
    // spurious broadcast + history event when the user opened the
    // modal, looked, and closed without editing.
    if (Object.keys(patch).length > 0) {
      onPatch(card.id, patch as Partial<WhiteboardObject>);
    }
    onClose();
  };

  // R10-deferred: focus-trap (WCAG 2.4.3).
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Card details"
      ref={dialogRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl max-w-lg w-[92vw] max-h-[88vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div
              className="w-1 h-6 rounded-full"
              style={{ background: card.color ?? "#00f0ff" }}
            />
            <h2 className="text-sm font-mono uppercase tracking-wider text-text">
              Edit card
            </h2>
            {card.sourceRef && (
              <span
                title={card.sourceRef.tool}
                className="text-[10px] uppercase font-mono text-sub bg-surface-deep px-2 py-0.5 rounded max-w-[140px] truncate inline-block"
              >
                ↳ {card.sourceRef.tool}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card details"
            className="text-sub hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          className="p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <label className="text-xs text-sub flex flex-col gap-1">
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => { touchedRef.current.title = true; setTitle(e.target.value); }}
              maxLength={140}
              className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              autoFocus
            />
          </label>

          <label className="text-xs text-sub flex flex-col gap-1">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => { touchedRef.current.description = true; setDescription(e.target.value); }}
              maxLength={2000}
              rows={4}
              className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent resize-none"
              placeholder="What's this card about?"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-sub flex flex-col gap-1">
              <span className="flex items-center gap-1"><User className="w-3 h-3" />Assignee</span>
              <input
                type="text"
                value={assignee}
                onChange={(e) => { touchedRef.current.assignee = true; setAssignee(e.target.value); }}
                list="card-assignee-suggestions"
                maxLength={60}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="Unassigned"
              />
              <datalist id="card-assignee-suggestions">
                {assigneeSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>

            <label className="text-xs text-sub flex flex-col gap-1">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Due</span>
              <input
                type="date"
                value={due ? due.slice(0, 10) : ""}
                onChange={(e) => {
                  // Store the literal `YYYY-MM-DD` value the input gives
                  // us. Constructing `new Date(value).toISOString()` here
                  // (a) throws RangeError on invalid input, and (b) shifts
                  // the date by the user's UTC offset before persistence,
                  // so "Dec 15" in eastern time re-renders as "Dec 14".
                  // Conversion to a stable full-ISO happens in onSave.
                  const next = e.target.value;
                  touchedRef.current.due = true;
                  if (!next) {
                    setDue("");
                    return;
                  }
                  if (/^\d{4}-\d{2}-\d{2}$/.test(next)) {
                    setDue(next);
                  }
                  // Else: ignore garbage value, keep prior `due` intact.
                }}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              />
            </label>

            <label className="text-xs text-sub flex flex-col gap-1">
              <span className="flex items-center gap-1"><Hash className="w-3 h-3" />Points</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={points}
                onChange={(e) => { touchedRef.current.points = true; setPoints(e.target.value); }}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="—"
              />
            </label>

            <label className="text-xs text-sub flex flex-col gap-1">
              <span className="flex items-center gap-1"><Activity className="w-3 h-3" />Status</span>
              <select
                value={status}
                onChange={(e) => { touchedRef.current.status = true; setStatus(e.target.value); }}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value="">— none —</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-xs text-sub flex flex-col gap-1">
            <span className="flex items-center gap-1"><Tag className="w-3 h-3" />Tags (comma separated)</span>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => { touchedRef.current.tagsInput = true; setTagsInput(e.target.value); }}
              maxLength={200}
              className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent font-mono"
              placeholder="auth, blocker, q1-launch"
            />
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-surface-deep text-sub border border-border rounded px-3 py-2 text-sm hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-accent text-bg font-medium px-3 py-2 rounded text-sm hover:bg-accent/80"
            >
              Save
            </button>
          </div>
          {card.sourceRef && (
            <p className="text-[10px] text-sub italic text-center pt-1">
              Linked to a {card.sourceRef.tool} item. {card.sourceRef.tool} edits flow into this card; card edits stay on the canvas.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
