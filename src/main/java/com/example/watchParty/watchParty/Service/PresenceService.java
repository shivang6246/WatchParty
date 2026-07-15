package com.example.watchParty.watchParty.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.OnlineUsersResponseDto;
import com.example.watchParty.watchParty.DTO.PresenceEventDto;
import com.example.watchParty.watchParty.Entity.Room;
import com.example.watchParty.watchParty.Entity.RoomMember;
import com.example.watchParty.watchParty.Repository.RoomMemberRepo;
import com.example.watchParty.watchParty.Repository.roomRepo;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class PresenceService {

    private final StringRedisTemplate redisTemplate;
    private final SimpMessagingTemplate messagingTemplate;
    private final RoomMemberRepo roomMemberRepo;
    private final roomRepo roomRepo;

    @Value("${app.presence.heartbeat-timeout-seconds:90}")
    private int heartbeatTimeoutSeconds;

    private static final String PRESENCE_KEY_PREFIX = "presence:";

    /**
     * Mark a user as online in a room. Stores a Redis key with TTL and updates the DB.
     */
    public void userConnected(String roomCode, String username) {
        String key = buildKey(roomCode, username);
        redisTemplate.opsForValue().set(key, "online", Duration.ofSeconds(heartbeatTimeoutSeconds));

        updateMemberOnlineStatus(roomCode, username, true);

        broadcastPresenceEvent(roomCode, username, "ONLINE");
        log.info("User {} connected to room {}", username, roomCode);
    }

    /**
     * Mark a user as offline in a room.
     */
    public void userDisconnected(String roomCode, String username) {
        String key = buildKey(roomCode, username);
        redisTemplate.delete(key);

        updateMemberOnlineStatus(roomCode, username, false);

        broadcastPresenceEvent(roomCode, username, "OFFLINE");
        log.info("User {} disconnected from room {}", username, roomCode);
    }

    /**
     * Refresh the heartbeat TTL for a user.
     */
    public void heartbeat(String roomCode, String username) {
        String key = buildKey(roomCode, username);
        Boolean exists = redisTemplate.hasKey(key);

        if (Boolean.TRUE.equals(exists)) {
            redisTemplate.expire(key, Duration.ofSeconds(heartbeatTimeoutSeconds));
        } else {
            // User was not tracked — re-register
            userConnected(roomCode, username);
        }
    }

    /**
     * Get list of online users in a room from Redis.
     */
    public OnlineUsersResponseDto getOnlineUsers(String roomCode) {
        Set<String> keys = redisTemplate.keys(PRESENCE_KEY_PREFIX + roomCode + ":*");

        List<String> users = new ArrayList<>();
        if (keys != null) {
            for (String key : keys) {
                String username = key.substring(key.lastIndexOf(":") + 1);
                users.add(username);
            }
        }

        return OnlineUsersResponseDto.builder()
                .roomCode(roomCode)
                .users(users)
                .count(users.size())
                .build();
    }

    /**
     * Scheduled task: check for expired heartbeats and mark users offline.
     * Runs every 30 seconds.
     */
    @Scheduled(fixedRate = 30000)
    public void cleanupStaleUsers() {
        List<Room> activeRooms = roomRepo.findByActiveTrue();

        for (Room room : activeRooms) {
            List<RoomMember> onlineMembers = roomMemberRepo.findByRoomAndOnlineTrue(room);

            for (RoomMember member : onlineMembers) {
                String key = buildKey(room.getRoomCode(), member.getUsername());
                Boolean exists = redisTemplate.hasKey(key);

                if (!Boolean.TRUE.equals(exists)) {
                    // Heartbeat expired — mark offline
                    member.setOnline(false);
                    roomMemberRepo.save(member);

                    broadcastPresenceEvent(room.getRoomCode(), member.getUsername(), "OFFLINE");
                    log.info("Stale user {} removed from room {}", member.getUsername(), room.getRoomCode());
                }
            }
        }
    }

    // ==================== PRIVATE HELPERS ====================

    private void updateMemberOnlineStatus(String roomCode, String username, boolean online) {
        Room room = roomRepo.findByRoomCode(roomCode).orElse(null);
        if (room == null) return;

        RoomMember member = roomMemberRepo.findByUsernameAndRoom(username, room).orElse(null);
        if (member == null) return;

        member.setOnline(online);
        roomMemberRepo.save(member);
    }

    private void broadcastPresenceEvent(String roomCode, String username, String eventType) {
        PresenceEventDto event = PresenceEventDto.builder()
                .roomCode(roomCode)
                .username(username)
                .eventType(eventType)
                .timestamp(LocalDateTime.now())
                .build();

        messagingTemplate.convertAndSend(
                "/topic/room/" + roomCode + "/presence", event);
    }

    private String buildKey(String roomCode, String username) {
        return PRESENCE_KEY_PREFIX + roomCode + ":" + username;
    }
}
