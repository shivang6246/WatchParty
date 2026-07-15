package com.example.watchParty.watchParty.Config;

import java.security.Principal;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

import com.example.watchParty.watchParty.Security.CoustomUserDetailService;
import com.example.watchParty.watchParty.Security.jwtService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebSocketAuthInterceptor implements ChannelInterceptor {

    private final jwtService jwtService;
    private final CoustomUserDetailService userDetailService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = accessor.getFirstNativeHeader("Authorization");

            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);
                String username = jwtService.extractUsername(token);

                if (username != null) {
                    UserDetails userDetails = userDetailService.loadUserByUsername(username);

                    if (jwtService.isTokenValid(token, userDetails)) {
                        Principal principal = new UsernamePasswordAuthenticationToken(
                                userDetails, null, userDetails.getAuthorities());
                        accessor.setUser(principal);
                        log.info("WebSocket authenticated: user={}", username);
                    } else {
                        log.warn("WebSocket auth failed: invalid token for user={}", username);
                        throw new RuntimeException("Invalid JWT token");
                    }
                }
            } else {
                log.warn("WebSocket connection without Authorization header");
                // Allow unauthenticated connections for now — can be made strict later
            }
        }

        return message;
    }
}
