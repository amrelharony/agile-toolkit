"use client";

/**
 * Why a card or story is blocked: "Add why" (or "Why: <cause>") beside the
 * Blocked badge opens a dialog to write the cause on its blocked spell,
 * put it in a blocker cluster (the defaults, the clusters already used, or
 * a new one with its side), link an open impediment, or log it as a new
 * impediment. The cluster stays on the spell, where Impediments reads it.
 * A block from before tracking began gets a spell from now, marked as
 * earlier. Saving has Undo; logging an impediment has the hand-off's Undo.
 * Example rows are never stamped, so they get no button.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BLOCKER_CLUSTER_MAX,
  TOOL_TEXT_MAX,
  type BlockSide,
  type BlockSpell,
  type HandoffLink,
} from "@/lib/stores/workspace-types";
import { DEFAULT_BLOCKER_CLUSTERS } from "@/lib/impediments/clusters";
import { isResolved } from "@/lib/impediments/model";
import { openSpellIndex, withSpellNote, type SpellNote } from "@/lib/flow/block-stamps";
import { blockNotedPayload } from "@/lib/kanban/workflow-view";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import type { HandoffLinkStore } from "@/lib/handoffs/send";
import { KANBAN_FLOW_DOC } from "@/lib/handoffs/sources";
import { isExampleId } from "@/lib/utils/example-id";
import { undoable } from "@/lib/utils/undoable";
import { SELECT_CLASS } from "./workflow/fields";

/** A row that can be flagged blocked: a Flow-board card or a Sprint-board story. */
export interface BlockableItem {
  id: string;
  title: string;
  blocked?: boolean;
  blockLog?: BlockSpell[];
  /** A Sprint-board story's sprint: an impediment logged from it links back to that board. */
  sprintId?: string;
}

export const SIDE_LABEL: Record<BlockSide, string> = {
  internal: "Inside the team",
  external: "Outside the team",
};

/** The spell a note goes on: the open one, or null when the block began before tracking. */
export function openSpell(item: Pick<BlockableItem, "blockLog">): BlockSpell | null {
  const log = Array.isArray(item.blockLog) ? item.blockLog : [];
  const i = openSpellIndex(log);
  return i >= 0 ? log[i] : null;
}

/**
 * `log` with a saved note taken back from the spell starting at `from`,
 * and nothing else: `previous` is that spell as it was before the save
 * (its cause, cluster, side and links come back, and an end stamped since
 * stays), or null when the save started the spell, which then goes. The
 * log as given when the spell isn't there any more.
 */
export function unnotedLog(
  log: BlockSpell[] | undefined,
  from: string,
  previous: BlockSpell | null
): BlockSpell[] | undefined {
  const list = Array.isArray(log) ? log : [];
  if (!previous) {
    const out = list.filter((s) => !(s.from === from && s.earlier));
    return out.length ? out : undefined;
  }
  const row = withSpellNote(
    { id: "undo", blocked: true, blockLog: list },
    {
      cause: previous.cause ?? "",
      cluster: previous.cluster ?? "",
      side: previous.side ?? null,
      sentTo: previous.sentTo ?? [],
    },
    { spellFrom: from }
  );
  return row ? row.blockLog : log;
}

/** "Add why", or "Why: <cause>" cut to fit a card. */
export function whyLabel(spell: BlockSpell | null): string {
  const cause = spell?.cause?.trim();
  if (!cause) return "Add why";
  return `Why: ${cause.length > 28 ? `${cause.slice(0, 27).trimEnd()}…` : cause}`;
}

/**
 * The hand-off sender, loaded when the dialog opens rather than with the
 * board: it brings the whole registry and every target, and "Log as
 * impediment" is the board's only send. A failed load is tried again.
 */
let sendModule: Promise<typeof import("@/lib/handoffs/send")> | null = null;
function loadSend(): Promise<typeof import("@/lib/handoffs/send")> {
  sendModule ??= import("@/lib/handoffs/send").catch((error: unknown) => {
    sendModule = null;
    throw error;
  });
  return sendModule;
}

const NEW = "new";
const NONE = "";
const labelKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The clusters a team has used that aren't defaults, with the side each carries. */
function useCustomClusters(): { label: string; side?: BlockSide }[] {
  const stories = useWorkspaceStore((s) => s.stories);
  const boards = useWorkspaceStore((s) => s.kanbanBoards);
  return useMemo(() => {
    const defaults = new Set(DEFAULT_BLOCKER_CLUSTERS.map((c) => labelKey(c.label)));
    const found = new Map<string, { label: string; side?: BlockSide }>();
    const rows = [
      ...(stories ?? []),
      ...(boards ?? []).flatMap((b) => (Array.isArray(b.cards) ? b.cards : [])),
    ];
    for (const row of rows) {
      for (const spell of Array.isArray(row.blockLog) ? row.blockLog : []) {
        const label = spell?.cluster?.trim();
        if (!label || defaults.has(labelKey(label)) || found.has(labelKey(label))) continue;
        found.set(labelKey(label), { label, ...(spell.side ? { side: spell.side } : {}) });
      }
    }
    return Array.from(found.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [stories, boards]);
}

export interface BlockWhyProps {
  item: BlockableItem;
  /** "cardId" on the Flow board, "storyId" on the Sprint board (the history payload). */
  idKey: "cardId" | "storyId";
  /** The row as stored right now. */
  fresh: () => BlockableItem | undefined;
  /** Write a note on the row's open spell (`withSpellNote`); false when nothing changed. */
  writeNote: (note: SpellNote) => boolean;
  /** Write the row's blocked spells as given (an Undo of a note: `unnotedLog`). */
  restoreLog: (log: BlockSpell[] | undefined) => void;
  log: (action: string, payload: Record<string, unknown>) => void;
  /** Extra history payload (the Sprint board says `board: "sprint"`). */
  extra?: Record<string, unknown>;
}

/** The "Add why" button and its dialog, for a blocked row that isn't an example. */
export function BlockWhy(props: BlockWhyProps) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!item.blocked || isExampleId(item.id)) return null;
  const spell = openSpell(item);
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="min-touch-coarse h-7 max-w-full gap-1 px-2 text-xs text-sub hover:text-text"
      >
        <MessageSquareText aria-hidden="true" />
        <span className="truncate">{whyLabel(spell)}</span>
        <span className="sr-only">: {item.title}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onCloseAutoFocus={() => triggerRef.current?.focus()}>
          {/* Mounted while open, so each opening starts from the stored spell. */}
          {open && <BlockNoteForm {...props} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BlockNoteForm({
  item,
  idKey,
  fresh,
  writeNote,
  restoreLog,
  log,
  extra,
  onClose,
}: BlockWhyProps & { onClose: () => void }) {
  const announce = useAnnounce();
  const customs = useCustomClusters();
  const impediments = useWorkspaceStore((s) => s.impediments);
  const spell = openSpell(item);
  const untracked = Boolean(item.blocked) && spell === null;
  const linkOf = (s: BlockSpell | null) => s?.sentTo?.find((l) => l.route === "impediment");

  const initialChoice = (): string => {
    const label = spell?.cluster;
    if (!label) return NONE;
    const d = DEFAULT_BLOCKER_CLUSTERS.findIndex((c) => labelKey(c.label) === labelKey(label));
    return d >= 0 ? `default:${d}` : `used:${label}`;
  };
  const [cause, setCause] = useState(spell?.cause ?? "");
  const [choice, setChoice] = useState(initialChoice);
  const [newName, setNewName] = useState("");
  const [newSide, setNewSide] = useState<BlockSide>("internal");
  // An example impediment is never linked: a real block must not point at example data.
  const [linked, setLinked] = useState(() => {
    const id = linkOf(spell)?.targetId;
    return id && !isExampleId(id) ? id : NONE;
  });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Fetched as the dialog opens, so "Log as impediment" doesn't wait on it.
  useEffect(() => {
    loadSend().catch(() => {});
  }, []);

  const openImpediments = (impediments ?? []).filter(
    (i) => !isExampleId(i.id) && (!isResolved(i) || i.id === linked)
  );
  const linkedImpediment = (impediments ?? []).find((i) => i.id === linked);

  /** The cluster and side the choice stands for. */
  const cluster = (): { label?: string; side?: BlockSide } | null => {
    if (choice === NONE) return {};
    if (choice === NEW) {
      const label = newName.trim();
      return label ? { label, side: newSide } : null;
    }
    if (choice.startsWith("default:")) {
      const d = DEFAULT_BLOCKER_CLUSTERS[Number(choice.slice(8))];
      return d ? { label: d.label, side: d.side } : {};
    }
    const label = choice.slice(5);
    return { label, side: customs.find((c) => c.label === label)?.side };
  };

  const links = (): HandoffLink[] => {
    const current = openSpell(fresh() ?? item)?.sentTo ?? [];
    const others = current.filter((l) => l.route !== "impediment");
    if (!linked || isExampleId(linked)) return others;
    const had = current.find((l) => l.route === "impediment" && l.targetId === linked);
    return [
      ...others,
      had ?? { route: "impediment", targetId: linked, at: new Date().toISOString() },
    ];
  };

  const save = () => {
    const c = cluster();
    if (c === null) {
      setError("Name the new cluster, or pick one from the list.");
      return;
    }
    const before = fresh() ?? item;
    const note: SpellNote = {
      cause: cause.trim(),
      cluster: c.label ?? "",
      side: c.side ?? null,
      sentTo: links(),
    };
    // Nothing to write: no Undo toast for a no-op, just close.
    const preview = withSpellNote(before, note);
    if (!preview || preview === before) {
      announce(`Nothing changed for “${item.title}”.`);
      onClose();
      return;
    }
    // The spell the note goes on, as it was; null when saving starts one (a block from before tracking).
    const target = openSpell(before);
    let wrote = false;
    let noted: string | undefined;
    undoable({
      label: "Saved why it's blocked",
      apply: () => {
        wrote = writeNote(note);
        noted = target?.from ?? openSpell(fresh() ?? item)?.from;
      },
      // Undo takes back the note only, on the log as it is then: a spell
      // closed since (unblocked, or moved to Done) keeps its end.
      revert: () => {
        const now = fresh();
        if (!wrote || noted === undefined || !now) return;
        restoreLog(unnotedLog(now.blockLog, noted, target));
      },
    });
    if (wrote) {
      log(KANBAN_ACTIONS.BLOCK_NOTED, {
        ...blockNotedPayload(idKey, item.id, c.label, c.side, DEFAULT_BLOCKER_CLUSTERS),
        ...extra,
      });
      announce(`Saved why “${item.title}” is blocked.`);
    }
    onClose();
  };

  const logImpediment = async () => {
    setSending(true);
    const sender = await loadSend().catch(() => null);
    setSending(false);
    if (!sender) {
      setStatus("Couldn't log it just now. Try again.");
      return;
    }
    const { sendHandoff } = sender;
    // A link to an example row doesn't count (and goes when the new one is written).
    const realLinks = () =>
      openSpell(fresh() ?? item)?.sentTo?.filter((l) => !isExampleId(l.targetId));
    const store: HandoffLinkStore = {
      getLinks: realLinks,
      setLinks: (update) => {
        writeNote({ sentTo: update(realLinks()) });
      },
    };
    // The board it is on, so the impediment's "From Kanban board" opens that
    // board: /kanban alone opens the Sprint board while a sprint is active.
    const doc = idKey === "cardId" ? KANBAN_FLOW_DOC : item.sprintId;
    const link = sendHandoff(
      "impediment",
      {
        title: item.title,
        ...(cause.trim() ? { description: cause.trim() } : {}),
        sourceRef: { tool: "kanban", id: item.id, ...(doc ? { doc } : {}) },
      },
      store
    );
    if (!link) {
      setStatus("It is already linked to an open impediment.");
      return;
    }
    setLinked(link.targetId);
    setStatus("Logged as an impediment and linked here.");
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Why is it blocked?</DialogTitle>
        <DialogDescription className="break-words">{item.title}</DialogDescription>
      </DialogHeader>
      {untracked && (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-sub">
          Blocked since before tracking. Saving starts a record of this block from now, marked as
          earlier.
        </p>
      )}
      <Field label="What blocks it" hint="One or two sentences.">
        {(p) => (
          <Textarea
            {...p}
            value={cause}
            maxLength={TOOL_TEXT_MAX.short}
            rows={2}
            onChange={(e) => setCause(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Blocker cluster"
        hint="Group it with blocks like it."
        error={error ?? undefined}
      >
        {(p) => (
          <select
            {...p}
            className={SELECT_CLASS}
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setError(null);
            }}
          >
            <option value={NONE}>No cluster</option>
            {(["internal", "external"] as const).map((side) => (
              <optgroup key={side} label={SIDE_LABEL[side]}>
                {DEFAULT_BLOCKER_CLUSTERS.map((c, i) =>
                  c.side === side ? (
                    <option key={c.label} value={`default:${i}`}>
                      {c.label}
                    </option>
                  ) : null
                )}
              </optgroup>
            ))}
            {customs.length > 0 && (
              <optgroup label="Your clusters">
                {customs.map((c) => (
                  <option key={c.label} value={`used:${c.label}`}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW}>New cluster…</option>
          </select>
        )}
      </Field>
      {choice === NEW && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New cluster's name">
            {(p) => (
              <Input
                {...p}
                value={newName}
                maxLength={BLOCKER_CLUSTER_MAX}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>
          <Field label="It sits">
            {(p) => (
              <select
                {...p}
                className={SELECT_CLASS}
                value={newSide}
                onChange={(e) => setNewSide(e.target.value as BlockSide)}
              >
                {(["internal", "external"] as const).map((side) => (
                  <option key={side} value={side}>
                    {SIDE_LABEL[side]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}
      <div className="grid gap-2">
        <Field label="Link an impediment" hint="An open impediment this block waits on.">
          {(p) => (
            <select
              {...p}
              className={SELECT_CLASS}
              value={linked}
              onChange={(e) => setLinked(e.target.value)}
            >
              <option value={NONE}>Not linked</option>
              {openImpediments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => void logImpediment()}
          >
            Log as impediment
          </Button>
          {linkedImpediment && (
            <Link
              href="/impediments"
              className="text-sm text-accent underline-offset-2 hover:underline"
            >
              Open Impediments
            </Link>
          )}
        </div>
        {status && (
          <p role="status" className="text-sm text-sub">
            {status}
          </p>
        )}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save why</Button>
      </DialogFooter>
    </form>
  );
}
