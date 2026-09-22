package com.example.watchParty.watchParty.Service;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    /**
     * Resolved lazily: Spring only auto-configures a JavaMailSender when
     * spring.mail.host is set, so the app must still start without SMTP.
     */
    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${app.mail.enabled:false}")
    private boolean mailEnabled;

    @Value("${app.mail.from:}")
    private String from;

    public void sendOtp(String to, String username, String otp, long ttlMinutes) {
        String subject = "Your WatchParty verification code";
        String body = """
                Hi %s,

                Your WatchParty verification code is:

                    %s

                It expires in %d minutes. If you didn't try to create an account,
                you can safely ignore this email.

                — WatchParty
                """.formatted(username, otp, ttlMinutes);

        if (!mailEnabled) {
            // Dev fallback: no SMTP configured, so print the code to the server log.
            log.warn("Mail is disabled — verification code for {} is {} (set MAIL_ENABLED=true to send real email)",
                    to, otp);
            return;
        }

        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.error("MAIL_ENABLED=true but no mail sender is configured (missing spring.mail.host)");
            throw new RuntimeException("Email service is not configured");
        }

        if (from == null || from.isBlank()) {
            log.error("MAIL_ENABLED=true but no sender address is set (MAIL_FROM / MAIL_USERNAME)");
            throw new RuntimeException("Email service is not configured");
        }

        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to);
        message.setSubject(subject);
        message.setText(body);

        try {
            sender.send(message);
            log.info("Verification code sent to {}", to);
        } catch (MailException ex) {
            log.error("Failed to send verification email to {}", to, ex);
            throw new RuntimeException("Could not send the verification email. Please try again.");
        }
    }
}
