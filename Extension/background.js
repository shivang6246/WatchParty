importScripts("stomp.js");

console.log("WatchParty background service worker started.");

let currentRoom = null;
let currentRoomHost = null;
let token = null;
let username = null;
let isHost = false;
let currentVideo = null;
let unreadCount = 0;

let stompClient = null;
let keepAliveInterval = null;
let reconnectTimer = null;
let pendingPlaybackEvents = [];

const RECONNECT_DELAY_MS = 5000;
// Older queued events would move viewers to a stale position, so they are dropped
const PENDING_EVENT_TTL_MS = 5000;

chrome.runtime.onInstalled.addListener(() => {
  console.log("WatchParty installed successfully.");

  // Tabs opened before an install/reload keep orphaned content scripts that can't reach the
  // extension, so those tabs silently stop syncing until refreshed; inject a live copy instead
  chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://*.netflix.com/*"] }, (tabs) => {
    (tabs || []).forEach((tab) => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`Could not inject into tab ${tab.id}:`, chrome.runtime.lastError.message);
        }
      });
    });
  });
});

// Reuses a YouTube/Netflix tab instead of overwriting whatever tab the user happens to be on
function openVideoInWatchTab(videoUrl, done) {
  chrome.tabs.query({}, (tabs) => {
    const isWatchSite = (t) => t.url && (t.url.includes("youtube.com") || t.url.includes("netflix.com"));
    const watchTab = tabs.find((t) => t.active && isWatchSite(t)) || tabs.find(isWatchSite);

    if (!watchTab) {
      chrome.tabs.create({ url: videoUrl }, () => done && done());
    } else if (watchTab.url === videoUrl) {
      chrome.tabs.update(watchTab.id, { active: true }, () => done && done());
    } else {
      chrome.tabs.update(watchTab.id, { url: videoUrl, active: true }, () => done && done());
    }
  });
}

function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    if (stompClient && stompClient.connected && stompClient.socket) {
      console.log("Sending WS keepalive heartbeat");
      stompClient.socket.send("\n");
    }
  }, 20000); // Send keepalive every 20 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function connectWebSocket() {
  // A client that is still connecting counts too, otherwise a second socket leaks
  if (stompClient) return;

  const room = currentRoom;
  console.log(`Connecting to WatchParty WS for room: ${room}`);
  chrome.storage.local.set({ wsStatus: "connecting", wsError: null });

  const client = new StompClient("ws://15.252.237.89:8081/ws", {
    Authorization: "Bearer " + token,
    roomCode: room,
  });
  client.room = room;
  client.token = token;
  stompClient = client;

  client.onConnect = () => {
    if (client !== stompClient) return;
    console.log("WS connected successfully inside background service worker!");
    chrome.storage.local.set({ wsStatus: "connected", wsError: null });
    startKeepAlive();

    client.subscribe(`/topic/room/${room}`, (event) => {
      console.log("Incoming playback event:", event);

      if (event.eventType === "VIDEO_CHANGED") {
        if (event.username !== username) {
          console.log("Host changed the video to:", event.videoUrl);
          openVideoInWatchTab(event.videoUrl);
        }
        // Notify popup to refresh UI
        chrome.runtime.sendMessage({
          type: "ROOM_VIDEO_CHANGED",
          videoUrl: event.videoUrl,
          platform: event.platform
        }, () => { if (chrome.runtime.lastError) {} });
        return;
      }

      // Forward to all matching tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            type: "APPLY_PLAYBACK_EVENT",
            event: event
          }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        });
      });
    });

    // Sync replies are addressed to this user only, not the whole room
    client.subscribe("/user/queue/sync", (state) => {
      console.log("Incoming sync state:", state);
      // Forward to all matching tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, {
            type: "APPLY_SYNC_STATE",
            state: state
          }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        });
      });
    });

    client.subscribe(`/topic/room/${room}/chat`, (chatMsg) => {
      console.log("WS chat message received:", chatMsg);
      
      // Increment unread count & show badge
      unreadCount++;
      chrome.action.setBadgeText({ text: unreadCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: "#e94560" });

      // Notify popup & content scripts
      chrome.runtime.sendMessage({
        type: "RECEIVE_CHAT_MESSAGE",
        message: chatMsg,
      }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    });

    client.subscribe(`/topic/room/${room}/typing`, (typingIndicator) => {
      chrome.runtime.sendMessage({
        type: "RECEIVE_TYPING_STATUS",
        indicator: typingIndicator,
      }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    });

    // Sent unconditionally: isHost may still be stale here, and content.js ignores the reply for the host
    console.log("Sending SYNC_REQUEST on connect");
    client.send("/app/playback", {
      roomCode: room,
      username: username,
      eventType: "SYNC_REQUEST",
    });

    flushPendingPlaybackEvents(client);
  };

  client.onError = (err) => {
    if (client !== stompClient) return;
    console.error("WS error:", err);
    chrome.storage.local.set({
      wsStatus: "error",
      wsError: "WebSocket connection error. Please make sure the backend is running."
    });
    stopKeepAlive();
  };

  client.onDisconnect = () => {
    // Ignore sockets that were intentionally closed or replaced
    if (client !== stompClient) return;
    console.log(`WS disconnected. Will attempt retry in ${RECONNECT_DELAY_MS / 1000}s...`);
    stompClient = null;
    chrome.storage.local.set({ wsStatus: "disconnected", wsError: "WebSocket disconnected from server." });
    stopKeepAlive();
    scheduleReconnect();
  };

  client.connect();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentRoom && token) {
      connectWebSocket();
    }
  }, RECONNECT_DELAY_MS);
}

function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopKeepAlive();

  const client = stompClient;
  if (!client) return;
  console.log("Disconnecting WatchParty WS client");
  stompClient = null;
  client.disconnect();
  chrome.storage.local.set({ wsStatus: "disconnected", wsError: null });
}

function freshPendingEvents() {
  const cutoff = Date.now() - PENDING_EVENT_TTL_MS;
  return pendingPlaybackEvents.filter((e) => e.queuedAt >= cutoff);
}

// roomCode/username are filled in at send time: right after the worker wakes up they aren't loaded yet
function sendPlaybackEvent(fields) {
  if (stompClient && stompClient.connected) {
    stompClient.send("/app/playback", { roomCode: currentRoom, username: username, ...fields });
    return;
  }

  // Heartbeats are periodic, so a queued one would only be stale
  if (fields.eventType !== "HEARTBEAT") {
    pendingPlaybackEvents = freshPendingEvents();
    pendingPlaybackEvents.push({ fields, queuedAt: Date.now() });
  }
  checkConnection();
}

function flushPendingPlaybackEvents(client) {
  const events = freshPendingEvents();
  pendingPlaybackEvents = [];
  events.forEach((e) => {
    console.log("Sending queued playback event:", e.fields.eventType);
    client.send("/app/playback", { roomCode: client.room, username: username, ...e.fields });
  });
}

async function checkConnection() {
  const data = await chrome.storage.local.get([
    "currentRoom",
    "currentRoomHost",
    "jwt",
    "username",
  ]);

  currentRoom = data.currentRoom;
  currentRoomHost = data.currentRoomHost;
  token = data.jwt;
  username = data.username;
  isHost =
    currentRoomHost &&
    username &&
    currentRoomHost.toLowerCase() === username.toLowerCase();

  console.log("WatchParty background checkConnection:", {
    currentRoom,
    isHost,
    username,
  });

  // Compare against the client itself: message handlers may have already mutated currentRoom
  if (stompClient && (stompClient.room !== currentRoom || stompClient.token !== token)) {
    disconnectWebSocket();
  }

  if (currentRoom && token) {
    connectWebSocket();
  } else {
    disconnectWebSocket();
  }
}

// Watch storage changes to connect/disconnect WS
chrome.storage.onChanged.addListener((changes) => {
  if (
    changes.currentRoom ||
    changes.currentRoomHost ||
    changes.jwt ||
    changes.username
  ) {
    checkConnection();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get([
    "currentRoom",
    "currentVideo",
  ]);

  if (stored.currentRoom) {
    currentRoom = stored.currentRoom;
    console.log("Restored room:", currentRoom);
  }

  if (stored.currentVideo) {
    currentVideo = stored.currentVideo;
    console.log("Restored video:", currentVideo);
  }

  checkConnection();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "ROOM_JOINED":
      currentRoom = message.roomCode;
      chrome.storage.local.set({
        currentRoom: currentRoom,
      });
      console.log("Joined room:", currentRoom);
      break;

    case "ROOM_LEFT":
      currentRoom = null;
      chrome.storage.local.remove("currentRoom");
      console.log("Left room");
      break;

    case "VIDEO_DETECTED":
      currentVideo = {
        platform: message.platform,
        videoId: message.videoId,
      };
      chrome.storage.local.set({
        currentVideo,
      });
      console.log("Detected video:", message.platform, message.videoId);
      break;

    // The backend enforces host-only control; gating on isHost here dropped events right after a worker restart
    case "HOST_VIDEO_CHANGED":
      console.log("Relaying host video change to backend:", message.videoUrl);
      sendPlaybackEvent({
        eventType: "VIDEO_CHANGED",
        videoUrl: message.videoUrl,
        platform: message.platform,
      });
      break;

    case "SEND_PLAYBACK_EVENT":
      console.log("Relaying playback event to backend:", message);
      sendPlaybackEvent({
        eventType: message.eventType,
        currentTime: message.currentTime,
        playbackSpeed: message.playbackSpeed || 1.0,
        playing: message.playing,
      });
      break;

    case "REQUEST_SYNC":
      if (stompClient && stompClient.connected) {
        console.log("Relaying sync request to backend");
        stompClient.send("/app/playback", {
          roomCode: currentRoom,
          username: username,
          eventType: "SYNC_REQUEST",
        });
      } else {
        // A SYNC_REQUEST is sent automatically once connected
        checkConnection();
      }
      break;

    case "SEND_CHAT_MESSAGE":
      if (stompClient && stompClient.connected) {
        stompClient.send("/app/chat", {
          roomCode: message.roomCode || currentRoom,
          username: message.username || username,
          message: message.messageText,
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "WebSocket not connected" });
      }
      return true; // keep channel open for async response

    case "SEND_TYPING_STATUS":
      if (stompClient && stompClient.connected) {
        stompClient.send("/app/typing", {
          roomCode: message.roomCode || currentRoom,
          username: message.username || username,
          typing: message.typing,
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return true; // keep channel open for async response

    // ── Popup asks for video info from the active tab ──
    case "GET_ACTIVE_TAB_VIDEO": {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          sendResponse({ hasVideo: false, debug: "No active tabs found" });
          return;
        }
        const tab = tabs[0];
        const url = tab.url || "";
        
        // Only query YouTube / Netflix tabs
        if (
          url.includes("youtube.com/watch") ||
          url.includes("netflix.com/watch")
        ) {
          // First query: see if content script is active
          chrome.tabs.sendMessage(
            tab.id,
            { type: "GET_VIDEO_INFO" },
            (response) => {
              if (chrome.runtime.lastError || !response) {
                console.log("Content script missing. Programmatically injecting content.js...");
                // Programmatically inject content.js using scripting API
                chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  files: ["content.js"]
                }, () => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ 
                      hasVideo: false, 
                      debug: "Failed to inject content script: " + chrome.runtime.lastError.message,
                      url 
                    });
                  } else {
                    // Retry sending the message after a brief pause for script initialization
                    setTimeout(() => {
                      chrome.tabs.sendMessage(
                        tab.id,
                        { type: "GET_VIDEO_INFO" },
                        (retryResponse) => {
                          if (chrome.runtime.lastError || !retryResponse) {
                            sendResponse({ 
                              hasVideo: false, 
                              debug: "Content script did not respond after injection: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "No response"),
                              url 
                            });
                          } else {
                            sendResponse({ ...retryResponse, url });
                          }
                        }
                      );
                    }, 500);
                  }
                });
              } else {
                sendResponse({ ...response, url });
              }
            },
          );
        } else {
          sendResponse({ 
            hasVideo: false, 
            debug: "URL does not match youtube.com/watch or netflix.com/watch",
            url 
          });
        }
      });
      return true; // keep channel open for async response
    }

    case "NAVIGATE_TO_VIDEO": {
      if (message.videoUrl) {
        openVideoInWatchTab(message.videoUrl, () => sendResponse({ ok: true }));
      }
      return true; // keep channel open for async response
    }

    case "CLEAR_UNREAD_BADGE": {
      unreadCount = 0;
      chrome.action.setBadgeText({ text: "" });
      break;
    }
  }

  return true;
});

// Chrome stops idle MV3 workers, which ends the retry loop; the alarm wakes it to reconnect
chrome.alarms.create("wp-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "wp-reconnect") {
    checkConnection();
  }
});

// Run connection check on load
checkConnection();
