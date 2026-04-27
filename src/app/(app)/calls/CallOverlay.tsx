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
  const { call, status, remoteStream, isMuted, error, acceptCall, declineCall, endCall, toggleMute } = useAudioCall();
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const ringbackContextRef = useRef<AudioContext | null>(null);
  const ringbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const [speakerHint, setSpeakerHint] = useState<string | null>(null);
  const [speakerMode, setSpeakerMode] = useState<"default" | "alternate">("default");

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

    debugCall("audio srcObject assigned", {
      source,
      audioTracks: remoteStream.getAudioTracks().length,
      hasSrcObject: Boolean(audio.srcObject),
    });

    void audio.play().then(() => {
      setNeedsTapToPlay(false);
      debugCall("audio.play success", { source });
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      debugCall("audio.play failed", { source, error: String(playError) });
    });
  }, [debugCall, remoteStream]);

  useEffect(() => {
    if (!remoteStream) {
      const audio = remoteAudioRef.current;
      if (audio) audio.srcObject = null;
      return;
    }

    attachAndPlayRemoteAudio("remoteStream effect");
  }, [attachAndPlayRemoteAudio, remoteStream]);

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

  const isOutgoing = call?.role === "caller" && status === "outgoing";

  useEffect(() => {
    if (!isOutgoing) {
      stopRingback("not-outgoing");
      return;
    }

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!AudioContextCtor) return;

    stopRingback("restart");
    const context = new AudioContextCtor();
    ringbackContextRef.current = context;

    const playTone = () => {
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
      playTone();
      ringbackIntervalRef.current = setInterval(playTone, RINGBACK_INTERVAL_MS);
    }).catch((ringError) => {
      debugCall("ringback start blocked", { error: String(ringError) });
    });

    return () => {
      stopRingback("effect cleanup");
    };
  }, [debugCall, isOutgoing, stopRingback]);

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
    void audio.play().then(() => {
      setNeedsTapToPlay(false);
      debugCall("tap-to-play success");
    }).catch((playError) => {
      setNeedsTapToPlay(true);
      debugCall("tap-to-play fail", { error: String(playError) });
    });
  }, [debugCall, remoteStream]);

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

  return createPortal(
    <div className="fixed inset-0 z-1000 flex flex-col items-center justify-between bg-neutral-950/95 p-8 pb-[calc(env(safe-area-inset-bottom,0px)+4rem)] backdrop-blur-xl animate-in fade-in duration-200 pointer-events-auto">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="mt-20 flex flex-col items-center text-center">
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

        <h2 className="mb-2 text-3xl font-black tracking-tight text-white">{peer.displayName}</h2>
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
            <div className="flex justify-center gap-4">
              <button
                onClick={toggleMute}
                className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                  isMuted ? "border-white bg-white text-black" : "border-white/10 bg-white/5 text-white"
                }`}
                title={isMuted ? "Включить микрофон" : "Выключить микрофон"}
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>

              <button
                onClick={handleSpeakerToggle}
                className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                  speakerMode === "alternate" ? "border-primary/80 bg-primary/20 text-primary" : "border-white/10 bg-white/5 text-white"
                }`}
                title="Громкая связь"
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
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
