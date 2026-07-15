package com.example.watchParty.watchParty.Service;

import com.example.watchParty.watchParty.DTO.AuthResponseDto;
import com.example.watchParty.watchParty.DTO.LoginRequestDto;
import com.example.watchParty.watchParty.DTO.RegisterRequestDto;
import com.example.watchParty.watchParty.Entity.User;
import com.example.watchParty.watchParty.Enum.Role;
import com.example.watchParty.watchParty.Repository.UserRepo;
import com.example.watchParty.watchParty.Security.jwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepo userRepo;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final jwtService jwtService;

    public AuthResponseDto login(LoginRequestDto request) {
        // Authenticate using AuthenticationManager (validates email + password via Spring Security)
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getEmail(),
                        request.getPassword()
                )
        );

        // If authentication succeeds, load the user and generate a JWT
        User user = userRepo.findByEmail(request.getEmail())
                .orElseThrow(() -> new RuntimeException("User not found"));

        String token = jwtService.generateToken(user);

        return AuthResponseDto.builder()
                .accessToken(token)
                .username(user.getUsername())
                .email(user.getEmail())
                .role(user.getRole())
                .build();
    }

    public AuthResponseDto register(RegisterRequestDto request) {

        if (userRepo.existsByEmail(request.getEmail())) {
            throw new RuntimeException("Email already exists");
        }

        if (userRepo.existsByUsername(request.getUsername())) {
            throw new RuntimeException("Username already exists");
        }

        User user = new User();

        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRole(Role.USER);
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());

        User savedUser = userRepo.save(user);

        String token = jwtService.generateToken(savedUser);

        return AuthResponseDto.builder()
                .accessToken(token)
                .username(savedUser.getUsername())
                .email(savedUser.getEmail())
                .role(savedUser.getRole())
                .build();
    }

    public List<AuthResponseDto> getAllUsers() {
        return userRepo.findAll().stream().map(user -> AuthResponseDto.builder()
                .username(user.getUsername())
                .email(user.getEmail())
                .role(user.getRole())
                .build()
        ).collect(java.util.stream.Collectors.toList());
    }

    public AuthResponseDto getCurrentUser() {
        org.springframework.security.core.Authentication authentication = 
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        
        if (authentication == null || !authentication.isAuthenticated() || "anonymousUser".equals(authentication.getName())) {
            throw new org.springframework.security.authentication.BadCredentialsException("Not authenticated");
        }

        String email = authentication.getName();
        User user = userRepo.findByEmail(email)
                .orElseThrow(() -> new org.springframework.security.authentication.BadCredentialsException("User not found"));

        return AuthResponseDto.builder()
                .username(user.getUsername())
                .email(user.getEmail())
                .role(user.getRole())
                .build();
    }
}