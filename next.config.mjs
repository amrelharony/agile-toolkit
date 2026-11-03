/** @type {import('next').NextConfig} */

/**
 * Security headers applied to every route.
 *
 * Content-Security-Policy is locked down to:
 *   - same-origin everything by default
 *   - inline scripts allowed (Next.js needs this for hydration boot)
 *   - Supabase project URLs for fetch + websocket (auth + realtime)
 *   - GLM (Zhipu) chat API for the in-app agent — server-proxied, but
 *     the browser-direct BYOK fallback in agent/client.ts hits z.ai
 *     directly when ANTHROPIC_API_KEY is unset server-side
 *   - Google fonts (Inter, JetBrains Mono, Source Serif)
 *   - Open-Meteo forecast API for the header weather widget (lib/weather/api.ts)
 *   - data: + blob: for images/exports, and Supabase Storage for the comics' art
 *
 * The `connect-src` whitelist uses a wildcard for *.supabase.co so any
 * project URL works without rebuild. Tighten to the specific project
 * subdomain in production if you want defense-in-depth.
 */
// BUG-A9: dropped 'unsafe-eval' in PRODUCTION builds — Next's hydration
// boot does not require eval() there. In DEV the React Refresh runtime
// (HMR) DOES use eval(), and without the allowance every client component
// fails to hydrate silently: buttons render but their onClick handlers
// never bind. Add the dev-only allowance back so `npm run dev` works.
const isDev = process.env.NODE_ENV !== "production";

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-inline' stays in both modes because Next still emits an inline
  // boot script for the route manifest; switch to nonces or 'strict-dynamic'
  // if you can tolerate the extra plumbing.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://avatars.githubusercontent.com",
  // `blob:` in connect-src: nothing fetches a blob: URL since Amr replaced the
  // 3D mascot, but the book's 3D model (deferred until the .glb arrives) will
  // load with a GLTFLoader, whose ImageBitmapLoader does `fetch(blob:…)` for a
  // model's embedded textures. Only this origin's own scripts can make one.
  "connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://api.z.ai https://open.bigmodel.cn https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.open-meteo.com",
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

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
