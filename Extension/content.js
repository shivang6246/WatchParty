/**
 * WatchParty Content Script
 * Manages video state listeners, programmatically seeks/plays/pauses YouTube & Netflix videos,
 * and relays video control events to the extension background script.
 */

console.log("WatchParty content script loaded!");

const hostname = window.location.hostname;

function getActiveVideoElement() {
  if (hostname.includes("youtube.com")) {
    return document.querySelector("ytd-player video, #movie_player video") || document.querySelector("video");
  }
  return document.querySelector("video");
}

let platform = null;
let videoId = null;

if (hostname.includes("youtube.com")) {
  platform = "YOUTUBE";
  videoId = new URLSearchParams(window.location.search).get("v");
}

if (hostname.includes("netflix.com")) {
  platform = "NETFLIX";
  videoId = window.location.pathname.split("/watch/")[1];
}

console.log("Platform:", platform);
console.log("Video ID:", videoId);

// ── Sync State ─────────────────────────
let currentRoom = null;
let currentRoomHost = null;
let username = null;
let isHost = false;
let isApplyingIncomingEvent = false;

// ── Respond to on-demand queries from popup / background ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_VIDEO_INFO") {
    const video = getActiveVideoElement();

    // Dynamically update for SPA navigations
    if (hostname.includes("youtube.com")) {
      platform = "YOUTUBE";
      videoId = new URLSearchParams(window.location.search).get("v");
    } else if (hostname.includes("netflix.com")) {
      platform = "NETFLIX";
      videoId = window.location.pathname.split("/watch/")[1];
    }

    sendResponse({
      platform,
      videoId,
      videoUrl: window.location.href,
      title: document.title,
      currentTime: video ? video.currentTime : 0,
      duration: video ? video.duration : 0,
      playing: video ? !video.paused : false,
      hasVideo: !!video,
    });
    return true; // keep channel open for async
  }

  if (message.type === "SEEK_TO") {
    const video = getActiveVideoElement();
    if (video && typeof message.currentTime === "number") {
      video.currentTime = message.currentTime;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PLAY_VIDEO") {
    const video = getActiveVideoElement();
    if (video) video.play();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PAUSE_VIDEO") {
    const video = getActiveVideoElement();
    if (video) video.pause();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "APPLY_PLAYBACK_EVENT") {
    handleIncomingPlaybackEvent(message.event);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "APPLY_SYNC_STATE") {
    handleIncomingSyncState(message.state);
    sendResponse({ ok: true });
    return true;
  }
});

// ── Helper functions for Programmatic Control (echo loop prevention) ──
function playVideoProgrammatically(video) {
  if (video && video.paused) {
    console.log("Applying remote PLAY event");
    isApplyingIncomingEvent = true;
    video
      .play()
      .then(() => {
        setTimeout(() => {
          isApplyingIncomingEvent = false;
        }, 200);
      })
      .catch((err) => {
        console.warn("Play failed:", err);
        isApplyingIncomingEvent = false;
      });
  }
}

function pauseVideoProgrammatically(video) {
  if (video && !video.paused) {
    console.log("Applying remote PAUSE event");
    isApplyingIncomingEvent = true;
    video.pause();
    setTimeout(() => {
      isApplyingIncomingEvent = false;
    }, 200);
  }
}

function seekVideoProgrammatically(video, time) {
  if (video && Math.abs(video.currentTime - time) > 1.5) {
    console.log(`Applying remote SEEK event to ${time.toFixed(2)}s`);
    isApplyingIncomingEvent = true;
    video.currentTime = time;
    setTimeout(() => {
      isApplyingIncomingEvent = false;
    }, 200);
  }
}

// ── Setup Video Event Listeners (Host Only triggers events) ──
function setupVideoEventListeners(video) {
  video.addEventListener("play", () => {
    if (isApplyingIncomingEvent) return;
    if (!isHost) return;

    console.log("Local Host PLAY event detected");
    sendPlaybackEvent("PLAY", video.currentTime);
  });

  video.addEventListener("pause", () => {
    if (isApplyingIncomingEvent) return;
    if (!isHost) return;

    console.log("Local Host PAUSE event detected");
    sendPlaybackEvent("PAUSE", video.currentTime);
  });

  video.addEventListener("seeked", () => {
    if (isApplyingIncomingEvent) return;
    if (!isHost) return;

    console.log("Local Host SEEK event detected");
    sendPlaybackEvent("SEEK", video.currentTime);
  });

  video.addEventListener("ratechange", () => {
    if (isApplyingIncomingEvent) return;
    if (!isHost) return;

    console.log("Local Host SPEED_CHANGE event detected");
    sendPlaybackEvent("SPEED_CHANGE", video.currentTime);
  });
}

// ── Outgoing Playback Events ──────────────────────────
function sendPlaybackEvent(eventType, currentTime) {
  const video = getActiveVideoElement();
  const speed = video ? video.playbackRate : 1.0;

  // #region agent log
  chrome.runtime.sendMessage({
    type: "DEBUG_LOG",
    location: "content.js:sendPlaybackEvent",
    logMessage: "Host sending playback event",
    data: { eventType, currentTime, isHost, currentRoom },
    hypothesisId: "C",
  }, () => { if (chrome.runtime.lastError) { /* ignore */ } });
  // #endregion

  chrome.runtime.sendMessage({
    type: "SEND_PLAYBACK_EVENT",
    eventType: eventType,
    currentTime: currentTime,
    playbackSpeed: speed,
  });
}

function handleIncomingPlaybackEvent(event) {
  if (event.username === username) return; // ignore our own events

  const video = getActiveVideoElement();
  if (!video) return;

  console.log("Incoming remote playback event:", event);

  switch (event.eventType) {
    case "PLAY":
      playVideoProgrammatically(video);
      if (typeof event.currentTime === "number") {
        seekVideoProgrammatically(video, event.currentTime);
      }
      break;

    case "PAUSE":
      pauseVideoProgrammatically(video);
      if (typeof event.currentTime === "number") {
        seekVideoProgrammatically(video, event.currentTime);
      }
      break;

    case "SEEK":
      if (typeof event.currentTime === "number") {
        seekVideoProgrammatically(video, event.currentTime);
      }
      break;

    case "SPEED_CHANGE":
      if (typeof event.playbackSpeed === "number") {
        isApplyingIncomingEvent = true;
        video.playbackRate = event.playbackSpeed;
        setTimeout(() => {
          isApplyingIncomingEvent = false;
        }, 200);
      }
      break;
  }
}

function handleIncomingSyncState(state) {
  const video = getActiveVideoElement();
  if (!video) return;

  console.log("Incoming remote sync state:", state);

  let targetTime = state.currentTime || 0;

  // Calculate drift if video is playing in the room
  if (state.playing && state.lastPlaybackUpdate) {
    try {
      const lastUpdate = new Date(state.lastPlaybackUpdate).getTime();
      if (!isNaN(lastUpdate)) {
        const elapsed = (Date.now() - lastUpdate) / 1000;
        if (elapsed > 0 && elapsed < 3600) {
          targetTime += elapsed;
          console.log(`Adjusted for drift: added ${elapsed.toFixed(2)}s`);
        }
      }
    } catch (e) {
      console.warn("Failed to parse lastPlaybackUpdate:", e);
    }
  }

  seekVideoProgrammatically(video, targetTime);

  if (state.playing) {
    playVideoProgrammatically(video);
  } else {
    pauseVideoProgrammatically(video);
  }

  if (typeof state.playbackSpeed === "number") {
    isApplyingIncomingEvent = true;
    video.playbackRate = state.playbackSpeed;
    setTimeout(() => {
      isApplyingIncomingEvent = false;
    }, 200);
  }
}

async function initSync() {
  const data = await chrome.storage.local.get([
    "currentRoom",
    "currentRoomHost",
    "username",
  ]);

  currentRoom = data.currentRoom;
  currentRoomHost = data.currentRoomHost;
  username = data.username;
  isHost =
    currentRoomHost &&
    username &&
    currentRoomHost.toLowerCase() === username.toLowerCase();

  console.log("WatchParty initSync configuration:", {
    currentRoom,
    isHost,
    username,
  });

  // #region agent log
  chrome.runtime.sendMessage({
    type: "DEBUG_LOG",
    location: "content.js:initSync",
    logMessage: "Content script sync init",
    data: { currentRoom, isHost, username, hasVideo: !!getActiveVideoElement() },
    hypothesisId: "C",
  }, () => { if (chrome.runtime.lastError) { /* ignore */ } });
  // #endregion

  const video = getActiveVideoElement();
  if (currentRoom && video) {
    console.log("Requesting sync from background script");
    chrome.runtime.sendMessage({ type: "REQUEST_SYNC" });
  }
}

// Watch storage shifts (joining/leaving rooms, login changes)
chrome.storage.onChanged.addListener((changes) => {
  if (
    changes.currentRoom ||
    changes.currentRoomHost ||
    changes.jwt ||
    changes.username
  ) {
    initSync();
  }
});

// ── Continuous Observer for SPA Navigation & Video Detection ──
let lastUrl = location.href;

function checkPageChange() {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log("URL change detected:", currentUrl);
    
    // Re-parse videoId for the new video page
    if (hostname.includes("youtube.com")) {
      platform = "YOUTUBE";
      videoId = new URLSearchParams(window.location.search).get("v");
    } else if (hostname.includes("netflix.com")) {
      platform = "NETFLIX";
      videoId = window.location.pathname.split("/watch/")[1];
    }
    
    // Notify background script of the new video ID
    chrome.runtime.sendMessage({
      type: "VIDEO_DETECTED",
      platform,
      videoId,
    });

    chrome.storage.local.get(["currentRoom", "currentRoomHost", "username"], (data) => {
      const room = data.currentRoom;
      const host = data.currentRoomHost;
      const user = data.username;
      const hostIsCurrentUser = host && user && host.toLowerCase() === user.toLowerCase();
      if (hostIsCurrentUser && room) {
        console.log("Host changed video, notifying room:", currentUrl);
        chrome.runtime.sendMessage({
          type: "HOST_VIDEO_CHANGED",
          videoUrl: currentUrl,
          platform: platform
        });
      }
    });
    
    // Reset/re-initialize sync for the new video URL
    initSync();
  }

  const video = getActiveVideoElement();
  if (video && !video.__wp_listeners_attached) {
    console.log("Video element detected, attaching playback listeners");
    setupVideoEventListeners(video);
    video.__wp_listeners_attached = true;
    initSync();
  }
}

// Check every second to catch SPA transitions or delayed element rendering
setInterval(checkPageChange, 1000);
