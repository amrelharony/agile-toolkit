/**
 * Follow-ups under Amr's latest reply: at most two, worked out from the reply
 * and the turn's tools with no model call, in the reader's own voice and
 * never Amr's. None says I, me or my (a first-person line in the chat would
 * read as his, DNA-SPEC section 6), none uses a dash, and none repeats the
 * reply or the question it answers.
 */

import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_TEXT,
  MAX_FOLLOW_UPS,
  followUps,
  moreIn,
  type FollowUpTurn,
} from "@/lib/agent/follow-ups";
import type { ToolStepState } from "@/lib/agent/tool-result-text";
import { tools } from "@/lib/constants/tools";

const FIRST_PERSON = /\b(I|I'm|I'll|I've|I'd|me|my|mine|myself|we'll|let's)\b/i;
const DASHES = /[–—]/;

let n = 0;
const step = (name: string, state: ToolStepState | null = "done") => ({
  call: { type: "tool_use" as const, id: `c${++n}`, name, input: {} },
  state,
});

const LIST = "Three things help:\n\n1. Keep it short\n2. Vary the format\n3. Follow up on actions";
const LONG = `${"A good sprint goal names the outcome the team wants, not the tasks it will do. ".repeat(9)}`;

describe("followUps", () => {
  it("answers an offer to do something with yes and no", () => {
    for (const reply of [
      "Those three would make good retro cards. Want these added to the board?",
      "The sprint can start Monday. **Shall I create it?**",
      "Would you like a capacity plan for the next sprint?",
      "Do you want the stories sorted by value?",
      "OK to go ahead with 30 points?",
    ]) {
      expect(followUps({ reply }), reply).toEqual([FOLLOW_UP_TEXT.yes, FOLLOW_UP_TEXT.no]);
    }
  });

  it("offers nothing when the reply ends on a question only the reader can answer", () => {
    for (const reply of [
      "Happy to help plan it. How many people are on the team?",
      "Which board should the cards go on?",
      "Want them as cards on the board, or kept as a list?",
      "Should the sprint run one week or two?",
    ]) {
      expect(followUps({ reply }), reply).toEqual([]);
    }
  });

  it("reads past a closing invitation, which waits on nothing in particular", () => {
    expect(followUps({ reply: `${LIST}\n\nAnything else?` })).toContain(FOLLOW_UP_TEXT.ranks);
    expect(followUps({ reply: `${LIST}\n\nAny other questions?` })).toContain(FOLLOW_UP_TEXT.ranks);
  });

  it("takes a list of questions at the end of a reply for a list, not a question", () => {
    const reply = "Try these prompts:\n\n1. What went well?\n2. What didn't go well?";
    expect(followUps({ reply })[0]).toBe(FOLLOW_UP_TEXT.ranks);
  });

  it("asks what else Amr can do in the tool he just changed", () => {
    const asks = followUps({
      reply: "Done: the card “flaky CI” is on the board.",
      steps: [step("tool_retro_list_state"), step("tool_retro_add_card")],
    });
    expect(asks).toEqual([moreIn("Retro Board")]);
    expect(asks[0]).toBe("What else can you do in Retro Board?");
  });

  it("names the tool of the latest change that worked", () => {
    const asks = followUps({
      reply: "Both are saved.",
      steps: [step("tool_retro_add_card"), step("tool_retro_actions_add")],
    });
    expect(asks).toEqual([moreIn("Retro Actions")]);
  });

  it("names no tool for a read, a change that didn't happen, or the workspace", () => {
    const cases: FollowUpTurn["steps"][] = [
      [step("tool_retro_list_state")],
      [step("tool_retro_add_card", "failed")],
      [step("tool_retro_add_card", "denied")],
      [step("tool_retro_add_card", "stopped")],
      [step("tool_retro_add_card", "working")],
      [step("workspace_sprint_create")],
      [step("intent_plan_sprint")],
    ];
    for (const steps of cases) {
      const asks = followUps({ reply: "Here it is.", steps });
      expect(
        asks.some((a) => a.startsWith("What else can you do")),
        JSON.stringify(steps)
      ).toBe(false);
    }
  });

  it("asks which item matters most after a list", () => {
    expect(followUps({ reply: LIST })[0]).toBe(FOLLOW_UP_TEXT.ranks);
    expect(followUps({ reply: "- Keep it short\n- Vary the format" })[0]).toBe(
      FOLLOW_UP_TEXT.ranks
    );
    // One item, or bold text at a line's start, is no list.
    expect(followUps({ reply: "- Keep it short" })).not.toContain(FOLLOW_UP_TEXT.ranks);
    expect(followUps({ reply: "**Short** retros work." })).not.toContain(FOLLOW_UP_TEXT.ranks);
  });

  it("asks for a one line summary of a long reply", () => {
    expect(followUps({ reply: LONG })).toContain(FOLLOW_UP_TEXT.shorter);
    expect(followUps({ reply: "Keep it short." })).not.toContain(FOLLOW_UP_TEXT.shorter);
  });

  it("asks for an example of an answer that ran no tool and gave none", () => {
    expect(followUps({ reply: "A retro is the team's look back at how it worked." })).toEqual([
      FOLLOW_UP_TEXT.example,
    ]);
    for (const reply of [
      "For example, try a sailboat retro.",
      "Use a format with a twist, e.g. a sailboat.",
      "Here are two examples: a sailboat and a timeline.",
    ]) {
      expect(followUps({ reply }), reply).not.toContain(FOLLOW_UP_TEXT.example);
    }
    // After a tool ran, the reply is about the work, not an idea to show.
    expect(
      followUps({ reply: "The board has 4 cards.", steps: [step("tool_retro_list_state")] })
    ).toEqual([]);
  });

  it("gives at most two, the strongest first", () => {
    const asks = followUps({
      reply: `${LIST}\n\n${LONG}`,
      steps: [step("tool_retro_add_card")],
    });
    expect(asks).toHaveLength(MAX_FOLLOW_UPS);
    expect(asks).toEqual([moreIn("Retro Board"), FOLLOW_UP_TEXT.ranks]);
    expect(followUps({ reply: `${LIST}\n\n${LONG}` })).toEqual([
      FOLLOW_UP_TEXT.ranks,
      FOLLOW_UP_TEXT.shorter,
    ]);
  });

  it("never repeats the question the turn answers", () => {
    const reply = "A retro is the team's look back at how it worked.";
    expect(followUps({ reply, asked: "Can you give an example?" })).toEqual([]);
    expect(followUps({ reply, asked: "  can you give an EXAMPLE " })).toEqual([]);
  });

  it("never repeats what the reply already says", () => {
    const reply = `${LIST}\n\nWhich of these matters most? It depends on the team.`;
    expect(followUps({ reply })).not.toContain(FOLLOW_UP_TEXT.ranks);
  });

  it("offers nothing for a reply in another script: the reader writes in their own language", () => {
    expect(followUps({ reply: "الريترو هو مراجعة الفريق لطريقة عمله." })).toEqual([]);
    expect(
      followUps({
        reply: "تمت إضافة البطاقة إلى اللوحة.",
        steps: [step("tool_retro_add_card")],
      })
    ).toEqual([]);
    expect(followUps({ reply: "", asked: "ما هو الريترو؟" })).toEqual([]);
    // A few Latin words (a tool's name) in an Arabic reply don't change that.
    expect(
      followUps({ reply: "أضفت البطاقة إلى Retro Board بنجاح، وهي الآن ظاهرة للفريق." })
    ).toEqual([]);
  });

  it("offers nothing for a turn with no words and no change", () => {
    expect(followUps({ reply: "" })).toEqual([]);
    expect(followUps({ reply: "   ", steps: [step("tool_retro_list_state")] })).toEqual([]);
  });

  it("speaks only in the reader's voice: no I, me or my, and no dash, in any follow-up", () => {
    const turns: FollowUpTurn[] = [
      { reply: "Want these added to the board?" },
      { reply: LIST },
      { reply: LONG },
      { reply: "A retro is a look back." },
      { reply: `${LIST}\n\n${LONG}`, steps: [step("tool_retro_add_card")] },
      { reply: "Done.", steps: [step("tool_planning_poker_cast_vote")] },
      { reply: "Saved.", steps: [step("tool_okr_tracker_add_objective")] },
    ];
    const said = [
      ...Object.values(FOLLOW_UP_TEXT),
      ...tools.map((tool) => moreIn(tool.name)),
      ...turns.flatMap((turn) => followUps(turn)),
    ];
    expect(said.length).toBeGreaterThan(tools.length);
    for (const words of said) {
      expect(words, words).not.toMatch(FIRST_PERSON);
      expect(words, words).not.toMatch(DASHES);
    }
    for (const turn of turns) expect(followUps(turn).length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
  });
});
