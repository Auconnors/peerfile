const senderPanel = document.getElementById("sender-panel");
const receiverPanel = document.getElementById("receiver-panel");
const senderStatus = document.getElementById("sender-status");
const receiverStatus = document.getElementById("receiver-status");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const sendButton = document.getElementById("send-file");
const shareLink = document.getElementById("share-link");
const copyLinkButton = document.getElementById("copy-link");
const resetLinkButton = document.getElementById("reset-link");
const sendProgress = document.getElementById("send-progress");
const receiveProgress = document.getElementById("receive-progress");
const downloadArea = document.getElementById("download-area");
const downloadName = document.getElementById("download-name");
const downloadLink = document.getElementById("download-link");

const urlParams = new URLSearchParams(window.location.search);
const presetRoomId = urlParams.get("room");
const presetToken = urlParams.get("token");
const presetRole = urlParams.get("role");

let role = null;
let roomId = presetRoomId || "";
let accessToken = presetToken || "";
let ws;
let peerConnection;
let dataChannel;
let fileToSend;
let incomingFileMeta;
let incomingBuffers = [];
let incomingSize = 0;
let offerSent = false;
let receiverConnected = false;
let pendingSend = false;

const CHUNK_SIZE = 16 * 1024;

const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];

function showPanel(panel) {
  senderPanel.classList.add("hidden");
  receiverPanel.classList.add("hidden");
  panel.classList.remove("hidden");
}

function updateShareLink() {
  if (!roomId || !accessToken) return;
  const baseUrl = window.location.origin;
  const url = new URL(baseUrl);
  url.pathname = window.location.pathname;
  url.searchParams.set("room", roomId);
  url.searchParams.set("token", accessToken);
  url.searchParams.set("role", "receiver");
  shareLink.value = url.toString();
}

function updateSendProgress(value) {
  sendProgress.value = value;
}

function updateReceiveProgress(value) {
  receiveProgress.value = value;
}

function setStatus(element, message, isSuccess = false) {
  element.textContent = message;
  element.classList.toggle("success", isSuccess);
}

function createRoomId() {
  return crypto.randomUUID();
}

function createAccessToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildWebSocketUrl() {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function connectWebSocket() {
  return new Promise((resolve) => {
    ws = new WebSocket(buildWebSocketUrl());

    ws.addEventListener("open", () => resolve());

    ws.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "error") {
        setStatus(
          role === "sender" ? senderStatus : receiverStatus,
          message.message || "Erreur côté serveur."
        );
        return;
      }

      if (message.type === "joined") {
        setStatus(
          role === "sender" ? senderStatus : receiverStatus,
          `Connecté à la salle ${message.roomId}.`,
          true
        );
        return;
      }

      if (message.type === "room-state") {
        if (role === "sender") {
          receiverConnected = message.receiverConnected;
          const receiverReady = receiverConnected;
          sendButton.disabled = !fileToSend;
          setStatus(
            senderStatus,
            receiverReady
              ? "Receveur connecté. Prêt à envoyer."
              : "En attente d'un receveur…",
            receiverReady
          );
          if (!receiverReady) {
            offerSent = false;
          }
          if (receiverReady && !offerSent) {
            offerSent = true;
            await createOffer();
          }
          if (receiverReady && pendingSend && dataChannel?.readyState === "open") {
            pendingSend = false;
            await sendFile();
          }
        } else if (role === "receiver") {
          const senderReady = message.senderConnected;
          setStatus(
            receiverStatus,
            senderReady
              ? "Envoyeur connecté. Prêt à recevoir."
              : "En attente de l'envoyeur…",
            senderReady
          );
        }
        return;
      }

      if (message.type === "signal") {
        await handleSignal(message.payload);
      }
    });
  });
}

async function initPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers });

  peerConnection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({
          type: "signal",
          roomId,
          payload: { type: "candidate", candidate: event.candidate }
        })
      );
    }
  });

  if (role === "receiver") {
    peerConnection.addEventListener("datachannel", (event) => {
      dataChannel = event.channel;
      setupDataChannel();
    });
  }
}

async function handleSignal(payload) {
  if (payload.type === "offer") {
    await peerConnection.setRemoteDescription(payload.offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(
      JSON.stringify({
        type: "signal",
        roomId,
        payload: { type: "answer", answer }
      })
    );
    return;
  }

  if (payload.type === "answer") {
    await peerConnection.setRemoteDescription(payload.answer);
    return;
  }

  if (payload.type === "candidate" && payload.candidate) {
    await peerConnection.addIceCandidate(payload.candidate);
  }
}

function setupDataChannel() {
  dataChannel.binaryType = "arraybuffer";

  dataChannel.addEventListener("open", () => {
    if (role === "sender") {
      if (pendingSend && receiverConnected) {
        pendingSend = false;
        sendFile();
      }
    }
  });

  dataChannel.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      const meta = JSON.parse(event.data);
      if (meta.type === "meta") {
        incomingFileMeta = meta;
        incomingBuffers = [];
        incomingSize = 0;
        updateReceiveProgress(0);
        downloadArea.classList.add("hidden");
        if (downloadName) {
          downloadName.textContent = `Nom du fichier : ${meta.name}`;
        }
      }
      return;
    }

    incomingBuffers.push(event.data);
    incomingSize += event.data.byteLength;
    const progress = Math.round(
      (incomingSize / incomingFileMeta.size) * 100
    );
    updateReceiveProgress(progress);

    if (incomingSize >= incomingFileMeta.size) {
      const blob = new Blob(incomingBuffers);
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = incomingFileMeta.name;
      downloadLink.textContent = "Télécharger le fichier";
      downloadArea.classList.remove("hidden");
      setStatus(receiverStatus, "Téléchargement prêt !", true);
    }
  });
}

async function createOffer() {
  dataChannel = peerConnection.createDataChannel("file");
  setupDataChannel();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(
    JSON.stringify({
      type: "signal",
      roomId,
      payload: { type: "offer", offer }
    })
  );
}

async function joinRoom(selectedRole) {
  role = selectedRole;
  roomId = roomId || createRoomId();
  if (role === "sender") {
    accessToken = accessToken || createAccessToken();
  } else if (!accessToken) {
    showPanel(receiverPanel);
    setStatus(receiverStatus, "Lien invalide : jeton de sécurité manquant.");
    return;
  }

  if (role === "sender") {
    showPanel(senderPanel);
    updateShareLink();
  } else {
    showPanel(receiverPanel);
  }

  await connectWebSocket();
  await initPeerConnection();

  ws.send(JSON.stringify({ type: "join", roomId, role, token: accessToken }));
}

fileInput.addEventListener("change", (event) => {
  fileToSend = event.target.files[0];
  fileName.textContent = fileToSend ? fileToSend.name : "Aucun fichier sélectionné";
  sendButton.disabled = !fileToSend;
});

async function sendFile() {
  if (!fileToSend || !dataChannel || dataChannel.readyState !== "open") return;
  sendButton.disabled = true;

  const meta = {
    type: "meta",
    name: fileToSend.name,
    size: fileToSend.size
  };
  dataChannel.send(JSON.stringify(meta));

  const reader = fileToSend.stream().getReader();
  let totalSent = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    let offset = 0;
    while (offset < value.byteLength) {
      const slice = value.slice(offset, offset + CHUNK_SIZE);
      dataChannel.send(slice);
      offset += CHUNK_SIZE;
      totalSent += slice.byteLength;
      const progress = Math.round((totalSent / fileToSend.size) * 100);
      updateSendProgress(progress);
    }
  }

  setStatus(senderStatus, "Fichier envoyé !", true);
}

sendButton.addEventListener("click", async () => {
  if (!fileToSend) return;
  if (!shareLink.value) {
    updateShareLink();
  }
  if (!receiverConnected) {
    pendingSend = true;
    setStatus(senderStatus, "En attente du receveur pour démarrer…");
    return;
  }
  if (!dataChannel || dataChannel.readyState !== "open") {
    pendingSend = true;
    setStatus(senderStatus, "Connexion en cours, envoi dès que prêt…");
    return;
  }
  await sendFile();
});

copyLinkButton.addEventListener("click", async () => {
  if (!shareLink.value) return;
  await navigator.clipboard.writeText(shareLink.value);
  copyLinkButton.textContent = "Copié !";
  setTimeout(() => {
    copyLinkButton.textContent = "Copier le lien";
  }, 2000);
});

resetLinkButton?.addEventListener("click", () => {
  if (role !== "sender") return;
  accessToken = createAccessToken();
  updateShareLink();
  setStatus(senderStatus, "Lien réinitialisé. Partagez le nouveau lien.");
});

if (presetRoomId && presetRole === "receiver") {
  joinRoom("receiver");
} else {
  joinRoom("sender");
}
