"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useAudioCall } from "./CallProvider";

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const RINGBACK_INTERVAL_MS = 4000;
const RINGBACK_TONE_MS = 1200;

/** The local↔PiP morph target. Drag only offsets from here via `transform`,
    so the size/position animation and the drag gesture never fight over the
    same CSS properties. */
const PIP_RECT = { width: 104, height: 150, top: 12, right: 12 };
const PIP_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** One of the three equal circular controls shared by every call layout. */
function CallControlButton({
  onClick,
  active,
  loading,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      aria-pressed={active}
      className="flex flex-col items-center gap-1.5 disabled:opacity-40"
    >
      <span
        className={`fast-tap flex h-14 w-14 items-center justify-center rounded-full border backdrop-blur-xl transition-smooth ${
          active ? "border-white bg-white text-black" : "border-white/12 bg-white/10 text-white"
        }`}
      >
        {loading ? (
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          icon
        )}
      </span>
      <span className="text-[12px] font-medium text-white/75">{label}</span>
    </button>
  );
}

const MicIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
);
const MicOffIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18M9 9v3a3 3 0 004.24 2.73M15 9.34V5a3 3 0 00-5.94-.6M19 11a7 7 0 01-1.5 4.36M5 11a7 7 0 001.68 4.56M12 18v4m0 0H8m4 0h4" />
  </svg>
);
const SpeakerIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
);
const VideoIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
  </svg>
);
const CameraOffIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-.315.727M5 6h5m3 0h1a2 2 0 012 2v1m0 4v3a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 01.586-1.414" />
  </svg>
);
const FlipCameraIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h7a4 4 0 014 4v1m0 0l-3-3m3 3l3-3M17 17h-7a4 4 0 01-4-4v-1m0 0l3 3m-3-3l-3 3" />
  </svg>
);
const ChevronDownIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M6 9l6 6 6-6" />
  </svg>
);
const MoreIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);
const ScreenShareIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h18v11H3V5zm7 15h4M12 16v4" />
  </svg>
);
const PhoneIcon = () => (
  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" stroke="none">
    <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.9 21 3 13.1 3 3.4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8z" />
  </svg>
);

export function CallOverlay() {
  const {
    call,
    status,
    remoteStream,
    localStream,
    isMuted,
    isCameraOff,
    isVideo,
    hasLocalVideo,
    hasRemoteVideo,
    isRemoteCameraOff,
    isUpgradingVideo,
    isScreenSharing,
    error,
    debugInfo,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleVideo,
    switchCamera,
    toggleScreenShare,
    markRemoteAudioPlayback,
    clearError,
  } = useAudioCall();

  // Always mounted and renders nothing while idle, so the trap follows the
  // call status. No Escape handler: ending a call stays a deliberate action.
  const dialogRef = useFocusTrap<HTMLDivElement>(status !== "idle" && status !== "incoming");
  const incomingDialogRef = useFocusTrap<HTMLDivElement>(status === "incoming");
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
  const [minimized, setMinimized] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const activeSinceRef = useRef<number | null>(null);
  const [pipDrag, setPipDrag] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pipDragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number; pointerId: number } | null>(null);
  const [isDraggingPip, setIsDraggingPip] = useState(false);

  // Minimize/menu/PiP-position are per-call UI state that must never leak
  // into the next call — a caller who minimized call A and then, while still
  // minimized, receives call B should see B's real ringing screen, not an
  // already-minimized pill for a call they never touched. Reset "during
  // render" (React's own documented pattern for this — see the useState
  // reference on adjusting state when a prop changes) rather than in an
  // effect: it applies before this render commits, with no extra frame where
  // stale state would be visible, and it isn't a synchronous setState in an
  // effect body for the compiler to flag.
  const [resetForCallId, setResetForCallId] = useState<string | null>(null);
  const currentCallId = call?.callId ?? null;
  if (resetForCallId !== currentCallId) {
    setResetForCallId(currentCallId);
    setMinimized(false);
    setShowMoreMenu(false);
    setPipDrag({ x: 0, y: 0 });
  }

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

  // Bound once and kept bound regardless of layout branch — audio→video
  // upgrades and the ringing→connected PiP morph both change *how* these
  // elements are positioned, never whether they exist, so the stream is never
  // re-attached (no black-frame flash) when the layout changes around them.
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    video.srcObject = remoteStream ?? null;
    if (remoteStream) void video.play().catch(() => undefined);
  }, [remoteStream]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    video.srcObject = localStream ?? null;
    if (localStream) void video.play().catch(() => undefined);
  }, [localStream]);

  const isCallLive = status === "active" || status === "connecting" || status === "outgoing";
  useEffect(() => {
    const timeoutId = setTimeout(() => setControlsVisible(true), 0);
    return () => clearTimeout(timeoutId);
  }, [call?.callId, status]);

  // Call timer — starts counting the instant the call actually becomes
  // active, stops (and the ref clears) the instant it stops being active, so
  // a re-entry into "active" later (there isn't one today, but nothing here
  // assumes otherwise) would start a fresh count rather than resuming a stale one.
  useEffect(() => {
    if (status !== "active") {
      // Not reset via setState here: `elapsedSec` is only ever read while
      // `isActive`, so a stale value sitting unused between calls has no
      // render consequence, and this avoids a synchronous setState in an
      // effect body for a value nothing displays right now.
      activeSinceRef.current = null;
      return;
    }
    if (activeSinceRef.current === null) activeSinceRef.current = Date.now();
    const tick = () => {
      if (activeSinceRef.current !== null) {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - activeSinceRef.current) / 1000)));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status]);

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

  // Draggable PiP — a plain pointer-capture drag, offsetting via `transform`
  // so it never fights the fullscreen↔PiP morph, which animates top/right/
  // width/height instead. Clamped to the viewport on release.
  const handlePipPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pipDragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pipDrag.x,
      originY: pipDrag.y,
      pointerId: event.pointerId,
    };
    setIsDraggingPip(true);
  }, [pipDrag.x, pipDrag.y]);

  const handlePipPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pipDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPipDrag({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }, []);

  const handlePipPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pipDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pipDragStateRef.current = null;
    setIsDraggingPip(false);
    // Clamp so a drag can never leave the PiP stranded off-screen.
    setPipDrag((current) => {
      if (typeof window === "undefined") return current;
      const maxX = window.innerWidth - PIP_RECT.width - PIP_RECT.right;
      const maxY = window.innerHeight - PIP_RECT.height - PIP_RECT.top;
      return {
        x: Math.min(Math.max(current.x, -(window.innerWidth - PIP_RECT.width - PIP_RECT.right)), maxX),
        y: Math.min(Math.max(current.y, -PIP_RECT.top), maxY),
      };
    });
  }, []);

  const handleVideoButton = useCallback(() => {
    void toggleVideo();
  }, [toggleVideo]);

  if (typeof document === "undefined" || status === "idle") {
    return null;
  }

  const peer = call?.peerUser ?? { displayName: "Собеседник", avatarUrl: null };
  const isIncoming = call?.role === "callee" && status === "incoming";
  const isConnecting = status === "connecting";
  const isActive = status === "active";
  const isRinging = status === "outgoing" && call?.role === "caller";
  // The PiP layout only makes sense once the far side is genuinely sending
  // video — gating on the track itself (never on a status enum value) is what
  // keeps this from ever drawing a frame that has not arrived yet.
  const showRemoteFullscreen = hasRemoteVideo;
  const fullAvatarUrl = peer.avatarUrl
    ? (peer.avatarUrl.startsWith("http") ? peer.avatarUrl : `/api/avatars/${peer.avatarUrl}`)
    : null;
  const chromeVisibilityClass = controlsVisible ? "opacity-100" : "pointer-events-none opacity-0";
  const statusText = isIncoming
    ? "Входящий звонок…"
    : status === "outgoing"
      ? (isVideo ? "Видеозвонок…" : "Вызов…")
      : isConnecting
        ? "Соединение…"
        : isActive
          ? formatDuration(elapsedSec)
          : status === "failed"
            ? "Ошибка"
            : "";

  const localVideoStyle: React.CSSProperties = showRemoteFullscreen
    ? {
        position: "absolute",
        top: PIP_RECT.top,
        right: PIP_RECT.right,
        width: PIP_RECT.width,
        height: PIP_RECT.height,
        borderRadius: 22,
        transform: `translate(${pipDrag.x}px, ${pipDrag.y}px)`,
        transition: isDraggingPip ? "none" : `top 420ms ${PIP_EASE}, right 420ms ${PIP_EASE}, width 420ms ${PIP_EASE}, height 420ms ${PIP_EASE}, border-radius 420ms ${PIP_EASE}`,
      }
    : {
        position: "absolute",
        top: 0,
        right: 0,
        width: "100%",
        height: "100%",
        borderRadius: 0,
        transform: "translate(0, 0)",
        transition: `top 420ms ${PIP_EASE}, right 420ms ${PIP_EASE}, width 420ms ${PIP_EASE}, height 420ms ${PIP_EASE}, border-radius 420ms ${PIP_EASE}`,
      };

  // Minimised — a small "ongoing call" chip, the iOS pattern for a call that
  // keeps running while the rest of the app is used. The RTCPeerConnection,
  // streams and timer are all untouched; only this component's own presentation
  // collapses.
  if (minimized) {
    return createPortal(
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label={`Вернуться к звонку с ${peer.displayName}`}
        className="fast-tap fixed left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#2fbf47] px-4 py-2 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] safe-top"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 6px)" }}
      >
        <PhoneIcon />
        <span className="text-[13px] font-semibold tabular-nums">
          {isActive ? formatDuration(elapsedSec) : statusText}
        </span>
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1000] flex flex-col overflow-hidden bg-black animate-in fade-in duration-200 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? "Видеозвонок" : "Аудиозвонок"} с ${peer.displayName}`}
      onClick={() => {
        if (isVideo && isActive) setControlsVisible((value) => !value);
      }}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Remote camera. Always mounted (opacity-gated, never remounted) so the
          stream binding in the effect above never has to re-attach mid-call. */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 z-0 h-full w-full bg-black object-cover transition-opacity duration-500 ${
          showRemoteFullscreen && !isRemoteCameraOff ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Local camera — fullscreen while ringing/no remote video yet, morphs
          into the PiP the instant showRemoteFullscreen flips true. */}
      <div
        onPointerDown={showRemoteFullscreen ? handlePipPointerDown : undefined}
        onPointerMove={showRemoteFullscreen ? handlePipPointerMove : undefined}
        onPointerUp={showRemoteFullscreen ? handlePipPointerUp : undefined}
        onClick={(event) => { if (showRemoteFullscreen) event.stopPropagation(); }}
        style={localVideoStyle}
        className={`z-20 touch-none overflow-hidden bg-neutral-900 ${
          showRemoteFullscreen ? "cursor-grab border border-white/15 shadow-[0_14px_36px_rgba(0,0,0,0.35)] active:cursor-grabbing" : ""
        }`}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full -scale-x-100 bg-neutral-900 object-cover transition-opacity duration-300 ${
            hasLocalVideo && !isCameraOff ? "opacity-100" : "opacity-0"
          }`}
        />
        {(!hasLocalVideo || isCameraOff) && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
            <span className="text-sm font-semibold text-white/70">Вы</span>
          </div>
        )}
      </div>

      {/* Legibility gradient — only while a camera image is actually behind it. */}
      <div
        className={`pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black/55 via-transparent to-black/80 transition-opacity duration-500 ${
          isVideo ? "opacity-100" : "opacity-0"
        }`}
      />

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

      {/* Top bar: collapse + more. Not shown on the incoming-ringing screen —
          nothing to minimise or configure before the call is even accepted. */}
      {!isIncoming && (
        <div
          className={`relative z-30 flex items-center justify-between px-3 pt-[env(safe-area-inset-top,0px)] transition-opacity duration-200 ${chromeVisibilityClass}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Свернуть звонок"
            onClick={() => setMinimized(true)}
            className="fast-tap flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-xl"
          >
            <ChevronDownIcon />
          </button>
          {status === "outgoing" && !isVideo ? (
            <span className="text-[13px] font-medium text-white/55">Исходящий аудиозвонок</span>
          ) : <span />}
          <div className="relative">
            <button
              type="button"
              aria-label="Ещё"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              onClick={() => setShowMoreMenu((value) => !value)}
              className="fast-tap flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-xl"
            >
              <MoreIcon />
            </button>
            {showMoreMenu && (
              <div
                role="menu"
                className="premium-glass absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-2xl py-1 animate-in fade-in zoom-in-95 duration-150"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowMoreMenu(false); toggleScreenShare(); }}
                  disabled={!hasLocalVideo}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-white transition-smooth hover:bg-white/10 disabled:opacity-40"
                >
                  <ScreenShareIcon />
                  {isScreenSharing ? "Остановить демонстрацию" : "Демонстрация экрана"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={`relative z-10 flex flex-1 flex-col items-center justify-center text-center transition-opacity duration-200 ${isVideo && isActive ? chromeVisibilityClass : "opacity-100"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {!showRemoteFullscreen && (
          <div
            className={`relative mb-6 h-32 w-32 ${isRinging && !isVideo ? "animate-call-breathe" : ""}`}
          >
            <div className="absolute -inset-3 rounded-full bg-primary/14 blur-xl" />
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/15 bg-neutral-900 shadow-xl">
              {fullAvatarUrl ? (
                <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
              ) : (
                <span className="text-5xl font-semibold text-primary">{peer.displayName[0] ?? "?"}</span>
              )}
            </div>
          </div>
        )}

        <h2
          className={`mb-1 text-[28px] font-semibold tracking-tight text-white ${
            showRemoteFullscreen ? "drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]" : ""
          }`}
        >
          {peer.displayName}
        </h2>
        <p className={`text-[15px] font-medium tabular-nums ${isActive ? "text-white/85" : "text-white/60"}`}>
          {statusText}
        </p>

        {/* Only once the call is genuinely live — never during ringing, and
            never a stronger claim than what actually happens: WebRTC's own
            mandatory DTLS-SRTP, not the app's pinned-device-key E2EE that
            messages use. */}
        {isActive && (
          <p className="mt-2 flex items-center gap-1 text-[12px] font-medium text-white/45">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Звонок зашифрован
          </p>
        )}

        {error && error !== "CAMERA_PERMISSION_DENIED" ? (
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
            <span className="text-sm font-semibold text-primary">Включить звук</span>
          </button>
        ) : null}
      </div>

      <div
        className={`relative z-10 flex w-full flex-col gap-6 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] transition-opacity duration-200 ${isVideo && isActive ? chromeVisibilityClass : "opacity-100"}`}
        onClick={(event) => event.stopPropagation()}
      >
        {isIncoming ? (
          <div ref={incomingDialogRef} className="flex items-center justify-around gap-6 animate-in slide-in-from-bottom-10 duration-200">
            <button
              type="button"
              aria-label="Отклонить звонок"
              onClick={declineCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition-smooth active:scale-[0.96]"
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Принять звонок"
              onClick={acceptCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2fbf47] text-white shadow-lg transition-smooth active:scale-[0.96]"
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[280px] flex-col items-center gap-7">
            <div className="flex justify-center gap-6">
              <CallControlButton
                onClick={toggleMute}
                active={isMuted}
                label="Микрофон"
                icon={isMuted ? <MicOffIcon /> : <MicIcon />}
              />
              <CallControlButton
                onClick={() => void handleSpeakerToggle()}
                active={speakerMode === "alternate"}
                label="Динамик"
                icon={<SpeakerIcon />}
              />
              {hasLocalVideo ? (
                <CallControlButton
                  onClick={toggleVideo}
                  active={!isCameraOff}
                  label="Камера"
                  icon={isCameraOff ? <CameraOffIcon /> : <VideoIcon />}
                />
              ) : (
                <CallControlButton
                  onClick={handleVideoButton}
                  loading={isUpgradingVideo}
                  label="Видео"
                  icon={<VideoIcon />}
                />
              )}
              {hasLocalVideo && (
                <CallControlButton
                  onClick={() => void switchCamera()}
                  disabled={isScreenSharing}
                  label="Перевернуть"
                  icon={<FlipCameraIcon />}
                />
              )}
            </div>

            <button
              type="button"
              aria-label="Завершить звонок"
              onClick={endCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition-smooth active:scale-[0.96]"
            >
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* iOS-style permission sheet. No "Настройки" button: the app has no
          wired way to actually open the system settings screen, and a button
          that looks like it does that but doesn't would be worse than not
          having one. */}
      {error === "CAMERA_PERMISSION_DENIED" && (
        <div
          className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/50 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] animate-in fade-in duration-150"
          onClick={(event) => { event.stopPropagation(); }}
        >
          <div className="premium-glass w-full max-w-sm overflow-hidden rounded-2xl">
            <div className="px-5 py-4 text-center">
              <p className="text-[15px] font-semibold text-white">Нет доступа к камере</p>
              <p className="mt-1 text-[13px] leading-snug text-white/60">
                Разрешите доступ к камере в настройках iPhone, чтобы включить видео.
              </p>
            </div>
            <div className="h-px bg-white/10" />
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); clearError(); }}
              className="h-[52px] w-full text-[17px] font-semibold text-primary transition-smooth hover:bg-white/5"
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
