import type { Metadata } from "next";
import { BurndownClient } from "./burndown-client";

export const metadata: Metadata = {
  title: "Burndown Generator",
  description:
    "Interactive sprint burndown chart with ideal line, actual progress, today marker, and scope change annotations.",
};

export default function BurndownPage() {
  return <BurndownClient />;
}
