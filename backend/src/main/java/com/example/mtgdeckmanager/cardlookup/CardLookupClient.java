package com.example.mtgdeckmanager.cardlookup;

import java.util.List;

public interface CardLookupClient {

    List<String> autocomplete(String query);

    CardLookupResult getCardByExactName(String name);
}
