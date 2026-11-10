/**
 * The words people are shown about their data live in lib/site/disclosures.ts,
 * so the privacy page can quote them. Each place that shows one must show
 * that very text: these render the places and compare. (The "Your data"
 * dialog's own test, test/data/your-data-dialog.test.tsx, pins its sentences
 * word for word.)
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/on-search-params", () => ({
  OnSearchParams: () => null,
  dropSearchParams: () => {},
}));

import { LlmSettingsDialog } from "@/components/ai/llm-settings-dialog";
import {
  VISITOR_AI_CONSENT_TEXT as CARD_TEXT,
  VISITOR_AI_DAILY_MESSAGES as CARD_DAILY,
  VisitorAiConsent,
} from "@/components/agent/mascot/visitor-ai-consent";
import {
  VISITOR_ROOM_CONSENT_TEXT as ROOM_DIALOG_TEXT,
  VOTE_ROOM_CONSENT_TEXT as VOTE_DIALOG_TEXT,
} from "@/components/collab/visitor-room-consent";
import { CountDisclosure } from "@/components/visits/visit-recorder";
import * as disclosures from "@/lib/site/disclosures";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

afterEach(() => {
  cleanup();
});

describe("the disclosure wording", () => {
  it("is what the live-room and vote-round consent dialogs export and show", () => {
    expect(ROOM_DIALOG_TEXT).toBe(disclosures.VISITOR_ROOM_CONSENT_TEXT);
    expect(VOTE_DIALOG_TEXT).toBe(disclosures.VOTE_ROOM_CONSENT_TEXT);
  });

  it("is the card before Amr's AI, with what is sent first and what is kept second", () => {
    expect(CARD_TEXT).toBe(disclosures.VISITOR_AI_CONSENT_TEXT);
    expect(CARD_DAILY).toBe(disclosures.VISITOR_AI_DAILY_MESSAGES);
    expect(CARD_TEXT[0]).toBe(disclosures.VISITOR_AI_SENT);
    expect(CARD_TEXT[1]).toBe(disclosures.VISITOR_AI_KEPT);
    render(<VisitorAiConsent question="" onAgree={() => {}} onDecline={() => {}} />);
    const points = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(points).toEqual([...disclosures.VISITOR_AI_CONSENT_TEXT]);
    expect(points[4]).toContain(`${disclosures.VISITOR_AI_DAILY_MESSAGES} messages a day`);
  });

  it("is the count note under the comics and kudos pages, and under a weekly story", () => {
    const { container, rerender } = render(<CountDisclosure />);
    expect(container.textContent).toBe(disclosures.COUNT_DISCLOSURE);
    rerender(<CountDisclosure story />);
    expect(container.textContent).toBe(disclosures.STORY_COUNT_DISCLOSURE);
    expect(disclosures.COUNT_DISCLOSURE).toContain("no cookies and no IP address");
    expect(disclosures.STORY_COUNT_DISCLOSURE).toContain(
      "no cookies, no account and no IP address"
    );
  });

  it("opens the note under AI settings", () => {
    act(() => {
      useLlmUiStore.setState({ settingsOpen: true });
    });
    render(<LlmSettingsDialog />);
    const note = screen.getByText((_, el) =>
      Boolean(el?.tagName === "P" && el.textContent?.startsWith(disclosures.OWN_KEY_DISCLOSURE))
    );
    expect(note.textContent).toBe(
      `${disclosures.OWN_KEY_DISCLOSURE} Any browser extension or XSS in this app could read your key. Use session mode for the strongest default.`
    );
    act(() => {
      useLlmUiStore.setState({ settingsOpen: false });
    });
  });

  it("is plain: whole sentences, and no dash standing in for a comma", () => {
    const texts = Object.entries(disclosures).flatMap(([name, value]) =>
      typeof value === "string"
        ? [[name, value] as const]
        : Array.isArray(value)
          ? value.map((line: string, i: number) => [`${name}[${i}]`, line] as const)
          : []
    );
    expect(texts.length).toBeGreaterThanOrEqual(15);
    for (const [name, text] of texts) {
      expect(text, name).not.toMatch(/[—–]/);
      expect(text, name).toMatch(/^[A-Z]/);
      // The one text that stops short of its full stop is the dialog's opening
      // claim, which the dialog finishes in two ways.
      if (name !== "YOUR_DATA_SAVED_HERE") expect(text, name).toMatch(/\.$/);
    }
  });
});
