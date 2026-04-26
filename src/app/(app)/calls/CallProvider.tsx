"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useSocket } from "@/hooks/useSocket";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";

type CallStatus = "idle" | "ringing" | "connecting" | "active" | "ended" | "failed";
type CallRole = "caller" | "callee";

interface CallMetadata {
  callId: string;
  chatId: string;
  role: CallRole;
  user: {
    displayName: string;
    avatarUrl: string | null;
  };
}

interface CallContextType {
  call: CallMetadata | null;
  status: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  error: string | null;
  startCall: (chatId: string, fromUser?: { displayName: string, avatarUrl: string | null }) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

const CallContext = createContext<CallContextType | null>(null);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface IncomingPayload {
  callId: string;
  chatId: string;
  offer: RTCSessionDescriptionInit;
  fromUser: { displayName: string, avatarUrl: string | null };
  expiresAt?: number;
}

interface AnsweredPayload {
  callId?: string;
  chatId?: string;
  answer: RTCSessionDescriptionInit;
}

interface IcePayload {
  callId?: string;
  candidate: RTCIceCandidateInit;
}

interface EndedPayload {
  callId?: string;
  reason: string;
}

interface StartCallResponse {
  ok: boolean;
  callId: string;
  expiresAt?: number;
  delivery?: "socket" | "push";
  callee?: {
    displayName: string;
    avatarUrl: string | null;
  };
}

interface SyncPendingResponse {
  ok: boolean;
  emitted?: number;
  expiredIncomingCallId?: boolean;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const [call, setCall] = useState<CallMetadata | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceQueue = useRef<RTCIceCandidateInit[]>([]);
  const pendingLocalIceQueue = useRef<RTCIceCandidateInit[]>([]);
  const receivedIceKeysRef = useRef<Set<string>>(new Set());
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const callIdRef = useRef<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const hasRemoteAudioRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const debugCall = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_CALLS) return;
    console.log(`[call-debug] ${label}`, data);
  }, []);

  const cleanup = useCallback((reason?: string) => {
    debugCall("cleanup", { reason: reason || "none" });
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    setCall(null);
    setStatus("idle");
    setLocalStream(null);
    setRemoteStream(null);
    pendingIceQueue.current = [];
    pendingLocalIceQueue.current = [];
    receivedIceKeysRef.current = new Set();
    incomingOfferRef.current = null;
    setIsMuted(false);
    remoteStreamRef.current = null;
    callIdRef.current = null;
    chatIdRef.current = null;
    hasRemoteAudioRef.current = false;
  }, [debugCall]);

  const failCall = useCallback((err: string) => {
    debugCall("call failed", { error: err });
    setError(err);
    setStatus("failed");
    setTimeout(() => {
      cleanup();
      setError(null);
    }, 3000);
  }, [cleanup, debugCall]);

  const setStatusActiveFromSignal = useCallback((signal: string) => {
    setStatus((current) => {
      if (current === "idle" || current === "failed" || current === "ended") {
        return current;
      }
      if (current !== "active") {
        debugCall("status set active", { signal, previousStatus: current });
      }
      return "active";
    });
  }, [debugCall]);

  const flushPendingLocalIce = useCallback((reason: string) => {
    if (!socket || !callIdRef.current || !chatIdRef.current || pendingLocalIceQueue.current.length === 0) {
      return;
    }

    const queuedCandidates = [...pendingLocalIceQueue.current];
    pendingLocalIceQueue.current = [];
    debugCall("ICE flushed", { reason, count: queuedCandidates.length });

    for (const candidate of queuedCandidates) {
      socket.emit("call:ice-candidate", { callId: callIdRef.current, chatId: chatIdRef.current, candidate }, (response?: { ok?: boolean }) => {
        debugCall("ICE added", { direction: "outgoing", ok: response?.ok ?? null });
      });
    }
  }, [socket, debugCall]);

  const flushPendingRemoteIce = useCallback(async (pc: RTCPeerConnection, reason: string) => {
    if (pendingIceQueue.current.length === 0) {
      return;
    }

    const queuedCandidates = [...pendingIceQueue.current];
    pendingIceQueue.current = [];
    debugCall("ICE flushed", { reason, count: queuedCandidates.length });

    for (const candidate of queuedCandidates) {
      try {
        await pc.addIceCandidate(candidate);
        debugCall("ICE added", { direction: "incoming", ok: true });
      } catch (error) {
        debugCall("ICE added", { direction: "incoming", ok: false, error: String(error) });
      }
    }
  }, [debugCall]);

  const createPeerConnection = useCallback((role: CallRole) => {
    debugCall("peer connection created", { role });
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      const currentCallId = callIdRef.current;
      const currentChatId = chatIdRef.current;
      const candidate = event.candidate.toJSON();
      if (!socket || !currentCallId || !currentChatId) {
        pendingLocalIceQueue.current.push(candidate);
        debugCall("ICE queued", { direction: "outgoing", queuedCount: pendingLocalIceQueue.current.length });
        return;
      }

      socket.emit("call:ice-candidate", { callId: currentCallId, chatId: currentChatId, candidate }, (response?: { ok?: boolean }) => {
        debugCall("ICE added", { direction: "outgoing", ok: response?.ok ?? null });
      });
    };

    pc.ontrack = (event) => {
      debugCall("ontrack event", {
        trackKind: event.track.kind,
        trackReadyState: event.track.readyState,
        streamsLength: event.streams.length,
      });

      if (event.track.kind !== "audio") {
        return;
      }

      let targetStream = event.streams[0] ?? remoteStreamRef.current;
      if (!targetStream) {
        targetStream = new MediaStream();
      }

      const hasTrack = targetStream.getAudioTracks().some((track) => track.id === event.track.id);
      if (!hasTrack) {
        targetStream.addTrack(event.track);
      }

      remoteStreamRef.current = targetStream;
      setRemoteStream(targetStream);

      debugCall("ontrack audio received", {
        trackReadyState: event.track.readyState,
        streamsLength: event.streams.length,
      });
      debugCall("remoteStream audio tracks count", {
        count: targetStream.getAudioTracks().length,
      });

      if (!hasRemoteAudioRef.current) {
        hasRemoteAudioRef.current = true;
        setStatusActiveFromSignal("remote-audio-track");
      }

      event.track.onmute = () => {
        debugCall("remote track muted", { trackId: event.track.id, readyState: event.track.readyState });
      };

      event.track.onunmute = () => {
        debugCall("remote track unmuted", { trackId: event.track.id, readyState: event.track.readyState });
      };

      event.track.onended = () => {
        debugCall("remote track ended", { trackId: event.track.id, readyState: event.track.readyState });
      };
    };

    pc.onconnectionstatechange = () => {
      debugCall("connectionState", { state: pc.connectionState });
      if (pc.connectionState === "connected") {
        setStatusActiveFromSignal("connectionState-connected");
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanup("connection failed");
      }
    };

    pc.oniceconnectionstatechange = () => {
      debugCall("iceConnectionState", { state: pc.iceConnectionState });
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setStatusActiveFromSignal(`iceConnectionState-${pc.iceConnectionState}`);
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, cleanup, debugCall, setStatusActiveFromSignal]);

  const debugLocalAudioTrack = useCallback((track: MediaStreamTrack | undefined, source: "startCall" | "acceptCall") => {
    if (!track) {
      debugCall("local audio track state", { source, exists: false });
      return;
    }

    track.onmute = () => {
      debugCall("local audio track muted", { source, readyState: track.readyState });
    };
    track.onunmute = () => {
      debugCall("local audio track unmuted", { source, readyState: track.readyState });
    };
    track.onended = () => {
      debugCall("local audio track ended", { source, readyState: track.readyState });
    };

    debugCall("local audio track state", {
      source,
      exists: true,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
    });
  }, [debugCall]);

  const startCall = useCallback(async (chatId: string, fromUser?: { displayName: string, avatarUrl: string | null }) => {
    if (statusRef.current !== "idle") return;
    debugCall("startCall", { chatId });
    setError(null);
    remoteStreamRef.current = null;
    setRemoteStream(null);
    incomingOfferRef.current = null;
    pendingIceQueue.current = [];
    pendingLocalIceQueue.current = [];
    receivedIceKeysRef.current = new Set();
    callIdRef.current = null;
    chatIdRef.current = chatId;
    hasRemoteAudioRef.current = false;
    setCall({
      callId: `pending-${Date.now()}`,
      chatId,
      role: "caller",
      user: { displayName: "Собеседник", avatarUrl: null }
    });
    setStatus("ringing");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      debugCall("local stream acquired", { source: "startCall", audioTracks: stream.getAudioTracks().length });
      debugLocalAudioTrack(stream.getAudioTracks()[0], "startCall");

      const pc = createPeerConnection("caller");
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      debugCall("addTrack senders count", {
        source: "startCall",
        count: pc.getSenders().filter((sender) => sender.track?.kind === "audio").length,
      });

      const offer = await pc.createOffer();
      debugCall("offer created");
      await pc.setLocalDescription(offer);

      socket?.emit("call:start", { chatId, offer, fromUser }, (response: StartCallResponse) => {
        if (response.ok) {
          callIdRef.current = response.callId;
          chatIdRef.current = chatId;
          debugCall("offer sent ack", { ok: true, callId: response.callId, delivery: response.delivery ?? "socket" });
          setCall((current) =>
            current
              ? {
                  ...current,
                  callId: response.callId,
                  user: response.callee ?? current.user,
                }
              : {
                  callId: response.callId,
                  chatId,
                  role: "caller",
                  user: response.callee ?? { displayName: "Собеседник", avatarUrl: null },
                },
          );
          flushPendingLocalIce("call:start ack");

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }
          const timeoutMs = response.expiresAt ? Math.max(1000, response.expiresAt - Date.now()) : 45000;
          timeoutRef.current = setTimeout(() => {
            if (statusRef.current !== "active" && statusRef.current !== "idle") {
              debugCall("call timeout", { callId: response.callId });
              socket.emit("call:ended", { callId: response.callId, reason: "timeout" });
              failCall("Вызов пропущен");
            }
          }, timeoutMs);
        } else {
          debugCall("offer sent ack", { ok: false });
          failCall("Не удалось начать звонок");
        }
      });
    } catch (err) {
      console.error(err);
      failCall("Нет доступа к микрофону");
    }
  }, [socket, createPeerConnection, debugCall, failCall, flushPendingLocalIce, debugLocalAudioTrack]);

  const acceptCall = useCallback(async () => {
    if (!call || !incomingOfferRef.current || !socket) return;
    debugCall("acceptCall", { callId: call.callId });
    setStatus("connecting");
    callIdRef.current = call.callId;
    chatIdRef.current = call.chatId;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      debugCall("local stream acquired", { source: "acceptCall", audioTracks: stream.getAudioTracks().length });
      debugLocalAudioTrack(stream.getAudioTracks()[0], "acceptCall");

      const pc = createPeerConnection("callee");
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      debugCall("addTrack senders count", {
        source: "acceptCall",
        count: pc.getSenders().filter((sender) => sender.track?.kind === "audio").length,
      });

      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
      debugCall("setRemoteDescription success", { side: "callee", type: "offer" });

      await flushPendingRemoteIce(pc, "after offer remoteDescription");

      const answer = await pc.createAnswer();
      debugCall("answer created");
      await pc.setLocalDescription(answer);
      flushPendingLocalIce("after answer localDescription");

      socket.emit("call:answer", { 
        callId: call.callId, 
        chatId: call.chatId, 
        answer 
      }, (res: { ok: boolean }) => {
        debugCall("answer sent ack", { ok: res.ok });
        if (!res.ok) {
          failCall("Ошибка при ответе на звонок");
        }
      });
    } catch (err) {
      console.error(err);
      failCall("Ошибка доступа к микрофону");
      socket.emit("call:declined", { callId: call.callId });
    }
  }, [call, socket, createPeerConnection, debugCall, failCall, flushPendingRemoteIce, flushPendingLocalIce, debugLocalAudioTrack]);

  const declineCall = useCallback(() => {
    if (call && socket) {
      socket.emit("call:declined", { callId: call.callId });
    }
    cleanup("declined");
  }, [call, socket, cleanup]);

  const endCall = useCallback(() => {
    if (call && socket) {
      socket.emit("call:ended", { callId: call.callId, reason: "user_ended" });
    }
    cleanup("ended by user");
  }, [call, socket, cleanup]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onIncoming = ({ callId, chatId, offer, fromUser, expiresAt }: IncomingPayload) => {
      debugCall("incoming offer received", { callId, chatId });
      if (statusRef.current !== "idle") {
        socket.emit("call:declined", { callId, reason: "busy" });
        return;
      }
      setCall({
        callId,
        chatId,
        role: "callee",
        user: fromUser || { displayName: "Аноним", avatarUrl: null }
      });
      incomingOfferRef.current = offer;
      callIdRef.current = callId;
      chatIdRef.current = chatId;
      pendingIceQueue.current = [];
      pendingLocalIceQueue.current = [];
      receivedIceKeysRef.current = new Set();
      hasRemoteAudioRef.current = false;
      setStatus("ringing");

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const timeoutMs = expiresAt ? Math.max(1000, expiresAt - Date.now()) : 45000;
      timeoutRef.current = setTimeout(() => {
        if (statusRef.current === "ringing") {
          debugCall("call expired before answer", { callId });
          failCall("Вызов пропущен");
        }
      }, timeoutMs);
    };

    const onAnswered = async ({ answer, callId }: AnsweredPayload) => {
      debugCall("answer received by caller", { callId: callId ?? callIdRef.current });
      if (pcRef.current) {
        setStatus("connecting");
        if (callId) {
          callIdRef.current = callId;
        }
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        debugCall("setRemoteDescription success", { side: "caller", type: "answer" });
        await flushPendingRemoteIce(pcRef.current, "after answer remoteDescription");
        flushPendingLocalIce("after answer received");
      }
    };

    const onIce = async ({ candidate }: IcePayload) => {
      const candidateKey = JSON.stringify(candidate);
      if (receivedIceKeysRef.current.has(candidateKey)) {
        debugCall("ICE queued", { direction: "incoming", duplicate: true });
        return;
      }
      receivedIceKeysRef.current.add(candidateKey);

      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(candidate);
          debugCall("ICE added", { direction: "incoming", ok: true });
        } catch (error) {
          debugCall("ICE added", { direction: "incoming", ok: false, error: String(error) });
        }
      } else {
        debugCall("ICE queued", { direction: "incoming", queuedCount: pendingIceQueue.current.length + 1 });
        pendingIceQueue.current.push(candidate);
      }
    };

    const onEnded = ({ reason }: EndedPayload) => {
      debugCall("call ended by remote", { reason });
      if (reason === "expired" || reason === "timeout") {
        failCall("Вызов пропущен");
        return;
      }
      cleanup(`remote ended: ${reason}`);
    };

    const onDeclined = () => {
      debugCall("call declined by remote");
      cleanup("remote declined");
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:answered", onAnswered);
    socket.on("call:ice-candidate", onIce);
    socket.on("call:ended", onEnded);
    socket.on("call:declined", onDeclined);

    const incomingCallId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("incomingCallId");
    socket.emit("call:sync-pending", { incomingCallId }, (response: SyncPendingResponse) => {
      debugCall("pending calls synced", {
        emitted: response.emitted ?? 0,
        expiredIncomingCallId: Boolean(response.expiredIncomingCallId),
      });
      if (incomingCallId && response.expiredIncomingCallId && statusRef.current === "idle") {
        failCall("Вызов пропущен");
      }
    });

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:answered", onAnswered);
      socket.off("call:ice-candidate", onIce);
      socket.off("call:ended", onEnded);
      socket.off("call:declined", onDeclined);
    };
  }, [socket, cleanup, debugCall, failCall, flushPendingLocalIce, flushPendingRemoteIce]);

  return (
    <CallContext.Provider value={{
      call, status, localStream, remoteStream, isMuted, error,
      startCall, acceptCall, declineCall, endCall, toggleMute
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useAudioCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useAudioCall must be used within CallProvider");
  return context;
}
