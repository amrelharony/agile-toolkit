/** @type {import('next').NextConfig} */

/**
 * Security headers applied to every route.
 *
 * Content-Security-Policy is locked down to:
 *   - same-origin everything by default
 *   - inline scripts allowed (Next.js needs this for hydration boot)
 *   - Supabase project URLs for fetch + websocket (auth + realtime)
 *   - Google fonts (Inter, JetBrains Mono, Source Serif)
 *   - data: + blob: for images/exports
 *
 * The `connect-src` whitelist uses a wildcard for *.supabase.co so any
 * project URL works without rebuild. Tighten to the specific project
 * subdomain in production if you want defense-in-depth.
 */
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://avatars.githubusercontent.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com",
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
