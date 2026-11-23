"use client";

/**
 * One section of a kickoff, on the sectioned kit's card: Enter adds a line,
 * a line is edited in place, and a delete comes with Undo. Under each line,
 * what its section takes: an owner from the team, a worry's two ratings and
 * what covers it (with "What would take this away?" to add a cover), and
 * the lines a worry covers. Beside it, "Send to…" where the section sends
 * (never on the example, nor while a [placeholder] is left), and the tools
 * the section points to ("Open Skills Matrix"), when they exist.
 *
 * Every change goes through the page's `write`, which refuses a row too big
 * to save; the card then shows the reason.
 */

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { SectionItemsCard } from "@/components/sectioned/section-items-card";
import { ScalePicker, type ScaleStep } from "@/components/shared/scale-picker";
import { PersonInPlace } from "@/components/team/person-in-place";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getToolById } from "@/lib/constants/tools";
import { riskSourceProblem } from "@/lib/handoffs/targets/risk";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import { COVER_HINT, PEOPLE_SECTION, type KickoffSectionDef } from "@/lib/kickoff/formats";
import {
  coverSections,
  coveringItems,
  cutLine,
  findItem,
  itemSource,
  itemsOf,
  newKickoffItemId,
  oneLine,
  sendProblem,
  shortText,
  withItemPatch,
  withSectionItems,
} from "@/lib/kickoff/model";
import { roomLeft } from "@/lib/sectioned/model";
import {
  KICKOFF_ITEM_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type KickoffItem,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import type { KickoffHandle } from "./kickoff-handle";
import { KICKOFF_SEND_ROUTES, KickoffSendMenu } from "./send-menu";

const LIKELY: readonly ScaleStep[] = [
  { value: 1, meaning: "Very unlikely" },
  { value: 2, meaning: "Unlikely" },
  { value: 3, meaning: "It could happen" },
  { value: 4, meaning: "Likely" },
  { value: 5, meaning: "Almost certain" },
];
const BAD: readonly ScaleStep[] = [
  { value: 1, meaning: "Hardly matters" },
  { value: 2, meaning: "A nuisance" },
  { value: 3, meaning: "Serious" },
  { value: 4, meaning: "Very serious" },
  { value: 5, meaning: "It would stop us" },
];

/** A typed line for the team's people: "Ana, Product Owner" is Ana and her role. */
export function personFromText(text: string): KickoffItem {
  const at = text.indexOf(",");
  const name = oneLine(at >= 0 ? text.slice(0, at) : text);
  const role = at >= 0 ? oneLine(text.slice(at + 1)) : "";
  return {
    id: newKickoffItemId(),
    text: cutText(role, KICKOFF_ITEM_MAX),
    ...(name ? { owner: cutText(name, TOOL_TEXT_MAX.short) } : {}),
  };
}

/** The two ratings of a worry, 1–5. */
function Ratings({
  item,
  onRate,
}: {
  item: KickoffItem;
  onRate: (field: "likelihood" | "impact", value: number | null) => void;
}) {
  const words = shortText(item.text, 60);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ScalePicker
        label="How likely"
        groupLabel={`How likely is “${words}”?`}
        steps={LIKELY}
        value={item.likelihood ?? null}
        onValueChange={(v) => onRate("likelihood", v)}
        onClear={() => onRate("likelihood", null)}
        size="sm"
      />
      <ScalePicker
        label="How bad"
        groupLabel={`How bad would “${words}” be?`}
        steps={BAD}
        value={item.impact ?? null}
        onValueChange={(v) => onRate("impact", v)}
        onClear={() => onRate("impact", null)}
        size="sm"
      />
    </div>
  );
}

/** What covers a worry, and the inline add for one more. */
function Cover({ handle, worry }: { handle: KickoffHandle; worry: KickoffItem }) {
  const { kickoff: k, write, log } = handle;
  const targets = coverSections(k);
  const covering = coveringItems(k, worry.id);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(targets.length === 1 ? targets[0].id : "");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();
  if (targets.length === 0) return null;
  const def = targets.find((d) => d.id === target);
  const hint = !def
    ? null
    : def.owner && def.covers === "a commitment"
      ? COVER_HINT.commitment
      : COVER_HINT.resource;

  const add = () => {
    const words = cutText(oneLine(text), KICKOFF_ITEM_MAX);
    if (!def) {
      setProblem("Pick what takes it away first.");
      return;
    }
    if (!words) {
      setProblem("Write what would take it away.");
      return;
    }
    const w = write((cur, now) => {
      const items = itemsOf(cur, def.id);
      if (roomLeft(def, items) === 0) return null;
      return withSectionItems(
        cur,
        def.id,
        [...items, { id: newKickoffItemId(), text: words, covers: worry.id }],
        now
      );
    });
    if (!w.ok) {
      setProblem(w.message ?? `“${def.label}” is full. Delete a line there to add this.`);
      return;
    }
    log(KICKOFF_ACTIONS.ITEM_ADDED, { kickoffId: k.id, section: def.id });
    setText("");
    setProblem(null);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      {covering.length > 0 ? (
        <p className="text-xs text-sub">
          Covered by:{" "}
          {covering.map((c, i) => (
            <span key={c.item.id}>
              {i > 0 ? "; " : ""}
              {shortText(c.item.text, 60)}
              {c.item.owner ? ` (${c.item.owner})` : ""}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-xs font-medium text-warning" data-uncovered>
          Nothing covers this yet.
        </p>
      )}
      {!handle.example &&
        (open ? (
          <div className="space-y-2 rounded-md border border-border bg-card p-2">
            {targets.length > 1 && (
              <fieldset className="flex flex-wrap items-center gap-1.5">
                <legend className="mb-1 text-xs text-sub">What takes it away?</legend>
                {targets.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={target === t.id}
                    className="aria-pressed:border-accent aria-pressed:text-accent"
                    onClick={() => {
                      setTarget(t.id);
                      setProblem(null);
                    }}
                  >
                    {t.covers}
                  </Button>
                ))}
              </fieldset>
            )}
            <label htmlFor={fieldId} className="block text-xs text-sub">
              {hint ?? "Pick what takes it away."}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={fieldId}
                value={text}
                maxLength={KICKOFF_ITEM_MAX}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  add();
                }}
                className="min-w-0 sm:flex-1"
              />
              <Button type="button" variant="toolkit" onClick={add} className="shrink-0">
                <Plus aria-hidden="true" />
                Add {def?.covers ?? "it"}
              </Button>
            </div>
            {problem && (
              <p role="alert" className="text-xs text-danger">
                {problem}
              </p>
            )}
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-xs text-sub hover:text-accent"
            aria-label={`What would take “${shortText(worry.text, 60)}” away?`}
            onClick={() => setOpen(true)}
          >
            What would take this away?
          </Button>
        ))}
    </div>
  );
}

const ROUTES: ReadonlySet<string> = new Set(KICKOFF_SEND_ROUTES);

export function KickoffSection({
  handle,
  def,
  className,
}: {
  handle: KickoffHandle;
  def: KickoffSectionDef;
  className?: string;
}) {
  const { kickoff: k, write, log, example } = handle;
  const items = itemsOf(k, def.id);
  const routes = (def.routes ?? []).filter((r) => ROUTES.has(r));
  const worryLabel = (id: string) => {
    const found = findItem(k, id);
    return found ? shortText(found.item.text, 60) : null;
  };

  const onChange = (next: KickoffItem[]): string | void => {
    const before = itemsOf(k, def.id).length;
    const w = write((cur, now) => withSectionItems(cur, def.id, next, now));
    if (!w.ok) return w.message ?? undefined;
    if (next.length > before) {
      log(KICKOFF_ACTIONS.ITEM_ADDED, { kickoffId: k.id, section: def.id });
    } else {
      log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
    }
  };
  const update = (fn: (items: readonly KickoffItem[]) => KickoffItem[]): string | void => {
    const w = write((cur, now) => withSectionItems(cur, def.id, fn(itemsOf(cur, def.id)), now));
    if (!w.ok) return w.message ?? undefined;
    log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
  };
  const patch = (item: KickoffItem, fn: (i: KickoffItem) => KickoffItem) => {
    const w = write((cur, now) => withItemPatch(cur, item.id, fn, now));
    if (w.ok) log(KICKOFF_ACTIONS.KICKOFF_UPDATED, { kickoffId: k.id });
  };
  const setLinks =
    (item: KickoffItem) =>
    (change: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      let before: readonly HandoffLink[] = [];
      const w = write((cur, now) =>
        withItemPatch(
          cur,
          item.id,
          (i) => {
            before = i.sentTo ?? [];
            const sentTo = change(i.sentTo);
            const { sentTo: _old, ...rest } = i;
            void _old;
            return sentTo.length > 0 ? { ...rest, sentTo } : rest;
          },
          now,
          // Where a line went isn't a change to its words.
          { stamp: false }
        )
      );
      if (!w.ok) return;
      const after = findItem(w.kickoff, item.id)?.item.sentTo ?? [];
      for (const link of after) {
        const was = before.find((l) => l.route === link.route);
        if (!was || was.targetId !== link.targetId) {
          log(KICKOFF_ACTIONS.ITEM_SENT, { kickoffId: k.id, section: def.id, route: link.route });
        }
      }
    };

  const renderExtras = (item: KickoffItem) => {
    const parts: ReactNode[] = [];
    if (def.owner) {
      parts.push(
        <PersonInPlace
          key="owner"
          label={def.ownerLabel ?? "Owner"}
          name={item.owner ?? ""}
          offerAddToRoster={!example}
          maxLength={TOOL_TEXT_MAX.short}
          onSave={(name) => {
            const owner = cutLine(name, TOOL_TEXT_MAX.short);
            // A person with no role and no name would be an empty line: keep the name.
            if (!owner && !item.text.trim()) return;
            patch(item, (i) => {
              const { owner: _o, ...rest } = i;
              void _o;
              return owner ? { ...rest, owner } : rest;
            });
          }}
        />
      );
    }
    if (def.ratings) {
      parts.push(
        <Ratings
          key="ratings"
          item={item}
          onRate={(field, value) =>
            patch(item, (i) => {
              const next = { ...i };
              if (value === null) delete next[field];
              else next[field] = value;
              return next;
            })
          }
        />
      );
    }
    if (def.coverTarget) parts.push(<Cover key="cover" handle={handle} worry={item} />);
    if (def.covers && item.covers) {
      const words = worryLabel(item.covers);
      if (words) {
        parts.push(
          <p key="covers" className="text-xs text-sub">
            Covers: {words}
          </p>
        );
      }
    }
    if (routes.length > 0 && !example) {
      const reason =
        sendProblem(k, item) ?? (routes.includes("risk") ? riskSourceProblem(item) : null);
      if (reason && item.text.trim()) {
        parts.push(
          <p key="why" className="text-xs text-sub" data-send-blocked>
            {reason}
          </p>
        );
      }
    }
    return parts.length > 0 ? <div className="space-y-2">{parts}</div> : null;
  };

  const renderActions = (item: KickoffItem) => {
    if (routes.length === 0) return null;
    return (
      <KickoffSendMenu
        entries={routes.map((route) => ({ route, item: itemSource(k, item, route) }))}
        sentTo={item.sentTo}
        getLinks={() => {
          const cur = handle.read();
          return cur ? findItem(cur, item.id)?.item.sentTo : undefined;
        }}
        onLinksChange={setLinks(item)}
        disabled={sendProblem(k, item) !== null}
      />
    );
  };

  const links = (def.links ?? []).flatMap((id) => {
    const tool = getToolById(id);
    return tool ? [tool] : [];
  });

  return (
    <SectionItemsCard<KickoffItem>
      def={def}
      items={items}
      itemMax={KICKOFF_ITEM_MAX}
      onChange={onChange}
      update={update}
      makeItem={def.id === PEOPLE_SECTION ? personFromText : undefined}
      renderExtras={renderExtras}
      renderActions={renderActions}
      actions={
        links.length > 0 ? (
          <span className="flex flex-wrap gap-2">
            {links.map((tool) => (
              <Link
                key={tool.id}
                href={tool.path}
                className="min-touch-coarse inline-flex items-center text-xs text-accent hover:underline"
              >
                Open {tool.name}
              </Link>
            ))}
          </span>
        ) : undefined
      }
      className={className}
    />
  );
}
