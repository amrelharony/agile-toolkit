import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The header's breadcrumb on the private comic page. The comic is in no
 * registry, so without special handling the breadcrumb called it "Home"
 * (aria-current="page") on phones. It must name the comic, and only by the
 * title the mounted reader gives it (lib/stores/reader-page-store): the
 * path carries the secret token, and the header never looks at it. Without
 * a mounted reader, a /comic/ path is just another unknown page. The
 * header's widgets are stubbed — this is only about the breadcrumb.
 */

const h = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ status: "anonymous", error: null }),
  useAuthOptional: () => ({ status: "anonymous", user: null, error: null }),
}));
vi.mock("@/lib/sync/owner-sync-gate", () => ({
  setVisitorDataPromptOpen: () => {},
  useOwnerSeen: () => false,
  useOwnerSyncGateStore: (select: (s: { promptOpen: boolean }) => unknown) =>
    select({ promptOpen: false }),
  useVisitorDataPending: () => false,
}));
vi.mock("@/lib/utils/clear-local-data", () => ({
  installLocalDataChannelListener: () => () => {},
}));
vi.mock("@/lib/agent/store", () => ({
  useAgentStore: (select: (s: { openSheet: () => void }) => unknown) =>
    select({ openSheet: () => {} }),
}));
vi.mock("@/lib/stores/kudos-settings-store", () => ({
  useKudosSettingsStore: (select: (s: { beaconHeader: boolean }) => unknown) =>
    select({ beaconHeader: false }),
}));
vi.mock("@/components/shared/sonification-toggle", () => ({ SonificationToggle: () => null }));
vi.mock("@/components/ai/llm-status-chip", () => ({ LlmStatusChip: () => null }));
vi.mock("@/components/gamification/xp-bar", () => ({ XpBar: () => null }));
vi.mock("@/lib/weather/widget", () => ({ WeatherWidget: () => null }));
vi.mock("@/components/auth/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/auth/visitor-data-merge-dialog", () => ({
  VisitorDataMergeDialog: () => null,
}));
vi.mock("@/lib/kudos/beacon/header-beacon", () => ({ KudosHeaderBeacon: () => null }));

import { Header } from "@/components/layout/header";
import { tools } from "@/lib/constants/tools";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

/** Shaped like a real token ([A-Za-z0-9_-], 32 chars); not the real one. */
const DUMMY_TOKEN = "Dummy_Token-For-Header-Tests-012";

function currentPage(): HTMLElement {
  const nodes = document.querySelectorAll<HTMLElement>('[aria-current="page"]');
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

beforeEach(() => {
  h.pathname = "/";
  useReaderPageStore.setState({ title: null });
});

describe("Header breadcrumb", () => {
  it("names the mounted reader page by its title, never by its path", () => {
    h.pathname = `/comic/${DUMMY_TOKEN}`;
    useReaderPageStore.setState({ title: "Agile at Work" });
    const { container } = render(<Header onOpenSearch={() => {}} />);

    expect(currentPage()).toHaveTextContent("Agile at Work");
    expect(screen.queryByText("Home", { selector: '[aria-current="page"]' })).toBeNull();
    expect(container.innerHTML).not.toContain(DUMMY_TOKEN);
  });

  it("follows the reader as it mounts and unmounts", () => {
    render(<Header onOpenSearch={() => {}} />);
    expect(currentPage()).toHaveTextContent("Home");

    act(() => useReaderPageStore.getState().enter("Agile at Work"));
    expect(currentPage()).toHaveTextContent("Agile at Work");

    act(() => useReaderPageStore.getState().leave());
    expect(currentPage()).toHaveTextContent("Home");
  });

  it("treats a /comic/ path without a mounted reader like any other page", () => {
    h.pathname = `/comic/${DUMMY_TOKEN}`;
    const { container } = render(<Header onOpenSearch={() => {}} />);

    expect(currentPage()).toHaveTextContent("Home");
    expect(container.innerHTML).not.toContain("Agile at Work");
    expect(container.innerHTML).not.toContain(DUMMY_TOKEN);
  });

  it("still calls the home page Home", () => {
    render(<Header onOpenSearch={() => {}} />);
    expect(currentPage()).toHaveTextContent("Home");
  });

  it("still names a tool page by the tool", () => {
    const tool = tools[0];
    h.pathname = tool.path;
    render(<Header onOpenSearch={() => {}} />);
    expect(currentPage()).toHaveTextContent(tool.name);
  });
});
