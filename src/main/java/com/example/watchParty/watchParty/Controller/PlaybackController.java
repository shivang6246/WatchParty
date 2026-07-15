package com.example.watchParty.watchParty.Controller;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import com.example.watchParty.watchParty.DTO.PlayBackEventdto;
import com.example.watchParty.watchParty.Service.PlaybackService;

import lombok.RequiredArgsConstructor;

@Controller
@RequiredArgsConstructor
public class PlaybackController {

    private final PlaybackService playbackService;

    @MessageMapping("/playback")
    public void handleEvent(PlayBackEventdto event) {

        playbackService.broadcastPlaybackEvent(event);

    }

}