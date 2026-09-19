/**
 * WatchParty Content Script
 * Manages video state listeners, programmatically seeks/plays/pauses YouTube & Netflix videos,
 * and relays video control events to the extension background script.
 */

// Wrapped so the script can be injected again next to a copy orphaned by an extension
// reload; the orphan can no longer reach the extension and must go inert.
(() => {
const isAlive = () => !!(chrome.runtime && chrome.runtime.id);
if (window.__watchPartyAlive && window.__watchPartyAlive()) return; // a live copy is already running
window.__watchPartyAlive = isAlive;

console.log("WatchParty content script loaded!");

const hostname = window.location.hostname;

function getActiveVideoElement() {
  if (hostname.includes("youtube.com")) {
    return document.querySelector("ytd-player video, #movie_player video") || document.querySelector("video");
  }
  return document.querySelector("video");
}

// During YouTube ads the same <video> element plays the ad, so its currentTime is the ad's
function isAdPlaying() {
  return !!document.querySelector("#movie_player.ad-showing");
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
        // Browsers (Brave by default) block play() until the user has interacted with the page
        if (err && err.name === "NotAllowedError") {
          showHostOnlyNotice("▶ Autoplay is blocked. Click the video once to join the playback");
        }
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

// ── Host-only control ──
// Last playback state received from the host; viewers are held to it
let hostState = null; // { playing, currentTime, speed, at }

function rememberHostState({ playing, currentTime, speed }) {
  const prev = hostState || { playing: false, currentTime: 0, speed: 1 };
  hostState = {
    playing: typeof playing === "boolean" ? playing : prev.playing,
    currentTime: typeof currentTime === "number" ? currentTime : expectedHostTime(),
    speed: typeof speed === "number" ? speed : prev.speed,
    at: Date.now(),
  };
}

function expectedHostTime() {
  if (!hostState) return 0;
  const elapsed = hostState.playing ? ((Date.now() - hostState.at) / 1000) * hostState.speed : 0;
  return hostState.currentTime + elapsed;
}

function viewerIsLocked() {
  return isAlive() && !isHost && !!currentRoom && !!hostState && !isAdPlaying();
}

let noticeEl = null;
let noticeTimer = null;

function showHostOnlyNotice(text = "🔒 Only the host can control playback") {
  if (!noticeEl) {
    noticeEl = document.createElement("div");
    Object.assign(noticeEl.style, {
      position: "fixed",
      top: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      padding: "10px 16px",
      borderRadius: "12px",
      background: "rgba(11, 14, 23, 0.92)",
      border: "1px solid rgba(233, 69, 96, 0.55)",
      boxShadow: "0 8px 30px rgba(0, 0, 0, 0.45)",
      color: "#f0f0f5",
      font: "600 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.2s ease",
    });
  }
  noticeEl.textContent = text;
  // In fullscreen only the fullscreen element's subtree is rendered
  const parent = document.fullscreenElement || document.body;
  if (noticeEl.parentNode !== parent) parent.appendChild(noticeEl);

  noticeEl.style.opacity = "1";
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeEl.style.opacity = "0";
  }, 2500);
}

// Reverts a viewer's local play/pause/seek/speed change back to the host's state
function enforceHostState(video) {
  if (!viewerIsLocked() || isApplyingIncomingEvent) return;

  let reverted = false;
  if (hostState.playing && video.paused && !video.ended) {
    playVideoProgrammatically(video);
    reverted = true;
  } else if (!hostState.playing && !video.paused) {
    pauseVideoProgrammatically(video);
    reverted = true;
  }

  const expected = expectedHostTime();
  if (Math.abs(video.currentTime - expected) > 2) {
    seekVideoProgrammatically(video, expected);
    reverted = true;
  }

  if (video.playbackRate !== hostState.speed) {
    isApplyingIncomingEvent = true;
    video.playbackRate = hostState.speed;
    setTimeout(() => {
      isApplyingIncomingEvent = false;
    }, 200);
    reverted = true;
  }

  if (reverted) showHostOnlyNotice();
}

// Stops the player's keyboard shortcuts for viewers so nothing flickers before being reverted
const PLAYER_KEYS = new Set([
  " ", "k", "K", "j", "J", "l", "L", "ArrowLeft", "ArrowRight", "Home", "End",
  ",", ".", "<", ">", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

window.addEventListener("keydown", (e) => {
  if (!viewerIsLocked() || !PLAYER_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (!getActiveVideoElement()) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  showHostOnlyNotice();
}, true);

// YouTube's play button and seek bar; other clicks (e.g. on the video itself) are reverted instead
const BLOCKED_CONTROLS = ".ytp-play-button, .ytp-progress-bar-container";

["pointerdown", "mousedown", "click"].forEach((type) => {
  window.addEventListener(type, (e) => {
    if (!viewerIsLocked() || !(e.target instanceof Element) || !e.target.closest(BLOCKED_CONTROLS)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (type === "click") showHostOnlyNotice();
  }, true);
});

// ── Setup Video Event Listeners (Host Only triggers events) ──
function shouldBroadcastLocalEvent() {
  return isAlive() && isHost && !isApplyingIncomingEvent && !isAdPlaying();
}

function setupVideoEventListeners(video) {
  video.addEventListener("play", () => {
    if (!shouldBroadcastLocalEvent()) return enforceHostState(video);

    console.log("Local Host PLAY event detected");
    sendPlaybackEvent("PLAY", video.currentTime);
  });

  video.addEventListener("pause", () => {
    if (!shouldBroadcastLocalEvent()) return enforceHostState(video);

    console.log("Local Host PAUSE event detected");
    sendPlaybackEvent("PAUSE", video.currentTime);
  });

  video.addEventListener("seeked", () => {
    if (!shouldBroadcastLocalEvent()) return enforceHostState(video);

    console.log("Local Host SEEK event detected");
    sendPlaybackEvent("SEEK", video.currentTime);
  });

  video.addEventListener("ratechange", () => {
    if (!shouldBroadcastLocalEvent()) return enforceHostState(video);

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

  // Recorded even without a video or during an ad, so enforcement has the latest host state
  switch (event.eventType) {
    case "PLAY":
      rememberHostState({ playing: true, currentTime: event.currentTime, speed: event.playbackSpeed });
      break;
    case "PAUSE":
      rememberHostState({ playing: false, currentTime: event.currentTime, speed: event.playbackSpeed });
      break;
    case "SEEK":
    case "SPEED_CHANGE":
      rememberHostState({ currentTime: event.currentTime, speed: event.playbackSpeed });
      break;
    case "HEARTBEAT":
      rememberHostState({ playing: event.playing, currentTime: event.currentTime, speed: event.playbackSpeed });
      break;
  }

  const video = getActiveVideoElement();
  // Can't seek during an ad; the next host heartbeat corrects us once it ends
  if (!video || isAdPlaying()) return;

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

    case "HEARTBEAT":
      if (typeof event.currentTime === "number") {
        seekVideoProgrammatically(video, event.currentTime);
      }
      if (event.playing) {
        playVideoProgrammatically(video);
      }
      break;
  }
}

function handleIncomingSyncState(state) {
  // The host is the source of truth; the server's copy is older than the host's own video
  if (isHost) return;

  rememberHostState({
    playing: !!state.playing,
    currentTime: state.currentTime || 0,
    speed: state.playbackSpeed,
  });

  const video = getActiveVideoElement();
  if (!video || isAdPlaying()) return;

  console.log("Incoming remote sync state:", state);

  // currentTime is already extrapolated to "now" by the server
  seekVideoProgrammatically(video, state.currentTime || 0);

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

  // Another room's host state must not lock this viewer
  if (data.currentRoom !== currentRoom) hostState = null;

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
// Not the shared videoId: GET_VIDEO_INFO also updates that one, which would hide a real change
let announcedVideoId = videoId;

function checkPageChange() {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log("URL change detected:", currentUrl);
    // The old video's state doesn't apply; initSync below requests fresh state
    hostState = null;

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

    // YouTube rewrites the URL on the same video (e.g. strips tracking params) and non-watch
    // pages have no videoId; announcing either would reset the room and reload every viewer
    if (videoId && videoId !== announcedVideoId) {
      announcedVideoId = videoId;
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
    }

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
const pageTimer = setInterval(() => {
  if (!isAlive()) {
    clearInterval(pageTimer);
    return;
  }
  checkPageChange();
}, 1000);

// ── Host Heartbeat ──
// Viewers that buffered, sat through an ad, or missed an event only get corrected when the host
// does something; re-broadcasting the host's position fixes that drift
const HEARTBEAT_INTERVAL_MS = 5000;

setInterval(() => {
  if (!isAlive()) return;
  if (!isHost || !currentRoom || isAdPlaying()) return;

  const video = getActiveVideoElement();
  // Only while playing, so a paused video in another host tab can't fight the real one
  if (!video || video.paused) return;

  chrome.runtime.sendMessage({
    type: "SEND_PLAYBACK_EVENT",
    eventType: "HEARTBEAT",
    currentTime: video.currentTime,
    playbackSpeed: video.playbackRate,
    playing: true,
  }, () => { if (chrome.runtime.lastError) { /* ignore */ } });
}, HEARTBEAT_INTERVAL_MS);
})();
