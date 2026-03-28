package com.example.mtgdeckmanager.deck;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DeckImportControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeckRepository deckRepository;

    @Autowired
    private CardRepository cardRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void importsDecklistAndCreatesCards() throws Exception {
        Deck deck = new Deck();
        deck.setName("Import Test Deck");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        String decklist = "1 Mizzix\n1 Lightning Bolt\n2 Mountain\ninvalid line\n1 Sol Ring";
        String payload = objectMapper.writeValueAsString(Map.of("decklistText", decklist));

        mockMvc.perform(post("/api/decks/{id}/import", savedDeck.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.importedCount").value(5))
                .andExpect(jsonPath("$.createdCards.length()").value(4))
                .andExpect(jsonPath("$.errors.length()").value(1));

        mockMvc.perform(get("/api/decks/{id}/cards", savedDeck.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4));
    }

    @Test
    void allowsImportWithDuplicateNonBasicCards() throws Exception {
        Deck deck = new Deck();
        deck.setName("Flexible Commander Import");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        String decklist = "1 Mizzix\n2 Counterspell\n1 Lightning Bolt";
        String payload = objectMapper.writeValueAsString(Map.of("decklistText", decklist));

        mockMvc.perform(post("/api/decks/{id}/import", savedDeck.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.importedCount").value(4));
    }

    @Test
    void exportsDecklistAsPlainText() throws Exception {
        Deck deck = new Deck();
        deck.setName("Export Deck");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Sol Ring", 1);
        createCard(savedDeck, "Counterspell", 2);

        mockMvc.perform(get("/api/decks/{id}/export", savedDeck.getId()))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_PLAIN))
                .andExpect(content().string("1 Sol Ring\n2 Counterspell"));
    }

    @Test
    void returnsNotFoundWhenExportingMissingDeck() throws Exception {
        mockMvc.perform(get("/api/decks/{id}/export", 999999))
                .andExpect(status().isNotFound());
    }

    private Card createCard(Deck deck, String name, int quantity) {
        Card card = new Card();
        card.setDeck(deck);
        card.setName(name);
        card.setManaValue(0);
        card.setType("Unknown");
        card.setColors("Colorless");
        card.setQuantity(quantity);
        return cardRepository.save(card);
    }
}



