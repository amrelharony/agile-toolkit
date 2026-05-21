import type { Metadata } from "next";
import { CynefinClient } from "./cynefin-client";

export const metadata: Metadata = {
  title: "Cynefin Decision Picker — Agile Toolkit",
  description:
    "Snowden's framework that places problems into Clear / Complicated / Complex / Chaotic / Confused domains.",
};

export default function Page() {
  return <CynefinClient />;
}
