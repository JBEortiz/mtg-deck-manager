package com.example.mtgdeckmanager.cardlookup;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/scryfall")
public class CardLookupController {

    private final CardLookupClient cardLookupClient;

    public CardLookupController(CardLookupClient cardLookupClient) {
        this.cardLookupClient = cardLookupClient;
    }

    @GetMapping("/autocomplete")
    public List<String> autocomplete(@RequestParam @NotBlank String query) {
        return cardLookupClient.autocomplete(query.trim());
    }

    @GetMapping("/card")
    public CardLookupResponse getCardByName(@RequestParam @NotBlank String name) {
        return toResponse(cardLookupClient.getCardByExactName(name.trim()));
    }

    @GetMapping("/search")
    public List<CardLookupResponse> searchCards(
            @RequestParam @NotBlank String query,
            @RequestParam(defaultValue = "8") @Min(1) @Max(20) Integer limit
    ) {
        return cardLookupClient.searchCards(query.trim(), limit).stream()
                .map(this::toResponse)
                .toList();
    }

    private CardLookupResponse toResponse(CardLookupResult card) {
        return new CardLookupResponse(
                card.name(),
                card.manaValue(),
                card.type(),
                card.colors(),
                card.scryfallId(),
                card.imageSmall(),
                card.imageNormal()
        );
    }

    public record CardLookupResponse(
            String name,
            Integer manaValue,
            String type,
            String colors,
            String scryfallId,
            String imageSmall,
            String imageNormal
    ) {
    }
}
