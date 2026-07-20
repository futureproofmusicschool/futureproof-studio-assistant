const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const statusText = document.querySelector("#status-text");
const transcriptElement = document.querySelector("#transcript");
const sessionTime = document.querySelector("#session-time");

let socket = null;
let audioContext = null;
let playbackContext = null;
let mediaStream = null;
let mediaSource = null;
let recorderNode = null;
let silentGain = null;
let player = null;
let timer = null;
let startedAt = null;
let stopping = false;
let turns = [];

const workletSource = `
class TeoRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(2048);
    this.index = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      this.buffer[this.index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.index += 1;
      if (this.index === this.buffer.length) {
        const chunk = this.buffer.buffer;
        this.port.postMessage(chunk, [chunk]);
        this.buffer = new Int16Array(2048);
        this.index = 0;
      }
    }
    return true;
  }
}
registerProcessor("teo-recorder", TeoRecorder);
`;

class PcmPlayer {
  constructor(context) {
    this.context = context;
    this.nextStartTime = 0;
    this.sources = new Set();
    this.gain = context.createGain();
    this.gain.connect(context.destination);
  }

  add(base64) {
    const bytes = base64ToBytes(base64);
    const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const startAt = Math.max(this.nextStartTime, this.context.currentTime + 0.08);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.sources.add(source);
    source.addEventListener("ended", () => this.sources.delete(source), { once: true });
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch (_) {
        // The source may already have ended.
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }
}

function setStatus(label, state) {
  statusText.textContent = label;
  document.body.dataset.state = state;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function appendTranscript(speaker, text) {
  if (!text) return;
  const current = turns[turns.length - 1];
  if (current && current.speaker === speaker) {
    current.text += text;
  } else {
    turns.push({ speaker, text });
  }
  renderTranscript();
}

function renderTranscript() {
  transcriptElement.replaceChildren();
  for (const turn of turns) {
    const row = document.createElement("article");
    row.className = "turn";
    const speaker = document.createElement("span");
    speaker.className = "speaker";
    speaker.textContent = turn.speaker;
    const text = document.createElement("p");
    text.className = "turn-text";
    text.textContent = turn.text;
    row.append(speaker, text);
    transcriptElement.append(row);
  }
  transcriptElement.scrollTop = transcriptElement.scrollHeight;
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  sessionTime.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function parseSocketMessage(event) {
  if (typeof event.data === "string") return JSON.parse(event.data);
  if (event.data instanceof Blob) return JSON.parse(await event.data.text());
  return JSON.parse(new TextDecoder().decode(event.data));
}

async function beginMicrophone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("This browser blocks microphone access (needs localhost or https).");
  }
  // Ask only for audio. Do not constrain sampleRate here: some browsers reject
  // the constraint outright, which was closing the session immediately. The
  // AudioContext already runs at 16 kHz, so the worklet output is 16 kHz.
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
  try {
    await audioContext.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  mediaSource = audioContext.createMediaStreamSource(mediaStream);
  recorderNode = new AudioWorkletNode(audioContext, "teo-recorder");
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  recorderNode.port.onmessage = (event) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Match Kadence's proven wire shape exactly: realtimeInput.audio is a single
    // Blob { mimeType, data }. The old realtimeInput.mediaChunks array is rejected
    // by current Gemini Live models, which silently terminated the session on the
    // first audio frame (the "opens then closes right away" bug).
    socket.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: bytesToBase64(event.data),
        },
      },
    }));
  };
  mediaSource.connect(recorderNode);
  recorderNode.connect(silentGain);
  silentGain.connect(audioContext.destination);
}

function handleServerContent(content) {
  appendTranscript("Artist", content.inputTranscription?.text);
  appendTranscript("Assistant", content.outputTranscription?.text);

  for (const part of content.modelTurn?.parts || []) {
    const inlineData = part.inlineData;
    if (inlineData?.data && inlineData.mimeType?.startsWith("audio/pcm")) {
      player.add(inlineData.data);
    }
  }

  if (content.interrupted) player.stop();
}

async function handleSocketMessage(event) {
  let message;
  try {
    message = await parseSocketMessage(event);
  } catch (error) {
    console.error("Could not parse server message", error);
    return;
  }

  if (message.relayError) {
    setStatus(message.relayError, "error");
    return;
  }
  if (message.setupComplete) {
    try {
      await beginMicrophone();
      setStatus("Listening", "live");
    } catch (error) {
      setStatus(error.message || "Microphone access failed", "error");
      stopSession();
    }
    return;
  }
  if (message.serverContent) handleServerContent(message.serverContent);
}

async function startSession() {
  startButton.disabled = true;
  stopButton.disabled = false;
  stopping = false;
  turns = [];
  renderTranscript();
  setStatus("Connecting", "connecting");

  try {
    // Capture context runs at 16 kHz (what Gemini expects for input).
    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.resume();
    // Playback gets its OWN 24 kHz context, because Gemini returns 24 kHz PCM.
    // Playing 24 kHz buffers inside the 16 kHz capture context resampled the assistant's
    // voice down and made it sound worse. Two contexts, matching Kadence.
    playbackContext = new AudioContext({ sampleRate: 24000 });
    await playbackContext.resume();
    player = new PcmPlayer(playbackContext);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", handleSocketMessage);
    socket.addEventListener("error", () => setStatus("Connection error", "error"));
    socket.addEventListener("close", () => {
      if (!stopping && document.body.dataset.state !== "error") {
        setStatus("Connection closed", "error");
      }
      cleanupSession();
    });
    startedAt = Date.now();
    updateTimer();
    timer = window.setInterval(updateTimer, 1000);
  } catch (error) {
    setStatus(error.message || "Could not start", "error");
    cleanupSession();
  }
}

function stopSession() {
  stopping = true;
  setStatus("Saving", "connecting");
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Session ended");
  cleanupSession();
  setStatus("Saved", "ready");
}

function cleanupSession() {
  window.clearInterval(timer);
  timer = null;
  mediaSource?.disconnect();
  recorderNode?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  player?.stop();
  if (audioContext && audioContext.state !== "closed") audioContext.close();
  if (playbackContext && playbackContext.state !== "closed") playbackContext.close();
  mediaStream = null;
  mediaSource = null;
  recorderNode = null;
  silentGain = null;
  player = null;
  audioContext = null;
  playbackContext = null;
  socket = null;
  startButton.disabled = false;
  stopButton.disabled = true;
}

startButton.addEventListener("click", startSession);
stopButton.addEventListener("click", stopSession);
window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, "Page closed");
});
