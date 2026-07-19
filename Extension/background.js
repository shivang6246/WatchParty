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

chrome.runtime.onInstalled.addListener(() => {
  console.log("WatchParty installed successfully.");
});

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
  if (stompClient && stompClient.connected) return;

  console.log(`Connecting to WatchParty WS for room: ${currentRoom}`);
  chrome.storage.local.set({ wsStatus: "connecting", wsError: null });

  stompClient = new StompClient("ws://54.206.106.162:8081/ws", {
    Authorization: "Bearer " + token,
    roomCode: currentRoom,
  });

  stompClient.onConnect = () => {
    console.log("WS connected successfully inside background service worker!");
    chrome.storage.local.set({ wsStatus: "connected", wsError: null });
    startKeepAlive();

    stompClient.subscribe(`/topic/room/${currentRoom}`, (event) => {
      console.log("Incoming playback event:", event);

      if (event.eventType === "VIDEO_CHANGED") {
        if (event.username !== username) {
          console.log("Host changed the video to:", event.videoUrl);
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0) {
              const activeTab = tabs[0];
              const url = activeTab.url || "";
              if (url.includes("youtube.com") || url.includes("netflix.com")) {
                chrome.tabs.update(activeTab.id, { url: event.videoUrl });
              } else {
                chrome.tabs.query({}, (allTabs) => {
                  const watchTab = allTabs.find(t => t.url && (t.url.includes("youtube.com") || t.url.includes("netflix.com")));
                  if (watchTab) {
                    chrome.tabs.update(watchTab.id, { url: event.videoUrl, active: true });
                  } else {
                    chrome.tabs.create({ url: event.videoUrl });
                  }
                });
              }
            } else {
              chrome.tabs.create({ url: event.videoUrl });
            }
          });
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

    stompClient.subscribe(`/topic/room/${currentRoom}/sync`, (state) => {
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

    stompClient.subscribe(`/topic/room/${currentRoom}/chat`, (chatMsg) => {
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

    stompClient.subscribe(`/topic/room/${currentRoom}/typing`, (typingIndicator) => {
      chrome.runtime.sendMessage({
        type: "RECEIVE_TYPING_STATUS",
        indicator: typingIndicator,
      }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    });

    if (!isHost) {
      console.log("Sending SYNC_REQUEST as viewer on connect");
      stompClient.send("/app/playback", {
        roomCode: currentRoom,
        username: username,
        eventType: "SYNC_REQUEST",
      });
    }
  };

  stompClient.onError = (err) => {
    console.error("WS error:", err);
    chrome.storage.local.set({ 
      wsStatus: "error", 
      wsError: "WebSocket connection error. Please make sure the backend is running." 
    });
    stopKeepAlive();
  };

  stompClient.onDisconnect = () => {
    console.log("WS disconnected. Will attempt retry in 5s...");
    chrome.storage.local.set({ wsStatus: "disconnected", wsError: "WebSocket disconnected from server." });
    stopKeepAlive();
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
    chrome.storage.local.set({ wsStatus: "disconnected", wsError: null });
  }
  stopKeepAlive();
}

async function checkConnection() {
  const data = await chrome.storage.local.get([
    "currentRoom",
    "currentRoomHost",
    "jwt",
    "username",
  ]);

  const oldRoom = currentRoom;

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

  if (oldRoom && oldRoom !== currentRoom) {
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

    case "HOST_VIDEO_CHANGED":
      if (stompClient && stompClient.connected && isHost) {
        console.log("Relaying host video change to backend:", message.videoUrl);
        stompClient.send("/app/playback", {
          roomCode: currentRoom,
          username: username,
          eventType: "VIDEO_CHANGED",
          videoUrl: message.videoUrl,
          platform: message.platform,
        });
      }
      break;

    case "SEND_PLAYBACK_EVENT":
      if (stompClient && stompClient.connected) {
        console.log("Relaying playback event to backend:", message);
        stompClient.send("/app/playback", {
          roomCode: currentRoom,
          username: username,
          eventType: message.eventType,
          currentTime: message.currentTime,
          playbackSpeed: message.playbackSpeed || 1.0,
        });
      }
      break;

    case "REQUEST_SYNC":
      if (stompClient && stompClient.connected && !isHost) {
        console.log("Relaying sync request to backend");
        stompClient.send("/app/playback", {
          roomCode: currentRoom,
          username: username,
          eventType: "SYNC_REQUEST",
        });
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

    // ── Navigate active tab to a video URL ──
    case "NAVIGATE_TO_VIDEO": {
      if (message.videoUrl) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { url: message.videoUrl });
            sendResponse({ ok: true });
          } else {
            chrome.tabs.create({ url: message.videoUrl });
            sendResponse({ ok: true });
          }
        });
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

// Run connection check on load
checkConnection();
