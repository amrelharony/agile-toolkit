import type { Metadata } from "next";
import { CanvasClient } from "./canvas-client";

export const metadata: Metadata = {
  title: "Canvas — Agile Toolkit",
  description:
    "Infinite collaborative whiteboard with stickies, shapes, free-hand drawing, smart connectors, real-time multiplayer, and AI cluster analysis.",
};

export default function Page() {
  return <CanvasClient />;
}
