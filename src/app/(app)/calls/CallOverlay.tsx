"use client";

import React, { useEffect, useRef } from "react";
import { useAudioCall } from "./CallProvider";
import Image from "next/image";

export function CallOverlay() {
  const { call, status, remoteStream, isMuted, error, acceptCall, declineCall, endCall, toggleMute } = useAudioCall();
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(err => {
        console.warn("[CALL] Autoplay blocked or failed", err);
      });
    }
  }, [remoteStream]);

  if (status === "idle" || !call) return null;

  const isIncoming = call.role === "callee" && status === "ringing";
  const isOutgoing = call.role === "caller" && status === "ringing";
  const isConnecting = status === "connecting";
  const isActive = status === "active";

  const fullAvatarUrl = call.user.avatarUrl 
    ? (call.user.avatarUrl.startsWith('http') ? call.user.avatarUrl : `/api/avatars/${call.user.avatarUrl}`)
    : null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col items-center justify-between bg-neutral-950/95 p-8 pb-16 backdrop-blur-2xl animate-in fade-in duration-500">
      <audio ref={audioRef} autoPlay playsInline />
      
      {/* Header Info */}
      <div className="mt-20 flex flex-col items-center text-center">
        <div className="relative mb-6 h-32 w-32">
          <div className={`absolute inset-0 rounded-[3rem] bg-primary/20 ${status === 'ringing' ? 'animate-ping' : ''}`} />
          <div className="relative flex h-full w-full items-center justify-center rounded-[3rem] border-4 border-white/10 bg-neutral-900 overflow-hidden shadow-2xl">
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-black text-primary">{call.user.displayName[0]}</span>
            )}
          </div>
        </div>
        
        <h2 className="text-3xl font-black tracking-tight text-white mb-2">{call.user.displayName}</h2>
        
        <div className="flex items-center gap-2">
          {status === 'active' && <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
          <p className="text-sm font-black uppercase tracking-[0.2em] text-primary/80">
            {isIncoming && "Входящий звонок..."}
            {isOutgoing && "Вызов..."}
            {isConnecting && "Соединение..."}
            {isActive && "Разговор"}
            {status === "failed" && "Ошибка"}
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-danger/10 px-4 py-2 text-xs font-bold text-danger border border-danger/20 animate-bounce">
            {error}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="w-full max-w-sm flex flex-col gap-8">
        {isIncoming ? (
          <div className="flex justify-around items-center gap-8 animate-in slide-in-from-bottom-10 duration-700">
            <button
              onClick={declineCall}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-2xl shadow-danger/40 active:scale-90 transition-smooth"
            >
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <button
              onClick={acceptCall}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-2xl shadow-primary/40 active:scale-90 transition-smooth"
            >
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
                  isMuted ? "bg-white text-black border-white" : "bg-white/5 text-white border-white/10"
                }`}
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
              
              <button
                className="flex h-16 w-16 items-center justify-center rounded-3xl border-2 bg-white/5 text-white border-white/10 active:scale-90 transition-smooth"
              >
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>

            <button
              onClick={endCall}
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-2xl shadow-danger/40 active:scale-90 transition-smooth"
            >
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
