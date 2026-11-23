import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { HowItWorks } from "@/components/tool-frame/how-it-works";
import { ToolGuideProvider } from "@/components/tool-frame/tool-guide-context";
import { getGuide } from "@/lib/tools/guides";

/** The panel as a tool's page shows it: the guide comes from the route layout. */
async function panel(toolId: string, guideOf = toolId) {
  const guide = (await getGuide(guideOf)) ?? null;
  return (
    <ToolGuideProvider guide={guide}>
      <HowItWorks toolId={toolId} />
    </ToolGuideProvider>
  );
}

describe("HowItWorks", () => {
  it("shows the method guide for a tool", async () => {
    render(await panel("wsjf"));
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    expect(screen.getByText(/cost of delay ÷ job size/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /modified Fibonacci/ })).toBeInTheDocument();
  });

  it("renders nothing for tools without a guide", async () => {
    const { container } = render(await panel("comics"));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing outside a tool's route, where no layout hands a guide over", () => {
    const { container } = render(<HowItWorks toolId="wsjf" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never shows another tool's guide under this tool's title", async () => {
    const { container } = render(await panel("wsjf", "retro"));
    expect(container).toBeEmptyDOMElement();
  });

  it("has the whole guide in the server's HTML, inside the collapsed panel", async () => {
    const guide = (await getGuide("kanban"))!;
    const host = document.createElement("div");
    host.innerHTML = renderToString(await panel("kanban"));
    const details = host.querySelector("details")!;
    // Collapsed, so the page looks as it did; the text is there all the same.
    expect(details).not.toHaveAttribute("open");
    const text = details.textContent ?? "";
    expect(text).toContain("How this works");
    expect(text).toContain("When to use it");
    expect(text).toContain("How to run it");
    for (const line of [guide.summary, ...guide.whenToUse, ...guide.steps, ...(guide.tips ?? [])]) {
      expect(text, line).toContain(line);
    }
  });

  it("shows the summary beside the heading while collapsed, with no dash before it", async () => {
    const guide = (await getGuide("kanban"))!;
    const { container } = render(await panel("kanban"));
    const header = container.querySelector("summary")!;
    const heading = header.querySelector("h2")!;
    const teaser = header.querySelector("span")!;
    expect(heading.textContent).toBe("How this works");
    // The guide's own sentence and nothing else: the header adds no dash.
    expect(teaser.textContent).toBe(guide.summary);
    expect(header.textContent).toBe(`How this works${guide.summary}`);
    expect(header.textContent).not.toMatch(/[—–]/);
    // Hidden once the panel is open, where the summary is the first line.
    expect(teaser).toHaveClass("sm:group-open:hidden");
  });

  it("renders the same on the server and in the browser, so nothing moves on load", async () => {
    const ui = await panel("kanban");
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = renderToString(ui);
    const before = host.innerHTML;
    const errors: unknown[] = [];
    const { unmount } = render(ui, {
      container: host,
      hydrate: true,
      onRecoverableError: (error) => errors.push(error),
    });
    expect(errors).toEqual([]);
    expect(host.innerHTML).toBe(before);
    expect(host.querySelector("details")).not.toHaveAttribute("open");
    unmount();
    host.remove();
  });

  it("ends the open guide with Hide guide, which closes it and goes back to the header", async () => {
    const { container } = render(await panel("wsjf"));
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    details.open = true;

    const hide = screen.getByRole("button", { name: "Hide guide" });
    // It comes after the guide's last section, so it's where a reader ends up.
    const sections = Array.from(details.querySelectorAll("h3"));
    expect(
      sections[sections.length - 1].compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(hide);
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });

  it("brings the header back clear of the sticky app bar, not under it", async () => {
    // Firefox scrolls a focused element to the nearest edge (the top), where
    // the sticky header sits; the scroll margin keeps the summary below it.
    const { container } = render(await panel("wsjf"));
    expect(container.querySelector("summary")).toHaveClass("scroll-mt-20");
  });

  it("keeps desktop as it was: the Hide guide row is gone from lg up", async () => {
    render(await panel("wsjf"));
    const hide = screen.getByRole("button", { name: "Hide guide" });
    expect(hide).toHaveAttribute("type", "button");
    expect(hide.parentElement).toHaveClass("lg:hidden");
  });

  it("keeps Hide guide 44px on touch screens wider than md (landscape phone, tablet)", async () => {
    render(await panel("wsjf"));
    const hide = screen.getByRole("button", { name: "Hide guide" });
    // Button is 44px below md. On touch it keeps 44px at md too; the md sits in
    // the variant so the rule is emitted after a width-scoped md:min-h-9 in
    // Button (a bare pointer-coarse: rule would come before it). Button's own
    // desktop size is its business (md:min-h-9 or md-fine:min-h-9).
    expect(hide).toHaveClass("min-h-[44px]", "pointer-coarse:md:min-h-11");
  });
});
