import type { Metadata, Viewport } from "next";
import { CanvasClient } from "./canvas-client";

export const metadata: Metadata = {
  title: "Canvas — Agile Toolkit",
  description:
    "Infinite collaborative whiteboard with stickies, shapes, free-hand drawing, smart connectors, real-time multiplayer, and AI cluster analysis.",
};

// Per-route viewport override. The app-wide viewport (src/app/viewport.ts)
// allows maximumScale: 5 so screen-reader / low-vision users can pinch the
// rest of the app. On the canvas we own the pinch gesture ourselves
// (zoom-to-pinch-centre via @use-gesture/react in useCanvasTouchGestures),
// so the OS pinch must be locked out — otherwise the page zoom fights
// the canvas zoom and the user gets a doubled effect that desyncs the
// world transform.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function Page() {
  return <CanvasClient />;
}
