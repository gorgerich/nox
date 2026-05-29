"use client";

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
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setError("Нет доступа к камере. Разрешите камеру и микрофон.");
      }
    })();
    return () => { cancelled = true; stopStream(); };
  }, [stopStream]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recording) return;
    const mimeType = pickMimeType();
    try {
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
        videoBitsPerSecond: 450_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
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
  }, [onCapture, recording, stopStream]);

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
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex flex-col items-center justify-center bg-neutral-950/95 p-8 backdrop-blur-xl animate-in fade-in">
      <div className="relative mb-8 h-72 w-72 overflow-hidden rounded-full border-4 border-white/15 bg-neutral-900 shadow-2xl">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
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
        <p className="mb-6 text-xs font-black uppercase tracking-widest text-white/60">
          {recording ? "Идёт запись — нажмите, чтобы отправить" : "Видеосообщение"}
        </p>
      )}

      <div className="flex items-center gap-8">
        <button onClick={cancel} className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/15 bg-white/5 text-white transition-smooth active:scale-90" title="Отмена">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        {!recording ? (
          <button
            onClick={startRecording}
            disabled={!ready || !!error}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-2xl shadow-danger/40 transition-smooth active:scale-90 disabled:opacity-40"
            title="Записать"
          >
            <span className="h-7 w-7 rounded-full bg-white" />
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-2xl shadow-primary/40 transition-smooth active:scale-90"
            title="Отправить"
          >
            <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          </button>
        )}

        <div className="h-16 w-16" aria-hidden />
      </div>
    </div>,
    document.body,
  );
}
