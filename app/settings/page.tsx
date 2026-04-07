import UserPricingSettingsClient from "@/components/UserPricingSettingsClient";
import { redirectIfUnauthenticated } from "@/lib/server/auth";

export default async function SettingsPage() {
  const currentUser = await redirectIfUnauthenticated("/settings");
  return (
    <UserPricingSettingsClient
      initialPreferences={{
        preferredDisplayCurrency: currentUser.preferredDisplayCurrency ?? "USD",
        showPriceFreshness: currentUser.showPriceFreshness !== false
      }}
    />
  );
}
