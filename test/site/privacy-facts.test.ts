// @vitest-environment node
/**
 * The privacy page (/privacy) states facts about the site. Each one is checked
 * here against the place it comes from: the wording people are shown, the
 * limits the rooms enforce, the cookie lifetimes, the migrations, vercel.json,
 * lighthouserc.json and the middleware. If the site changes, a test here fails
 * until the page says the new thing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { WEATHER_TTL_S, round1 } from "@/lib/agent/mascot/context/weather-server";
import { EMPTY_GUESTBOOK_DRAFT } from "@/lib/comics/guestbook";
import { EMPTY_LICENCE_DRAFT } from "@/lib/comics/licence";
import { getToolById } from "@/lib/constants/tools";
import { PROVIDER_IDS, PROVIDER_META } from "@/lib/llm/registry";
import { VISITOR_LIMITS, VISITOR_TOOLS } from "@/lib/realtime/visitor-rooms";
import { CSP_HOSTS, cspDirective } from "@/lib/site/csp.mjs";
import {
  COUNT_DISCLOSURE,
  GUESTBOOK_FORM_NOTE,
  LICENCE_FORM_NOTE,
  OWN_KEY_DISCLOSURE,
  STORY_COUNT_DISCLOSURE,
  VISITOR_AI_KEPT,
  VISITOR_AI_SENT,
  VISITOR_ROOM_CONSENT_TEXT,
  VOTE_ROOM_CONSENT_TEXT,
  YOUR_DATA_SAVED_HERE,
} from "@/lib/site/disclosures";
import { CONTACT_EMAIL, PRIVACY_PATH } from "@/lib/site/owner";
import {
  NO_ACCOUNT_LINE,
  RETENTION_LINE,
  accessibilityLines,
  hostingRegion,
  lighthouseGate,
  otherProcessors,
  ownKeyProviders,
  privacyRows,
  processors,
  securityChecks,
  securityHosts,
  type PrivacyRow,
} from "@/lib/site/privacy";
import { VIP_COOKIE_MAX_AGE } from "@/lib/vip/book-access";
import { VIP_HINT_MAX_AGE } from "@/lib/vip/constants";
import { middleware } from "@/middleware";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const row = (id: string): PrivacyRow => {
  const found = privacyRows().find((r) => r.id === id);
  if (!found) throw new Error(`no "${id}" row`);
  return found;
};
/** Everything a row says, in one string. */
const said = (r: PrivacyRow) => [...r.leaves, ...r.kept].map((item) => item.text).join(" ");
/** The site's own words a row quotes. */
const quoted = (r: PrivacyRow) =>
  [...r.leaves, ...r.kept].filter((item) => item.says).map((item) => item.text);

function flags(rooms: boolean, ai: boolean) {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", rooms ? "1" : "");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", ai ? "1" : "");
}

beforeEach(() => flags(true, true));
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the rows of the table", () => {
  it("has one row per part of the site, in reading order", () => {
    expect(privacyRows().map((r) => r.id)).toEqual([
      "tools",
      "comics-kudos",
      "weather",
      "rooms",
      "own-key",
      "amr-ai",
      "licence",
      "guestbook",
      "book-link",
      "squad-invite",
    ]);
  });

  it("leaves out live rooms and Amr's AI when this build has them off", () => {
    flags(false, false);
    const ids = privacyRows().map((r) => r.id);
    expect(ids).not.toContain("rooms");
    expect(ids).not.toContain("amr-ai");
    expect(ids).toHaveLength(8);
    flags(true, false);
    expect(privacyRows().map((r) => r.id)).toContain("rooms");
    expect(privacyRows().map((r) => r.id)).not.toContain("amr-ai");
    flags(false, true);
    expect(privacyRows().map((r) => r.id)).toContain("amr-ai");
    expect(privacyRows().map((r) => r.id)).not.toContain("rooms");
  });

  it("gives every row a name, when it applies, what leaves and what is kept", () => {
    const parts = privacyRows().map((r) => r.part);
    expect(new Set(parts).size).toBe(parts.length);
    for (const r of privacyRows()) {
      expect(r.when.trim(), r.id).not.toBe("");
      expect(r.leaves.length, r.id).toBeGreaterThan(0);
      expect(r.kept.length, r.id).toBeGreaterThan(0);
      for (const item of [...r.leaves, ...r.kept]) {
        expect(item.text, r.id).toMatch(/^[A-Z].*\.$/);
        expect(`${item.says ?? ""}${item.text}`, r.id).not.toMatch(/[—–]/);
        if (item.says) expect(item.says, r.id).toMatch(/:$/);
      }
    }
  });

  it("says only the choices are choices: the first three rows need none", () => {
    for (const r of privacyRows()) {
      const chosen = /^Only /.test(r.when);
      expect(chosen, r.id).toBe(!["tools", "comics-kudos", "weather"].includes(r.id));
    }
  });
});

describe("each row, against the site", () => {
  it("the tools: nothing leaves, in the words of Your data", () => {
    const tools = row("tools");
    expect(tools.leaves[0].text).toBe("Nothing you type or make.");
    expect(quoted(tools)).toEqual([`${YOUR_DATA_SAVED_HERE}.`]);
    expect(said(tools)).toContain("backup file");
    // A Share link keeps the copy in the part after #, which a browser never sends.
    expect(said(tools)).toContain(
      "after the # sign, and browsers never send that part to a server"
    );
    const snapshot = read("src/lib/share/snapshot.ts");
    expect(snapshot).toContain("the URL *fragment* (`/s#s1.<payload>`)");
    expect(snapshot).toContain("Browsers never send the fragment");
  });

  it("comics and kudos: the two count notes, word for word, and where the pictures load from", () => {
    const comics = row("comics-kudos");
    expect(quoted(comics)).toEqual([COUNT_DISCLOSURE, STORY_COUNT_DISCLOSURE]);
    expect(said(comics)).toContain("load from the site's storage at Supabase");
    expect(comics.kept[0].text).toContain("no cookies, no account and no IP address");
    // The pictures' address is the Supabase project's public storage.
    expect(read("src/lib/comics/images.ts")).toContain("/storage/v1/object/public/");
    // The count adds to a month's total and keeps nothing else. The comment
    // says so; privacy-kept.test.ts proves it from the route and the table.
    expect(read("src/app/api/comics/hit/route.ts")).toContain(
      "No IP address or user agent reaches the database"
    );
  });

  it("Amr's weather: a rounded place, not stored, one answer reused for the area", () => {
    const weather = row("weather");
    expect(said(weather)).toContain("rounds it to about 11 km");
    // A tenth of a degree of latitude is about 11 km.
    expect(round1(30.0444)).toBe(30);
    expect(Math.round(0.1 * 111.32)).toBe(11);
    expect(WEATHER_TTL_S).toBe(900);
    expect(said(weather)).toContain("for 15 minutes");
    // The module's own account; privacy-kept.test.ts calls the route and
    // checks what it logs, asks Open-Meteo and answers.
    const server = read("src/lib/agent/mascot/context/weather-server.ts");
    expect(server).toContain("It isn't logged,");
    expect(server).toContain("stored or sent back");
    // The browser sends nothing with the request.
    expect(read("src/lib/agent/mascot/context/weather.ts")).toContain(
      'fetch("/api/mascot/weather", { signal: opts.signal })'
    );
  });

  it("live rooms and vote rounds: both consent texts, the tools and the limits", () => {
    const rooms = row("rooms");
    expect(quoted(rooms)).toEqual([VISITOR_ROOM_CONSENT_TEXT, VOTE_ROOM_CONSENT_TEXT]);
    for (const id of VISITOR_TOOLS) expect(said(rooms), id).toContain(getToolById(id)!.name);
    expect(said(rooms)).toContain("Live rooms run in Planning Poker and Retro Board.");
    expect(VISITOR_LIMITS.maxMembers).toBe(20);
    expect(VISITOR_LIMITS.hardTtlMs).toBe(3 * 60 * 60 * 1000);
    expect(said(rooms)).toContain("up to 20 people and closes after 3 hours at most");
    expect(said(rooms)).toContain("nothing in it is written to a database");
    expect(read("RUNBOOK.md")).toContain("Nothing is written to a database");
  });

  it("AI with your own key: the providers by the names AI settings gives them", () => {
    const ownKey = row("own-key");
    expect(ownKeyProviders()).toEqual(PROVIDER_IDS.map((id) => PROVIDER_META[id].name));
    expect(ownKeyProviders()).toHaveLength(4);
    expect(ownKey.leaves[0].text).toBe(
      "Your prompts, with any tool data they include, go to the provider you chose: Claude, OpenAI, Gemini or GLM (Zhipu)."
    );
    expect(quoted(ownKey)).toEqual([OWN_KEY_DISCLOSURE]);
    expect(said(ownKey)).toContain("a backup file never includes it");
    expect(read("src/components/data/your-data-dialog.tsx")).toContain(
      "Your AI API keys are never"
    );
  });

  it("Amr's AI: what its card says is sent and kept, and the 30-day totals", () => {
    const ai = row("amr-ai");
    expect(quoted(ai)).toEqual([VISITOR_AI_SENT, VISITOR_AI_KEPT]);
    expect(said(ai)).toContain("kept for 30 days");
    const migration = read("supabase/migrations/0037_visitor_ai_usage.sql");
    expect(migration).toMatch(
      /visitor_ai_daily\s+site-wide totals per Cairo day, no identifiers; 30 days\./
    );
  });

  it("the licence form: every field it asks for, and nothing about the browser", () => {
    const licence = row("licence");
    const fields = Object.keys(EMPTY_LICENCE_DRAFT);
    expect(fields).toEqual(["name", "company", "email", "intendedUse", "teamSize", "message"]);
    expect(licence.leaves[0].text).toBe(
      "What you type: your name, your company, your work email, how you would use the comic, your team's size and your message."
    );
    expect(said(licence)).toContain("No IP address and nothing about your browser.");
    // The line under the form says the same, and the row quotes it.
    expect(quoted(licence)).toEqual([LICENCE_FORM_NOTE]);
    // The table's comment agrees; privacy-kept.test.ts holds its columns and
    // the row the route writes.
    expect(read("supabase/migrations/0029_comic_stories.sql")).toContain(
      "Licence requests from /comics/license, read only by the owner through server code. No IP address or user agent is stored."
    );
  });

  it("the guestbook: the name and the note, shown once approved", () => {
    const guestbook = row("guestbook");
    expect(Object.keys(EMPTY_GUESTBOOK_DRAFT)).toEqual(["name", "message"]);
    expect(guestbook.leaves[0].text).toBe("What you type: the name and the note.");
    expect(said(guestbook)).toContain(
      "Your name and your note show on the guestbook once Amr has approved them."
    );
    // The name is public, not only the note: the form says so beside the field,
    // the page's read fetches it, and the page prints it under each note.
    expect(read("src/app/(tools)/comics/guestbook/guestbook-form.tsx")).toMatch(
      /<Field label="Your name" hint="Shown with your note\."/
    );
    expect(read("src/lib/comics/guestbook-store.ts")).toContain('.select("id,name,message")');
    expect(read("src/app/(tools)/comics/guestbook/page.tsx")).toContain("{note.name}</p>");
    expect(quoted(guestbook)).toEqual([GUESTBOOK_FORM_NOTE]);
    // Likewise: the comment here, the columns and the row in privacy-kept.test.ts.
    expect(read("supabase/migrations/0033_comic_guestbook_quiz.sql")).toContain(
      "shown only once the owner approves them. Read and written by server code only. No IP address or user agent is stored."
    );
  });

  it("the book's link: two cookies, for as long as the cookies last", () => {
    const book = row("book-link");
    expect(VIP_COOKIE_MAX_AGE).toBe(400 * 24 * 60 * 60);
    expect(VIP_HINT_MAX_AGE).toBe(VIP_COOKIE_MAX_AGE);
    expect(said(book)).toContain("two cookies for up to 400 days");
    const route = read("src/app/vip/[key]/route.ts");
    expect(route.match(/response\.cookies\.set\(/g)).toHaveLength(2);
    // privacy-kept.test.ts opens the link and checks the count and the cookies.
    expect(route).toContain("No key, cookie or IP");
  });

  it("a squad invite: one cookie, for up to a year", () => {
    const squad = row("squad-invite");
    expect(said(squad)).toContain("One cookie keeps you joined for up to a year.");
    expect(read("src/lib/auth/guest-session.ts")).toContain(
      "const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;"
    );
    expect(read("src/app/api/guest/redeem/route.ts")).toContain(
      "POST { code, displayName, color }"
    );
  });
});

describe("how long the forms' rows are kept", () => {
  const migrations = readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: read(`supabase/migrations/${name}`) }));

  it("says exactly that nothing deletes them today", () => {
    expect(RETENTION_LINE).toBe(
      "Licence requests and guestbook notes are kept until someone asks for them to be removed, because nothing deletes them automatically today."
    );
    for (const id of ["licence", "guestbook"]) {
      expect(said(row(id)), id).toContain("Kept until you ask for it to be removed.");
    }
    // And so do the lines under the two forms.
    expect(LICENCE_FORM_NOTE).toContain("until you ask us to remove it.");
    expect(GUESTBOOK_FORM_NOTE).toContain("until you ask us to remove them.");
  });

  // If a purge is ever added, this fails: the page must then state the period.
  it("is true: no migration deletes from either table or schedules it", () => {
    expect(migrations.length).toBeGreaterThan(30);
    for (const { name, sql } of migrations) {
      const statements = sql.replace(/--.*$/gm, "");
      expect(statements, name).not.toMatch(
        /delete\s+from\s+(?:public\.)?(?:comic_licence_requests|comic_guestbook)\b/i
      );
    }
  });
});

describe("who processes what, and where", () => {
  it("takes the hosting region from vercel.json", () => {
    const config = JSON.parse(read("vercel.json")) as { regions: string[] };
    expect(config.regions).toEqual(["fra1"]);
    expect(hostingRegion()).toEqual({ code: "fra1", place: "Frankfurt, Germany" });
    const [vercel] = processors();
    expect(vercel.name).toBe("Vercel");
    expect(vercel.does).toContain(
      "Its serverless functions run in Frankfurt, Germany (Vercel region fra1)."
    );
    expect(vercel.does).toContain("receives your IP address");
  });

  // vercel.json's region covers serverless functions only. The middleware and
  // any route on the edge runtime run near whoever makes the request, so the
  // page names each one. A new edge route, or one pinned to a region, fails
  // here until the Vercel line is reviewed.
  it("says which server code runs on the edge, not in that region", () => {
    const [vercel] = processors();
    expect(vercel.does).toContain("run on Vercel's edge network, close to wherever the request");
    const EDGE: Record<string, string> = {
      "src/app/og/tools/[id]/route.tsx": "the tools' share images",
      "src/app/api/agent/stream/route.ts": "the owner's AI stream",
    };
    const files = sourceFiles(path.join(root, "src")).map((file) => ({
      file: path.relative(root, file).replace(/\\/g, "/"),
      text: readFileSync(file, "utf8"),
    }));
    const edge = files
      .filter(({ text }) =>
        /export\s+const\s+runtime\s*=\s*["'](?:experimental-)?edge["']/.test(text)
      )
      .map(({ file }) => file)
      .sort();
    expect(edge).toEqual(Object.keys(EDGE).sort());
    for (const [file, words] of Object.entries(EDGE)) expect(vercel.does, file).toContain(words);
    // Nothing asks for a region of its own.
    expect(files.filter(({ text }) => /\bpreferredRegion\b/.test(text))).toEqual([]);
    // Next 14's middleware always runs on the edge: nothing switches it to Node.
    expect(vercel.does).toContain("The middleware that checks each request");
    const middleware = read("src/middleware.ts");
    expect(middleware).toContain("export async function middleware(");
    expect(middleware.slice(middleware.indexOf("export const config"))).not.toMatch(/runtime/);
    // vercel.json moves no function to another region.
    expect(Object.keys(JSON.parse(read("vercel.json")))).not.toContain("functions");
  });

  it("names Supabase for the database, storage and realtime, with no region it can't prove", () => {
    const [, supabase] = processors();
    expect(processors()).toHaveLength(2);
    expect(supabase.name).toBe("Supabase");
    for (const word of ["database", "storage", "realtime"]) {
      expect(supabase.does).toContain(word);
    }
    expect(supabase.does).not.toMatch(/region|Frankfurt|Ireland|Europe|\b[a-z]{2}-[a-z]+-\d\b/i);
  });

  it("names live rooms among what Supabase carries only while live rooms are on", () => {
    expect(processors()[1].does).toContain("the realtime channels live rooms pass through.");
    flags(false, true);
    expect(processors()[1].does).not.toMatch(/live room|vote round/i);
    expect(processors()[1].does).toContain(
      "the realtime channels the owner's devices and invited squad guests sync over."
    );
    // Without the flag only the owner and a squad guest may open a channel.
    expect(read("src/lib/realtime/use-realtime-allowed.ts")).toContain(
      "if (isOwner || guest !== null) return true;"
    );
  });

  it("names the AI message counts among what Supabase holds only while Amr's AI is on", () => {
    expect(processors()[1].does).toContain("the daily message counts for Amr's AI");
    expect(read("supabase/migrations/0037_visitor_ai_usage.sql")).toContain("visitor_ai_usage");
    flags(true, false);
    expect(processors()[1].does).not.toContain("Amr's AI");
  });

  it("names the others only where a row uses them", () => {
    expect(otherProcessors()).toContain("Open-Meteo");
    expect(otherProcessors()).toContain("Z.AI");
    flags(true, false);
    expect(otherProcessors()).not.toContain("Z.AI");
    expect(otherProcessors()).toBe(
      "Others take part only where the table above says so: Open-Meteo for the weather, and the AI provider whose key you add."
    );
  });
});

describe("accessibility, in three lines", () => {
  it("states the Lighthouse gate as lighthouserc.json sets it", () => {
    const config = JSON.parse(read("lighthouserc.json"));
    const [level, options] = config.ci.assert.assertions["categories:accessibility"];
    expect(lighthouseGate()).toEqual({
      level,
      minScore: options.minScore,
      pages: config.ci.collect.url.length,
    });
    expect(lighthouseGate()).toEqual({ level: "error", minScore: 0.95, pages: 10 });
    expect(config.ci.collect.settings.formFactor).toBe("mobile");
    const [tested] = accessibilityLines();
    expect(tested.label).toBe("What is tested");
    expect(tested.text).toContain("at least 95 out of 100 on 10 public pages, measured as a phone");
    // It runs on changes proposed to the site.
    expect(read(".github/workflows/lighthouse.yml")).toMatch(/on:\s*\n\s*pull_request:/);
  });

  it("states the contrast test as it is written: 4.5 to 1 in three themes", () => {
    const test = read("test/design/theme-contrast.test.ts");
    for (const theme of ['["comic",', '["night",', '["high contrast",'])
      expect(test).toContain(theme);
    expect(test).toContain("4.5");
    expect(accessibilityLines()[0].text).toContain(
      "a contrast of at least 4.5 to 1 on the surfaces they sit on, in all three themes: Comic, Night and High contrast."
    );
  });

  it("says what is not tested, and where to report a problem", () => {
    const lines = accessibilityLines();
    expect(lines.map((line) => line.label)).toEqual([
      "What is tested",
      "What is not",
      "Where to report a problem",
    ]);
    expect(lines[1].text).toBe(
      "No test with a screen reader or other assistive technology is on record."
    );
    expect(lines[2].text).toContain(CONTACT_EMAIL);
  });
});

/** Every source file under `dir`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("for your security team", () => {
  it("lists four checks, with the script rule quoted from the header itself", () => {
    const checks = securityChecks();
    expect(checks.map((check) => check.label)).toEqual([
      "No cookie on a first visit",
      "No third-party script",
      "A tool page loads nothing from elsewhere",
      "See it in the Network tab",
    ]);
    expect(checks[1].text).toContain(cspDirective("script-src"));
    expect(checks[1].text).toContain("script-src 'self' 'unsafe-inline'");
    expect(NO_ACCOUNT_LINE).toMatch(/^There is no account,/);
    for (const check of checks) expect(check.text).not.toMatch(/[—–]/);
  });

  it("is right that a first visit sets no cookie: a page passes with none", async () => {
    for (const pathname of ["/", "/retro", PRIVACY_PATH]) {
      const res = await middleware(new NextRequest(`https://agile.amrelharony.com${pathname}`));
      expect(res.status, pathname).toBe(200);
      expect(res.headers.get("set-cookie"), pathname).toBeNull();
    }
  });

  // The page names three cases. Every file that can set a cookie belongs to one.
  it("is right that a cookie is set in three cases only", () => {
    const CASES: Record<string, "owner" | "book" | "squad"> = {
      "src/app/vip/[key]/route.ts": "book",
      "src/lib/vip/hint.ts": "book",
      "src/lib/auth/guest-session.ts": "squad",
      // Removes a leftover squad cookie; the rest hands on the owner's session.
      "src/middleware.ts": "owner",
      "src/lib/auth/require-user.ts": "owner",
      "src/lib/auth/supabase-server.ts": "owner",
      "src/lib/auth/sign-out.ts": "owner",
    };
    const setters = sourceFiles(path.join(root, "src"))
      .filter((file) =>
        /cookieStore\.set\(|\.cookies\.set\(|document\.cookie\s*=/.test(readFileSync(file, "utf8"))
      )
      .map((file) => path.relative(root, file).replace(/\\/g, "/"))
      .sort();
    expect(setters).toEqual(Object.keys(CASES).sort());
    expect(new Set(Object.values(CASES))).toEqual(new Set(["owner", "book", "squad"]));
    expect(securityChecks()[0].text).toContain(
      "three cases only: the owner signing in, the link printed in the book, and a squad invite code"
    );
  });

  it("lists the policy's hosts as the header has them, with live-room wording only while rooms are on", () => {
    const strip = ({ source, directives, who, reach }: (typeof CSP_HOSTS)[number]) => ({
      source,
      directives,
      who,
      reach,
    });
    expect(securityHosts().map(strip)).toEqual(CSP_HOSTS.map(strip));
    const roomy = /live room|vote round/i;
    // Rooms on: a host with live-room wording shows it.
    const withRooms = securityHosts();
    CSP_HOSTS.forEach((host, i) => {
      expect(withRooms[i].when, host.source).toBe(host.whenRooms ?? host.when);
      // The wording that is always shown never names a feature that can be off.
      expect(host.when, host.source).not.toMatch(roomy);
      expect(host.when, host.source).not.toContain("Amr's AI");
      expect(host.whenRooms ?? "", host.source).not.toContain("Amr's AI");
    });
    expect(withRooms.filter((host) => roomy.test(host.when)).map((host) => host.source)).toEqual([
      "https://*.supabase.co",
      "wss://*.supabase.co",
    ]);
    flags(false, false);
    expect(securityHosts().map((host) => host.when)).toEqual(CSP_HOSTS.map((host) => host.when));
    expect(securityHosts().some((host) => roomy.test(host.when))).toBe(false);
  });

  it("is right that the weather request is the one Amr makes, and that it has no body", () => {
    expect(securityChecks()[3].text).toContain("/api/mascot/weather");
    expect(read("src/app/api/mascot/weather/route.ts")).toContain("export async function GET(");
    expect(read("src/app/api/mascot/weather/route.ts")).not.toContain(
      "export async function POST("
    );
  });
});
