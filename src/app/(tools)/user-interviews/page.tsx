import { UserInterviewsClient } from "./user-interviews-client";

export const metadata = {
  title: "User Interview Log",
  description: "Capture research interviews with quotes, themes, and tag-frequency heatmap.",
};

export default function Page() {
  return <UserInterviewsClient />;
}
