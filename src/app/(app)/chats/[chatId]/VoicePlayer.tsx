"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export function VoicePlayer({ 
  src, 
  duration, 
  isMine = false,
  cornerRadius = "round"
}: { 
  src: string; 
  duration?: number;
  isMine?: boolean;
  cornerRadius?: "soft" | "round";
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const formatTime = useCallback((seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleLoadedMetadata = () => {
      setIsLoaded(true);
      if (audio.duration && !isNaN(audio.duration)) {
        setTotalDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    const handleError = () => {
      setError(true);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, []);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
      setError(true);
    }
  };

  const waveColor = isMine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)";
  const activeWaveColor = isMine ? "var(--bubble-outgoing-fg)" : "var(--bubble-incoming-fg)";
  const bgControl = isMine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)";
  const radiusClass = cornerRadius === "round" ? "rounded-2xl" : "rounded-xl";

  return (
    <div className={`flex items-center gap-3 py-1.5 min-w-[200px] transition-smooth ${radiusClass}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      
      <button
        type="button"
        aria-label={error ? "Голосовое сообщение недоступно" : isPlaying ? "Пауза" : "Воспроизвести голосовое сообщение"}
        onClick={() => void togglePlay()}
        disabled={error}
        className={`touch-target h-11 w-11 flex shrink-0 items-center justify-center transition-smooth active:scale-[0.96] hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none shadow-sm ${radiusClass}`}
        style={{ backgroundColor: bgControl, color: activeWaveColor }}
      >
        {error ? (
          <svg className="h-5 w-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : isPlaying ? (
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-7 mb-1.5 opacity-80">
           {[30, 60, 40, 80, 50, 70, 40, 90, 60, 40, 70, 50, 80, 40, 60].map((h, i) => (
             <div 
               key={i} 
               className="w-[3px] rounded-full transition-colors duration-300"
               style={{ 
                 height: `${h}%`,
                 backgroundColor: progress > (i / 15) * 100 ? activeWaveColor : waveColor
               }}
             />
           ))}
        </div>
        
        <div className="relative h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--chat-focus-ring)" }}>
          {/* scaleX, not width: this bar moves on every timeupdate while a voice
              message plays, and animating width ran layout and paint for the
              whole bubble each time. A scale is composited, and the origin puts
              the growth on the left where the fill belongs. */}
          <div
            className="absolute left-0 top-0 h-full w-full origin-left transition-[transform,background-color] duration-100 ease-linear"
            style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})`, backgroundColor: activeWaveColor }}
          />
        </div>
        
        <div
          className="mt-2 flex items-center justify-between text-[11px] font-semibold tabular-nums"
          style={{ color: isMine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)" }}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{error ? "Ошибка" : isLoaded ? formatTime(totalDuration) : formatTime(totalDuration)}</span>
        </div>
      </div>
    </div>
  );
}
