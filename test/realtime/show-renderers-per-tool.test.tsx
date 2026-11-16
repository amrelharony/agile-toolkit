import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ShowFrameView } from "@/components/collab/show-room/show-frame-view";
import { CARDS_FRAME_KIND, cardsFrame } from "@/lib/realtime/show-room/frames/card-decks";
import { TEXT_FRAME_KIND } from "@/lib/realtime/show-room/frames";
import {
  loadShowRenderers,
  loadedShowRenderers,
  showRendererFor,
} from "@/lib/realtime/show-room/renderers/registry";

/**
 * A show room loads only its own tool's renderers (the registry, not the
 * `renderers` index, which holds every tool's): Card Decks never downloads
 * the Picker's wheel. The view waits a moment for its tool's set, and says
 * a frame it can't draw needs a reload when the set can't load.
 */

// Team Mixer's renderers fail to load here, as a lost chunk would.
vi.mock("@/lib/realtime/show-room/renderers/team-mixer", () => {
  throw new Error("chunk lost");
});

const frame = (kind: string, payload: unknown) => ({
  n: 1,
  kind,
  payload,
  supported: true,
  at: 1_700_000_000_000,
});

describe("show renderers, one tool at a time", () => {
  it("draws text at once, and a tool's own frames only once its set has loaded", async () => {
    expect(showRendererFor("card-decks", TEXT_FRAME_KIND)).not.toBeNull();
    expect(showRendererFor("card-decks", CARDS_FRAME_KIND)).toBeNull();
    expect(loadedShowRenderers("card-decks")).toBeNull();

    await loadShowRenderers("card-decks");
    expect(showRendererFor("card-decks", CARDS_FRAME_KIND)).not.toBeNull();
    // The other tools' sets stay where they are.
    expect(loadedShowRenderers("picker")).toBeNull();
    expect(showRendererFor("picker", "wheel")).toBeNull();
  });

  it("loads the Picker's set when its view mounts, and draws the frame once it's in", async () => {
    const payload = cardsFrame("Retro prompts", [{ text: "What surprised you?" }]);
    render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="picker" frame={frame(TEXT_FRAME_KIND, { title: "Sam", body: "" })} />
      </LiveAnnouncerProvider>
    );
    // Text needs no tool set.
    expect(screen.getByText("Sam")).toBeInTheDocument();
    await vi.waitFor(() => expect(loadedShowRenderers("picker")).not.toBeNull());

    render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="card-decks" frame={frame(CARDS_FRAME_KIND, payload)} />
      </LiveAnnouncerProvider>
    );
    expect(await screen.findByText("What surprised you?")).toBeInTheDocument();
  });

  it("says a frame needs a reload when its tool's set can't load, and tries again later", async () => {
    render(
      <LiveAnnouncerProvider>
        <ShowFrameView tool="team-mixer" frame={frame("groups", { groups: [] })} />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText("Loading what the host is showing…")).toBeInTheDocument();
    expect(
      await screen.findByText(/can't display\. Reload the page to update it\./)
    ).toBeInTheDocument();
    // A failed load is forgotten: the next call asks again.
    await expect(loadShowRenderers("team-mixer")).rejects.toThrow();
    expect(loadedShowRenderers("team-mixer")).toBeNull();
  });
});
