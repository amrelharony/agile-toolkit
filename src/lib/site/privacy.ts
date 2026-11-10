/**
 * The facts on the privacy page (/privacy, "What leaves your browser"), as
 * data: one row per part of the site, who processes what, what is tested for
 * accessibility, and what a security team can check.
 *
 * Wherever the site already tells people something at the moment it matters
 * (lib/site/disclosures.ts), a row quotes those words, not a copy. Numbers
 * come from where they are set: the room limits, the weather cache, the cookie
 * lifetime, vercel.json and lighthouserc.json. A row for a feature this build
 * has switched off is left out, so the page never describes what isn't there.
 *
 * Read on the server (the page is static). Flags are read on every call, not
 * cached, so tests can stub them. test/site/privacy-facts.test.ts checks each
 * fact against the code it describes.
 */

import lighthouse from "../../../lighthouserc.json";
import vercel from "../../../vercel.json";
import { WEATHER_TTL_S } from "@/lib/agent/mascot/context/weather-server";
import { getToolById } from "@/lib/constants/tools";
import type { GuestbookField } from "@/lib/comics/guestbook";
import type { LicenceField } from "@/lib/comics/licence";
import { PROVIDER_IDS, PROVIDER_META } from "@/lib/llm/registry";
import {
  VISITOR_LIMITS,
  VISITOR_ROOM_KIND,
  VISITOR_TOOLS,
  visitorRoomsEnabled,
  type VisitorRoomKind,
} from "@/lib/realtime/visitor-rooms";
import { cspDirective } from "@/lib/site/csp.mjs";
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
import { CONTACT_EMAIL } from "@/lib/site/owner";
import { VIP_COOKIE_MAX_AGE } from "@/lib/vip/book-access";
import { visitorAiEnabled } from "@/lib/visitor-ai/contract";

/**
 * One thing a cell says. With `says`, the text is the site's own words, quoted
 * from where it shows them, and `says` names that place.
 */
export interface PrivacyItem {
  text: string;
  says?: string;
}

/** One part of the site. */
export interface PrivacyRow {
  id: string;
  part: string;
  /** When this row applies to someone: always, or only after a choice. */
  when: string;
  leaves: PrivacyItem[];
  kept: PrivacyItem[];
}

/** "A", "A and B", "A, B and C" (or "or" in place of "and"). */
function listOf(names: readonly string[], last: "and" | "or" = "and"): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${last} ${names[names.length - 1]}`;
}

/** The names of the tools that run a live room of one of these kinds. */
function roomTools(...kinds: VisitorRoomKind[]): string[] {
  return VISITOR_TOOLS.filter((id) => kinds.includes(VISITOR_ROOM_KIND[id])).map(
    (id) => getToolById(id)?.name ?? id
  );
}

/**
 * What the licence form asks for, in the form's order. Keyed by the form's own
 * fields, so a new field can't be added without saying here what it is.
 */
const LICENCE_FIELDS: Record<LicenceField, string> = {
  name: "your name",
  company: "your company",
  email: "your work email",
  intendedUse: "how you would use the comic",
  teamSize: "your team's size",
  message: "your message",
};

/** The same for the guestbook. */
const GUESTBOOK_FIELDS: Record<GuestbookField, string> = {
  name: "the name",
  message: "the note",
};

/** How long the forms' rows stay: nothing deletes them on a timer today. */
const KEPT_UNTIL_ASKED = "Kept until you ask for it to be removed.";

const days = (seconds: number) => Math.round(seconds / 86_400);

/** The AI providers a visitor's own key can use, by the names AI settings gives them. */
export function ownKeyProviders(): string[] {
  return PROVIDER_IDS.map((id) => PROVIDER_META[id].name);
}

/**
 * The table: one row per part of the site. Live rooms and Amr's AI appear only
 * when this build has them on.
 */
export function privacyRows(): PrivacyRow[] {
  const rows: PrivacyRow[] = [
    {
      id: "tools",
      part: "The tools",
      when: "Always",
      leaves: [
        { text: "Nothing you type or make." },
        {
          says: 'Behind "Saved in this browser", beside every tool\'s title, the site says:',
          text: `${YOUR_DATA_SAVED_HERE}.`,
        },
        {
          text: "A Share link carries a read-only copy inside the link itself, after the # sign, and browsers never send that part to a server.",
        },
      ],
      kept: [
        {
          text: 'Nothing on our side. Your work stays in this browser until you clear its site data. "Saved in this browser" gives you a backup file to keep.',
        },
      ],
    },
    {
      id: "comics-kudos",
      part: "Comics and kudos pages",
      when: "When you open one",
      leaves: [
        {
          says: "Under the comics page, each book episode and the kudos page, the site says:",
          text: COUNT_DISCLOSURE,
        },
        { says: "Under each weekly story:", text: STORY_COUNT_DISCLOSURE },
        {
          text: "The pictures on these pages, the comic banner on the home page and kudos cards load from the site's storage at Supabase, so your browser asks that host for them.",
        },
      ],
      kept: [
        {
          text: "Totals only: arrivals for each month, page, printed piece and episode, and each weekly story's totals. Nothing about you: no cookies, no account and no IP address.",
        },
      ],
    },
    {
      id: "weather",
      part: "Amr's weather",
      when: "When Amr appears on a page",
      leaves: [
        {
          text: "A request with nothing in it. Amr, the character in the corner, asks this site what the weather is like where you are. The site takes the rough place Vercel works out from your IP address, rounds it to about 11 km, and asks Open-Meteo for the weather there.",
        },
      ],
      kept: [
        {
          text: `Nothing about you. The place is not stored or logged, and only the weather comes back. One answer is reused for everyone in that area for ${Math.round(WEATHER_TTL_S / 60)} minutes.`,
        },
      ],
    },
  ];

  if (visitorRoomsEnabled()) {
    const hours = Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000);
    rows.push({
      id: "rooms",
      part: "Live rooms and vote rounds",
      when: "Only if you start or join one",
      leaves: [
        {
          text: `What you type in the room, once you have given a name and ticked the consent box. Live rooms run in ${listOf(roomTools("poker", "retro"))}. Vote rounds run in ${listOf(roomTools("vote"))}.`,
        },
        { says: "Before a live room opens, the site says:", text: VISITOR_ROOM_CONSENT_TEXT },
        { says: "Before a vote round:", text: VOTE_ROOM_CONSENT_TEXT },
      ],
      kept: [
        {
          text: `Nothing by us. A room is a Supabase Realtime channel, and nothing in it is written to a database. The host's own browser keeps the board, or a vote round's totals. A room holds up to ${VISITOR_LIMITS.maxMembers} people and closes after ${hours} hours at most.`,
        },
      ],
    });
  }

  rows.push({
    id: "own-key",
    part: "AI with your own key",
    when: "Only if you add a key in AI settings",
    leaves: [
      {
        text: `Your prompts, with any tool data they include, go to the provider you chose: ${listOf(ownKeyProviders(), "or")}.`,
      },
      { says: "AI settings says:", text: OWN_KEY_DISCLOSURE },
    ],
    kept: [
      {
        text: "Nothing by us. The key stays in this browser, and a backup file never includes it. What the provider keeps is up to the provider.",
      },
    ],
  });

  if (visitorAiEnabled()) {
    rows.push({
      id: "amr-ai",
      part: "Amr's AI",
      when: "Only if you agree on the card he shows first",
      leaves: [{ says: "The card before your first message says:", text: VISITOR_AI_SENT }],
      kept: [
        { says: "The same card says:", text: VISITOR_AI_KEPT },
        {
          text: "Site-wide totals, with nothing that points to a visitor, are kept for 30 days.",
        },
      ],
    });
  }

  rows.push(
    {
      id: "licence",
      part: "Comic licence form",
      when: "Only if you send it",
      leaves: [{ text: `What you type: ${listOf(Object.values(LICENCE_FIELDS))}.` }],
      kept: [
        {
          text: `Those answers and when you sent them, so Amr can reply. No IP address and nothing about your browser. ${KEPT_UNTIL_ASKED}`,
        },
        { says: "Under the form, the site says:", text: LICENCE_FORM_NOTE },
      ],
    },
    {
      id: "guestbook",
      part: "Guestbook",
      when: "Only if you sign it",
      leaves: [{ text: `What you type: ${listOf(Object.values(GUESTBOOK_FIELDS))}.` }],
      kept: [
        {
          text: `Both, and when you sent them. No IP address and nothing about your browser. The note shows on the guestbook once Amr has approved it. ${KEPT_UNTIL_ASKED}`,
        },
        { says: "Under the form, the site says:", text: GUESTBOOK_FORM_NOTE },
      ],
    },
    {
      id: "book-link",
      part: "The link printed in the book",
      when: "Only if you open it",
      leaves: [{ text: "The key printed in your copy." }],
      kept: [
        {
          text: `Nothing about you. Your browser keeps two cookies for up to ${days(VIP_COOKIE_MAX_AGE)} days: one holds the key, the other tells the menus to list the readers' pages. The first time, one is added to that day's anonymous count of new readers.`,
        },
      ],
    },
    {
      id: "squad-invite",
      part: "A squad invite from Amr",
      when: "Only with his invite code",
      leaves: [
        {
          text: "The name and colour you pick, and what you add to the tools he shared with you.",
        },
      ],
      kept: [
        {
          text: "Those are saved in his workspace at Supabase, as his team's work. One cookie keeps you joined for up to a year.",
        },
      ],
    }
  );

  return rows;
}

/** The retention sentence the page shows beside the contact address. */
export const RETENTION_LINE =
  "Licence requests and guestbook notes are kept until someone asks for them to be removed, because nothing deletes them automatically today.";

/** Where Vercel's regions are: only the codes this site has used. */
const VERCEL_REGION_PLACES: Record<string, string> = {
  fra1: "Frankfurt, Germany",
};

export interface Processor {
  name: string;
  does: string;
}

/** The functions region set in vercel.json, with its place when we know it. */
export function hostingRegion(): { code: string; place: string | null } {
  const code = vercel.regions[0];
  return { code, place: VERCEL_REGION_PLACES[code] ?? null };
}

/**
 * Who processes what, and where. The Supabase project's region is not in this
 * repository, so the page doesn't state one.
 */
export function processors(): Processor[] {
  const { code, place } = hostingRegion();
  const where = place ? `${place} (Vercel region ${code})` : `Vercel region ${code}`;
  const aiCounts = visitorAiEnabled() ? ", the daily message counts for Amr's AI" : "";
  return [
    {
      name: "Vercel",
      does: `Hosts the site and runs its server code. The functions run in ${where}. Like any host, it receives your IP address with each request.`,
    },
    {
      name: "Supabase",
      does: `Holds the database (the anonymous counts${aiCounts}, licence requests, guestbook notes and the owner's own work), the storage the comics' pictures load from, and the realtime channels live rooms pass through.`,
    },
  ];
}

/** The others, who take part only where a row of the table says so. */
export function otherProcessors(): string {
  const ai = visitorAiEnabled() ? ", Amr's own AI server and Z.AI for his AI" : "";
  return `Others take part only where the table above says so: Open-Meteo for the weather${ai}, and the AI provider whose key you add.`;
}

/** The Lighthouse accessibility gate, read from lighthouserc.json. */
export function lighthouseGate(): { minScore: number; pages: number; level: string } {
  const [level, options] = lighthouse.ci.assert.assertions["categories:accessibility"] as [
    string,
    { minScore: number },
  ];
  return { minScore: options.minScore, pages: lighthouse.ci.collect.url.length, level };
}

export interface LabelledLine {
  label: string;
  text: string;
}

/** Three lines on accessibility: what is tested, what is not, where to report. */
export function accessibilityLines(): LabelledLine[] {
  const gate = lighthouseGate();
  return [
    {
      label: "What is tested",
      text: `Lighthouse checks each change proposed to the site: accessibility must score at least ${Math.round(gate.minScore * 100)} out of 100 on ${gate.pages} public pages, measured as a phone, or the check fails. A test also holds the colours used for text to a contrast of at least 4.5 to 1 on the surfaces they sit on, in all three themes: Comic, Night and High contrast.`,
    },
    {
      label: "What is not",
      text: "No test with a screen reader or other assistive technology is on record.",
    },
    {
      label: "Where to report a problem",
      text: `Write to ${CONTACT_EMAIL} and say what got in your way.`,
    },
  ];
}

/** What a reader on a security team can check in two minutes. */
export function securityChecks(): LabelledLine[] {
  return [
    {
      label: "No cookie on a first visit",
      text: "Open the site in a private window and look at the response headers: there is no Set-Cookie. The site sets a cookie in three cases only: the owner signing in, the link printed in the book, and a squad invite code.",
    },
    {
      label: "No third-party script",
      text: `The Content-Security-Policy header says ${cspDirective("script-src")}, so a script can load from this site and nowhere else.`,
    },
    {
      label: "A tool page loads nothing from elsewhere",
      text: "View the source of a tool page such as /retro. Every script, style sheet, font and picture it loads comes from this site.",
    },
    {
      label: "See it in the Network tab",
      text: "Open your browser's developer tools, choose Network, then use a tool and type something. No request carries what you typed. Amr's one question to the server, /api/mascot/weather, has no body.",
    },
  ];
}

/** Why there is nothing to manage for a team. */
export const NO_ACCOUNT_LINE =
  "There is no account, so there is nothing to set up when someone joins your team or to remove when they leave.";

/** What each "who can meet this host" mark is called on the page. */
export const REACH_LABEL = {
  visitor: "Any visitor",
  choice: "Only if you choose",
  owner: "Owner only",
  unused: "Not used",
} as const;
