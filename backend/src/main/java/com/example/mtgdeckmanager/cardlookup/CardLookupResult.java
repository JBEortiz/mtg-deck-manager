package com.example.mtgdeckmanager.cardlookup;

public record CardLookupResult(
        String name,
        Integer manaValue,
        String type,
        String colors
) {
}
