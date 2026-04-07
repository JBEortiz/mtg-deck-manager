import CollectorOverviewClient from "@/components/CollectorOverviewClient";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getCollectorOverviewByOwner } from "@/lib/server/mtg-data";
import type { CollectorOverview } from "@/lib/types";

const EMPTY_DATA: CollectorOverview = {
  generatedAt: new Date().toISOString(),
  currency: "USD",
  sort: "latest-purchase",
  filters: {
    deckId: "all",
    profitability: "all",
    priceData: "all"
  },
  availableDecks: [],
  items: []
};

export default async function CollectorOverviewPage() {
  const currentUser = await redirectIfUnauthenticated("/collector-overview");
  const initialPreferences = {
    preferredDisplayCurrency: currentUser.preferredDisplayCurrency ?? "USD",
    showPriceFreshness: currentUser.showPriceFreshness !== false
  } as const;
  try {
    const data = await getCollectorOverviewByOwner(currentUser.id, { sort: "latest-purchase" });
    return <CollectorOverviewClient initialData={data} initialError="" initialPreferences={initialPreferences} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el collector overview.";
    return <CollectorOverviewClient initialData={EMPTY_DATA} initialError={message} initialPreferences={initialPreferences} />;
  }
}
