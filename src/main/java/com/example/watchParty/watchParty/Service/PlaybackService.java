package com.example.watchParty.watchParty.Service;

import java.time.Duration;
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

    public void broadcastPlaybackEvent(PlayBackEventdto event, String requester) {
        // Trust the authenticated session over the client-supplied username
        if (requester != null) {
            event.setUsername(requester);
        }

        Room room = repo.findByRoomCode(event.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room Not Found"));

        // SYNC_REQUEST can be sent by any user (new user requesting current state)
        if ("SYNC_REQUEST".equals(event.getEventType())) {
            if (requester == null) {
                return;
            }
            PlaybackStateDto state = toStateDto(room);
            state.setCurrentTime(livePosition(room));
            messagingTemplate.convertAndSendToUser(requester, "/queue/sync", state);
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

        // room_details carries videoUrl/playbackSpeed; a stale copy sent viewers back to the old video
        if ("VIDEO_CHANGED".equals(event.getEventType()) || "SPEED_CHANGE".equals(event.getEventType())) {
            self.evictRoomDetailsCache(event.getRoomCode());
        }

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

    @CacheEvict(value = "room_details", key = "#roomCode")
    public void evictRoomDetailsCache(String roomCode) {
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
                // lastPlaybackUpdate is reset below, so the position must be re-anchored too
                if (event.getCurrentTime() != null) {
                    room.setCurrentTime(event.getCurrentTime());
                }
                break;

            case "HEARTBEAT":
                room.setCurrentTime(event.getCurrentTime());
                if (event.getPlaying() != null) {
                    room.setPlaying(event.getPlaying());
                }
                if (event.getPlaybackSpeed() != null) {
                    room.setPlaybackSpeed(event.getPlaybackSpeed());
                }
                break;

            case "VIDEO_CHANGED":
                room.setVideoUrl(event.getVideoUrl());
                room.setPlatform(event.getPlatform());
                room.setCurrentTime(0.0);
                room.setPlaying(false);
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

        return toStateDto(room);
    }

    // Extrapolated on the server so clients don't depend on their clock or timezone
    private double livePosition(Room room) {
        double position = room.getCurrentTime() != null ? room.getCurrentTime() : 0.0;
        if (Boolean.TRUE.equals(room.getPlaying()) && room.getLastPlaybackUpdate() != null) {
            long elapsedMs = Duration.between(room.getLastPlaybackUpdate(), LocalDateTime.now()).toMillis();
            position += Math.max(0, elapsedMs) / 1000.0 * room.getPlaybackSpeed();
        }
        return position;
    }

    private PlaybackStateDto toStateDto(Room room) {
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
