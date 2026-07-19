package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Data;

@Data
public class PlayBackEventdto {

    @NotBlank
    private String roomCode;

    @NotBlank
    private String eventType; // PLAY, PAUSE, SEEK, SPEED_CHANGE, BUFFERING, SYNC_REQUEST

    @PositiveOrZero
    private Double currentTime;

    @NotBlank
    private String username;

    private Double playbackSpeed;

    private Boolean buffering;

    private Long sequenceNumber;

    private String videoUrl;

    private String platform;
}
