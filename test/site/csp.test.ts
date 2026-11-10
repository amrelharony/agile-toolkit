// @vitest-environment node
/**
 * The Content-Security-Policy header is built from lib/site/csp.mjs, the same
 * list the privacy page prints for a security team. These hold the two
 * together: the header is exactly what the list says, every outside host in
 * the header is on the list with its reason, and the claims the list makes
 * ("not used", "owner only") match the code.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";
import {
  CSP_DIRECTIVE_NAMES,
  CSP_HOSTS,
  contentSecurityPolicy,
  cspDirective,
} from "@/lib/site/csp.mjs";
import { PROVIDER_IDS } from "@/lib/llm/registry";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** The header every route is served with. */
async function servedPolicy(): Promise<string> {
  const rules = await nextConfig.headers!();
  const everyRoute = rules.find((rule) => rule.source === "/(.*)")!;
  return everyRoute.headers.find((header) => header.key === "Content-Security-Policy")!.value;
}

/** A policy as { directive: sources[] }. */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ");
      return [name, sources];
    })
  );
}

/** A source that names a host, not a keyword ('self') or a bare scheme (data:). */
const isHost = (source: string) => /^(?:https|wss):\/\//.test(source);

/** Every source file under `dir`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:tsx?|mjs|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the Content-Security-Policy header", () => {
  it("is built from the shared list, with eval allowed only outside production", async () => {
    const served = await servedPolicy();
    const dev = process.env.NODE_ENV !== "production";
    expect(served).toBe(contentSecurityPolicy({ dev }));
    expect(contentSecurityPolicy({ dev: true })).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval';"
    );
    expect(contentSecurityPolicy()).not.toContain("unsafe-eval");
  });

  // The value production served before the list existed. Moving the policy
  // into data must not change one character of it.
  it("is, in production, what it was before it was built from a list", () => {
    expect(contentSecurityPolicy()).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://avatars.githubusercontent.com",
        "connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://api.z.ai https://open.bigmodel.cn https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.open-meteo.com",
        "frame-src 'self' https://accounts.google.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com",
        "object-src 'none'",
        "upgrade-insecure-requests",
      ].join("; ")
    );
  });

  it("gives each directive on its own, as the page quotes it", () => {
    expect(cspDirective("script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(cspDirective("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(contentSecurityPolicy().split("; ")).toEqual(
      CSP_DIRECTIVE_NAMES.map((name) => cspDirective(name))
    );
    expect(() => cspDirective("no-such-src")).toThrow(/no "no-such-src" directive/);
  });

  it("lets scripts load from this site only", () => {
    const policy = parse(contentSecurityPolicy());
    expect(policy["script-src"].filter(isHost)).toEqual([]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(CSP_HOSTS.flatMap((host) => host.directives)).not.toContain("script-src");
  });
});

describe("the list of outside hosts", () => {
  it("is every host the header allows, and nothing the header doesn't", async () => {
    for (const policy of [await servedPolicy(), contentSecurityPolicy({ dev: true })]) {
      const allowed = new Set<string>();
      for (const [directive, sources] of Object.entries(parse(policy))) {
        for (const source of sources.filter(isHost)) allowed.add(`${directive} ${source}`);
      }
      const listed = new Set(
        CSP_HOSTS.flatMap((host) => host.directives.map((d) => `${d} ${host.source}`))
      );
      expect(Array.from(allowed).sort()).toEqual(Array.from(listed).sort());
    }
  });

  it("names each host once, under directives the policy has", () => {
    const sources = CSP_HOSTS.map((host) => host.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const host of CSP_HOSTS) {
      expect(isHost(host.source), host.source).toBe(true);
      expect(host.directives.length, host.source).toBeGreaterThan(0);
      for (const d of host.directives) expect(CSP_DIRECTIVE_NAMES, host.source).toContain(d);
    }
  });

  it("says whose each host is and when it is used, in plain sentences", () => {
    for (const host of CSP_HOSTS) {
      expect(host.who.trim(), host.source).not.toBe("");
      expect(host.when, host.source).toMatch(/^[A-Z].*\.$/);
      expect(host.when, host.source).not.toMatch(/[—–]/);
      expect(["visitor", "choice", "owner", "unused"], host.source).toContain(host.reach);
    }
  });
});

describe("what the list claims, against the code", () => {
  const files = sourceFiles(path.join(root, "src")).map((file) => ({
    file: path.relative(root, file).replace(/\\/g, "/"),
    text: readFileSync(file, "utf8"),
  }));
  const mentioning = (needle: string) =>
    files.filter((f) => f.file !== "src/lib/site/csp.mjs" && f.text.includes(needle));

  it("no page asks Google Fonts or GitHub for anything: the hosts marked unused", () => {
    const unused = CSP_HOSTS.filter((host) => host.reach === "unused").map((h) => h.source);
    expect(unused).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
      "https://avatars.githubusercontent.com",
      "https://api.z.ai",
    ]);
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "githubusercontent.com"]) {
      expect(
        mentioning(host).map((f) => f.file),
        host
      ).toEqual([]);
    }
    // The fonts are next/font's, which copies them into the site at build time.
    expect(read("src/app/layout.tsx")).toContain('from "next/font/google"');
  });

  it("only server code names api.z.ai, so the browser never calls it", () => {
    const users = mentioning("api.z.ai");
    expect(users.length).toBeGreaterThan(0);
    for (const { file, text } of users) {
      // The browser's own-key path says why it left z.ai, in a comment.
      if (file === "src/lib/agent/client.ts") {
        expect(text).not.toMatch(/["'`]https:\/\/api\.z\.ai/);
        continue;
      }
      const serverOnly = file.startsWith("src/app/api/") || file === "src/lib/agent/upstream.ts";
      expect(serverOnly, file).toBe(true);
      expect(text, file).not.toMatch(/^["']use client["']/);
    }
  });

  it("allows one host for each AI provider a visitor's own key can call", () => {
    const ownKey = CSP_HOSTS.filter((host) => host.when.includes("your own"));
    expect(ownKey).toHaveLength(PROVIDER_IDS.length);
    for (const host of ownKey) {
      expect(host.reach, host.source).toBe("choice");
      expect(host.directives, host.source).toEqual(["connect-src"]);
    }
    const adapters = [
      read("src/lib/llm/adapters/anthropic.ts"),
      read("src/lib/llm/adapters/gemini.ts"),
      read("src/lib/llm/adapters/openai-compatible.ts"),
    ].join("\n");
    for (const host of ownKey) expect(adapters, host.source).toContain(host.source);
  });

  it("asks Open-Meteo from the browser for the owner only", () => {
    const host = CSP_HOSTS.find((h) => h.source === "https://api.open-meteo.com")!;
    expect(host.reach).toBe("owner");
    // The one browser caller is the Cairo widget, which the shell turns on for the owner.
    expect(read("src/components/layout/app-shell.tsx")).toContain(
      "<WeatherProvider enabled={isOwner}>"
    );
    // A visitor's weather is asked for by the site's own route.
    expect(read("src/lib/agent/mascot/context/weather.ts")).toContain(
      'fetch("/api/mascot/weather"'
    );
  });

  it("opens Supabase Realtime for a visitor only in a room they agreed to", () => {
    const host = CSP_HOSTS.find((h) => h.source === "wss://*.supabase.co")!;
    expect(host.reach).toBe("choice");
    expect(read("src/lib/realtime/use-realtime-allowed.ts")).toContain(
      "return options.visitorRoom === true && visitorRoomsEnabled();"
    );
  });

  it("signs in with Google only, which is why GitHub's pictures are never loaded", () => {
    const providers = files
      .flatMap((f) => Array.from(f.text.matchAll(/signInWithOAuth\(\{\s*provider:\s*"(\w+)"/g)))
      .map((m) => m[1]);
    expect(providers.length).toBeGreaterThan(0);
    expect(new Set(providers)).toEqual(new Set(["google"]));
  });
});
