package com.example.mtgdeckmanager.deck;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DeckCardValidationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeckRepository deckRepository;

    @Autowired
    private CardRepository cardRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void rejectsNonBasicWithQuantityAboveOne() throws Exception {
        Deck deck = new Deck();
        deck.setName("Validation Deck");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Mizzix", 4, "Legendary Creature", "U,R", 1);

        String payload = objectMapper.writeValueAsString(Map.of(
                "name", "Counterspell",
                "manaValue", 2,
                "type", "Instant",
                "colors", "U",
                "quantity", 2
        ));

        mockMvc.perform(post("/api/decks/{id}/cards", savedDeck.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.length()").value(1));
    }

    @Test
    void allowsBasicLandWithQuantityAboveOne() throws Exception {
        Deck deck = new Deck();
        deck.setName("Basic Land Deck");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Mizzix", 4, "Legendary Creature", "U,R", 1);

        String payload = objectMapper.writeValueAsString(Map.of(
                "name", "Mountain",
                "manaValue", 0,
                "type", "Basic Land",
                "colors", "R",
                "quantity", 20
        ));

        mockMvc.perform(post("/api/decks/{id}/cards", savedDeck.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated());
    }

    private void createCard(Deck deck, String name, int manaValue, String type, String colors, int quantity) {
        Card card = new Card();
        card.setDeck(deck);
        card.setName(name);
        card.setManaValue(manaValue);
        card.setType(type);
        card.setColors(colors);
        card.setQuantity(quantity);
        cardRepository.save(card);
    }
}
