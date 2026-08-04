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

export type TalkStatus = "idle" | "connecting" | "live" | "reconnecting" | "ended" | "error";

type SeedTurn = { role: "user" | "model"; parts: { text: string }[] };

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

// Surviving Gemini's ~10 minute connection limit.
//
// Gemini sends a `goAway` with a countdown shortly before it kills the socket.
// The client closes itself just before that deadline with "expecting a
// reconnect" set, then reopens with the resumption handle it has been
// collecting all along. The audio graph is left running across the gap, so a
// resume is a blip rather than a restart.
const GO_AWAY_BUFFER_MS = 1500;
const EXPECTED_RECONNECT_DELAY_MS = 3000;
const EXPIRED_HANDLE_RETRY_MS = 250;
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 15000;
const MAX_RECONNECT_ATTEMPTS = 5;

function closeReasonIncludes(reason: string, ...needles: string[]) {
  const text = reason.toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

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
  const closingRef = useRef(false);
  const relayErrorRef = useRef<string | null>(null);
  const lastActivityRef = useRef(0);
  const onAutoEndRef = useRef(onAutoEnd);
  onAutoEndRef.current = onAutoEnd;

  // Reconnect machinery. The handle is what lets a reopened socket rejoin the
  // same Gemini-side conversation instead of starting cold.
  const setupRef = useRef<Record<string, unknown> | null>(null);
  const seedTurnsRef = useRef<SeedTurn[]>([]);
  const modeIdRef = useRef("open");
  const sessionHandleRef = useRef<string | null>(null);
  const attemptedHandleRef = useRef<string | null>(null);
  const invalidatedHandleRef = useRef<string | null>(null);
  const expectingReconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const tokenOverflowRetryRef = useRef(false);
  const goAwayTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const openSocketRef = useRef<((options: { isReconnect: boolean; minimal?: boolean }) => void) | null>(null);

  const persistHandle = useCallback((handle: string | null) => {
    void fetch("/api/conversation/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: handle ?? "" }),
    }).catch(() => {
      // A handle that fails to persist only costs resumption after a reload.
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (goAwayTimerRef.current !== null) window.clearTimeout(goAwayTimerRef.current);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    goAwayTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

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
        relayErrorRef.current = message.relayError;
        setError(message.relayError);
        setStatus("error");
        return;
      }

      if (message.setupComplete !== undefined) {
        try {
          // On a resume the mic is already open and feeding the new socket
          // (the recorder reads socketRef every chunk), so opening it again
          // would stack a second capture graph.
          if (!streamRef.current) await startMicrophone();

          reconnectAttemptsRef.current = 0;
          tokenOverflowRetryRef.current = false;
          expectingReconnectRef.current = false;
          attemptedHandleRef.current = null;

          const seeds = seedTurnsRef.current;
          if (seeds.length > 0) {
            // With historyConfig.initialHistoryInClientContent set, turnComplete
            // finalizes the replayed history without making the model answer it.
            socketRef.current?.send(JSON.stringify({ clientContent: { turns: seeds, turnComplete: true } }));
            seedTurnsRef.current = [];
          }

          lastActivityRef.current = Date.now();
          setError(null);
          setStatus("live");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Microphone access failed.");
          setStatus("error");
          closingRef.current = true;
          socketRef.current?.close(1000, "Microphone unavailable");
        }
        return;
      }

      // Gemini hands out a resumption handle periodically. It is the only way
      // back into this conversation after the connection is cut.
      const resumption = message.sessionResumptionUpdate as
        | { newHandle?: string; resumable?: boolean }
        | undefined;
      if (resumption) {
        if (resumption.newHandle) {
          sessionHandleRef.current = resumption.newHandle;
          invalidatedHandleRef.current = null;
          persistHandle(resumption.newHandle);
        } else if (resumption.resumable === false) {
          sessionHandleRef.current = null;
          persistHandle(null);
        }
        return;
      }

      // The warning shot before Gemini closes the socket. Hang up just ahead of
      // it so the close lands in the reconnect ladder rather than as a failure.
      const goAway = message.goAway as { timeLeft?: string } | undefined;
      if (goAway) {
        const seconds = Number.parseFloat(String(goAway.timeLeft ?? ""));
        const remaining = Number.isFinite(seconds) ? seconds : 5;
        const delay = Math.max(remaining * 1000 - GO_AWAY_BUFFER_MS, EXPIRED_HANDLE_RETRY_MS);

        expectingReconnectRef.current = true;
        if (goAwayTimerRef.current !== null) window.clearTimeout(goAwayTimerRef.current);
        goAwayTimerRef.current = window.setTimeout(() => {
          goAwayTimerRef.current = null;
          if (closingRef.current) return;
          const socket = socketRef.current;
          if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Rotating session");
        }, delay);
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
    [appendFragment, assistantLabel, persistHandle, runToolCall, startMicrophone, userLabel],
  );

  const loadConfig = useCallback(async (modeId: string, minimal: boolean) => {
    const response = await fetch(
      `/api/talk/config?mode=${encodeURIComponent(modeId)}${minimal ? "&minimal=1" : ""}`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as {
      setup?: Record<string, unknown>;
      handle?: string | null;
      seedTurns?: SeedTurn[];
      error?: string;
    };
    if (!response.ok || !body.setup) throw new Error(body.error || "Could not build the session config.");
    return body;
  }, []);

  /**
   * Open (or reopen) the socket. Everything that survives a reconnect — the
   * audio graph, the transcript, the collected handle — lives outside this
   * function, so a resume only swaps the socket underneath.
   */
  const openSocket = useCallback(
    async ({ isReconnect, minimal = false }: { isReconnect: boolean; minimal?: boolean }) => {
      if (minimal) {
        try {
          setupRef.current = (await loadConfig(modeIdRef.current, true)).setup ?? setupRef.current;
        } catch {
          // Keep the setup we already have rather than losing the retry.
        }
      }

      const setup = setupRef.current;
      if (!setup) return;

      relayErrorRef.current = null;
      setStatus(isReconnect ? "reconnecting" : "connecting");

      const stored = sessionHandleRef.current;
      const resumeHandle = stored && stored !== invalidatedHandleRef.current ? stored : null;
      attemptedHandleRef.current = resumeHandle;

      // Resuming replays the conversation on Gemini's side already, and a
      // minimal retry is a rescue from an oversized setup. Seeding either would
      // duplicate history or re-trigger the failure.
      if (isReconnect || resumeHandle || minimal) seedTurnsRef.current = [];

      const attemptSetup: Record<string, unknown> = {
        ...setup,
        sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
        ...(seedTurnsRef.current.length > 0
          ? { historyConfig: { initialHistoryInClientContent: true } }
          : {}),
      };

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/talk/ws`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.addEventListener("open", () => socket.send(JSON.stringify({ setup: attemptSetup })));
      socket.addEventListener("message", (event) => void handleMessage(event));
      socket.addEventListener("error", () => {
        // The close handler decides what to do; an error alone is not terminal.
      });

      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (goAwayTimerRef.current !== null) {
          window.clearTimeout(goAwayTimerRef.current);
          goAwayTimerRef.current = null;
        }

        const reason = event.reason?.trim() ?? "";
        const attempted = attemptedHandleRef.current;
        const wasExpected = expectingReconnectRef.current;
        expectingReconnectRef.current = false;

        const giveUp = (message: string) => {
          setError(message);
          setStatus("error");
          teardownAudio();
        };
        const retry = (delay: number, options: { minimal?: boolean } = {}) => {
          setStatus("reconnecting");
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            if (closingRef.current) return;
            openSocketRef.current?.({ isReconnect: true, minimal: options.minimal });
          }, delay);
        };

        // P4: the artist hung up, or the idle timer did it for them.
        if (closingRef.current) return;

        // A relay-local failure (missing API key) is not something reconnecting fixes.
        if (relayErrorRef.current) {
          giveUp(relayErrorRef.current);
          return;
        }

        const expiredHandle =
          event.code === 1008 &&
          Boolean(attempted) &&
          closeReasonIncludes(reason, "session expired", "session not found", "not was found", "was not found");
        const tokenOverflow =
          event.code === 1007 && closeReasonIncludes(reason, "token", "context", "too large");
        const protocolError =
          !tokenOverflow &&
          (event.code === 1007 ||
            (event.code === 1008 && closeReasonIncludes(reason, "invalid argument", "unknown name")));
        const upstreamDown = event.code === 1011 && closeReasonIncludes(reason, "unavailable");

        // P1: the planned rotation at the connection limit, or the same kill
        // arriving without a goAway warning.
        if (wasExpected || (upstreamDown && sessionHandleRef.current)) {
          reconnectAttemptsRef.current = 0;
          retry(EXPECTED_RECONNECT_DELAY_MS);
          return;
        }

        // P2: the handle went stale. Drop it and open a fresh session quietly.
        if (expiredHandle) {
          invalidatedHandleRef.current = attempted;
          sessionHandleRef.current = null;
          persistHandle(null);
          retry(EXPIRED_HANDLE_RETRY_MS);
          return;
        }

        // P2b: the setup was too big. One retry with identity and tools only.
        if (tokenOverflow && !tokenOverflowRetryRef.current) {
          tokenOverflowRetryRef.current = true;
          setError("The session setup was too large, reconnecting with a lighter context.");
          retry(EXPIRED_HANDLE_RETRY_MS, { minimal: true });
          return;
        }

        // P3: a malformed request. Retrying sends the same bad frame.
        if (protocolError) {
          giveUp(reason ? `Gemini rejected the session: ${reason}` : "Gemini rejected the session setup.");
          return;
        }

        // P5: anything else, backed off, as long as there is a session to return to.
        if (sessionHandleRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          retry(
            Math.min(
              RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttemptsRef.current - 1),
              RECONNECT_MAX_DELAY_MS,
            ),
          );
          return;
        }

        giveUp(
          reason
            ? `The call ended (code ${event.code}): ${reason}`
            : `The call ended unexpectedly (code ${event.code}). Everything said is saved.`,
        );
      });
    },
    [handleMessage, persistHandle, teardownAudio],
  );

  openSocketRef.current = openSocket;

  const connect = useCallback(
    async (modeId: string) => {
      setError(null);
      setStatus("connecting");
      // Turns here are only this call's live display buffer; the conversation
      // itself is on the server, already rendered by the view.
      setTurns([]);
      turnsRef.current = [];
      setToolActivity([]);
      draftsRef.current = [];
      closingRef.current = false;
      relayErrorRef.current = null;
      expectingReconnectRef.current = false;
      reconnectAttemptsRef.current = 0;
      tokenOverflowRetryRef.current = false;
      invalidatedHandleRef.current = null;
      attemptedHandleRef.current = null;
      modeIdRef.current = modeId;
      clearTimers();

      try {
        const body = await loadConfig(modeId, false);
        setupRef.current = body.setup ?? null;
        seedTurnsRef.current = body.seedTurns ?? [];
        // A handle stored on disk means a call was interrupted (reload, crash)
        // rather than ended, so pressing Call rejoins it.
        sessionHandleRef.current = body.handle ?? null;
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

      void openSocket({ isReconnect: false });
    },
    [clearTimers, loadConfig, openSocket, teardownAudio],
  );

  const disconnect = useCallback(async (): Promise<EndedSession> => {
    closingRef.current = true;
    clearTimers();

    const socket = socketRef.current;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Session ended");
    socketRef.current = null;
    teardownAudio();

    // A deliberate hangup ends the Gemini session too: the stored handle only
    // exists to survive a reload or a crash mid-call.
    sessionHandleRef.current = null;
    attemptedHandleRef.current = null;
    persistHandle(null);

    setStatus("ended");
    // Turns are persisted by the relay as the call happens, so hanging up has
    // nothing left to save.
    return { savedPath: null, filed: false, filing: false, drafts: draftsRef.current };
  }, [clearTimers, persistHandle, teardownAudio]);

  /**
   * Typed input, and attachments, into a running call.
   *
   * `silent` is for text the artist did not type (a file's extracted contents,
   * say): the model should hear it, but it should not appear as their turn.
   */
  const sendText = useCallback(
    (
      text: string,
      image?: { mimeType: string; data: string },
      options?: { silent?: boolean },
    ) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      // Live takes a still image on the video channel; there is no inlineData
      // path for documents, which is why everything else arrives as text.
      if (image) {
        socket.send(JSON.stringify({ realtimeInput: { video: image } }));
        lastActivityRef.current = Date.now();
      }

      const clean = text.trim();
      if (!clean) return;

      if (!options?.silent) appendWholeTurn(userLabel, clean);
      else lastActivityRef.current = Date.now();

      // realtimeInput rather than clientContent: it keeps typed turns
      // distinguishable from history seeding, which the relay must never
      // persist, and it is the shape this Live model expects for live input.
      socket.send(JSON.stringify({ realtimeInput: { text: clean } }));
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

  // No pagehide beacon: the relay flushes whatever was mid-sentence when the
  // browser socket dies, which covers a closed tab better than a beacon can.

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
