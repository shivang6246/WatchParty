package com.example.watchParty.watchParty.DTO;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InviteLinkResponseDto {

    private String inviteToken;
    private String roomCode;
    private String roomName;
}
