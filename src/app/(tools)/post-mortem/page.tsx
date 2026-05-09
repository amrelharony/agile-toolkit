import { PostMortemClient } from "./post-mortem-client";

export const metadata = {
  title: "Blameless Post-Mortem — Agile Toolkit",
  description:
    "Structured post-mortem with timeline, contributing factors, and action items — distinct from sprint retro.",
};

export default function Page() {
  return <PostMortemClient />;
}
