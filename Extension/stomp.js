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
      const commandEnd = data.indexOf("\n");
      if (commandEnd === -1) return;
      const command = data.substring(0, commandEnd).trim();

      if (command === "CONNECTED") {
        console.log("StompClient CONNECTED successfully");
        this.connected = true;
        if (this.onConnect) this.onConnect();
        
        // Resubscribe to existing subscriptions if reconnecting
        for (let subId in this.subscriptions) {
          this.socket.send(`SUBSCRIBE\nid:${subId}\ndestination:${this.subscriptions[subId].destination}\n\n\u0000`);
        }
      } else if (command === "MESSAGE") {
        // Parse headers and body
        const bodyStart = data.indexOf("\n\n") + 2;
        const body = data.substring(bodyStart, data.lastIndexOf("\u0000")).trim();

        // Find subscription ID
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
