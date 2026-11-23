/**
 * Kickoff's store cases beyond the base's phase tests (C17): a kickoff the
 * page writes rides the workspace's export and import with every item's
 * extras (ratings, covers, sends) and its sliders intact, and the page's
 * reader takes the base fixture (a Team Canvas row an agent could write)
 * to the format's own sections, dropping what the format doesn't have.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildExample } from "@/app/(tools)/kickoff/example";
import { normalizeKickoff, readKickoffs, teamPurpose } from "@/lib/kickoff/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KICKOFF } from "./phase43-fixtures";

const ws = () => useWorkspaceStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState({ kickoffs: [] });
});

describe("kickoffs in the workspace store", () => {
  it("ride export and import with ratings, covers, sends and sliders intact", () => {
    const [tap] = buildExample(new Date("2026-11-20T09:00:00.000Z"));
    const sent = {
      ...tap,
      id: "kickoff_tap",
      sections: {
        ...tap.sections,
        worries: tap.sections.worries.map((w, i) =>
          i === 0
            ? { ...w, sentTo: [{ route: "risk" as const, targetId: "risk_9", at: tap.updatedAt }] }
            : w
        ),
      },
    };
    ws().upsertKickoff(sent);
    const json = ws().exportJSON();
    useWorkspaceStore.setState({ kickoffs: [] });
    ws().importJSON(json);
    const back = (ws().kickoffs ?? []).find((k) => k.id === "kickoff_tap");
    expect(back).toEqual(sent);
    expect(normalizeKickoff(back)).toEqual(sent);
  });

  it("reads the base fixture through the format: its own sections only", () => {
    ws().upsertKickoff(KICKOFF);
    const [k] = readKickoffs(ws().kickoffs);
    // A Team Canvas has no worries, and its rules can't cover one.
    expect(Object.keys(k.sections).sort()).toEqual(["people", "rules"]);
    expect(k.sections.rules).toEqual([{ id: "r1", text: "Pair on anything risky" }]);
    expect(k.sections.people).toEqual(KICKOFF.sections.people);
    // Sliders go too: a Team Canvas doesn't order trade-offs.
    expect(k.sliders).toBeUndefined();
    expect(k).toMatchObject({
      status: "agreed",
      agreedAt: KICKOFF.agreedAt,
      sentTo: KICKOFF.sentTo,
    });
    // An agreed Team Canvas with no purpose says nothing about the team's.
    expect(teamPurpose(ws().kickoffs)).toBeNull();
  });
});
