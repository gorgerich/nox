"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useSocket } from "@/hooks/useSocket";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";

type CallStatus = 
  | "idle" 
  | "requesting-permission" 
  | "outgoing" 
  | "incoming" 
  | "ringing" 
  | "connecting" 
  | "active" 
  | "ended" 
  | "declined" 
  | "failed";

interface CallPeer {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface CallContextType {
  status: CallStatus;
  peer: CallPeer | null;
  isMuted: boolean;
  duration: number;
  error: string | null;
  startCall: (chatId: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

const CallContext = createContext<CallContextType | null>(null);

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const [status, setStatus] = useState<CallStatus>("idle");
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const iceCandidatesQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for socket handlers to avoid dependency loops
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const log = useCallback((msg: string, data?: unknown) => {
    if (DEBUG_CALLS) {
      console.log(`[CallProvider] ${msg}`, data || "");
    }
  }, []);

  const cleanup = useCallback(() => {
    log("Cleanup triggered");
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    setDuration(0);
    setIsMuted(false);
    iceCandidatesQueueRef.current = [];
    pendingOfferRef.current = null;
    setCallId(null);
  }, [log]);

  const failCall = useCallback((reason: string) => {
    log("Failing call", reason);
    setError(reason);
    setStatus("failed");
    cleanup();
    setTimeout(() => setStatus(prev => prev === "failed" ? "idle" : prev), 3000);
  }, [log, cleanup]);

  const processIceQueue = useCallback(async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) {
      log("Cannot process ICE queue: remoteDescription missing");
      return;
    }
    log("Processing ICE queue", iceCandidatesQueueRef.current.length);
    while (iceCandidatesQueueRef.current.length > 0) {
      const candidate = iceCandidatesQueueRef.current.shift();
      if (candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          log("Error adding queued ICE candidate", e);
        }
      }
    }
  }, [log]);

  const setupPeerConnection = useCallback(() => {
    log("setupPeerConnection");
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && callId && chatId) {
        log("ICE candidate generated");
        socket.emit("call:ice-candidate", { callId, chatId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      log("ontrack received", event.streams[0]?.getTracks().length);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(e => log("Remote audio play rejected", e));
      }
    };

    pc.onconnectionstatechange = () => {
      log("connectionState changed", pc.connectionState);
      switch (pc.connectionState) {
        case "connected":
          setStatus("active");
          if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
          if (!timerRef.current) {
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
          }
          break;
        case "failed":
          failCall("Соединение разорвано");
          break;
        case "disconnected":
        case "closed":
          if (statusRef.current !== "ended" && statusRef.current !== "failed") cleanup();
          setStatus("idle");
          break;
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, callId, chatId, log, cleanup, failCall]);

  const startCall = async (targetChatId: string) => {
    log("startCall requested", targetChatId);
    try {
      cleanup();
      setStatus("requesting-permission");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setChatId(targetChatId);
      
      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      log("Offer created and setLocalDescription done");

      if (socket) {
        socket.emit("call:start", { chatId: targetChatId, offer }, (ack: { ok: boolean; callId?: string; error?: string }) => {
          if (ack?.ok && ack.callId) {
            log("call:start ack ok", ack.callId);
            setCallId(ack.callId);
            setStatus("ringing");
          } else {
            failCall(ack?.error || "Не удалось начать звонок");
          }
        });
      }

      callTimeoutRef.current = setTimeout(() => {
        if (statusRef.current !== "active") failCall("Собеседник не ответил");
      }, 45000);
    } catch (err) {
      log("getUserMedia failed", err);
      failCall("Нет доступа к микрофону");
    }
  };

  const acceptCall = async () => {
    log("acceptCall requested");
    if (!socket || !callId || !chatId || !pendingOfferRef.current) {
      log("acceptCall aborted: missing data");
      return;
    }
    
    try {
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      log("setRemoteDescription(offer) starting");
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log("Answer created and setLocalDescription done");

      socket.emit("call:answer", { callId, chatId, answer }, (ack: { ok: boolean }) => {
        if (!ack?.ok) log("call:answer failed on server");
      });

      await processIceQueue();
    } catch (err) {
      log("acceptCall failed", err);
      failCall("Ошибка при ответе на вызов");
      socket.emit("call:declined", { callId, chatId });
    }
  };

  const declineCall = useCallback(() => {
    log("declineCall");
    if (socket && callId && chatId) {
      socket.emit("call:declined", { callId, chatId });
    }
    cleanup();
    setStatus("idle");
  }, [socket, callId, chatId, log, cleanup]);

  const endCall = useCallback(() => {
    log("endCall");
    if (socket && callId && chatId) {
      socket.emit("call:ended", { callId, chatId });
    }
    cleanup();
    setStatus("ended");
    setTimeout(() => setStatus(prev => prev === "ended" ? "idle" : prev), 2000);
  }, [socket, callId, chatId, log, cleanup]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleIncoming = (data: { callId: string; chatId: string; fromUser: CallPeer; offer: RTCSessionDescriptionInit }) => {
      log("call:incoming received", data.callId);
      if (statusRef.current !== "idle" && statusRef.current !== "ended" && statusRef.current !== "failed") {
        log("Busy: declining incoming call automatically");
        socket.emit("call:declined", { callId: data.callId, chatId: data.chatId });
        return;
      }
      setCallId(data.callId);
      setChatId(data.chatId);
      setPeer(data.fromUser);
      pendingOfferRef.current = data.offer;
      setStatus("incoming");
    };

    const handleAnswer = async (data: { answer: RTCSessionDescriptionInit }) => {
      log("call:answer received");
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          log("setRemoteDescription(answer) ok");
          await processIceQueue();
        } catch (e) {
          log("setRemoteDescription(answer) failed", e);
        }
      }
    };

    const handleIceCandidate = async (data: { candidate: RTCIceCandidateInit }) => {
      log("call:ice-candidate received");
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          log("addIceCandidate ok");
        } catch (e) {
          log("addIceCandidate failed", e);
        }
      } else {
        log("ICE candidate queued");
        iceCandidatesQueueRef.current.push(data.candidate);
      }
    };

    const handleDeclined = () => {
      log("call:declined received");
      setStatus("declined");
      cleanup();
      setTimeout(() => setStatus(p => p === "declined" ? "idle" : p), 2000);
    };

    const handleEnded = () => {
      log("call:ended received");
      setStatus("ended");
      cleanup();
      setTimeout(() => setStatus(p => p === "ended" ? "idle" : p), 2000);
    };

    socket.on("call:incoming", handleIncoming);
    socket.on("call:answer", handleAnswer);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:declined", handleDeclined);
    socket.on("call:ended", handleEnded);

    return () => {
      socket.off("call:incoming", handleIncoming);
      socket.off("call:answer", handleAnswer);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:declined", handleDeclined);
      socket.off("call:ended", handleEnded);
    };
  }, [socket, log, cleanup, processIceQueue]);

  return (
    <CallContext.Provider value={{ status, peer, isMuted, duration, error, startCall, acceptCall, declineCall, endCall, toggleMute }}>
      {children}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    </CallContext.Provider>
  );
}

export function useAudioCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useAudioCall must be used within CallProvider");
  return context;
}
