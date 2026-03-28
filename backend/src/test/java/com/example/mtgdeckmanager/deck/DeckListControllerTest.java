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
class DeckListControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeckRepository deckRepository;

    @Autowired
    private CardRepository cardRepository;

    @Test
    void includesTotalCountAndCardPreviewInDeckList() throws Exception {
        Deck deck = new Deck();
        deck.setName("Izzet Spells");
        deck.setFormat("Commander");
        deck.setCommander("Mizzix");
        Deck savedDeck = deckRepository.save(deck);

        createCard(savedDeck, "Sol Ring", 1, "Artifact", "C", 1);
        createCard(savedDeck, "Lightning Bolt", 1, "Instant", "R", 2);
        createCard(savedDeck, "Ponder", 1, "Sorcery", "U", 1);
        createCard(savedDeck, "Counterspell", 2, "Instant", "U,U", 1);
        createCard(savedDeck, "Arcane Signet", 2, "Artifact", "C", 1);
        createCard(savedDeck, "Cyclonic Rift", 2, "Instant", "U", 1);

        mockMvc.perform(get("/api/decks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Izzet Spells"))
                .andExpect(jsonPath("$[0].totalCardCount").value(7))
                .andExpect(jsonPath("$[0].cardPreview.length()").value(5))
                .andExpect(jsonPath("$[0].cardPreview[0]").value("1x Sol Ring"))
                .andExpect(jsonPath("$[0].cardPreview[4]").value("1x Arcane Signet"));
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
