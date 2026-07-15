package com.example.watchParty.watchParty.Config;

import java.security.Principal;
import java.util.Map;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import com.example.watchParty.watchParty.Service.PresenceService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebSocketEventListener {

    private final PresenceService presenceService;

    @EventListener
    public void handleWebSocketConnect(SessionConnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();

        // Extract roomCode from STOMP connect headers (client sends it)
        String roomCode = accessor.getFirstNativeHeader("roomCode");
        Principal principal = accessor.getUser();

        if (roomCode != null && principal != null) {
            String username = principal.getName();

            // Store roomCode in session attributes for disconnect cleanup
            Map<String, Object> sessionAttrs = accessor.getSessionAttributes();
            if (sessionAttrs != null) {
                sessionAttrs.put("roomCode", roomCode);
                sessionAttrs.put("username", username);
            }

            presenceService.userConnected(roomCode, username);
            log.info("WebSocket connected: user={}, room={}, session={}", username, roomCode, sessionId);
        }
    }

    @EventListener
    public void handleWebSocketDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());

        Map<String, Object> sessionAttrs = accessor.getSessionAttributes();
        if (sessionAttrs != null) {
            String roomCode = (String) sessionAttrs.get("roomCode");
            String username = (String) sessionAttrs.get("username");

            if (roomCode != null && username != null) {
                presenceService.userDisconnected(roomCode, username);
                log.info("WebSocket disconnected: user={}, room={}", username, roomCode);
            }
        }
    }
}
