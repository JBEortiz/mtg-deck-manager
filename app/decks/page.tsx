import { parseDeckListFilters } from "@/lib/deck-browsing";
import DeckListClient from "@/components/DeckListClient";
import { redirectIfUnauthenticated } from "@/lib/server/auth";
import { getDecksByOwner } from "@/lib/server/mtg-data";

type DecksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DecksPage({ searchParams }: DecksPageProps) {
  const currentUser = await redirectIfUnauthenticated("/decks");
  let decks = [] as Awaited<ReturnType<typeof getDecksByOwner>>;
  let errorMessage: string | null = null;
  const filters = parseDeckListFilters(await searchParams);

  try {
    decks = await getDecksByOwner(currentUser.id);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Could not load decks.";
  }

  return <DeckListClient initialDecks={decks} initialError={errorMessage} initialFilters={filters} />;
}
