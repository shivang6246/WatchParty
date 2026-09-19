package com.example.watchParty.watchParty.Service;

import com.example.watchParty.watchParty.DTO.AuthResponseDto;
import com.example.watchParty.watchParty.DTO.OAuth2RequestDto;
import com.example.watchParty.watchParty.Entity.User;
import com.example.watchParty.watchParty.Enum.AuthProvider;
import com.example.watchParty.watchParty.Enum.Role;
import com.example.watchParty.watchParty.Repository.UserRepo;
import com.example.watchParty.watchParty.Security.jwtService;
import com.google.api.client.googleapis.auth.oauth2.GoogleAuthorizationCodeTokenRequest;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.googleapis.auth.oauth2.GoogleTokenResponse;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleOAuth2Service {

    private final UserRepo userRepo;
    private final jwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    @Value("${google.oauth2.client-id}")
    private String clientId;

    @Value("${google.oauth2.client-secret}")
    private String clientSecret;

    private static final NetHttpTransport HTTP_TRANSPORT = new NetHttpTransport();
    private static final GsonFactory JSON_FACTORY = GsonFactory.getDefaultInstance();

    /**
     * Full OAuth2 flow:
     * 1. Exchange authorization code for tokens
     * 2. Verify and extract user info from the ID token
     * 3. Find or create the user
     * 4. Return a JWT
     */
    @Transactional
    public AuthResponseDto authenticateWithGoogle(OAuth2RequestDto request) {
        try {
            // 1. Exchange auth code for tokens
            GoogleTokenResponse tokenResponse = new GoogleAuthorizationCodeTokenRequest(
                    HTTP_TRANSPORT,
                    JSON_FACTORY,
                    "https://oauth2.googleapis.com/token",
                    clientId,
                    clientSecret,
                    request.getCode(),
                    request.getRedirectUri() != null ? request.getRedirectUri() : ""
            ).execute();

            // 2. Verify the ID token
            GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier.Builder(HTTP_TRANSPORT, JSON_FACTORY)
                    .setAudience(Collections.singletonList(clientId))
                    .build();

            GoogleIdToken idToken = verifier.verify(tokenResponse.getIdToken());
            if (idToken == null) {
                throw new RuntimeException("Invalid Google ID token");
            }

            GoogleIdToken.Payload payload = idToken.getPayload();
            String googleId = payload.getSubject();
            String email = payload.getEmail();
            String name = (String) payload.get("name");

            if (email == null || email.isBlank()) {
                throw new RuntimeException("Google account does not have an email address");
            }

            // 3. Find or create user
            User user = findOrCreateUser(googleId, email, name);

            // 4. Generate JWT
            String jwt = jwtService.generateToken(user);

            log.info("Google OAuth2 login successful for user: {}", email);

            return AuthResponseDto.builder()
                    .accessToken(jwt)
                    .username(user.getUsername())
                    .email(user.getEmail())
                    .role(user.getRole())
                    .build();

        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("Google OAuth2 authentication failed", e);
            throw new RuntimeException("Google authentication failed: " + e.getMessage());
        }
    }

    /**
     * Find existing user or create new one.
     * Links accounts by email: if a LOCAL user exists with the same email,
     * their account gets linked to Google.
     */
    private User findOrCreateUser(String googleId, String email, String name) {
        // First, try to find by Google ID (already linked)
        Optional<User> byGoogleId = userRepo.findByGoogleId(googleId);
        if (byGoogleId.isPresent()) {
            return byGoogleId.get();
        }

        // Next, try to find by email (account linking)
        Optional<User> byEmail = userRepo.findByEmail(email);
        if (byEmail.isPresent()) {
            User existingUser = byEmail.get();
            existingUser.setGoogleId(googleId);
            existingUser.setUpdatedAt(LocalDateTime.now());
            log.info("Linked Google account to existing user: {}", email);
            return userRepo.save(existingUser);
        }

        // No existing user — create a new one
        User newUser = new User();
        newUser.setEmail(email);
        newUser.setUsername(generateUniqueUsername(name, email));
        newUser.setPassword(passwordEncoder.encode(UUID.randomUUID().toString()));
        newUser.setRole(Role.USER);
        newUser.setAuthProvider(AuthProvider.GOOGLE);
        newUser.setGoogleId(googleId);
        newUser.setCreatedAt(LocalDateTime.now());
        newUser.setUpdatedAt(LocalDateTime.now());

        log.info("Created new Google OAuth2 user: {}", email);
        return userRepo.save(newUser);
    }

    /**
     * Generate a unique username from the Google profile name.
     * Falls back to the email prefix, appending a random suffix if taken.
     */
    private String generateUniqueUsername(String name, String email) {
        String base = (name != null && !name.isBlank())
                ? name.replaceAll("\\s+", "").toLowerCase()
                : email.split("@")[0];

        // Truncate to 16 chars to leave room for suffix
        if (base.length() > 16) {
            base = base.substring(0, 16);
        }

        String candidate = base;
        int attempt = 0;
        while (userRepo.existsByUsername(candidate)) {
            attempt++;
            candidate = base + attempt;
        }

        return candidate;
    }
}
