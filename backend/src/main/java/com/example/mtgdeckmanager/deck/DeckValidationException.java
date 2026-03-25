package com.example.mtgdeckmanager.deck;

import java.util.List;

public class DeckValidationException extends RuntimeException {

    private final List<String> errors;

    public DeckValidationException(List<String> errors) {
        super("Deck validation failed");
        this.errors = errors;
    }

    public List<String> getErrors() {
        return errors;
    }
}
