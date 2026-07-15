package com.example.watchParty.watchParty.DTO;

import java.time.LocalDateTime;

import jakarta.validation.constraints.PositiveOrZero;
import lombok.Data;

@Data
public class PlaybackStateDto {

    private Boolean playing;

    @PositiveOrZero
    private Double currentTime;

    private String currentVideoId;

    private LocalDateTime lastPlaybackUpdate;

    private Double playbackSpeed;

    private Long sequenceNumber;
}
