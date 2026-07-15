package com.example.watchParty.watchParty.Service;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.RoomEventDto;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class RoomEventService {
    private final SimpMessagingTemplate messagingTemplate;

    public void broadCastRoomEvent(RoomEventDto event) {
        messagingTemplate.convertAndSend(
                "/topic/room/" + event.getRoomCode() + "/events", event);
    }
}
