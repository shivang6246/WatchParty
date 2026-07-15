package com.example.watchParty.watchParty.Service;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.ChatHistoryResponseDto;
import com.example.watchParty.watchParty.DTO.ChatMessageDto;
import com.example.watchParty.watchParty.DTO.TypingIndicatorDto;
import com.example.watchParty.watchParty.Entity.ChatMessage;
import com.example.watchParty.watchParty.Repository.ChatMessageRepo;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ChatService {

    private final SimpMessagingTemplate simpMessagingTemplate;
    private final ChatMessageRepo chatMessageRepo;

    @CacheEvict(value = "chat_history", allEntries = true)
    public void broadCastMessage(ChatMessageDto message) {
        message.setTimestamp(LocalDateTime.now());

        // Persist message to database
        ChatMessage entity = new ChatMessage();
        entity.setRoomCode(message.getRoomCode());
        entity.setUsername(message.getUsername());
        entity.setMessage(message.getMessage());
        entity.setTimestamp(message.getTimestamp());

        ChatMessage saved = chatMessageRepo.save(entity);
        message.setId(saved.getId());

        // Broadcast to room subscribers
        simpMessagingTemplate.convertAndSend(
                "/topic/room/" + message.getRoomCode() + "/chat", message);
    }

    @Cacheable(value = "chat_history", key = "#roomCode + ':' + #page + ':' + #pageSize")
    public ChatHistoryResponseDto getChatHistory(String roomCode, int page, int pageSize) {
        Page<ChatMessage> chatPage = chatMessageRepo
                .findByRoomCodeOrderByTimestampDesc(roomCode, PageRequest.of(page, pageSize));

        List<ChatMessageDto> messages = chatPage.getContent().stream()
                .map(this::toDto)
                .toList();

        return ChatHistoryResponseDto.builder()
                .messages(messages)
                .totalCount(chatPage.getTotalElements())
                .page(page)
                .pageSize(pageSize)
                .build();
    }

    public void broadcastTypingIndicator(TypingIndicatorDto indicator) {
        simpMessagingTemplate.convertAndSend(
                "/topic/room/" + indicator.getRoomCode() + "/typing", indicator);
    }

    private ChatMessageDto toDto(ChatMessage entity) {
        ChatMessageDto dto = new ChatMessageDto();
        dto.setId(entity.getId());
        dto.setRoomCode(entity.getRoomCode());
        dto.setUsername(entity.getUsername());
        dto.setMessage(entity.getMessage());
        dto.setTimestamp(entity.getTimestamp());
        return dto;
    }
}
