/**
 * /privacy, "What leaves your browser", as it is rendered: the table, the
 * contact address as text to copy, who processes what, the accessibility
 * lines and the security team's list of hosts. The facts themselves are
 * checked against the site in privacy-facts.test.ts; this holds the page to
 * showing them, and the list of hosts to the header the site is served with.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config.mjs";
import PrivacyPage, { dynamic, metadata } from "@/app/(meta)/privacy/page";
import { CSP_HOSTS } from "@/lib/site/csp.mjs";
import {
  COUNT_DISCLOSURE,
  GUESTBOOK_FORM_NOTE,
  LICENCE_FORM_NOTE,
  OWN_KEY_DISCLOSURE,
  STORY_COUNT_DISCLOSURE,
  TOOLS_STAY_FREE,
  VISITOR_AI_KEPT,
  VISITOR_AI_SENT,
  VISITOR_ROOM_CONSENT_TEXT,
  VOTE_ROOM_CONSENT_TEXT,
  YOUR_DATA_SAVED_HERE,
} from "@/lib/site/disclosures";
import { CONTACT_EMAIL, PRIVACY_PATH, PRIVACY_TITLE, SITE_OWNER } from "@/lib/site/owner";
import {
  NO_ACCOUNT_LINE,
  REACH_LABEL,
  RETENTION_LINE,
  accessibilityLines,
  otherProcessors,
  privacyRows,
  processors,
  securityChecks,
} from "@/lib/site/privacy";

const source = readFileSync(path.join(process.cwd(), "src/app/(meta)/privacy/page.tsx"), "utf8");

function flags(rooms: boolean, ai: boolean) {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", rooms ? "1" : "");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", ai ? "1" : "");
}

/** The page's first table: one row per part of the site. */
const partsTable = () =>
  screen.getByRole("table", {
    name: "What leaves your browser and what is kept, for each part of the site",
  });
/** Its second: the hosts the security policy allows. */
const hostsTable = () =>
  screen.getByRole("table", { name: "Every outside host the security policy allows" });

const rowHeaders = (table: HTMLElement) =>
  within(table)
    .getAllByRole("rowheader")
    .map((th) => th.firstChild?.textContent);

beforeEach(() => flags(true, true));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the privacy page", () => {
  it("is called What leaves your browser, in the tab and on the page", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What leaves your browser");
    expect(metadata.title).toBe("What leaves your browser");
    expect(PRIVACY_TITLE).toBe("What leaves your browser");
    expect(String(metadata.description)).toMatch(/^What the Agile Toolkit sends from your browser/);
    // The layout's template adds the site's name.
    expect(String(metadata.title)).not.toContain("Agile Toolkit");
  });

  it("lives at the address the links use", () => {
    expect(PRIVACY_PATH).toBe("/privacy");
    expect(existsSync(path.join(process.cwd(), "src/app/(meta)", PRIVACY_PATH, "page.tsx"))).toBe(
      true
    );
  });

  it("is static and rendered on the server, with no code of its own in the browser", () => {
    expect(dynamic).toBe("force-static");
    expect(source).not.toMatch(/^["']use client["']/m);
    const html = renderToString(<PrivacyPage />);
    expect(html).toContain("What leaves your browser");
    expect(html).toContain(CONTACT_EMAIL);
    expect(html).toContain("https://*.supabase.co");
  });

  it("adds no tracking or counting of its own", () => {
    expect(source).not.toMatch(
      /VisitRecorder|sendBeacon|fetch\(|useEffect|comics\/(?:hit|stats|taps)/
    );
  });

  it("is written plainly: no dash standing in for a comma", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.textContent).not.toMatch(/[—–]/);
    expect(container.textContent).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe("the table of parts", () => {
  it("has three columns and a row for every part, headed by the part's name", () => {
    render(<PrivacyPage />);
    const table = partsTable();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
    ).toEqual(["Part of the site", "What leaves your browser", "What is kept"]);
    expect(rowHeaders(table)).toEqual(privacyRows().map((row) => row.part));
    expect(rowHeaders(table)).toContain("Live rooms and vote rounds");
    expect(rowHeaders(table)).toContain("Amr's AI");
    // Each row: its header and two cells.
    for (const tr of within(table).getAllByRole("row").slice(1)) {
      expect(within(tr).getAllByRole("rowheader")).toHaveLength(1);
      expect(within(tr).getAllByRole("cell")).toHaveLength(2);
    }
  });

  it("shows everything each row says, and when the row applies", () => {
    render(<PrivacyPage />);
    const table = partsTable();
    for (const row of privacyRows()) {
      const tr = table.querySelector<HTMLElement>(`[data-row="${row.id}"]`)!;
      const [leaves, kept] = within(tr).getAllByRole("cell");
      expect(within(tr).getByRole("rowheader")).toHaveTextContent(row.when);
      for (const item of row.leaves) expect(leaves.textContent, row.id).toContain(item.text);
      for (const item of row.kept) expect(kept.textContent, row.id).toContain(item.text);
    }
  });

  it("quotes the site's own words, each under where the site shows them", () => {
    render(<PrivacyPage />);
    const quotes = Array.from(partsTable().querySelectorAll("figure")).map((figure) => ({
      says: figure.querySelector("figcaption")?.textContent,
      text: figure.querySelector("blockquote")?.textContent,
    }));
    expect(quotes.map((q) => q.text)).toEqual([
      `${YOUR_DATA_SAVED_HERE}.`,
      COUNT_DISCLOSURE,
      STORY_COUNT_DISCLOSURE,
      VISITOR_ROOM_CONSENT_TEXT,
      VOTE_ROOM_CONSENT_TEXT,
      OWN_KEY_DISCLOSURE,
      VISITOR_AI_SENT,
      VISITOR_AI_KEPT,
      LICENCE_FORM_NOTE,
      GUESTBOOK_FORM_NOTE,
    ]);
    for (const quote of quotes) expect(quote.says).toMatch(/:$/);
  });

  it("drops the live-room and Amr's AI rows when this build has them off", () => {
    flags(false, false);
    const { container } = render(<PrivacyPage />);
    const parts = rowHeaders(partsTable());
    expect(parts).not.toContain("Live rooms and vote rounds");
    expect(parts).not.toContain("Amr's AI");
    expect(parts).toHaveLength(8);
    expect(container.textContent).not.toContain(VISITOR_ROOM_CONSENT_TEXT);
    expect(container.textContent).not.toContain(VISITOR_AI_SENT);
    expect(container.textContent).not.toContain("Z.AI for his AI");
  });

  it("names each column above its cell for the stacked rows, without saying it twice aloud", () => {
    render(<PrivacyPage />);
    const tr = partsTable().querySelector<HTMLElement>('[data-row="tools"]')!;
    const labels = Array.from(tr.querySelectorAll("[aria-hidden='true']"));
    expect(labels.map((el) => el.textContent)).toEqual([
      "What leaves your browser",
      "What is kept",
    ]);
    for (const label of labels) expect(label.className).toContain("md:hidden");
    // The real header row is hidden from sight below md, never from a screen reader.
    const thead = partsTable().querySelector("thead")!;
    expect(thead.className).toContain("max-md:sr-only");
    expect(thead.className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
  });
});

describe("who runs the site, and how to reach him", () => {
  it("names the owner with the link the sidebar uses", () => {
    render(<PrivacyPage />);
    const link = screen.getByRole("link", { name: SITE_OWNER.name });
    expect(link).toHaveAttribute("href", SITE_OWNER.url);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the contact address as text a person can select and copy", () => {
    const { container } = render(<PrivacyPage />);
    const address = container.querySelector<HTMLElement>("[data-contact-address]")!;
    expect(address.textContent).toBe(CONTACT_EMAIL);
    expect(address.closest("a")).toBeNull();
    expect(address.className).toContain("select-all");
    // Nothing on the page makes the address a mail link.
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("says how long the forms' rows are kept, beside the contact", () => {
    const { container } = render(<PrivacyPage />);
    const contact = container.querySelector<HTMLElement>("#contact")!;
    expect(contact.textContent).toContain(CONTACT_EMAIL);
    expect(contact.textContent).toContain(RETENTION_LINE);
    expect(contact.textContent).toContain("To have yours removed, write to the address above.");
  });

  it("says who processes what, and where", () => {
    const { container } = render(<PrivacyPage />);
    for (const processor of processors()) {
      expect(screen.getByText(processor.name, { selector: "dt" })).toBeInTheDocument();
      expect(container.textContent).toContain(processor.does);
    }
    expect(container.textContent).toContain("Frankfurt, Germany (Vercel region fra1)");
    expect(container.textContent).toContain(otherProcessors());
  });
});

describe("free, and tested for accessibility", () => {
  it("says the tools stay free, in the licence page's words", () => {
    const { container } = render(<PrivacyPage />);
    expect(TOOLS_STAY_FREE).toBe("The tools on this site stay free.");
    expect(container.querySelector("#accessibility")!.textContent).toContain(TOOLS_STAY_FREE);
  });

  it("gives accessibility three lines: tested, not tested, where to report", () => {
    const { container } = render(<PrivacyPage />);
    const section = container.querySelector<HTMLElement>("#accessibility")!;
    const terms = Array.from(section.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(accessibilityLines().map((line) => line.label));
    expect(terms).toHaveLength(3);
    for (const line of accessibilityLines()) expect(section.textContent).toContain(line.text);
  });
});

describe("for your security team", () => {
  it("lists the four checks and why there is nothing to manage", () => {
    const { container } = render(<PrivacyPage />);
    const section = container.querySelector<HTMLElement>("#security")!;
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    securityChecks().forEach((check, i) => {
      expect(items[i].textContent).toBe(`${check.label}. ${check.text}`);
    });
    expect(section.textContent).toContain(NO_ACCOUNT_LINE);
  });

  it("lists every host on the shared list, with whose it is, who meets it and when", () => {
    render(<PrivacyPage />);
    const table = hostsTable();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
    ).toEqual(["Host", "Whose it is", "When it is used"]);
    expect(rowHeaders(table)).toEqual(CSP_HOSTS.map((host) => host.source));
    for (const host of CSP_HOSTS) {
      const tr = table.querySelector<HTMLElement>(`[data-host="${host.source}"]`)!;
      expect(within(tr).getByRole("rowheader").textContent, host.source).toBe(
        `${host.source}${host.directives.join(", ")}`
      );
      const [whose, when] = within(tr).getAllByRole("cell");
      expect(whose.textContent, host.source).toContain(host.who);
      expect(whose.textContent, host.source).toContain(REACH_LABEL[host.reach]);
      expect(when.textContent, host.source).toContain(host.when);
    }
  });

  // The pin: the page and the header can't drift. Every host in the header the
  // site is served with has a row, and every row is a host in that header.
  it("shows exactly the outside hosts in the header the site is served with", async () => {
    const rules = await nextConfig.headers!();
    const policy = rules
      .find((rule) => rule.source === "/(.*)")!
      .headers.find((header) => header.key === "Content-Security-Policy")!.value;
    const inHeader = new Set(
      policy
        .split("; ")
        .flatMap((directive) => directive.split(" ").slice(1))
        .filter((src) => /^(?:https|wss):\/\//.test(src))
    );
    expect(inHeader.size).toBeGreaterThan(10);

    render(<PrivacyPage />);
    const onPage = new Set(rowHeaders(hostsTable()));
    expect(Array.from(onPage).sort()).toEqual(Array.from(inHeader).sort());

    // And each row names the directives that host stands in, no more and no fewer.
    for (const host of CSP_HOSTS) {
      const allowedIn = policy
        .split("; ")
        .filter((directive) => directive.split(" ").slice(1).includes(host.source))
        .map((directive) => directive.split(" ")[0]);
      expect(host.directives, host.source).toEqual(allowedIn);
    }
  });

  it("says the list is built from the same file as the header", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByText(/This list is\s+built from the same file as the header/)
    ).toBeInTheDocument();
    expect(source).toContain('import { CSP_HOSTS } from "@/lib/site/csp.mjs";');
    expect(readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8")).toContain(
      'import { contentSecurityPolicy } from "./src/lib/site/csp.mjs";'
    );
  });
});

describe("the addresses", () => {
  it("sends /about and /contact to the page, for now", async () => {
    const redirects = await nextConfig.redirects!();
    for (const source of ["/about", "/contact"]) {
      expect(redirects).toContainEqual({ source, destination: PRIVACY_PATH, permanent: false });
    }
  });

  it("has no terms page, and no redirect pretending to be one", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects.some((r) => r.source.startsWith("/terms"))).toBe(false);
    for (const group of ["", "(meta)/", "(tools)/"]) {
      expect(existsSync(path.join(process.cwd(), "src/app", `${group}terms`)), group).toBe(false);
    }
  });

  it("is a page of its own, with nothing at /about or /contact to shadow the redirect", () => {
    expect(existsSync(path.join(process.cwd(), "src/app/(meta)/privacy/page.tsx"))).toBe(true);
    for (const name of ["about", "contact"]) {
      for (const group of ["", "(meta)/", "(tools)/"]) {
        expect(existsSync(path.join(process.cwd(), "src/app", `${group}${name}`)), name).toBe(
          false
        );
      }
    }
  });
});
