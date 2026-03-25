package com.example.mtgdeckmanager.config;

import com.example.mtgdeckmanager.cardlookup.CardLookupException;
import com.example.mtgdeckmanager.cardlookup.CardLookupNotFoundException;
import com.example.mtgdeckmanager.cardlookup.CardLookupTimeoutException;
import com.example.mtgdeckmanager.deck.DeckValidationException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(DeckValidationException.class)
    public ResponseEntity<ErrorResponse> handleDeckValidationException(DeckValidationException exception) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("Deck validation failed", exception.getErrors()));
    }

    @ExceptionHandler(CardLookupNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleCardLookupNotFoundException(CardLookupNotFoundException exception) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorResponse(exception.getMessage(), List.of()));
    }

    @ExceptionHandler(CardLookupTimeoutException.class)
    public ResponseEntity<ErrorResponse> handleCardLookupTimeoutException(CardLookupTimeoutException exception) {
        return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT)
                .body(new ErrorResponse(exception.getMessage(), List.of()));
    }

    @ExceptionHandler(CardLookupException.class)
    public ResponseEntity<ErrorResponse> handleCardLookupException(CardLookupException exception) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ErrorResponse(exception.getMessage(), List.of()));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolationException(ConstraintViolationException exception) {
        List<String> errors = exception.getConstraintViolations().stream()
                .map(ConstraintViolation::getMessage)
                .toList();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ErrorResponse("Validation failed", errors));
    }

    public record ErrorResponse(String message, List<String> errors) {
    }
}
