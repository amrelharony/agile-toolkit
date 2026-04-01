import type { Metadata } from "next";
import { RetroClient } from "./retro-client";

export const metadata: Metadata = { title: "Retro Board" };

export default function RetroPage() {
  return <RetroClient />;
}
