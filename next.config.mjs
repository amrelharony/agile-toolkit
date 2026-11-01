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

// The mascot GLB (~2.7 MB, gitignored) is served from a CDN/LFS host in prod via
// NEXT_PUBLIC_MASCOT_GLB_URL. When that's an absolute URL, GLTFLoader fetches it
// (connect-src) so its origin must be whitelisted; a relative/same-origin path
// is already covered by 'self'. Returns " https://cdn.example" or "".
function mascotGlbOrigin() {
  const u = process.env.NEXT_PUBLIC_MASCOT_GLB_URL;
  if (!u) return "";
  try {
    return ` ${new URL(u).origin}`;
  } catch {
    return ""; // relative path → covered by 'self'
  }
}

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-inline' stays in both modes because Next still emits an inline
  // boot script for the route manifest; switch to nonces or 'strict-dynamic'
  // if you can tolerate the extra plumbing.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://avatars.githubusercontent.com",
  // `blob:` is required by connect-src (not just img-src): three's GLTFLoader
  // decodes the mascot's embedded texture via ImageBitmapLoader, which does
  // `fetch(blob:…)` — governed by connect-src. Without it the texture fails to
  // load ("THREE.GLTFLoader: Couldn't load texture blob:…") and the mascot
  // renders as an untextured white clay model.
  `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://api.z.ai https://open.bigmodel.cn https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.open-meteo.com${mascotGlbOrigin()}`,
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
      // Mascot model: committed under a content-hashed name
      // (components/agent/mascot/mascot-asset.ts), so a changed model always
      // gets a new URL and the current one can be cached forever. The
      // Supabase-hosted copy it replaces was served with `no-cache`.
      {
        source: "/mascot/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
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
