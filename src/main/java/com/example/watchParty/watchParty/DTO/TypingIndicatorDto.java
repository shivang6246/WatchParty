package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class TypingIndicatorDto {

    @NotBlank
    @Size(min = 6, max = 6)
    private String roomCode;

    @NotBlank
    private String username;

    private Boolean typing;
}
