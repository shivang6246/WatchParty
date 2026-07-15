package com.example.watchParty.watchParty.Controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.watchParty.watchParty.DTO.EndRoomRequestDto;
import com.example.watchParty.watchParty.DTO.InviteLinkResponseDto;
import com.example.watchParty.watchParty.DTO.JoinRoomRequestDto;
import com.example.watchParty.watchParty.DTO.KickMemberRequestDto;
import com.example.watchParty.watchParty.DTO.LeaveRoomRequestDto;
import com.example.watchParty.watchParty.DTO.RoomMemberResponseDto;
import com.example.watchParty.watchParty.DTO.RoomRequestDto;
import com.example.watchParty.watchParty.DTO.RoomResponseDto;
import com.example.watchParty.watchParty.DTO.UpdateRoleRequestDto;
import com.example.watchParty.watchParty.Service.RoomService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/room")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService roomService;

    @PostMapping
    public ResponseEntity<RoomResponseDto> createRoom(@RequestBody @Valid RoomRequestDto request) {
        return ResponseEntity.ok(roomService.createRoom(request));
    }

    @GetMapping("/{roomCode}")
    public ResponseEntity<RoomResponseDto> getRoomDetails(@PathVariable String roomCode) {
        return ResponseEntity.ok(roomService.getRoomDetails(roomCode));
    }

    @PostMapping("/join")
    public ResponseEntity<RoomResponseDto> joinRoom(@RequestBody @Valid JoinRoomRequestDto request) {
        return ResponseEntity.ok(roomService.joinRoom(request));
    }

    @PostMapping("/join/invite/{inviteToken}")
    public ResponseEntity<RoomResponseDto> joinByInvite(@PathVariable String inviteToken) {
        return ResponseEntity.ok(roomService.joinByInviteToken(inviteToken));
    }

    @PostMapping("/leaveRoom")
    public ResponseEntity<RoomResponseDto> leaveRoom(@RequestBody @Valid LeaveRoomRequestDto request) {
        return ResponseEntity.ok(roomService.leaveRoom(request));
    }

    @PostMapping("/kick")
    public ResponseEntity<RoomResponseDto> kickMember(@RequestBody @Valid KickMemberRequestDto request) {
        return ResponseEntity.ok(roomService.kickMember(request));
    }

    @PostMapping("/end")
    public ResponseEntity<RoomResponseDto> endRoom(@RequestBody @Valid EndRoomRequestDto request) {
        return ResponseEntity.ok(roomService.endRoom(request));
    }

    @GetMapping("/{roomCode}/members")
    public ResponseEntity<List<RoomMemberResponseDto>> getRoomMembers(@PathVariable String roomCode) {
        return ResponseEntity.ok(roomService.getRoomMember(roomCode));
    }

    @GetMapping("/{roomCode}/invite")
    public ResponseEntity<InviteLinkResponseDto> getInviteLink(@PathVariable String roomCode) {
        return ResponseEntity.ok(roomService.getInviteLink(roomCode));
    }

    @PostMapping("/{roomCode}/role")
    public ResponseEntity<RoomMemberResponseDto> updateMemberRole(
            @PathVariable String roomCode,
            @RequestBody @Valid UpdateRoleRequestDto request) {
        request.setRoomCode(roomCode);
        return ResponseEntity.ok(roomService.updateMemberRole(request));
    }
}
