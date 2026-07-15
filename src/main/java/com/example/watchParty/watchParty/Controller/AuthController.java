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
import com.example.watchParty.watchParty.DTO.RegisterRequestDto;
import com.example.watchParty.watchParty.Service.AuthService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService authService;

    @PostMapping("/register")
    public AuthResponseDto register(@RequestBody @Valid RegisterRequestDto request) {
        return authService.register(request);
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

}