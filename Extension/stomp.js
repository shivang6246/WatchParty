/**
 * A lightweight, dependency-free STOMP over WebSocket client.
 * Perfect for Chrome Content Scripts.
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
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      // Send CONNECT frame
      let headersStr = "";
      for (let key in this.headers) {
        headersStr += `${key}:${this.headers[key]}\n`;
      }
      this.socket.send(`CONNECT\naccept-version:1.1,1.2\n${headersStr}\n\u0000`);
    };

    this.socket.onmessage = (event) => {
      const data = event.data;
      
      // Heartbeats
      if (data === "\n" || data === "\r\n") return;

      // Handle multiple STOMP frames separated by null byte
      const frames = data.split("\u0000");
      for (let i = 0; i < frames.length; i++) {
        let frame = frames[i];
        
        // Remove leading newlines (heartbeats or protocol artifacts)
        while (frame.startsWith("\n") || frame.startsWith("\r\n")) {
          frame = frame.startsWith("\r\n") ? frame.substring(2) : frame.substring(1);
        }
        
        if (!frame.trim()) continue;

        const commandEnd = frame.indexOf("\n");
        if (commandEnd === -1) continue;
        const command = frame.substring(0, commandEnd).trim();

        // Support both Unix and Windows newlines for header/body split
        let headersEnd = frame.indexOf("\n\n");
        let headersEndLength = 2;
        if (headersEnd === -1) {
          headersEnd = frame.indexOf("\r\n\r\n");
          headersEndLength = 4;
        }

        let headersStr = "";
        let body = "";
        
        if (headersEnd !== -1) {
          headersStr = frame.substring(commandEnd + 1, headersEnd);
          body = frame.substring(headersEnd + headersEndLength).trim();
        } else {
          headersStr = frame.substring(commandEnd + 1);
        }

        if (command === "CONNECTED") {
          console.log("StompClient CONNECTED successfully");
          this.connected = true;
          if (this.onConnect) this.onConnect();
          
          // Resubscribe to existing subscriptions if reconnecting
          for (let subId in this.subscriptions) {
            this.socket.send(`SUBSCRIBE\nid:${subId}\ndestination:${this.subscriptions[subId].destination}\n\n\u0000`);
          }
        } else if (command === "ERROR") {
          console.error("StompClient ERROR frame:", body);
          if (this.onError) this.onError(new Error(body || "STOMP ERROR"));
        } else if (command === "MESSAGE") {
          const headers = {};
          headersStr.split("\n").forEach((line) => {
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
      }
    };

    this.socket.onerror = (err) => {
      console.error("StompClient socket error:", err);
      if (this.onError) this.onError(err);
    };

    this.socket.onclose = (event) => {
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
      const payload = JSON.stringify(body);
      const length = new TextEncoder().encode(payload).length;
      this.socket.send(
        `SEND\ndestination:${destination}\ncontent-type:application/json\ncontent-length:${length}\n\n${payload}\u0000`
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
