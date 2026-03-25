package com.example.mtgdeckmanager.deck;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/decks")
public class DeckController {

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;
    private final DeckValidationService deckValidationService;

    public DeckController(DeckRepository deckRepository, CardRepository cardRepository, DeckValidationService deckValidationService) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
        this.deckValidationService = deckValidationService;
    }

    @GetMapping
    public List<DeckResponse> listDecks() {
        return deckRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(DeckResponse::from)
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DeckResponse createDeck(@Valid @RequestBody CreateDeckRequest request) {
        Deck deck = new Deck();
        deck.setName(request.name());
        deck.setFormat(request.format());
        deck.setCommander(request.commander());

        Deck saved = deckRepository.save(deck);
        return DeckResponse.from(saved);
    }

    @GetMapping("/{id}")
    public DeckResponse getDeck(@PathVariable Long id) {
        Deck deck = deckRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));
        return DeckResponse.from(deck);
    }

    @PutMapping("/{id}")
    public DeckResponse updateDeck(@PathVariable Long id, @Valid @RequestBody UpdateDeckRequest request) {
        Deck deck = deckRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));

        deck.setName(request.name());
        deck.setFormat(request.format());
        deck.setCommander(request.commander());

        List<Card> cards = cardRepository.findAllByDeckIdOrderByIdAsc(id);
        deckValidationService.validateDeckState(deck, cards);

        Deck saved = deckRepository.save(deck);
        return DeckResponse.from(saved);
    }

    public record CreateDeckRequest(
            @NotBlank String name,
            @NotBlank String format,
            @NotBlank String commander
    ) {
    }

    public record UpdateDeckRequest(
            @NotBlank String name,
            @NotBlank String format,
            @NotBlank String commander
    ) {
    }

    public record DeckResponse(
            Long id,
            String name,
            String format,
            String commander,
            Instant createdAt
    ) {
        static DeckResponse from(Deck deck) {
            return new DeckResponse(
                    deck.getId(),
                    deck.getName(),
                    deck.getFormat(),
                    deck.getCommander(),
                    deck.getCreatedAt()
            );
        }
    }
}
