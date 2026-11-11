/**
 * The site's Content-Security-Policy, as data.
 *
 * Two readers: next.config.mjs builds the header from it, and the privacy
 * page (/privacy, "For your security team") lists every outside host it
 * allows and says when each is used. One list, so the page can't name a host
 * the header doesn't allow, or miss one it does: a host gets into the header
 * only by being added to CSP_HOSTS, and nothing gets into CSP_HOSTS without
 * its `who` and `when` (test/site/csp.test.ts checks both ways).
 *
 * Plain JavaScript, because Node loads next.config.mjs as it is and can't
 * read TypeScript. No imports.
 *
 * What the policy does:
 *   - same-origin everything by default
 *   - inline scripts allowed (Next's hydration boot needs them); no outside
 *     script host at all
 *   - Supabase project URLs for fetch and websocket (auth, sync, realtime),
 *     and Supabase Storage for the comics' art
 *   - the AI providers a visitor's own key can call from the browser
 *   - data: and blob: for images and exports
 *
 * The Supabase entries use a wildcard so any project URL works without a
 * rebuild. Tighten them to the project's own subdomain for more depth.
 */

/**
 * Who can meet a host:
 *   "visitor"  any visitor's browser, without choosing anything
 *   "choice"   only after the visitor turns something on
 *   "owner"    only the signed-in owner's browser
 *   "unused"   allowed by the header, called by nothing today
 *
 * @typedef {"visitor" | "choice" | "owner" | "unused"} CspReach
 */

/**
 * @typedef {object} CspHost
 * @property {string} source          The source expression, as it stands in the header.
 * @property {readonly string[]} directives  The directives that allow it.
 * @property {string} who             Whose host it is, in plain words.
 * @property {CspReach} reach         Who can meet it.
 * @property {string} when            When a browser contacts it. Shown on /privacy.
 *                                    True whichever features this build has on.
 * @property {string} [whenRooms]     What /privacy shows in place of `when` while
 *                                    live rooms are on (NEXT_PUBLIC_VISITOR_ROOMS).
 *                                    The header itself is the same either way.
 */

/**
 * Every outside host the header allows, in the order they stand in it.
 *
 * @type {readonly CspHost[]}
 */
export const CSP_HOSTS = [
  {
    source: "https://fonts.googleapis.com",
    directives: ["style-src"],
    who: "Google Fonts",
    reach: "unused",
    when: "Not used. The site serves its own copies of its fonts, so no page asks Google for one.",
  },
  {
    source: "https://fonts.gstatic.com",
    directives: ["font-src"],
    who: "Google Fonts",
    reach: "unused",
    when: "Not used, for the same reason.",
  },
  {
    source: "https://*.supabase.co",
    directives: ["img-src", "connect-src"],
    who: "Supabase",
    reach: "visitor",
    when: "Pictures: the comics, the comic banner on the home page and kudos cards load from the site's storage there. Connections: the owner's own sign-in and sync.",
    whenRooms:
      "Pictures: the comics, the comic banner on the home page and kudos cards load from the site's storage there. Connections: a live room or vote round you chose to join, and the owner's own sign-in and sync.",
  },
  {
    source: "wss://*.supabase.co",
    directives: ["connect-src"],
    who: "Supabase Realtime",
    reach: "choice",
    when: "Only for the owner's own devices and invited squad guests, who sync over it.",
    whenRooms:
      "Only while you are in a live room or vote round, after its consent step. The owner's own devices and invited squad guests sync over it too.",
  },
  {
    source: "https://*.googleusercontent.com",
    directives: ["img-src"],
    who: "Google",
    reach: "owner",
    when: "The signed-in owner's profile picture.",
  },
  {
    source: "https://avatars.githubusercontent.com",
    directives: ["img-src"],
    who: "GitHub",
    reach: "unused",
    when: "Not used. Sign-in is with Google only.",
  },
  {
    source: "https://accounts.google.com",
    directives: ["connect-src", "frame-src", "form-action"],
    who: "Google sign-in",
    reach: "owner",
    when: "Only on the owner's sign-in page. No tool asks anyone to sign in.",
  },
  {
    source: "https://api.z.ai",
    directives: ["connect-src"],
    who: "Z.AI",
    reach: "unused",
    when: "Not called from the browser today. Where the site uses Z.AI, its servers call it, never your page.",
  },
  {
    source: "https://open.bigmodel.cn",
    directives: ["connect-src"],
    who: "GLM (Zhipu)",
    reach: "choice",
    when: "Only if you add your own GLM key in AI settings. Your prompts then go straight there.",
  },
  {
    source: "https://api.anthropic.com",
    directives: ["connect-src"],
    who: "Claude (Anthropic)",
    reach: "choice",
    when: "Only if you add your own Claude key in AI settings. Your prompts then go straight there.",
  },
  {
    source: "https://api.openai.com",
    directives: ["connect-src"],
    who: "OpenAI",
    reach: "choice",
    when: "Only if you add your own OpenAI key in AI settings. Your prompts then go straight there.",
  },
  {
    source: "https://generativelanguage.googleapis.com",
    directives: ["connect-src"],
    who: "Gemini (Google)",
    reach: "choice",
    when: "Only if you add your own Gemini key in AI settings. Your prompts then go straight there.",
  },
  {
    source: "https://api.open-meteo.com",
    directives: ["connect-src"],
    who: "Open-Meteo",
    reach: "owner",
    when: "The Cairo weather in the signed-in owner's header. For a visitor the site's server asks Open-Meteo, so your browser never does.",
  },
];

/**
 * Each directive and what it allows before any outside host: keywords and
 * schemes only. `dev` are extra sources for `next dev`.
 *
 * script-src: 'unsafe-inline' stays in both modes because Next still emits an
 * inline boot script for the route manifest; switch to nonces or
 * 'strict-dynamic' if you can tolerate the extra plumbing. 'unsafe-eval' is
 * dev only (BUG-A9): production hydration needs no eval(), but the React
 * Refresh runtime (HMR) uses it, and without it every client component fails
 * to hydrate silently: buttons render but their onClick handlers never bind.
 *
 * connect-src: nothing fetches a `blob:` URL today. Amr replaced the 3D
 * mascot, and the comic intros' book is drawn in CSS from the cover and panel
 * images, so no .glb model is planned. It stays because taking it out would
 * change the CSP; only this origin's own scripts can make a blob: URL.
 *
 * @type {readonly { name: string, own: readonly string[], dev?: readonly string[] }[]}
 */
const DIRECTIVES = [
  { name: "default-src", own: ["'self'"] },
  { name: "script-src", own: ["'self'", "'unsafe-inline'"], dev: ["'unsafe-eval'"] },
  { name: "style-src", own: ["'self'", "'unsafe-inline'"] },
  { name: "font-src", own: ["'self'", "data:"] },
  { name: "img-src", own: ["'self'", "data:", "blob:"] },
  { name: "connect-src", own: ["'self'", "blob:"] },
  { name: "frame-src", own: ["'self'"] },
  { name: "frame-ancestors", own: ["'none'"] },
  { name: "base-uri", own: ["'self'"] },
  { name: "form-action", own: ["'self'"] },
  { name: "object-src", own: ["'none'"] },
  { name: "upgrade-insecure-requests", own: [] },
];

/**
 * One directive as it stands in the header, for example
 * `script-src 'self' 'unsafe-inline'`. Throws on a name the policy doesn't have.
 *
 * @param {string} name
 * @param {{ dev?: boolean }} [options]
 * @returns {string}
 */
export function cspDirective(name, { dev = false } = {}) {
  const directive = DIRECTIVES.find((d) => d.name === name);
  if (!directive) throw new Error(`csp: no "${name}" directive`);
  return [
    directive.name,
    ...directive.own,
    ...(dev ? (directive.dev ?? []) : []),
    ...CSP_HOSTS.filter((host) => host.directives.includes(name)).map((host) => host.source),
  ].join(" ");
}

/**
 * The Content-Security-Policy header's value.
 *
 * @param {{ dev?: boolean }} [options]  `dev: true` for `next dev`.
 * @returns {string}
 */
export function contentSecurityPolicy({ dev = false } = {}) {
  return DIRECTIVES.map((d) => cspDirective(d.name, { dev })).join("; ");
}

/** The names of the policy's directives, in header order. */
export const CSP_DIRECTIVE_NAMES = DIRECTIVES.map((d) => d.name);
