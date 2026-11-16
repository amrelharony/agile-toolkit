/**
 * Voice in a visitor's chat with Amr's AI (Amr chat revamp, PR 11): browser
 * dictation may send the sound of the visitor's voice to the browser's
 * maker, so the visitor's mic asks first. The first press shows the voice
 * notice (components/agent/mascot/voice-notice, loaded only then), a
 * labelled group that takes focus; "Use voice" and "Not now" both hand focus
 * back to the mic, and only "Use voice" starts dictation, remembered in this
 * browser (lib/agent/mascot/voice-consent) so the notice shows once.
 *
 * Keyboard path: jsdom moves no focus on Tab, so each step focuses the next
 * control the way Tab would, and presses it with a click of detail 0, which
 * is what a key press on a button sends.
 *
 * The notice's words are written out here, not imported: this file must not
 * load the notice's module itself, or the first test couldn't see that only
 * a press loads it. The last test checks they are the module's own.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ noticeLoads: 0 }));

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
// Counts the loads of the notice's module: the chat imports it on a press only.
vi.mock("@/components/agent/mascot/voice-notice", async (importOriginal) => {
  h.noticeLoads++;
  return importOriginal();
});

import VisitorAgentPanel, {
  VOICE_NOTICE_LOAD_ERROR,
} from "@/components/agent/mascot/visitor-agent-panel";
import { DICTATE_LABEL, LISTENING_NOTE } from "@/components/agent/chat/dictate-button";
import { useAgentStore } from "@/lib/agent/store";
import { VOICE_CONSENT_KEY, VOICE_CONSENT_VERSION } from "@/lib/agent/mascot/voice-consent";
import { VOICE_INPUT_DISCLOSURE } from "@/lib/site/disclosures";

const LABEL = "Use your voice?";
const USE = "Use voice";
const NOT_NOW = "Not now";

/** A stand-in for the browser's SpeechRecognition, keeping the last one made. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = true;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
  /** What the browser heard so far, in one result. */
  hear(transcript: string, isFinal = false) {
    const result = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ results: [result] });
  }
}

const mic = () => screen.getByRole("button", { name: DICTATE_LABEL });
const notice = () => screen.queryByRole("group", { name: LABEL });
const note = () => document.querySelector("[data-composer-note]");

/** A key press on a focused button: focus it, then the click a key sends (detail 0). */
function pressByKey(button: HTMLElement) {
  act(() => button.focus());
  fireEvent.click(button, { detail: 0 });
}

/** Press the mic by key, and wait for the notice it brings. */
async function askForVoice(): Promise<HTMLElement> {
  pressByKey(mic());
  return screen.findByRole("group", { name: LABEL });
}

function Chat() {
  return <VisitorAgentPanel initialQuestion="" onOfflineGuide={() => {}} />;
}

beforeEach(() => {
  (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
  FakeRecognition.last = null;
  localStorage.clear();
  useAgentStore.getState().reset();
  useAgentStore.setState({ chatProfile: "owner", visitorQuota: null });
  useAgentStore.getState().setDraft("visitor", "");
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
});

afterEach(() => {
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.restoreAllMocks();
  localStorage.clear();
  useAgentStore.getState().reset();
  useAgentStore.getState().setDraft("visitor", "");
});

describe("the visitor's mic, before this browser said Use voice", () => {
  it("is the chat's Dictate button, and loads the notice only once it is pressed", async () => {
    render(<Chat />);
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    expect(notice()).toBeNull();
    expect(h.noticeLoads).toBe(0);
    await askForVoice();
    expect(h.noticeLoads).toBe(1);
  });

  it("shows a labelled group that says why and takes focus, and starts nothing", async () => {
    render(<Chat />);
    const group = await askForVoice();
    expect(group).toHaveFocus();
    expect(group).toHaveAccessibleDescription(VOICE_INPUT_DISCLOSURE);
    // Under the box's row, in the composer's footer, never in the log.
    expect(group.closest("[data-chat-footer]")).not.toBeNull();
    expect(group.closest('[role="log"]')).toBeNull();
    const form = document.querySelector("form")!;
    expect(form.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(FakeRecognition.last).toBeNull();
    expect(mic()).toHaveAttribute("aria-pressed", "false");
  });

  it("Use voice, by key: focus goes back to the mic, dictation starts, and the yes is kept", async () => {
    useAgentStore.getState().setDraft("visitor", "Add to the retro:");
    render(<Chat />);
    await askForVoice();
    pressByKey(screen.getByRole("button", { name: USE }));
    expect(notice()).toBeNull();
    expect(mic()).toHaveFocus();
    expect(FakeRecognition.last?.start).toHaveBeenCalledTimes(1);
    expect(mic()).toHaveAttribute("aria-pressed", "true");
    expect(note()).toHaveTextContent(LISTENING_NOTE);
    expect(localStorage.getItem(VOICE_CONSENT_KEY)).toBe(VOICE_CONSENT_VERSION);
    // What it hears goes after what was typed.
    act(() => FakeRecognition.last!.hear("flaky CI", true));
    expect(useAgentStore.getState().drafts.visitor).toBe("Add to the retro: flaky CI");
  });

  it("Not now, by key: focus goes back to the mic, nothing starts or is kept, and the next press asks again", async () => {
    render(<Chat />);
    await askForVoice();
    pressByKey(screen.getByRole("button", { name: NOT_NOW }));
    expect(notice()).toBeNull();
    expect(mic()).toHaveFocus();
    expect(FakeRecognition.last).toBeNull();
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem(VOICE_CONSENT_KEY)).toBeNull();
    expect(await askForVoice()).toHaveFocus();
  });

  it("Escape in the notice is Not now, and the panel around it never takes it", async () => {
    const panelEscape = vi.fn((e: { defaultPrevented: boolean }) => e.defaultPrevented);
    render(
      // A stand-in for the panel, whose own Escape skips one already handled.
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={(e) => panelEscape(e)}>
        <Chat />
      </div>
    );
    const group = await askForVoice();
    fireEvent.keyDown(group, { key: "Escape" });
    expect(panelEscape).toHaveReturnedWith(true);
    expect(notice()).toBeNull();
    expect(mic()).toHaveFocus();
    expect(FakeRecognition.last).toBeNull();
    expect(localStorage.getItem(VOICE_CONSENT_KEY)).toBeNull();
  });

  it("a press while the notice shows brings it focus again, as one notice", async () => {
    render(<Chat />);
    await askForVoice();
    pressByKey(mic());
    await waitFor(() => expect(notice()).toHaveFocus());
    expect(screen.getAllByRole("group", { name: LABEL })).toHaveLength(1);
    expect(FakeRecognition.last).toBeNull();
  });
});

describe("the visitor's mic, once this browser said Use voice", () => {
  it("starts at once on a press, with no notice", () => {
    localStorage.setItem(VOICE_CONSENT_KEY, VOICE_CONSENT_VERSION);
    render(<Chat />);
    pressByKey(mic());
    expect(notice()).toBeNull();
    expect(FakeRecognition.last?.start).toHaveBeenCalledTimes(1);
    expect(mic()).toHaveAttribute("aria-pressed", "true");
    expect(mic()).toHaveFocus();
  });

  it("asks again when the kept yes is for an older notice, or storage throws", async () => {
    localStorage.setItem(VOICE_CONSENT_KEY, "v0");
    const view = render(<Chat />);
    expect(await askForVoice()).toHaveFocus();
    view.unmount();
    const real = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      if (key === VOICE_CONSENT_KEY) throw new Error("blocked");
      return real.call(this, key);
    });
    render(<Chat />);
    expect(await askForVoice()).toHaveFocus();
    expect(FakeRecognition.last).toBeNull();
  });

  it("isn't there where the browser has no dictation", () => {
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Chat />);
    expect(screen.queryByRole("button", { name: DICTATE_LABEL })).toBeNull();
  });
});

describe("the notice's module", () => {
  it("holds the words written out above", async () => {
    const words = await import("@/components/agent/mascot/voice-notice");
    expect([words.VOICE_NOTICE_LABEL, words.USE_VOICE, words.NOT_NOW]).toEqual([
      LABEL,
      USE,
      NOT_NOW,
    ]);
  });

  it("that can't load: the status row says so and nothing starts", async () => {
    vi.resetModules();
    vi.doMock("@/components/agent/mascot/voice-notice", () => {
      throw new Error("offline");
    });
    const Fresh = (await import("@/components/agent/mascot/visitor-agent-panel")).default;
    render(<Fresh initialQuestion="" onOfflineGuide={() => {}} />);
    pressByKey(mic());
    await waitFor(() => expect(note()).toHaveTextContent(VOICE_NOTICE_LOAD_ERROR));
    expect(notice()).toBeNull();
    expect(FakeRecognition.last).toBeNull();
    vi.doUnmock("@/components/agent/mascot/voice-notice");
  });
});
