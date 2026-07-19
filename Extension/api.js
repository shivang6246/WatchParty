/* ═══════════════════════════════════════════════════════════
   WatchParty — API Layer
   Handles all communication with the Spring Boot backend
   ═══════════════════════════════════════════════════════════ */

const API_BASE_URL = "http://54.206.106.162:8081/api";

// ── Storage Compatibility Layer ──────────────────────────
// Falls back to localStorage when chrome.storage is unavailable
// (e.g. when opening popup.html directly in a browser for testing)

const storage = (() => {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }

  // Fallback using localStorage
  return {
    async get(keys) {
      const keyArr = Array.isArray(keys) ? keys : [keys];
      const result = {};
      keyArr.forEach((k) => {
        const val = localStorage.getItem("wp_" + k);
        if (val !== null) {
          try {
            result[k] = JSON.parse(val);
          } catch {
            result[k] = val;
          }
        }
      });
      return result;
    },
    async set(obj) {
      Object.entries(obj).forEach(([k, v]) => {
        localStorage.setItem("wp_" + k, JSON.stringify(v));
      });
    },
    async remove(keys) {
      const keyArr = Array.isArray(keys) ? keys : [keys];
      keyArr.forEach((k) => localStorage.removeItem("wp_" + k));
    },
  };
})();

// ── Helpers ──────────────────────────────────────────────

/**
 * Retrieve the stored JWT token
 */
async function getToken() {
  const data = await storage.get("jwt");
  return data.jwt || null;
}

/**
 * Store session data (token + user info) after login/register
 */
async function saveSession(authResponse) {
  await storage.set({
    jwt: authResponse.accessToken,
    username: authResponse.username,
    email: authResponse.email,
    role: authResponse.role,
  });
}

/**
 * Clear all stored session data on logout
 */
async function clearSession() {
  await storage.remove(["jwt", "username", "email", "role", "currentRoom"]);
}

/**
 * Get stored user info without hitting the server
 */
async function getStoredUser() {
  return storage.get(["username", "email", "role"]);
}

/**
 * Build headers with optional JWT Authorization
 */
async function authHeaders() {
  const token = await getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Generic fetch wrapper with error handling and request timeout.
 * Returns the parsed JSON body or throws an error with the server message.
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await authHeaders();

  // Create abort controller for request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
    });
  } catch (networkErr) {
    if (networkErr.name === "AbortError") {
      const err = new Error("Request timed out (server not responding)");
      err.status = 0;
      throw err;
    }
    const err = new Error("Connection failed (is the backend server running?)");
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Try to parse body regardless of status
  let body = null;
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message =
      (body && (body.message || body.error)) ||
      `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return body;
}

// ── Auth APIs ────────────────────────────────────────────

async function apiLogin(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await saveSession(data);
  return data;
}

async function apiRegister(username, email, password) {
  const data = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
  return data;
}

/**
 * Validate the current JWT by calling /api/auth/me
 * Returns user info if valid, throws if expired/invalid
 */
async function apiGetCurrentUser() {
  return apiRequest("/auth/me");
}

// ── Room APIs ────────────────────────────────────────────

async function apiCreateRoom(roomName, locked, videoUrl, platform) {
  const body = { roomName, locked };
  if (videoUrl) body.videoUrl = videoUrl;
  if (platform) body.platform = platform;

  const data = await apiRequest("/room", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await storage.set({ currentRoom: data.roomCode });
  return data;
}

async function apiJoinRoom(roomCode) {
  const data = await apiRequest("/room/join", {
    method: "POST",
    body: JSON.stringify({ roomCode }),
  });
  await storage.set({ currentRoom: data.roomCode });
  return data;
}

async function apiJoinByInvite(inviteToken) {
  const data = await apiRequest(`/room/join/invite/${inviteToken}`, {
    method: "POST",
  });
  await storage.set({ currentRoom: data.roomCode });
  return data;
}

async function apiGetRoomDetails(roomCode) {
  return apiRequest(`/room/${roomCode}`);
}

async function apiGetRoomMembers(roomCode) {
  return apiRequest(`/room/${roomCode}/members`);
}

async function apiGetInviteLink(roomCode) {
  return apiRequest(`/room/${roomCode}/invite`);
}

async function apiLeaveRoom(roomCode) {
  const data = await apiRequest("/room/leaveRoom", {
    method: "POST",
    body: JSON.stringify({ roomCode }),
  });
  await storage.remove("currentRoom");
  return data;
}

async function apiEndRoom(roomCode) {
  const data = await apiRequest("/room/end", {
    method: "POST",
    body: JSON.stringify({ roomCode }),
  });
  await storage.remove("currentRoom");
  return data;
}

async function apiKickMember(roomCode, username) {
  return apiRequest("/room/kick", {
    method: "POST",
    body: JSON.stringify({ roomCode, username }),
  });
}

async function apiUpdateRole(roomCode, username, roomRole) {
  return apiRequest(`/room/${roomCode}/role`, {
    method: "POST",
    body: JSON.stringify({ username, roomRole }),
  });
}

// ── Chat APIs ────────────────────────────────────────────

async function apiGetChatHistory(roomCode, page = 0, size = 50) {
  return apiRequest(`/chat/${roomCode}/history?page=${page}&size=${size}`);
}
