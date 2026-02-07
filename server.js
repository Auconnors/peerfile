import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { sender: null, receiver: null, clients: new Set() });
  }
  return rooms.get(roomId);
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
      const { roomId, role } = message;
      if (!roomId || !role) {
        socket.send(
          JSON.stringify({ type: "error", message: "Missing roomId or role." })
        );
        return;
      }

      const room = getRoom(roomId);
      socket.roomId = roomId;
      socket.role = role;
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
  console.log(`PeerFile server running on http://localhost:${PORT}`);
});
