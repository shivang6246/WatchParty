package com.example.watchParty.watchParty.Controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.watchParty.watchParty.DTO.AuthResponseDto;
import com.example.watchParty.watchParty.DTO.LoginRequestDto;
import com.example.watchParty.watchParty.DTO.OAuth2RequestDto;
import com.example.watchParty.watchParty.DTO.OtpResponseDto;
import com.example.watchParty.watchParty.DTO.RegisterRequestDto;
import com.example.watchParty.watchParty.DTO.ResendOtpRequestDto;
import com.example.watchParty.watchParty.DTO.VerifyOtpRequestDto;
import com.example.watchParty.watchParty.Service.AuthService;
import com.example.watchParty.watchParty.Service.GoogleOAuth2Service;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService authService;
    private final GoogleOAuth2Service googleOAuth2Service;

    /** Step 1: emails a verification code. No account exists yet. */
    @PostMapping("/register")
    public ResponseEntity<OtpResponseDto> register(@RequestBody @Valid RegisterRequestDto request) {
        return ResponseEntity.ok(authService.register(request));
    }

    /** Step 2: a correct code creates the account and returns a JWT. */
    @PostMapping("/register/verify")
    public ResponseEntity<AuthResponseDto> verifyRegistration(
            @RequestBody @Valid VerifyOtpRequestDto request) {
        return ResponseEntity.ok(authService.verifyRegistrationOtp(request));
    }

    @PostMapping("/register/resend")
    public ResponseEntity<OtpResponseDto> resendRegistrationOtp(
            @RequestBody @Valid ResendOtpRequestDto request) {
        return ResponseEntity.ok(authService.resendRegistrationOtp(request));
    }

    @GetMapping("/get")
    public List<AuthResponseDto> getAllUser() {
        return authService.getAllUsers();
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponseDto> login(@RequestBody @Valid LoginRequestDto request) {
        return ResponseEntity.ok(authService.login(request));
    }

    @GetMapping("/me")
    public ResponseEntity<AuthResponseDto> getCurrentUser() {
        return ResponseEntity.ok(authService.getCurrentUser());
    }

    @PostMapping("/oauth2/google")
    public ResponseEntity<AuthResponseDto> googleOAuth2(@RequestBody @Valid OAuth2RequestDto request) {
        return ResponseEntity.ok(googleOAuth2Service.authenticateWithGoogle(request));
    }

}