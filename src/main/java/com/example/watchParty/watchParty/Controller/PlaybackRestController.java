package com.example.watchParty.watchParty.Controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.watchParty.watchParty.DTO.PlaybackStateDto;
import com.example.watchParty.watchParty.Service.PlaybackService;

import lombok.RequiredArgsConstructor;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/playback")
public class PlaybackRestController {

    private final PlaybackService playbackService;

    @GetMapping("/{roomCode}")
    public ResponseEntity<PlaybackStateDto> getPlayeBackState(@PathVariable String roomCode) {

        PlaybackStateDto response = playbackService.getPlayBackState(roomCode);

        return ResponseEntity.ok(response);

    }

}
