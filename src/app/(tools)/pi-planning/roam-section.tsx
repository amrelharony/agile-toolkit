"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, Pencil, ShieldAlert } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { PersonPicker } from "@/components/team/person-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useReturnFocus } from "@/hooks/use-return-focus";
import {
  fitRoamInput,
  roamAskFor,
  roamItemId,
  roamTask,
  type RoamOutput,
} from "@/lib/ai/tasks/pi-planning.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { liveLink } from "@/lib/handoffs/registry";
import { sendHandoff, type HandoffLinkStore } from "@/lib/handoffs/send";
import { PI_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import {
  ROAM_NOTE_MAX,
  ROAM_OWNER_MAX,
  ROAM_STATUSES,
  cleanText,
  isRoamStatus,
  type PiItem,
  type PiState,
  type RoamStatus,
} from "@/lib/pi-planning/model";
import {
  ROAM_GROUPS,
  ROAM_GROUP_LABEL,
  ROAM_LABEL,
  ROAM_MEANING,
  canLogRisk,
  piItemRef,
  roamGroups,
  roamVerdict,
  type RoamGuessStatus,
} from "@/lib/pi-planning/roam";
import { IMPACT_HINT, IMPACT_STEPS, LIKELIHOOD_HINT, LIKELIHOOD_STEPS } from "@/lib/risks/scales";
import { cutText } from "@/lib/utils/cut-text";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import { SelectField } from "../dependency-map/fields";

type Log = (action: string, payload?: Record<string, unknown>) => void;
type Update = (fn: (s: PiState) => PiState) => void;

/** `item` with `key` set, or without it when the value is undefined. */
function withField<K extends keyof PiItem>(item: PiItem, key: K, value: PiItem[K] | undefined) {
  const next = { ...item };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

const short = (text: string, max = 40) => {
  const t = text.trim();
  return t.length > max ? `${cutText(t, max - 1).trimEnd()}…` : t;
};

/* ── Owner and note ─────────────────────────────────────────────────── */

interface DetailsDraft {
  owner: string;
  note: string;
}
export interface DetailsValues {
  owner?: string;
  note?: string;
}

/**
 * Owner and note are both optional; each is cut to its cap (never through
 * a character: half an emoji makes the cloud row refuse the board), blank
 * clears it.
 */
export function validateRoamDetails(
  d: DetailsDraft
): Validation<DetailsValues, keyof DetailsDraft> {
  const owner = cleanText(d.owner, ROAM_OWNER_MAX);
  const note = cleanText(d.note, ROAM_NOTE_MAX);
  return {
    ok: true,
    values: {
      ...(owner ? { owner } : {}),
      ...(note ? { note } : {}),
    },
  };
}

function DetailsEditor({
  risk,
  onSave,
  onCancel,
}: {
  risk: PiItem;
  onSave: (v: DetailsValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<DetailsDraft, DetailsValues, keyof DetailsDraft>({
    initial: () => ({ owner: risk.roamOwner ?? "", note: risk.roamNote ?? "" }),
    validate: validateRoamDetails,
    onSave,
    resetOnSave: false,
  });
  const { draft, update } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Save owner and note"
      onCancel={onCancel}
      className="space-y-2"
    >
      <PersonPicker
        label="Owner"
        hint="Who chases it. Optional."
        value={draft.owner}
        onChange={(owner) => update({ owner: cutText(owner, ROAM_OWNER_MAX) })}
        offerAddToRoster={false}
      />
      <Field label="Note" hint="What's being done about it, or why the train accepts it. Optional.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={ROAM_NOTE_MAX}
            value={draft.note}
            onChange={(e) => update({ note: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>
    </ItemForm>
  );
}

/* ── Risk Register ──────────────────────────────────────────────────── */

interface RatingDraft {
  likelihood: number | null;
  impact: number | null;
}
export interface RatingValues {
  likelihood: number;
  impact: number;
}

/** The Risk Register needs both ratings: it never saves a risk at a default score. */
export function validateRiskRatings(d: RatingDraft): Validation<RatingValues, keyof RatingDraft> {
  const errors: Partial<Record<keyof RatingDraft, string>> = {};
  if (d.likelihood === null) errors.likelihood = "Rate how likely it is.";
  if (d.impact === null) errors.impact = "Rate its impact.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { likelihood: d.likelihood as number, impact: d.impact as number } };
}

function RatingFields({ form }: { form: ItemFormState<RatingDraft, keyof RatingDraft> }) {
  const { draft, update, errors } = form;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ScalePicker
        label="Likelihood"
        size="sm"
        steps={LIKELIHOOD_STEPS}
        value={draft.likelihood}
        onValueChange={(likelihood) => update({ likelihood })}
        onClear={() => update({ likelihood: null })}
        hint={LIKELIHOOD_HINT}
        error={errors.likelihood}
      />
      <ScalePicker
        label="Impact"
        size="sm"
        steps={IMPACT_STEPS}
        value={draft.impact}
        onValueChange={(impact) => update({ impact })}
        onClear={() => update({ impact: null })}
        hint={IMPACT_HINT}
        error={errors.impact}
      />
    </div>
  );
}

function RiskLogForm({
  onSend,
  onCancel,
}: {
  onSend: (v: RatingValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<RatingDraft, RatingValues, keyof RatingDraft>({
    initial: { likelihood: null, impact: null },
    validate: validateRiskRatings,
    onSave: onSend,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add to the Risk Register"
      onCancel={onCancel}
      className="space-y-2 rounded-lg border border-border bg-bg p-3"
    >
      <p className="text-xs text-sub">
        The Risk Register rates every risk, so rate this one first. Its owner and note go with it.
      </p>
      <RatingFields form={form} />
    </ItemForm>
  );
}

/* ── The section ────────────────────────────────────────────────────── */

interface RoamSuggestion {
  itemId: string;
  title: string;
  roam: RoamGuessStatus;
  reason: string;
  action: string;
}

const STATUS_OPTIONS = [
  { value: "", label: ROAM_GROUP_LABEL.unsorted },
  ...ROAM_STATUSES.map((s) => ({ value: s, label: ROAM_LABEL[s] })),
];

/**
 * "Risks: ROAM": every risk on the board, grouped To sort, Resolved,
 * Owned, Accepted and Mitigated, each with a status picker (no dragging,
 * so it works the same on a phone), an owner and a note. Owned and
 * mitigated risks can go to the Risk Register, rated first, with Undo.
 * Amr (or the keyword rules) suggests a status for the risks still to
 * sort; each suggestion is accepted on its own, with Undo.
 */
export function RoamSection({
  state,
  latest,
  update,
  log,
}: {
  state: PiState;
  /** The board as last rendered, read fresh by a hand-off and its Undo. */
  latest: () => PiState;
  update: Update;
  log: Log;
}) {
  const groups = roamGroups(state);
  const total = ROAM_GROUPS.reduce((a, g) => a + groups[g].length, 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ items: RoamSuggestion[]; source: AiSource } | null>(
    null
  );
  const [announce, setAnnounce] = useState("");
  const askIds = useRef<string[]>([]);
  const askRef = useRef<HTMLDivElement>(null);
  const { refFor, returnTo } = useReturnFocus();
  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.name ?? "";

  const patch = (id: string, fn: (i: PiItem) => PiItem) =>
    update((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? fn(i) : i)) }));

  const setRoam = (risk: PiItem, roam: RoamStatus | undefined) => {
    if (roam === risk.roam) return;
    patch(risk.id, (i) => withField(i, "roam", roam));
    setAnnounce(
      `“${short(risk.title)}” is ${roam ? ROAM_LABEL[roam].toLowerCase() : "back to sort"}.`
    );
    log(PI_PLANNING_ACTIONS.RISK_ROAMED, { riskId: risk.id, roam: roam ?? null });
  };

  const closeDetails = (id: string) => {
    setEditing(null);
    returnTo(`roam-edit:${id}`);
  };

  const saveDetails = (risk: PiItem, v: DetailsValues) => {
    closeDetails(risk.id);
    patch(risk.id, (i) => withField(withField(i, "roamOwner", v.owner), "roamNote", v.note));
  };

  /** The risk's links, read fresh and written back, for the hand-off and its Undo. */
  const linksOf = (id: string): HandoffLinkStore => ({
    getLinks: () => latest().items.find((i) => i.id === id)?.sentTo,
    setLinks: (change) =>
      patch(id, (i) => {
        const next = change(i.sentTo);
        return withField(i, "sentTo", next.length > 0 ? next : undefined);
      }),
  });

  const sendToRegister = (risk: PiItem, v: RatingValues) => {
    const team = teamName(risk.teamId);
    const link = sendHandoff(
      "risk",
      {
        title: risk.title,
        description: [
          `Raised at PI Planning${team ? ` by ${team}` : ""}, iteration ${risk.iteration + 1}.`,
          risk.description ?? "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        ...(risk.roamOwner ? { owner: risk.roamOwner } : {}),
        ...(risk.roamNote ? { mitigation: risk.roamNote } : {}),
        likelihood: v.likelihood,
        impact: v.impact,
        sourceRef: piItemRef(risk),
      },
      linksOf(risk.id)
    );
    if (link) {
      setLogging(null);
      returnTo(`roam-open:${risk.id}`);
    }
  };

  /** Amr's statuses for the risks still to sort, mapped back from their short ids. */
  const showSuggestions = (data: RoamOutput, source: AiSource) => {
    const board = latest();
    const seen = new Set<string>();
    const items: RoamSuggestion[] = [];
    for (const r of data.risks) {
      const itemId = roamItemId(askIds.current, r.id);
      const item = itemId ? board.items.find((i) => i.id === itemId) : undefined;
      if (!item || item.kind !== "risk" || item.roam || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push({ itemId: item.id, title: item.title, ...r });
    }
    setSuggested({ items, source });
    setAnnounce(items.length === 0 ? "No suggestions for the risks still to sort." : "");
  };

  const accept = (s: RoamSuggestion) => {
    const before = latest().items.find((i) => i.id === s.itemId);
    if (!before || before.kind !== "risk") return;
    undoable({
      label: `“${short(before.title)}” is now ${ROAM_LABEL[s.roam].toLowerCase()}`,
      kind: "success",
      apply: () => patch(s.itemId, (i) => ({ ...i, roam: s.roam })),
      revert: () => patch(s.itemId, (i) => withField(i, "roam", before.roam)),
    });
    log(PI_PLANNING_ACTIONS.RISK_ROAMED, { riskId: s.itemId, roam: s.roam, suggested: true });
  };

  if (total === 0) {
    return (
      <p className="text-sm text-sub">
        No risks on the board yet. Add an item of kind Risk to a team&apos;s iteration, then sort it
        here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 text-sm font-medium text-text">
          {roamVerdict(state)}
        </p>
        {groups.unsorted.length > 0 && (
          <div ref={askRef}>
            <AiButton
              task={roamTask}
              label="Suggest ROAM"
              fallbackLabel="Suggest from keywords"
              variant="outline"
              input={() => {
                const ask = roamAskFor(latest(), groups.unsorted);
                askIds.current = ask.itemIds;
                return fitRoamInput(ask.input);
              }}
              onResult={(data, meta) => showSuggestions(data, meta.source)}
            />
          </div>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-sub sm:grid-cols-2">
        {ROAM_STATUSES.map((s) => (
          <li key={s}>
            <span className="font-medium text-text">{ROAM_LABEL[s]}</span>: {ROAM_MEANING[s]}
          </li>
        ))}
      </ul>

      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          source={suggested.source}
          title="ROAM to check"
          acceptLabel="Set"
          itemKey={(s) => s.itemId}
          render={(s) => ({
            title: `${s.title}: ${ROAM_LABEL[s.roam]}`,
            detail: `${s.reason} ${s.action}`,
          })}
          onAccept={accept}
          onDismiss={() => setSuggested(null)}
          returnFocus={() =>
            askRef.current?.querySelector<HTMLElement>('[data-testid="ai-button"]')
          }
        />
      )}

      {ROAM_GROUPS.filter((g) => groups[g].length > 0).map((g) => (
        <section key={g} aria-labelledby={`roam-${g}`} className="space-y-2">
          <h3 id={`roam-${g}`} className="text-sm font-semibold text-text">
            {ROAM_GROUP_LABEL[g]} <span className="font-normal text-sub">({groups[g].length})</span>
          </h3>
          <ul className="space-y-2">
            {groups[g].map((risk) => {
              const name = risk.title || "Untitled risk";
              const sent = liveLink(risk.sentTo, "risk");
              const example = isExampleId(risk.id);
              return (
                <li
                  key={risk.id}
                  className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="break-words text-sm text-text">{name}</p>
                      <p className="text-xs text-sub">
                        {teamName(risk.teamId) || "Unnamed team"} · iteration {risk.iteration + 1}
                      </p>
                    </div>
                    <SelectField
                      label={`ROAM status for ${name}`}
                      hideLabel
                      className="w-full sm:w-64"
                      options={STATUS_OPTIONS}
                      value={risk.roam ?? ""}
                      onChange={(v) => setRoam(risk, isRoamStatus(v) ? v : undefined)}
                    />
                  </div>
                  {(risk.roamOwner || risk.roamNote) && editing !== risk.id && (
                    <dl className="space-y-0.5 text-xs">
                      {risk.roamOwner && (
                        <div className="flex flex-wrap gap-x-1">
                          <dt className="text-sub">Owner:</dt>
                          <dd className="break-words text-text">{risk.roamOwner}</dd>
                        </div>
                      )}
                      {risk.roamNote && (
                        <div className="flex flex-wrap gap-x-1">
                          <dt className="text-sub">Note:</dt>
                          <dd className="whitespace-pre-wrap break-words text-text">
                            {risk.roamNote}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {editing === risk.id ? (
                    <DetailsEditor
                      risk={risk}
                      onSave={(v) => saveDetails(risk, v)}
                      onCancel={() => closeDetails(risk.id)}
                    />
                  ) : logging === risk.id ? (
                    <RiskLogForm
                      onSend={(v) => sendToRegister(risk, v)}
                      onCancel={() => {
                        setLogging(null);
                        returnTo(`roam-log:${risk.id}`);
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        ref={refFor(`roam-edit:${risk.id}`)}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-touch-coarse gap-1 text-xs text-sub hover:text-text"
                        aria-label={`Owner and note for ${name}`}
                        onClick={() => {
                          setLogging(null);
                          setEditing(risk.id);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        Owner and note
                      </Button>
                      {sent ? (
                        <Link
                          ref={refFor(`roam-open:${risk.id}`)}
                          href="/risk-register"
                          className="min-touch-coarse inline-flex items-center gap-1 py-1 text-xs text-accent underline-offset-2 hover:underline"
                        >
                          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                          In the Risk Register
                        </Link>
                      ) : (
                        canLogRisk(risk) &&
                        !example && (
                          <Button
                            ref={refFor(`roam-log:${risk.id}`)}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-touch-coarse gap-1 text-xs"
                            aria-label={`Log ${name} in the Risk Register`}
                            onClick={() => {
                              setEditing(null);
                              setLogging(risk.id);
                            }}
                          >
                            <ShieldAlert aria-hidden="true" />
                            Log in the Risk Register
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
