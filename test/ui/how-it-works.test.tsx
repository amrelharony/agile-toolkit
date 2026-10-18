import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HowItWorks } from "@/components/tool-frame/how-it-works";

beforeEach(() => localStorage.clear());

describe("HowItWorks", () => {
  it("shows the method guide for a tool", async () => {
    render(<HowItWorks toolId="wsjf" />);
    expect(await screen.findByText("How this works")).toBeInTheDocument();
    expect(screen.getByText(/cost of delay ÷ job size/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /modified Fibonacci/ })).toBeInTheDocument();
  });

  it("renders nothing for tools without a guide", async () => {
    const { container } = render(<HowItWorks toolId="agile-at-work" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on the first visit to a tool and stays collapsed after that", async () => {
    const first = render(<HowItWorks toolId="kanban" />);
    await screen.findByText("How this works");
    expect(first.container.querySelector("details")).toHaveAttribute("open");
    first.unmount();

    const again = render(<HowItWorks toolId="kanban" />);
    await screen.findByText("How this works");
    expect(again.container.querySelector("details")).not.toHaveAttribute("open");
  });
});
