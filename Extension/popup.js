/* ═══════════════════════════════════════════════════════════
   WatchParty — Popup Controller
   Manages all UI views, form submissions, and state
   ═══════════════════════════════════════════════════════════ */

// ── DOM References ───────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentUserEmail = "";

// Views
const loginView = $("#login-view");
const registerView = $("#register-view");
const dashboardView = $("#dashboard-view");
const createRoomView = $("#create-room-view");
const joinRoomView = $("#join-room-view");
const roomView = $("#room-view");

// Toast
const toastEl = $("#toast");
const toastMsg = $("#toast-message");

// ── Detected video state (from active tab) ───────────────
let detectedVideo = null; // { platform, videoId, videoUrl, title }

// ── View Navigation ──────────────────────────────────────

function showView(view) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  view.classList.add("active");
  // Re-trigger animation
  view.style.animation = "none";
  // Force reflow
  void view.offsetHeight;
  view.style.animation = "";
}

// ── Toast ────────────────────────────────────────────────

let toastTimer = null;

function toast(message, type = "info") {
  if (toastTimer) clearTimeout(toastTimer);

  toastEl.className = "toast " + type;
  toastMsg.textContent = message;

  const icon = toastEl.querySelector(".toast-icon");
  const icons = { success: "check_circle", error: "error", info: "info" };
  icon.textContent = icons[type] || "info";

  // Show
  requestAnimationFrame(() => {
    toastEl.classList.add("show");
  });

  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
}

// ── Button Loading State ─────────────────────────────────

function setLoading(btn, loading) {
  const text = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  if (!text || !loader) return;

  if (loading) {
    text.classList.add("hidden");
    loader.classList.remove("hidden");
    btn.disabled = true;
    btn.style.pointerEvents = "none";
  } else {
    text.classList.remove("hidden");
    loader.classList.add("hidden");
    btn.disabled = false;
    btn.style.pointerEvents = "";
  }
}

// ── Populate User Info ───────────────────────────────────

async function populateUserInfo() {
  const user = await getStoredUser();
  if (user.username) {
    $("#user-avatar").textContent = user.username.charAt(0).toUpperCase();
    $("#user-display-name").textContent = user.username;
    $("#user-display-email").textContent = user.email || "";
    currentUserEmail = user.username;
  }
}

// ── Detect Video on Active Tab ───────────────────────────

async function detectActiveTabVideo() {
  detectedVideo = null;

  // Only works inside the Chrome extension context
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }

  // Use a timeout so this never blocks login/init forever
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("detectActiveTabVideo timed out");
      resolve();
    }, 2000);

    try {
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_VIDEO" }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn("detectActiveTabVideo lastError:", chrome.runtime.lastError.message);
          toast("Extension Error: " + chrome.runtime.lastError.message, "error");
          resolve();
          return;
        }
        if (!response) {
          toast("No response from background script", "error");
          resolve();
          return;
        }
        if (!response.hasVideo) {
          const debugMsg = response.debug || "No video playing";
          const urlSnippet = response.url ? ` (URL: ${response.url.substring(0, 30)}...)` : "";
          toast(`${debugMsg}${urlSnippet}`, "info");
          resolve();
          return;
        }
        detectedVideo = {
          platform: response.platform,
          videoId: response.videoId,
          videoUrl: response.videoUrl,
          title: cleanVideoTitle(response.title),
        };
        resolve();
      });
    } catch (e) {
      clearTimeout(timeout);
      toast("Error checking video: " + e.message, "error");
      console.warn("detectActiveTabVideo error:", e);
      resolve();
    }
  });
}

/**
 * Clean up YouTube page title (e.g. remove " - YouTube" suffix)
 */
function cleanVideoTitle(title) {
  if (!title) return "Unknown Video";
  return title.replace(/\s*[-–—]\s*YouTube\s*$/i, "").trim() || title;
}

function getVideoIdFromUrl(url, platform) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (platform === "YOUTUBE" || parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    }
    if (platform === "NETFLIX" || parsed.hostname.includes("netflix.com")) {
      return parsed.pathname.split("/watch/")[1];
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Update video indicator UI on dashboard and create-room views
 */
function updateVideoUI() {
  const dashCard = $("#detected-video-card");
  const createBanner = $("#create-room-video-banner");

  if (detectedVideo) {
    // Dashboard indicator
    dashCard.classList.remove("hidden");
    $("#detected-video-title").textContent = detectedVideo.title;
    $("#detected-video-platform").textContent = detectedVideo.platform || "Video";

    // Create room banner
    createBanner.classList.remove("hidden");
    $("#create-room-video-title").textContent = detectedVideo.title;
  } else {
    dashCard.classList.add("hidden");
    createBanner.classList.add("hidden");
  }
}

// ── Check Existing Session on Popup Open ─────────────────

async function initSession() {
  const token = await getToken();
  if (!token) {
    showView(loginView);
    return;
  }

  // 1. Render UI instantly using cached storage details
  await populateUserInfo();

  // 2. Open Room View or Dashboard instantly
  const stored = await storage.get("currentRoom");
  if (stored.currentRoom) {
    loadRoomView(stored.currentRoom);
  } else {
    showView(dashboardView);
  }

  // 3. Detect video on the active tab asynchronously (non-blocking)
  detectActiveTabVideo().then(() => {
    updateVideoUI();
  });

  // 4. Validate session in the background
  apiGetCurrentUser()
    .then(async (user) => {
      await storage.set({
        username: user.username,
        email: user.email,
        role: user.role,
      });
      await populateUserInfo();
    })
    .catch(async (err) => {
      console.warn("Session background validation failed:", err.message);
      if (err.status === 401 || err.status === 403) {
        console.log("Token expired. Kicking to login.");
        await clearSession();
        showView(loginView);
      }
    });
}

// ═══════════════════════════════════════════════════════════
//  AUTH — LOGIN
// ═══════════════════════════════════════════════════════════

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn");
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;

  if (!email || !password) {
    toast("Please fill in all fields", "error");
    return;
  }

  setLoading(btn, true);
  try {
    await apiLogin(email, password);
    toast("Welcome back! 🎉", "success");
    await populateUserInfo();

    // Detect video after login
    await detectActiveTabVideo();
    updateVideoUI();

    showView(dashboardView);
  } catch (err) {
    toast(err.message || "Login failed", "error");
  } finally {
    setLoading(btn, false);
  }
});

// ═══════════════════════════════════════════════════════════
//  AUTH — REGISTER
// ═══════════════════════════════════════════════════════════

$("#register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#register-btn");
  const username = $("#register-username").value.trim();
  const email = $("#register-email").value.trim();
  const password = $("#register-password").value;

  if (!username || !email || !password) {
    toast("Please fill in all fields", "error");
    return;
  }

  setLoading(btn, true);
  try {
    await apiRegister(username, email, password);
    toast("Account created! Please sign in.", "success");
    showView(loginView);
    // Pre-fill email for convenience
    $("#login-email").value = email;
  } catch (err) {
    toast(err.message || "Registration failed", "error");
  } finally {
    setLoading(btn, false);
  }
});

// ═══════════════════════════════════════════════════════════
//  VIEW TOGGLES
// ═══════════════════════════════════════════════════════════

$("#goto-register").addEventListener("click", () => showView(registerView));
$("#goto-login").addEventListener("click", () => showView(loginView));

// Dashboard → Create / Join
$("#create-room-card").addEventListener("click", () => {
  updateVideoUI(); // refresh in case tab changed
  showView(createRoomView);
});
$("#join-room-card").addEventListener("click", () => showView(joinRoomView));

// Back buttons
$("#back-to-dashboard-from-create").addEventListener("click", () =>
  showView(dashboardView),
);
$("#back-to-dashboard-from-join").addEventListener("click", () =>
  showView(dashboardView),
);

// ═══════════════════════════════════════════════════════════
//  LOGOUT
// ═══════════════════════════════════════════════════════════

$("#logout-btn").addEventListener("click", async () => {
  await clearSession();
  detectedVideo = null;
  toast("Logged out", "info");
  showView(loginView);
});

// ═══════════════════════════════════════════════════════════
//  CREATE ROOM (with video auto-association)
// ═══════════════════════════════════════════════════════════

$("#create-room-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#create-room-btn");
  const roomName = $("#room-name-input").value.trim();
  const locked = $("#room-locked-toggle").checked;

  if (!roomName) {
    toast("Enter a room name", "error");
    return;
  }

  setLoading(btn, true);
  try {
    // Pass detected video URL and platform if available
    const videoUrl = detectedVideo ? detectedVideo.videoUrl : null;
    const platform = detectedVideo ? detectedVideo.platform : null;

    const room = await apiCreateRoom(roomName, locked, videoUrl, platform);
    toast(`Room "${room.roomName}" created!`, "success");
    await loadRoomView(room.roomCode);
  } catch (err) {
    toast(err.message || "Failed to create room", "error");
  } finally {
    setLoading(btn, false);
  }
});

// ═══════════════════════════════════════════════════════════
//  JOIN ROOM
// ═══════════════════════════════════════════════════════════

$("#join-room-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#join-room-btn");
  const roomCode = $("#room-code-input").value.trim().toUpperCase();

  if (!roomCode || roomCode.length !== 6) {
    toast("Enter a valid 6-character room code", "error");
    return;
  }

  setLoading(btn, true);
  try {
    const room = await apiJoinRoom(roomCode);
    toast(`Joined "${room.roomName}"!`, "success");
    await loadRoomView(room.roomCode);
  } catch (err) {
    toast(err.message || "Failed to join room", "error");
  } finally {
    setLoading(btn, false);
  }
});

// ═══════════════════════════════════════════════════════════
//  ROOM VIEW
// ═══════════════════════════════════════════════════════════

async function loadRoomView(roomCode) {
  try {
    const room = await apiGetRoomDetails(roomCode);
    const members = await apiGetRoomMembers(roomCode);

    // Populate header
    $("#active-room-name").textContent = room.roomName;
    $("#active-room-code").textContent = room.roomCode;
    $("#active-room-host").textContent = room.host;

    // Lock status
    const lockIcon = $("#room-lock-icon");
    const lockText = $("#room-lock-text");
    if (room.locked) {
      lockIcon.textContent = "lock";
      lockText.textContent = "Private";
    } else {
      lockIcon.textContent = "lock_open";
      lockText.textContent = "Open";
    }

    // ── Now Playing video ──
    const videoSection = $("#room-video-section");
    
    // Save currentRoomHost so content script knows if we are host or viewer
    await storage.set({ currentRoomHost: room.host });

    if (room.videoUrl) {
      videoSection.classList.remove("hidden");
      $("#room-video-title").textContent = cleanVideoTitle(room.videoUrl);
      $("#room-video-platform").textContent = room.platform || "Video";

      // Try to extract a nicer title from the URL
      if (room.platform === "YOUTUBE" && room.videoUrl.includes("youtube.com")) {
        // For YouTube, we'll show a friendlier label
        try {
          const url = new URL(room.videoUrl);
          const vid = url.searchParams.get("v");
          $("#room-video-title").textContent = vid
            ? `YouTube Video (${vid})`
            : room.videoUrl;
        } catch {
          // Keep the URL as-is
        }
      }

      // Auto-redirect viewer if not on the video URL
      const user = await getStoredUser();
      const isHost = (user.username === room.host);
      if (!isHost) {
        await detectActiveTabVideo(); // populates detectedVideo
        
        let needsRedirect = false;
        if (!detectedVideo || !detectedVideo.videoUrl) {
          needsRedirect = true;
        } else {
          const currentVid = getVideoIdFromUrl(detectedVideo.videoUrl, detectedVideo.platform);
          const targetVid = getVideoIdFromUrl(room.videoUrl, room.platform);
          if (currentVid !== targetVid) {
            needsRedirect = true;
          }
        }

        if (needsRedirect) {
          toast("Redirecting to host's video...", "info");
          chrome.runtime.sendMessage({
            type: "NAVIGATE_TO_VIDEO",
            videoUrl: room.videoUrl
          });
        }
      }
    } else {
      videoSection.classList.add("hidden");
    }

    // Members list
    const membersList = $("#members-list");
    membersList.innerHTML = "";
    members.forEach((m) => {
      const li = document.createElement("li");
      li.className = "member-item";
      li.innerHTML = `
        <div class="member-avatar">${m.username.charAt(0)}</div>
        <span class="member-name">${m.username}</span>
        <span class="member-role ${m.roomRole === "HOST" ? "host" : "member"}">${m.roomRole}</span>
        <span class="member-online-dot ${m.online ? "online" : "offline"}"></span>
      `;
      membersList.appendChild(li);
    });

    // Reset tab panels
    $("#tab-members-btn").classList.add("active");
    $("#tab-chat-btn").classList.remove("active");
    $("#members-panel").classList.remove("hidden");
    $("#chat-panel").classList.add("hidden");
    $("#chat-tab-dot").classList.add("hidden");

    // Clear unread badge in background
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "CLEAR_UNREAD_BADGE" });
    }

    // Load chat history
    try {
      const history = await apiGetChatHistory(roomCode, 0, 50);
      renderChatHistory(history.messages);
    } catch (e) {
      console.warn("Failed to load chat history:", e);
    }

    // Reset invite box
    $("#invite-link-box").classList.add("hidden");

    showView(roomView);
  } catch (err) {
    toast(err.message || "Failed to load room", "error");
    await storage.remove("currentRoom");
    showView(dashboardView);
  }
}

// Copy room code
$("#copy-code-btn").addEventListener("click", () => {
  const code = $("#active-room-code").textContent;
  navigator.clipboard.writeText(code).then(() => {
    toast("Room code copied!", "success");
  });
});

// Get invite link
$("#get-invite-btn").addEventListener("click", async () => {
  const roomCode = $("#active-room-code").textContent;
  try {
    const invite = await apiGetInviteLink(roomCode);
    const box = $("#invite-link-box");
    box.classList.remove("hidden");
    // Display the invite token (users can share it)
    $("#invite-link-display").value = invite.inviteToken;
  } catch (err) {
    toast(err.message || "Failed to get invite link", "error");
  }
});

// Copy invite link
$("#copy-invite-btn").addEventListener("click", () => {
  const link = $("#invite-link-display").value;
  navigator.clipboard.writeText(link).then(() => {
    toast("Invite token copied!", "success");
  });
});

// Open room video in a new tab
$("#open-video-btn").addEventListener("click", () => {
  const videoSection = $("#room-video-section");
  if (videoSection.classList.contains("hidden")) return;

  // Get the video URL from the room data
  // We'll re-fetch room details to get the URL
  const roomCode = $("#active-room-code").textContent;
  apiGetRoomDetails(roomCode).then((room) => {
    if (room.videoUrl) {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: "NAVIGATE_TO_VIDEO",
          videoUrl: room.videoUrl,
        });
        toast("Opening video...", "info");
      } else {
        window.open(room.videoUrl, "_blank");
      }
    }
  });
});

// Leave room — uses the storage abstraction (fixes issue #2)
$("#leave-room-btn").addEventListener("click", async () => {
  const roomCode = $("#active-room-code").textContent;

  try {
    await apiLeaveRoom(roomCode);

    // Use the storage abstraction consistently
    await storage.remove(["currentRoom", "isHost"]);

    // Notify background script
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "ROOM_LEFT" });
    }

    toast("Left the room", "info");
    showView(dashboardView);
  } catch (err) {
    toast(err.message || "Failed to leave room", "error");
  }
});

// ═══════════════════════════════════════════════════════════
//  CHAT SYSTEM
// ═══════════════════════════════════════════════════════════

// Tab Switching
$("#tab-members-btn").addEventListener("click", () => {
  $("#tab-members-btn").classList.add("active");
  $("#tab-chat-btn").classList.remove("active");
  $("#members-panel").classList.remove("hidden");
  $("#chat-panel").classList.add("hidden");
});

$("#tab-chat-btn").addEventListener("click", () => {
  $("#tab-chat-btn").classList.add("active");
  $("#tab-members-btn").classList.remove("active");
  $("#chat-panel").classList.remove("hidden");
  $("#members-panel").classList.add("hidden");
  $("#chat-tab-dot").classList.add("hidden");

  // Scroll to bottom
  const msgContainer = $("#chat-messages");
  msgContainer.scrollTop = msgContainer.scrollHeight;

  // Clear unread badge in background
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: "CLEAR_UNREAD_BADGE" });
  }
});



// Chat Form submit
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;

  // 1. Create optimistic local message for instant display
  const tempId = "opt-" + Date.now() + "-" + Math.random().toString(36).substring(2, 5);
  const optimisticMsg = {
    id: tempId,
    roomCode: $("#active-room-code").textContent,
    username: currentUserEmail,
    message: text,
    timestamp: new Date().toISOString(),
    isOptimistic: true
  };

  // Render instantly and clear input
  appendChatMessage(optimisticMsg);
  input.value = "";
  sendTypingStatus(false);

  // 2. Send directly to background worker
  chrome.runtime.sendMessage({
    type: "SEND_CHAT_MESSAGE",
    messageText: text,
    username: currentUserEmail,
    roomCode: $("#active-room-code").textContent
  }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn("Error sending chat to background:", chrome.runtime.lastError.message);
    }
    if (!res || !res.ok) {
      // Mark bubble as failed if transmission fails
      const el = $(`[data-msg-id="${tempId}"]`);
      if (el) {
        el.classList.add("failed");
        el.classList.remove("optimistic");
      }
      chrome.storage.local.get(["wsStatus", "wsError"], (stored) => {
        const errDetail = stored.wsError || res?.error || "Connection to background failed";
        toast("Failed: " + errDetail, "error");
      });
    }
  });
});

// Typing Status
let typingTimeout = null;
let isCurrentlyTyping = false;

function sendTypingStatus(isTyping) {
  if (isCurrentlyTyping === isTyping) return;
  isCurrentlyTyping = isTyping;

  chrome.runtime.sendMessage({
    type: "SEND_TYPING_STATUS",
    typing: isTyping,
    username: currentUserEmail,
    roomCode: $("#active-room-code").textContent
  });
}

$("#chat-input").addEventListener("input", () => {
  sendTypingStatus(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTypingStatus(false);
  }, 2000);
});

// Relayed STOMP Message / Typing indicator listener
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const activeRoomCode = $("#active-room-code").textContent;

    if (message.type === "ROOM_VIDEO_CHANGED") {
      if (activeRoomCode) {
        console.log("Popup received ROOM_VIDEO_CHANGED, reloading room view");
        loadRoomView(activeRoomCode);
      }
    }

    if (message.type === "RECEIVE_CHAT_MESSAGE") {
      const msg = message.message;
      if (msg.roomCode === activeRoomCode) {
        appendChatMessage(msg);

        // If not currently on the chat tab, display red notification dot!
        const isChatTabActive = $("#tab-chat-btn").classList.contains("active");
        if (!isChatTabActive) {
          $("#chat-tab-dot").classList.remove("hidden");
        } else {
          // Clear badge in background if chat is open
          chrome.runtime.sendMessage({ type: "CLEAR_UNREAD_BADGE" });
        }
      }
    }

    if (message.type === "RECEIVE_TYPING_STATUS") {
      const indicator = message.indicator;
      if (indicator.roomCode === activeRoomCode && indicator.username !== currentUserEmail) {
        const typingEl = $("#chat-typing-indicator");
        if (indicator.typing) {
          $("#chat-typing-text").textContent = `${indicator.username} is typing`;
          typingEl.classList.remove("hidden");
        } else {
          typingEl.classList.add("hidden");
        }
      }
    }
  });
}

// Chat UI Render Helpers
function appendChatMessage(msg) {
  const container = $("#chat-messages");

  // Upgrade optimistic bubbles when server broadcast arrives
  if (msg.username === currentUserEmail && !msg.isOptimistic) {
    const optimisticBubbles = container.querySelectorAll(".chat-msg.self.optimistic");
    let matched = false;
    for (let bubble of optimisticBubbles) {
      if (bubble.getAttribute("data-msg-text") === msg.message) {
        bubble.classList.remove("optimistic");
        bubble.setAttribute("data-msg-id", msg.id);
        if (msg.timestamp) {
          bubble.querySelector(".chat-msg-time").textContent = formatMessageTime(msg.timestamp);
        }
        matched = true;
        break;
      }
    }
    if (matched) return;
  }

  const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 60;

  const el = createMessageElement(msg);
  container.appendChild(el);

  if (isAtBottom || msg.username === currentUserEmail) {
    container.scrollTop = container.scrollHeight;
  }
}

function renderChatHistory(messages) {
  const container = $("#chat-messages");
  container.innerHTML = "";
  // Chronological rendering (oldest first)
  const chronological = [...messages].reverse();
  chronological.forEach((msg) => {
    container.appendChild(createMessageElement(msg));
  });
  container.scrollTop = container.scrollHeight;
}

function createMessageElement(msg) {
  const div = document.createElement("div");
  const isSelf = msg.username === currentUserEmail;
  div.className = `chat-msg ${isSelf ? "self" : "other"}`;
  if (msg.isOptimistic) {
    div.classList.add("optimistic");
  }

  div.setAttribute("data-msg-id", msg.id);
  div.setAttribute("data-msg-text", msg.message);

  const timeStr = msg.timestamp ? formatMessageTime(msg.timestamp) : "";

  div.innerHTML = `
    <span class="chat-msg-username">${msg.username}</span>
    <div class="chat-msg-bubble">${escapeHTML(msg.message)}</div>
    <span class="chat-msg-time">${timeStr}</span>
  `;
  return div;
}

function formatMessageTime(timestamp) {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, (tag) => {
    const chars = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return chars[tag] || tag;
  });
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", initSession);
