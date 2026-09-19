package com.example.watchParty.watchParty.DTO;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class OAuth2RequestDto {

    @NotBlank
    private String code; // Google authorization code

    private String redirectUri; // The redirect URI used by the extension
}
