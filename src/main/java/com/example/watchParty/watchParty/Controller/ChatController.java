package com.example.watchParty.watchParty.Controller;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import com.example.watchParty.watchParty.DTO.ChatMessageDto;
import com.example.watchParty.watchParty.DTO.TypingIndicatorDto;
import com.example.watchParty.watchParty.Service.ChatService;

import lombok.RequiredArgsConstructor;

@Controller
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    @MessageMapping("/chat")
    public void sendMessage(ChatMessageDto message) {
        chatService.broadCastMessage(message);
    }

    @MessageMapping("/typing")
    public void typingIndicator(TypingIndicatorDto indicator) {
        chatService.broadcastTypingIndicator(indicator);
    }
}