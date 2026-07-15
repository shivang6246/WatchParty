package com.example.watchParty.watchParty.Service;

import java.time.LocalDateTime;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.PlayBackEventdto;
import com.example.watchParty.watchParty.DTO.PlaybackStateDto;
import com.example.watchParty.watchParty.Entity.Room;
import com.example.watchParty.watchParty.Repository.roomRepo;

@Service
public class PlaybackService {

    private final SimpMessagingTemplate messagingTemplate;
    private final roomRepo repo;
    private final PlaybackService self;

    public PlaybackService(SimpMessagingTemplate messagingTemplate,
                           roomRepo repo,
                           @Lazy PlaybackService self) {
        this.messagingTemplate = messagingTemplate;
        this.repo = repo;
        this.self = self;
    }

    public void broadcastPlaybackEvent(PlayBackEventdto event) {
        Room room = repo.findByRoomCode(event.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room Not Found"));

        // SYNC_REQUEST can be sent by any user (new user requesting current state)
        if ("SYNC_REQUEST".equals(event.getEventType())) {
            PlaybackStateDto state = self.getPlayBackState(event.getRoomCode());
            // Send state back to requesting user only
            messagingTemplate.convertAndSend(
                    "/topic/room/" + event.getRoomCode() + "/sync",
                    state);
            return;
        }

        // BUFFERING events can come from any user
        if ("BUFFERING".equals(event.getEventType())) {
            messagingTemplate.convertAndSend(
                    "/topic/room/" + event.getRoomCode(),
                    event);
            return;
        }

        // All other playback controls are host-only
        if (!room.getHost().equals(event.getUsername())) {
            throw new RuntimeException("Only Host can control Playback");
        }

        // Conflict handling: reject stale events
        if (event.getSequenceNumber() != null && event.getSequenceNumber() < room.getSequenceNumber()) {
            throw new RuntimeException("Stale playback event (sequence " + event.getSequenceNumber()
                    + " < current " + room.getSequenceNumber() + ")");
        }

        updatePlaybackState(room, event);

        // Evict playback cache after state update (via proxy)
        self.evictPlaybackCache(event.getRoomCode());

        // Set the updated sequence number on the outgoing event
        event.setSequenceNumber(room.getSequenceNumber());

        messagingTemplate.convertAndSend(
                "/topic/room/" + event.getRoomCode(),
                event);
    }

    @CacheEvict(value = "playback_state", key = "#roomCode")
    public void evictPlaybackCache(String roomCode) {
        // Intentionally empty — annotation handles cache eviction
    }

    private void updatePlaybackState(Room room, PlayBackEventdto event) {
        switch (event.getEventType()) {
            case "PLAY":
                room.setPlaying(true);
                room.setCurrentTime(event.getCurrentTime());
                break;

            case "PAUSE":
                room.setPlaying(false);
                room.setCurrentTime(event.getCurrentTime());
                break;

            case "SEEK":
                room.setCurrentTime(event.getCurrentTime());
                break;

            case "SPEED_CHANGE":
                if (event.getPlaybackSpeed() != null) {
                    room.setPlaybackSpeed(event.getPlaybackSpeed());
                }
                break;
        }

        // Increment sequence number for conflict resolution
        room.setSequenceNumber(room.getSequenceNumber() + 1);
        room.setLastPlaybackUpdate(LocalDateTime.now());
        repo.save(room);
    }

    @Cacheable(value = "playback_state", key = "#roomCode")
    public PlaybackStateDto getPlayBackState(String roomCode) {
        Room room = repo.findByRoomCode(roomCode)
                .orElseThrow(() -> new RuntimeException("Room Not Found"));

        PlaybackStateDto response = new PlaybackStateDto();
        response.setPlaying(room.getPlaying());
        response.setCurrentTime(room.getCurrentTime());
        response.setCurrentVideoId(room.getCurrentVideoId());
        response.setLastPlaybackUpdate(room.getLastPlaybackUpdate());
        response.setPlaybackSpeed(room.getPlaybackSpeed());
        response.setSequenceNumber(room.getSequenceNumber());

        return response;
    }
}
