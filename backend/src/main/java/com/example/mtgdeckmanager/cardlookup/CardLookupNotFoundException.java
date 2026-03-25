package com.example.mtgdeckmanager.cardlookup;

public class CardLookupNotFoundException extends RuntimeException {

    public CardLookupNotFoundException(String message) {
        super(message);
    }
}
