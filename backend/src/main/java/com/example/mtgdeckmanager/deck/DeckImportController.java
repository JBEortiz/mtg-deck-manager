package com.example.mtgdeckmanager.deck;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/decks")
public class DeckImportController {

    private static final Pattern DECKLIST_LINE_PATTERN = Pattern.compile("^(\\d+)\\s+(.+)$");

    private final DeckRepository deckRepository;
    private final CardRepository cardRepository;
    private final DeckValidationService deckValidationService;

    public DeckImportController(DeckRepository deckRepository, CardRepository cardRepository, DeckValidationService deckValidationService) {
        this.deckRepository = deckRepository;
        this.cardRepository = cardRepository;
        this.deckValidationService = deckValidationService;
    }

    @GetMapping("/{id}/export")
    public ResponseEntity<String> exportDecklist(@PathVariable Long id) {
        if (!deckRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found");
        }

        List<Card> cards = cardRepository.findAllByDeckIdOrderByIdAsc(id);
        String decklist = cards.stream()
                .map(card -> card.getQuantity() + " " + card.getName())
                .collect(Collectors.joining("\n"));

        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_PLAIN)
                .body(decklist);
    }

    @PostMapping("/{id}/import")
    public ImportResultResponse importDecklist(@PathVariable Long id, @Valid @RequestBody ImportRequest request) {
        Deck deck = deckRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Deck not found"));

        String[] lines = request.decklistText().split("\\r?\\n");
        List<ParsedImportCard> parsedCards = new ArrayList<>();
        List<ImportError> errors = new ArrayList<>();

        for (int i = 0; i < lines.length; i++) {
            String rawLine = lines[i];
            String line = rawLine.trim();
            int lineNumber = i + 1;

            if (line.isEmpty()) {
                continue;
            }

            Matcher matcher = DECKLIST_LINE_PATTERN.matcher(line);
            if (!matcher.matches()) {
                errors.add(new ImportError(lineNumber, "Invalid format. Use: <quantity> <card name>", rawLine));
                continue;
            }

            int quantity;
            try {
                quantity = Integer.parseInt(matcher.group(1));
            } catch (NumberFormatException ex) {
                errors.add(new ImportError(lineNumber, "Invalid quantity", rawLine));
                continue;
            }

            String cardName = matcher.group(2).trim();
            if (quantity <= 0 || cardName.isEmpty()) {
                errors.add(new ImportError(lineNumber, "Quantity must be > 0 and card name must be present", rawLine));
                continue;
            }

            String inferredType = deckValidationService.inferTypeForImportedCard(cardName);
            parsedCards.add(new ParsedImportCard(cardName, inferredType, quantity));
        }

        List<Card> existingCards = cardRepository.findAllByDeckIdOrderByIdAsc(id);
        List<DeckValidationService.CandidateCard> candidates = parsedCards.stream()
                .map(card -> new DeckValidationService.CandidateCard(card.name(), card.type(), card.quantity()))
                .toList();
        deckValidationService.validateImport(deck, existingCards, candidates);

        List<CardSummary> createdCards = new ArrayList<>();
        int importedCount = 0;

        for (ParsedImportCard parsedCard : parsedCards) {
            Card card = new Card();
            card.setDeck(deck);
            card.setName(parsedCard.name());
            card.setManaValue(0);
            card.setType(parsedCard.type());
            card.setColors(deckValidationService.inferColorsForImportedCard(parsedCard.name()));
            card.setQuantity(parsedCard.quantity());

            Card saved = cardRepository.save(card);
            importedCount += parsedCard.quantity();
            createdCards.add(new CardSummary(saved.getId(), saved.getName(), saved.getQuantity()));
        }

        return new ImportResultResponse(importedCount, createdCards, errors);
    }

    public record ImportRequest(@NotBlank String decklistText) {
    }

    public record ImportResultResponse(
            Integer importedCount,
            List<CardSummary> createdCards,
            List<ImportError> errors
    ) {
    }

    public record CardSummary(Long id, String name, Integer quantity) {
    }

    public record ImportError(Integer line, String message, String rawLine) {
    }

    private record ParsedImportCard(String name, String type, Integer quantity) {
    }
}
