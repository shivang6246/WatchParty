package com.example.watchParty.watchParty.DTO;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OtpResponseDto {

    private String message;

    private String email;

    /** Seconds until the code expires. */
    private long expiresInSeconds;
}
