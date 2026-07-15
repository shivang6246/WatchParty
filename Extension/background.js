console.log("WatchParty background service worker started.");

let currentRoom = null;
let currentVideo = null;
let unreadCount = 0;

chrome.runtime.onInstalled.addListener(() => {
  console.log("WatchParty installed successfully.");
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

    case "PLAY_EVENT":
      console.log("Play event received", message);
      break;

    case "PAUSE_EVENT":
      console.log("Pause event received", message);
      break;

    case "SEEK_EVENT":
      console.log("Seek event received", message);
      break;

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

    case "RECEIVE_CHAT_MESSAGE": {
      unreadCount++;
      chrome.action.setBadgeText({ text: unreadCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: "#e94560" });
      break;
    }

    case "CLEAR_UNREAD_BADGE": {
      unreadCount = 0;
      chrome.action.setBadgeText({ text: "" });
      break;
    }
  }

  return true;
});
