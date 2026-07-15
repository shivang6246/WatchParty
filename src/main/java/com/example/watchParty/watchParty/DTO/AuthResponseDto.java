package com.example.watchParty.watchParty.DTO;

import com.example.watchParty.watchParty.Enum.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthResponseDto {
    private String accessToken;
    private String username;
    private String email;
    private Role role;
}
