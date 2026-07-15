package com.example.watchParty.watchParty.DTO;

import java.time.LocalDateTime;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ChatMessageDto {

    private Long id;

    @NotBlank
    @Size(min = 6, max = 6)
    private String roomCode;

    @NotBlank
    @Size(min = 3, max = 50)
    private String username;

    @NotBlank
    @Size(min = 1, max = 500)
    private String message;

    private LocalDateTime timestamp;
}
