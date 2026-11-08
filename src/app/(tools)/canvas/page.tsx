import type { Metadata } from "next";
import { CanvasClient } from "./canvas-client";

export const metadata: Metadata = {
  title: "Canvas",
  description:
    "Infinite whiteboard with stickies, shapes, free-hand drawing, smart connectors and AI cluster analysis.",
};

// No per-route viewport: the app-wide one (app/layout.tsx) leaves browser
// zoom on, so low-vision users can pinch the page's text here too (WCAG
// 1.4.4). The board still owns a pinch that starts on it: its viewport is
// `touch-action: none` (whiteboard-canvas.tsx) and useBoardPinchGuard
// cancels the page pinch there for browsers that don't honour it, so the
// page zoom never fights the canvas zoom over the board. This route used
// to lock zoom for the whole page (maximum-scale=1, user-scalable=no).

export default function Page() {
  return <CanvasClient />;
}
