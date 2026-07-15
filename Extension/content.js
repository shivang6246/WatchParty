/**
 * A lightweight, dependency-free STOMP over WebSocket client.
 * Bundled inside content.js to ensure reliable scope.
 */
class StompClient {
  constructor(url, headers = {}) {
    this.url = url;
    this.headers = headers;
    this.subscriptions = {};
    this.socket = null;
    this.connected = false;
    this.onConnect = null;
    this.onError = null;
    this.onDisconnect = null;
  }

  connect() {
    console.log("StompClient connecting to:", this.url);
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      console.error("StompClient connection failed to initialize:", err);
      if (this.onError) this.onError(err);
      return;
    }

    this.socket.onopen = () => {
      let headersStr = "";
      for (let key in this.headers) {
        headersStr += `${key}:${this.headers[key]}\n`;
      }
      this.socket.send(`CONNECT\naccept-version:1.1,1.2\n${headersStr}\n\u0000`);
    };

    this.socket.onmessage = (event) => {
      const data = event.data;
      const commandEnd = data.indexOf("\n");
      if (commandEnd === -1) return;
      const command = data.substring(0, commandEnd).trim();

      if (command === "CONNECTED") {
        console.log("StompClient CONNECTED successfully");
        this.connected = true;
        if (this.onConnect) this.onConnect();
        
        for (let subId in this.subscriptions) {
          this.socket.send(`SUBSCRIBE\nid:${subId}\ndestination:${this.subscriptions[subId].destination}\n\n\u0000`);
        }
      } else if (command === "MESSAGE") {
        const bodyStart = data.indexOf("\n\n") + 2;
        const body = data.substring(bodyStart, data.lastIndexOf("\u0000")).trim();

        const headersSection = data.substring(commandEnd + 1, bodyStart - 2);
        const headers = {};
        headersSection.split("\n").forEach((line) => {
          const parts = line.split(":");
          if (parts.length >= 2) {
            headers[parts[0].trim()] = parts.slice(1).join(":").trim();
          }
        });

        const subId = headers["subscription"];
        if (this.subscriptions[subId] && this.subscriptions[subId].callback) {
          try {
            this.subscriptions[subId].callback(JSON.parse(body));
          } catch (e) {
            this.subscriptions[subId].callback(body);
          }
        }
      }
    };

    this.socket.onerror = (err) => {
      console.error("StompClient socket error:", err);
      if (this.onError) this.onError(err);
    };

    this.socket.onclose = () => {
      console.log("StompClient disconnected");
      this.connected = false;
      if (this.onDisconnect) this.onDisconnect();
    };
  }

  subscribe(destination, callback) {
    const subId = "sub-" + Math.random().toString(36).substring(2, 9);
    this.subscriptions[subId] = { destination, callback };
    if (this.connected) {
      this.socket.send(`SUBSCRIBE\nid:${subId}\ndestination:${destination}\n\n\u0000`);
    }
    return {
      unsubscribe: () => {
        delete this.subscriptions[subId];
        if (this.connected) {
          this.socket.send(`UNSUBSCRIBE\nid:${subId}\n\n\u0000`);
        }
      },
    };
  }

  send(destination, body) {
    if (this.connected) {
      this.socket.send(
        `SEND\ndestination:${destination}\ncontent-type:application/json\n\n${JSON.stringify(body)}\u0000`
      );
    } else {
      console.warn("StompClient cannot send. Not connected.");
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
    }
  }
}

console.log("WatchParty content script loaded!");

const hostname = window.location.hostname;

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

// ── WebSocket & STOMP Sync State ─────────────────────────
let stompClient = null;
let currentRoom = null;
let currentRoomHost = null;
let token = null;
let username = null;
let isHost = false;
let isApplyingIncomingEvent = false;

// ── Respond to on-demand queries from popup / background ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_VIDEO_INFO") {
    const video = document.querySelector("video");
    
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
    const video = document.querySelector("video");
    if (video && typeof message.currentTime === "number") {
      video.currentTime = message.currentTime;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PLAY_VIDEO") {
    const video = document.querySelector("video");
    if (video) video.play();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PAUSE_VIDEO") {
    const video = document.querySelector("video");
    if (video) video.pause();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "SEND_CHAT_MESSAGE") {
    if (stompClient && stompClient.connected) {
      stompClient.send("/app/chat", {
        roomCode: currentRoom,
        username: username,
        message: message.messageText
      });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "WebSocket not connected" });
    }
    return true;
  }

  if (message.type === "SEND_TYPING_STATUS") {
    if (stompClient && stompClient.connected) {
      stompClient.send("/app/typing", {
        roomCode: currentRoom,
        username: username,
        typing: message.typing
      });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
    return true;
  }
});

// ── Helper functions for Programmatic Control (echo loop prevention) ──
function playVideoProgrammatically(video) {
  if (video && video.paused) {
    console.log("Applying remote PLAY event");
    isApplyingIncomingEvent = true;
    video.play()
      .then(() => {
        setTimeout(() => { isApplyingIncomingEvent = false; }, 200);
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
    setTimeout(() => { isApplyingIncomingEvent = false; }, 200);
  }
}

function seekVideoProgrammatically(video, time) {
  if (video && Math.abs(video.currentTime - time) > 1.5) {
    console.log(`Applying remote SEEK event to ${time.toFixed(2)}s`);
    isApplyingIncomingEvent = true;
    video.currentTime = time;
    setTimeout(() => { isApplyingIncomingEvent = false; }, 200);
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

// ── WebSocket/STOMP Connections ──────────────────────────
function sendPlaybackEvent(eventType, currentTime) {
  if (!stompClient || !stompClient.connected) return;

  const video = document.querySelector("video");
  const speed = video ? video.playbackRate : 1.0;

  stompClient.send("/app/playback", {
    roomCode: currentRoom,
    username: username,
    eventType: eventType,
    currentTime: currentTime,
    playbackSpeed: speed
  });
}

function handleIncomingPlaybackEvent(event) {
  if (event.username === username) return; // ignore our own events

  const video = document.querySelector("video");
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
        setTimeout(() => { isApplyingIncomingEvent = false; }, 200);
      }
      break;
  }
}

function handleIncomingSyncState(state) {
  const video = document.querySelector("video");
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
    setTimeout(() => { isApplyingIncomingEvent = false; }, 200);
  }
}

function connectWebSocket() {
  if (stompClient && stompClient.connected) return;

  console.log(`Connecting to WatchParty WS for room: ${currentRoom}`);
  
  stompClient = new StompClient("ws://localhost:8080/ws", {
    "Authorization": "Bearer " + token,
    "roomCode": currentRoom
  });

  stompClient.onConnect = () => {
    console.log("WS connected successfully!");

    stompClient.subscribe(`/topic/room/${currentRoom}`, (event) => {
      handleIncomingPlaybackEvent(event);
    });

    stompClient.subscribe(`/topic/room/${currentRoom}/sync`, (state) => {
      handleIncomingSyncState(state);
    });

    stompClient.subscribe(`/topic/room/${currentRoom}/chat`, (chatMsg) => {
      console.log("WS chat message received:", chatMsg);
      chrome.runtime.sendMessage({
        type: "RECEIVE_CHAT_MESSAGE",
        message: chatMsg
      });
    });

    stompClient.subscribe(`/topic/room/${currentRoom}/typing`, (typingIndicator) => {
      chrome.runtime.sendMessage({
        type: "RECEIVE_TYPING_STATUS",
        indicator: typingIndicator
      });
    });

    if (!isHost) {
      console.log("Sending SYNC_REQUEST as viewer");
      stompClient.send("/app/playback", {
        roomCode: currentRoom,
        username: username,
        eventType: "SYNC_REQUEST"
      });
    }
  };

  stompClient.onError = (err) => {
    console.error("WS error:", err);
  };

  stompClient.onDisconnect = () => {
    console.log("WS disconnected. Will attempt retry in 5s...");
    setTimeout(() => {
      if (currentRoom && token) {
        connectWebSocket();
      }
    }, 5000);
  };

  stompClient.connect();
}

function disconnectWebSocket() {
  if (stompClient) {
    console.log("Disconnecting WatchParty WS client");
    stompClient.disconnect();
    stompClient = null;
  }
}

async function initSync() {
  const data = await chrome.storage.local.get([
    "currentRoom",
    "currentRoomHost",
    "jwt",
    "username"
  ]);

  const oldRoom = currentRoom;

  currentRoom = data.currentRoom;
  currentRoomHost = data.currentRoomHost;
  token = data.jwt;
  username = data.username;
  isHost = (currentRoomHost && username && currentRoomHost.toLowerCase() === username.toLowerCase());

  console.log("WatchParty initSync configuration:", { currentRoom, isHost, username });

  if (oldRoom && oldRoom !== currentRoom) {
    disconnectWebSocket();
  }

  const video = document.querySelector("video");
  if (currentRoom && token && video) {
    connectWebSocket();
  } else {
    disconnectWebSocket();
  }
}

// Watch storage shifts (joining/leaving rooms, login changes)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.currentRoom || changes.currentRoomHost || changes.jwt || changes.username) {
    initSync();
  }
});

// ── Startup Wait for Video ──
const waitForVideo = setInterval(() => {
  const video = document.querySelector("video");

  if (video) {
    clearInterval(waitForVideo);
    console.log("Video element detected");
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: "VIDEO_DETECTED",
      platform,
      videoId,
    });

    setupVideoEventListeners(video);
    initSync();
  }
}, 1000);
