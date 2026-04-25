"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useSocket } from "@/hooks/useSocket";

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
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for socket handlers to avoid dependency loops
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const cleanup = useCallback(() => {
    console.log("[Call] Cleanup");
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
    iceCandidatesQueue.current = [];
  }, []);

  const endCall = useCallback(() => {
    console.log("[Call] End call");
    if (socket && callId && chatId) {
      socket.emit("call:ended", { callId, chatId });
    }
    cleanup();
    setStatus("ended");
    setTimeout(() => {
      setStatus(prev => prev === "ended" ? "idle" : prev);
    }, 2000);
  }, [socket, callId, chatId, cleanup]);

  const processIceQueue = useCallback(async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return;
    console.log("[WebRTC] Processing ICE queue", iceCandidatesQueue.current.length);
    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      if (candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("[WebRTC] Error adding queued ICE candidate", e);
        }
      }
    }
  }, []);

  const setupPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    console.log("[WebRTC] Creating new RTCPeerConnection");
    
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && callId && chatId) {
        socket.emit("call:ice-candidate", { callId, chatId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log("[WebRTC] Received remote track");
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(e => console.error("[WebRTC] Remote audio play failed", e));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] Connection state:", pc.connectionState);
      switch (pc.connectionState) {
        case "connected":
          setStatus("active");
          if (callTimeoutRef.current) {
            clearTimeout(callTimeoutRef.current);
            callTimeoutRef.current = null;
          }
          if (!timerRef.current) {
            setDuration(0);
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
          }
          break;
        case "failed":
          setError("Не удалось установить соединение");
          endCall();
          break;
        case "disconnected":
        case "closed":
          endCall();
          break;
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, callId, chatId, endCall]);

  const startCall = async (targetChatId: string) => {
    try {
      cleanup();
      setStatus("requesting-permission");
      console.log("[Call] Starting call for chatId", targetChatId);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setChatId(targetChatId);
      
      if (socket) {
        socket.emit("call:start", { chatId: targetChatId });
        setStatus("outgoing");
      }

      callTimeoutRef.current = setTimeout(() => {
        if (statusRef.current !== "active") {
          setError("Собеседник не ответил");
          endCall();
        }
      }, 45000);
    } catch (err) {
      console.error("[Call] startCall failed", err);
      setError("Нет доступа к микрофону");
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const acceptCall = async () => {
    if (!socket || !callId || !chatId) return;
    
    try {
      setStatus("connecting");
      console.log("[Call] Accepting call", callId);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      socket.emit("call:accepted", { callId, chatId });
    } catch (err) {
      console.error("[Call] acceptCall failed", err);
      setError("Нет доступа к микрофону");
      socket.emit("call:declined", { callId, chatId });
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const declineCall = useCallback(() => {
    console.log("[Call] Declining call");
    if (socket && callId && chatId) {
      socket.emit("call:declined", { callId, chatId });
    }
    cleanup();
    setStatus("idle");
  }, [socket, callId, chatId, cleanup]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Socket listeners management
  useEffect(() => {
    if (!socket) return;

    const handleIncoming = (data: any) => {
      console.log("[Socket] call:incoming", data.callId);
      if (statusRef.current !== "idle" && statusRef.current !== "ended" && statusRef.current !== "failed") {
        socket.emit("call:declined", { callId: data.callId, chatId: data.chatId });
        return;
      }
      setCallId(data.callId);
      setChatId(data.chatId);
      setPeer(data.fromUser);
      setStatus("incoming");
    };

    const handleRinging = (data: any) => {
      console.log("[Socket] call:ringing", data.callId);
      setCallId(data.callId);
      setStatus("ringing");
    };

    const handleAccepted = async () => {
      console.log("[Socket] call:accepted (as caller)");
      setStatus("connecting");
      const pc = setupPeerConnection();
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log("[WebRTC] Adding local track", track.kind);
          pc.addTrack(track, localStreamRef.current!);
        });
      }
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", { callId, chatId, offer });
    };

    const handleOffer = async (data: any) => {
      console.log("[Socket] call:offer (as callee)");
      const pc = setupPeerConnection();
      
      if (localStreamRef.current && pc.getSenders().length === 0) {
        localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("call:answer", { callId, chatId, answer });
        await processIceQueue();
      } catch (e) {
        console.error("[WebRTC] Offer handling failed", e);
      }
    };

    const handleAnswer = async (data: any) => {
      console.log("[Socket] call:answer (as caller)");
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          await processIceQueue();
        } catch (e) {
          console.error("[WebRTC] Answer handling failed", e);
        }
      }
    };

    const handleIceCandidate = async (data: any) => {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("[WebRTC] Error adding ICE candidate", e);
        }
      } else {
        iceCandidatesQueue.current.push(data.candidate);
      }
    };

    const handleDeclined = () => {
      console.log("[Socket] call:declined");
      setStatus("declined");
      cleanup();
      setTimeout(() => setStatus(p => p === "declined" ? "idle" : p), 2000);
    };

    const handleEnded = () => {
      console.log("[Socket] call:ended");
      setStatus("ended");
      cleanup();
      setTimeout(() => setStatus(p => p === "ended" ? "idle" : p), 2000);
    };

    const handleError = (data: any) => {
      console.error("[Socket] call:error", data.message);
      setError(data.message);
      setStatus("failed");
      cleanup();
      setTimeout(() => setStatus(p => p === "failed" ? "idle" : p), 3000);
    };

    socket.on("call:incoming", handleIncoming);
    socket.on("call:ringing", handleRinging);
    socket.on("call:accepted", handleAccepted);
    socket.on("call:offer", handleOffer);
    socket.on("call:answer", handleAnswer);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:declined", handleDeclined);
    socket.on("call:ended", handleEnded);
    socket.on("call:error", handleError);

    return () => {
      socket.off("call:incoming", handleIncoming);
      socket.off("call:ringing", handleRinging);
      socket.off("call:accepted", handleAccepted);
      socket.off("call:offer", handleOffer);
      socket.off("call:answer", handleAnswer);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:declined", handleDeclined);
      socket.off("call:ended", handleEnded);
      socket.off("call:error", handleError);
    };
  }, [socket, callId, chatId, setupPeerConnection, cleanup, processIceQueue]);

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
