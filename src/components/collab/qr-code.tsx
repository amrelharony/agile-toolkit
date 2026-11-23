"use client";

import { useMemo, type ReactNode } from "react";
import { QR_QUIET_ZONE, encodeQr, qrPath } from "@/lib/qr/encode";
import { cn } from "@/lib/utils";

/**
 * A QR code for `text`, drawn as inline SVG by our own encoder
 * (`lib/qr/encode`), with the four light modules round it that a scanner
 * needs.
 *
 * It stays black on white in every theme, a deliberate exception to the
 * tokens: phone cameras look for dark modules on a light ground, and many
 * can't read a code in reverse, so it doesn't follow Night or High
 * contrast. `crispEdges` keeps the modules from blurring into one another.
 *
 * Renders `fallback` (nothing by default) when the text is empty or too
 * long for a QR code (over `QR_MAX_BYTES` bytes).
 */
export function QrCode({
  text,
  label,
  className,
  fallback = null,
}: {
  text: string;
  /** What the code opens, for screen readers, e.g. "QR code for the join link". */
  label: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const qr = useMemo(() => encodeQr(text), [text]);
  if (!qr) return <>{fallback}</>;
  const side = qr.size + 2 * QR_QUIET_ZONE;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("block aspect-square", className)}
      data-qr-version={qr.version}
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(qr)} fill="#000000" />
    </svg>
  );
}
