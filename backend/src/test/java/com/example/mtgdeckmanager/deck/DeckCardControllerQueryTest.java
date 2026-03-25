package com.example.mtgdeckmanager.deck;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DeckCardControllerQueryTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeckRepository deckRepository;

    @Autowired
    private CardRepository cardRepository;

    @Test
    void supportsSearchFilterAndSort() throws Exception {
        Deck deck = new Deck();
        deck.setName("Filter Test Deck");
        deck.setFormat("Commander");
        deck.setCommander("Niv-Mizzet");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Counterspell", 2, "Instant", "U", 2);
        createCard(savedDeck, "Lightning Bolt", 1, "Instant", "R", 4);
        createCard(savedDeck, "Solemn Simulacrum", 4, "Artifact Creature", "Colorless", 1);

        mockMvc.perform(get("/api/decks/{id}/cards", savedDeck.getId())
                        .queryParam("name", "light")
                        .queryParam("type", "Instant")
                        .queryParam("color", "R")
                        .queryParam("sortBy", "manaValue")
                        .queryParam("direction", "desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Lightning Bolt"));

        mockMvc.perform(get("/api/decks/{id}/cards", savedDeck.getId())
                        .queryParam("sortBy", "name")
                        .queryParam("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Counterspell"));
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
