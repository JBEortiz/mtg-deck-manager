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

            return toCardLookupResult(response);
        } catch (CardLookupNotFoundException | CardLookupException exception) {
            throw exception;
        } catch (ResourceAccessException exception) {
            throw new CardLookupTimeoutException("Card lookup timed out");
        } catch (RestClientException exception) {
            throw new CardLookupException("Card lookup service is unavailable");
        }
    }

    @Override
    public List<CardLookupResult> searchCards(String query, int limit) {
        try {
            ScryfallSearchResponse response = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .path("/cards/search")
                            .queryParam("q", query)
                            .queryParam("order", "name")
                            .queryParam("unique", "cards")
                            .queryParam("include_extras", false)
                            .build())
                    .retrieve()
                    .onStatus(HttpStatusCode::is4xxClientError, (request, clientResponse) -> {
                        if (clientResponse.getStatusCode().value() == 404) {
                            throw new CardLookupNotFoundException("No cards found");
                        }
                        throw new CardLookupException("Card lookup request was invalid");
                    })
                    .onStatus(HttpStatusCode::is5xxServerError, (request, clientResponse) -> {
                        throw new CardLookupException("Card lookup service is unavailable");
                    })
                    .body(ScryfallSearchResponse.class);

            if (response == null || response.data() == null || response.data().isEmpty()) {
                return List.of();
            }

            return response.data().stream()
                    .limit(Math.max(1, limit))
                    .map(this::toCardLookupResult)
                    .toList();
        } catch (CardLookupNotFoundException exception) {
            return List.of();
        } catch (CardLookupException exception) {
            throw exception;
        } catch (ResourceAccessException exception) {
            throw new CardLookupTimeoutException("Card lookup timed out");
        } catch (RestClientException exception) {
            throw new CardLookupException("Card lookup service is unavailable");
        }
    }

    private CardLookupResult toCardLookupResult(ScryfallCard card) {
        ImagePair imagePair = resolveImages(card);

        return new CardLookupResult(
                card.name(),
                card.manaValue() == null ? 0 : card.manaValue().intValue(),
                card.typeLine() == null ? "Unknown" : card.typeLine(),
                colorsToText(card.colors()),
                card.id(),
                imagePair.small(),
                imagePair.normal()
        );
    }

    private ImagePair resolveImages(ScryfallCard card) {
        if (card.imageUris() != null && (hasText(card.imageUris().small()) || hasText(card.imageUris().normal()))) {
            return new ImagePair(card.imageUris().small(), card.imageUris().normal());
        }

        for (ScryfallCardFace face : card.cardFaces()) {
            if (face.imageUris() != null && (hasText(face.imageUris().small()) || hasText(face.imageUris().normal()))) {
                return new ImagePair(face.imageUris().small(), face.imageUris().normal());
            }
        }

        return new ImagePair(null, null);
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

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record ScryfallAutocompleteResponse(List<String> data) {
    }

    private record ScryfallSearchResponse(List<ScryfallCard> data) {
    }

    private record ScryfallCard(
            String id,
            String name,
            @JsonProperty("mana_value") Double manaValue,
            @JsonProperty("type_line") String typeLine,
            List<String> colors,
            @JsonProperty("image_uris") ScryfallImageUris imageUris,
            @JsonProperty("card_faces") List<ScryfallCardFace> cardFaces
    ) {
        ScryfallCard {
            colors = colors == null ? Collections.emptyList() : colors;
            cardFaces = cardFaces == null ? Collections.emptyList() : cardFaces;
        }
    }

    private record ScryfallCardFace(
            @JsonProperty("image_uris") ScryfallImageUris imageUris
    ) {
    }

    private record ScryfallImageUris(
            String normal,
            String small
    ) {
    }

    private record ImagePair(String small, String normal) {
    }
}
