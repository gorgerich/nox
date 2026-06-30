"use client";

import { Camera, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MAX_DURATION_SEC = 60;

function pickMimeType(): string {
  const candidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function VideoMessageRecorder({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldCaptureOnStopRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const discardRecording = useCallback(() => {
    const recorder = recorderRef.current;
    shouldCaptureOnStopRef.current = false;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Recorder may already be stopping.
        }
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const bindPreview = useCallback((stream: MediaStream) => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, []);

  const openStream = useCallback(async (mode: "user" | "environment") => {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  }, []);

  const startRecordingForStream = useCallback((stream: MediaStream) => {
    if (recorderRef.current?.state === "recording") return;
    const mimeType = pickMimeType();
    try {
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
        videoBitsPerSecond: 450_000,
      });
      chunksRef.current = [];
      shouldCaptureOnStopRef.current = true;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        if (!shouldCaptureOnStopRef.current) {
          chunksRef.current = [];
          shouldCaptureOnStopRef.current = true;
          return;
        }
        const type = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `video-message-${Date.now()}.${ext}`, { type });
        stopStream();
        onCapture(file);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_DURATION_SEC) {
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.stop();
            }
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("Запись видео не поддерживается этим браузером.");
    }
  }, [onCapture, stopStream]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await openStream("user");
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        bindPreview(stream);
        setReady(true);
      } catch {
        setError("Нет доступа к камере. Разрешите камеру и микрофон.");
      }
    })();
    return () => {
      cancelled = true;
      discardRecording();
      stopStream();
    };
  }, [bindPreview, discardRecording, openStream, stopStream]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    startRecordingForStream(stream);
  }, [startRecordingForStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }, []);

  // Start recording automatically as soon as the camera is ready — one tap to
  // open, one tap to send (no separate "start" press).
  const startedRef = useRef(false);
  useEffect(() => {
    if (ready && !startedRef.current && !error) {
      startedRef.current = true;
      startRecording();
    }
  }, [ready, error, startRecording]);

  const cancel = useCallback(() => {
    discardRecording();
    stopStream();
    onClose();
  }, [discardRecording, onClose, stopStream]);

  const switchCamera = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    const wasRecording = recorderRef.current?.state === "recording";

    try {
      setReady(false);
      if (wasRecording) {
        discardRecording();
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRecording(false);
        setSeconds(0);
      }

      stream.getTracks().forEach((track) => track.stop());
      const nextStream = await openStream(nextFacingMode);
      streamRef.current = nextStream;
      bindPreview(nextStream);
      setFacingMode(nextFacingMode);
      setReady(true);
      if (wasRecording) {
        startRecordingForStream(nextStream);
      }
    } catch {
      try {
        const fallbackStream = await openStream(facingMode);
        streamRef.current = fallbackStream;
        bindPreview(fallbackStream);
        setReady(true);
        if (wasRecording) {
          startRecordingForStream(fallbackStream);
        }
      } catch {
        setReady(false);
      }
      setError("Не удалось переключить камеру.");
      setTimeout(() => setError(null), 2200);
    }
  }, [bindPreview, discardRecording, facingMode, openStream, startRecordingForStream]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex flex-col items-center justify-center bg-neutral-950 p-8 animate-in fade-in" role="dialog" aria-modal="true" aria-label="Запись видеосообщения">
      <div className="relative mb-8 h-72 w-72 overflow-hidden rounded-full border-4 border-white/15 bg-neutral-900 shadow-2xl">
        <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`} />
        {recording && (
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1">
            <span className="h-2 w-2 animate-ping rounded-full bg-danger" />
            <span className="text-xs font-black text-white">{Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}</span>
          </div>
        )}
      </div>

      {error ? (
        <p className="mb-6 max-w-xs rounded-xl border border-danger/20 bg-danger/10 px-4 py-2 text-center text-xs font-bold text-danger">{error}</p>
      ) : (
        <p className="mb-6 text-sm font-medium text-white/60">
          {recording ? "Идёт запись — нажмите, чтобы отправить" : "Видеосообщение"}
        </p>
      )}

      <div className="flex items-center gap-8">
        <button type="button" onClick={cancel} className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-smooth active:scale-[0.96]" aria-label="Отмена">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={!ready || !!error}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-lg transition-smooth active:scale-[0.96] disabled:opacity-40"
            aria-label="Начать запись"
          >
            <span className="h-7 w-7 rounded-full bg-white" />
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-smooth active:scale-[0.96]"
            aria-label="Отправить видеосообщение"
          >
            <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          </button>
        )}

        <button
          type="button"
          onClick={() => void switchCamera()}
          disabled={!ready}
          className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-smooth active:scale-[0.96] disabled:opacity-40"
          aria-label="Переключить камеру"
        >
          <RotateCcw className="h-7 w-7" strokeWidth={2.3} />
          <Camera className="absolute h-3.5 w-3.5 translate-x-1.5 translate-y-1.5" strokeWidth={2.4} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
