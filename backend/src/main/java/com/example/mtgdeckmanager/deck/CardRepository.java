package com.example.mtgdeckmanager.deck;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CardRepository extends JpaRepository<Card, Long> {

    List<Card> findAllByDeckIdOrderByIdAsc(Long deckId);

    List<Card> findAllByDeckIdInOrderByDeckIdAscIdAsc(List<Long> deckIds);

    Optional<Card> findByIdAndDeckId(Long id, Long deckId);
}
