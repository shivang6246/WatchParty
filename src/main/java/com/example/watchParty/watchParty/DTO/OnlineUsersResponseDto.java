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
public class OnlineUsersResponseDto {

    private String roomCode;
    private List<String> users;
    private int count;
}
