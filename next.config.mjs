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
 *   - data: + blob: for images/exports
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
  "img-src 'self' data: blob: https://*.googleusercontent.com https://avatars.githubusercontent.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://api.z.ai https://open.bigmodel.cn https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com",
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
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
