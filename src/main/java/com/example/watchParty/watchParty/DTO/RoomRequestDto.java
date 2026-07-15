package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RoomRequestDto {

        @NotBlank
        @Size(min = 3, max = 100)
        private String roomName;

        @NotNull
        private Boolean locked;

        @Size(max = 1000)
        private String videoUrl;

        @Size(max = 20)
        private String platform;

}
