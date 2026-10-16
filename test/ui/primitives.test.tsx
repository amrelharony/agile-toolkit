import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconButton } from "@/components/ui/icon-button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LiveAnnouncerProvider, useAnnounce } from "@/components/a11y/live-announcer";

describe("IconButton", () => {
  it("is named by its label", () => {
    render(
      <TooltipProvider>
        <IconButton label="Delete row" icon={<Trash2 aria-hidden="true" />} />
      </TooltipProvider>
    );
    expect(screen.getByRole("button", { name: "Delete row" })).toBeInTheDocument();
  });
});

describe("ToggleGroup", () => {
  const options = [
    { value: 0.5, label: "Low" },
    { value: 1, label: "Medium" },
    { value: 2, label: "High" },
  ];

  it("exposes a named radiogroup with the checked option", () => {
    render(<ToggleGroup label="Impact" options={options} value={1} onValueChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Impact" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("aria-checked", "true");
    // One tab stop for the whole group.
    const tabbable = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  it("moves selection with the arrow keys", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup label="Impact" options={options} value={1} onValueChange={onValueChange} />
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Medium" }), { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith(2);
  });
});

describe("Field", () => {
  it("labels the control and links hint and error", () => {
    render(
      <Field label="Story points" hint="Fibonacci" error="Required" required>
        {(props) => <Input {...props} />}
      </Field>
    );
    const input = screen.getByLabelText(/Story points/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAccessibleDescription("Fibonacci Required");
  });
});

describe("LiveAnnouncer", () => {
  it("announces messages in the polite region", () => {
    vi.useFakeTimers();
    function Trigger() {
      const announce = useAnnounce();
      return <button onClick={() => announce("Votes revealed")}>Reveal</button>;
    }
    render(
      <LiveAnnouncerProvider>
        <Trigger />
      </LiveAnnouncerProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId("live-polite")).toHaveTextContent("Votes revealed");
    vi.useRealTimers();
  });
});

describe("Slider", () => {
  it("names the thumb (the role=slider element) from the slider's aria-label", async () => {
    const { Slider } = await import("@/components/ui/slider");
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    render(<Slider aria-label="Confidence" defaultValue={[50]} max={100} />);
    expect(screen.getByRole("slider", { name: "Confidence" })).toBeInTheDocument();
  });
});

describe("CardTitle", () => {
  it("is a heading", async () => {
    const { Card, CardHeader, CardTitle } = await import("@/components/ui/card");
    render(
      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
        </CardHeader>
      </Card>
    );
    expect(screen.getByRole("heading", { level: 3, name: "Team members" })).toBeInTheDocument();
  });
});
