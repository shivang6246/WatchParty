package com.example.watchParty.watchParty.Controller;

import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;

import com.example.watchParty.watchParty.DTO.OnlineUsersResponseDto;
import com.example.watchParty.watchParty.DTO.PresenceEventDto;
import com.example.watchParty.watchParty.Service.PresenceService;

import lombok.RequiredArgsConstructor;

@Controller
@RequiredArgsConstructor
public class PresenceController {

    private final PresenceService presenceService;

    @MessageMapping("/presence/heartbeat")
    public void heartbeat(PresenceEventDto event) {
        presenceService.heartbeat(event.getRoomCode(), event.getUsername());
    }

    @MessageMapping("/presence/connect")
    public void connect(PresenceEventDto event) {
        presenceService.userConnected(event.getRoomCode(), event.getUsername());
    }

    @GetMapping("/api/presence/{roomCode}/online")
    @ResponseBody
    public ResponseEntity<OnlineUsersResponseDto> getOnlineUsers(@PathVariable String roomCode) {
        return ResponseEntity.ok(presenceService.getOnlineUsers(roomCode));
    }
}
