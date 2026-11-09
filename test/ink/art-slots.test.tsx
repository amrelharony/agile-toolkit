/**
 * Ink coverage (DNA-SPEC §9): the surfaces phase 1 left bare now carry their
 * art. Each slot renders an inked drawing (`data-ink`) that assistive tech
 * never hears (`aria-hidden`). The tool icons share one wash (ToneIcon) in
 * their section's colour, and home's section rows get their drawings from the
 * server page, so no client file imports the whole set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// One router for every render: guest home re-fetches whenever it changes.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({
    favorites: [],
    recent: [],
    showAllTools: false,
    isFavorite: () => false,
    toggleFavorite: () => {},
    recordUse: () => {},
    setShowAllTools: () => {},
  }),
}));
vi.mock("@/components/shared/mood-reveal", () => ({
  MoodReveal: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitUiEvent: () => {} }));
vi.mock("@/lib/collab/use-collaborative-session", () => ({
  useCollaborativeSession: () => ({
    subscribeToEvent: () => () => {},
    broadcast: () => {},
    log: () => {},
    isLocalOnly: true,
    isConnected: false,
    members: [],
  }),
}));
vi.mock("@/app/not-authorized/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

import { ToneIcon } from "@/components/ink/tone-icon";
import { ToolCard } from "@/components/shared/tool-card";
import { JobLauncher } from "@/components/home/job-launcher";
import { ToolSections } from "@/components/home/tool-sections";
import { RelatedTools } from "@/components/tool-frame/related-tools";
import { SnapshotClient } from "@/app/s/snapshot-client";
import { JoinClient } from "@/app/(guest)/guest/join/join-client";
import { GuestHomeClient } from "@/app/(guest)/guest/guest-home-client";
import { GuestToolPlaceholder } from "@/app/(guest)/guest/[tool]/[entityId]/guest-tool-placeholder";
import NotAuthorizedPage from "@/app/not-authorized/page";
import { SECTION_ART, SECTION_TONE } from "@/lib/ink/drawings/sections";
import { PAGE_ART } from "@/lib/ink/drawings/pages";
import { getSectionForTool } from "@/lib/constants/sections";
import { TONE_VAR, type InkTone } from "@/lib/ink/types";
import { JOBS } from "@/lib/constants/jobs";

/** The inked drawing named `name` in `root`: present, decorative, never focusable. */
function expectInk(root: ParentNode, name: string) {
  const svg = root.querySelector(`svg[data-ink="${name}"]`);
  expect(svg, `ink "${name}"`).not.toBeNull();
  expect(svg!.getAttribute("aria-hidden")).toBe("true");
  expect(svg!.getAttribute("focusable")).toBe("false");
  return svg!;
}

/** A ToneIcon box: hidden from assistive tech, coloured by its tone, with its wash. */
function expectToneIcon(root: ParentNode, tone: InkTone) {
  const wash = root.querySelector(`svg[data-ink="tile-wash"] .ink-fill-${tone}`);
  expect(wash, `wash in ${tone}`).not.toBeNull();
  const box = wash!.closest("svg")!.parentElement!;
  expect(box.getAttribute("aria-hidden")).toBe("true");
  expect(box.getAttribute("style")).toContain(TONE_VAR[tone]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("ToneIcon", () => {
  it("puts the icon on a still wash of its tone, in that colour, hidden from assistive tech", () => {
    const html = renderToStaticMarkup(
      <ToneIcon tone="plum" seedKey="retro">
        <i>icon</i>
      </ToneIcon>
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("color:var(--neon-magenta)");
    expect(html).toContain('data-ink="tile-wash"');
    expect(html).toContain("ink-still");
    expect(html).toContain("ink-fill-plum");
  });

  it("gives each key its own blob, and the same one every time", () => {
    const icon = (seedKey: string) =>
      renderToStaticMarkup(
        <ToneIcon tone="accent" seedKey={seedKey}>
          <i />
        </ToneIcon>
      );
    expect(icon("wsjf")).not.toBe(icon("moscow"));
    expect(icon("wsjf")).toBe(icon("wsjf"));
  });

  it("takes the caller's size over the 44 px default", () => {
    const { container } = render(
      <ToneIcon tone="accent" seedKey="x" className="h-7 w-7">
        <i />
      </ToneIcon>
    );
    const box = container.firstElementChild!;
    expect(box.className).toContain("h-7");
    expect(box.className).not.toContain("h-11");
  });
});

describe("tool icons on their section's wash", () => {
  it("ToolCard draws its tone through ToneIcon", () => {
    const { container } = render(
      <ToolCard href="/retro" icon={<i />} title="Retro" description="d" tone="accent3" />
    );
    expectToneIcon(container, "accent3");
  });

  it("each job card's tool icon sits on its section's wash", () => {
    const { container } = render(<JobLauncher />);
    const cards = Array.from(container.querySelectorAll("li.panel"));
    expect(cards.length).toBe(JOBS.length);
    JOBS.forEach((job, i) => {
      const tone = SECTION_TONE[getSectionForTool(job.primaryToolId)!.id];
      expectToneIcon(cards[i], tone);
    });
  });

  it("More in <section> washes each tool in the section's tone", () => {
    const { container } = render(<RelatedTools toolId="wsjf" />);
    const tone = SECTION_TONE[getSectionForTool("wsjf")!.id];
    const items = Array.from(container.querySelectorAll("li"));
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expectToneIcon(li, tone);
  });
});

describe("home section rows", () => {
  it("show each section's drawing, still, from the server's props", () => {
    const { container } = render(<ToolSections sectionArt={SECTION_ART} />);
    const summaries = Array.from(container.querySelectorAll("summary"));
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      const svg = summary.querySelector("svg.ink-art")!;
      expect(svg).not.toBeNull();
      expect(SECTION_ART[svg.getAttribute("data-ink")!]).toBeDefined();
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.classList.contains("ink-still")).toBe(true);
    }
    expectInk(container, "run");
  });

  it("fall back to the section's icon without drawings", () => {
    const { container } = render(<ToolSections />);
    expect(container.querySelector("summary svg.ink-art")).toBeNull();
    expect(container.querySelector("summary svg")).not.toBeNull();
  });

  it("never import the drawing set into a client file", () => {
    for (const file of [
      "src/components/home/tool-sections.tsx",
      "src/components/home/home-page.tsx",
    ]) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src, file).not.toMatch(/from "@\/lib\/ink\/drawings\/sections"/);
    }
    const page = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(page).not.toMatch(/^"use client"/);
    expect(page).toContain("sectionArt={SECTION_ART}");
  });
});

describe("/s snapshot", () => {
  it("scribbles while it opens the link", () => {
    // The server render is the loading state: the hash is read after mount.
    const html = renderToStaticMarkup(<SnapshotClient />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-ink="scribble"');
  });

  it("draws the broken link for a link with no snapshot", async () => {
    await act(async () => {
      render(<SnapshotClient />);
    });
    expect(screen.getByRole("heading", { name: "No snapshot in this link" })).toBeInTheDocument();
    expectInk(document.body, "broken-link");
  });

  it("adds the broken link to PAGE_ART, so the drawing budgets cover it", () => {
    expect(PAGE_ART["broken-link"].name).toBe("broken-link");
  });
});

describe("guest pages", () => {
  it("/guest/join shows the squad over its heading", () => {
    const { container } = render(<JoinClient initialCode="" nextUrl="/guest" />);
    const svg = expectInk(container, "squad");
    expect(svg.closest("header")).toContainElement(
      screen.getByRole("heading", { name: "Join as a guest" })
    );
  });

  it("the empty guest home waits with the hourglass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 }))
    );
    await act(async () => {
      render(
        <GuestHomeClient
          profile={{ id: "p", displayName: "Sam", color: "#123456", squadId: "s" }}
        />
      );
    });
    const empty = (await screen.findByText("No sessions yet")).closest("section")!;
    expectInk(empty, "hourglass");
  });

  it("the tool placeholder carries the toolbox beside its title", () => {
    const { container } = render(
      <GuestToolPlaceholder
        toolId="dot-voting"
        entityId="e1"
        role="viewer"
        profile={{ id: "p", displayName: "Sam", color: "#123456" }}
      />
    );
    const svg = expectInk(container, "toolbox");
    expect(svg.parentElement).toContainElement(screen.getByRole("heading", { name: "Dot Voting" }));
  });
});

describe("/not-authorized", () => {
  it("draws the owner's key in place of the ⊘ badge", () => {
    const html = renderToStaticMarkup(<NotAuthorizedPage />);
    expect(html).toContain('data-ink="key"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("⊘");
  });
});
