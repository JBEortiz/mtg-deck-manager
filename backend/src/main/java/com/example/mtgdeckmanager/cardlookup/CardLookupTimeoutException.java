package com.example.mtgdeckmanager.cardlookup;

public class CardLookupTimeoutException extends RuntimeException {

    public CardLookupTimeoutException(String message) {
        super(message);
    }
}
