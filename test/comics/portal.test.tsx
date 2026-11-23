import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/lib/auth/types";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import {
  NEW_STORY_KEY,
  clearDraft,
  draftStorageKey,
  listDraftKeys,
  loadDraft,
  readOpenStory,
  rememberOpenStory,
  saveDraft,
  type StoryDraft,
} from "@/lib/comics/draft-store";
import type { OwnerStory } from "@/lib/comics/story-input";
import { isBackupKey } from "@/lib/data/backup";

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/auth/supabase-browser", () => ({
  getAuthBrowserClient: () => null,
}));

import { ComicsPortal } from "@/app/settings/comics/comics-portal";
import { ImportClient } from "@/app/settings/comics/import/import-client";
import { StoryEditor } from "@/app/settings/comics/story-editor";

const owner = { status: "authenticated", user: { id: "o" } } as Partial<AuthContextValue>;
const unverified: Partial<AuthContextValue> = {
  status: "error",
  user: null,
  error: OWNER_UNVERIFIED,
};
const loading: Partial<AuthContextValue> = { status: "loading", user: null };
const visitor: Partial<AuthContextValue> = { status: "anonymous", user: null };

function story(over: Partial<OwnerStory> = {}): OwnerStory {
  return {
    ep: 41,
    collection: "weekly",
    sourceId: null,
    title: "From the server",
    lesson: "",
    squadQuestion: "",
    castNames: [],
    themes: [],
    panels: [],
    sharePath: null,
    bookPage: null,
    releaseAt: null,
    firstReleasedAt: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;
let listed: OwnerStory[];

function respond(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  localStorage.clear();
  listed = [];
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/comics/stories" && init?.method === "POST") {
      return respond({ story: story({ title: JSON.parse(String(init.body)).title }) }, 201);
    }
    if (url === "/api/comics/stories") return respond({ stories: listed });
    if (url === "/api/comics/licence-requests") return respond({ requests: [], unhandled: 0 });
    return respond({}, 404);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function title() {
  return screen.getByRole("textbox", { name: /title/i }) as HTMLInputElement;
}

describe("the owner gate", () => {
  it("keeps a half-filled form mounted while the owner check is unanswered", async () => {
    h.auth = owner;
    const { rerender } = render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(title(), { target: { value: "Typed on a train" } });
    const before = title();

    // The 8 second timeout, on a weak signal.
    h.auth = unverified;
    rerender(<ComicsPortal />);
    expect(title()).toBe(before);
    expect(title().value).toBe("Typed on a train");
    expect(screen.queryByText("Owner only")).toBeNull();

    h.auth = loading;
    rerender(<ComicsPortal />);
    expect(title()).toBe(before);

    h.auth = owner;
    rerender(<ComicsPortal />);
    expect(title()).toBe(before);
    expect(title().value).toBe("Typed on a train");
  });

  it("opens the form before the check has answered, and only saving waits", () => {
    h.auth = unverified;
    render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(title(), { target: { value: "Still typing" } });
    expect(title().value).toBe("Still typing");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByText(/Checking it.s you/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a confirmed visitor the notice and calls nothing", () => {
    h.auth = visitor;
    render(<ComicsPortal />);
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Owner sign in" })).toHaveAttribute(
      "href",
      `/auth/sign-in?next=${encodeURIComponent("/settings/comics")}`
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does the same on the import page", () => {
    h.auth = visitor;
    render(<ImportClient />);
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads stories and the inbox for the verified owner", async () => {
    h.auth = owner;
    render(<ComicsPortal />);
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/comics/stories", expect.anything())
    );
    expect(fetchSpy).toHaveBeenCalledWith("/api/comics/licence-requests", expect.anything());
  });

  it("counts waiting licence requests on the inbox button", async () => {
    h.auth = owner;
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "/api/comics/licence-requests") {
        return respond({
          requests: [
            { id: "a", handled_at: null },
            { id: "b", handled_at: null },
            { id: "c", handled_at: "2026-11-01" },
          ],
        });
      }
      return respond({ stories: [] });
    });
    render(<ComicsPortal />);
    expect(await screen.findByLabelText("2 waiting")).toHaveTextContent("2");
  });
});

describe("the guestbook view", () => {
  const notes = [
    { id: "n1", name: "Sara", message: "Loved it", created_at: "2026-11-02", approved_at: null },
    {
      id: "n2",
      name: "Omar",
      message: "Me too",
      created_at: "2026-11-01",
      approved_at: "2026-11-02",
    },
  ];

  it("counts the notes waiting, and shows one when asked", async () => {
    h.auth = owner;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/comics/guestbook-notes") return respond({ notes, waiting: 1 });
      if (url.startsWith("/api/comics/guestbook-notes/")) return respond({ note: {} });
      if (url === "/api/comics/licence-requests") return respond({ requests: [] });
      void init;
      return respond({ stories: [] });
    });
    render(<ComicsPortal />);
    expect(await screen.findByLabelText("1 waiting")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /^Guestbook/ }));
    expect(screen.getByText("Loved it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/comics/guestbook-notes/n1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ approved: true }) })
      )
    );
  });

  it("says what to check when the guestbook can't load", async () => {
    h.auth = owner;
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "/api/comics/guestbook-notes")
        return respond({ error: "service_unavailable" }, 503);
      if (url === "/api/comics/licence-requests") return respond({ requests: [] });
      return respond({ stories: [] });
    });
    render(<ComicsPortal />);
    fireEvent.click(await screen.findByRole("button", { name: /^Guestbook/ }));
    expect(await screen.findByText(/migration 0033/)).toBeInTheDocument();
  });
});

describe("a story's quiz and tool", () => {
  it("are written under a saved story and saved on their own", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/comics/stories/41/extras" && init?.method === "PUT") {
        return respond({ extras: JSON.parse(String(init.body)) });
      }
      if (url === "/api/comics/stories/41/extras") {
        return respond({ extras: { quiz: null, tryTool: null } });
      }
      if (url === "/api/comics/stories") return respond({ stories: listed });
      if (url === "/api/comics/licence-requests") return respond({ requests: [] });
      return respond({}, 404);
    });
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Add a question" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
      target: { value: "What comes first?" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Answer 1" }), {
      target: { value: "All of it" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Answer 2" }), {
      target: { value: "One job" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Answer 2 is right" }));
    fireEvent.click(screen.getByRole("button", { name: "Save quiz and tool" }));
    expect(await screen.findByText(/Saved\. The story's pages show it now/)).toBeInTheDocument();
    const put = fetchSpy.mock.calls.find(
      ([url, init]) => url === "/api/comics/stories/41/extras" && init?.method === "PUT"
    );
    expect(JSON.parse(String(put![1]!.body))).toEqual({
      quiz: [{ question: "What comes first?", options: ["All of it", "One job"], answer: 1 }],
      tryTool: null,
    });
  });

  it("refuses a half-written question before sending it", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "/api/comics/stories/41/extras") {
        return respond({ extras: { quiz: null, tryTool: null } });
      }
      if (url === "/api/comics/stories") return respond({ stories: listed });
      return respond({ requests: [] });
    });
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Add a question" }));
    fireEvent.click(screen.getByRole("button", { name: "Save quiz and tool" }));
    expect(await screen.findByText(/Each question needs its wording/)).toBeInTheDocument();
  });

  it("say they need migration 0033 until it has run", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    fetchSpy.mockImplementation(async (url: string) => {
      if (url === "/api/comics/stories/41/extras") {
        return respond({ error: "extras_unavailable" }, 503);
      }
      if (url === "/api/comics/stories") return respond({ stories: listed });
      return respond({ requests: [] });
    });
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    expect(await screen.findByText(/need migration 0033/)).toBeInTheDocument();
  });
});

describe("a story's guess and Try it this week", () => {
  const G = {
    question: "What happens next?",
    options: ["She asks the team", "He decides alone", "They wait a week"],
    happened: 1,
  };

  function serve(extra: (url: string, init?: RequestInit) => unknown) {
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      const answered = extra(url, init);
      if (answered) return answered;
      if (url === "/api/comics/stories/41/extras") {
        return respond({ extras: { quiz: null, tryTool: null } });
      }
      if (url === "/api/comics/stories") return respond({ stories: listed });
      if (url === "/api/comics/licence-requests") return respond({ requests: [] });
      return respond({}, 404);
    });
  }

  it("lists the stories whose import draft waits, and approves one with its tool", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    let drafts = [41];
    serve((url, init) => {
      if (url === "/api/comics/guess-drafts") return respond({ eps: drafts });
      if (url === "/api/comics/stories/41/guess" && init?.method === "PUT") {
        drafts = [];
        const body = JSON.parse(String(init.body));
        return respond({ guess: body.guess, tryAction: body.tryAction, draft: null });
      }
      if (url === "/api/comics/stories/41/guess") {
        return respond({
          guess: null,
          tryAction: null,
          draft: { guess: G, tryAction: "Ask one person first.", tryTool: "retro" },
        });
      }
      return null;
    });
    render(<ComicsPortal />);
    expect(await screen.findByRole("heading", { name: "Guesses to approve (1)" })).toBeVisible();
    expect(screen.getByText("Guess draft to approve.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Episode 41" }));
    expect(await screen.findByText("A draft is waiting for you")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Option 2" })).toHaveValue("He decides alone");
    expect(screen.getByRole("radio", { name: "The last panel shows option 2" })).toBeChecked();
    fireEvent.change(screen.getByRole("textbox", { name: "Option 3" }), {
      target: { value: "They wait until Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    expect(await screen.findByText(/Approved\. The story's page shows it now/)).toBeInTheDocument();
    const put = fetchSpy.mock.calls.find(
      ([url, init]) => url === "/api/comics/stories/41/guess" && init?.method === "PUT"
    );
    expect(JSON.parse(String(put![1]!.body))).toEqual({
      guess: { ...G, options: ["She asks the team", "He decides alone", "They wait until Friday"] },
      tryAction: "Ask one person first.",
      tryTool: "retro",
    });
    expect(screen.getByRole("button", { name: "Save guess and action" })).toBeInTheDocument();
  });

  it("leaves the story's tool alone when the owner unticks the suggestion", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    serve((url, init) => {
      if (url === "/api/comics/stories/41/guess" && init?.method === "PUT") {
        return respond({ guess: G, tryAction: null, draft: null });
      }
      if (url === "/api/comics/stories/41/guess") {
        return respond({ guess: null, tryAction: null, draft: { guess: G, tryTool: "retro" } });
      }
      return null;
    });
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Use the suggested tool/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    await screen.findByText(/Approved/);
    const put = fetchSpy.mock.calls.find(
      ([url, init]) => url === "/api/comics/stories/41/guess" && init?.method === "PUT"
    );
    expect(JSON.parse(String(put![1]!.body))).not.toHaveProperty("tryTool");
  });

  it("refuses a guess with a blank option before sending it", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    serve((url) =>
      url === "/api/comics/stories/41/guess"
        ? respond({ guess: null, tryAction: null, draft: null })
        : null
    );
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Add a guess" }));
    expect(screen.getByRole("textbox", { name: "Guess question" })).toHaveValue(
      "What happens next?"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save guess and action" }));
    expect(await screen.findByText(/The guess needs its question/)).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) => url === "/api/comics/stories/41/guess" && init?.method === "PUT"
      )
    ).toBe(false);
  });

  it("say they need migration 0035 until it has run, and the list shows no drafts", async () => {
    h.auth = owner;
    listed = [story({ ep: 41 })];
    serve((url) =>
      url === "/api/comics/stories/41/guess" || url === "/api/comics/guess-drafts"
        ? respond({ error: "guess_unavailable" }, 503)
        : null
    );
    render(<ComicsPortal />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    expect(await screen.findByText(/need migration 0035/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Guesses to approve/ })).toBeNull();
  });
});

describe("owner-only page metadata", () => {
  it("keeps both pages out of search indexes", async () => {
    const portal = await import("@/app/settings/comics/page");
    const importer = await import("@/app/settings/comics/import/page");
    for (const mod of [portal, importer]) {
      expect(mod.metadata.robots).toEqual({ index: false, follow: false });
    }
  });
});

describe("the stories view", () => {
  it("won't move stories out from under an open form", async () => {
    h.auth = owner;
    listed = [story({ ep: 27 }), story({ ep: 28 })];
    render(<ComicsPortal />);
    await screen.findByRole("button", { name: "Move episode 28 earlier" });
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    fireEvent.click(screen.getByRole("button", { name: "Move episode 28 earlier" }));
    expect(await screen.findByText(/Close the story you have open/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith("/api/comics/queue/reorder", expect.anything());
  });

  it("warns when the queue is about to run out", async () => {
    h.auth = owner;
    listed = [story({ releaseAt: new Date(Date.now() + 10 * 86_400_000).toISOString() })];
    render(<ComicsPortal />);
    const alert = await screen.findByText(/The queue runs out in 1 week\./);
    expect(alert).toHaveAttribute("role", "alert");
  });

  it("just says how long a long queue lasts", async () => {
    h.auth = owner;
    listed = [story({ releaseAt: new Date(Date.now() + 71 * 86_400_000).toISOString() })];
    render(<ComicsPortal />);
    const note = await screen.findByText("The queue runs out in 10 weeks.");
    expect(note).not.toHaveAttribute("role", "alert");
  });

  it("says so when nothing is scheduled", async () => {
    h.auth = owner;
    listed = [story()];
    render(<ComicsPortal />);
    expect(await screen.findByText(/Nothing is scheduled/)).toBeInTheDocument();
  });

  it("offers no way to move a released story", async () => {
    h.auth = owner;
    listed = [story({ ep: 27, releaseAt: "2026-01-01T00:00:00.000Z" }), story({ ep: 28 })];
    render(<ComicsPortal />);
    await screen.findByRole("button", { name: "Move episode 28 earlier" });
    expect(screen.queryByRole("button", { name: "Move episode 27 earlier" })).toBeNull();
  });
});

describe("autosave", () => {
  const draft: StoryDraft = {
    title: "Kept",
    lesson: "",
    squadQuestion: "",
    cast: "Amr, Duck",
    themes: ["T01"],
    release: "",
    panels: [],
    sharePath: null,
    baseUpdatedAt: null,
  };

  it("round-trips through storage", () => {
    expect(saveDraft(41, draft)).toBe(true);
    expect(loadDraft(41)).toEqual(draft);
    expect(listDraftKeys()).toEqual([41]);
    clearDraft(41);
    expect(loadDraft(41)).toBeNull();
    expect(listDraftKeys()).toEqual([]);
  });

  it("keeps new stories apart from numbered ones", () => {
    saveDraft(NEW_STORY_KEY, draft);
    saveDraft(41, { ...draft, title: "Numbered" });
    expect(loadDraft(NEW_STORY_KEY)?.title).toBe("Kept");
    expect(loadDraft(41)?.title).toBe("Numbered");
  });

  it("survives junk in storage", () => {
    localStorage.setItem(draftStorageKey(41), "{not json");
    expect(loadDraft(41)).toBeNull();
    localStorage.setItem(draftStorageKey(41), JSON.stringify({ title: 7, panels: "x" }));
    expect(loadDraft(41)).toMatchObject({ title: "", panels: [] });
  });

  it("reports failure rather than throwing when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(saveDraft(41, draft)).toBe(false);
    expect(loadDraft(41)).toBeNull();
    expect(() => clearDraft(41)).not.toThrow();
    expect(() => rememberOpenStory(41)).not.toThrow();
    expect(readOpenStory()).toBeNull();
    spy.mockRestore();
    getItem.mockRestore();
  });

  it("stays out of backup files, since it can hold unreleased stories", () => {
    expect(isBackupKey(draftStorageKey(41))).toBe(false);
    expect(isBackupKey(draftStorageKey(NEW_STORY_KEY))).toBe(false);
    expect(isBackupKey("agile-toolkit:comics:draft-open")).toBe(false);
  });

  it("saves what's typed, and restores it after a reload", async () => {
    h.auth = owner;
    const first = render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(title(), { target: { value: "Half a story" } });
    await waitFor(() => expect(loadDraft(NEW_STORY_KEY)?.title).toBe("Half a story"));

    first.unmount();
    render(<ComicsPortal />);
    expect(await screen.findByText(/Restored your unsaved draft/)).toBeInTheDocument();
    expect(title().value).toBe("Half a story");
  });

  it("restores a numbered draft once its story has loaded, without losing a word", async () => {
    h.auth = owner;
    listed = [story()];
    saveDraft(41, { ...draft, title: "My edit", baseUpdatedAt: story().updatedAt });
    rememberOpenStory(41);
    render(<ComicsPortal />);
    expect(await screen.findByDisplayValue("My edit")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    expect(title().value).toBe("My edit");
    expect(screen.queryByText(/changed on the server/)).toBeNull();
  });

  it("warns when the story changed on the server since the draft", async () => {
    h.auth = owner;
    listed = [story({ updatedAt: "2026-11-02T00:00:00.000Z" })];
    saveDraft(41, { ...draft, title: "Old edit", baseUpdatedAt: "2026-11-01T00:00:00.000Z" });
    rememberOpenStory(41);
    render(<ComicsPortal />);
    expect(await screen.findByText(/changed on the server/)).toBeInTheDocument();
    expect(title().value).toBe("Old edit");
    fireEvent.click(screen.getByRole("button", { name: /Use the server/ }));
    expect(title().value).toBe("From the server");
    expect(loadDraft(41)).toBeNull();
  });

  it("clears the draft once the server has the story, and keeps the form", async () => {
    h.auth = owner;
    render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(title(), { target: { value: "Going up" } });
    await waitFor(() => expect(loadDraft(NEW_STORY_KEY)?.title).toBe("Going up"));
    const before = title();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Saved.");
    expect(loadDraft(NEW_STORY_KEY)).toBeNull();
    expect(title()).toBe(before);
    expect(title().value).toBe("Going up");
    expect(screen.getByRole("heading", { name: /Episode 41/ })).toBeInTheDocument();
  });

  it("keeps every word when a save fails", async () => {
    h.auth = owner;
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("offline");
      return respond(url === "/api/comics/stories" ? { stories: [] } : { requests: [] });
    });
    render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(title(), { target: { value: "No signal here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/No connection/)).toBeInTheDocument();
    expect(title().value).toBe("No signal here");
    await waitFor(() => expect(loadDraft(NEW_STORY_KEY)?.title).toBe("No signal here"));
  });
});

describe("publishing from the form", () => {
  const renderEditor = () =>
    render(
      <StoryEditor
        ep={null}
        story={null}
        verified
        onSaved={() => undefined}
        onDeleted={() => undefined}
        onClose={() => undefined}
      />
    );

  it("won't publish a story with no description, and says why", async () => {
    h.auth = owner;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor();
    fireEvent.change(title(), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a panel without art" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    expect(await screen.findByText("Panel 1 has no art.")).toBeInTheDocument();
    expect(screen.getByText("Panel 1 has no description.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for a date before scheduling", () => {
    h.auth = owner;
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText("Choose a release date first.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reorders panels with buttons, no dragging", () => {
    h.auth = owner;
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a panel without art" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a panel without art" }));
    const first = () => screen.getAllByRole("textbox", { name: /What this panel shows/ })[0];
    fireEvent.change(first(), { target: { value: "One" } });
    expect(screen.getByRole("button", { name: "Move panel 1 up" })).toBeDisabled();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Move panel 1 down" }));
    });
    expect((first() as HTMLTextAreaElement).value).toBe("");
    expect(
      (screen.getAllByRole("textbox", { name: /What this panel shows/ })[1] as HTMLTextAreaElement)
        .value
    ).toBe("One");
  });

  it("picks images with a plain file input, without the camera API", () => {
    h.auth = owner;
    renderEditor();
    const input = screen.getByLabelText("Pick images") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
    expect(input).not.toHaveAttribute("capture");
  });
});

describe("the import page", () => {
  it("offers folder inputs on a computer", () => {
    h.auth = owner;
    render(<ImportClient />);
    // The weekly batch only: the book's episodes are never put online.
    const inputs = screen.getAllByLabelText("Choose the folder");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("webkitdirectory");
    expect(screen.queryByText("Book batch")).toBeNull();
  });

  it("says it runs on a computer when opened on a phone", async () => {
    h.auth = owner;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<ImportClient />);
    expect(await screen.findByText(/Imports run on a computer/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose the folder")).toBeNull();
  });

  it("refuses a folder with no script file, and starts nothing", async () => {
    h.auth = owner;
    render(<ImportClient />);
    const file = new File(["x"], "readme.txt");
    fireEvent.change(screen.getAllByLabelText("Choose the folder")[0], {
      target: { files: [file] },
    });
    expect(
      await screen.findByText(
        /No editorial\/stories\.json \(or the older editorial\/Agile_At_Work_Batch_1_100/
      )
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/comics/stories",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("the portal link", () => {
  it("is only on the owner's account menu and the gallery, behind the owner check", () => {
    const menu = readFileSync("src/components/auth/user-menu.tsx", "utf8");
    const before = menu.slice(0, menu.indexOf('href="/settings/comics"'));
    expect(before.lastIndexOf("function OwnerMenu")).toBe(before.lastIndexOf("function "));
    const gallery = readFileSync("src/app/(tools)/comics/components/comics-gallery.tsx", "utf8");
    expect(gallery).toContain("useIsOwner");
  });
});

/** Everything the portal's pages can pull into the browser, following relative imports. */
function clientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) clientFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const importsOf = (file: string) =>
  Array.from(
    readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)
  ).map((m) => m[1] ?? m[2]);

const CLIENT_LIB = [
  "src/lib/comics/story-input.ts",
  "src/lib/comics/queue.ts",
  "src/lib/comics/image-pipeline.ts",
  "src/lib/comics/draft-store.ts",
  "src/lib/comics/import-weekly.ts",
  "src/lib/comics/import-runner.ts",
  "src/lib/comics/entries-summary.ts",
  "src/lib/comics/entry.ts",
  "src/lib/comics/visits.ts",
];
const SERVER_ONLY = [
  "server-only",
  "@/lib/squads/server",
  "@/lib/comics/store",
  "@/lib/comics/revalidate",
  "@/lib/auth/require-user",
  "next/cache",
  "next/headers",
];

describe("the service-role boundary", () => {
  it.each(clientFiles("src/app/settings/comics"))("%s imports nothing server-only", (file) => {
    for (const spec of importsOf(file)) expect(SERVER_ONLY, spec).not.toContain(spec);
    expect(readFileSync(file, "utf8")).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it.each(CLIENT_LIB)("%s imports nothing server-only", (file) => {
    for (const spec of importsOf(file)) expect(SERVER_ONLY, spec).not.toContain(spec);
  });

  it("keeps the middleware out of the portal's code and the owner routes", () => {
    const middleware = importsOf("src/middleware.ts");
    for (const spec of middleware) {
      expect(spec).not.toMatch(/comics\/(?:story-input|queue|image-pipeline|import|revalidate)/);
      expect(spec).not.toContain("api/comics");
    }
  });

  it("leaves every owner route off the middleware's bypass list", () => {
    const source = readFileSync("src/middleware.ts", "utf8");
    const listed = Array.from(source.matchAll(/["'](\/api\/comics[^"']*)["']/g)).map((m) => m[1]);
    expect(listed.sort()).toEqual([
      "/api/comics/guestbook",
      "/api/comics/hit",
      "/api/comics/licence",
      "/api/comics/stats",
      "/api/comics/taps",
    ]);
  });

  it("marks the owner route helper server-only", () => {
    expect(importsOf("src/app/api/comics/_owner.ts")).toContain("server-only");
    expect(importsOf("src/lib/comics/revalidate.ts")).toContain("server-only");
  });
});

describe("the reorder migration", () => {
  const sql = readFileSync("supabase/migrations/0030_comic_reorder_queue.sql", "utf8");

  it("is closed to everyone but the service role", () => {
    expect(sql).toMatch(
      /revoke all on function public\.comic_reorder_queue[\s\S]*from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.comic_reorder_queue[\s\S]*to service_role/
    );
  });

  it("re-checks the released rule under a row lock", () => {
    expect(sql).toMatch(/collection = 'weekly'/);
    expect(sql).toMatch(/release_at is null or release_at > now\(\)/);
    expect(sql).toMatch(/for update/);
  });

  it("leaves release dates with their numbers", () => {
    const setClause = sql.slice(sql.indexOf("set source_id      = s.source_id"));
    expect(setClause).not.toMatch(/release_at\s*=/);
    expect(setClause).not.toMatch(/,\s*ep\s*=/);
  });
});

const MIGRATIONS = "supabase/migrations";
const migrations = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort()
  .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS, name), "utf8") }));

/** Every comic_stories column the migrations have made: the table in 0029, then every add column. */
function comicStoryColumns(): string[] {
  const columns = new Set<string>();
  const all = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), (m) => m[1]);
  for (const { sql } of migrations) {
    const table = /create table if not exists public\.comic_stories \(([\s\S]*?)\r?\n\);/i.exec(
      sql
    );
    // Columns sit two spaces in; a constraint's own lines sit deeper.
    for (const line of table?.[1].split(/\r?\n/) ?? []) {
      const name = /^ {2}([a-z_]+) /.exec(line)?.[1];
      if (name && name !== "constraint") columns.add(name);
    }
    for (const alter of all(sql, /alter table (?:if exists )?public\.comic_stories\b([^;]*);/gi)) {
      for (const name of all(alter, /add column (?:if not exists )?([a-z_]+)/gi)) columns.add(name);
      for (const name of all(alter, /drop column (?:if exists )?([a-z_]+)/gi)) columns.delete(name);
    }
  }
  return Array.from(columns);
}

/** The body of the last migration's comic_reorder_queue: the one the database runs. */
function latestReorder() {
  let latest: { name: string; sql: string; body: string } | null = null;
  for (const { name, sql } of migrations) {
    const at = sql.search(/create or replace function public\.comic_reorder_queue\(/i);
    if (at < 0) continue;
    const start = sql.indexOf("$$", at);
    latest = { name, sql, body: sql.slice(start, sql.indexOf("$$", start + 2)) };
  }
  if (!latest) throw new Error("no migration defines comic_reorder_queue");
  return latest;
}

/** The number's own columns: they stay where they are when its story moves. */
const SLOT_COLUMNS = [
  "ep",
  "collection",
  "book_page",
  "release_at",
  "first_released_at",
  "created_at",
  "updated_at",
];

describe("the latest reorder function", () => {
  const columns = comicStoryColumns();
  const storyColumns = columns.filter((c) => !SLOT_COLUMNS.includes(c));
  const { name, sql, body } = latestReorder();
  const copy = (column: string) => new RegExp(`\\b${column}\\s*=\\s*s\\.${column}\\b`);

  it("reads every comic_stories column out of the migrations", () => {
    expect(columns).toEqual(
      expect.arrayContaining([
        ...SLOT_COLUMNS,
        "title",
        "panels",
        "quiz",
        "guess",
        "print_shortlist",
      ])
    );
    expect(name >= "0038").toBe(true);
  });

  // A column added to comic_stories without a new comic_reorder_queue fails here:
  // a reorder would leave it on the old number, under another story.
  it.each(storyColumns)("moves %s with its story", (column) => {
    expect(body).toMatch(copy(column));
  });

  it("leaves the number's own columns where they are", () => {
    for (const column of SLOT_COLUMNS) expect(body).not.toMatch(copy(column));
    expect(body).toMatch(/updated_at\s*=\s*now\(\)/);
  });

  it.each(["comic_story_taps", "comic_story_stats"])("moves %s with its story", (table) => {
    expect(body).toMatch(new RegExp(`delete from public\\.${table}\\b`));
    expect(body).toMatch(new RegExp(`insert into public\\.${table}\\b[\\s\\S]*?select m\\.slot,`));
  });

  it("keeps the released check under a row lock, and the unique source_id clear", () => {
    expect(body).toMatch(/collection = 'weekly'/);
    expect(body).toMatch(/release_at is null or release_at > now\(\)/);
    expect(body).toMatch(/first_released_at is null/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/update public\.comic_stories set source_id = null/);
  });

  it("is closed to everyone but the service role, with an empty search path", () => {
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(
      /revoke all on function public\.comic_reorder_queue\(int\[\], int\[\]\)\s+from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.comic_reorder_queue\(int\[\], int\[\]\) to service_role/
    );
  });
});
