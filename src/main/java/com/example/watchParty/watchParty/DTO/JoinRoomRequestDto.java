package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class JoinRoomRequestDto {

    @NotBlank
    @Size(min = 6, max = 6)
    private String roomCode;

}
