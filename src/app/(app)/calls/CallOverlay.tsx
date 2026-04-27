"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useAudioCall } from "./CallProvider";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const RINGBACK_INTERVAL_MS = 4000;
const RINGBACK_TONE_MS = 1200;

type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function CallOverlay() {
  const {
    call,
    status,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    canSwitchCamera,
    error,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
  } = useAudioCall();
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const ringbackContextRef = useRef<AudioContext | null>(null);
  const ringbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const [speakerHint, setSpeakerHint] = useState<string | null>(null);
  const [speakerMode, setSpeakerMode] = useState<"default" | "alternate">("default");

  const debugCall = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_CALLS) {
      return;
    }

    console.log(`[call-debug] ${label}`, data);
  }, []);

  const logAudioElementState = useCallback((label: string, audio: HTMLAudioElement) => {
    debugCall(label, {
      hasSrcObject: Boolean(audio.srcObject),
      paused: audio.paused,
      muted: audio.muted,
      volume: audio.volume,
      readyState: audio.readyState,
    });
  }, [debugCall]);

  const attachRemoteAudioStream = useCallback((source: string) => {
    const audio = remoteAudioRef.current;
    if (!audio || !remoteStream) {
      return null;
    }

    audio.srcObject = remoteStream;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.muted = false;
    audio.volume = 1;

    debugCall("audio srcObject assigned", {
      source,
      hasSrcObject: Boolean(audio.srcObject),
    });
    logAudioElementState("audio element state", audio);
    return audio;
  }, [remoteStream, debugCall, logAudioElementState]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) {
      return;
    }

    if (!localStream || localStream.getVideoTracks().length === 0) {
      video.srcObject = null;
      return;
    }

    video.srcObject = localStream;
    video.autoplay = true;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    debugCall("local video srcObject assigned", {
      videoTracks: localStream.getVideoTracks().length,
    });
    void video.play().catch((playError) => {
      debugCall("remote audio/video play fail", { target: "local-video", error: String(playError) });
    });
  }, [localStream, debugCall]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) {
      return;
    }

    const videoTracks = remoteStream?.getVideoTracks() ?? [];
    if (!remoteStream || videoTracks.length === 0) {
      video.srcObject = null;
      return;
    }

    video.srcObject = new MediaStream(videoTracks);
    video.autoplay = true;
    video.muted = false;
    video.setAttribute("playsinline", "true");
    debugCall("remote video srcObject assigned", {
      videoTracks: videoTracks.length,
    });
    void video.play().then(() => {
      debugCall("remote audio/video play success", { target: "remote-video" });
    }).catch((playError) => {
      debugCall("remote audio/video play fail", { target: "remote-video", error: String(playError) });
    });
  }, [remoteStream, debugCall]);

  const stopRingback = useCallback((reason: string) => {
    if (ringbackIntervalRef.current) {
      clearInterval(ringbackIntervalRef.current);
      ringbackIntervalRef.current = null;
    }

    if (ringbackContextRef.current) {
      void ringbackContextRef.current.close().catch(() => undefined);
      ringbackContextRef.current = null;
    }

    debugCall("ringback stopped", { reason });
  }, [debugCall]);

  useEffect(() => {
    if (!remoteStream) {
      const audio = remoteAudioRef.current;
      if (audio) {
        audio.srcObject = null;
      }
      return;
    }

    const audio = attachRemoteAudioStream("remoteStream effect");
    if (!audio) {
      return;
    }

    audio.play().then(() => {
      setNeedsTapToPlay(false);
      debugCall("audio.play success", { source: "remoteStream effect" });
      logAudioElementState("audio element after play success", audio);
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      debugCall("audio.play fail", { source: "remoteStream effect", error: String(playError) });
      logAudioElementState("audio element after play fail", audio);
    });
  }, [remoteStream, attachRemoteAudioStream, debugCall, logAudioElementState]);

  useEffect(() => {
    if (!DEBUG_CALLS) {
      return;
    }

    console.log("[call-ui]", {
      status,
      isOverlayVisible: status !== "idle",
      hasCall: Boolean(call),
      hasRemoteStream: Boolean(remoteStream),
    });
  }, [call, status, remoteStream]);

  useEffect(() => {
    if (!speakerHint) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setSpeakerHint(null);
    }, 2500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [speakerHint]);

  const isOutgoingRinging = call?.role === "caller" && status === "ringing";

  useEffect(() => {
    if (!isOutgoingRinging) {
      stopRingback("not-outgoing-ringing");
      return;
    }

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!AudioContextCtor) {
      debugCall("ringback unavailable", { reason: "AudioContext unsupported" });
      return;
    }

    stopRingback("restart");
    const context = new AudioContextCtor();
    ringbackContextRef.current = context;

    const playRingTone = () => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 425;
      gainNode.gain.value = 0.0001;

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      const now = context.currentTime;
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.06);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + RINGBACK_TONE_MS / 1000);
      oscillator.start(now);
      oscillator.stop(now + RINGBACK_TONE_MS / 1000);
    };

    void context.resume().then(() => {
      playRingTone();
      ringbackIntervalRef.current = setInterval(playRingTone, RINGBACK_INTERVAL_MS);
      debugCall("ringback started");
    }).catch((ringError) => {
      debugCall("ringback start blocked", { error: String(ringError) });
    });

    return () => {
      stopRingback("ringback effect cleanup");
    };
  }, [isOutgoingRinging, stopRingback, debugCall]);

  const handleTapToPlay = useCallback(() => {
    const audio = attachRemoteAudioStream("manual tap");
    if (!audio) {
      return;
    }

    void audio.play().then(() => {
      setNeedsTapToPlay(false);
      debugCall("tap-to-play success", { source: "manual tap" });
      logAudioElementState("audio element after play success", audio);
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      debugCall("tap-to-play fail", { source: "manual tap", error: String(playError) });
      logAudioElementState("audio element after play fail", audio);
    });
  }, [attachRemoteAudioStream, debugCall, logAudioElementState]);

  const handleSpeakerToggle = useCallback(async () => {
    const audio = remoteAudioRef.current as SinkAudioElement | null;
    if (!audio) {
      return;
    }

    if (typeof audio.setSinkId !== "function") {
      setSpeakerHint("Громкая связь управляется системой устройства");
      debugCall("speaker fallback", { reason: "setSinkId unsupported" });
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === "audiooutput");
      if (outputs.length === 0) {
        setSpeakerHint("Громкая связь управляется системой устройства");
        debugCall("speaker fallback", { reason: "no-audiooutput-devices" });
        return;
      }

      if (speakerMode === "default") {
        const currentSinkId = audio.sinkId ?? "default";
        const nextOutput = outputs.find((device) => device.deviceId !== currentSinkId) ?? outputs[0];
        await audio.setSinkId(nextOutput.deviceId);
        setSpeakerMode("alternate");
        setSpeakerHint(nextOutput.label ? `Вывод: ${nextOutput.label}` : "Устройство вывода переключено");
        debugCall("speaker toggled", { mode: "alternate", usedSinkId: true });
      } else {
        await audio.setSinkId("default");
        setSpeakerMode("default");
        setSpeakerHint("Вывод: системный по умолчанию");
        debugCall("speaker toggled", { mode: "default", usedSinkId: true });
      }
    } catch (speakerError) {
      setSpeakerHint("Громкая связь управляется системой устройства");
      debugCall("speaker fallback", { reason: "setSinkId failed", error: String(speakerError) });
    }
  }, [speakerMode, debugCall]);

  if (typeof document === "undefined" || status === "idle") {
    return null;
  }

  const peer = call?.user ?? { displayName: "Собеседник", avatarUrl: null };
  const isVideoCall = call?.mode === "video";
  const isIncoming = call?.role === "callee" && status === "ringing";
  const isOutgoing = call?.role === "caller" && status === "ringing";
  const isConnecting = status === "connecting";
  const isActive = status === "active";

  const fullAvatarUrl = peer.avatarUrl
    ? (peer.avatarUrl.startsWith("http") ? peer.avatarUrl : `/api/avatars/${peer.avatarUrl}`)
    : null;

  return createPortal(
    <div className="fixed inset-0 z-1000 flex flex-col items-center justify-between bg-neutral-950/95 p-8 pb-[calc(env(safe-area-inset-bottom,0px)+4rem)] backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {isVideoCall ? (
        <div className="absolute inset-0 overflow-hidden bg-black">
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
          {(!remoteStream || remoteStream.getVideoTracks().length === 0) ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950">
              <div className="relative mb-5 h-28 w-28 overflow-hidden rounded-[2.5rem] border border-white/10 bg-neutral-900">
                {fullAvatarUrl ? (
                  <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-4xl font-black text-primary">
                    {peer.displayName[0] ?? "?"}
                  </div>
                )}
              </div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary/80">
                {isIncoming ? "Входящий видеозвонок..." : "Соединение видео..."}
              </p>
            </div>
          ) : null}

          <div className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] h-36 w-24 overflow-hidden rounded-3xl border border-white/20 bg-neutral-900 shadow-2xl">
            <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {(!localStream || localStream.getVideoTracks().length === 0 || isCameraOff) ? (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 text-[10px] font-black uppercase tracking-widest text-white/70">
                Камера
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`${isVideoCall ? "relative z-10 mt-[calc(env(safe-area-inset-top,0px)+1rem)]" : "mt-20"} flex flex-col items-center text-center`}>
        {!isVideoCall ? (
          <div className="relative mb-6 h-32 w-32">
            <div className={`absolute inset-0 rounded-[3rem] bg-primary/20 ${status === "ringing" ? "animate-ping" : ""}`} />
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[3rem] border-4 border-white/10 bg-neutral-900 shadow-2xl">
              {fullAvatarUrl ? (
                <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
              ) : (
                <span className="text-5xl font-black text-primary">{peer.displayName[0] ?? "?"}</span>
              )}
            </div>
          </div>
        ) : null}

        <h2 className="mb-2 text-3xl font-black tracking-tight text-white">{peer.displayName}</h2>

        <div className="flex items-center gap-2">
          {status === "active" ? <div className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : null}
          <p className="text-sm font-black uppercase tracking-[0.2em] text-primary/80">
            {isIncoming ? (isVideoCall ? "Входящий видеозвонок..." : "Входящий звонок...") : null}
            {isOutgoing ? "Вызов..." : null}
            {isConnecting ? "Соединение..." : null}
            {isActive ? "Разговор" : null}
            {status === "failed" ? "Ошибка" : null}
            {!isIncoming && !isOutgoing && !isConnecting && !isActive && status !== "failed" ? "Соединение..." : null}
          </p>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-danger/20 bg-danger/10 px-4 py-2 text-xs font-bold text-danger animate-bounce">
            {error}
          </p>
        ) : null}

        {speakerHint ? (
          <p className="mt-3 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white/90">
            {speakerHint}
          </p>
        ) : null}

        {needsTapToPlay && remoteStream ? (
          <button
            onClick={handleTapToPlay}
            className="mt-4 rounded-2xl border border-primary/40 bg-primary/20 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-primary"
          >
            Включить звук
          </button>
        ) : null}
      </div>

      <div className="relative z-10 flex w-full max-w-sm flex-col gap-8">
        {isIncoming ? (
          <div className="flex items-center justify-around gap-8 animate-in slide-in-from-bottom-10 duration-200">
            <button onClick={declineCall} className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-2xl shadow-danger/40 transition-smooth active:scale-90">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <button onClick={acceptCall} className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-2xl shadow-primary/40 transition-smooth active:scale-90">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={toggleMute}
                className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                  isMuted ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"
                }`}
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>

              {isVideoCall ? (
                <button
                  onClick={toggleCamera}
                  className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                    isCameraOff ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"
                  }`}
                  title={isCameraOff ? "Включить камеру" : "Выключить камеру"}
                >
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" />
                  </svg>
                </button>
              ) : null}

              <button
                onClick={handleSpeakerToggle}
                className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                  speakerMode === "alternate" ? "border-primary/80 bg-primary/20 text-primary" : "border-white/10 bg-white/5 text-white"
                }`}
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>

              {isVideoCall && canSwitchCamera ? (
                <button
                  onClick={() => { void switchCamera(); }}
                  className="flex h-16 w-16 items-center justify-center rounded-3xl border-2 border-white/10 bg-white/5 text-white transition-smooth active:scale-90"
                  title="Переключить камеру"
                >
                  <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m0 0A7.5 7.5 0 0118.75 6M20 20v-5h-.581m0 0A7.5 7.5 0 015.25 18" />
                  </svg>
                </button>
              ) : null}
            </div>

            <button onClick={endCall} className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-2xl shadow-danger/40 transition-smooth active:scale-90">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
