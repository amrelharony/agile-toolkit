import { OneOnOneClient } from "./one-on-one-client";

export const metadata = {
  title: "1:1 Meeting Tracker",
  description: "Manager-IC 1:1 log with rolling agenda, action items, and growth themes.",
};

export default function Page() {
  return <OneOnOneClient />;
}
