import { NotificationsClient } from "./notifications-client";

export const metadata = {
  title: "Notifications",
  description:
    "Celebrations, progress, pop-ups, sound, vibration, Focus and quiet hours for this browser.",
};

export default function NotificationsPage() {
  return (
    <div className="container-tool py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-fluid-h2 font-semibold text-text">Notifications</h1>
        <p className="text-sub max-w-2xl">
          Choose how much the toolkit tells you and when. Everything here stays in this browser.
          Finished work always lands in Activity, whatever you pick.
        </p>
      </header>
      <NotificationsClient />
    </div>
  );
}
