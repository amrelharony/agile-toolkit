import { NotificationsClient } from "./notifications-client";
import { SettingsHeader } from "@/components/settings/settings-header";
import { bellArt } from "@/lib/ink/drawings/pages/bell";

export const metadata = {
  title: "Notifications",
  description:
    "Celebrations, progress, pop-ups, sound, vibration, Focus and quiet hours for this browser.",
};

export default function NotificationsPage() {
  return (
    <div className="container-tool py-8">
      <SettingsHeader title="Notifications" art={bellArt}>
        Choose how much the toolkit tells you and when. Everything here stays in this browser.
        Finished work always lands in Activity, whatever you pick.
      </SettingsHeader>
      <NotificationsClient />
    </div>
  );
}
