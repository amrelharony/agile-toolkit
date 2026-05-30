import { describe, it, expect } from "vitest";
import {
  isRichHtml,
  safeImageSrc,
  iframeSandboxFor,
  embedIframeUrl,
  arrowheadPoints,
} from "@/app/(tools)/canvas/lib/object-render-utils";

/**
 * Characterization tests for the canvas object-renderer pure helpers.
 * These pin the CURRENT behavior (the safety net the renderer never had)
 * so the helpers can be extracted/refactored with confidence. Several are
 * security guards (image/iframe sanitization), so the negative cases matter
 * as much as the positive ones.
 */

describe("isRichHtml", () => {
  it("detects a leading tag opening followed by an ASCII letter", () => {
    expect(isRichHtml("<p>hi</p>")).toBe(true);
    expect(isRichHtml("<div><span>x</span></div>")).toBe(true);
  });
  it("tolerates leading whitespace before the tag", () => {
    expect(isRichHtml("   \n<ul><li>a</li></ul>")).toBe(true);
  });
  it("treats plain text and non-tag '<' as plain", () => {
    expect(isRichHtml("just text")).toBe(false);
    expect(isRichHtml("3 < 5 and 5 > 3")).toBe(false);
    expect(isRichHtml("</close first>")).toBe(false);
    expect(isRichHtml("")).toBe(false);
  });
});

describe("safeImageSrc", () => {
  it("passes through http(s) URLs (trimmed)", () => {
    expect(safeImageSrc("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(safeImageSrc("http://example.com/b.jpg")).toBe("http://example.com/b.jpg");
    expect(safeImageSrc("  https://example.com/c.png  ")).toBe("https://example.com/c.png");
  });
  it("allows only known raster base64 data-URLs", () => {
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeImageSrc("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(safeImageSrc("data:image/jpg;base64,AAAA")).toBe("data:image/jpg;base64,AAAA");
    expect(safeImageSrc("data:image/webp;base64,AAAA")).toBe("data:image/webp;base64,AAAA");
    expect(safeImageSrc("data:image/gif;base64,AAAA")).toBe("data:image/gif;base64,AAAA");
    expect(safeImageSrc("data:image/avif;base64,AAAA")).toBe("data:image/avif;base64,AAAA");
  });
  it("blocks SVG / non-raster / non-base64 data-URLs (XSS vectors)", () => {
    expect(safeImageSrc("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe("");
    expect(safeImageSrc("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeImageSrc("data:image/png,notbase64")).toBe("");
  });
  it("blocks javascript: and other schemes", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBe("");
    expect(safeImageSrc("ftp://example.com/x.png")).toBe("");
    expect(safeImageSrc("")).toBe("");
  });
});

describe("iframeSandboxFor", () => {
  const BASE = "allow-scripts allow-presentation";
  it("returns the strict base tier for untrusted/generic hosts", () => {
    expect(iframeSandboxFor("youtube.com")).toBe(BASE);
    expect(iframeSandboxFor("docs.google.com")).toBe(BASE);
    expect(iframeSandboxFor("example.com")).toBe(BASE);
  });
  it("grants the elevated tier only to the exact Figma/Loom hosts", () => {
    const elevated = `${BASE} allow-same-origin allow-popups allow-popups-to-escape-sandbox`;
    expect(iframeSandboxFor("figma.com")).toBe(elevated);
    expect(iframeSandboxFor("www.figma.com")).toBe(elevated);
    expect(iframeSandboxFor("loom.com")).toBe(elevated);
    expect(iframeSandboxFor("www.loom.com")).toBe(elevated);
  });
  it("does not elevate look-alike hosts (exact-match guard)", () => {
    expect(iframeSandboxFor("figma.com.evil.tld")).toBe(BASE);
    expect(iframeSandboxFor("notfigma.com")).toBe(BASE);
    expect(iframeSandboxFor("loom.com.attacker.net")).toBe(BASE);
  });
});

describe("embedIframeUrl", () => {
  it("maps YouTube watch + youtu.be + /embed forms to the embed URL", () => {
    expect(embedIframeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "embed")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
    expect(embedIframeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "embed")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
    expect(embedIframeUrl("https://youtu.be/dQw4w9WgXcQ", "embed")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
    expect(embedIframeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ", "embed")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ"
    );
  });
  it("rejects YouTube ids that aren't exactly 11 chars", () => {
    expect(embedIframeUrl("https://www.youtube.com/watch?v=short", "embed")).toBeNull();
    expect(embedIframeUrl("https://youtu.be/waytoolongvideoid", "embed")).toBeNull();
  });
  it("maps a canonical Loom share URL", () => {
    expect(embedIframeUrl("https://www.loom.com/share/abcdef1234567890", "embed")).toBe(
      "https://www.loom.com/embed/abcdef1234567890"
    );
    expect(embedIframeUrl("https://www.loom.com/embed/abcdef1234567890", "embed")).toBeNull();
  });
  it("rebuilds a clean Figma embed URL and drops the user query string", () => {
    const out = embedIframeUrl(
      "https://www.figma.com/file/ABC123/My-Design?node-id=1%3A2&t=evil",
      "embed"
    );
    expect(out).toBe(
      `https://www.figma.com/embed?embed_host=agile-toolkit&url=${encodeURIComponent(
        "https://www.figma.com/file/ABC123"
      )}`
    );
    // The smuggled query string must not survive into the embed url param.
    expect(out).not.toContain("evil");
  });
  it("rejects non-document Figma paths", () => {
    expect(embedIframeUrl("https://www.figma.com/community/whatever", "embed")).toBeNull();
  });
  it("maps Google Docs/Sheets/Slides edit URLs to /preview", () => {
    expect(embedIframeUrl("https://docs.google.com/document/d/abc123/edit", "embed")).toBe(
      "https://docs.google.com/document/d/abc123/preview"
    );
    expect(embedIframeUrl("https://docs.google.com/spreadsheets/d/xyz/edit#gid=0", "embed")).toBe(
      "https://docs.google.com/spreadsheets/d/xyz/preview"
    );
  });
  it("rejects non-document Google paths", () => {
    expect(embedIframeUrl("https://docs.google.com/drawings/d/abc/edit", "embed")).toBeNull();
  });
  it("accepts an arbitrary https URL only when kind is 'generic'", () => {
    expect(embedIframeUrl("https://example.com/page", "generic")).toBe("https://example.com/page");
    expect(embedIframeUrl("https://example.com/page", "embed")).toBeNull();
  });
  it("rejects non-http(s) and malformed inputs", () => {
    expect(embedIframeUrl("javascript:alert(1)", "generic")).toBeNull();
    expect(embedIframeUrl("ftp://example.com/x", "generic")).toBeNull();
    expect(embedIframeUrl("not a url", "generic")).toBeNull();
    expect(embedIframeUrl("", "generic")).toBeNull();
  });
});

describe("arrowheadPoints", () => {
  it("builds the triangular points string for a unit direction", () => {
    expect(arrowheadPoints({ x: 10, y: 0 }, { x: 1, y: 0 }, 10)).toBe("10,0 0,5 0,-5");
  });
  it("falls back to unit length for a degenerate (zero) direction — stays finite", () => {
    const out = arrowheadPoints({ x: 5, y: 5 }, { x: 0, y: 0 }, 10);
    expect(out).toBe("5,5 5,5 5,5");
    expect(out).not.toContain("NaN");
  });
});
