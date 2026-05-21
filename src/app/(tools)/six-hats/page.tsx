import type { Metadata } from "next";
import { SixHatsClient } from "./six-hats-client";

export const metadata: Metadata = {
  title: "Six Thinking Hats — Agile Toolkit",
  description:
    "De Bono's six perspectives (facts / emotions / risks / benefits / creativity / process) for balanced thinking.",
};

export default function Page() {
  return <SixHatsClient />;
}
