package com.example.mtgdeckmanager.deck;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeckRepository extends JpaRepository<Deck, Long> {

    List<Deck> findAllByOrderByCreatedAtDesc();
}
