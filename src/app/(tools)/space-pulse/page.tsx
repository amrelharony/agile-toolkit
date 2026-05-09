import { SpacePulseClient } from "./space-pulse-client";

export const metadata = {
  title: "SPACE Pulse — Agile Toolkit",
  description:
    "Quarterly self-rated SPACE survey across satisfaction, performance, activity, communication, and efficiency.",
};

export default function Page() {
  return <SpacePulseClient />;
}
