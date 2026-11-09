import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installSecretDetector } from "@/lib/gamification/secrets";
import { useVDnaStore } from "@/lib/stores/vdna-store";

// The engine and the ledger do nothing until the profile is read from storage.
beforeAll(async () => {
  await useVDnaStore.persist.rehydrate();
});

/**
 * Secrets pay 100 outcome XP once ever, and words typed into a field never
 * count. Runs the real engine and ledger; the clock is a shifted Date
 * subclass (midday, so time-of-day badges stay out of the way).
 */

const RealDate = Date;
const NOW = new RealDate(2026, 10, 8, 13, 0).getTime();
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }
  static now() {
    return NOW;
  }
}

let detach: () => void = () => {};

function type(text: string, target: EventTarget = window) {
  for (const key of text) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }
}

const outcomeXp = () => useVDnaStore.getState().xpDay.total;

beforeEach(() => {
  vi.stubGlobal("Date", ShiftedDate);
  useVDnaStore.setState({
    xp: 0,
    lifetimeXp: 0,
    level: 1,
    unlocked: [],
    counters: {},
    recentEvents: [],
    dailyChallenges: [],
    weeklyChallenges: [],
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
  });
  detach = installSecretDetector();
});

afterEach(() => {
  detach();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("secrets", () => {
  it("pays a typed secret once, however often it's found", () => {
    type("agile");
    type("agile");
    expect(outcomeXp()).toBe(100);
    expect(useVDnaStore.getState().onceKeys).toEqual(["secret:typed-agile"]);
    expect(useVDnaStore.getState().unlocked).toContain("type-agile");
  });

  it("ignores words typed into a field", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    document.body.append(input, area);
    type("scrum", input);
    type("agile", area);
    expect(outcomeXp()).toBe(0);
    expect(useVDnaStore.getState().unlocked).not.toContain("type-scrum");
  });

  it("ignores the Konami code typed inside a contenteditable", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(editor);
    const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight"];
    for (const key of [...konami, "ArrowLeft", "ArrowRight", "b", "a"]) {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(outcomeXp()).toBe(0);
  });

  it("doesn't pay a secret unlocked before the ledger (migrated onceKeys)", () => {
    useVDnaStore.setState({ unlocked: ["konami"], onceKeys: ["secret:konami"] });
    const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight"];
    for (const key of [...keys, "ArrowLeft", "ArrowRight", "b", "a"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }
    expect(outcomeXp()).toBe(0);
    expect(useVDnaStore.getState().recentEvents.filter((e) => e.source === "outcome")).toEqual([]);
  });

  it("pays different secrets separately", () => {
    type("ship");
    type("kanban");
    expect(outcomeXp()).toBe(200);
  });
});
