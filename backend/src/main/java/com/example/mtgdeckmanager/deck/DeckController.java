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
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/decks")
public class DeckController {

    private static final int PREVIEW_LIMIT = 5;

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;
    private final DeckValidationService deckValidationService;

    public DeckController(DeckRepository deckRepository, CardRepository cardRepository, DeckValidationService deckValidationService) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
        this.deckValidationService = deckValidationService;
    }

    @GetMapping
    public List<DeckListResponse> listDecks() {
        List<Deck> decks = deckRepository.findAllByOrderByCreatedAtDesc();
        if (decks.isEmpty()) {
            return List.of();
        }

        List<Long> deckIds = decks.stream().map(Deck::getId).toList();
        Map<Long, List<Card>> cardsByDeckId = cardRepository.findAllByDeckIdInOrderByDeckIdAscIdAsc(deckIds).stream()
                .collect(Collectors.groupingBy(card -> card.getDeck().getId()));

        return decks.stream()
                .map(deck -> {
                    List<Card> deckCards = cardsByDeckId.getOrDefault(deck.getId(), List.of());
                    String coverUrl = resolveDeckCoverUrl(deck, deckCards);
                    return DeckListResponse.from(deck, deckCards, coverUrl);
                })
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
        return DeckResponse.from(saved, null);
    }

    @GetMapping("/{id}")
    public DeckResponse getDeck(@PathVariable Long id) {
        Deck deck = deckRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));

        List<Card> cards = cardRepository.findAllByDeckIdOrderByIdAsc(id);
        return DeckResponse.from(deck, resolveDeckCoverUrl(deck, cards));
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
        return DeckResponse.from(saved, resolveDeckCoverUrl(saved, cards));
    }

    private String resolveDeckCoverUrl(Deck deck, List<Card> cards) {
        String commanderName = normalize(deck.getCommander());

        if (!commanderName.isBlank()) {
            for (Card card : cards) {
                if (commanderName.equals(normalize(card.getName())) && hasText(resolveCardCover(card))) {
                    return resolveCardCover(card);
                }
            }
        }

        for (Card card : cards) {
            if (hasText(resolveCardCover(card))) {
                return resolveCardCover(card);
            }
        }

        return null;
    }

    private String resolveCardCover(Card card) {
        if (hasText(card.getImageNormal())) {
            return card.getImageNormal();
        }
        if (hasText(card.getImageSmall())) {
            return card.getImageSmall();
        }
        return card.getImageUrl();
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    public record CreateDeckRequest(
            @NotBlank String name,
            @NotBlank String format,
            String commander
    ) {
    }

    public record UpdateDeckRequest(
            @NotBlank String name,
            @NotBlank String format,
            String commander
    ) {
    }

    public record DeckListResponse(
            Long id,
            String name,
            String format,
            String commander,
            Instant createdAt,
            int totalCardCount,
            List<String> cardPreview,
            String deckCoverUrl
    ) {
        static DeckListResponse from(Deck deck, List<Card> cards, String coverUrl) {
            List<Card> cardList = cards == null ? Collections.emptyList() : cards;
            int total = cardList.stream().mapToInt(Card::getQuantity).sum();
            List<String> preview = cardList.stream()
                    .limit(PREVIEW_LIMIT)
                    .map(card -> card.getQuantity() + "x " + card.getName())
                    .toList();

            return new DeckListResponse(
                    deck.getId(),
                    deck.getName(),
                    deck.getFormat(),
                    deck.getCommander(),
                    deck.getCreatedAt(),
                    total,
                    preview,
                    coverUrl
            );
        }
    }

    public record DeckResponse(
            Long id,
            String name,
            String format,
            String commander,
            Instant createdAt,
            String deckCoverUrl
    ) {
        static DeckResponse from(Deck deck, String coverUrl) {
            return new DeckResponse(
                    deck.getId(),
                    deck.getName(),
                    deck.getFormat(),
                    deck.getCommander(),
                    deck.getCreatedAt(),
                    coverUrl
            );
        }
    }
}
