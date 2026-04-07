import BuyOpportunitiesClient from "@/components/BuyOpportunitiesClient";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getBuyOpportunitiesByOwner } from "@/lib/server/mtg-data";
import type { BuyOpportunities } from "@/lib/types";

const EMPTY_DATA: BuyOpportunities = {
  generatedAt: new Date().toISOString(),
  currency: "USD",
  sort: "best-opportunity",
  filters: {
    signal: "all",
    deckId: "all",
    historyStatus: "all"
  },
  availableDecks: [],
  items: []
};

export default async function BuyOpportunitiesPage() {
  const currentUser = await redirectIfUnauthenticated("/buy-opportunities");
  const initialPreferences = {
    preferredDisplayCurrency: currentUser.preferredDisplayCurrency ?? "USD",
    showPriceFreshness: currentUser.showPriceFreshness !== false
  } as const;

  try {
    const data = await getBuyOpportunitiesByOwner(currentUser.id, { sort: "best-opportunity" });
    return <BuyOpportunitiesClient initialData={data} initialError="" initialPreferences={initialPreferences} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar oportunidades de compra.";
    return <BuyOpportunitiesClient initialData={EMPTY_DATA} initialError={message} initialPreferences={initialPreferences} />;
  }
}
