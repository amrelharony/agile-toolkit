import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QrCode } from "@/components/collab/qr-code";
import { QR_MAX_BYTES, QR_QUIET_ZONE, encodeQr } from "@/lib/qr/encode";
import { decodeQr, rasterisePath, stripQuietZone } from "../qr/decoder";

/** The modules an SVG from <QrCode> draws, without its quiet zone. */
function modulesOf(svg: Element): boolean[][] {
  const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  return stripQuietZone(rasterisePath(d, side), QR_QUIET_ZONE);
}

describe("QrCode", () => {
  const LINK =
    "https://agile.amrelharony.com/join/kano-model/ABCDEFGHJKMN#k=abcdefghijklmnopqrstuv";

  it("draws the encoder's symbol, quiet zone included, as a labelled image", () => {
    render(<QrCode text={LINK} label="QR code for the join link" />);
    const svg = screen.getByRole("img", { name: "QR code for the join link" });
    const qr = encodeQr(LINK);
    expect(qr).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${qr!.size + 8} ${qr!.size + 8}`);
    expect(modulesOf(svg)).toEqual(qr!.modules);
    expect(decodeQr(modulesOf(svg)).text).toBe(LINK);
  });

  it("stays black on white whatever the theme, with crisp module edges", () => {
    render(<QrCode text={LINK} label="QR code" />);
    const svg = screen.getByRole("img", { name: "QR code" });
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe("#000000");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
  });

  it("shows the fallback for a text too long for a QR code, or an empty one", () => {
    const { rerender } = render(
      <QrCode text={"x".repeat(QR_MAX_BYTES + 1)} label="QR code" fallback={<p>Too long</p>} />
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Too long")).toBeInTheDocument();
    rerender(<QrCode text="" label="QR code" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
