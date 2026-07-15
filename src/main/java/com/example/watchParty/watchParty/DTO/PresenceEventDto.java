package com.example.watchParty.watchParty.DTO;

import java.time.LocalDateTime;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PresenceEventDto {

    private String roomCode;
    private String username;
    private String eventType; // ONLINE, OFFLINE, HEARTBEAT
    private LocalDateTime timestamp;
}
