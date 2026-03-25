package com.example.mtgdeckmanager.deck;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
        Map<String, Integer> quantityByName = new HashMap<>();
        Map<String, String> typeByName = new HashMap<>();

        int totalCards = 0;
        for (Card card : existingCards) {
            String normalizedName = normalize(card.getName());
            if (normalizedName.isEmpty()) {
                continue;
            }

            int quantity = card.getQuantity() == null ? 0 : card.getQuantity();
            totalCards += quantity;
            quantityByName.merge(normalizedName, quantity, Integer::sum);
            typeByName.putIfAbsent(normalizedName, safe(card.getType()));
        }

        for (CandidateCard card : toAdd) {
            String normalizedName = normalize(card.name());
            if (normalizedName.isEmpty()) {
                continue;
            }

            int quantity = card.quantity();
            totalCards += quantity;
            quantityByName.merge(normalizedName, quantity, Integer::sum);
            typeByName.putIfAbsent(normalizedName, safe(card.type()));
        }

        if (totalCards > 100) {
            errors.add("Commander decks cannot exceed 100 total cards.");
        }

        String commanderName = normalize(deck.getCommander());
        int commanderCount = quantityByName.getOrDefault(commanderName, 0);
        if (commanderCount != 1) {
            errors.add("Commander decks must include exactly 1 copy of the commander card: " + safe(deck.getCommander()) + ".");
        }

        Set<String> repeatedNonBasic = new HashSet<>();
        for (Map.Entry<String, Integer> entry : quantityByName.entrySet()) {
            String cardName = entry.getKey();
            int quantity = entry.getValue();
            String cardType = typeByName.getOrDefault(cardName, "");

            if (quantity > 1 && !isBasicLand(cardName, cardType)) {
                repeatedNonBasic.add(cardName);
            }
        }

        for (String cardName : repeatedNonBasic) {
            errors.add("Non-basic cards cannot exceed quantity 1: " + cardName + ".");
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
