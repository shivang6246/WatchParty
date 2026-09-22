package com.example.watchParty.watchParty.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.PendingRegistration;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Issues and verifies the one-time codes that prove a sign-up owns the email
 * address it registered with. Pending sign-ups live in Redis and expire on
 * their own, so an abandoned registration leaves nothing behind.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OtpService {

    private static final String PENDING_KEY_PREFIX = "pending_registration:";
    private static final String COOLDOWN_KEY_PREFIX = "otp_resend_cooldown:";
    private static final int MAX_ATTEMPTS = 5;
    private static final int OTP_BOUND = 1_000_000; // 6 digits

    private final RedisTemplate<String, Object> redisTemplate;
    private final PasswordEncoder passwordEncoder;
    private final EmailService emailService;

    private final SecureRandom secureRandom = new SecureRandom();

    @Value("${app.otp.ttl-minutes:10}")
    private long ttlMinutes;

    @Value("${app.otp.resend-cooldown-seconds:60}")
    private long resendCooldownSeconds;

    /**
     * Park a sign-up in Redis and mail its owner a fresh code.
     *
     * @return seconds until the code expires
     */
    public long startVerification(String username, String email, String rawPassword) {
        requireNoCooldown(email);

        PendingRegistration pending = PendingRegistration.builder()
                .username(username)
                .email(email)
                .passwordHash(passwordEncoder.encode(rawPassword))
                .attempts(0)
                .build();

        return issueCode(pending, Duration.ofMinutes(ttlMinutes));
    }

    /**
     * Mail a new code for a sign-up that is already pending, replacing the old
     * one and resetting its attempt counter.
     *
     * @return seconds until the new code expires
     */
    public long resend(String email) {
        PendingRegistration pending = loadPending(email);
        requireNoCooldown(email);

        pending.setAttempts(0);
        return issueCode(pending, Duration.ofMinutes(ttlMinutes));
    }

    /**
     * Check a code and, if it matches, hand back the pending sign-up and drop
     * it from Redis so the same code can never be redeemed twice.
     */
    public PendingRegistration consumeVerified(String email, String otp) {
        PendingRegistration pending = loadPending(email);

        if (!passwordEncoder.matches(otp, pending.getOtpHash())) {
            pending.setAttempts(pending.getAttempts() + 1);

            if (pending.getAttempts() >= MAX_ATTEMPTS) {
                clear(email);
                throw new RuntimeException("Too many incorrect codes. Please start over.");
            }

            savePreservingTtl(pending);
            int remaining = MAX_ATTEMPTS - pending.getAttempts();
            throw new RuntimeException("Incorrect code. " + remaining + " attempt(s) left.");
        }

        clear(email);
        return pending;
    }

    // ── internals ────────────────────────────────────────────

    private long issueCode(PendingRegistration pending, Duration ttl) {
        String otp = generateOtp();
        pending.setOtpHash(passwordEncoder.encode(otp));

        redisTemplate.opsForValue().set(pendingKey(pending.getEmail()), pending, ttl);
        startCooldown(pending.getEmail());

        // If the mail fails the sign-up is useless, so don't leave it pending —
        // and lift the cooldown so the user can retry straight away.
        try {
            emailService.sendOtp(pending.getEmail(), pending.getUsername(), otp, ttlMinutes);
        } catch (RuntimeException ex) {
            clear(pending.getEmail());
            redisTemplate.delete(cooldownKey(pending.getEmail()));
            throw ex;
        }

        return ttl.toSeconds();
    }

    private String generateOtp() {
        return String.format("%06d", secureRandom.nextInt(OTP_BOUND));
    }

    private PendingRegistration loadPending(String email) {
        Object value = redisTemplate.opsForValue().get(pendingKey(email));

        if (!(value instanceof PendingRegistration pending)) {
            throw new RuntimeException("No pending verification for this email. Please sign up again.");
        }

        return pending;
    }

    /** Re-save after a failed attempt without extending the original expiry. */
    private void savePreservingTtl(PendingRegistration pending) {
        String key = pendingKey(pending.getEmail());
        Long remaining = redisTemplate.getExpire(key, TimeUnit.SECONDS);

        if (remaining == null || remaining <= 0) {
            throw new RuntimeException("Your code has expired. Please sign up again.");
        }

        redisTemplate.opsForValue().set(key, pending, Duration.ofSeconds(remaining));
    }

    private void requireNoCooldown(String email) {
        Long remaining = redisTemplate.getExpire(cooldownKey(email), TimeUnit.SECONDS);

        if (remaining != null && remaining > 0) {
            throw new RuntimeException("Please wait " + remaining + "s before requesting another code.");
        }
    }

    private void startCooldown(String email) {
        redisTemplate.opsForValue().set(
                cooldownKey(email), "1", Duration.ofSeconds(resendCooldownSeconds));
    }

    private void clear(String email) {
        redisTemplate.delete(pendingKey(email));
    }

    private String pendingKey(String email) {
        return PENDING_KEY_PREFIX + normalize(email);
    }

    private String cooldownKey(String email) {
        return COOLDOWN_KEY_PREFIX + normalize(email);
    }

    /** Keys are case-insensitive; the stored email keeps its original casing. */
    private String normalize(String email) {
        return email.trim().toLowerCase();
    }
}
