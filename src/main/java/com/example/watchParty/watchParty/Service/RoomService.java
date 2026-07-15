package com.example.watchParty.watchParty.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Random;
import java.util.UUID;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.Caching;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import com.example.watchParty.watchParty.DTO.EndRoomRequestDto;
import com.example.watchParty.watchParty.DTO.InviteLinkResponseDto;
import com.example.watchParty.watchParty.DTO.JoinRoomRequestDto;
import com.example.watchParty.watchParty.DTO.KickMemberRequestDto;
import com.example.watchParty.watchParty.DTO.LeaveRoomRequestDto;
import com.example.watchParty.watchParty.DTO.RoomEventDto;
import com.example.watchParty.watchParty.DTO.RoomMemberResponseDto;
import com.example.watchParty.watchParty.DTO.RoomRequestDto;
import com.example.watchParty.watchParty.DTO.RoomResponseDto;
import com.example.watchParty.watchParty.DTO.UpdateRoleRequestDto;
import com.example.watchParty.watchParty.Entity.Room;
import com.example.watchParty.watchParty.Entity.RoomMember;
import com.example.watchParty.watchParty.Enum.RoomRole;
import com.example.watchParty.watchParty.Repository.RoomMemberRepo;
import com.example.watchParty.watchParty.Repository.roomRepo;

@Service
public class RoomService {

    private final roomRepo roomRepo;
    private final RoomMemberRepo roomMemberRepo;
    private final RoomEventService roomEventService;
    private final RoomService self;

    public RoomService(roomRepo roomRepo,
                       RoomMemberRepo roomMemberRepo,
                       RoomEventService roomEventService,
                       @Lazy RoomService self) {
        this.roomRepo = roomRepo;
        this.roomMemberRepo = roomMemberRepo;
        this.roomEventService = roomEventService;
        this.self = self;
    }

    // ==================== CREATE ROOM ====================

    public RoomResponseDto createRoom(RoomRequestDto request) {
        String roomCode;
        do {
            roomCode = generateRoomCode();
        } while (roomRepo.existsByRoomCode(roomCode));

        String username = getCurrentUsername();

        Room room = new Room();
        room.setRoomCode(roomCode);
        room.setRoomName(request.getRoomName());
        room.setHost(username);
        room.setLocked(request.getLocked());
        room.setActive(true);
        room.setPlaybackSpeed(1.0);
        room.setSequenceNumber(0L);
        room.setInviteToken(UUID.randomUUID().toString().replace("-", "").substring(0, 12));
        room.setCreatedAt(LocalDateTime.now());
        room.setUpdatedAt(LocalDateTime.now());

        // Associate video with room if provided
        if (request.getVideoUrl() != null && !request.getVideoUrl().isBlank()) {
            room.setVideoUrl(request.getVideoUrl());
        }
        if (request.getPlatform() != null && !request.getPlatform().isBlank()) {
            room.setPlatform(request.getPlatform());
        }

        Room savedRoom = roomRepo.save(room);

        // Add creator as HOST member
        RoomMember hostMember = new RoomMember();
        hostMember.setUsername(username);
        hostMember.setRoom(savedRoom);
        hostMember.setRoomRole(RoomRole.HOST);
        hostMember.setOnline(true);
        hostMember.setJoinedAt(LocalDateTime.now());
        roomMemberRepo.save(hostMember);

        return toRoomResponse(savedRoom);
    }

    // ==================== JOIN ROOM ====================

    @Caching(evict = {
            @CacheEvict(value = "room_details", key = "#request.roomCode"),
            @CacheEvict(value = "room_members", key = "#request.roomCode")
    })
    public RoomResponseDto joinRoom(JoinRoomRequestDto request) {
        Room room = roomRepo.findByRoomCode(request.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room not found"));

        validateRoomActive(room);

        if (room.getLocked()) {
            throw new RuntimeException("Room is locked");
        }

        return addMemberToRoom(room, getCurrentUsername());
    }

    // ==================== JOIN BY INVITE TOKEN ====================

    public RoomResponseDto joinByInviteToken(String inviteToken) {
        Room room = roomRepo.findByInviteToken(inviteToken)
                .orElseThrow(() -> new RuntimeException("Invalid invite link"));

        validateRoomActive(room);

        // Evict caches via proxy since we don't have roomCode as a direct param
        self.evictRoomCaches(room.getRoomCode());

        // Invite links bypass room lock
        return addMemberToRoom(room, getCurrentUsername());
    }

    // ==================== LEAVE ROOM ====================

    @Caching(evict = {
            @CacheEvict(value = "room_details", key = "#request.roomCode"),
            @CacheEvict(value = "room_members", key = "#request.roomCode")
    })
    public RoomResponseDto leaveRoom(LeaveRoomRequestDto request) {
        Room room = roomRepo.findByRoomCode(request.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room not found"));

        String username = getCurrentUsername();

        RoomMember member = roomMemberRepo.findByUsernameAndRoom(username, room)
                .orElseThrow(() -> new RuntimeException("User is not in this room"));

        boolean wasHost = room.getHost().equals(username);

        roomMemberRepo.delete(member);

        long memberCount = roomMemberRepo.countByRoom(room);

        if (memberCount == 0) {
            room.setActive(false);
            room.setUpdatedAt(LocalDateTime.now());
            roomRepo.save(room);
        } else if (wasHost) {
            // Transfer host to the oldest remaining member
            transferHost(room);
        }

        broadcastRoomEvent(room.getRoomCode(), username, "USER_LEFT");

        return toRoomResponse(room);
    }

    // ==================== KICK MEMBER ====================

    @Caching(evict = {
            @CacheEvict(value = "room_details", key = "#request.roomCode"),
            @CacheEvict(value = "room_members", key = "#request.roomCode")
    })
    public RoomResponseDto kickMember(KickMemberRequestDto request) {
        Room room = roomRepo.findByRoomCode(request.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room not found"));

        String currentUser = getCurrentUsername();
        RoomMember currentMember = roomMemberRepo.findByUsernameAndRoom(currentUser, room)
                .orElseThrow(() -> new RuntimeException("You are not in this room"));

        // Only HOST or ADMIN can kick
        if (currentMember.getRoomRole() != RoomRole.HOST && currentMember.getRoomRole() != RoomRole.ADMIN) {
            throw new RuntimeException("Only host or admin can kick members");
        }

        RoomMember targetMember = roomMemberRepo.findByUsernameAndRoom(request.getTargetUsername(), room)
                .orElseThrow(() -> new RuntimeException("Target user is not in this room"));

        // Cannot kick the host
        if (targetMember.getRoomRole() == RoomRole.HOST) {
            throw new RuntimeException("Cannot kick the host");
        }

        // Admin cannot kick another admin
        if (currentMember.getRoomRole() == RoomRole.ADMIN && targetMember.getRoomRole() == RoomRole.ADMIN) {
            throw new RuntimeException("Admins cannot kick other admins");
        }

        roomMemberRepo.delete(targetMember);

        broadcastRoomEvent(room.getRoomCode(), request.getTargetUsername(), "USER_KICKED");

        return toRoomResponse(room);
    }

    // ==================== INVITE LINK ====================

    @Cacheable(value = "room_invite", key = "#roomCode")
    public InviteLinkResponseDto getInviteLink(String roomCode) {
        Room room = roomRepo.findByRoomCode(roomCode)
                .orElseThrow(() -> new RuntimeException("Room not found"));

        validateRoomActive(room);

        // Regenerate if missing
        if (room.getInviteToken() == null) {
            room.setInviteToken(UUID.randomUUID().toString().replace("-", "").substring(0, 12));
            roomRepo.save(room);
        }

        return InviteLinkResponseDto.builder()
                .inviteToken(room.getInviteToken())
                .roomCode(room.getRoomCode())
                .roomName(room.getRoomName())
                .build();
    }

    // ==================== UPDATE MEMBER ROLE ====================

    @CacheEvict(value = "room_members", key = "#request.roomCode")
    public RoomMemberResponseDto updateMemberRole(UpdateRoleRequestDto request) {
        Room room = roomRepo.findByRoomCode(request.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room not found"));

        String currentUser = getCurrentUsername();

        // Only host can change roles
        if (!room.getHost().equals(currentUser)) {
            throw new RuntimeException("Only the host can update member roles");
        }

        RoomMember targetMember = roomMemberRepo.findByUsernameAndRoom(request.getTargetUsername(), room)
                .orElseThrow(() -> new RuntimeException("Target user is not in this room"));

        // Cannot change host's own role
        if (targetMember.getUsername().equals(currentUser)) {
            throw new RuntimeException("Cannot change your own role");
        }

        RoomRole newRole;
        try {
            newRole = RoomRole.valueOf(request.getNewRole().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new RuntimeException("Invalid role. Must be ADMIN or VIEWER");
        }

        if (newRole == RoomRole.HOST) {
            throw new RuntimeException("Cannot assign HOST role directly. Use host transfer instead.");
        }

        targetMember.setRoomRole(newRole);
        RoomMember saved = roomMemberRepo.save(targetMember);

        broadcastRoomEvent(room.getRoomCode(), request.getTargetUsername(), "ROLE_CHANGED");

        return toMemberResponse(saved);
    }

    // ==================== GET ROOM DETAILS ====================

    @Cacheable(value = "room_details", key = "#roomCode")
    public RoomResponseDto getRoomDetails(String roomCode) {
        Room room = roomRepo.findByRoomCode(roomCode)
                .orElseThrow(() -> new RuntimeException("Room not found"));
        return toRoomResponse(room);
    }

    // ==================== GET ROOM MEMBERS ====================

    @Cacheable(value = "room_members", key = "#roomCode")
    public List<RoomMemberResponseDto> getRoomMember(String roomCode) {
        Room room = roomRepo.findByRoomCode(roomCode)
                .orElseThrow(() -> new RuntimeException("Room not found"));

        return roomMemberRepo.findByRoom(room).stream()
                .map(this::toMemberResponse)
                .collect(java.util.stream.Collectors.toList());
    }

    // ==================== END ROOM ====================

    @Caching(evict = {
            @CacheEvict(value = "room_details", key = "#request.roomCode"),
            @CacheEvict(value = "room_members", key = "#request.roomCode"),
            @CacheEvict(value = "room_invite", key = "#request.roomCode")
    })
    public RoomResponseDto endRoom(EndRoomRequestDto request) {
        Room room = roomRepo.findByRoomCode(request.getRoomCode())
                .orElseThrow(() -> new RuntimeException("Room not found"));

        String username = getCurrentUsername();

        if (!room.getHost().equals(username)) {
            throw new RuntimeException("Only host can end the room");
        }

        room.setActive(false);
        room.setUpdatedAt(LocalDateTime.now());

        Room savedRoom = roomRepo.save(room);

        broadcastRoomEvent(room.getRoomCode(), username, "ROOM_ENDED");

        return toRoomResponse(savedRoom);
    }

    // ==================== PRIVATE HELPERS ====================

    @Caching(evict = {
            @CacheEvict(value = "room_details", key = "#roomCode"),
            @CacheEvict(value = "room_members", key = "#roomCode")
    })
    public void evictRoomCaches(String roomCode) {
        // Intentionally empty — annotations handle cache eviction
    }

    private void transferHost(Room room) {
        RoomMember nextHost = roomMemberRepo.findFirstByRoomOrderByJoinedAtAsc(room)
                .orElse(null);

        if (nextHost != null) {
            nextHost.setRoomRole(RoomRole.HOST);
            roomMemberRepo.save(nextHost);

            room.setHost(nextHost.getUsername());
            room.setUpdatedAt(LocalDateTime.now());
            roomRepo.save(room);

            broadcastRoomEvent(room.getRoomCode(), nextHost.getUsername(), "HOST_TRANSFERRED");
        }
    }

    private RoomResponseDto addMemberToRoom(Room room, String username) {
        if (roomMemberRepo.existsByUsernameAndRoom(username, room)) {
            throw new RuntimeException("User already joined room");
        }

        RoomMember member = new RoomMember();
        member.setUsername(username);
        member.setRoom(room);
        member.setRoomRole(RoomRole.VIEWER);
        member.setOnline(true);
        member.setJoinedAt(LocalDateTime.now());
        roomMemberRepo.save(member);

        broadcastRoomEvent(room.getRoomCode(), username, "USER_JOINED");

        return toRoomResponse(room);
    }

    private void validateRoomActive(Room room) {
        if (!room.getActive()) {
            throw new RuntimeException("Room is inactive");
        }
    }

    private void broadcastRoomEvent(String roomCode, String username, String eventType) {
        RoomEventDto event = new RoomEventDto();
        event.setRoomCode(roomCode);
        event.setUsername(username);
        event.setEventType(eventType);
        roomEventService.broadCastRoomEvent(event);
    }

    private RoomResponseDto toRoomResponse(Room room) {
        RoomResponseDto response = new RoomResponseDto();
        response.setRoomCode(room.getRoomCode());
        response.setRoomName(room.getRoomName());
        response.setHost(room.getHost());
        response.setLocked(room.getLocked());
        response.setActive(room.getActive());
        response.setInviteToken(room.getInviteToken());
        response.setPlaybackSpeed(room.getPlaybackSpeed());
        response.setVideoUrl(room.getVideoUrl());
        response.setPlatform(room.getPlatform());
        return response;
    }

    private RoomMemberResponseDto toMemberResponse(RoomMember member) {
        RoomMemberResponseDto dto = new RoomMemberResponseDto();
        dto.setUsername(member.getUsername());
        dto.setRoomRole(member.getRoomRole());
        dto.setOnline(member.getOnline());
        dto.setJoinedAt(member.getJoinedAt());
        return dto;
    }

    private String generateRoomCode() {
        String characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Random random = new Random();
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            code.append(characters.charAt(random.nextInt(characters.length())));
        }
        return code.toString();
    }

    private String getCurrentUsername() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }
}
