package com.example.watchParty.watchParty.Controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.watchParty.watchParty.DTO.ChatHistoryResponseDto;
import com.example.watchParty.watchParty.Service.ChatService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatRestController {

    private final ChatService chatService;

    @GetMapping("/{roomCode}/history")
    public ResponseEntity<ChatHistoryResponseDto> getChatHistory(
            @PathVariable String roomCode,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        return ResponseEntity.ok(chatService.getChatHistory(roomCode, page, size));
    }
}
