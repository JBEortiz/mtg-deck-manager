package com.example.mtgdeckmanager.deck;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class DeckValidationService {

    private static final Set<String> BASIC_LAND_NAMES = Set.of(
            "plains", "island", "swamp", "mountain", "forest", "wastes",
            "snow-covered plains", "snow-covered island", "snow-covered swamp",
            "snow-covered mountain", "snow-covered forest", "snow-covered wastes"
    );

    public void validateCardAddition(Deck deck, List<Card> existingCards, String name, String type, Integer quantity) {
        validateCommanderRules(deck, existingCards, List.of(new CandidateCard(name, type, quantity == null ? 0 : quantity)));
    }

    public void validateImport(Deck deck, List<Card> existingCards, List<CandidateCard> importedCards) {
        validateCommanderRules(deck, existingCards, importedCards);
    }

    public void validateDeckState(Deck deck, List<Card> existingCards) {
        validateCommanderRules(deck, existingCards, List.of());
    }

    private void validateCommanderRules(Deck deck, List<Card> existingCards, List<CandidateCard> toAdd) {
        if (!"commander".equalsIgnoreCase(safe(deck.getFormat()))) {
            return;
        }

        List<String> errors = new ArrayList<>();

        int totalCards = 0;
        for (Card card : existingCards) {
            int quantity = card.getQuantity() == null ? 0 : card.getQuantity();
            totalCards += quantity;
        }

        for (CandidateCard card : toAdd) {
            totalCards += Math.max(0, card.quantity());
        }

        if (totalCards > 100) {
            errors.add("Commander decks cannot exceed 100 total cards.");
        }

        if (!errors.isEmpty()) {
            throw new DeckValidationException(errors);
        }
    }

    public boolean isBasicLand(String cardName, String cardType) {
        String normalizedName = normalize(cardName);
        String normalizedType = normalize(cardType);

        boolean typeIndicatesBasic = normalizedType.contains("basic") && normalizedType.contains("land");
        boolean nameIndicatesBasic = BASIC_LAND_NAMES.contains(normalizedName);

        return typeIndicatesBasic || nameIndicatesBasic;
    }

    public String inferTypeForImportedCard(String cardName) {
        return isBasicLand(cardName, "") ? "Basic Land" : "Unknown";
    }

    public String inferColorsForImportedCard(String cardName) {
        String normalized = normalize(cardName);
        return switch (normalized) {
            case "plains", "snow-covered plains" -> "W";
            case "island", "snow-covered island" -> "U";
            case "swamp", "snow-covered swamp" -> "B";
            case "mountain", "snow-covered mountain" -> "R";
            case "forest", "snow-covered forest" -> "G";
            default -> "Colorless";
        };
    }

    private String normalize(String value) {
        return safe(value).trim().toLowerCase(Locale.ROOT);
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    public record CandidateCard(String name, String type, int quantity) {
    }
}
