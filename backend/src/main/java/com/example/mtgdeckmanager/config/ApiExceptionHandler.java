package com.example.mtgdeckmanager.config;

import com.example.mtgdeckmanager.deck.DeckValidationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(DeckValidationException.class)
    public ResponseEntity<ValidationErrorResponse> handleDeckValidationException(DeckValidationException exception) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ValidationErrorResponse("Deck validation failed", exception.getErrors()));
    }

    public record ValidationErrorResponse(String message, List<String> errors) {
    }
}
