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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/decks/{deckId}/cards")
public class DeckCardController {

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;

    public DeckCardController(DeckRepository deckRepository, CardRepository cardRepository) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
    }

    @GetMapping
    public List<CardResponse> listCards(@PathVariable Long deckId) {
        if (!deckRepository.existsById(deckId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }

        return cardRepository.findAllByDeckIdOrderByIdAsc(deckId).stream()
                .map(CardResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CardResponse addCard(@PathVariable Long deckId, @Valid @RequestBody CreateCardRequest request) {
        Deck deck = deckRepository.findById(deckId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));

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
