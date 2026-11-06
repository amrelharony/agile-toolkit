// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://agile.test";
const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type FakeRequest = { method: string; url: string; mode: string };
type FakePage = { name: string; ok: true; type: "basic"; headers: Headers; clone(): FakePage };
type FetchEvent = {
  request: FakeRequest;
  respondWith(answer: Promise<FakePage | Response>): void;
};

const page = (name: string): FakePage => ({
  name,
  ok: true,
  type: "basic",
  headers: new Headers(),
  clone() {
    return this;
  },
});

const withoutQuery = (url: string) => url.split("?")[0];

/** Runs the real worker file against an in-memory Cache with the browser's match rules. */
function loadWorker() {
  const stored = new Map<string, FakePage>();
  /** Like the real Cache, a key is a request or its URL. */
  const urlOf = (key: FakeRequest | string) => (typeof key === "string" ? key : key.url);
  const cache = {
    put: async (key: FakeRequest | string, response: FakePage) => {
      stored.set(urlOf(key), response);
    },
    keys: async () => Array.from(stored.keys()),
    delete: async (url: string) => stored.delete(url),
    match: async (key: FakeRequest | string, options?: { ignoreSearch?: boolean }) => {
      const wanted = urlOf(key);
      if (!options?.ignoreSearch) return stored.get(wanted);
      const url = Array.from(stored.keys()).find(
        (saved) => withoutQuery(saved) === withoutQuery(wanted)
      );
      return url === undefined ? undefined : stored.get(url);
    },
  };
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: FetchEvent) => void) => {
      listeners.set(type, listener);
    },
  };
  const network = vi.fn<(request: FakeRequest) => Promise<FakePage>>();
  new Function("self", "caches", "fetch", SOURCE)(self, { open: async () => cache }, network);

  const navigate = (path: string) => {
    let answer: Promise<FakePage | Response> | undefined;
    listeners.get("fetch")!({
      request: { method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" },
      respondWith: (a) => {
        answer = a;
      },
    });
    return answer!;
  };

  return {
    visit: async (path: string) => {
      network.mockResolvedValueOnce(page(path));
      await navigate(path);
    },
    offline: async (path: string) => {
      network.mockRejectedValueOnce(new TypeError("offline"));
      return navigate(path);
    },
  };
}

const isOfflinePage = (answer: FakePage | Response) =>
  answer instanceof Response && answer.status === 503;

describe("the service worker with no connection", () => {
  it("shows the offline page for a comic this device hasn't opened", async () => {
    const worker = loadWorker();
    await worker.visit("/comics?ep=05&src=poster");
    expect(isOfflinePage(await worker.offline("/comics?ep=12&src=kudos"))).toBe(true);
  });

  it("gives a comic its own saved copy", async () => {
    const worker = loadWorker();
    await worker.visit("/comics?ep=05&src=poster");
    await worker.visit("/comics?ep=12&src=kudos");
    expect(await worker.offline("/comics?ep=05&src=poster")).toMatchObject({
      name: "/comics?ep=05&src=poster",
    });
    expect(await worker.offline("/comics?ep=12&src=kudos")).toMatchObject({
      name: "/comics?ep=12&src=kudos",
    });
  });

  it("finds a scanned comic under its tidied address", async () => {
    const worker = loadWorker();
    await worker.visit("/comics?ep=05&src=poster");
    expect(await worker.offline("/comics?ep=05")).toMatchObject({
      name: "/comics?ep=05&src=poster",
    });
  });

  it("finds the gallery opened from an open kudos card at plain /comics", async () => {
    const worker = loadWorker();
    await worker.visit("/comics?src=kudos");
    expect(await worker.offline("/comics")).toMatchObject({ name: "/comics?src=kudos" });
  });

  it("keeps the gallery and a single story apart", async () => {
    const storyOnly = loadWorker();
    await storyOnly.visit("/comics?ep=30");
    expect(isOfflinePage(await storyOnly.offline("/comics"))).toBe(true);

    const galleryOnly = loadWorker();
    await galleryOnly.visit("/comics");
    expect(isOfflinePage(await galleryOnly.offline("/comics?ep=30"))).toBe(true);
  });

  it("still treats a query as page state on every other route", async () => {
    const worker = loadWorker();
    await worker.visit("/comics/license");
    await worker.visit("/planning-poker?room=a");
    expect(await worker.offline("/planning-poker?room=b")).toMatchObject({
      name: "/planning-poker?room=a",
    });
    expect(await worker.offline("/comics/license?from=story")).toMatchObject({
      name: "/comics/license",
    });
  });
});
