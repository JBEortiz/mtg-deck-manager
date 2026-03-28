package com.example.mtgdeckmanager.cardlookup;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CardLookupControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private CardLookupClient cardLookupClient;

    @Test
    void returnsAutocompleteSuggestions() throws Exception {
        when(cardLookupClient.autocomplete("light"))
                .thenReturn(List.of("Lightning Bolt", "Lightning Helix"));

        mockMvc.perform(get("/api/scryfall/autocomplete").queryParam("query", "light"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0]").value("Lightning Bolt"));
    }

    @Test
    void returnsCardDetailsByExactName() throws Exception {
        when(cardLookupClient.getCardByExactName("Lightning Bolt"))
                .thenReturn(new CardLookupResult("Lightning Bolt", 1, "Instant", "R", "abc123", "https://thumb", "https://img"));

        mockMvc.perform(get("/api/scryfall/card").queryParam("name", "Lightning Bolt"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Lightning Bolt"))
                .andExpect(jsonPath("$.manaValue").value(1))
                .andExpect(jsonPath("$.type").value("Instant"))
                .andExpect(jsonPath("$.colors").value("R"));
    }

    @Test
    void returnsNotFoundForMissingCard() throws Exception {
        when(cardLookupClient.getCardByExactName("Unknown"))
                .thenThrow(new CardLookupNotFoundException("Card not found"));

        mockMvc.perform(get("/api/scryfall/card").queryParam("name", "Unknown"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Card not found"));
    }

    @Test
    void returnsGatewayTimeoutForLookupTimeout() throws Exception {
        when(cardLookupClient.getCardByExactName("Bolt"))
                .thenThrow(new CardLookupTimeoutException("Card lookup timed out"));

        mockMvc.perform(get("/api/scryfall/card").queryParam("name", "Bolt"))
                .andExpect(status().isGatewayTimeout())
                .andExpect(jsonPath("$.message").value("Card lookup timed out"));
    }

    @Test
    void returnsBadGatewayForLookupFailure() throws Exception {
        when(cardLookupClient.autocomplete("bolt"))
                .thenThrow(new CardLookupException("Card lookup service is unavailable"));

        mockMvc.perform(get("/api/scryfall/autocomplete").queryParam("query", "bolt"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.message").value("Card lookup service is unavailable"));
    }

    @Test
    void returnsBadRequestWhenQueryIsBlank() throws Exception {
        mockMvc.perform(get("/api/scryfall/autocomplete").queryParam("query", " "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Validation failed"));
    }
}
