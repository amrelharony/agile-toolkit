/** The /vip hub: the tools and the next four weeks once unlocked, and nothing before. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

import { VipClient } from "@/app/vip/vip-client";
import type { StorySummary } from "@/lib/comics/types";
import { readVipHint } from "@/lib/vip/hint";

const STORY: StorySummary = {
  ep: 30,
  title: "An Early Story",
  lesson: "An early lesson.",
  castNames: [],
  themes: [],
  cover: null,
  releaseAt: "2026-11-09T07:00:00.000Z",
  updatedAt: "2026-11-01T07:00:00.000Z",
};

function clearCookie() {
  document.cookie = "agile-toolkit:vip-hint=; path=/; max-age=0";
}

beforeEach(clearCookie);
afterEach(() => {
  clearCookie();
  cleanup();
});

describe("/vip", () => {
  it("unlocked: the released tools and the next four weeks", () => {
    render(<VipClient access="unlocked" earlyComics={[STORY]} />);
    expect(screen.getByRole("link", { name: /Squad Session Kit/ })).toHaveAttribute(
      "href",
      "/squad-session"
    );
    expect(screen.getByRole("link", { name: /Meet the Cast/ })).toHaveAttribute(
      "href",
      "/meet-the-cast"
    );
    expect(screen.queryByRole("link", { name: /Which Colleague/ })).toBeNull();
    expect(screen.getByRole("link", { name: /An Early Story/ })).toHaveAttribute(
      "href",
      "/comics/early?ep=30"
    );
    expect(screen.getByText("Out Monday 9 November")).toBeInTheDocument();
  });

  it("Amr asks a plain question rather than telling anyone what to do", () => {
    render(<VipClient access="unlocked" />);
    const line = screen.getByText(/Would one of these help your team this week\?/);
    expect(line.textContent?.trim().endsWith("?")).toBe(true);
  });

  it("says so when there's nothing to read ahead", () => {
    render(<VipClient access="unlocked" earlyComics={[]} />);
    expect(screen.getByText(/Nothing to read ahead just now/)).toBeInTheDocument();
  });

  it("puts the hint back on a device the server unlocked", () => {
    expect(readVipHint()).toBe(false);
    render(<VipClient access="unlocked" />);
    expect(readVipHint()).toBe(true);
  });

  it.each([
    ["locked", "VIP access comes with the printed book"],
    ["invalid-link", "That link didn't open VIP access"],
  ] as const)("%s: how to get in, no tools, no hint", (access, message) => {
    render(<VipClient access={access} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Squad Session Kit/ })).toBeNull();
    expect(screen.queryByText(/next four weeks/)).toBeNull();
    expect(readVipHint()).toBe(false);
  });
});
