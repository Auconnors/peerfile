import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;
const hasSslConfig = Boolean(sslKeyPath && sslCertPath);
const server = hasSslConfig
  ? https.createServer(
      {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
      },
      app
    )
  : http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const VALID_ROLES = new Set(["sender", "receiver"]);

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      sender: null,
      receiver: null,
      clients: new Set(),
      token: null
    });
  }
  return rooms.get(roomId);
}

function isValidToken(token) {
  return typeof token === "string" && token.length >= 16 && token.length <= 64;
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify({
    type: "room-state",
    roomId,
    senderConnected: Boolean(room.sender),
    receiverConnected: Boolean(room.receiver)
  });
  room.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      socket.send(
        JSON.stringify({ type: "error", message: "Invalid JSON payload." })
      );
      return;
    }

    if (message.type === "join") {
      const { roomId, role, token } = message;
      if (!roomId || !role || !token) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Missing roomId, role, or token."
          })
        );
        return;
      }

      if (!VALID_ROLES.has(role)) {
        socket.send(
          JSON.stringify({ type: "error", message: "Invalid role." })
        );
        return;
      }

      if (!isValidToken(token)) {
        socket.send(
          JSON.stringify({ type: "error", message: "Invalid security token." })
        );
        return;
      }

      const room = getRoom(roomId);
      if (room.token && room.token !== token) {
        socket.send(
          JSON.stringify({ type: "error", message: "Invalid room token." })
        );
        return;
      }

      if (!room.token) {
        room.token = token;
      }

      if (role === "sender" && room.sender) {
        socket.send(
          JSON.stringify({ type: "error", message: "Sender already connected." })
        );
        return;
      }

      if (role === "receiver" && room.receiver) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Receiver already connected."
          })
        );
        return;
      }

      socket.roomId = roomId;
      socket.role = role;
      socket.token = token;
      room.clients.add(socket);

      if (role === "sender") {
        room.sender = socket;
      } else if (role === "receiver") {
        room.receiver = socket;
      }

      socket.send(
        JSON.stringify({
          type: "joined",
          roomId,
          role
        })
      );

      broadcastRoomState(roomId);
      return;
    }

    if (message.type === "signal") {
      const { roomId, payload } = message;
      if (!roomId || !payload) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (socket.roomId !== roomId) return;
      if (room.token && socket.token !== room.token) return;

      const target = socket.role === "sender" ? room.receiver : room.sender;
      if (target && target.readyState === target.OPEN) {
        target.send(JSON.stringify({ type: "signal", payload }));
      }
      return;
    }
  });

  socket.on("close", () => {
    const { roomId, role } = socket;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.clients.delete(socket);
    if (role === "sender") room.sender = null;
    if (role === "receiver") room.receiver = null;

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcastRoomState(roomId);
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const protocol = hasSslConfig ? "https" : "http";
  console.log(`PeerFile server running on ${protocol}://localhost:${PORT}`);
});
