import { beforeEach, describe, expect, it } from "vitest";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";

/**
 * The Kudos settings a device keeps: the AI and beacon switches. Version 0
 * also kept a catalog of custom card themes; the cards are now only the
 * printed ones, so version 1 drops it from what an older device kept.
 */

const KEY = "agile-toolkit:kudos-settings";

const SWITCHES = {
  aiSentiment: true,
  aiDedup: true,
  aiFairness: true,
  beaconAmbient: true,
  beaconHeader: true,
};

const kept = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  useKudosSettingsStore.setState(SWITCHES);
});

describe("the kudos settings store", () => {
  it("holds the five switches and nothing about themes", () => {
    const state = useKudosSettingsStore.getState();
    expect(state).toMatchObject(SWITCHES);
    expect(state).not.toHaveProperty("customThemes");
    expect(state).not.toHaveProperty("upsertCustomTheme");
    expect(state).not.toHaveProperty("removeCustomTheme");
    expect(useKudosSettingsStore.persist.getOptions().version).toBe(1);
  });

  it("drops a version 0 device's custom themes, keeping its switches", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          ...SWITCHES,
          aiSentiment: false,
          beaconHeader: false,
          customThemes: [{ id: "ship-day", title: "Ship Day", emoji: "🚢", hex: "#123456" }],
        },
        version: 0,
      })
    );
    await useKudosSettingsStore.persist.rehydrate();
    const state = useKudosSettingsStore.getState();
    expect(state).not.toHaveProperty("customThemes");
    expect(state).toMatchObject({ ...SWITCHES, aiSentiment: false, beaconHeader: false });
    // What the device keeps is rewritten as version 1, without the catalog.
    expect(kept().version).toBe(1);
    expect(kept().state).not.toHaveProperty("customThemes");
    expect(kept().state).toMatchObject({ aiSentiment: false, beaconHeader: false });
  });

  it("reads a version 1 device's switches as they are", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { ...SWITCHES, aiDedup: false }, version: 1 })
    );
    await useKudosSettingsStore.persist.rehydrate();
    expect(useKudosSettingsStore.getState()).toMatchObject({ ...SWITCHES, aiDedup: false });
  });

  it("keeps a switch it is given", () => {
    useKudosSettingsStore.getState().setBeaconAmbient(false);
    expect(kept()).toMatchObject({ state: { beaconAmbient: false }, version: 1 });
  });
});
