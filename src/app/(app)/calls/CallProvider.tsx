"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSocket } from "@/hooks/useSocket";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const CALL_TIMEOUT_MS = 45_000;

type CallStatus = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended" | "failed";
type CallRole = "caller" | "callee";

type PeerUser = {
  id?: string;
  username?: string | null;
  displayName: string;
  avatarUrl: string | null;
};

type CurrentCall = {
  callId: string;
  chatId: string;
  role: CallRole;
  peerUser: PeerUser;
  video: boolean;
};

type DebugInfo = {
  callId: string | null;
  role: CallRole | null;
  status: CallStatus;
  signalingState: string | null;
  connectionState: string | null;
  iceConnectionState: string | null;
  localAudioTracks: number;
  remoteAudioTracks: number;
  remoteStreamExists: boolean;
  iceServers: string[];
  outboundBytes: number;
  inboundBytes: number;
  outboundPackets: number;
  inboundPackets: number;
  candidatePair: string | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  audioSrcObjectAssigned: boolean;
  audioPlayStatus: "idle" | "pending" | "success" | "failed";
  turnPresent: boolean;
  forceRelay: boolean;
  pushSource: "foreground" | "push" | null;
};

interface CallContextType {
  call: CurrentCall | null;
  status: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isVideo: boolean;
  isScreenSharing: boolean;
  error: string | null;
  debugInfo: DebugInfo;
  startCall: (chatId: string, peerUser?: { displayName: string; avatarUrl: string | null }, options?: { video?: boolean }) => Promise<void>;
  resumePendingCall: (callId: string) => void;
  markRemoteAudioPlayback: (state: { srcObjectAssigned: boolean; playStatus: "idle" | "pending" | "success" | "failed" }) => void;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
}

interface IncomingPayload {
  callId: string;
  chatId: string;
  offer: RTCSessionDescriptionInit;
  fromUser: PeerUser;
  source?: "foreground" | "push";
  video?: boolean;
}

interface AnswerPayload {
  callId: string;
  chatId: string;
  answer: RTCSessionDescriptionInit;
}

interface IcePayload {
  callId: string;
  chatId: string;
  candidate: RTCIceCandidateInit;
}

interface CallAck {
  ok?: boolean;
  callId?: string;
  error?: string;
  delivery?: "foreground" | "push";
}

const CallContext = createContext<CallContextType | null>(null);

function getRtcConfig(): { config: RTCConfiguration; serverUrls: string[] } {
  const stunUrls = process.env.NEXT_PUBLIC_STUN_URLS
    ? process.env.NEXT_PUBLIC_STUN_URLS.split(",").map(u => u.trim()).filter(Boolean)
    : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];
  const iceServers: RTCIceServer[] = stunUrls.map((url) => ({ urls: url }));

  if (process.env.NEXT_PUBLIC_TURN_URLS) {
    const urls = process.env.NEXT_PUBLIC_TURN_URLS.split(",").map(u => u.trim());
    iceServers.push({
      urls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  } else if (process.env.NEXT_PUBLIC_TURN_URL) {
    iceServers.push({
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  const serverUrls = iceServers.flatMap(s => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  if (!process.env.NEXT_PUBLIC_TURN_URL && !process.env.NEXT_PUBLIC_TURN_URLS) {
    console.warn("[call-debug] TURN not configured; STUN-only may fail across NAT/mobile networks");
  }

  const config: RTCConfiguration = {
    iceServers,
    // Pre-gather a candidate so ICE connects faster once signaling completes.
    iceCandidatePoolSize: 1,
    bundlePolicy: "max-bundle",
  };
  if (process.env.NEXT_PUBLIC_FORCE_RELAY === "true") {
    config.iceTransportPolicy = "relay";
  }

  return { config, serverUrls };
}

function generateCallId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizePeerUser(user?: Partial<PeerUser> | null): PeerUser {
  return {
    id: user?.id,
    username: user?.username ?? null,
    displayName: user?.displayName || user?.username || "Собеседник",
    avatarUrl: user?.avatarUrl ?? null,
  };
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const [call, setCall] = useState<CurrentCall | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    callId: null,
    role: null,
    status: "idle",
    signalingState: null,
    connectionState: null,
    iceConnectionState: null,
    localAudioTracks: 0,
    remoteAudioTracks: 0,
    remoteStreamExists: false,
    iceServers: [],
    outboundBytes: 0,
    inboundBytes: 0,
    outboundPackets: 0,
    inboundPackets: 0,
    candidatePair: null,
    localCandidateType: null,
    remoteCandidateType: null,
    audioSrcObjectAssigned: false,
    audioPlayStatus: "idle",
    turnPresent: false,
    forceRelay: false,
    pushSource: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingLocalIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const canSendLocalIceRef = useRef(false);
  const currentCallRef = useRef<CurrentCall | null>(null);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const incomingVideoRef = useRef<boolean>(false);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const audioSrcObjectAssignedRef = useRef(false);
  const remoteAudioPlaybackOkRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const setCallStatus = useCallback((newStatus: CallStatus) => {
    setStatus(newStatus);
    setDebugInfo(prev => ({ ...prev, status: newStatus }));
  }, []);

  const debugCall = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_CALLS) return;
    console.log(`[call-debug] ${label}`, data);
  }, []);

  const updateDebugInfo = useCallback((updates: Partial<DebugInfo>) => {
    setDebugInfo(prev => ({ ...prev, ...updates }));
  }, []);

  const clearCallTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopStatsInterval = useCallback(() => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
  }, []);

  const startStatsInterval = useCallback(() => {
    stopStatsInterval();
    statsIntervalRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState === "closed") return;

      try {
        const stats = await pc.getStats();
        let outboundBytes = 0;
        let inboundBytes = 0;
        let outboundPackets = 0;
        let inboundPackets = 0;
        let candidatePair = null;
        let localCandidateType = null;
        let remoteCandidateType = null;

        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") {
            outboundBytes = report.bytesSent || 0;
            outboundPackets = report.packetsSent || 0;
          }
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            inboundBytes = report.bytesReceived || 0;
            inboundPackets = report.packetsReceived || 0;
          }
          if (report.type === "transport") {
            const selectedPairId = report.selectedCandidatePairId;
            if (selectedPairId) {
              const pairReport = stats.get(selectedPairId);
              if (pairReport) {
                candidatePair = `${pairReport.state}`;
                const localId = pairReport.localCandidateId;
                const remoteId = pairReport.remoteCandidateId;
                if (localId) localCandidateType = stats.get(localId)?.candidateType;
                if (remoteId) remoteCandidateType = stats.get(remoteId)?.candidateType;
              }
            }
          }
        });

        updateDebugInfo({
          outboundBytes,
          inboundBytes,
          outboundPackets,
          inboundPackets,
          candidatePair,
          localCandidateType,
          remoteCandidateType,
        });
      } catch {
        // ignore stats errors
      }
    }, 2000);
  }, [stopStatsInterval, updateDebugInfo]);

  const cleanup = useCallback((reason: string) => {
    debugCall("cleanup", { reason });
    clearCallTimer();
    stopStatsInterval();

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onsignalingstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingIceCandidatesRef.current = [];
    pendingLocalIceCandidatesRef.current = [];
    canSendLocalIceRef.current = false;
    currentCallRef.current = null;
    incomingOfferRef.current = null;
    incomingVideoRef.current = false;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    cameraTrackRef.current = null;
    audioSrcObjectAssignedRef.current = false;
    remoteAudioPlaybackOkRef.current = false;

    setCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsVideo(false);
    setIsScreenSharing(false);
    updateDebugInfo({
      callId: null,
      role: null,
      signalingState: null,
      connectionState: null,
      iceConnectionState: null,
      localAudioTracks: 0,
      remoteAudioTracks: 0,
      remoteStreamExists: false,
      outboundBytes: 0,
      inboundBytes: 0,
      outboundPackets: 0,
      inboundPackets: 0,
      candidatePair: null,
      localCandidateType: null,
      remoteCandidateType: null,
      audioSrcObjectAssigned: false,
      audioPlayStatus: "idle",
      pushSource: null,
    });
  }, [clearCallTimer, debugCall, stopStatsInterval, updateDebugInfo]);

  const failCall = useCallback((message: string) => {
    debugCall("call failed", { message });
    setError(message);
    setStatus("failed");
    setTimeout(() => {
      cleanup("failed");
      setCallStatus("idle");
      setError(null);
    }, 2500);
  }, [cleanup, debugCall, setCallStatus]);

  const verifyAndSetActive = useCallback((source: string) => {
    const pc = pcRef.current;
    if (!pc) return;

    const isConnected = pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
    const hasRemoteAudio = (remoteStreamRef.current?.getAudioTracks().length ?? 0) > 0;

    debugCall("verifyAndSetActive", { source, isConnected, hasRemoteAudio, connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState });

    // The call is established once the peer connection is up and remote audio is flowing.
    // Audio element playback (autoplay policy) is handled separately via tap-to-play and must
    // not gate the call state, otherwise a blocked autoplay leaves the call stuck "connecting".
    if (isConnected && hasRemoteAudio) {
      clearCallTimer();
      setStatus((current) => {
        if (current === "idle" || current === "ended" || current === "failed" || current === "active") {
          return current;
        }
        debugCall("status active confirmed", { source });
        setDebugInfo(prev => ({ ...prev, status: "active" }));
        return "active";
      });
    }
  }, [clearCallTimer, debugCall]);

  const scheduleMediaTimeout = useCallback((callId: string, customMessage?: string, timeoutMs: number = CALL_TIMEOUT_MS) => {
    clearCallTimer();
    timeoutRef.current = setTimeout(() => {
      if (currentCallRef.current?.callId === callId && (statusRef.current === "connecting" || statusRef.current === "outgoing")) {
        const pc = pcRef.current;
        const connected = !!pc && (
          pc.connectionState === "connected" ||
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        );
        // Only keep waiting if the peer connection is genuinely established —
        // then let verifyAndSetActive flip us to "active". A remote audio *track*
        // existing is NOT enough: ontrack can fire before/without a working media
        // path (e.g. dead TURN across networks), which previously left the call
        // stuck on "Соединение..." forever. If we're not connected, fail clearly.
        if (connected) {
          debugCall("media timeout: connection established, confirming active", { callId });
          verifyAndSetActive("media-timeout-connected");
          return;
        }
        failCall(customMessage || "Не удалось установить соединение");
      }
    }, timeoutMs);
  }, [clearCallTimer, debugCall, failCall, verifyAndSetActive]);

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection, reason: string) => {
    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    debugCall("remote ice flushed count", { reason, count: queued.length });

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
        debugCall("remote ice added", { queued: true, ok: true });
      } catch (iceError) {
        debugCall("remote ice added", { queued: true, ok: false, error: String(iceError) });
      }
    }
  }, [debugCall]);

  const sendIceCandidate = useCallback((callId: string, chatId: string, candidate: RTCIceCandidateInit) => {
    socket.emit("call:ice-candidate", { callId, chatId, candidate }, (ack?: CallAck) => {
      debugCall("ice sent ack", { callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
    });
  }, [debugCall, socket]);

  const flushPendingLocalIce = useCallback((callId: string, chatId: string, reason: string) => {
    const queued = [...pendingLocalIceCandidatesRef.current];
    pendingLocalIceCandidatesRef.current = [];
    debugCall("local ice flushed count", { callId, reason, count: queued.length });
    queued.forEach((candidate) => sendIceCandidate(callId, chatId, candidate));
  }, [debugCall, sendIceCandidate]);

  const handleRemoteTrack = useCallback((event: RTCTrackEvent) => {
    debugCall("ontrack kind", {
      kind: event.track.kind,
      readyState: event.track.readyState,
      streams: event.streams.length,
    });

    if (event.track.kind !== "audio" && event.track.kind !== "video") {
      return;
    }

    let stream = event.streams[0] ?? remoteStreamRef.current;
    if (!stream) {
      stream = new MediaStream();
    }

    if (!stream.getTracks().some((track) => track.id === event.track.id)) {
      stream.addTrack(event.track);
    }

    // A new MediaStream reference forces dependent <video>/<audio> elements to re-bind.
    const merged = new MediaStream(stream.getTracks());
    remoteStreamRef.current = merged;
    setRemoteStream(merged);
    const audioCount = merged.getAudioTracks().length;
    debugCall("remoteStream tracks count", { audio: audioCount, video: merged.getVideoTracks().length });
    updateDebugInfo({ remoteAudioTracks: audioCount, remoteStreamExists: true });

    if (audioCount > 0) {
      verifyAndSetActive("remote-audio-track");
    }
  }, [debugCall, updateDebugInfo, verifyAndSetActive]);

  const createPeerConnection = useCallback((callId: string, chatId: string, role: CallRole) => {
    const { config, serverUrls } = getRtcConfig();
    const pc = new RTCPeerConnection(config);
    pcRef.current = pc;
    debugCall("pc created role", { callId, chatId, role });

    // NB: do NOT pre-create a transceiver here. addLocalTracks uses addTrack(),
    // which creates a sendrecv transceiver for the caller and — crucially — on the
    // callee REUSES the recvonly transceiver that setRemoteDescription(offer) created,
    // flipping it to sendrecv. Pre-adding a transceiver here caused the callee's
    // outgoing audio to end up on a mismatched/recvonly m-line → one-way audio.

    updateDebugInfo({
      callId, 
      role, 
      iceServers: serverUrls,
      turnPresent: serverUrls.some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
      forceRelay: config.iceTransportPolicy === "relay",
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const candidate = event.candidate.toJSON();
      debugCall("local ICE candidate generated");
      if (!canSendLocalIceRef.current) {
        pendingLocalIceCandidatesRef.current.push(candidate);
        debugCall("local ICE queued before call:start ack", { count: pendingLocalIceCandidatesRef.current.length });
        return;
      }

      sendIceCandidate(callId, chatId, candidate);
    };

    pc.ontrack = handleRemoteTrack;

    pc.onconnectionstatechange = () => {
      debugCall("connectionState", { state: pc.connectionState });
      updateDebugInfo({ connectionState: pc.connectionState });
      if (pc.connectionState === "connected") {
        verifyAndSetActive("connectionState-connected");
      } else if (pc.connectionState === "failed") {
        failCall("Сбой соединения");
      }
    };

    pc.oniceconnectionstatechange = () => {
      debugCall("iceConnectionState", { state: pc.iceConnectionState });
      updateDebugInfo({ iceConnectionState: pc.iceConnectionState });
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        verifyAndSetActive(`iceConnectionState-${pc.iceConnectionState}`);
      } else if (pc.iceConnectionState === "failed") {
        failCall("Не удалось установить соединение");
      }
    };

    pc.onsignalingstatechange = () => {
      debugCall("signalingState", { state: pc.signalingState });
      updateDebugInfo({ signalingState: pc.signalingState });
    };

    startStatsInterval();
    return pc;
  }, [debugCall, failCall, handleRemoteTrack, sendIceCandidate, startStatsInterval, updateDebugInfo, verifyAndSetActive]);

  const acquireLocalAudio = useCallback(async (source: string, withVideo = false) => {
    debugCall("getUserMedia start", { source, withVideo });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: withVideo
          ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
      });
      const audioTracks = stream.getAudioTracks();
      debugCall("local audio tracks count", { source, count: audioTracks.length });

      const audioTrack = audioTracks[0];
      if (!audioTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("NO_AUDIO_TRACK");
      }

      audioTrack.enabled = true;
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.enabled = true;
      debugCall("local track enabled readyState", {
        source,
        enabled: audioTrack.enabled,
        readyState: audioTrack.readyState,
        video: Boolean(videoTrack),
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      updateDebugInfo({ localAudioTracks: audioTracks.length });
      return stream;
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
        throw new Error("PERMISSION_DENIED");
      }
      throw err;
    }
  }, [debugCall, updateDebugInfo]);

  const addLocalTracks = useCallback((pc: RTCPeerConnection, stream: MediaStream, source: string) => {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      debugCall("no audio track found to add", { source });
      return;
    }

    // If a sender already carries an audio track (defensive: avoid double-add), swap it.
    const existingSender = pc.getSenders().find((s) => s.track && s.track.kind === "audio");
    if (existingSender) {
      debugCall("replaceTrack on existing audio sender", { source });
      void existingSender.replaceTrack(audioTrack);
    } else {
      // addTrack creates a sendrecv transceiver (caller) or reuses the recvonly one
      // created by setRemoteDescription(offer) and flips it to sendrecv (callee).
      debugCall("addTrack", { source });
      pc.addTrack(audioTrack, stream);
    }

    // Add the video track too (if this is a video call).
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const existingVideoSender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (existingVideoSender) {
        void existingVideoSender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, stream);
      }
      debugCall("video track added", { source });
    }

    // Belt-and-suspenders: make sure our send transceivers actually send.
    for (const t of pc.getTransceivers()) {
      const kind = t.sender.track?.kind;
      if ((kind === "audio" || kind === "video") && t.direction !== "sendrecv") {
        try { t.direction = "sendrecv"; } catch { /* direction may be immutable in some states */ }
      }
    }

    debugCall("pc.getSenders audio count after addLocalTracks", {
      source,
      count: pc.getSenders().filter((sender) => sender.track?.kind === "audio").length,
    });
  }, [debugCall]);

  const startCall = useCallback(async (chatId: string, peerUser?: { displayName: string; avatarUrl: string | null }, options?: { video?: boolean }) => {
    if (statusRef.current !== "idle") return;

    const wantVideo = options?.video === true;
    const callId = generateCallId();
    const nextCall: CurrentCall = {
      callId,
      chatId,
      role: "caller",
      peerUser: normalizePeerUser(peerUser),
      video: wantVideo,
    };

    debugCall("startCall", { chatId, video: wantVideo });
    debugCall("generated callId", { callId });
    currentCallRef.current = nextCall;
    setCall(nextCall);
    setIsVideo(wantVideo);
    setIsCameraOff(false);
    setCallStatus("outgoing");
    setError(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    pendingIceCandidatesRef.current = [];
    pendingLocalIceCandidatesRef.current = [];
    canSendLocalIceRef.current = false;

    try {
      const stream = await acquireLocalAudio("startCall", wantVideo);
      const pc = createPeerConnection(callId, chatId, "caller");
      addLocalTracks(pc, stream, "startCall");

      const offer = await pc.createOffer();
      debugCall("offer created", { callId });
      await pc.setLocalDescription(offer);
      debugCall("setLocalDescription offer", { callId });

      socket.emit("call:start", { callId, chatId, offer, video: wantVideo }, (ack?: CallAck & { peerUser?: PeerUser }) => {
        debugCall("call:start ack", { callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
        if (!ack?.ok) {
          if (ack?.error === "USER_OFFLINE" || ack?.error === "USER_UNREACHABLE") {
            failCall("Пользователь недоступен");
          } else {
            failCall("Не удалось начать звонок");
          }
          return;
        }
        debugCall("call delivery mode", { delivery: ack.delivery ?? "foreground" });
        canSendLocalIceRef.current = true;
        flushPendingLocalIce(callId, chatId, "call:start ack");
        scheduleMediaTimeout(callId, "Собеседник не ответил", 45000);
      });
    } catch (startError: unknown) {
      debugCall("startCall failed", { error: String(startError) });
      const err = startError as Error;
      if (err.message === "PERMISSION_DENIED") {
        failCall(wantVideo ? "Нет доступа к камере/микрофону. Разрешите их в настройках браузера." : "Нет доступа к микрофону. Разрешите микрофон в настройках браузера.");
      } else if (err.message === "NO_AUDIO_TRACK") {
        failCall("Микрофон недоступен");
      } else {
        failCall("Ошибка при запуске звонка");
      }
    }
  }, [acquireLocalAudio, addLocalTracks, createPeerConnection, debugCall, failCall, flushPendingLocalIce, scheduleMediaTimeout, setCallStatus, socket]);

  const acceptCall = useCallback(async () => {
    const current = currentCallRef.current;
    const offer = incomingOfferRef.current;
    if (!current || current.role !== "callee" || !offer || statusRef.current !== "incoming") {
      return;
    }

    debugCall("acceptCall", { callId: current.callId, chatId: current.chatId });
    setCallStatus("connecting");
    setError(null);

    try {
      const stream = await acquireLocalAudio("acceptCall", incomingVideoRef.current);
      const pc = createPeerConnection(current.callId, current.chatId, "callee");

      // Order matters: apply the remote offer first so the audio transceiver exists,
      // THEN attach our local track (addTrack reuses that transceiver as sendrecv).
      // Adding the track before setRemoteDescription left the callee sending nothing.
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      debugCall("setRemoteDescription offer", { callId: current.callId });
      addLocalTracks(pc, stream, "acceptCall");
      await flushPendingIce(pc, "after-setRemoteDescription-offer");

      const answer = await pc.createAnswer();
      debugCall("answer created", { callId: current.callId });
      await pc.setLocalDescription(answer);
      debugCall("setLocalDescription answer", { callId: current.callId });

      socket.emit("call:answer", { callId: current.callId, chatId: current.chatId, answer }, (ack?: CallAck) => {
        debugCall("call:answer ack", { callId: current.callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
        if (!ack?.ok) {
          failCall("Не удалось принять звонок");
          return;
        }
        canSendLocalIceRef.current = true;
        flushPendingLocalIce(current.callId, current.chatId, "call:answer ack");
        scheduleMediaTimeout(current.callId, "Не удалось установить аудио собеседника", 15000);
      });
    } catch (acceptError: unknown) {
      debugCall("acceptCall failed", { error: String(acceptError) });
      const err = acceptError as Error;
      socket.emit("call:declined", { callId: current.callId, chatId: current.chatId, reason: "media_error" });
      if (err.message === "PERMISSION_DENIED") {
        failCall("Нет доступа к микрофону. Разрешите микрофон в настройках браузера.");
      } else {
        failCall("Ошибка при ответе на звонок");
      }
    }
  }, [acquireLocalAudio, addLocalTracks, createPeerConnection, debugCall, failCall, flushPendingIce, flushPendingLocalIce, scheduleMediaTimeout, setCallStatus, socket]);

  const declineCall = useCallback(() => {
    const current = currentCallRef.current;
    if (current) {
      socket.emit("call:declined", { callId: current.callId, chatId: current.chatId }, (ack?: CallAck) => {
        debugCall("call:declined ack", { callId: current.callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
      });
    }
    cleanup("declined");
    setCallStatus("idle");
  }, [cleanup, debugCall, setCallStatus, socket]);

  const endCall = useCallback(() => {
    const current = currentCallRef.current;
    if (current) {
      socket.emit("call:ended", { callId: current.callId, chatId: current.chatId, reason: "user_ended" }, (ack?: CallAck) => {
        debugCall("call:ended ack", { callId: current.callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
      });
    }
    cleanup("ended");
    setCallStatus("idle");
  }, [cleanup, debugCall, setCallStatus, socket]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMuted(!track.enabled);
    debugCall("mute toggled", { enabled: track.enabled });
  }, [debugCall]);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsCameraOff(!track.enabled);
    debugCall("camera toggled", { enabled: track.enabled });
  }, [debugCall]);

  const restoreCameraInLocalStream = useCallback((cam: MediaStreamTrack) => {
    const ls = localStreamRef.current;
    if (!ls) return;
    ls.getVideoTracks().forEach((t) => { if (t !== cam) ls.removeTrack(t); });
    if (!ls.getVideoTracks().includes(cam)) ls.addTrack(cam);
    setLocalStream(new MediaStream(ls.getTracks()));
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (!videoSender) {
      setError("Демонстрация доступна только в видеозвонке");
      setTimeout(() => setError(null), 2500);
      return;
    }

    // Already sharing → stop and restore the camera (replaceTrack needs no renegotiation).
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
      const cam = cameraTrackRef.current;
      if (cam && cam.readyState === "live") {
        await videoSender.replaceTrack(cam).catch(() => undefined);
        restoreCameraInLocalStream(cam);
      }
      setIsScreenSharing(false);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) return;
      cameraTrackRef.current = videoSender.track ?? null; // keep camera alive for restore
      screenTrackRef.current = screenTrack;
      await videoSender.replaceTrack(screenTrack);
      const ls = localStreamRef.current;
      if (ls) {
        ls.getVideoTracks().forEach((t) => ls.removeTrack(t));
        ls.addTrack(screenTrack);
        setLocalStream(new MediaStream(ls.getTracks()));
      }
      // Browser "Stop sharing" button ends the track — restore the camera then.
      screenTrack.onended = () => {
        screenTrackRef.current = null;
        const cam = cameraTrackRef.current;
        if (cam && cam.readyState === "live") {
          void videoSender.replaceTrack(cam).catch(() => undefined);
          restoreCameraInLocalStream(cam);
        }
        setIsScreenSharing(false);
      };
      setIsScreenSharing(true);
    } catch {
      // user cancelled the share picker / denied — no-op
    }
  }, [restoreCameraInLocalStream]);

  const markRemoteAudioPlayback = useCallback((state: {
    srcObjectAssigned: boolean;
    playStatus: "idle" | "pending" | "success" | "failed";
  }) => {
    audioSrcObjectAssignedRef.current = state.srcObjectAssigned;
    remoteAudioPlaybackOkRef.current = state.playStatus === "success";
    updateDebugInfo({
      audioSrcObjectAssigned: state.srcObjectAssigned,
      audioPlayStatus: state.playStatus,
    });
    if (state.srcObjectAssigned && state.playStatus === "success") {
      verifyAndSetActive("remote-audio-playback");
    }
  }, [updateDebugInfo, verifyAndSetActive]);

  const applyIncomingCall = useCallback(({ callId, chatId, offer, fromUser, source = "foreground", video = false }: IncomingPayload) => {
      debugCall("incoming received", { callId, chatId, status: statusRef.current, video });
      if (statusRef.current !== "idle") {
        socket.emit("call:declined", { callId, chatId, reason: "busy" });
        return false;
      }

      const nextCall: CurrentCall = {
        callId,
        chatId,
        role: "callee",
        peerUser: normalizePeerUser(fromUser),
        video,
      };

      currentCallRef.current = nextCall;
      incomingOfferRef.current = offer;
      incomingVideoRef.current = video;
      pendingIceCandidatesRef.current = [];
      remoteStreamRef.current = null;
      setRemoteStream(null);
      setError(null);
      setCall(nextCall);
      setIsVideo(video);
      setIsCameraOff(false);
      setCallStatus("incoming");
      updateDebugInfo({ pushSource: source });
      return true;
  }, [debugCall, setCallStatus, socket, updateDebugInfo]);

  const resumePendingCall = useCallback((callId: string) => {
    if (!callId || statusRef.current !== "idle") return;
    debugCall("resume pending call", { callId });
    setError(null);
    socket.connect();
    socket.emit("call:resume-pending", { callId }, (ack?: CallAck & { call?: IncomingPayload }) => {
      debugCall("call:resume-pending ack", { callId, ok: Boolean(ack?.ok), error: ack?.error ?? null });
      if (!ack?.ok) {
        const message = ack?.error === "CALL_EXPIRED" || ack?.error === "CALL_NOT_FOUND"
          ? "Вызов уже завершён"
          : "Не удалось открыть входящий вызов";
        setError(message);
        setCallStatus("failed");
        setTimeout(() => {
          setError(null);
          setCallStatus("idle");
        }, 2500);
        return;
      }
    });
  }, [debugCall, setCallStatus, socket]);

  useEffect(() => {
    const handleIncoming = (payload: IncomingPayload) => {
      applyIncomingCall(payload);
    };

    const handleAnswer = async ({ callId, answer }: AnswerPayload) => {
      const current = currentCallRef.current;
      if (!current || current.callId !== callId || current.role !== "caller") {
        debugCall("answer ignored", { callId, currentCallId: current?.callId ?? null });
        return;
      }

      debugCall("answer received by caller", { callId });
      const pc = pcRef.current;
      if (!pc) return;

      try {
        setCallStatus("connecting");
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        debugCall("setRemoteDescription answer", { callId });
        await flushPendingIce(pc, "after-setRemoteDescription-answer");
        scheduleMediaTimeout(callId, "Не удалось установить аудио собеседника", 15000);
      } catch (answerError) {
        debugCall("setRemoteDescription answer failed", { callId, error: String(answerError) });
        failCall("Ошибка при установке соединения");
      }
    };

    const handleIceCandidate = async ({ callId, candidate }: IcePayload) => {
      const current = currentCallRef.current;
      if (!current || current.callId !== callId) {
        debugCall("remote ICE received but ignored", { callId, currentCallId: current?.callId ?? null });
        return;
      }

      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        debugCall("remote ICE queued because no remoteDescription", { callId, count: pendingIceCandidatesRef.current.length });
        return;
      }

      try {
        await pc.addIceCandidate(candidate);
        debugCall("remote ICE added", { callId, ok: true });
      } catch (iceError) {
        debugCall("remote ICE added", { callId, ok: false, error: String(iceError) });
      }
    };

    const handleEnded = ({ callId, reason }: { callId: string; reason?: string }) => {
      const current = currentCallRef.current;
      if (!current || current.callId !== callId) return;
      debugCall("remote ended", { callId, reason: reason ?? null });
      cleanup(`remote-ended:${reason ?? "ended"}`);
      if (reason === "expired") {
        setError("Нет ответа");
        setCallStatus("failed");
        setTimeout(() => {
          setError(null);
          setCallStatus("idle");
        }, 2500);
        return;
      }
      setCallStatus("idle");
    };

    const handleDeclined = ({ callId }: { callId: string }) => {
      const current = currentCallRef.current;
      if (!current || current.callId !== callId) return;
      debugCall("remote declined", { callId });
      cleanup("remote-declined");
      setCallStatus("idle");
    };

    socket.on("call:incoming", handleIncoming);
    socket.on("call:answer", handleAnswer);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:ended", handleEnded);
    socket.on("call:declined", handleDeclined);

    return () => {
      socket.off("call:incoming", handleIncoming);
      socket.off("call:answer", handleAnswer);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:ended", handleEnded);
      socket.off("call:declined", handleDeclined);
    };
  }, [applyIncomingCall, cleanup, debugCall, failCall, flushPendingIce, scheduleMediaTimeout, setCallStatus, socket]);

  return (
    <CallContext.Provider
      value={{
        call,
        status,
        localStream,
        remoteStream,
        isMuted,
        isCameraOff,
        isVideo,
        isScreenSharing,
        error,
        debugInfo,
        startCall,
        resumePendingCall,
        markRemoteAudioPlayback,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleCamera,
        toggleScreenShare,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useAudioCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useAudioCall must be used within CallProvider");
  return context;
}
