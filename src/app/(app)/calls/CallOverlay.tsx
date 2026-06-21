"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const { call, status, remoteStream, localStream, isMuted, isCameraOff, isVideo, isScreenSharing, error, debugInfo, acceptCall, declineCall, endCall, toggleMute, toggleCamera, switchCamera, markRemoteAudioPlayback } = useAudioCall();
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const ringbackContextRef = useRef<AudioContext | null>(null);
  const ringbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const [speakerHint, setSpeakerHint] = useState<string | null>(null);
  const [speakerMode, setSpeakerMode] = useState<"default" | "alternate">("default");
  const [audioPlayStatus, setAudioPlayStatus] = useState<"idle" | "pending" | "success" | "failed">("idle");
  const [audioSrcAssigned, setAudioSrcAssigned] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const debugCall = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_CALLS) return;
    console.log(`[call-debug] ${label}`, data);
  }, []);

  const attachAndPlayRemoteAudio = useCallback((source: string) => {
    const audio = remoteAudioRef.current;
    if (!audio || !remoteStream) return;

    audio.srcObject = remoteStream;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.muted = false;
    audio.volume = 1;
    setAudioSrcAssigned(true);
    markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "pending" });

    debugCall("audio srcObject assigned", {
      source,
      audioTracks: remoteStream.getAudioTracks().length,
      hasSrcObject: Boolean(audio.srcObject),
    });

    setAudioPlayStatus("pending");
    void audio.play().then(() => {
      setNeedsTapToPlay(false);
      setAudioPlayStatus("success");
      markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "success" });
      debugCall("audio.play success", { source });
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      setAudioPlayStatus("failed");
      markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "failed" });
      debugCall("audio.play failed", { source, error: String(playError) });
    });
  }, [debugCall, markRemoteAudioPlayback, remoteStream]);

  useEffect(() => {
    if (!remoteStream) {
      const audio = remoteAudioRef.current;
      if (audio) {
        audio.srcObject = null;
        setAudioSrcAssigned(false);
        setAudioPlayStatus("idle");
        markRemoteAudioPlayback({ srcObjectAssigned: false, playStatus: "idle" });
      }
      return;
    }

    attachAndPlayRemoteAudio("remoteStream effect");
  }, [attachAndPlayRemoteAudio, markRemoteAudioPlayback, remoteStream]);

  // Bind the remote stream to the (muted) video element for picture — audio still
  // plays through the <audio> element above so we never double up the sound.
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    video.srcObject = remoteStream ?? null;
    if (remoteStream) void video.play().catch(() => undefined);
  }, [remoteStream, isVideo]);

  // Bind our own camera to the local preview.
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    video.srcObject = localStream ?? null;
    if (localStream) void video.play().catch(() => undefined);
  }, [localStream, isVideo]);

  const isCallLive = status === "active" || status === "connecting" || status === "outgoing";
  useEffect(() => {
    const timeoutId = setTimeout(() => setControlsVisible(true), 0);
    return () => clearTimeout(timeoutId);
  }, [call?.callId, status]);

  useEffect(() => {
    if (!isCallLive) return;

    const resumeOverlayAudio = () => {
      const audio = remoteAudioRef.current;
      if (audio && audio.srcObject && audio.paused) {
        void audio.play().catch(() => undefined);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") resumeOverlayAudio();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", resumeOverlayAudio);
    window.addEventListener("focus", resumeOverlayAudio);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", resumeOverlayAudio);
      window.removeEventListener("focus", resumeOverlayAudio);
    };
  }, [isCallLive]);

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

  const isRingingTone = status === "incoming" || (call?.role === "caller" && status === "outgoing");

  useEffect(() => {
    if (!isRingingTone) {
      stopRingback("not-ringing");
      return;
    }

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!AudioContextCtor) return;

    stopRingback("restart");
    const context = new AudioContextCtor();
    ringbackContextRef.current = context;

    const playTone = () => {
      if (!ringbackContextRef.current) return;
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = status === "incoming" ? 660 : 425;
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
      playTone();
      ringbackIntervalRef.current = setInterval(playTone, RINGBACK_INTERVAL_MS);
    }).catch((ringError) => {
      debugCall("ringback start blocked", { error: String(ringError) });
    });

    return () => {
      stopRingback("effect cleanup");
    };
  }, [debugCall, isRingingTone, status, stopRingback]);

  useEffect(() => {
    if (!speakerHint) return;
    const timeoutId = setTimeout(() => setSpeakerHint(null), 2500);
    return () => clearTimeout(timeoutId);
  }, [speakerHint]);

  const handleTapToPlay = useCallback(() => {
    const audio = remoteAudioRef.current;
    if (!audio || !remoteStream) return;
    audio.srcObject = remoteStream;
    audio.muted = false;
    audio.volume = 1;
    setAudioPlayStatus("pending");
    markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "pending" });
    void audio.play().then(() => {
      setNeedsTapToPlay(false);
      setAudioPlayStatus("success");
      markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "success" });
      debugCall("tap-to-play success");
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      setAudioPlayStatus("failed");
      markRemoteAudioPlayback({ srcObjectAssigned: true, playStatus: "failed" });
      debugCall("tap-to-play fail", { error: String(playError) });
    });
  }, [debugCall, markRemoteAudioPlayback, remoteStream]);

  const handleSpeakerToggle = useCallback(async () => {
    const audio = remoteAudioRef.current as SinkAudioElement | null;
    if (!audio) return;

    if (typeof audio.setSinkId !== "function") {
      setSpeakerHint("Громкая связь управляется системой устройства");
      debugCall("speaker fallback", { reason: "setSinkId unsupported" });
      return;
    }

    try {
      if (speakerMode === "default") {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((device) => device.kind === "audiooutput");
        const nextOutput = outputs.find((device) => device.deviceId !== (audio.sinkId ?? "default"));
        if (!nextOutput) {
          setSpeakerHint("Громкая связь управляется системой устройства");
          return;
        }
        await audio.setSinkId(nextOutput.deviceId);
        setSpeakerMode("alternate");
        setSpeakerHint(nextOutput.label ? `Вывод: ${nextOutput.label}` : "Устройство вывода переключено");
      } else {
        await audio.setSinkId("default");
        setSpeakerMode("default");
        setSpeakerHint("Вывод: системный по умолчанию");
      }
    } catch (speakerError) {
      setSpeakerHint("Громкая связь управляется системой устройства");
      debugCall("speaker fallback", { reason: "setSinkId failed", error: String(speakerError) });
    }
  }, [debugCall, speakerMode]);

  if (typeof document === "undefined" || status === "idle") {
    return null;
  }

  const peer = call?.peerUser ?? { displayName: "Собеседник", avatarUrl: null };
  const isIncoming = call?.role === "callee" && status === "incoming";
  const isConnecting = status === "connecting";
  const isActive = status === "active";
  const fullAvatarUrl = peer.avatarUrl
    ? (peer.avatarUrl.startsWith("http") ? peer.avatarUrl : `/api/avatars/${peer.avatarUrl}`)
    : null;
  const chromeVisibilityClass = controlsVisible ? "opacity-100" : "pointer-events-none opacity-0";

  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex flex-col items-center justify-between overflow-hidden bg-neutral-950 p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto"
      onClick={() => {
        if (isVideo && isActive) setControlsVisible((value) => !value);
      }}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {isVideo && (
        <>
          {/* Remote camera, full-screen background. Muted: sound comes from <audio> above. */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 z-0 h-full w-full bg-black object-cover transition-opacity duration-300 ${remoteStream ? "opacity-100" : "opacity-0"}`}
          />
          {/* Legibility gradient over the video for the name/controls. */}
          <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/50 via-transparent to-black/75" />
          {/* Local camera preview (picture-in-picture). */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`absolute right-3 top-20 z-20 h-32 w-24 -scale-x-100 rounded-2xl border border-white/15 bg-neutral-900 object-cover shadow-2xl transition-opacity duration-200 ${isCameraOff || !controlsVisible ? "opacity-0" : "opacity-100"}`}
          />
        </>
      )}

      {DEBUG_CALLS && (
        <div className="absolute left-4 top-24 z-50 max-w-[200px] rounded-lg bg-black/80 p-3 text-[10px] font-mono text-green-500 shadow-xl backdrop-blur-md">
          <div className="mb-1 border-b border-green-500/30 pb-1 font-bold">CALL DEBUG</div>
          <div>ID: {debugInfo.callId?.slice(0, 8)}...</div>
          <div>Role: {debugInfo.role}</div>
          <div>Status: {debugInfo.status}</div>
          <div>Source: {debugInfo.pushSource || "foreground"}</div>
          <div>Signaling: {debugInfo.signalingState}</div>
          <div>Conn: {debugInfo.connectionState}</div>
          <div>ICE: {debugInfo.iceConnectionState}</div>
          <div>Local Tracks: {debugInfo.localAudioTracks}</div>
          <div>Remote Tracks: {debugInfo.remoteAudioTracks}</div>
          <div className="mt-1 border-t border-green-500/30 pt-1">
            Out: {(debugInfo.outboundBytes / 1024).toFixed(1)} KB ({debugInfo.outboundPackets})
          </div>
          <div>Out video: {(debugInfo.outboundVideoBytes / 1024).toFixed(1)} KB</div>
          <div>
            In: {(debugInfo.inboundBytes / 1024).toFixed(1)} KB ({debugInfo.inboundPackets})
          </div>
          <div>In video: {(debugInfo.inboundVideoBytes / 1024).toFixed(1)} KB</div>
          <div>Rate out: {debugInfo.outboundKbps.toFixed(0)} kbps</div>
          <div>Rate in: {debugInfo.inboundKbps.toFixed(0)} kbps</div>
          <div>MB/min out: {debugInfo.outboundMbPerMin.toFixed(2)}</div>
          <div>MB/min in: {debugInfo.inboundMbPerMin.toFixed(2)}</div>
          <div className="mt-1 border-t border-green-500/30 pt-1">
            Pair: {debugInfo.candidatePair || "N/A"}
          </div>
          <div>L: {debugInfo.localCandidateType || "N/A"}</div>
          <div>R: {debugInfo.remoteCandidateType || "N/A"}</div>
          <div>TURN: {debugInfo.turnPresent ? "YES" : "NO"}</div>
          <div>Relay policy: {debugInfo.forceRelay ? "force" : "all"}</div>
          <div className="mt-1 border-t border-green-500/30 pt-1">
            Stream: {debugInfo.remoteStreamExists ? "YES" : "NO"}
          </div>
          <div>Audio Src: {debugInfo.audioSrcObjectAssigned || audioSrcAssigned ? "YES" : "NO"}</div>
          <div>Play: {debugInfo.audioPlayStatus || audioPlayStatus}</div>
          {!debugInfo.turnPresent && (
            <div className="mt-1 text-red-500 underline underline-offset-2">TURN not configured</div>
          )}
        </div>
      )}

      <div
        className={`relative z-10 mt-20 flex flex-col items-center text-center transition-opacity duration-200 ${isVideo && isActive ? chromeVisibilityClass : "opacity-100"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {!(isVideo && remoteStream) && (
          <div className="relative mb-6 h-32 w-32">
            <div className={`absolute inset-0 rounded-[3rem] bg-primary/20 ${status === "incoming" || status === "outgoing" ? "animate-ping" : ""}`} />
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[3rem] border-4 border-white/10 bg-neutral-900 shadow-2xl">
              {fullAvatarUrl ? (
                <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
              ) : (
                <span className="text-5xl font-black text-primary">{peer.displayName[0] ?? "?"}</span>
              )}
            </div>
          </div>
        )}

        <h2 className="mb-2 text-3xl font-black tracking-tight text-white drop-shadow-lg">{peer.displayName}</h2>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-primary/80">
          {status === "incoming" ? "Входящий звонок..." : null}
          {status === "outgoing" ? "Вызов..." : null}
          {isConnecting ? "Соединение..." : null}
          {isActive ? "Разговор" : null}
          {status === "failed" ? "Ошибка" : null}
        </p>

        {error ? (
          <p className="mt-4 rounded-xl border border-danger/20 bg-danger/10 px-4 py-2 text-xs font-bold text-danger">
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
            className="mt-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-primary bg-primary/20 px-6 py-4 transition-smooth active:scale-[0.96]"
          >
            <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <span className="text-sm font-black uppercase tracking-[0.12em] text-primary">Включить звук</span>
          </button>
        ) : null}
      </div>

      <div
        className={`relative z-10 flex w-full max-w-xs flex-col gap-5 transition-opacity duration-200 ${isVideo && isActive ? chromeVisibilityClass : "opacity-100"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {isIncoming ? (
          <div className="flex items-center justify-around gap-6 animate-in slide-in-from-bottom-10 duration-200">
            <button onClick={declineCall} className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-xl shadow-danger/30 transition-smooth active:scale-[0.96]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button onClick={acceptCall} className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-xl shadow-primary/30 transition-smooth active:scale-[0.96]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex justify-center gap-3">
              <button
                onClick={toggleMute}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition-smooth active:scale-[0.96] ${
                  isMuted ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"
                }`}
                title={isMuted ? "Включить микрофон" : "Выключить микрофон"}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>

              <button
                onClick={handleSpeakerToggle}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition-smooth active:scale-[0.96] ${
                  speakerMode === "alternate" ? "border-primary/80 bg-primary/20 text-primary" : "border-white/10 bg-white/5 text-white"
                }`}
                title="Громкая связь"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>

              {isVideo && (
                <button
                  onClick={toggleCamera}
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl border transition-smooth active:scale-[0.96] ${
                    isCameraOff ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"
                  }`}
                  title={isCameraOff ? "Включить камеру" : "Выключить камеру"}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
                  </svg>
                </button>
              )}

              {isVideo && (
                <button
                  onClick={() => void switchCamera()}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white transition-smooth active:scale-[0.96] disabled:opacity-40"
                  disabled={isScreenSharing}
                  title="Переключить камеру"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h7a4 4 0 014 4v1m0 0l-3-3m3 3l3-3M17 17h-7a4 4 0 01-4-4v-1m0 0l3 3m-3-3l-3 3" />
                  </svg>
                </button>
              )}
            </div>

            <button onClick={endCall} className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-xl shadow-danger/30 transition-smooth active:scale-[0.96]">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
