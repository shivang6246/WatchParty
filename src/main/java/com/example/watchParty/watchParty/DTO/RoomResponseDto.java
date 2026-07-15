package com.example.watchParty.watchParty.DTO;

import lombok.Data;

@Data
public class RoomResponseDto {

    private String roomCode;
    private String roomName;
    private String host;
    private Boolean locked;
    private Boolean active;
    private String inviteToken;
    private Double playbackSpeed;
    private String videoUrl;
    private String platform;
}
