/**
 * What the site tells people about their data, in the words they are shown at
 * the moment it matters: the "Your data" dialog, the consent step before a
 * live room or a vote round, the card before Amr's AI, the note under the
 * comics and kudos pages, the AI settings dialog, and the line under the
 * licence and guestbook forms.
 *
 * Each of those components shows its text from here, and so does the privacy
 * page (/privacy), which quotes them. The page is rendered on the server, and
 * a server component can't read a string out of a "use client" module, so the
 * wording lives in this plain one. Change a sentence here and the dialog and
 * the page change together.
 *
 * No imports and no browser or server APIs: safe in either bundle.
 */

// ── "Your data" (components/data/your-data-dialog.tsx) ────────────────────

/** The dialog's opening claim, without its full stop: the dialog goes on after it. */
export const YOUR_DATA_SAVED_HERE =
  "Everything you make in the toolkit is saved in this browser only";

export const YOUR_DATA_COUNTS =
  "The comics and kudos pages do send anonymous counts: which printed piece brought you there, if any, and on a weekly story whether you opened and finished it, roughly how long you read, and your answers, love, share, retro hand-off or click on its tool.";

export const YOUR_DATA_ROOMS =
  "If you start or join a live room, what you type there passes through our realtime provider (Supabase) to everyone with the link, and we don't store it.";

export const YOUR_DATA_AI =
  "If you choose to chat with Amr's AI or press Ask Amr in a tool, what you type and the tool content you choose or Amr reads to answer are sent to write the reply, and the site keeps only a daily count of AI uses. A tool sends nothing until you press Ask Amr.";

// ── Live rooms and vote rounds (components/collab/visitor-room-consent.tsx) ─

/** What the dialog tells people before any channel opens. */
export const VISITOR_ROOM_CONSENT_TEXT =
  "What you type passes through our realtime provider (Supabase) to everyone with the link. " +
  "We don't store it; the room disappears when everyone leaves. " +
  "The host may send the room's answers, without names, to an AI service for a summary. " +
  "Share the link only with your team.";

/**
 * The vote-round variant: answers are numbers, encrypted to the host's
 * browser, and only totals are kept and shown. It promises no more than
 * that: the totals of a unanimous question show everyone's answer.
 */
export const VOTE_ROOM_CONSENT_TEXT =
  "Answers are encrypted in each person's browser, so only the host's browser can read them, " +
  "and it keeps the totals only. They pass through our realtime provider (Supabase). " +
  "Others in the room see your name and whether you've answered, not what. " +
  "After the host reveals the results, everyone in the room sees the totals, for questions " +
  "with enough answers; if everyone gives the same answer, the totals show it. " +
  "The host may send the room's answers, without names, to an AI service for a summary. " +
  "Share the link only with your team.";

/**
 * The wall-room variant (Audience Wall): people post short text, which the
 * host's browser puts on the wall without a name, and the host may save
 * the posts and their votes as anonymous text. A raised hand is named: it
 * is a queue to speak. The AI sentence says what the host may do with the
 * posts (Audience Wall groups them); keep it in step with the AI line the
 * room and vote texts carry.
 */
export const WALL_ROOM_CONSENT_TEXT =
  "Your posts travel encrypted to the host's browser, which puts them on the wall without your name. " +
  "Everyone in the room sees the wall, and the host can save the posts and their votes as anonymous text; no names are kept. " +
  "Others in the room see your name, and see it in the queue if you raise your hand. " +
  "It all passes through our realtime provider (Supabase), and we don't store it. " +
  "The host may send the posts, without names, to an AI service, for example to group them. " +
  "Share the link only with your team.";

// ── Amr's AI for visitors ──────────────────────────────────────────────────
// The card in the mascot panel (components/agent/mascot/visitor-ai-consent.tsx)
// and the compact one before a tool's first Ask Amr
// (components/ai/ai-consent-compact.tsx). One agreement covers both (v2 of
// the card, lib/visitor-ai/consent.ts); the wording below is a draft the owner
// approves.

/**
 * The daily allowance the card names: AI uses, shared by the chat and the Ask
 * Amr buttons (the server's config row, visitor_ai_config.turns_per_visitor,
 * is what counts).
 */
export const VISITOR_AI_DAILY_MESSAGES = 100;

/** The card's first point: what is sent, and to whom. */
export const VISITOR_AI_SENT =
  "When you chat with Amr's AI or press Ask Amr in a tool, what you type, the tool you're on, and the tool content you choose or Amr reads to answer are sent through this site and Amr's own AI server to Z.AI, the AI provider, to write a reply.";

/** The card's second point: what the site keeps. */
export const VISITOR_AI_KEPT =
  "The site keeps none of it. It keeps only a count of today's AI uses, under a code made from your IP address that changes every day and is deleted the next day.";

/** What the visitor agrees to, one point per line. */
export const VISITOR_AI_CONSENT_TEXT: readonly string[] = [
  VISITOR_AI_SENT,
  VISITOR_AI_KEPT,
  "Amr never changes your work without you accepting it.",
  "Don't share personal or confidential information.",
  `You get ${VISITOR_AI_DAILY_MESSAGES} AI uses a day, shared by the chat and the Ask Amr buttons (fewer during busy hours). The tools and the offline guide always work without AI.`,
];

// ── The count note (components/visits/visit-recorder.tsx) ─────────────────

/** Under /comics, a book episode's page and /kudos. */
export const COUNT_DISCLOSURE =
  "This page sends us one anonymous count when you arrive: which printed piece brought you here, if any, and the episode. It keeps nothing about you: no cookies and no IP address. The link is then tidied, so sharing it doesn't count again.";

/** Under a weekly story, which also counts its reading (lib/comics/stats). */
export const STORY_COUNT_DISCLOSURE =
  "This page sends us anonymous counts: that you arrived (and which printed piece brought you, if any), opened and finished this story, roughly how long you spent reading it, and your answers, love, share, retro hand-off or click on its tool. Nothing about you is kept: no cookies, no account and no IP address. What you've read, guessed and loved stays in this browser, for Your reading.";

// ── AI with your own key (components/ai/llm-settings-dialog.tsx) ──────────

/** The first two sentences under the dialog's settings. */
export const OWN_KEY_DISCLOSURE =
  "Your key is stored only in this browser. Requests go directly from your browser to the provider and never touch the toolkit's servers.";

// ── The comic licence page (app/(tools)/comics/license/page.tsx) ──────────

export const TOOLS_STAY_FREE = "The tools on this site stay free.";

// ── Under the two forms that keep what people type ─────────────────────────
// Nothing deletes either kind of row on a timer (no migration purges them),
// so each says it stays until the person asks; the forms add a link to the
// privacy page after it.

/** Under the comic licence form (app/(tools)/comics/license/licence-form.tsx). */
export const LICENCE_FORM_NOTE =
  "We keep what you send so Amr can reply, until you ask us to remove it. We don't keep your IP address.";

/** Under the guestbook form (app/(tools)/comics/guestbook/guestbook-form.tsx). */
export const GUESTBOOK_FORM_NOTE =
  "We keep your name and note until you ask us to remove them. We don't keep your IP address.";
