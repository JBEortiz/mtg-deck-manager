package com.example.mtgdeckmanager.cardlookup;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.Duration;
import java.util.Collections;
import java.util.List;

@Component
public class ScryfallCardLookupClient implements CardLookupClient {

    private final RestClient restClient;

    public ScryfallCardLookupClient(RestClient.Builder restClientBuilder) {
        this.restClient = restClientBuilder
                .baseUrl("https://api.scryfall.com")
                .defaultHeader("User-Agent", "mtg-deck-manager/1.0")
                .defaultHeader("Accept", "application/json")
                .requestFactory(createRequestFactory())
                .build();
    }

    @Override
    public List<String> autocomplete(String query) {
        try {
            ScryfallAutocompleteResponse response = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/cards/autocomplete")
                            .queryParam("q", query)
                            .build())
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (request, clientResponse) -> {
                        throw new CardLookupException("Card lookup request was invalid");
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (request, clientResponse) -> {
                        throw new CardLookupException("Card lookup service is unavailable");
                    })
                    .body(ScryfallAutocompleteResponse.class);

            if (response == null || response.data() == null) {
                return List.of();
            }
            return response.data();
        } catch (CardLookupException exception) {
            throw exception;
        } catch (ResourceAccessException exception) {
            throw new CardLookupTimeoutException("Card lookup timed out");
        } catch (RestClientException exception) {
            throw new CardLookupException("Card lookup service is unavailable");
        }
    }

    @Override
    public CardLookupResult getCardByExactName(String name) {
        try {
            ScryfallCard response = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/cards/named")
                            .queryParam("exact", name)
                            .build())
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (request, clientResponse) -> {
                        if (clientResponse.getStatusCode().value() == 404) {
                            throw new CardLookupNotFoundException("Card not found");
                        }
                        throw new CardLookupException("Card lookup request was invalid");
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (request, clientResponse) -> {
                        throw new CardLookupException("Card lookup service is unavailable");
                    })
                    .body(ScryfallCard.class);

            if (response == null || response.name() == null || response.name().isBlank()) {
                throw new CardLookupNotFoundException("Card not found");
            }

            return new CardLookupResult(
                    response.name(),
                    response.manaValue() == null ? 0 : response.manaValue().intValue(),
                    response.typeLine() == null ? "Unknown" : response.typeLine(),
                    colorsToText(response.colors())
            );
        } catch (CardLookupNotFoundException | CardLookupException exception) {
            throw exception;
        } catch (ResourceAccessException exception) {
            throw new CardLookupTimeoutException("Card lookup timed out");
        } catch (RestClientException exception) {
            throw new CardLookupException("Card lookup service is unavailable");
        }
    }

    private SimpleClientHttpRequestFactory createRequestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(5));
        return factory;
    }

    private String colorsToText(List<String> colors) {
        if (colors == null || colors.isEmpty()) {
            return "C";
        }
        return String.join(",", colors);
    }

    private record ScryfallAutocompleteResponse(List<String> data) {
    }

    private record ScryfallCard(
            String name,
            @JsonProperty("mana_value") Double manaValue,
            @JsonProperty("type_line") String typeLine,
            List<String> colors
    ) {
        ScryfallCard {
            colors = colors == null ? Collections.emptyList() : colors;
        }
    }
}
