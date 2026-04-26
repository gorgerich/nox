"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useAudioCall } from "./CallProvider";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";

export function CallOverlay() {
  const {
    call,
    status,
    remoteStream,
    needsTapToPlay,
    isMuted,
    error,
    registerRemoteAudioElement,
    enableRemoteAudioPlayback,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
  } = useAudioCall();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [mounted] = useState(() => typeof window !== "undefined");
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [speakerHint, setSpeakerHint] = useState<string | null>(null);

  useEffect(() => {
    registerRemoteAudioElement(audioRef.current);
    return () => registerRemoteAudioElement(null);
  }, [registerRemoteAudioElement]);

  const handleEnableAudio = () => {
    void enableRemoteAudioPlayback();
  };

  const handleToggleSpeaker = async () => {
    const mediaEl = audioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!mediaEl) {
      return;
    }

    if (typeof mediaEl.setSinkId !== "function" || typeof navigator === "undefined" || !navigator.mediaDevices) {
      setSpeakerHint("Громкая связь управляется системой устройства.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === "audiooutput");
      if (outputs.length === 0) {
        setSpeakerHint("Не найдено доступных аудиовыходов.");
        return;
      }

      let nextSink = "default";
      if (!isSpeakerOn) {
        const preferred = outputs.find((device) => /speaker|динам/i.test(device.label)) ?? outputs[0];
        nextSink = preferred.deviceId;
      }

      await mediaEl.setSinkId(nextSink);
      setIsSpeakerOn((prev) => !prev);
      setSpeakerHint(null);
    } catch (err) {
      console.warn("[CALL] Speaker switch failed", err);
      setSpeakerHint("Не удалось переключить аудиовыход.");
    }
  };

  useEffect(() => {
    if (!DEBUG_CALLS) {
      return;
    }

    console.log("[call-ui]", {
      status,
      isOverlayVisible: status !== "idle",
      hasCall: Boolean(call),
      needsTapToPlay,
    });
  }, [call, needsTapToPlay, status]);

  if (!mounted || status === "idle") {
    return null;
  }

  const peer = call?.user ?? { displayName: "Собеседник", avatarUrl: null };
  const isIncoming = call?.role === "callee" && status === "ringing";
  const isOutgoing = call?.role === "caller" && status === "ringing";
  const isConnecting = status === "connecting";
  const isActive = status === "active";

  const fullAvatarUrl = peer.avatarUrl
    ? (peer.avatarUrl.startsWith("http") ? peer.avatarUrl : `/api/avatars/${peer.avatarUrl}`)
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-between bg-neutral-950/95 p-8 pb-16 backdrop-blur-2xl animate-in fade-in duration-500 pointer-events-auto">
      <audio ref={audioRef} autoPlay playsInline />

      <div className="mt-20 flex flex-col items-center text-center">
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

        <h2 className="mb-2 text-3xl font-black tracking-tight text-white">{peer.displayName}</h2>

        <div className="flex items-center gap-2">
          {status === "active" ? <div className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : null}
          <p className="text-sm font-black uppercase tracking-[0.2em] text-primary/80">
            {isIncoming ? "Входящий звонок..." : null}
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
          <p className="mt-3 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white/80">
            {speakerHint}
          </p>
        ) : null}

        {needsTapToPlay && remoteStream ? (
          <button
            onClick={handleEnableAudio}
            className="mt-4 rounded-xl border border-primary/40 bg-primary/20 px-4 py-2 text-xs font-black uppercase tracking-wider text-primary transition-smooth active:scale-95"
          >
            Включить звук
          </button>
        ) : null}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-8">
        {isIncoming ? (
          <div className="flex items-center justify-around gap-8 animate-in slide-in-from-bottom-10 duration-700">
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
            <div className="flex justify-center gap-12">
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

              <button
                onClick={handleToggleSpeaker}
                className={`flex h-16 w-16 items-center justify-center rounded-3xl border-2 transition-smooth active:scale-90 ${
                  isSpeakerOn ? "border-primary bg-primary text-white" : "border-white/10 bg-white/5 text-white"
                }`}
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
