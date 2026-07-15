
package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RoomEventDto {

    @NotBlank
    private String roomCode;

    @NotBlank
    private String username;

    @NotBlank
    private String eventType;
}
