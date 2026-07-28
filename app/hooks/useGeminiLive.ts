"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Transcript speaker labels. The tool label is fixed; the other two come from assistant.json. */
export const TOOL_SPEAKER = "Tool";

export type TalkTurn = {
  id: number;
  speaker: string;
  text: string;
  typed?: boolean;
};

export type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
};

export type TalkStatus = "idle" | "connecting" | "live" | "ended" | "error";

export type EndedSession = {
  savedPath: string | null;
  drafts: string[];
  /** The bookkeeper wrote this session into memory before the request returned. */
  filed: boolean;
  /** It is still filing in the background; the answer just took longer than the wait. */
  filing: boolean;
};

type FunctionCall = { id?: string; name?: string; args?: unknown };

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

// Auto-hang-up: end the session after this much conversational silence (no
// speech either way, no typed turns, no tool calls). Mic level deliberately
// does not count as activity, so room noise or a playing instrument cannot
// hold a session open forever.
const IDLE_LIMIT_MS = 5 * 60_000;
const IDLE_WARNING_MS = 60_000;

// Ported verbatim from voice/public/app.js: known-good against this model.
const workletSource = `
class PcmRecorder extends AudioWorkletProcessor {
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
registerProcessor("pcm-recorder", PcmRecorder);
`;

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

class PcmPlayer {
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  readonly gain: GainNode;

  constructor(private context: AudioContext) {
    this.gain = context.createGain();
    this.gain.connect(context.destination);
  }

  add(base64: string) {
    const bytes = base64ToBytes(base64);
    const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const buffer = this.context.createBuffer(1, samples.length, PLAYBACK_RATE);
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
    for (const source of Array.from(this.sources)) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }
}

async function parseSocketMessage(data: unknown) {
  if (typeof data === "string") return JSON.parse(data) as Record<string, unknown>;
  if (data instanceof Blob) return JSON.parse(await data.text()) as Record<string, unknown>;
  return JSON.parse(new TextDecoder().decode(data as ArrayBuffer)) as Record<string, unknown>;
}

export function useGeminiLive({
  userLabel,
  assistantLabel,
  onAutoEnd,
}: {
  userLabel: string;
  assistantLabel: string;
  onAutoEnd?: (result: EndedSession) => void;
}) {
  const [status, setStatus] = useState<TalkStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TalkTurn[]>([]);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const turnsRef = useRef<TalkTurn[]>([]);
  const draftsRef = useRef<string[]>([]);
  const mutedRef = useRef(false);
  const nextTurnId = useRef(0);
  const savingRef = useRef(false);
  const closingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const onAutoEndRef = useRef(onAutoEnd);
  onAutoEndRef.current = onAutoEnd;

  const appendFragment = useCallback((speaker: string, text: string | undefined) => {
    if (typeof text !== "string" || text.length === 0) return;

    lastActivityRef.current = Date.now();
    const current = turnsRef.current[turnsRef.current.length - 1];
    if (current && current.speaker === speaker && !current.typed) {
      current.text += text;
      turnsRef.current = [...turnsRef.current.slice(0, -1), { ...current }];
    } else {
      nextTurnId.current += 1;
      turnsRef.current = [...turnsRef.current, { id: nextTurnId.current, speaker, text }];
    }
    setTurns(turnsRef.current);
  }, []);

  const appendWholeTurn = useCallback((speaker: string, text: string) => {
    lastActivityRef.current = Date.now();
    nextTurnId.current += 1;
    turnsRef.current = [...turnsRef.current, { id: nextTurnId.current, speaker, text, typed: true }];
    setTurns(turnsRef.current);
  }, []);

  const teardownAudio = useCallback(() => {
    sourceRef.current?.disconnect();
    recorderRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    playerRef.current?.stop();

    if (captureContextRef.current && captureContextRef.current.state !== "closed") {
      void captureContextRef.current.close();
    }
    if (playbackContextRef.current && playbackContextRef.current.state !== "closed") {
      void playbackContextRef.current.close();
    }

    sourceRef.current = null;
    recorderRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;
    playerRef.current = null;
    captureContextRef.current = null;
    playbackContextRef.current = null;
    setMicLevel(0);
  }, []);

  const saveTranscript = useCallback(async (): Promise<{
    path: string | null;
    filed: boolean;
    filing: boolean;
  }> => {
    const nothingSaved = { path: null, filed: false, filing: false };
    if (savingRef.current) return nothingSaved;
    savingRef.current = true;

    const payload = turnsRef.current.map((turn) => ({ speaker: turn.speaker, text: turn.text }));
    if (payload.length === 0) return nothingSaved;

    try {
      const response = await fetch("/api/talk/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: payload }),
      });
      const body = (await response.json()) as {
        path?: string | null;
        filed?: boolean;
        filing?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not save the transcript.");
      return { path: body.path ?? null, filed: Boolean(body.filed), filing: Boolean(body.filing) };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the transcript.");
      return nothingSaved;
    }
  }, []);

  const sendToolResponse = useCallback((call: FunctionCall, response: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] },
      }),
    );
  }, []);

  const runToolCall = useCallback(
    async (call: FunctionCall) => {
      const name = call.name || "unknown";
      const activityId = call.id || `${name}-${Date.now()}`;
      setToolActivity((current) => [...current, { id: activityId, name, status: "running" }]);
      appendWholeTurn(TOOL_SPEAKER, `${name} running`);

      const settle = (state: "done" | "error") =>
        setToolActivity((current) =>
          current.map((entry) => (entry.id === activityId ? { ...entry, status: state } : entry)),
        );

      try {
        const args =
          typeof call.args === "string"
            ? (JSON.parse(call.args) as Record<string, unknown>)
            : ((call.args as Record<string, unknown>) ?? {});

        const response = await fetch("/api/talk/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, args }),
        });
        const body = (await response.json()) as { result?: unknown; error?: string };

        if (!response.ok || body.error) {
          settle("error");
          sendToolResponse(call, { error: body.error || `Tool ${name} failed.` });
          return;
        }

        const result = body.result as { path?: string; sent?: boolean } | undefined;
        if (name === "draft_email" && result?.path) {
          draftsRef.current = [...draftsRef.current, result.path];
        }

        settle("done");
        sendToolResponse(call, { result: body.result });
      } catch (caught) {
        settle("error");
        sendToolResponse(call, {
          error: caught instanceof Error ? caught.message : `Tool ${name} failed.`,
        });
      }
    },
    [appendWholeTurn, sendToolResponse],
  );

  const startMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser blocks microphone access (needs localhost or https).");
    }

    // Do not constrain sampleRate here: some browsers reject the constraint and
    // kill the session. The capture AudioContext already runs at 16 kHz.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const context = captureContextRef.current;
    if (!context) throw new Error("The audio context went away.");

    const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    const source = context.createMediaStreamSource(stream);
    const recorder = new AudioWorkletNode(context, "pcm-recorder");
    const silent = context.createGain();
    silent.gain.value = 0;

    recorder.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const samples = new Int16Array(event.data);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      setMicLevel(Math.min(1, Math.sqrt(sum / samples.length) / 8000));

      // realtimeInput.audio as a single blob: the mediaChunks array shape is
      // rejected by current Live models and silently ends the session.
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: { mimeType: `audio/pcm;rate=${CAPTURE_RATE}`, data: bytesToBase64(event.data) },
          },
        }),
      );
    };

    source.connect(recorder);
    recorder.connect(silent);
    silent.connect(context.destination);

    sourceRef.current = source;
    recorderRef.current = recorder;
    silentGainRef.current = silent;
  }, []);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      let message: Record<string, unknown>;
      try {
        message = await parseSocketMessage(event.data);
      } catch {
        return;
      }

      if (typeof message.relayError === "string") {
        setError(message.relayError);
        setStatus("error");
        return;
      }

      if (message.setupComplete !== undefined) {
        try {
          await startMicrophone();
          lastActivityRef.current = Date.now();
          setStatus("live");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Microphone access failed.");
          setStatus("error");
          socketRef.current?.close(1000, "Microphone unavailable");
        }
        return;
      }

      const content = message.serverContent as
        | {
            interrupted?: boolean;
            inputTranscription?: { text?: string };
            outputTranscription?: { text?: string };
            modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
          }
        | undefined;

      if (content) {
        appendFragment(userLabel, content.inputTranscription?.text);
        appendFragment(assistantLabel, content.outputTranscription?.text);

        for (const part of content.modelTurn?.parts || []) {
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
            playerRef.current?.add(part.inlineData.data);
          }
        }

        if (content.interrupted) playerRef.current?.stop();
        return;
      }

      const toolCall = message.toolCall as { functionCalls?: FunctionCall[] } | undefined;
      if (toolCall?.functionCalls) {
        for (const call of toolCall.functionCalls) void runToolCall(call);
      }
    },
    [appendFragment, assistantLabel, runToolCall, startMicrophone, userLabel],
  );

  const connect = useCallback(
    async (modeId: string) => {
      setError(null);
      setStatus("connecting");
      setTurns([]);
      setToolActivity([]);
      turnsRef.current = [];
      draftsRef.current = [];
      savingRef.current = false;
      closingRef.current = false;

      let setup: unknown;
      try {
        const response = await fetch(`/api/talk/config?mode=${encodeURIComponent(modeId)}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as { setup?: unknown; error?: string };
        if (!response.ok || !body.setup) {
          throw new Error(body.error || "Could not build the session config.");
        }
        setup = body.setup;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not build the session config.");
        setStatus("error");
        return;
      }

      try {
        // Capture at 16 kHz (what Gemini expects in) and play back in a separate
        // 24 kHz context (what Gemini sends out). One shared context resamples
        // the assistant's voice and makes it sound worse.
        captureContextRef.current = new AudioContext({ sampleRate: CAPTURE_RATE });
        await captureContextRef.current.resume();
        playbackContextRef.current = new AudioContext({ sampleRate: PLAYBACK_RATE });
        await playbackContextRef.current.resume();
        playerRef.current = new PcmPlayer(playbackContextRef.current);
        playerRef.current.gain.gain.value = mutedRef.current ? 0 : 1;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not start audio.");
        setStatus("error");
        teardownAudio();
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/talk/ws`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.addEventListener("open", () => socket.send(JSON.stringify({ setup })));
      socket.addEventListener("message", (event) => void handleMessage(event));
      socket.addEventListener("error", () => {
        if (!closingRef.current) {
          setError("The connection to Gemini Live failed.");
          setStatus("error");
        }
      });
      socket.addEventListener("close", () => {
        socketRef.current = null;
        teardownAudio();
        setStatus((current) => {
          if (current === "error" || closingRef.current) return current;
          setError("The session closed unexpectedly. The transcript was saved.");
          return "error";
        });
        if (!closingRef.current) void saveTranscript();
      });
    },
    [handleMessage, saveTranscript, teardownAudio],
  );

  const disconnect = useCallback(async (): Promise<EndedSession> => {
    closingRef.current = true;
    const socket = socketRef.current;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Session ended");
    socketRef.current = null;
    teardownAudio();

    const saved = await saveTranscript();
    setStatus("ended");
    return { savedPath: saved.path, filed: saved.filed, filing: saved.filing, drafts: draftsRef.current };
  }, [saveTranscript, teardownAudio]);

  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim();
      const socket = socketRef.current;
      if (!clean || !socket || socket.readyState !== WebSocket.OPEN) return;

      appendWholeTurn(userLabel, clean);
      socket.send(
        JSON.stringify({
          clientContent: { turns: [{ role: "user", parts: [{ text: clean }] }], turnComplete: true },
        }),
      );
    },
    [appendWholeTurn, userLabel],
  );

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
    if (playerRef.current) playerRef.current.gain.gain.value = next ? 0 : 1;
    if (next) playerRef.current?.stop();
  }, []);

  const stayAlive = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleSecondsLeft(null);
  }, []);

  // Auto-hang-up on conversational silence, with a visible countdown for the
  // last minute. Ends through the same path as the End button, so the
  // transcript is saved and the view gets the usual session summary.
  useEffect(() => {
    if (status !== "live") {
      setIdleSecondsLeft(null);
      return;
    }

    const timer = window.setInterval(() => {
      if (closingRef.current) return;

      const remaining = IDLE_LIMIT_MS - (Date.now() - lastActivityRef.current);
      if (remaining <= 0) {
        window.clearInterval(timer);
        setIdleSecondsLeft(null);
        void disconnect().then((result) => onAutoEndRef.current?.(result));
        return;
      }
      setIdleSecondsLeft(remaining <= IDLE_WARNING_MS ? Math.ceil(remaining / 1000) : null);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [disconnect, status]);

  // A closed tab must not lose the conversation.
  useEffect(() => {
    const flush = () => {
      if (savingRef.current || turnsRef.current.length === 0) return;
      savingRef.current = true;
      const payload = JSON.stringify({
        turns: turnsRef.current.map((turn) => ({ speaker: turn.speaker, text: turn.text })),
      });
      navigator.sendBeacon("/api/talk/transcripts", new Blob([payload], { type: "application/json" }));
    };

    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return {
    status,
    error,
    turns,
    toolActivity,
    micLevel,
    muted,
    setMuted,
    idleSecondsLeft,
    stayAlive,
    connect,
    disconnect,
    sendText,
    clearError: () => setError(null),
  };
}
