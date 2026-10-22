/**
 * Sanitize an evidence URL. If the user types something without a scheme,
 * default to https. Reject anything that isn't http/https (especially
 * `javascript:` / `data:` / `file:`) to prevent XSS via the rendered <a href>.
 * Returns the normalized URL string, or null if invalid.
 *
 * Shared by the page and tool.control_map.*, so a link the agent adds is held
 * to the same rule as one typed on the page.
 */
export function sanitizeEvidenceUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Add scheme if missing — also normalize scheme-relative "//host/...".
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    ? value
    : `https://${value.replace(/^\/\//, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return parsed.toString();
}
