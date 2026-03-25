package com.example.mtgdeckmanager.cardlookup;

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
        CardLookupResult card = cardLookupClient.getCardByExactName(name.trim());
        return new CardLookupResponse(card.name(), card.manaValue(), card.type(), card.colors());
    }

    public record CardLookupResponse(
            String name,
            Integer manaValue,
            String type,
            String colors
    ) {
    }
}
