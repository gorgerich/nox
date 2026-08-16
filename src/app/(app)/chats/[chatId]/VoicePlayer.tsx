"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const WAVE_BARS = 24;

/**
 * A bar pattern derived from the message's own id.
 *
 * No amplitude data is captured anywhere in this product — the attachment row
 * stores a duration and nothing else — so this is decoration, not a reading of
 * the audio, and it is written to be honest about that rather than to look
 * like analysis. What it must not do is lie in the other direction: the shape
 * was a single hard-coded array, so every voice message in every conversation
 * had exactly the same silhouette. Seeding from the id gives each message a
 * stable identity of its own, recomputed never — the same message draws the
 * same shape on every render, every reopen, every device.
 */
function waveformFor(seed: string, bars: number): number[] {
  // xorshift over a cheap string hash. Deterministic, no allocation per frame,
  // and no dependency on Math.random, which would change on every render.
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
  return Array.from({ length: bars }, () => 28 + Math.round(next() * 64));
}

export function VoicePlayer({
  src,
  duration,
  isMine = false,
  cornerRadius = "round",
  waveformSeed,
}: {
  src: string;
  duration?: number;
  isMine?: boolean;
  cornerRadius?: "soft" | "round";
  /** Stable per-message value, so the shape never changes between renders. */
  waveformSeed?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bars = useMemo(() => waveformFor(waveformSeed ?? src, WAVE_BARS), [waveformSeed, src]);

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
        <div className="flex items-center gap-[2px] h-6" aria-hidden="true">
           {bars.map((height, index) => (
             <div
               key={index}
               className="min-w-[2px] flex-1 rounded-full transition-colors duration-200"
               style={{
                 height: `${height}%`,
                 backgroundColor: progress > (index / bars.length) * 100 ? activeWaveColor : waveColor
               }}
             />
           ))}
        </div>
        
        <div
          className="mt-1 flex items-center justify-between text-[11px] font-semibold tabular-nums"
          style={{ color: isMine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)" }}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{error ? "Ошибка" : isLoaded ? formatTime(totalDuration) : formatTime(totalDuration)}</span>
        </div>
      </div>
    </div>
  );
}
