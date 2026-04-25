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
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<CallStatus>("idle");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const debugCall = (label: string, data: any = {}) => {
    if (!DEBUG_CALLS) return;
    console.log(`[CALL DEBUG] ${label}`, {
      status: statusRef.current,
      role: call?.role,
      pcState: pcRef.current?.connectionState,
      iceState: pcRef.current?.iceConnectionState,
      signalingState: pcRef.current?.signalingState,
      hasLocalDesc: !!pcRef.current?.localDescription,
      hasRemoteDesc: !!pcRef.current?.remoteDescription,
      ...data
    });
  };

  const cleanup = useCallback((reason?: string) => {
    debugCall("Cleanup started", { reason });
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
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
    incomingOfferRef.current = null;
    setIsMuted(false);
    remoteStreamRef.current = null;
  }, []);

  const failCall = useCallback((err: string) => {
    debugCall("Call Failed", { err });
    setError(err);
    setStatus("failed");
    setTimeout(() => {
      cleanup();
      setError(null);
    }, 3000);
  }, [cleanup]);

  const createPeerConnection = useCallback((role: CallRole, callId: string) => {
    debugCall("Creating RTCPeerConnection");
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        debugCall("Local ICE candidate generated");
        socket.emit("call:ice-candidate", { callId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      debugCall("Remote track received", { kind: event.track.kind });
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
        setRemoteStream(remoteStreamRef.current);
      }
      remoteStreamRef.current.addTrack(event.track);
    };

    pc.onconnectionstatechange = () => {
      debugCall("Connection state changed", { state: pc.connectionState });
      if (pc.connectionState === "connected") {
        setStatus("active");
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanup("connection failed");
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, cleanup]);

  const startCall = async (chatId: string, fromUser?: { displayName: string, avatarUrl: string | null }) => {
    if (statusRef.current !== "idle") return;
    debugCall("Starting outgoing call", { chatId });
    setStatus("ringing");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection("caller", "pending");
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket?.emit("call:start", { chatId, offer, fromUser }, (response: any) => {
        if (response.ok) {
          debugCall("Call started successfully", { callId: response.callId });
          setCall({
            callId: response.callId,
            chatId,
            role: "caller",
            user: { displayName: "Собеседник", avatarUrl: null }
          });
          
          timeoutRef.current = setTimeout(() => {
            if (statusRef.current === "ringing") {
              debugCall("Call timeout - no answer");
              socket.emit("call:ended", { callId: response.callId, reason: "timeout" });
              cleanup("timeout");
            }
          }, 45000);
        } else {
          failCall("Не удалось начать звонок");
        }
      });
    } catch (err) {
      failCall("Нет доступа к микрофону");
    }
  };

  const acceptCall = async () => {
    if (!call || !incomingOfferRef.current || !socket) return;
    debugCall("Accepting incoming call");
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection("callee", call.callId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
      debugCall("Remote description set (offer)");

      while (pendingIceQueue.current.length > 0) {
        const cand = pendingIceQueue.current.shift();
        if (cand) await pc.addIceCandidate(cand).catch(e => debugCall("ICE add failed", e));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      debugCall("Local description set (answer)");

      socket.emit("call:answer", { 
        callId: call.callId, 
        chatId: call.chatId, 
        answer 
      }, (res: any) => {
        if (!res.ok) failCall("Ошибка при ответе на звонок");
      });
    } catch (err) {
      failCall("Ошибка доступа к микрофону");
      socket.emit("call:declined", { callId: call.callId });
    }
  };

  const declineCall = () => {
    if (call && socket) {
      socket.emit("call:declined", { callId: call.callId });
    }
    cleanup("declined");
  };

  const endCall = () => {
    if (call && socket) {
      socket.emit("call:ended", { callId: call.callId, reason: "user_ended" });
    }
    cleanup("ended by user");
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

  useEffect(() => {
    if (!socket) return;

    const onIncoming = ({ callId, chatId, offer, fromUser }: any) => {
      debugCall("Incoming call received", { callId });
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
      setStatus("ringing");
    };

    const onAnswered = async ({ answer }: any) => {
      debugCall("Call answered by remote");
      if (pcRef.current) {
        setStatus("connecting");
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        debugCall("Remote description set (answer)");
        
        while (pendingIceQueue.current.length > 0) {
          const cand = pendingIceQueue.current.shift();
          if (cand) await pcRef.current.addIceCandidate(cand).catch(e => debugCall("ICE add failed", e));
        }
      }
    };

    const onIce = async ({ candidate }: any) => {
      debugCall("Remote ICE candidate received");
      if (pcRef.current && pcRef.current.remoteDescription) {
        await pcRef.current.addIceCandidate(candidate).catch(e => debugCall("ICE add failed", e));
      } else {
        debugCall("Queuing remote ICE candidate");
        pendingIceQueue.current.push(candidate);
      }
    };

    const onEnded = ({ reason }: any) => {
      debugCall("Call ended by remote", { reason });
      cleanup(`remote ended: ${reason}`);
    };

    const onDeclined = () => {
      debugCall("Call declined by remote");
      cleanup("remote declined");
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:answered", onAnswered);
    socket.on("call:ice-candidate", onIce);
    socket.on("call:ended", onEnded);
    socket.on("call:declined", onDeclined);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:answered", onAnswered);
      socket.off("call:ice-candidate", onIce);
      socket.off("call:ended", onEnded);
      socket.off("call:declined", onDeclined);
    };
  }, [socket, cleanup]);

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
