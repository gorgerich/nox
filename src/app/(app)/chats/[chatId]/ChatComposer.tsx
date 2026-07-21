"use client";

import { Check, Mic, Paperclip, Send, Smile, Video, X } from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import { VideoMessageRecorder } from "./VideoMessageRecorder";
import { EMOJI_GROUPS } from "@/lib/emoji-data";

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
  const [showEmoji, setShowEmoji] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [showCaptureMenu, setShowCaptureMenu] = useState(false);
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

  const resetInputHeight = useCallback(() => {
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, []);

  const handleSend = useCallback(async () => {
    const draft = text;
    if (draft.trim()) {
      setText("");
      setShowEmoji(false);
      setShowCaptureMenu(false);
      onTyping("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      editingIdRef.current = null;
      resetInputHeight();

      try {
        await onSend(draft);
      } catch (error) {
        console.error("Failed to send message:", error);
        if (!editingTo) {
          setText(draft);
          requestAnimationFrame(() => {
            if (inputRef.current) {
              inputRef.current.focus();
              inputRef.current.style.height = "auto";
              inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
            }
          });
        }
      }
    }
  }, [editingTo, onSend, onTyping, resetInputHeight, text]);

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

        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0 && onFilesSelected) {
              onFilesSelected(Array.from(files));
            }
            if (fileInputRef.current) fileInputRef.current.value = "";
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
                  setShowCaptureMenu(false);
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
          {showCaptureMenu && !text.trim() && !isRecording ? (
            <div className="premium-glass absolute bottom-[calc(100%+10px)] right-0 z-30 flex min-w-44 origin-bottom-right flex-col overflow-hidden rounded-2xl p-1 animate-in fade-in zoom-in-95 duration-200">
              <button
                type="button"
                onClick={() => {
                  setShowCaptureMenu(false);
                  onVoiceStart();
                }}
                className="fluid-hit flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition-smooth hover:bg-foreground/5"
              >
                <Mic className="h-5 w-5 text-primary" strokeWidth={2.2} />
                Голосовое
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCaptureMenu(false);
                  setShowVideoRecorder(true);
                }}
                className="fluid-hit flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground transition-smooth hover:bg-foreground/5"
              >
                <Video className="h-5 w-5 text-primary" strokeWidth={2.2} />
                Кружок
              </button>
            </div>
          ) : null}

          <button
            type="button"
            aria-label={isRecording ? "Завершить запись" : text.trim() ? "Отправить сообщение" : "Выбрать запись"}
            onClick={isRecording ? onVoiceStop : (text.trim()) ? handleSend : () => {
              setShowCaptureMenu((value) => !value);
              setShowEmoji(false);
            }}
            disabled={pending && !text.trim() && !isRecording}
            className={`touch-target fluid-hit flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-smooth ${
              isRecording || text.trim() ? "shadow-sm" : "premium-glass text-foreground dark:text-white"
            } disabled:opacity-45`}
            style={{
              backgroundColor: isRecording
                ? "var(--danger)"
                : (text.trim())
                  ? "var(--bubble-outgoing-bg)"
                  : undefined,
              color: (text.trim()) || isRecording ? "var(--bubble-outgoing-fg)" : undefined,
            }}
          >
            {isRecording ? (
              <Check className="h-5 w-5" strokeWidth={2.4} />
            ) : (text.trim()) ? (
              <Send className="ml-0.5 h-5 w-5" strokeWidth={2.3} />
            ) : (
              <Mic className="h-5.5 w-5.5" strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>

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
