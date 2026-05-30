/**
 * Canvas object-renderer — pure helpers.
 *
 * Extracted from object-renderer.tsx so the security-relevant embed/image
 * guards (safeImageSrc, iframeSandboxFor, embedIframeUrl) and the rich-text /
 * arrowhead helpers can be unit-tested independently of the React renderer.
 * All functions here are pure (no React, no DOM, no closures over component
 * state) — see test/canvas/object-render-utils.test.ts for the characterization
 * suite that pins their behavior.
 */

export function isRichHtml(content: string): boolean {
  return typeof content === "string" && /^\s*<[a-z]/i.test(content);
}

export function safeImageSrc(src: string): string {
  if (typeof src !== "string") return "";
  const t = src.trim();
  if (/^https?:/i.test(t)) return t;
  // Narrow to known raster formats. SVG data-URLs are an XSS vector
  // (embedded <script>) and other `data:` types (text/html,
  // application/*) never belong in an <img>. Allow only the formats
  // browsers render safely as bitmaps.
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(t)) return t;
  return "";
}

/**
 * Resolve the sandbox attribute string per embed host. Two tiers:
 *
 *   - "strict"   (default) — `allow-scripts allow-presentation allow-popups-to-escape-sandbox`.
 *     Suitable for YouTube, Google Docs preview, generic embeds. The
 *     iframe runs scripts in its own origin sandbox and can NOT call
 *     parent.postMessage with privileges or read top.parent.
 *
 *   - "elevated" — adds `allow-same-origin`. Required for Loom (sign-in
 *     state, video resume) and Figma (signed-in editing). These hosts
 *     are first-party-trusted; granting same-origin to a third-party
 *     origin (figma.com, loom.com) does NOT let the iframe break out
 *     of OUR origin's sandbox — they share their OWN third-party
 *     cookies, not ours.
 *
 * The HTML spec footgun about `allow-scripts allow-same-origin`
 * applies only when the iframe is served from the SAME origin as the
 * embedding page; cross-origin embeds keep their sandbox enforcement.
 */
export function iframeSandboxFor(host: string): string {
  // R11-fix: removed `allow-popups-to-escape-sandbox` from the base
  // tier. Even with a sandboxed iframe, this attribute lets the embed
  // open a top-level un-sandboxed window whose `window.opener` still
  // references the iframe — a side-channel out of the sandbox for
  // generic-tier (untrusted) embeds. Only the elevated tier (Figma,
  // Loom) gets it, paired with `allow-popups` for legit outbound link
  // navigation from the editor / player.
  const base = "allow-scripts allow-presentation";
  // Hosts that legitimately need same-origin to function properly
  // (signed-in editing / playback resume). All entries must be exact
  // hostnames — substring matching would let a "figma.com.evil.tld"
  // attacker masquerade as Figma.
  const elevated = new Set(["figma.com", "www.figma.com", "loom.com", "www.loom.com"]);
  return elevated.has(host)
    ? `${base} allow-same-origin allow-popups allow-popups-to-escape-sandbox`
    : base;
}

/**
 * Convert a user-supplied URL into an embeddable iframe URL when we
 * recognise it. Returns null for unsupported / unsafe sources so the
 * renderer can fall back to a placeholder instead of embedding raw
 * HTML. Recognises YouTube, Loom, Figma, Google Docs/Sheets/Slides;
 * generic https URLs are accepted only when `kind === "generic"`.
 */
export function embedIframeUrl(src: string, kind: string): string | null {
  if (typeof src !== "string") return null;
  const t = src.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      // Real YouTube IDs are exactly 11 chars (base64url-style alphabet).
      // The previous {6,20} range matched non-IDs and accepted truncated
      // / over-long strings that 404 on YouTube's embed endpoint.
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      const match = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
      if (match) return `https://www.youtube.com/embed/${match[1]}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "loom.com") {
      // Loom share IDs are 32-hex strings (8-32 covers common renamed
      // forms). Capping the upper bound avoids forwarding adversarial
      // input through to the embed endpoint.
      const m = u.pathname.match(/^\/share\/([A-Za-z0-9]{8,32})$/);
      if (m) return `https://www.loom.com/embed/${m[1]}`;
    }
    if (host === "figma.com") {
      // Only accept canonical /file/ID, /proto/ID, or /design/ID URLs.
      // Previously we forwarded the entire user URL as a `url=` query
      // param to figma.com/embed, which let attackers smuggle arbitrary
      // strings (including javascript: schemes) past the host check.
      const m = u.pathname.match(/^\/(?:file|proto|design)\/([A-Za-z0-9]+)/);
      if (!m) return null;
      // Re-construct a clean URL from origin + matched path; drop user
      // query string entirely. Figma's embed endpoint accepts this form.
      const cleanFigmaUrl = `https://www.figma.com${m[0]}`;
      return `https://www.figma.com/embed?embed_host=agile-toolkit&url=${encodeURIComponent(cleanFigmaUrl)}`;
    }
    if (host === "docs.google.com") {
      // Restrict to canonical Google Docs / Sheets / Slides / Forms
      // paths so a bare `docs.google.com` URL with a non-document path
      // doesn't fall through to the embed slot. Required form:
      //   /(document|spreadsheets|presentation|forms)/d/<id>[…]
      // Anything else (calendar, drawings, etc.) returns null so the
      // renderer shows the broken-embed placeholder instead of an
      // iframe pointing at a URL we don't trust.
      const validPath = /^\/(?:document|spreadsheets|presentation|forms)\/d\//.test(u.pathname);
      if (!validPath) return null;
      return t.replace(/\/edit.*$/, "/preview");
    }
    if (kind === "generic") return t;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the SVG `points` string for a triangular arrowhead at `tip`, pointing
 * along `dir`, with the given `size`. Degenerate direction vectors fall back to
 * unit length so the result is always finite.
 */
export function arrowheadPoints(
  tip: { x: number; y: number },
  dir: { x: number; y: number },
  size: number
): string {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  return `${tip.x},${tip.y} ${baseX + px * size * 0.5},${baseY + py * size * 0.5} ${baseX - px * size * 0.5},${baseY - py * size * 0.5}`;
}
