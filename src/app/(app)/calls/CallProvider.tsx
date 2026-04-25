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
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
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

  const cleanup = useCallback(() => {
    if (pcRef.current) {
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
    setDuration(0);
    setIsMuted(false);
    iceCandidatesQueue.current = [];
  }, []);

  const endCall = useCallback(() => {
    if (socket && callId && chatId) {
      socket.emit("call:ended", { callId, chatId });
    }
    cleanup();
    setStatus("ended");
    setTimeout(() => setStatus("idle"), 2000);
  }, [socket, callId, chatId, cleanup]);

  const setupPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && callId && chatId) {
        socket.emit("call:ice-candidate", { callId, chatId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          setStatus("active");
          setDuration(0);
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
          break;
        case "failed":
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
      setStatus("requesting-permission");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setChatId(targetChatId);
      
      if (socket) {
        socket.emit("call:start", { chatId: targetChatId });
      }
    } catch {
      setError("Нет доступа к микрофону");
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const acceptCall = async () => {
    if (!socket || !callId || !chatId) return;
    
    try {
      setStatus("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = setupPeerConnection();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      socket.emit("call:accepted", { callId, chatId });
    } catch {
      setError("Нет доступа к микрофону");
      socket.emit("call:declined", { callId, chatId });
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const declineCall = () => {
    if (socket && callId && chatId) {
      socket.emit("call:declined", { callId, chatId });
    }
    cleanup();
    setStatus("idle");
  };

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

    socket.on("call:incoming", (data) => {
      if (status !== "idle") {
        socket.emit("call:declined", { callId: data.callId, chatId: data.chatId });
        return;
      }
      setCallId(data.callId);
      setChatId(data.chatId);
      setPeer(data.fromUser);
      setStatus("incoming");
    });

    socket.on("call:ringing", (data) => {
      setCallId(data.callId);
      setStatus("ringing");
    });

    socket.on("call:accepted", async () => {
      setStatus("connecting");
      const pc = setupPeerConnection();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", { callId, chatId, offer });
    });

    socket.on("call:offer", async (data) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:answer", { callId, chatId, answer });

      // Apply queued candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on("call:answer", async (data) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    });

    socket.on("call:ice-candidate", async (data) => {
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        iceCandidatesQueue.current.push(data.candidate);
      }
    });

    socket.on("call:declined", () => {
      setStatus("declined");
      cleanup();
      setTimeout(() => setStatus("idle"), 2000);
    });

    socket.on("call:ended", () => {
      setStatus("ended");
      cleanup();
      setTimeout(() => setStatus("idle"), 2000);
    });

    socket.on("call:error", (data) => {
      setError(data.message);
      setStatus("failed");
      cleanup();
      setTimeout(() => setStatus("idle"), 3000);
    });

    return () => {
      socket.off("call:incoming");
      socket.off("call:ringing");
      socket.off("call:accepted");
      socket.off("call:offer");
      socket.off("call:answer");
      socket.off("call:ice-candidate");
      socket.off("call:declined");
      socket.off("call:ended");
      socket.off("call:error");
    };
  }, [socket, status, callId, chatId, setupPeerConnection, cleanup]);

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
