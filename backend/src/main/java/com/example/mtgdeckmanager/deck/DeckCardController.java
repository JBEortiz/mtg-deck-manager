package com.example.mtgdeckmanager.deck;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Comparator;
import java.util.List;

@RestController
@RequestMapping("/api/decks/{deckId}/cards")
public class DeckCardController {

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;
    private final DeckValidationService deckValidationService;

    public DeckCardController(DeckRepository deckRepository, CardRepository cardRepository, DeckValidationService deckValidationService) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
        this.deckValidationService = deckValidationService;
    }

    @GetMapping
    public List<CardResponse> listCards(
            @PathVariable Long deckId,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String color,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String direction
    ) {
        if (!deckRepository.existsById(deckId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }

        List<Card> cards = cardRepository.findAllByDeckIdOrderByIdAsc(deckId);

        if (name != null && !name.isBlank()) {
            String search = name.trim().toLowerCase();
            cards = cards.stream()
                    .filter(card -> card.getName() != null && card.getName().toLowerCase().contains(search))
                    .toList();
        }

        if (type != null && !type.isBlank()) {
            String exactType = type.trim();
            cards = cards.stream()
                    .filter(card -> card.getType() != null && card.getType().equalsIgnoreCase(exactType))
                    .toList();
        }

        if (color != null && !color.isBlank()) {
            String exactColor = color.trim();
            cards = cards.stream()
                    .filter(card -> hasColor(card.getColors(), exactColor))
                    .toList();
        }

        Comparator<Card> comparator = null;
        if ("name".equalsIgnoreCase(sortBy)) {
            comparator = Comparator.comparing(card -> card.getName() == null ? "" : card.getName(), String.CASE_INSENSITIVE_ORDER);
        } else if ("manaValue".equalsIgnoreCase(sortBy)) {
            comparator = Comparator.comparing(card -> card.getManaValue() == null ? 0 : card.getManaValue());
        }

        if (comparator != null) {
            if ("desc".equalsIgnoreCase(direction)) {
                comparator = comparator.reversed();
            }
            cards = cards.stream().sorted(comparator).toList();
        }

        return cards.stream().map(CardResponse::from).toList();
    }

    private boolean hasColor(String colors, String expectedColor) {
        if (colors == null) {
            return false;
        }

        String[] parts = colors.split(",");
        for (String part : parts) {
            if (part.trim().equalsIgnoreCase(expectedColor)) {
                return true;
            }
        }
        return false;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CardResponse addCard(@PathVariable Long deckId, @Valid @RequestBody CreateCardRequest request) {
        Deck deck = deckRepository.findById(deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));

        List<Card> existingCards = cardRepository.findAllByDeckIdOrderByIdAsc(deckId);
        deckValidationService.validateCardAddition(deck, existingCards, request.name(), request.type(), request.quantity());

        Card card = new Card();
        card.setDeck(deck);
        card.setName(request.name());
        card.setManaValue(request.manaValue());
        card.setType(request.type());
        card.setColors(request.colors());
        card.setQuantity(request.quantity());

        Card saved = cardRepository.save(card);
        return CardResponse.from(saved);
    }

    @DeleteMapping("/{cardId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteCard(@PathVariable Long deckId, @PathVariable Long cardId) {
        Card card = cardRepository.findByIdAndDeckId(cardId, deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Card not found"));
        cardRepository.delete(card);
    }

    public record CreateCardRequest(
            @NotBlank String name,
            @NotNull @Min(0) Integer manaValue,
            @NotBlank String type,
            @NotBlank String colors,
            @NotNull @Min(1) Integer quantity
    ) {
    }

    public record CardResponse(
            Long id,
            String name,
            Integer manaValue,
            String type,
            String colors,
            Integer quantity
    ) {
        static CardResponse from(Card card) {
            return new CardResponse(
                    card.getId(),
                    card.getName(),
                    card.getManaValue(),
                    card.getType(),
                    card.getColors(),
                    card.getQuantity()
            );
        }
    }
}
