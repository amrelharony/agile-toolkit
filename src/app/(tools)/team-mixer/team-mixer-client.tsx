"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { ExampleNotice } from "@/components/tool-frame/example-data";
import { generateTeamMixerPrompts } from "@/lib/ai-prompts/team-mixer";
import { cheer } from "@/lib/celebrate/cheer";
import { TEAM_MIXER_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BROKEN_KINDS, MIXER_LIMITS, plural } from "@/lib/team-mixer/model";
import {
  addPeople,
  addRule,
  latestRound,
  mixNow,
  movePerson,
  nameGroups,
  settingsPreview,
  settingsProblem,
  showCafeRound,
  type RuleDraft,
} from "@/lib/team-mixer/ops";
import {
  MIXER_INITIAL,
  hasExampleRows,
  normalizeMixerState,
  withoutExample,
  type MixerPersonRow,
  type MixerRound,
  type MixerRule,
  type MixerState,
} from "@/lib/team-mixer/state";
import {
  loadMixer,
  readMixer,
  updateMixer,
  useTeamMixerStore,
  writeMixer,
} from "@/lib/team-mixer/store";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { CafeCard } from "./cafe-card";
import { buildExample } from "./example";
import { HistoryCard } from "./history-card";
import { LiveCard } from "./live-card";
import { toMarkdown } from "./markdown";
import { PeopleCard } from "./people-card";
import { RoundCard } from "./round-card";
import { RulesCard } from "./rules-card";
import { SettingsCard } from "./settings-card";

// The store's lists, changed through their checked copy (for removeWithUndo).
const updatePeople = (fn: (list: readonly MixerPersonRow[]) => MixerPersonRow[]) =>
  updateMixer((s) => ({ ...s, people: fn(s.people) }));
const updateRules = (fn: (list: readonly MixerRule[]) => MixerRule[]) =>
  updateMixer((s) => ({ ...s, rules: fn(s.rules) }));
const updateRounds = (fn: (list: readonly MixerRound[]) => MixerRound[]) =>
  updateMixer((s) => ({ ...s, rounds: fn(s.rounds) }));

/** Put one round back as it was, leaving every other change since alone. */
const restoreRound = (prior: MixerRound | undefined) => () => {
  if (prior) updateRounds((list) => list.map((r) => (r.id === prior.id ? prior : r)));
};

/**
 * Team Mixer: random groups and pairs, balanced by role or skill, with
 * keep-apart and keep-together rules, rounds that avoid earlier pairings,
 * World Café tables, and a live room where everyone finds their group.
 * Saved in the `team-mixer` tool store (lib/team-mixer/store); the mixing
 * itself is the pure, seeded lib/team-mixer that Amr's actions use too.
 */
export function TeamMixerClient() {
  const { log } = useHistoryLogger("team-mixer");
  const announce = useAnnounce();
  const raw = useTeamMixerStore();
  const state = useMemo(() => normalizeMixerState(raw), [raw]);
  const roster = useTeamRoster();
  const [ready, setReady] = useState(false);
  const [peopleNotice, setPeopleNotice] = useState<string | null>(null);
  const [mixProblem, setMixProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadMixer().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const latest = latestRound(state);
  const problem = settingsProblem(state);
  const preview = settingsPreview(state);

  // ── People ────────────────────────────────────────────────
  const addNames = (names: string[]) => {
    const r = addPeople(readMixer(), names, roster);
    writeMixer(r.state);
    setPeopleNotice(
      r.full
        ? `Team Mixer mixes up to ${MIXER_LIMITS.people} people, so ${plural(
            names.length - r.added.length,
            "name"
          )} didn't fit.`
        : names.length > 1
          ? r.added.length === 0
            ? "Everyone named is already in the mix."
            : `Added ${plural(r.added.length, "person", "people")}.`
          : null
    );
  };

  const removePerson = (p: MixerPersonRow) =>
    removeWithUndo<MixerPersonRow>({
      label: `Took ${p.name} out of the mix`,
      update: updatePeople,
      match: (x) => x.id === p.id,
    });

  const clearPeople = () => {
    const before = readMixer().people;
    undoable({
      label: `Cleared ${plural(before.length, "person", "people")} from the mix`,
      apply: () => updateMixer((s) => ({ ...s, people: [] })),
      revert: () => updateMixer((s) => ({ ...s, people: [...before, ...s.people] })),
    });
    setPeopleNotice(null);
  };

  // ── Settings and mixing ───────────────────────────────────
  const changeSettings = (patch: Partial<MixerState>) => {
    updateMixer((s) => ({ ...s, ...patch }));
    setMixProblem(null);
  };

  const mix = () => {
    const current = readMixer();
    const step = mixNow(current, roster);
    if (!step.ok) {
      setMixProblem(step.error);
      announce(step.error);
      return;
    }
    setMixProblem(null);
    const prior = current.cafe;
    if (step.cafe && prior) {
      // A new plan replaces the old one: keep a way back.
      undoable({
        label: "Planned the café again",
        apply: () => writeMixer(step.state),
        revert: () => updateMixer((s) => ({ ...s, cafe: prior })),
      });
    } else {
      writeMixer(step.state);
    }
    const issues = step.round?.issues ?? step.cafe?.issues ?? [];
    const broken = issues.filter((i) => BROKEN_KINDS.has(i.kind)).length;
    if (step.round) {
      const sizes = step.round.groups.map((g) => g.people.length);
      log(TEAM_MIXER_ACTIONS.GROUPS_MIXED, {
        mode: step.round.mode,
        groups: sizes.length,
        size: Math.max(...sizes),
        balance: step.round.balance,
        round: step.state.rounds.length,
        rules: current.rules.length,
        broken,
      });
      announce(
        `Round ${step.state.rounds.length}: ${plural(sizes.length, step.round.mode === "pairs" ? "pair" : "group")}.${
          broken > 0 ? ` ${plural(broken, "rule")} couldn't be kept.` : ""
        }`
      );
    } else if (step.cafe) {
      log(TEAM_MIXER_ACTIONS.GROUPS_MIXED, {
        mode: "cafe",
        groups: step.cafe.rounds[0].length,
        rounds: step.cafe.rounds.length,
        balance: step.cafe.balance,
        rules: current.rules.length,
        broken,
      });
      announce(
        `World Café planned: ${plural(step.cafe.rounds[0].length, "table")}, ${plural(step.cafe.rounds.length, "round")}.`
      );
    }
    cheer("team-mixer", "result");
  };

  const roundNow = (id: string) => readMixer().rounds.find((r) => r.id === id);

  const move = (round: MixerRound, who: string, toGroup: number) => {
    undoable({
      label: `Moved ${who}`,
      apply: () => updateMixer((s) => movePerson(s, round.id, who, toGroup)),
      revert: restoreRound(roundNow(round.id)),
    });
    log(TEAM_MIXER_ACTIONS.MIX_SAVED, { edit: "moved", groups: round.groups.length });
  };

  const name = (round: MixerRound, names: (string | null)[]) => {
    const count = names.filter((n) => n !== null).length;
    undoable({
      label: count === 1 ? "Named a group" : `Named ${plural(count, "group")}`,
      apply: () => updateMixer((s) => nameGroups(s, round.id, names)),
      revert: restoreRound(roundNow(round.id)),
    });
    log(TEAM_MIXER_ACTIONS.MIX_SAVED, { edit: "named", named: count });
  };

  const removeRound = (round: MixerRound) =>
    removeWithUndo<MixerRound>({
      label: "Removed a round: its pairings count again",
      update: updateRounds,
      match: (x) => x.id === round.id,
    });

  const startOver = () => {
    const before = readMixer();
    undoable({
      label: `Forgot ${plural(before.rounds.length, "round")}`,
      apply: () => updateMixer((s) => ({ ...s, rounds: [], seriesSeed: 0 })),
      // Rounds mixed since go after the ones put back.
      revert: () =>
        updateMixer((s) => ({
          ...s,
          rounds: [...before.rounds, ...s.rounds],
          seriesSeed: before.seriesSeed,
        })),
    });
    log(TEAM_MIXER_ACTIONS.MIXER_RESET, { what: "rounds", rounds: before.rounds.length });
  };

  // ── Rules ─────────────────────────────────────────────────
  const addOneRule = (rule: RuleDraft) => {
    const r = addRule(readMixer(), rule);
    if (!r.ok) {
      announce(r.error);
      return;
    }
    writeMixer(r.state);
    log(TEAM_MIXER_ACTIONS.RULE_ADDED, { kind: r.rule.kind });
  };

  const removeRule = (rule: MixerRule) => {
    removeWithUndo<MixerRule>({
      label: `Removed the rule for ${rule.a} and ${rule.b}`,
      update: updateRules,
      match: (x) => x.id === rule.id,
    });
    log(TEAM_MIXER_ACTIONS.RULE_REMOVED, { kind: rule.kind });
  };

  // ── Example and reset ─────────────────────────────────────
  const loadExample = () => {
    const ex = buildExample(new Date());
    const s = readMixer();
    writeMixer({
      ...ex,
      people: [...ex.people, ...s.people],
      rules: [...ex.rules, ...s.rules],
      rounds: [...ex.rounds, ...s.rounds],
    });
    setPeopleNotice(null);
  };
  const clearExample = () => updateMixer(withoutExample);

  const beforeReset = useRef<MixerState | null>(null);
  const resetAll = () => {
    beforeReset.current = readMixer();
    writeMixer(MIXER_INITIAL);
    log(TEAM_MIXER_ACTIONS.MIXER_RESET, { what: "everything" });
  };
  const undoReset = () => {
    if (beforeReset.current) writeMixer(beforeReset.current);
    beforeReset.current = null;
  };

  // ── Export and prompts ────────────────────────────────────
  const markdown = useMemo(() => toMarkdown(state), [state]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Team Mixer",
      prompts: generateTeamMixerPrompts({
        mode: state.mode,
        people: state.people.length,
        groups:
          state.mode === "cafe"
            ? state.tables
            : (latest?.groups.length ?? Math.max(1, Math.round(state.people.length / 2))),
        rounds: state.cafeRounds,
        title: state.title,
      }),
    }),
    [state, latest]
  );
  const hasData =
    state.people.length > 0 ||
    state.rules.length > 0 ||
    state.rounds.length > 0 ||
    state.cafe !== null;

  return (
    <ToolPageWrapper
      toolId="team-mixer"
      title="Team Mixer"
      description="Random groups and pairs, balanced by role or skill, with keep-apart rules and fresh company every round."
      category="Workshops & Facilitation"
    >
      {!ready ? (
        <p role="status" className="text-sm text-sub">
          Loading Team Mixer…
        </p>
      ) : (
        <div className="space-y-6">
          {hasExampleRows(state) && <ExampleNotice onClear={clearExample} />}

          <ActionRow>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="team-mixer"
              markdown={markdown}
              jsonData={{
                people: state.people.map((p) => p.name),
                rules: state.rules,
                rounds: state.rounds,
                cafe: state.cafe,
              }}
            />
            {hasData && (
              <ResetButton
                title="Reset Team Mixer?"
                description="Everyone in the mix, the rules, the rounds so far and the World Café plan."
                confirmLabel="Reset Team Mixer"
                doneLabel="Reset Team Mixer"
                onReset={resetAll}
                onUndo={undoReset}
              />
            )}
          </ActionRow>

          <PeopleCard
            people={state.people}
            roster={roster}
            onAdd={addNames}
            onRemove={removePerson}
            onClear={clearPeople}
            onLoadExample={loadExample}
            notice={peopleNotice}
          />

          <SettingsCard
            state={state}
            onChange={changeSettings}
            onMix={mix}
            problem={mixProblem ?? problem}
            preview={preview}
          />

          <RulesCard
            rules={state.rules}
            people={state.people}
            onAdd={addOneRule}
            onRemove={removeRule}
          />

          {state.mode === "cafe" && state.cafe && (
            <CafeCard
              cafe={state.cafe}
              onShowRound={(i) => updateMixer((s) => showCafeRound(s, i))}
            />
          )}

          {state.mode !== "cafe" && latest && (
            <RoundCard
              // A new round starts with a fresh "move someone" form and names box.
              key={latest.id}
              round={latest}
              number={state.rounds.length}
              roster={roster}
              onMove={(who, to) => move(latest, who, to)}
              onName={(names) => name(latest, names)}
            />
          )}

          <LiveCard
            mode={state.mode}
            round={latest}
            number={state.rounds.length}
            cafe={state.cafe}
          />

          {state.rounds.length > 0 && (
            <HistoryCard rounds={state.rounds} onRemove={removeRound} onStartOver={startOver} />
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
