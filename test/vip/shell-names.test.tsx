/**
 * The shell around a VIP page: a lock panel says nothing about what it holds, so
 * the header and the mascot's panel mustn't name the tool for it, in the server's
 * HTML or afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const h = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/auth/use-is-owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/use-is-owner")>()),
  useIsOwner: () => false,
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuth: () => ({ status: "anonymous", error: null }),
}));
vi.mock("@/components/gamification/xp-bar", () => ({ XpBar: () => null }));
vi.mock("@/components/shared/sonification-toggle", () => ({ SonificationToggle: () => null }));
vi.mock("@/components/ai/llm-status-chip", () => ({ LlmStatusChip: () => null }));
vi.mock("@/lib/weather/widget", () => ({ WeatherWidget: () => null }));
vi.mock("@/components/auth/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/auth/visitor-data-merge-dialog", () => ({
  VisitorDataMergeDialog: () => null,
}));
vi.mock("@/lib/kudos/beacon/header-beacon", () => ({ KudosHeaderBeacon: () => null }));

import { VisitorGuide } from "@/components/agent/mascot/visitor-guide";
import { Header } from "@/components/layout/header";
import { getToolById, tools } from "@/lib/constants/tools";
import { isVipOnly } from "@/lib/tools/catalog";
import { VIP_TITLE } from "@/lib/vip/constants";
import { clearVipHint, setVipHint } from "@/lib/vip/hint";

const VIP_TOOLS = tools.filter(isVipOnly);
const header = <Header onOpenSearch={() => {}} />;
/** A category as it reads in HTML, where "&" is escaped. */
const asHtml = (text: string) => text.replace(/&/g, "&amp;");

beforeEach(() => {
  clearVipHint();
});
afterEach(() => {
  clearVipHint();
  cleanup();
});

describe("the header on a VIP tool's address", () => {
  it("covers the three VIP tools", () => {
    expect(VIP_TOOLS.map((t) => t.path).sort()).toEqual([
      "/meet-the-cast",
      "/squad-session",
      "/which-colleague",
    ]);
  });

  it.each(VIP_TOOLS.map((t) => [t.path, t] as const))(
    "%s shows only the generic title, in the server's HTML too",
    (path, tool) => {
      h.pathname = path;
      const html = renderToString(header);
      expect(html).not.toContain(tool.name);
      expect(html).not.toContain(asHtml(tool.category));
      expect(html).toContain(VIP_TITLE);

      const { container } = render(header);
      expect(container.innerHTML).not.toContain(tool.name);
      expect(container.innerHTML).not.toContain(asHtml(tool.category));
      expect(screen.getByText(VIP_TITLE)).toBeInTheDocument();
    }
  );

  it.each(VIP_TOOLS.map((t) => [t.path, t] as const))(
    "%s reveals nothing more to a forged hint",
    (path, tool) => {
      setVipHint();
      h.pathname = path;
      const { container } = render(header);
      expect(container.innerHTML).not.toContain(tool.name);
      expect(container.innerHTML).not.toContain(asHtml(tool.category));
    }
  );

  it("still names an ordinary tool, with its category", () => {
    const retro = getToolById("retro")!;
    h.pathname = retro.path;
    render(header);
    expect(screen.getByText(retro.name)).toBeInTheDocument();
    expect(screen.getByText(retro.category)).toBeInTheDocument();
    expect(screen.queryByText(VIP_TITLE)).toBeNull();
  });

  it("calls a page that's no tool Home", () => {
    h.pathname = "/";
    render(header);
    expect(screen.queryByText(VIP_TITLE)).toBeNull();
    expect(screen.getAllByText("Home").length).toBeGreaterThan(0);
  });
});

describe("the mascot's panel on a VIP tool's address", () => {
  const panel = () => screen.queryByRole("region", { name: "This tool" });

  it.each(VIP_TOOLS.map((t) => [t.path, t] as const))(
    "%s goes unnamed without the hint",
    (path, tool) => {
      h.pathname = path;
      const { container } = render(<VisitorGuide />);
      expect(panel()).toBeNull();
      expect(container.innerHTML).not.toContain(tool.name);
    }
  );

  it("helps a book reader on Which Colleague, now it's released", () => {
    setVipHint();
    h.pathname = "/which-colleague";
    render(<VisitorGuide />);
    expect(panel()).toHaveTextContent("Which Colleague Are You?");
  });

  it("helps a book reader on a released tool", () => {
    setVipHint();
    h.pathname = "/squad-session";
    render(<VisitorGuide />);
    expect(panel()).toHaveTextContent("Squad Session Kit");
  });
});
