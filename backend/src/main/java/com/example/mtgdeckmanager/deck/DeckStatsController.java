package com.example.mtgdeckmanager.deck;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/decks")
public class DeckStatsController {

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;

    public DeckStatsController(DeckRepository deckRepository, CardRepository cardRepository) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
    }

    @GetMapping("/{id}/stats")
    public DeckStatsResponse getDeckStats(@PathVariable Long id) {
        if (!deckRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }

        List<Card> cards = cardRepository.findAllByDeckIdOrderByIdAsc(id);

        int totalCards = 0;
        Map<String, Integer> byColor = new LinkedHashMap<>();
        Map<String, Integer> byType = new LinkedHashMap<>();
        Map<Integer, Integer> manaCurve = new LinkedHashMap<>();

        for (Card card : cards) {
            int quantity = card.getQuantity();
            totalCards += quantity;

            byType.merge(card.getType(), quantity, Integer::sum);
            manaCurve.merge(card.getManaValue(), quantity, Integer::sum);

            String colors = card.getColors() == null ? "" : card.getColors();
            String[] parts = colors.split(",");
            boolean hasColor = false;
            for (String part : parts) {
                String color = part.trim();
                if (!color.isEmpty()) {
                    byColor.merge(color, quantity, Integer::sum);
                    hasColor = true;
                }
            }
            if (!hasColor) {
                byColor.merge("Colorless", quantity, Integer::sum);
            }
        }

        return new DeckStatsResponse(totalCards, byColor, byType, manaCurve);
    }

    public record DeckStatsResponse(
            Integer totalCards,
            Map<String, Integer> byColor,
            Map<String, Integer> byType,
            Map<Integer, Integer> manaCurve
    ) {
    }
}
