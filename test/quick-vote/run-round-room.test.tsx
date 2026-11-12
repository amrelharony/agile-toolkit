import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { VoteRoundPanelProps } from "@/components/collab/vote-room";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { draftFromPreset, validateRoundDraft } from "@/lib/quick-vote/draft";
import { presetById, type PresetId } from "@/lib/quick-vote/presets";
import { roundFor } from "@/lib/quick-vote/sheets";
import { quickVoteRoom } from "@/lib/quick-vote/live-room";

/**
 * Run it's guard for a stricter format (tools plan P1.4): it follows the
 * page's OWN live room, as the vote kit reports it (`onLiveChange`), never
 * the browser-wide "a visitor room is open" mark. A format that needs 5
 * answers (ESVP, the safety check) isn't handed to the page's room opened
 * for 3; a room opened for 5 keeps its 5 for every later format; and
 * Amr's start_round reads the same room.
 */

const panels = vi.hoisted(() => [] as VoteRoundPanelProps[]);
vi.mock("@/components/collab/vote-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/collab/vote-room")>();
  return {
    ...actual,
    VoteRoundPanel: (props: VoteRoundPanelProps) => {
      panels.push(props);
      return <div data-testid="panel" />;
    },
  };
});
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { RunRound } from "@/app/(tools)/quick-vote/run-round";

function roundOf(id: PresetId) {
  const preset = presetById(id)!;
  const check = validateRoundDraft(draftFromPreset(preset));
  if (!check.ok) throw new Error(`${id} doesn't validate`);
  return { preset, round: roundFor(check.values) };
}

function view(id: PresetId) {
  const { preset, round } = roundOf(id);
  return (
    <LiveAnnouncerProvider>
      <RunRound
        preset={preset}
        round={round}
        blockedReason={null}
        onSave={() => false}
        onSaveCounts={() => false}
        onCards={() => {}}
        readOnly={false}
      />
    </LiveAnnouncerProvider>
  );
}

const last = () => panels[panels.length - 1] as VoteRoundPanelProps & { sheet?: unknown };
const open = (minN: number | null) =>
  act(() => last().onLiveChange?.(minN === null ? null : { minN }));

afterEach(() => {
  panels.length = 0;
});

describe("Run it: the page's own live room", () => {
  it("hands ESVP to the panel with its own 5 while no room of the page's is open", () => {
    render(view("esvp"));
    expect(last()).toMatchObject({ kind: "choice", minN: 5, blockedReason: null });
    expect(last().sheet).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(quickVoteRoom()).toBeNull();
  });

  it("keeps ESVP out of the page's room opened for 3, and lets it in once that room closes", () => {
    const page = render(view("roman"));
    open(3);
    expect(quickVoteRoom()).toEqual({ minN: 3 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your live room is open. Its next round asks what is set up above."
    );
    page.rerender(view("esvp"));
    expect(last().sheet).toBeNull();
    expect(last()).toMatchObject({
      minN: 3,
      blockedReason: "ESVP needs a live room of its own, one that shows results from 5 answers.",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /ESVP shows results only from 5 answers, and the live room you opened here shows them from 3/
    );
    open(null);
    expect(quickVoteRoom()).toBeNull();
    expect(last().sheet).not.toBeNull();
    expect(last()).toMatchObject({ minN: 5, blockedReason: null });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a room opened for 5 at 5 for a format that would show from 3", () => {
    const page = render(view("safety-check"));
    open(5);
    page.rerender(view("fist-of-five"));
    expect(last()).toMatchObject({ kind: "scale", minN: 5, blockedReason: null });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The live room you opened here shows results from 5 answers"
    );
  });

  it("forgets the room when the page goes", () => {
    const page = render(view("roman"));
    open(3);
    page.unmount();
    expect(quickVoteRoom()).toBeNull();
  });
});
