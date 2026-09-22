package com.example.watchParty.watchParty.DTO;

import java.io.Serializable;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A sign-up that is waiting on email verification. Held in Redis (never in
 * Postgres) until the user proves they own the address by entering the OTP —
 * only then is a {@code User} row created.
 *
 * The password is stored already BCrypt-encoded so a raw password never sits
 * in Redis, and the OTP is stored as a hash so a Redis dump cannot be replayed.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PendingRegistration implements Serializable {

    private static final long serialVersionUID = 1L;

    private String username;

    private String email;

    /** BCrypt hash of the chosen password. */
    private String passwordHash;

    /** BCrypt hash of the current OTP. */
    private String otpHash;

    /** Failed verification attempts against the current OTP. */
    private int attempts;
}
