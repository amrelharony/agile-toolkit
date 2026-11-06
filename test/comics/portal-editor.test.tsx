import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/lib/auth/types";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import {
  NEW_STORY_KEY,
  clearReviewDraft,
  loadDraft,
  loadReviewDraft,
  rememberOpenStory,
  reviewDraftKey,
  saveReviewDraft,
} from "@/lib/comics/draft-store";
import type { OwnerStory, StoredPanel } from "@/lib/comics/story-input";
import { isBackupKey } from "@/lib/data/backup";

interface Deferred {
  file: File;
  options: { withShare: boolean };
  resolve: (art: unknown) => void;
  reject: (err: unknown) => void;
}

const h = vi.hoisted(() => ({
  auth: null as Partial<AuthContextValue> | null,
  jobs: [] as Deferred[],
}));

/** The folder's script file, by the name the weekly batch looks for. */
const SCRIPTS = "Agile_At_Work_Batch_1_100_Story_Scripts.json";

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/comics/image-pipeline", async (original) => ({
  ...(await original<typeof import("@/lib/comics/image-pipeline")>()),
  processPanelImage: vi.fn(
    (file: File, options: { withShare: boolean }) =>
      new Promise((resolve, reject) => {
        h.jobs.push({ file, options, resolve, reject });
      })
  ),
}));

// A one-story weekly batch: these tests are about the folder input and the run,
// not the 100-script file, which test/comics/import.test.ts covers.
vi.mock("@/lib/comics/import-weekly", async (original) => {
  const actual = await original<typeof import("@/lib/comics/import-weekly")>();
  return {
    ...actual,
    planWeeklyImport: (_scripts: unknown, files: readonly { path: string }[]) => {
      const art = files.find((f) => f.path.endsWith(".png"));
      if (!art) return { ok: false, problems: ["No art."] };
      return {
        ok: true,
        stories: [
          {
            ep: 27,
            sourceId: "AAW-N001",
            title: "One story",
            lesson: "A lesson.",
            squadQuestion: "A question?",
            castNames: [],
            themes: [],
            bookPage: null,
            panels: [
              {
                file: art,
                text: {
                  pathFull: "",
                  pathSmall: "",
                  width: 0,
                  height: 0,
                  alt: "Shown.",
                  dialogue: [],
                  signs: [],
                  needsReview: true,
                  creditCorner: "bottom-right",
                },
              },
            ],
          },
        ],
      };
    },
  };
});

import { ComicsPortal } from "@/app/settings/comics/comics-portal";
import { ImportClient } from "@/app/settings/comics/import/import-client";
import { StoryEditor } from "@/app/settings/comics/story-editor";
import { useArtQueue } from "@/app/settings/comics/use-art-queue";

const owner = { status: "authenticated", user: { id: "o" } } as Partial<AuthContextValue>;
const unverified: Partial<AuthContextValue> = {
  status: "error",
  user: null,
  error: OWNER_UNVERIFIED,
};

const ART = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}.webp`;
const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-01T01:00:00.000Z";
const T2 = "2026-11-01T02:00:00.000Z";
const PAST = "2026-01-05T07:00:00.000Z";

function panel(over: Partial<StoredPanel> = {}): StoredPanel {
  return {
    pathFull: ART(1),
    pathSmall: ART(2),
    width: 1536,
    height: 1024,
    alt: "Two colleagues at a printer.",
    dialogue: [],
    signs: [],
    needsReview: false,
    creditCorner: "bottom-right",
    ...over,
  };
}

function story(over: Partial<OwnerStory> = {}): OwnerStory {
  return {
    ep: 41,
    collection: "weekly",
    sourceId: null,
    title: "From the server",
    lesson: "Server lesson",
    squadQuestion: "",
    castNames: [],
    themes: [],
    panels: [panel()],
    sharePath: ART(3),
    bookPage: null,
    releaseAt: null,
    firstReleasedAt: null,
    updatedAt: T0,
    ...over,
  };
}

function art(name: string, share = false) {
  return {
    pathFull: `${name}.full`,
    pathSmall: `${name}.small`,
    sharePath: share ? `${name}.share` : null,
    width: 10,
    height: 10,
  };
}

const respond = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

let fetchSpy: ReturnType<typeof vi.fn>;
const workingFetch = () =>
  fetchSpy.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
let listed: OwnerStory[];
let confirmSpy: ReturnType<typeof vi.spyOn>;
const picture = (name: string) => new File(["x"], name, { type: "image/png" });
const titleBox = () => screen.getByRole("textbox", { name: /title/i }) as HTMLInputElement;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const methodCalls = (method: string) =>
  fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);

beforeEach(() => {
  localStorage.clear();
  h.jobs.length = 0;
  listed = [];
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/comics/stories" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return respond({ story: story({ ...body, updatedAt: T1 }) }, 201);
    }
    if (url === "/api/comics/stories") return respond({ stories: listed });
    if (url === "/api/comics/licence-requests") return respond({ requests: [], unhandled: 0 });
    if (/stories\/\d+\/release$/.test(url) && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return respond({ story: story({ releaseAt: body.releaseAt, updatedAt: T2 }) });
    }
    if (/stories\/\d+$/.test(url) && init?.method === "PATCH") {
      return respond({ story: story({ ...JSON.parse(String(init.body)), updatedAt: T1 }) });
    }
    if (url === "/api/comics/queue/schedule") return respond({ stories: listed });
    return respond({}, 404);
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
  vi.unstubAllGlobals();
});

function renderEditor(props: Partial<React.ComponentProps<typeof StoryEditor>> = {}) {
  const callbacks = {
    onSaved: vi.fn(),
    onDeleted: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<StoryEditor ep={null} story={null} verified {...callbacks} {...props} />);
  return { ...view, ...callbacks };
}

describe("the art queue", () => {
  const options = { corner: "bottom-right" as const, withShare: false };
  const setup = () => {
    const onDone = vi.fn();
    const hook = renderHook(() =>
      useArtQueue({ uploader: {} as never, optionsFor: () => options, onDone })
    );
    return { ...hook, onDone };
  };

  it("runs the new picture, not the old one, when a job is replaced mid-flight", async () => {
    const { result, onDone } = setup();
    const [wrong, right] = [picture("wrong.png"), picture("right.png")];
    act(() => result.current.enqueue("p1", wrong));
    await waitFor(() => expect(h.jobs).toHaveLength(1));

    act(() => result.current.enqueue("p1", right));
    expect(result.current.jobs.map((j) => j.file)).toEqual([right]);

    await act(async () => h.jobs[0].resolve(art("wrong")));
    await waitFor(() => expect(h.jobs).toHaveLength(2));
    expect(h.jobs[1].file).toBe(right);
    expect(onDone).not.toHaveBeenCalled();
    expect(result.current.jobs.map((j) => j.file)).toEqual([right]);

    await act(async () => h.jobs[1].resolve(art("right")));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledWith("p1", art("right"));
    expect(result.current.jobs).toEqual([]);
  });

  it("doesn't mark the new job failed when the replaced one fails", async () => {
    const { result } = setup();
    act(() => result.current.enqueue("p1", picture("a.png")));
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    act(() => result.current.enqueue("p1", picture("b.png")));
    await act(async () => h.jobs[0].reject(new Error("offline")));
    await waitFor(() => expect(h.jobs).toHaveLength(2));
    expect(result.current.jobs[0].status).not.toBe("failed");
  });

  it("ignores a dismissed job's result", async () => {
    const { result, onDone } = setup();
    act(() => result.current.enqueue("p1", picture("a.png")));
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    act(() => result.current.dismiss("p1"));
    await act(async () => h.jobs[0].resolve(art("a")));
    await settle();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("stops everything when the form goes away", async () => {
    const { result, onDone, unmount } = setup();
    act(() => {
      result.current.enqueue("p1", picture("a.png"));
      result.current.enqueue("p2", picture("b.png"));
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    unmount();
    await act(async () => h.jobs[0].resolve(art("a")));
    await settle();
    expect(onDone).not.toHaveBeenCalled();
    expect(h.jobs).toHaveLength(1);
  });

  it("retries a failed job", async () => {
    const { result, onDone } = setup();
    act(() => result.current.enqueue("p1", picture("a.png")));
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    await act(async () => h.jobs[0].reject(new Error("offline")));
    await waitFor(() => expect(result.current.jobs[0].status).toBe("failed"));
    expect(result.current.jobs[0].error).toBe("offline");
    act(() => result.current.retry("p1"));
    await waitFor(() => expect(h.jobs).toHaveLength(2));
    await act(async () => h.jobs[1].resolve(art("a")));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

describe("a story's server copy arriving late", () => {
  it("keeps what was typed in the meantime, and warns", async () => {
    h.auth = unverified;
    listed = [story()];
    rememberOpenStory(41);
    const { rerender } = render(<ComicsPortal />);
    fireEvent.change(await screen.findByRole("textbox", { name: /title/i }), {
      target: { value: "Typed on a train" },
    });
    expect(screen.getByText(/Checking it.s you/)).toBeInTheDocument();

    h.auth = owner;
    rerender(<ComicsPortal />);
    expect(await screen.findByText(/changed on the server/)).toBeInTheDocument();
    expect(titleBox().value).toBe("Typed on a train");
    // Saving a nearly blank form would wipe the rest, so what wasn't typed fills in.
    expect((screen.getByRole("textbox", { name: "Lesson" }) as HTMLTextAreaElement).value).toBe(
      "Server lesson"
    );
    expect(screen.getByRole("textbox", { name: /What this panel shows/ })).toHaveValue(
      "Two colleagues at a printer."
    );
    await waitFor(() => expect(loadDraft(41)?.title).toBe("Typed on a train"));

    fireEvent.click(screen.getByRole("button", { name: /Use the server/ }));
    expect(titleBox().value).toBe("From the server");
  });

  it("just fills the form when nothing was typed", async () => {
    h.auth = owner;
    listed = [story()];
    rememberOpenStory(41);
    render(<ComicsPortal />);
    expect(await screen.findByDisplayValue("From the server")).toBeInTheDocument();
    expect(screen.queryByText(/changed on the server/)).toBeNull();
    expect(loadDraft(41)).toBeNull();
  });

  it("clears the warning once the typed version is saved", async () => {
    h.auth = unverified;
    listed = [story()];
    rememberOpenStory(41);
    const { rerender } = render(<ComicsPortal />);
    fireEvent.change(await screen.findByRole("textbox", { name: /title/i }), {
      target: { value: "Mine" },
    });
    h.auth = owner;
    rerender(<ComicsPortal />);
    await screen.findByText(/changed on the server/);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Saved.");
    expect(screen.queryByText(/changed on the server/)).toBeNull();
  });
});

describe("when the stories list won't load", () => {
  beforeEach(() => {
    h.auth = owner;
    rememberOpenStory(41);
  });

  const failingList = () => {
    let failing = true;
    const original = workingFetch();
    fetchSpy.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/comics/stories" && !init?.method && failing) {
        return respond({ error: "service_unavailable" }, 503);
      }
      return original(url, init);
    });
    return () => {
      failing = false;
    };
  };

  it("says so in the form, not that it's checking the owner", async () => {
    failingList();
    render(<ComicsPortal />);
    expect(await screen.findByText(/Couldn.t load this story/)).toBeInTheDocument();
    expect(screen.queryByText(/Checking it.s you/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("retries from the form", async () => {
    const heal = failingList();
    listed = [story()];
    render(<ComicsPortal />);
    await screen.findByText(/Couldn.t load this story/);
    heal();
    const editor = screen.getByRole("textbox", { name: /title/i }).closest("form")!;
    const retry = Array.from(editor.querySelectorAll("button")).find(
      (b) => b.textContent === "Try again"
    )!;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    expect(screen.queryByText(/Couldn.t load this story/)).toBeNull();
  });

  it("retries by itself when the connection comes back", async () => {
    const heal = failingList();
    listed = [story()];
    render(<ComicsPortal />);
    await screen.findByText(/Couldn.t load this story/);
    heal();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
  });

  it("can still save a new story while the list hasn't arrived, and keeps the form", async () => {
    rememberOpenStory(null);
    let finishList: (value: unknown) => void = () => undefined;
    const original = workingFetch();
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/comics/stories" && !init?.method
        ? new Promise((resolve) => {
            finishList = resolve;
          })
        : original(url, init)
    );
    render(<ComicsPortal />);
    fireEvent.click(screen.getByRole("button", { name: "New story" }));
    fireEvent.change(titleBox(), { target: { value: "Going up" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Saved.");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();

    // A list fetched before that save doesn't have it, and mustn't close the form.
    await act(async () => finishList(respond({ stories: [] })));
    expect(titleBox().value).toBe("Going up");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
});

describe("scheduling from the form", () => {
  it("refuses a date that has passed, with no call to the server", () => {
    h.auth = owner;
    renderEditor({ ep: 41, story: story() });
    fireEvent.change(screen.getByLabelText(/Release date/), {
      target: { value: "2020-01-06T07:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText(/That date has passed/)).toBeInTheDocument();
    expect(methodCalls("PUT")).toEqual([]);
    expect(methodCalls("PATCH")).toEqual([]);
  });

  it("schedules a future date", async () => {
    h.auth = owner;
    renderEditor({ ep: 41, story: story() });
    fireEvent.change(screen.getByLabelText(/Release date/), {
      target: { value: "2099-01-05T07:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(await screen.findByText("Scheduled.")).toBeInTheDocument();
  });
});

describe("after a release action", () => {
  it.each([
    ["Publish now", "Published.", {}],
    ["Unpublish", "Unpublished.", { releaseAt: PAST, firstReleasedAt: PAST }],
  ])("%s leaves no draft and no false warning", async (button, message, over) => {
    h.auth = owner;
    const first = renderEditor({ ep: 41, story: story(over) });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await screen.findByText(message);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 450)));
    expect(loadDraft(41)).toBeNull();
    first.unmount();
    expect(loadDraft(41)).toBeNull();

    renderEditor({ ep: 41, story: story({ ...over, updatedAt: T2 }) });
    expect(screen.queryByText(/changed on the server/)).toBeNull();
    expect(screen.queryByText(/Restored your unsaved draft/)).toBeNull();
  });

  it("keeps text typed before unpublishing, based on the story's new version", async () => {
    h.auth = owner;
    const first = renderEditor({
      ep: 41,
      story: story({ releaseAt: PAST, firstReleasedAt: PAST }),
    });
    fireEvent.change(titleBox(), { target: { value: "Still editing" } });
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    await screen.findByText("Unpublished.");
    expect(loadDraft(41)).toMatchObject({ title: "Still editing", baseUpdatedAt: T2, release: "" });
    first.unmount();

    renderEditor({ ep: 41, story: story({ updatedAt: T2 }) });
    expect(titleBox().value).toBe("Still editing");
    expect(screen.queryByText(/changed on the server/)).toBeNull();
  });
});

describe("panels still marked for review", () => {
  const unreviewed = () => story({ panels: [panel({ needsReview: true }), panel()] });

  it("asks before the form publishes them, and sends the yes", async () => {
    h.auth = owner;
    renderEditor({ ep: 41, story: unreviewed() });
    fireEvent.change(screen.getByLabelText(/Release date/), {
      target: { value: "2099-01-05T07:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/1 panel still needs review/));
    await screen.findByText("Scheduled.");
    const [, init] = methodCalls("PUT")[0];
    expect(JSON.parse(String((init as RequestInit).body)).allowUnreviewed).toBe(true);
  });

  it("stops if the answer is no", () => {
    h.auth = owner;
    confirmSpy.mockReturnValue(false);
    renderEditor({ ep: 41, story: unreviewed() });
    fireEvent.change(screen.getByLabelText(/Release date/), {
      target: { value: "2099-01-05T07:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(methodCalls("PUT")).toEqual([]);
    expect(methodCalls("PATCH")).toEqual([]);
  });

  it("leaves them out of the scheduled queue unless they're included", async () => {
    h.auth = owner;
    listed = [
      story({ ep: 27, title: "Unchecked", panels: [panel({ needsReview: true })] }),
      story({ ep: 28, title: "Checked" }),
    ];
    render(<ComicsPortal />);
    expect(await screen.findByText(/1 story has 1 panel nobody has reviewed/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Launch date"), { target: { value: "2099-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview the dates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save these 1 dates" }));
    await screen.findByText("Dates saved.");
    let body = JSON.parse(String((methodCalls("POST").at(-1)![1] as RequestInit).body));
    expect(body.items.map((i: { ep: number }) => i.ep)).toEqual([28]);
    expect(body.allowUnreviewed).toBe(false);

    fireEvent.click(screen.getByLabelText("Include them anyway"));
    fireEvent.click(screen.getByRole("button", { name: "Preview the dates" }));
    expect(await screen.findByText("Not reviewed yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save these 2 dates" }));
    await waitFor(() => expect(methodCalls("POST")).toHaveLength(2));
    body = JSON.parse(String((methodCalls("POST").at(-1)![1] as RequestInit).body));
    expect(body.items.map((i: { ep: number }) => i.ep)).toEqual([27, 28]);
    expect(body.allowUnreviewed).toBe(true);
  });

  it("offers nothing to schedule by default straight after an import", async () => {
    h.auth = owner;
    listed = [story({ ep: 27, panels: [panel({ needsReview: true })] })];
    render(<ComicsPortal />);
    await screen.findByText(/nobody has reviewed/);
    fireEvent.change(screen.getByLabelText("Launch date"), { target: { value: "2099-01-05" } });
    expect(screen.getByRole("button", { name: "Preview the dates" })).toBeDisabled();
  });
});

describe("a story that has been out and was unpublished", () => {
  it("offers no way to move or delete it", async () => {
    h.auth = owner;
    listed = [story({ ep: 27, firstReleasedAt: PAST }), story({ ep: 28 }), story({ ep: 29 })];
    render(<ComicsPortal />);
    await screen.findByRole("button", { name: "Move episode 28 later" });
    expect(screen.queryByRole("button", { name: "Move episode 27 later" })).toBeNull();
    expect(screen.getByText(/It has been out, so its number stays/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(await screen.findByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  });

  it("isn't offered for the bulk publish in the review queue", async () => {
    h.auth = owner;
    listed = [
      story({ ep: 5, collection: "book", firstReleasedAt: PAST }),
      story({ ep: 6, collection: "book" }),
      story({ ep: 7, collection: "book", panels: [panel({ needsReview: true })] }),
    ];
    render(<ComicsPortal />);
    fireEvent.click(await screen.findByRole("button", { name: /Review queue/ }));
    expect(await screen.findByText("1 book episode is ready to go out.")).toBeInTheDocument();
  });
});

describe("throwing a story away", () => {
  it("doesn't create it when pictures are still on their way", async () => {
    h.auth = owner;
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png"), picture("b.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();

    await act(async () => h.jobs[0].resolve(art("a", true)));
    await settle();
    expect(methodCalls("POST")).toEqual([]);
    expect(h.jobs).toHaveLength(1);
    expect(loadDraft(NEW_STORY_KEY)).toBeNull();
  });

  it("doesn't save anything from a picture that lands after the form closed", async () => {
    h.auth = owner;
    const { unmount } = renderEditor();
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    unmount();
    await act(async () => h.jobs[0].resolve(art("a", true)));
    await settle();
    expect(methodCalls("POST")).toEqual([]);
  });

  it("asks before leaving while pictures are uploading", async () => {
    h.auth = owner;
    confirmSpy.mockReturnValue(false);
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Back to stories" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/still uploading/));
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to stories" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("just leaves when nothing is uploading", () => {
    h.auth = owner;
    const { onClose } = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Back to stories" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the share image", () => {
  const pickTwoAndFinish = async () => {
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png"), picture("b.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    await act(async () => h.jobs[0].resolve(art("a", true)));
    await waitFor(() => expect(h.jobs).toHaveLength(2));
    await act(async () => h.jobs[1].resolve(art("b")));
    await settle();
  };

  it("is made again from the new first panel when the first is removed", async () => {
    h.auth = owner;
    renderEditor({ verified: false });
    await pickTwoAndFinish();
    fireEvent.click(screen.getByRole("button", { name: "Remove panel 1" }));
    await waitFor(() => expect(h.jobs).toHaveLength(3));
    expect(h.jobs[2].file.name).toBe("b.png");
    expect(h.jobs[2].options.withShare).toBe(true);
  });

  it("says so when the new first panel's picture isn't on this device", () => {
    h.auth = owner;
    renderEditor({
      ep: 41,
      story: story({ panels: [panel(), panel({ alt: "Second" })] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove panel 1" }));
    expect(screen.getByText(/still shows the old first panel/)).toBeInTheDocument();
    expect(h.jobs).toEqual([]);
  });

  it("isn't touched by removing a later panel", async () => {
    h.auth = owner;
    renderEditor({ verified: false });
    await pickTwoAndFinish();
    fireEvent.click(screen.getByRole("button", { name: "Remove panel 2" }));
    await settle();
    expect(h.jobs).toHaveLength(2);
  });

  it("ignores a crop from a panel removed while it was uploading", async () => {
    h.auth = owner;
    renderEditor();
    fireEvent.change(titleBox(), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Remove panel 1" }));
    await act(async () => h.jobs[0].resolve(art("a", true)));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Saved.");
    const body = JSON.parse(String((methodCalls("POST").at(-1)![1] as RequestInit).body));
    expect(body.sharePath).toBeNull();
  });

  it("comes from the panel that's first by the time its upload ends", async () => {
    h.auth = owner;
    renderEditor();
    fireEvent.change(titleBox(), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Pick images"), {
      target: { files: [picture("a.png"), picture("b.png")] },
    });
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    expect(h.jobs[0].options.withShare).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move panel 1 down" }));

    await act(async () => h.jobs[0].resolve(art("a", true)));
    await waitFor(() => expect(h.jobs).toHaveLength(2));
    expect(h.jobs[1].file.name).toBe("b.png");
    expect(h.jobs[1].options.withShare).toBe(true);
    await act(async () => h.jobs[1].resolve(art("b", true)));
    await waitFor(() => expect(methodCalls("POST").length).toBeGreaterThan(0));
    await waitFor(() => {
      const last = methodCalls("POST").concat(methodCalls("PATCH")).at(-1)!;
      expect(JSON.parse(String((last[1] as RequestInit).body)).sharePath).toBe("b.share");
    });
  });
});

describe("the review queue's typing", () => {
  const openReview = async () => {
    fireEvent.click(await screen.findByRole("button", { name: /Review queue/ }));
    return screen.findByRole("textbox", { name: /What this panel shows/ });
  };

  beforeEach(() => {
    h.auth = owner;
    listed = [
      story({
        ep: 7,
        collection: "book",
        panels: [panel({ alt: "", needsReview: true }), panel({ alt: "", needsReview: true })],
      }),
    ];
  });

  it("survives another view, and says it was restored", async () => {
    render(<ComicsPortal />);
    fireEvent.change(await openReview(), { target: { value: "A long description" } });
    fireEvent.click(screen.getByRole("button", { name: "Stories" }));
    expect(loadReviewDraft(7, 0, "")?.alt).toBe("A long description");
    expect(await openReview()).toHaveValue("A long description");
    expect(screen.getByText(/Restored what you typed/)).toBeInTheDocument();
  });

  it("survives Skip and Previous", async () => {
    render(<ComicsPortal />);
    fireEvent.change(await openReview(), { target: { value: "First panel's words" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    const second = await screen.findByRole("textbox", { name: /What this panel shows/ });
    expect(second).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByRole("textbox", { name: /What this panel shows/ })).toHaveValue(
      "First panel's words"
    );
  });

  it("survives the tab being killed", async () => {
    const first = render(<ComicsPortal />);
    fireEvent.change(await openReview(), { target: { value: "Before the phone slept" } });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(loadReviewDraft(7, 0, "")?.alt).toBe("Before the phone slept");
    first.unmount();
    render(<ComicsPortal />);
    expect(await openReview()).toHaveValue("Before the phone slept");
  });

  it("is cleared once saved", async () => {
    render(<ComicsPortal />);
    fireEvent.change(await openReview(), { target: { value: "Done now" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and mark reviewed" }));
    await waitFor(() => expect(methodCalls("PATCH")).toHaveLength(1));
    await settle();
    expect(loadReviewDraft(7, 0, "")).toBeNull();
    expect(loadReviewDraft(7, 0, "Done now")).toBeNull();
  });

  it("isn't restored over a description that has since changed", () => {
    saveReviewDraft(30, 1, { alt: "Typed", dialogue: [], baseAlt: "Old" });
    expect(loadReviewDraft(30, 1, "Old")?.alt).toBe("Typed");
    expect(loadReviewDraft(30, 1, "Another story's words")).toBeNull();
    clearReviewDraft(30, 1);
    expect(loadReviewDraft(30, 1, "Old")).toBeNull();
  });

  it("survives junk and blocked storage", () => {
    localStorage.setItem(reviewDraftKey(30, 1), "{not json");
    expect(loadReviewDraft(30, 1, "")).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(saveReviewDraft(30, 1, { alt: "x", dialogue: [], baseAlt: "" })).toBe(false);
    setItem.mockRestore();
  });

  it("stays out of backup files", () => {
    expect(isBackupKey(reviewDraftKey(30, 1))).toBe(false);
  });
});

describe("choosing a folder for an import", () => {
  const weeklyFolder = () =>
    [
      [`Batch/editorial/${SCRIPTS}`, "[]"],
      ["Batch/art/N001_P1.png", "x"],
    ].map(([path, body]) => {
      const file = new File([body], path.split("/").pop()!);
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      return file;
    });

  const choose = async (input: HTMLElement, files: File[]) => {
    fireEvent.change(input, { target: { files } });
    await screen.findByRole("button", { name: "Start the import" });
  };

  it("can be repeated with the same folder", async () => {
    h.auth = owner;
    render(<ImportClient />);
    const input = screen.getByLabelText("Choose the folder") as HTMLInputElement;
    const values: string[] = [];
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (v: string) => values.push(v),
    });
    await choose(input, weeklyFolder());
    expect(values).toContain("");
  });

  it("stays ready to try again after a dropped connection", async () => {
    h.auth = owner;
    const working = workingFetch();
    fetchSpy.mockImplementation(async () => {
      throw new Error("offline");
    });
    render(<ImportClient />);
    await choose(screen.getByLabelText("Choose the folder"), weeklyFolder());
    fireEvent.click(screen.getByRole("button", { name: "Start the import" }));
    expect(await screen.findByText(/No connection/)).toBeInTheDocument();
    expect(screen.queryByText(/Can.t import this/)).toBeNull();

    fetchSpy.mockImplementation(working);
    fireEvent.click(screen.getByRole("button", { name: "Start the import" }));
    await waitFor(() => expect(h.jobs).toHaveLength(1));
    expect(screen.queryByText(/No connection/)).toBeNull();
    // The rest of the run isn't the point: it started again.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => h.jobs[0].reject(new Error("stop")));
    await screen.findByRole("button", { name: "Run it again" });
  });
});

describe("the first release migration", () => {
  const sql = readFileSync("supabase/migrations/0031_comic_first_released.sql", "utf8");

  it("records the first release however a write goes, and never clears it", () => {
    expect(sql).toMatch(/before insert or update on public\.comic_stories/);
    expect(sql).toMatch(/new\.first_released_at := old\.first_released_at/);
    expect(sql).toMatch(/old\.release_at <= now\(\)/);
    expect(sql).toMatch(/new\.release_at <= now\(\)/);
  });

  it("backfills what's already out", () => {
    expect(sql).toMatch(/update public\.comic_stories\s+set first_released_at = release_at/);
  });

  it("keeps a once-released story out of the reorder under the lock", () => {
    const check = sql.slice(sql.indexOf("with locked as"), sql.indexOf("for update"));
    expect(check).toMatch(/first_released_at is null/);
    expect(check).toMatch(/release_at is null or release_at > now\(\)/);
  });

  it("stays closed to everyone but the service role", () => {
    expect(sql).toMatch(
      /revoke all on function public\.comic_reorder_queue[\s\S]*from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.comic_reorder_queue[\s\S]*to service_role/
    );
    expect(sql).toMatch(
      /revoke all on function public\.comic_stories_keep_first_release[\s\S]*from public, anon, authenticated/
    );
  });

  it("adds the column the owner routes read", () => {
    expect(sql).toMatch(/add column if not exists first_released_at timestamptz/);
  });
});
