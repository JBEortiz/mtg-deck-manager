import CardDetailClient from "@/components/CardDetailClient";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getCardDetailByIdentity } from "@/lib/server/mtg-data";
import type { CardDetail } from "@/lib/types";

type Params = {
  params: Promise<{ identity: string }>;
};

export default async function CardDetailPage({ params }: Params) {
  const currentUser = await redirectIfUnauthenticated("/decks");
  const { identity } = await params;
  const initialPreferences = {
    preferredDisplayCurrency: currentUser.preferredDisplayCurrency ?? "USD",
    showPriceFreshness: currentUser.showPriceFreshness !== false
  } as const;

  let initialData: CardDetail | null = null;
  let initialError = "";

  try {
    initialData = await getCardDetailByIdentity(identity, currentUser.id);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "No se pudo cargar el detalle de la carta.";
  }

  return (
    <CardDetailClient
      identity={identity}
      initialData={initialData}
      initialError={initialError}
      initialPreferences={initialPreferences}
    />
  );
}
