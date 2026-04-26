"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  startCall: (chatId: string, fromUser?: { displayName: string; avatarUrl: string | null }) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

const CallContext = createContext<CallContextType | null>(null);

type SocketAck = {
  ok: boolean;
  error?: string;
};

type StartCallAck = SocketAck & {
  callId?: string;
  callee?: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

type IncomingCallPayload = {
  callId: string;
  chatId: string;
  offer: RTCSessionDescriptionInit;
  fromUser?: {
    displayName: string;
    avatarUrl: string | null;
  };
};

type AnsweredCallPayload = {
  callId: string;
  chatId: string;
  answer: RTCSessionDescriptionInit;
};

type IceCandidatePayload = {
  callId: string;
  chatId: string;
  candidate: RTCIceCandidateInit;
};

type CallEndedPayload = {
  reason?: string;
};

type CallDeclinedPayload = {
  reason?: string;
};

function buildRtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  if (
    process.env.NEXT_PUBLIC_TURN_URL &&
    process.env.NEXT_PUBLIC_TURN_USERNAME &&
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL
  ) {
    iceServers.push({
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return { iceServers };
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
  const callRef = useRef<CallMetadata | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingRemoteIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingLocalIceRef = useRef<RTCIceCandidateInit[]>([]);
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toneContextRef = useRef<AudioContext | null>(null);
  const toneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toneTypeRef = useRef<"ringback" | "incoming" | null>(null);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const debugCall = useCallback((event: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_CALLS) {
      return;
    }

    console.log("[call-debug]", {
      event,
      callId: callRef.current?.callId ?? null,
      chatId: callRef.current?.chatId ?? null,
      role: callRef.current?.role ?? null,
      callState: statusRef.current,
      signalingState: pcRef.current?.signalingState ?? null,
      iceConnectionState: pcRef.current?.iceConnectionState ?? null,
      connectionState: pcRef.current?.connectionState ?? null,
      hasLocalDescription: Boolean(pcRef.current?.localDescription),
      hasRemoteDescription: Boolean(pcRef.current?.remoteDescription),
      localTracksCount: localStreamRef.current?.getTracks().length ?? 0,
      remoteTracksCount: remoteStreamRef.current?.getTracks().length ?? 0,
      pendingIceCount: pendingRemoteIceRef.current.length,
      ...data,
    });
  }, []);

  const clearCallTimers = useCallback(() => {
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
      connectingTimeoutRef.current = null;
    }
  }, []);

  const stopTone = useCallback(() => {
    if (toneIntervalRef.current) {
      clearInterval(toneIntervalRef.current);
      toneIntervalRef.current = null;
    }
    toneTypeRef.current = null;
  }, []);

  const playTone = useCallback((type: "ringback" | "incoming") => {
    if (typeof window === "undefined" || toneTypeRef.current === type) {
      return;
    }

    stopTone();
    toneTypeRef.current = type;

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    try {
      if (!toneContextRef.current) {
        toneContextRef.current = new AudioCtx();
      }
    } catch {
      return;
    }

    const ctx = toneContextRef.current;
    if (!ctx) {
      return;
    }

    const scheduleBeep = () => {
      try {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;

        oscillator.type = "sine";
        oscillator.frequency.value = type === "ringback" ? 420 : 520;
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(type === "ringback" ? 0.03 : 0.05, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

        oscillator.start(now);
        oscillator.stop(now + 0.3);
      } catch (error) {
        debugCall("call:tone:error", { type, error: String(error) });
      }
    };

    scheduleBeep();
    toneIntervalRef.current = setInterval(scheduleBeep, type === "ringback" ? 1800 : 1400);
  }, [debugCall, stopTone]);

  const setCallState = useCallback((nextCall: CallMetadata | null, nextStatus: CallStatus) => {
    callRef.current = nextCall;
    statusRef.current = nextStatus;
    setCall(nextCall);
    setStatus(nextStatus);
  }, []);

  const cleanup = useCallback((reason = "cleanup") => {
    debugCall("call:cleanup", { reason });
    clearCallTimers();
    stopTone();

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    incomingOfferRef.current = null;
    pendingRemoteIceRef.current = [];
    pendingLocalIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setCallState(null, "idle");
  }, [clearCallTimers, debugCall, setCallState, stopTone]);

  const setFailed = useCallback((message: string) => {
    debugCall("call:failed", { message });
    stopTone();
    setError(message);
    statusRef.current = "failed";
    setStatus("failed");
    clearCallTimers();
    window.setTimeout(() => {
      cleanup("failed");
      setError(null);
    }, 3000);
  }, [clearCallTimers, cleanup, debugCall, stopTone]);

  const flushRemoteIce = useCallback(async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) {
      return;
    }

    while (pendingRemoteIceRef.current.length > 0) {
      const candidate = pendingRemoteIceRef.current.shift();
      if (!candidate) {
        continue;
      }

      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch (error) {
        debugCall("call:remote-ice:add-failed", { error: String(error) });
      }
    }
  }, [debugCall]);

  function emitPendingLocalIce() {
    if (!socket || !callRef.current?.callId || !callRef.current?.chatId) {
      return;
    }

    const queued = [...pendingLocalIceRef.current];
    pendingLocalIceRef.current = [];

    queued.forEach((candidate) => {
      socket.emit(
        "call:ice-candidate",
        {
          callId: callRef.current?.callId,
          chatId: callRef.current?.chatId,
          candidate,
        },
        (response: SocketAck) => {
          if (!response?.ok) {
            debugCall("call:ice-candidate:ack-failed", { error: response?.error ?? "unknown" });
          }
        },
      );
    });
  }

  const scheduleConnectingTimeout = useCallback(() => {
    if (connectingTimeoutRef.current) {
      clearTimeout(connectingTimeoutRef.current);
    }

    connectingTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "connecting") {
        setFailed("Не удалось установить соединение");
        if (callRef.current?.callId) {
          socket?.emit("call:ended", {
            callId: callRef.current.callId,
            reason: "connection_timeout",
          });
        }
      }
    }, 45000);
  }, [setFailed, socket]);

  function createPeerConnection(role: CallRole) {
    const pc = new RTCPeerConnection(buildRtcConfig());
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      debugCall("call:ice:local");
      if (!socket || !callRef.current?.callId || !callRef.current?.chatId) {
        pendingLocalIceRef.current.push(event.candidate.toJSON());
        return;
      }

      socket.emit(
        "call:ice-candidate",
        {
          callId: callRef.current.callId,
          chatId: callRef.current.chatId,
          candidate: event.candidate.toJSON(),
        },
        (response: SocketAck) => {
          if (!response?.ok) {
            debugCall("call:ice-candidate:ack-failed", { error: response?.error ?? "unknown" });
          }
        },
      );
    };

    pc.ontrack = (event) => {
      debugCall("call:remote-track", { remoteTracksCount: event.streams[0]?.getTracks().length ?? 0 });
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      event.streams[0]?.getTracks().forEach((track) => {
        const exists = remoteStreamRef.current?.getTracks().some((existing) => existing.id === track.id);
        if (!exists) {
          remoteStreamRef.current?.addTrack(track);
        }
      });

      if (!event.streams[0] && !remoteStreamRef.current.getTracks().some((track) => track.id === event.track.id)) {
        remoteStreamRef.current.addTrack(event.track);
      }

      setRemoteStream(remoteStreamRef.current);
      if (statusRef.current === "connecting" || statusRef.current === "ringing") {
        setStatus("active");
        statusRef.current = "active";
      }
    };

    pc.onconnectionstatechange = () => {
      debugCall("call:connection-state", { next: pc.connectionState });
      if (pc.connectionState === "connected") {
        clearCallTimers();
        setStatus("active");
        statusRef.current = "active";
        return;
      }

      if (pc.connectionState === "disconnected") {
        if (disconnectTimeoutRef.current) {
          clearTimeout(disconnectTimeoutRef.current);
        }
        disconnectTimeoutRef.current = setTimeout(() => {
          setFailed("Соединение потеряно");
          if (callRef.current?.callId) {
            socket?.emit("call:ended", { callId: callRef.current.callId, reason: "disconnect_timeout" });
          }
        }, 10000);
        return;
      }

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        setFailed("Ошибка соединения");
      }
    };

    pc.oniceconnectionstatechange = () => {
      debugCall("call:ice-state", { next: pc.iceConnectionState });
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        clearCallTimers();
        if (statusRef.current !== "active") {
          setStatus("active");
          statusRef.current = "active";
        }
      }

      if (pc.iceConnectionState === "failed") {
        setFailed("Ошибка ICE-соединения");
      }
    };

    debugCall("call:pc-created", { role });
    return pc;
  }

  async function startCall(chatId: string, fromUser?: { displayName: string; avatarUrl: string | null }) {
    if (!socket || !socket.connected || statusRef.current !== "idle") {
      if (statusRef.current === "idle") {
        setFailed("Нет подключения к серверу звонков");
      }
      return;
    }

    setError(null);
    setCallState(
      {
        callId: `pending-${Date.now()}`,
        chatId,
        role: "caller",
        user: { displayName: "Собеседник", avatarUrl: null },
      },
      "ringing",
    );
    playTone("ringback");
    debugCall("call:start:init", { chatId });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection("caller");
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      debugCall("call:offer-created", { hasLocalDescription: true });

      socket.emit("call:start", { chatId, offer, fromUser }, (response: StartCallAck) => {
        if (!response?.ok) {
          setFailed(response?.error ?? "Не удалось начать звонок");
          return;
        }

        if (!response.callId) {
          setFailed("Сервер не вернул идентификатор звонка");
          return;
        }

        setCallState(
          {
            callId: response.callId,
            chatId,
            role: "caller",
            user: response.callee ?? { displayName: "Собеседник", avatarUrl: null },
          },
          "ringing",
        );

        debugCall("call:start:ack", { callId: response.callId });
        emitPendingLocalIce();

        ringingTimeoutRef.current = setTimeout(() => {
          if (statusRef.current === "ringing" && callRef.current?.callId) {
            socket.emit("call:ended", { callId: callRef.current.callId, reason: "ring_timeout" });
            setFailed("Собеседник не ответил");
          }
        }, 45000);
      });
    } catch (error) {
      console.error(error);
      socket.emit("call:ended", { callId: callRef.current?.callId, reason: "permission_denied" });
      setFailed("Нет доступа к микрофону");
    }
  }

  async function acceptCall() {
    if (!socket || !socket.connected || !callRef.current || !incomingOfferRef.current) {
      return;
    }

    setError(null);
    setStatus("connecting");
    statusRef.current = "connecting";
    stopTone();
    debugCall("call:accept:init");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection("callee");
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
      debugCall("call:remote-offer:set", { hasRemoteDescription: true });
      await flushRemoteIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      debugCall("call:answer-created", { hasLocalDescription: true });

      socket.emit(
        "call:answer",
        {
          callId: callRef.current.callId,
          chatId: callRef.current.chatId,
          answer,
        },
        (response: SocketAck) => {
          if (!response?.ok) {
            setFailed(response?.error ?? "Не удалось принять звонок");
            return;
          }

          scheduleConnectingTimeout();
        },
      );
    } catch (error) {
      console.error(error);
      socket.emit("call:declined", { callId: callRef.current.callId, reason: "permission_denied" });
      setFailed("Нет доступа к микрофону");
    }
  }

  function declineCall() {
    stopTone();
    if (callRef.current?.callId) {
      socket?.emit("call:declined", { callId: callRef.current.callId, reason: "declined" });
    }
    cleanup("declined");
  }

  function endCall() {
    stopTone();
    if (callRef.current?.callId) {
      socket?.emit("call:ended", { callId: callRef.current.callId, reason: "user_ended" });
    }
    cleanup("ended");
  }

  function toggleMute() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) {
      return;
    }

    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  }

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleIncoming = ({ callId, chatId, offer, fromUser }: IncomingCallPayload) => {
      debugCall("call:incoming", { callId, chatId });
      if (statusRef.current !== "idle") {
        socket.emit("call:declined", { callId, reason: "busy" });
        return;
      }

      incomingOfferRef.current = offer;
      setCallState(
        {
          callId,
          chatId,
          role: "callee",
          user: fromUser ?? { displayName: "Аноним", avatarUrl: null },
        },
        "ringing",
      );
      playTone("incoming");
    };

    const handleAnswered = async ({ callId, chatId, answer }: AnsweredCallPayload) => {
      debugCall("call:answered", { callId, chatId });
      if (!pcRef.current || !callRef.current || callRef.current.callId !== callId) {
        return;
      }

      clearCallTimers();
      stopTone();
      setStatus("connecting");
      statusRef.current = "connecting";
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      debugCall("call:remote-answer:set", { hasRemoteDescription: true });
      await flushRemoteIce();
      scheduleConnectingTimeout();
    };

    const handleIceCandidate = async ({ callId, chatId, candidate }: IceCandidatePayload) => {
      debugCall("call:ice:remote", { callId, chatId });
      if (!callRef.current || callRef.current.callId !== callId) {
        return;
      }

      if (pcRef.current?.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (error) {
          debugCall("call:ice:add-failed", { error: String(error) });
        }
        return;
      }

      pendingRemoteIceRef.current.push(candidate);
    };

    const handleEnded = ({ reason }: CallEndedPayload) => {
      debugCall("call:ended", { reason });
      stopTone();
      cleanup(`remote-ended:${reason}`);
    };

    const handleDeclined = ({ reason }: CallDeclinedPayload) => {
      debugCall("call:declined", { reason });
      stopTone();
      setFailed(reason === "busy" ? "Пользователь занят" : "Звонок отклонён");
    };

    socket.on("call:incoming", handleIncoming);
    socket.on("call:answered", handleAnswered);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:ended", handleEnded);
    socket.on("call:declined", handleDeclined);

    return () => {
      socket.off("call:incoming", handleIncoming);
      socket.off("call:answered", handleAnswered);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:ended", handleEnded);
      socket.off("call:declined", handleDeclined);
    };
  }, [cleanup, clearCallTimers, debugCall, flushRemoteIce, playTone, scheduleConnectingTimeout, setCallState, setFailed, socket, stopTone]);

  useEffect(() => {
    return () => {
      stopTone();
      if (toneContextRef.current) {
        void toneContextRef.current.close();
        toneContextRef.current = null;
      }
    };
  }, [stopTone]);

  return (
    <CallContext.Provider
      value={{
        call,
        status,
        localStream,
        remoteStream,
        isMuted,
        error,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useAudioCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error("useAudioCall must be used within CallProvider");
  }
  return context;
}
