/**
 * The visit recorder on /comics, an episode's page and /kudos: one count per
 * arrival, a printed piece's `src` tidied away after it, and nothing kept in
 * the browser.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import {
  VisitRecorder,
  forgetCountedVisits,
  recordVisit,
} from "@/components/visits/visit-recorder";
import type { Visit, VisitPath } from "@/lib/comics/visits";

const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);

let navigation: { type: string; name: string } | null;
let referrer = "";

/** What each beacon sent, read back as the JSON it carried. */
async function sent(): Promise<{ url: string; visit: Visit }[]> {
  return Promise.all(
    beacon.mock.calls.map(async ([url, body]) => ({
      url,
      visit: JSON.parse(await body.text()) as Visit,
    }))
  );
}

/** Open `address` as this document's first page, the way a scan or a typed URL does. */
function arrive(address: string, type = "navigate") {
  window.history.replaceState(null, "", address);
  navigation = { type, name: new URL(address, window.location.origin).href };
}

/** A client navigation: the same document, a new address. */
function go(address: string) {
  window.history.pushState(null, "", address);
}

const here = () => window.location.pathname + window.location.search + window.location.hash;
const record = (path: VisitPath) => recordVisit(path, new URLSearchParams(window.location.search));

beforeEach(() => {
  forgetCountedVisits();
  beacon.mockClear();
  navigation = null;
  referrer = "";
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  vi.spyOn(performance, "getEntriesByType").mockImplementation(
    () => (navigation ? [navigation] : []) as unknown as PerformanceEntryList
  );
  vi.spyOn(document, "referrer", "get").mockImplementation(() => referrer);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("a printed piece's address", () => {
  it("counts once, then loses src and the old b, keeping the episode and the hash", async () => {
    arrive("/comics?ep=05&src=poster#notes");
    record("/comics");
    expect(await sent()).toEqual([
      { url: "/api/comics/hit", visit: { path: "/comics", src: "poster", ep: 5 } },
    ]);
    expect(here()).toBe("/comics?ep=05#notes");

    // The tidied address is heard too, and it isn't another arrival.
    record("/comics");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("an old building poster counts as its episode's poster, and b goes", async () => {
    arrive("/comics?ep=12&b=3");
    record("/comics");
    expect((await sent())[0].visit).toEqual({ path: "/comics", src: "poster", ep: 12 });
    expect(here()).toBe("/comics?ep=12");
  });

  it("counts even on a reload, because the scan is what's counted and it's tidied after", async () => {
    // A reload of the untidied address only happens if tidying failed.
    arrive("/comics?src=book", "reload");
    record("/comics");
    expect((await sent())[0].visit).toEqual({ path: "/comics", src: "book", ep: 0 });
  });

  it("isn't counted twice when the page hears the same address again", () => {
    arrive("/kudos?src=sign");
    // Tidying failed, so the page hears the untidied address a second time.
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    record("/kudos");
    record("/kudos");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("from the comics' own button to /kudos counts after a plain arrival", async () => {
    arrive("/comics?ep=07");
    record("/comics");
    go("/kudos?ep=07&src=comics");
    record("/kudos");
    expect((await sent()).map((s) => s.visit)).toEqual([
      { path: "/comics", src: "none", ep: 7 },
      { path: "/kudos", src: "comics", ep: 7 },
    ]);
    expect(here()).toBe("/kudos?ep=07");
  });
});

describe("an address with no printed piece", () => {
  it("counts a fresh arrival from outside the site", async () => {
    referrer = "https://www.linkedin.com/";
    arrive("/comics?ep=140");
    record("/comics");
    expect((await sent())[0].visit).toEqual({ path: "/comics", src: "none", ep: 140 });
  });

  it("counts a typed address or a bookmark, which has no referrer", () => {
    arrive("/kudos");
    record("/kudos");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it.each(["reload", "back_forward"])("isn't counted on a %s", (type) => {
    arrive("/comics?ep=05", type);
    record("/comics");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("isn't counted when another page of the site sent the visitor", () => {
    referrer = `${window.location.origin}/retro`;
    arrive("/comics");
    record("/comics");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("isn't counted when the document began on another page", () => {
    arrive("/retro");
    go("/comics?ep=05");
    record("/comics");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("counts only the first page of a visit", () => {
    arrive("/comics");
    record("/comics");
    go("/comics?ep=05");
    record("/comics");
    go("/kudos");
    record("/kudos");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("falls back to the address when the browser has no navigation entry", () => {
    window.history.replaceState(null, "", "/comics");
    record("/comics");
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("the browser", () => {
  it("keeps nothing: no cookie and no storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    arrive("/comics?ep=05&src=kudos");
    record("/comics");
    arrive("/kudos?src=guide");
    record("/kudos");
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });

  it("is fine with no beacon at all", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    arrive("/comics?src=book");
    expect(() => record("/comics")).not.toThrow();
    expect(here()).toBe("/comics");
  });
});

describe("<VisitRecorder>", () => {
  it("counts the address the router hears, and tidies it", async () => {
    arrive("/comics?ep=09&src=kudos");
    render(
      <SearchParamsContext.Provider value={new URLSearchParams("ep=09&src=kudos")}>
        <VisitRecorder path="/comics" />
      </SearchParamsContext.Provider>
    );
    expect((await sent())[0].visit).toEqual({ path: "/comics", src: "kudos", ep: 9 });
    expect(here()).toBe("/comics?ep=09");
  });

  it("hears a client navigation to a printed piece's address", async () => {
    arrive("/kudos");
    const at = (q: string) => (
      <SearchParamsContext.Provider value={new URLSearchParams(q)}>
        <VisitRecorder path="/kudos" />
      </SearchParamsContext.Provider>
    );
    const { rerender } = render(at(""));
    go("/kudos?ep=03&src=comics");
    rerender(at("ep=03&src=comics"));
    expect((await sent()).map((s) => s.visit)).toEqual([
      { path: "/kudos", src: "none", ep: 0 },
      { path: "/kudos", src: "comics", ep: 3 },
    ]);
  });
});
