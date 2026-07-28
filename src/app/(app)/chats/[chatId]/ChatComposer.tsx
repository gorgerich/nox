"use client";

import { Check, Mic, Paperclip, Send, Smile, Video, X } from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import { VideoMessageRecorder } from "./VideoMessageRecorder";
import { EMOJI_GROUPS } from "@/lib/emoji-data";
import { useClientValue } from "@/lib/use-client-value";

export type CaptureMode = "voice" | "video";

/** Hold longer than this and the press starts a recording instead of toggling. */
const CAPTURE_HOLD_MS = 320;
/** Movement beyond this cancels the gesture entirely. */
const CAPTURE_MOVE_CANCEL_PX = 12;

export function ChatComposer({
  chatId,
  onSend,
  onTyping,
  onVoiceStart,
  onVoiceStop,
  onVoiceCancel,
  onFilesSelected,
  onVideoMessageCaptured,
  isRecording,
  recordingDuration,
  isLocked,
  pending,
  replyingTo,
  editingTo,
  onCancelAction,
}: {
  chatId: string;
  onSend: (text: string) => Promise<void> | void;
  onTyping: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceCancel: () => void;
  onFilesSelected?: (files: File[]) => void;
  onVideoMessageCaptured?: (file: File) => Promise<void> | void;
  isRecording: boolean;
  recordingDuration: number;
  isLocked: boolean;
  pending: boolean;
  replyingTo?: { id: string; body: string | null; sender: { profile: { displayName: string } | null; username: string } } | null;
  editingTo?: { id: string; body: string | null } | null;
  onCancelAction: () => void;
}) {
  const [text, setText] = useState("");
  // False in the server-rendered markup, true from the first client render on.
  // Until React is live the textarea is inert: text put into it is discarded by
  // hydration and Enter has no handler, so automation that types too early
  // loses the message and still sees an empty composer — a green check over a
  // send that never happened. This flag says when Enter works.
  const interactive = useClientValue(() => true, false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  // One source of truth for which capture the record button will start.
  // Replaces the old popover that made the user pick "Голосовое"/"Кружок".
  const [captureMode, setCaptureMode] = useState<CaptureMode>("voice");
  const [modeAnnouncement, setModeAnnouncement] = useState("");
  // Press state machine: a short tap switches mode, a hold starts recording.
  // Tracked in refs so a hold that became a recording never also toggles.
  const pressRef = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | null; startedRecording: boolean; cancelled: boolean } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const editingIdRef = useRef<string | null>(null);
  const draftKey = `nox:draft:${chatId}`;

  const insertEmoji = useCallback((emoji: string) => {
    setText((prev) => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? prev.length;
      const end = el?.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      onTyping(next);
      requestAnimationFrame(() => {
        if (el) {
          const pos = start + emoji.length;
          el.setSelectionRange(pos, pos);
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      });
      return next;
    });
  }, [onTyping]);

  useEffect(() => {
    if (!showEmoji) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !emojiPanelRef.current?.contains(target) &&
        !emojiButtonRef.current?.contains(target)
      ) {
        setShowEmoji(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showEmoji]);

  // Restore a saved draft for this chat (client-only to avoid hydration mismatch).
  useEffect(() => {
    if (editingTo) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft) {
        timer = setTimeout(() => {
          setText(draft);
          if (inputRef.current) {
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = inputRef.current.scrollHeight + "px";
          }
        }, 0);
      }
    } catch { /* localStorage unavailable */ }
    return () => {
      if (timer) clearTimeout(timer);
    };
    // Only when switching chats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Persist the draft as the user types (but not while editing an existing message).
  useEffect(() => {
    if (editingTo) return;
    try {
      if (text.trim()) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch { /* ignore */ }
  }, [text, editingTo, draftKey]);

  useEffect(() => {
    if (editingTo && editingTo.id !== editingIdRef.current) {
      editingIdRef.current = editingTo.id;
      // Using a microtask or small timeout to avoid the cascading render warning
      const targetText = editingTo.body || "";
      setTimeout(() => {
        setText(targetText);
        if (inputRef.current) {
          inputRef.current.focus();
          const el = inputRef.current;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        }
      }, 0);
    } else if (!editingTo && !replyingTo && editingIdRef.current !== null) {
      editingIdRef.current = null;
      setTimeout(() => {
        setText("");
        if (inputRef.current) inputRef.current.style.height = 'auto';
      }, 0);
    }
  }, [editingTo, replyingTo]);

  // Guards a double tap on send from handing the same draft over twice.
  const sendingRef = useRef(false);

  const resetInputHeight = useCallback(() => {
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, []);

  /**
   * The draft is cleared only after `onSend` resolves, and `onSend` resolves
   * once the message is durably stored — not once it is delivered. Clearing
   * first, as this did before, meant a failure between the two lost whatever
   * the user had typed.
   */
  const handleSend = useCallback(async () => {
    const draft = text;
    if (!draft.trim() || sendingRef.current) return;
    sendingRef.current = true;

    try {
      await onSend(draft);
      setText("");
      setShowEmoji(false);
      onTyping("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      editingIdRef.current = null;
      resetInputHeight();
    } catch (error) {
      // The message was not stored, so the text stays exactly where it was.
      console.error("Failed to accept message:", error);
      if (!editingTo) {
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.style.height = "auto";
            inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
          }
        });
      }
    } finally {
      sendingRef.current = false;
    }
  }, [editingTo, onSend, onTyping, resetInputHeight, text]);

  const activateCapture = useCallback(() => {
    if (captureMode === "voice") onVoiceStart();
    else setShowVideoRecorder(true);
  }, [captureMode, onVoiceStart]);

  // The next mode is derived from a ref rather than inside the state updater:
  // updaters must stay pure (React invokes them twice in development), and
  // announcing from inside one made the mode flip twice and land back where it
  // started.
  const captureModeRef = useRef<CaptureMode>("voice");
  const toggleCaptureMode = useCallback(() => {
    const next: CaptureMode = captureModeRef.current === "voice" ? "video" : "voice";
    captureModeRef.current = next;
    setCaptureMode(next);
    setModeAnnouncement(next === "voice" ? "Выбран режим голосового сообщения" : "Выбран режим видеосообщения");
  }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  const handleCapturePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || isRecording || text.trim()) return;
    const timer = setTimeout(() => {
      if (pressRef.current && !pressRef.current.cancelled) {
        pressRef.current.startedRecording = true;
        activateCapture();
      }
    }, CAPTURE_HOLD_MS);
    pressRef.current = { x: event.clientX, y: event.clientY, timer, startedRecording: false, cancelled: false };
  }, [activateCapture, isRecording, text]);

  const handleCapturePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press || press.startedRecording) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CAPTURE_MOVE_CANCEL_PX) {
      press.cancelled = true;
      if (press.timer) clearTimeout(press.timer);
    }
  }, []);

  const handleCapturePointerUp = useCallback(() => {
    const press = pressRef.current;
    clearPress();
    // A hold that already began recording must never also flip the mode.
    if (!press || press.startedRecording || press.cancelled) return;
    toggleCaptureMode();
  }, [clearPress, toggleCaptureMode]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isLocked) {
    return (
      <div
        className="chat-composer-shell"
      >
        <div className="rounded-xl bg-foreground/5 p-3 text-center">
          <p className="text-sm font-medium text-muted">Чат закрыт для участников</p>
        </div>
      </div>
    );
  }

  return (
      <div 
        className="chat-composer-shell transition-smooth"
      >
      {(replyingTo || editingTo) && (
        <div className="mb-2 flex flex-col gap-2">
          {(replyingTo || editingTo) && (
            <div className="flex items-center justify-between rounded-xl bg-foreground/5 px-3 py-2 animate-in slide-in-from-bottom-2 duration-200">
              <div className="min-w-0 flex items-center gap-3">
                 <div className="h-8 w-1 shrink-0 rounded-full bg-primary" />
                 <div className="min-w-0">
                    <p className="text-xs font-semibold text-primary">
                      {replyingTo ? "Ответ" : "Редактирование"}
                    </p>
                    <p className="truncate text-sm font-normal text-muted">
                      {replyingTo ? (replyingTo.body || "Вложение") : editingTo?.body}
                    </p>
                 </div>
              </div>
              <button
                type="button"
                aria-label="Отменить действие"
                onClick={onCancelAction}
                className="touch-target flex h-9 w-9 items-center justify-center rounded-full text-muted transition-smooth hover:bg-foreground/5 hover:text-foreground active:scale-[0.96]"
              >
                <X className="h-5 w-5" strokeWidth={2.1} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        {!isRecording && (
          <button
            type="button"
            aria-label="Прикрепить файл"
            onClick={() => fileInputRef.current?.click()}
            className="premium-glass touch-target fluid-hit flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:text-primary dark:text-white"
          >
            <Paperclip className="h-5.5 w-5.5" strokeWidth={2.25} />
          </button>
        )}

        {/* A single unrestricted input: iOS then offers its own source menu
            (Photo Library / Take Photo or Video / Choose Files) instead of the
            app drawing an extra picker of its own. */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          onChange={(e) => {
            const input = e.currentTarget;
            try {
              const files = input.files;
              if (files && files.length > 0 && onFilesSelected) {
                onFilesSelected(Array.from(files));
              }
            } finally {
              // Reset so picking the same file twice still fires change.
              input.value = "";
            }
          }}
        />

        <div className="relative flex-1">
          {showEmoji && !isRecording ? (
            <div
              ref={emojiPanelRef}
              className="chat-emoji-panel animate-in fade-in zoom-in-95 duration-200"
              data-nox-swipe-ignore="true"
              role="dialog"
              aria-label="Выбор эмодзи"
            >
              <div className="chat-emoji-header">
                <p className="text-[13px] font-semibold text-foreground">Эмодзи</p>
                <button
                  type="button"
                  aria-label="Закрыть эмодзи"
                  onClick={() => setShowEmoji(false)}
                  className="fluid-hit flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-foreground/8 hover:text-foreground"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
              <div className="chat-emoji-scroll">
                {EMOJI_GROUPS.map((group) => (
                  <section key={group.label} className="mb-3 last:mb-0">
                    <h3 className="mb-1.5 px-1 text-[11px] font-semibold text-muted">
                      {group.label}
                    </h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {group.emojis.map((emoji) => (
                        <button
                          key={`${group.label}-${emoji}`}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="chat-emoji-button fluid-hit"
                          aria-label={`Вставить ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}

          {isRecording ? (
            <div className="flex min-h-11 items-center justify-between rounded-[22px] border border-danger/20 bg-danger/10 px-4">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-danger animate-ping" />
                <span className="text-sm font-semibold text-danger">Запись <span className="tabular-nums">{formatDuration(recordingDuration)}</span></span>
              </div>
              <button type="button" onClick={onVoiceCancel} className="touch-target px-2 text-sm font-semibold text-danger/70 transition-smooth hover:text-danger active:scale-[0.96]">Отмена</button>
            </div>
          ) : (
            <div 
              className="premium-glass relative flex items-end rounded-full pl-4 pr-1 transition-smooth focus-within:border-primary/35"
            >
              <textarea
                ref={inputRef}
                data-composer-ready={interactive ? "1" : undefined}
                className="max-h-32 min-h-11 w-full resize-none bg-transparent py-3 pr-2 text-[16px] leading-5 outline-none transition-smooth placeholder:text-[var(--chat-input-placeholder)]"
                placeholder="Сообщение..."
                rows={1}
                value={text}
                onFocus={() => setShowEmoji(false)}
                onChange={(e) => {
                  setText(e.target.value);
                  onTyping(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                ref={emojiButtonRef}
                type="button"
                aria-label="Эмодзи"
                onClick={() => {
                  setShowEmoji((visible) => {
                    if (!visible) inputRef.current?.blur();
                    return !visible;
                  });
                }}
                className={`touch-target fluid-hit mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-smooth ${showEmoji ? "text-primary" : "text-muted hover:text-primary"}`}
                title="Эмодзи"
              >
                <Smile className="h-5.5 w-5.5" strokeWidth={2.05} />
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label={
              isRecording
                ? (captureMode === "video" ? "Идёт запись видеосообщения" : "Идёт запись голосового сообщения")
                : text.trim()
                  ? "Отправить сообщение"
                  : captureMode === "voice"
                    ? "Режим голосового сообщения. Нажмите, чтобы выбрать видеосообщение"
                    : "Режим видеосообщения. Нажмите, чтобы выбрать голосовое сообщение"
            }
            onClick={isRecording ? onVoiceStop : text.trim() ? handleSend : undefined}
            onPointerDown={handleCapturePointerDown}
            onPointerMove={handleCapturePointerMove}
            onPointerUp={handleCapturePointerUp}
            onPointerCancel={clearPress}
            onKeyDown={(event) => {
              // Keyboard activation toggles the mode; it must never be mistaken
              // for a hold, so it bypasses the pointer machine entirely.
              if (isRecording || text.trim()) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleCaptureMode();
              }
            }}
            disabled={pending && !text.trim() && !isRecording}
            className={`touch-target fluid-hit relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-smooth ${
              isRecording || text.trim() ? "shadow-sm" : "premium-glass text-foreground dark:text-white"
            } disabled:opacity-45`}
            style={{
              backgroundColor: isRecording
                ? "var(--danger)"
                : text.trim()
                  ? "var(--bubble-outgoing-bg)"
                  : undefined,
              color: text.trim() || isRecording ? "var(--bubble-outgoing-fg)" : undefined,
            }}
          >
            {isRecording ? (
              <Check className="h-5 w-5" strokeWidth={2.4} />
            ) : text.trim() ? (
              <Send className="ml-0.5 h-5 w-5" strokeWidth={2.3} />
            ) : (
              // Both icons share one absolutely-positioned stack so the circle
              // never changes size and the composer can't shift while they swap.
              <span className="pointer-events-none relative flex h-6 w-6 items-center justify-center">
                <Mic
                  className={`capture-icon h-5.5 w-5.5 ${captureMode === "voice" ? "capture-icon-active" : ""}`}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                <Video
                  className={`capture-icon h-5.5 w-5.5 ${captureMode === "video" ? "capture-icon-active" : ""}`}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </span>
            )}
          </button>
        </div>
      </div>

      <span className="sr-only" role="status" aria-live="polite">{modeAnnouncement}</span>

      {showVideoRecorder && (
        <VideoMessageRecorder
          onClose={() => setShowVideoRecorder(false)}
          onCapture={(file) => {
            setShowVideoRecorder(false);
            if (onVideoMessageCaptured) {
              void onVideoMessageCaptured(file);
            } else {
              onFilesSelected?.([file]);
            }
          }}
        />
      )}
    </div>
  );
}
