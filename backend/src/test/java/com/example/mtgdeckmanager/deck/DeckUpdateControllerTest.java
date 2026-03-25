package com.example.mtgdeckmanager.deck;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DeckUpdateControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeckRepository deckRepository;

    @Autowired
    private CardRepository cardRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void updatesDeckFields() throws Exception {
        Deck deck = new Deck();
        deck.setName("Old Name");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck saved = deckRepository.save(deck);
        createCard(saved, "Mizzix", 4, "Legendary Creature", "U,R", 1);

        String payload = objectMapper.writeValueAsString(Map.of(
                "name", "New Name",
                "format", "Commander",
                "commander", "Mizzix"
        ));

        mockMvc.perform(put("/api/decks/{id}", saved.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("New Name"));
    }

    @Test
    void updatesCardFields() throws Exception {
        Deck deck = new Deck();
        deck.setName("Deck");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Mizzix", 4, "Legendary Creature", "U,R", 1);
        Card card = createCard(savedDeck, "Ponder", 1, "Sorcery", "U", 1);

        String payload = objectMapper.writeValueAsString(Map.of(
                "name", "Preordain",
                "manaValue", 1,
                "type", "Sorcery",
                "colors", "U",
                "quantity", 1
        ));

        mockMvc.perform(put("/api/decks/{deckId}/cards/{cardId}", savedDeck.getId(), card.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Preordain"));
    }

    private Card createCard(Deck deck, String name, int manaValue, String type, String colors, int quantity) {
        Card card = new Card();
        card.setDeck(deck);
        card.setName(name);
        card.setManaValue(manaValue);
        card.setType(type);
        card.setColors(colors);
        card.setQuantity(quantity);
        return cardRepository.save(card);
    }
}
