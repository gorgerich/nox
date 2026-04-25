"use client";

import { useAudioCall } from "./CallProvider";

export function CallOverlay() {
  const { status, peer, isMuted, duration, error, acceptCall, declineCall, endCall, toggleMute } = useAudioCall();

  if (status === "idle") return null;

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const peerName = peer?.displayName || peer?.username || "Пользователь";

  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-between bg-neutral-950/95 p-8 text-white backdrop-blur-xl transition-all animate-in fade-in duration-500">
      <div className="safe-top mt-12 flex flex-col items-center text-center">
        <div className="mb-6 h-32 w-32 overflow-hidden rounded-[3rem] border-4 border-primary/20 bg-surface-hover shadow-2xl shadow-primary/10">
          {peer?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={peer.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl font-black text-primary">
              {peerName[0].toUpperCase()}
            </div>
          )}
        </div>
        
        <h2 className="text-3xl font-black tracking-tight">{peerName}</h2>
        
        <p className="mt-4 text-sm font-black uppercase tracking-[0.2em] text-primary animate-pulse">
          {status === "incoming" && "Входящий звонок..."}
          {status === "outgoing" && "Вызов..."}
          {status === "ringing" && "Ожидание..."}
          {status === "connecting" && "Соединение..."}
          {status === "active" && "Звонок активен"}
          {status === "ended" && "Звонок завершен"}
          {status === "declined" && "Вызов отклонен"}
          {status === "failed" && (error || "Ошибка вызова")}
        </p>

        {status === "active" && (
          <p className="mt-2 text-2xl font-mono font-bold tracking-wider">{formatTime(duration)}</p>
        )}
      </div>

      <div className="safe-bottom mb-12 flex w-full max-w-sm items-center justify-around gap-4 px-4">
        {status === "incoming" ? (
          <>
            <button 
              onClick={declineCall}
              className="touch-target flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/20 active:scale-90 transition-transform"
            >
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button 
              onClick={acceptCall}
              className="touch-target flex h-20 w-20 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20 active:scale-90 transition-transform"
            >
              <svg className="h-10 w-10 text-neutral-950" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
          </>
        ) : (status === "active" || status === "connecting" || status === "ringing" || status === "outgoing") ? (
          <>
            <button 
              onClick={toggleMute}
              className={`touch-target flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${isMuted ? "bg-white text-neutral-950 border-white" : "bg-white/10 text-white border-white/20"}`}
            >
              {isMuted ? (
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2.5" />
                </svg>
              ) : (
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
            <button 
              onClick={endCall}
              className="touch-target flex h-20 w-20 items-center justify-center rounded-full bg-red-500 shadow-xl shadow-red-500/20 active:scale-90 transition-transform"
            >
              <svg className="h-10 w-10 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
          </>
        ) : (
          <button 
            disabled 
            className="touch-target flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800 text-white/50 opacity-50"
          >
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
