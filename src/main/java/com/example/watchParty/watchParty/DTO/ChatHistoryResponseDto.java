package com.example.watchParty.watchParty.DTO;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatHistoryResponseDto {

    private List<ChatMessageDto> messages;
    private long totalCount;
    private int page;
    private int pageSize;
}
