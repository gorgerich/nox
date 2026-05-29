"use client";

import { Check, Mic, Paperclip, Send, Smile, Video, X } from "lucide-react";
import { useRef, useState, useCallback, useEffect } from "react";
import { VideoMessageRecorder } from "./VideoMessageRecorder";

const EMOJIS = [
  "😀","😁","😂","🤣","😊","😍","😘","😎","🤔","🙄","😴","😭","😡","🥳","😅","😉",
  "👍","👎","👏","🙏","💪","🤝","✌️","🤞","👌","🫶","🔥","💯","🎉","✨","⭐","🌟",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","💋","💕","😻","🥰","😱","😬","🤯",
  "😇","🤗","🤤","😋","😜","🤪","😏","😶","🫡","🤐","🥶","🤒","🤧","🥹","🫠","💀",
  "👋","🙌","🤙","👇","👆","👀","🧠","🫀","🍕","☕","🍺","🎁","💰","📎","✅","❌",
];

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
          el.focus();
          const pos = start + emoji.length;
          el.setSelectionRange(pos, pos);
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }
      });
      return next;
    });
  }, [onTyping]);

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
        className="border-t px-4 py-3 safe-bottom"
        style={{ backgroundColor: "var(--chat-composer-bg)", borderColor: "var(--border-subtle)" }}
      >
        <div className="rounded-xl bg-foreground/5 p-3 text-center">
          <p className="text-sm font-medium text-muted">Чат закрыт для участников</p>
        </div>
      </div>
    );
  }

  return (
      <div 
        className="border-t px-3 py-2 transition-smooth safe-bottom"
        style={{ backgroundColor: "var(--chat-composer-bg)", borderColor: "var(--border-subtle)", color: "var(--chat-composer-fg)" }}
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
                className="touch-target flex h-9 w-9 items-center justify-center rounded-full text-muted transition-smooth hover:bg-foreground/5 hover:text-foreground active:scale-95"
              >
                <X className="h-5 w-5" strokeWidth={2.1} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {isRecording ? (
            <div className="flex min-h-11 items-center justify-between rounded-[22px] border border-danger/20 bg-danger/10 px-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-danger animate-ping" />
                <span className="text-sm font-semibold text-danger">Запись {formatDuration(recordingDuration)}</span>
              </div>
              <button type="button" onClick={onVoiceCancel} className="touch-target px-2 text-sm font-semibold text-danger/70 transition-smooth hover:text-danger active:scale-95">Отмена</button>
            </div>
          ) : (
            <div 
              className="relative flex items-end rounded-[22px] border transition-smooth focus-within:border-primary/40"
              style={{ backgroundColor: "var(--chat-input-bg)", borderColor: "var(--chat-composer-border)" }}
            >
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
              <button
                type="button"
                aria-label="Прикрепить файл"
                onClick={() => fileInputRef.current?.click()}
                className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-smooth hover:text-primary active:scale-95"
              >
                <Paperclip className="h-5 w-5" strokeWidth={2.1} />
              </button>

              <button
                type="button"
                aria-label="Эмодзи"
                onClick={() => setShowEmoji((v) => !v)}
                className={`touch-target flex h-11 w-10 shrink-0 items-center justify-center rounded-full transition-smooth active:scale-95 ${showEmoji ? "text-primary" : "text-muted hover:text-primary"}`}
                title="Эмодзи"
              >
                <Smile className="h-5 w-5" strokeWidth={2.1} />
              </button>

              {showEmoji && (
                <div
                  className="absolute bottom-[calc(100%+8px)] left-0 z-30 grid w-[min(20rem,calc(100vw-2rem))] grid-cols-8 gap-1 rounded-xl border border-border-subtle bg-surface-elevated p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-150"
                >
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-smooth hover:bg-foreground/10 active:scale-90"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                className="max-h-32 min-h-11 w-full resize-none bg-transparent py-3 pr-4 text-[15px] leading-5 outline-none transition-smooth placeholder:text-[var(--chat-input-placeholder)]"
                style={{ color: "var(--chat-input-fg)" }}
                placeholder="Сообщение..."
                rows={1}
                value={text}
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
            </div>
          )}
        </div>

        {!isRecording && !text.trim() && (
          <button
            type="button"
            aria-label="Видеосообщение"
            onClick={() => setShowVideoRecorder(true)}
            disabled={pending}
            className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-smooth hover:bg-foreground/5 hover:text-primary active:scale-95 disabled:opacity-40"
            title="Видеосообщение"
          >
            <Video className="h-5 w-5" strokeWidth={2.1} />
          </button>
        )}

        <button
          type="button"
          aria-label={isRecording ? "Завершить запись" : text.trim() ? "Отправить сообщение" : "Голосовое сообщение"}
          onClick={isRecording ? onVoiceStop : (text.trim()) ? handleSend : onVoiceStart}
          disabled={pending && !text.trim() && !isRecording}
          className={`touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-smooth active:scale-95 ${
            isRecording || text.trim() ? "shadow-sm" : ""
          }`}
          style={{
            backgroundColor: isRecording
              ? "var(--danger)"
              : (text.trim())
                ? "var(--bubble-outgoing-bg)"
                : "transparent",
            color: (text.trim()) || isRecording ? "var(--bubble-outgoing-fg)" : "var(--muted)",
          }}
        >
          {pending && !text.trim() && !isRecording ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
          ) : isRecording ? (
            <Check className="h-5 w-5" strokeWidth={2.4} />
          ) : (text.trim()) ? (
            <Send className="ml-0.5 h-5 w-5" strokeWidth={2.3} />
          ) : (
            <Mic className="h-5 w-5" strokeWidth={2.1} />
          )}
        </button>
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
