"use client";

/**
 * Picker: choose fairly from the team or any list. A wheel with weights,
 * everyone once and names that leave once picked; standing roles on a fair
 * rotation with their history; dice, a coin, yes or no, numbers and letters;
 * team and sprint name ideas with a shortlist; and a live room where
 * everyone's phone shows the same spin.
 *
 * Everything is saved in the Picker's own store (lib/picker/store), read
 * through lib/picker/model's rules, which the agent actions share.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Disc3, Dices, Sparkles, Users } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ShowRoomHost } from "@/components/collab/show-room";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { ExampleNotice, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generatePickerPrompts } from "@/lib/ai-prompts/picker";
import { cheer } from "@/lib/celebrate/cheer";
import { PICKER_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  PICKER_INITIAL,
  PICKER_LIMITS,
  TEAM_SOURCE,
  awayToday,
  findList,
  normalizePickerState,
  normalizeShortlist,
  poolLabel,
  roleStandings,
  sourceEntries,
  sourceLabel,
  spinWheel,
  timeAgo,
  wheelView,
  withRecent,
  withRoleTurn,
  type PickerList,
  type PickerRole,
  type PickerRoleTurn,
  type PickerState,
  type WheelView,
} from "@/lib/picker/model";
import { ensurePickerHydrated, readPicker, updatePicker, usePickerStore } from "@/lib/picker/store";
import { spinMotion } from "@/lib/picker/wheel";
import { TEXT_FRAME_KIND, textFrame } from "@/lib/realtime/show-room/frames";
import { PICKER_WHEEL_KIND, wheelFrame } from "@/lib/realtime/show-room/frames/picker";
import type { ShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { nameKey } from "@/lib/team/names";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { EXAMPLE_LIST_ID, buildExample } from "./example";
import { editedEntries } from "./forms";
import { ListsCard } from "./lists-card";
import { toMarkdown } from "./markdown";
import { NamesPanel } from "./names-panel";
import { QuickPanel, type QuickPick } from "./quick-panel";
import { RecentPicks } from "./recent-picks";
import { RolesPanel } from "./roles-panel";
import { useWheelSpin } from "./use-wheel-spin";
import { WheelPanel } from "./wheel-panel";

type PickerTab = "wheel" | "roles" | "quick" | "names";
type ShowFn = ShowRoom["show"];

/** The list the shortlist goes onto when it is spun. */
export const SHORTLIST_LIST_NAME = "Name shortlist";

/** What the wheel shows, as text: a change to it means the stopped spin is out of date. */
function viewKey(view: WheelView): string {
  return JSON.stringify([view.shown, view.eligible, view.removed]);
}

/**
 * Hands the open room's `show` to the page while the room is live, so the
 * wheel and the other tabs can put a frame on everyone's screen.
 */
function RoomBridge({
  room,
  onShow,
  children,
}: {
  room: ShowRoom;
  onShow: (show: ShowFn | null) => void;
  children: ReactNode;
}) {
  const live = room.status === "live";
  const { show } = room;
  useEffect(() => {
    onShow(live ? show : null);
    return () => onShow(null);
  }, [live, show, onShow]);
  return <>{children}</>;
}

export function PickerClient() {
  const { log } = useHistoryLogger("picker");
  const announce = useAnnounce();

  // ── Saved state ───────────────────────────────────────────
  const raw = usePickerStore();
  const state = useMemo(() => normalizePickerState(raw), [raw]);
  useEffect(() => {
    void ensurePickerHydrated();
  }, []);

  const roster = useTeamRoster();
  const rosterReady = useWorkspaceHydrated();
  const entries = useMemo(() => sourceEntries(state, roster), [state, roster]);
  const view = useMemo(
    () => wheelView(entries, state.progress, state.everyoneOnce),
    [entries, state.progress, state.everyoneOnce]
  );
  const team = state.source === TEAM_SOURCE;
  const label = sourceLabel(state);
  const now = new Date();
  const today = todayLocalISO(now);
  const away = awayToday(state.away, today);

  const [tab, setTab] = useState<PickerTab>("wheel");
  const [result, setResult] = useState<string | null>(null);
  const [quick, setQuick] = useState<QuickPick | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [roomShow, setRoomShowState] = useState<ShowFn | null>(null);
  const setRoomShow = useCallback((fn: ShowFn | null) => setRoomShowState(() => fn), []);

  // ── The wheel ─────────────────────────────────────────────
  const spin = useWheelSpin();
  const { release } = spin;
  /** What the wheel will show once the stopped spin is saved; anything else releases it. */
  const landedKey = useRef<string | null>(null);
  const liveKey = viewKey(view);
  useEffect(() => {
    if (spin.spinning || !spin.picture) return;
    if (landedKey.current !== liveKey) {
      landedKey.current = null;
      release();
      setResult(null);
    }
  }, [liveKey, spin.spinning, spin.picture, release]);

  const runSpin = (forRoom: boolean) => {
    if (spin.spinning) return;
    const outcome = spinWheel(entries, state.progress, state);
    if (!outcome) return;
    const eligible = new Set(view.eligible);
    const picture = {
      names: outcome.shown.map((e) => e.name),
      weights: outcome.shown.map((e) => e.weight),
      out: outcome.shown.map((_, i) => i).filter((i) => !eligible.has(i)),
    };
    const motion = spinMotion();
    let inRoom = false;
    if (forRoom) {
      const frame = wheelFrame({ ...picture, winner: outcome.winner, ...motion });
      inRoom = Boolean(frame && roomShow && roomShow(PICKER_WHEEL_KIND, frame));
      setRoomNote(inRoom ? null : "This spin couldn't be shown in the room. It still counts here.");
    }
    const source = state.source;
    const from = poolLabel(label, outcome.shown.length, team);
    const after = viewKey(wheelView(entries, outcome.progress, state.everyoneOnce));
    // Before the start: under reduced motion the spin lands inside it.
    setResult(null);
    spin.start({
      picture,
      winner: outcome.winner,
      turns: motion.turns,
      offset: motion.offset,
      land: () => {
        landedKey.current = after;
        updatePicker((s) => ({
          ...s,
          progress: s.source === source ? outcome.progress : s.progress,
          recent: withRecent(s.recent, {
            id: crypto.randomUUID(),
            kind: "wheel",
            result: outcome.entry.name,
            detail: from,
            at: new Date().toISOString(),
          }),
        }));
        setResult(outcome.entry.name);
        log(PICKER_ACTIONS.PICK_RAN, {
          mode: "wheel",
          size: outcome.shown.length,
          source: source === TEAM_SOURCE ? "team" : "list",
          room: inRoom,
        });
        cheer("picker", outcome.roundDone ? "milestone" : "result");
        announce(
          outcome.roundDone
            ? `${outcome.entry.name}. Everyone has had a turn this round.`
            : `${outcome.entry.name}.`
        );
      },
    });
  };

  const setSource = (source: string) => {
    if (spin.spinning) return;
    updatePicker((s) => ({ ...s, source }));
  };

  const setWeight = (name: string, weight: number) => {
    const key = nameKey(name);
    updatePicker((s) => {
      if (s.source === TEAM_SOURCE) {
        const teamWeights = { ...s.teamWeights };
        if (weight === 1) delete teamWeights[key];
        else teamWeights[key] = weight;
        return { ...s, teamWeights };
      }
      return {
        ...s,
        lists: s.lists.map((l) =>
          l.id === s.source
            ? {
                ...l,
                entries: l.entries.map((e) => (nameKey(e.name) === key ? { ...e, weight } : e)),
                updatedAt: new Date().toISOString(),
              }
            : l
        ),
      };
    });
  };

  const putBack = () => {
    const before = readPicker().progress;
    undoable({
      label: "Put everyone back on the wheel",
      apply: () => updatePicker((s) => ({ ...s, progress: { ...s.progress, removed: [] } })),
      revert: () =>
        updatePicker((s) =>
          s.progress.source === before.source
            ? { ...s, progress: { ...s.progress, removed: before.removed } }
            : s
        ),
    });
  };

  const restartRound = () => {
    const before = readPicker().progress;
    undoable({
      label: "Started the round again",
      apply: () =>
        updatePicker((s) => ({ ...s, progress: { ...s.progress, drawn: [], last: null } })),
      revert: () =>
        updatePicker((s) =>
          s.progress.source === before.source
            ? { ...s, progress: { ...s.progress, drawn: before.drawn, last: before.last } }
            : s
        ),
    });
  };

  // ── Lists ─────────────────────────────────────────────────
  const saveList = (values: { name: string; names: string[] }, editingId?: string) => {
    const at = new Date().toISOString();
    if (editingId) {
      updatePicker((s) => ({
        ...s,
        lists: s.lists.map((l) =>
          l.id === editingId
            ? {
                ...l,
                name: values.name,
                entries: editedEntries(l.entries, values.names),
                updatedAt: at,
              }
            : l
        ),
      }));
    } else {
      const list: PickerList = {
        id: `list_${crypto.randomUUID()}`,
        name: values.name,
        entries: values.names.map((name) => ({ name, weight: 1 })),
        updatedAt: at,
      };
      updatePicker((s) => ({ ...s, lists: [...s.lists, list], source: list.id }));
    }
    log(PICKER_ACTIONS.LIST_SAVED, { size: values.names.length, edited: Boolean(editingId) });
    announce(editingId ? `Saved ${values.name}.` : `Saved ${values.name}. The wheel spins it now.`);
  };

  const deleteList = (list: PickerList) => {
    removeWithUndo<PickerList>({
      label: `Deleted “${list.name}”`,
      update: (fn) => updatePicker((s) => ({ ...s, lists: fn(s.lists) })),
      match: (l) => l.id === list.id,
    });
    log(PICKER_ACTIONS.LIST_REMOVED, { size: list.entries.length });
  };

  // ── Roles ─────────────────────────────────────────────────
  const people = entries.map((e) => e.name);
  const assignRole = (role: PickerRole, person: string) => {
    const at = new Date().toISOString();
    updatePicker((s) => ({
      ...s,
      roleTurns: withRoleTurn(s.roleTurns, {
        id: crypto.randomUUID(),
        roleId: role.id,
        person,
        at,
      }),
      recent: withRecent(s.recent, {
        id: crypto.randomUUID(),
        kind: "role",
        result: person,
        detail: role.name,
        at,
      }),
    }));
    log(PICKER_ACTIONS.ROTATION_ADVANCED, { role: role.name, people: people.length });
    announce(`${person} is the ${role.name}.`);
  };

  const setAway = (name: string, isAway: boolean) => {
    const key = nameKey(name);
    updatePicker((s) => {
      const keys = awayToday(s.away, today).filter((k) => k !== key);
      return { ...s, away: { day: today, keys: isAway ? [...keys, key] : keys } };
    });
    announce(isAway ? `${name} is away today.` : `${name} is back today.`);
  };

  const removeTurn = (turn: PickerRoleTurn) =>
    removeWithUndo<PickerRoleTurn>({
      label: `Removed ${turn.person}'s turn`,
      update: (fn) => updatePicker((s) => ({ ...s, roleTurns: fn(s.roleTurns) })),
      match: (t) => t.id === turn.id,
    });

  const addRole = (name: string) => {
    updatePicker((s) => ({
      ...s,
      roles: [...s.roles, { id: `role-${crypto.randomUUID()}`, name }],
    }));
    announce(`Added the ${name} role.`);
  };

  const removeRole = (role: PickerRole) => {
    const before = readPicker();
    const index = before.roles.findIndex((r) => r.id === role.id);
    const turns = before.roleTurns.filter((t) => t.roleId === role.id);
    undoable({
      label: `Removed the ${role.name} role`,
      description: turns.length > 0 ? "Its turns went with it." : undefined,
      apply: () =>
        updatePicker((s) => ({
          ...s,
          roles: s.roles.filter((r) => r.id !== role.id),
          roleTurns: s.roleTurns.filter((t) => t.roleId !== role.id),
        })),
      revert: () =>
        updatePicker((s) => {
          if (s.roles.some((r) => r.id === role.id)) return s;
          const roles = s.roles.slice();
          roles.splice(Math.min(index, roles.length), 0, role);
          return { ...s, roles, roleTurns: [...s.roleTurns, ...turns] };
        }),
    });
  };

  // ── Quick answers ─────────────────────────────────────────
  const quickResult = (pick: QuickPick) => {
    setQuick(pick);
    updatePicker((s) => ({
      ...s,
      recent: withRecent(s.recent, {
        id: crypto.randomUUID(),
        ...pick,
        at: new Date().toISOString(),
      }),
    }));
    log(PICKER_ACTIONS.PICK_RAN, { mode: pick.kind });
    announce(pick.detail ? `${pick.result}. ${pick.detail}.` : `${pick.result}.`);
  };

  // ── Names ─────────────────────────────────────────────────
  const addToShortlist = (names: string[]) => {
    const before = readPicker().shortlist;
    const next = normalizeShortlist([...before, ...names]);
    const added = next.length - before.length;
    updatePicker((s) => ({ ...s, shortlist: normalizeShortlist([...s.shortlist, ...names]) }));
    const left = names.length - added;
    setNotice(
      left > 0 && next.length >= PICKER_LIMITS.maxShortlist
        ? `The shortlist is full at ${PICKER_LIMITS.maxShortlist} names, so ${left} didn't fit.`
        : null
    );
    if (added > 0)
      announce(added === 1 ? "Added to the shortlist." : `Added ${added} names to the shortlist.`);
  };

  const removeFromShortlist = (name: string) =>
    removeWithUndo<string>({
      label: `Took ${name} off the shortlist`,
      update: (fn) => updatePicker((s) => ({ ...s, shortlist: fn(s.shortlist) })),
      match: (n) => nameKey(n) === nameKey(name),
    });

  const spinShortlist = () => {
    const current = readPicker();
    const existing = findList(current.lists, SHORTLIST_LIST_NAME);
    if (!existing && current.lists.length >= PICKER_LIMITS.maxLists) {
      setNotice(
        `The Picker keeps up to ${PICKER_LIMITS.maxLists} lists. Delete one to spin the shortlist.`
      );
      return;
    }
    const list: PickerList = {
      id: existing?.id ?? `list_${crypto.randomUUID()}`,
      name: existing?.name ?? SHORTLIST_LIST_NAME,
      entries: current.shortlist.map((name) => ({ name, weight: 1 })),
      updatedAt: new Date().toISOString(),
    };
    updatePicker((s) => ({
      ...s,
      lists: existing ? s.lists.map((l) => (l.id === list.id ? list : l)) : [...s.lists, list],
      source: list.id,
    }));
    setNotice(null);
    setTab("wheel");
    announce(`The wheel spins the ${list.name} now.`);
  };

  // ── Live room ─────────────────────────────────────────────
  const showText = (title: string, body: string) => {
    const frame = textFrame(title, body);
    const ok = Boolean(frame && roomShow && roomShow(TEXT_FRAME_KIND, frame));
    setRoomNote(ok ? null : "That couldn't be shown in the room.");
  };

  // ── Recent picks, example, reset ──────────────────────────
  const clearRecent = () => {
    const before = readPicker().recent;
    undoable({
      label: "Cleared the recent picks",
      apply: () => updatePicker((s) => ({ ...s, recent: [] })),
      revert: () => updatePicker((s) => ({ ...s, recent: [...s.recent, ...before] })),
    });
  };

  const hasExample =
    hasExampleItems(state.lists) ||
    hasExampleItems(state.roleTurns) ||
    hasExampleItems(state.recent);
  const canLoadExample =
    state.lists.length === 0 && state.roleTurns.length === 0 && state.recent.length === 0;

  const loadExample = () => {
    const ex = buildExample(new Date());
    updatePicker((s) => ({
      ...s,
      lists: [...s.lists.filter((l) => l.id !== EXAMPLE_LIST_ID), ex.list],
      source: ex.list.id,
      roleTurns: [...s.roleTurns.filter((t) => !isExampleId(t.id)), ...ex.roleTurns],
      recent: [...ex.recent, ...s.recent.filter((r) => !isExampleId(r.id))],
    }));
    announce("Loaded the example: the Aurora squad.");
  };

  const clearExample = () => {
    updatePicker((s) => ({
      ...s,
      lists: s.lists.filter((l) => !isExampleId(l.id)),
      roleTurns: s.roleTurns.filter((t) => !isExampleId(t.id)),
      recent: s.recent.filter((r) => !isExampleId(r.id)),
    }));
    setResult(null);
  };

  const resetSnapshot = useRef<PickerState | null>(null);

  // ── Export and prompts ────────────────────────────────────
  const markdown = toMarkdown({ state, entries, today }, now);
  const promptConfig = useMemo(
    () => ({
      toolName: "Picker",
      prompts: generatePickerPrompts({
        roles: state.roles.map((role) => ({
          name: role.name,
          rows: roleStandings(
            entries.map((e) => e.name),
            state.roleTurns,
            role.id,
            awayToday(state.away, todayLocalISO())
          ).map((r) => ({
            name: r.name,
            turns: r.turns,
            last: r.lastAt ? timeAgo(r.lastAt) : "never",
            away: r.away,
          })),
        })),
        shortlist: state.shortlist,
      }),
    }),
    [state, entries]
  );

  const peopleFrom = poolLabel(label, entries.length, team);

  return (
    <ToolPageWrapper
      toolId="picker"
      title="Picker"
      description="Spin a wheel or pick names fairly, with dice, a coin and rotating roles."
    >
      <div className="space-y-6">
        {hasExample && <ExampleNotice onClear={clearExample} />}

        <ActionRow>
          {promptConfig.prompts.length > 0 && <AiPromptGenerator config={promptConfig} />}
          <ExportButton filename="picker" markdown={markdown} jsonData={state} />
        </ActionRow>

        <Tabs value={tab} onValueChange={(v) => setTab(v as PickerTab)}>
          <TabsList className="h-11 border border-border bg-surface-deep">
            <TabsTrigger
              value="wheel"
              className="gap-1.5 text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              <Disc3 className="h-4 w-4" aria-hidden="true" />
              Wheel
            </TabsTrigger>
            <TabsTrigger
              value="roles"
              className="gap-1.5 text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              Roles
            </TabsTrigger>
            <TabsTrigger
              value="quick"
              className="gap-1.5 text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              <Dices className="h-4 w-4" aria-hidden="true" />
              Quick
            </TabsTrigger>
            <TabsTrigger
              value="names"
              className="gap-1.5 text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Names
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wheel" className="mt-4 space-y-6">
            <WheelPanel
              state={state}
              entries={entries}
              view={view}
              spin={spin}
              result={result}
              roomLive={roomShow !== null}
              rosterReady={rosterReady}
              onSpin={runSpin}
              onSource={setSource}
              onRules={(patch) => updatePicker((s) => ({ ...s, ...patch }))}
              onWeight={setWeight}
              onPutBack={putBack}
              onRestartRound={restartRound}
              canLoadExample={canLoadExample}
              onLoadExample={loadExample}
            />
            <ListsCard
              lists={state.lists}
              activeId={state.source}
              busy={spin.spinning}
              onSave={saveList}
              onUse={setSource}
              onDelete={deleteList}
            />
          </TabsContent>

          <TabsContent value="roles" className="mt-4">
            <RolesPanel
              roles={state.roles}
              turns={state.roleTurns}
              people={people}
              peopleFrom={peopleFrom}
              away={away}
              now={now}
              roomLive={roomShow !== null}
              onAssign={assignRole}
              onAway={setAway}
              onRemoveTurn={removeTurn}
              onAddRole={addRole}
              onRemoveRole={removeRole}
              onShow={showText}
            />
          </TabsContent>

          <TabsContent value="quick" className="mt-4">
            <QuickPanel
              last={quick}
              roomLive={roomShow !== null}
              onResult={quickResult}
              onShow={showText}
            />
          </TabsContent>

          <TabsContent value="names" className="mt-4">
            <NamesPanel
              shortlist={state.shortlist}
              onShortlist={addToShortlist}
              onRemoveShortlist={removeFromShortlist}
              onSpinShortlist={spinShortlist}
            />
          </TabsContent>
        </Tabs>

        {notice && (
          <p role="status" className="text-sm text-text">
            {notice}
          </p>
        )}

        <section aria-labelledby="picker-room-heading" className="space-y-2">
          <h2 id="picker-room-heading" className="text-base font-semibold text-text">
            Spin with the whole team
          </h2>
          <ShowRoomHost
            tool="picker"
            toolName="Picker"
            description="Everyone in the room sees the same spin on their own phone, with the names on the wheel, and it stops on the same name there too. Nothing from the room is saved."
          >
            {(room) => (
              <RoomBridge room={room} onShow={setRoomShow}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="toolkit"
                    className="gap-1.5"
                    disabled={view.shown.length === 0 || room.status !== "live"}
                    aria-disabled={spin.spinning || undefined}
                    onClick={() => {
                      setTab("wheel");
                      runSpin(true);
                    }}
                  >
                    <Disc3 aria-hidden="true" />
                    Spin for the room
                  </Button>
                </div>
                {roomNote && (
                  <p role="status" className="text-xs text-sub">
                    {roomNote}
                  </p>
                )}
              </RoomBridge>
            )}
          </ShowRoomHost>
        </section>

        <RecentPicks recent={state.recent} now={now} onClear={clearRecent} />

        <div className="flex justify-end">
          <ResetButton
            label="Reset the Picker"
            title="Reset the Picker?"
            description="Your lists, weights, role history, recent picks and shortlist go. The team on the Team page stays."
            confirmLabel="Reset Picker"
            doneLabel="Reset the Picker"
            onReset={() => {
              resetSnapshot.current = readPicker();
              usePickerStore.setState({ ...PICKER_INITIAL });
              setResult(null);
              setQuick(null);
              log(PICKER_ACTIONS.PICKER_RESET, {});
            }}
            onUndo={() => {
              if (resetSnapshot.current) usePickerStore.setState(resetSnapshot.current);
            }}
          />
        </div>
      </div>
    </ToolPageWrapper>
  );
}
