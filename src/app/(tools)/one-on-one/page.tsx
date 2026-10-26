import { OneOnOneClient } from "./one-on-one-client";

export const metadata = {
  title: "1:1 Meeting Tracker",
  description:
    "Manager-IC 1:1 log with a rolling agenda, action items through to done, and a cadence alert per report.",
};

export default function Page() {
  return <OneOnOneClient />;
}
