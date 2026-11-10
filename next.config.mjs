import { contentSecurityPolicy } from "./src/lib/site/csp.mjs";

/** @type {import('next').NextConfig} */

/**
 * Security headers applied to every route.
 *
 * The Content-Security-Policy is built from src/lib/site/csp.mjs, which holds
 * every directive and every outside host with the reason it is allowed. The
 * privacy page (/privacy) lists the hosts from that same file, so add or
 * remove a host there, never here.
 */
// BUG-A9: 'unsafe-eval' is for `next dev` only. Production hydration needs no
// eval(); the React Refresh runtime (HMR) does, and without it every client
// component fails to hydrate silently (see DIRECTIVES in csp.mjs).
const isDev = process.env.NODE_ENV !== "production";

const cspDirectives = contentSecurityPolicy({ dev: isDev });

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the agent composer's voice dictation (Web Speech API)
  // needs the mic for our OWN origin. An empty allowlist `microphone=()` forbids
  // it everywhere — including us — so clicking Dictate fails with no permission
  // prompt at all. camera + geolocation stay fully disabled (unused).
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  // HSTS: 2 years, include subdomains, preload-eligible. Vercel terminates
  // TLS so HTTPS is the only entry point in production.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Cross-origin isolation: same-origin for opener (prevents window.opener
  // hijack from popups) and same-origin for embedder (blocks third-party
  // documents from embedding our pages in a way they can read).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  async redirects() {
    return [
      // The old comic reader. Its pages were a PDF's, so they map to nothing
      // more specific than the comics section.
      { source: "/agile-at-work", destination: "/comics", permanent: true },
      { source: "/agile-at-work/:path*", destination: "/comics", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Amr's sprite sheet: committed under a content-hashed name
      // (components/agent/mascot/mascot-asset.ts), so a changed sheet always
      // gets a new URL and the current one can be cached forever.
      {
        source: "/mascot/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // The book's cover and the share images (lib/book/art.ts): content-hashed
      // names too. Their own folder, never /book/:path*, which would also match
      // the /book page.
      {
        source: "/media/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // A link preview can be drawn inside another site's page, which the
      // site-wide same-origin CORP would block. Only the share images: the
      // cover itself stays same-origin, like the rest of the site.
      {
        source: "/media/share-:file",
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
      },
      // Service worker: always revalidate so a new deploy's worker is picked
      // up on the next visit instead of whenever the HTTP cache expires.
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
