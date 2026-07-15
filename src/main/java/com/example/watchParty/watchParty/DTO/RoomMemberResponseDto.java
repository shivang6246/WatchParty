package com.example.watchParty.watchParty.DTO;

import java.time.LocalDateTime;

import com.example.watchParty.watchParty.Enum.RoomRole;

import lombok.Data;

@Data
public class RoomMemberResponseDto {

    private String username;
    private RoomRole roomRole;
    private Boolean online;
    private LocalDateTime joinedAt;
}
