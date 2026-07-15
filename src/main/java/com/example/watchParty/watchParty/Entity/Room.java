package com.example.watchParty.watchParty.Entity;

import java.io.Serializable;
import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
@Entity
@Table(name = "room")

public class Room implements Serializable {

    private static final long serialVersionUID = 1L;
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String roomCode;

    @Column(nullable = false)
    private String host;

    @Column(nullable = false)
    private String roomName;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private Boolean locked;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    private Boolean playing;

    @PositiveOrZero
    @Column(name = "\"current_time\"")
    private Double currentTime;

    @Size(max = 500)
    private String currentVideoId;

    @Size(max = 1000)
    private String videoUrl;

    @Size(max = 20)
    private String platform;

    private LocalDateTime lastPlaybackUpdate;

    @Column(nullable = false)
    private Double playbackSpeed = 1.0;

    @Column(unique = true)
    private String inviteToken;

    @Column(nullable = false)
    private Long sequenceNumber = 0L;
}
