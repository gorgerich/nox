"use client";

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
  isRecording,
  recordingDuration,
  isLocked,
  pending,
  replyingTo,
  editingTo,
  onCancelAction,
}: {
  chatId: string;
  onSend: (text: string) => void;
  onTyping: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceCancel: () => void;
  onFilesSelected?: (files: File[]) => void;
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
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft) {
        setText(draft);
        if (inputRef.current) {
          inputRef.current.style.height = "auto";
          inputRef.current.style.height = inputRef.current.scrollHeight + "px";
        }
      }
    } catch { /* localStorage unavailable */ }
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

  const handleSend = useCallback(async () => {
    if (text.trim()) {
      try {
        await onSend(text);
        // Clear only on success
        setText("");
        setShowEmoji(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        editingIdRef.current = null;
        if (inputRef.current) inputRef.current.style.height = "auto";
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    }
  }, [text, onSend]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isLocked) {
    return (
      <div className="glass-composer p-4">
        <div className="rounded-xl bg-foreground/5 p-4 text-center border border-white/5">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Чат закрыт для участников</p>
        </div>
      </div>
    );
  }

  return (
      <div 
        className="glass-composer px-4 py-3 transition-smooth"
        style={{ backgroundColor: "var(--chat-composer-bg)", borderColor: "var(--chat-composer-border)", color: "var(--chat-composer-fg)" }}
      >
      {(replyingTo || editingTo) && (
        <div className="mb-3 flex flex-col gap-2">
          {(replyingTo || editingTo) && (
            <div className="flex items-center justify-between rounded-xl bg-foreground/5 p-3 border border-white/5 animate-in slide-in-from-bottom-2 duration-200">
              <div className="min-w-0 flex items-center gap-3">
                 <div className="h-8 w-1 bg-primary rounded-full shrink-0" />
                 <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                      {replyingTo ? "Ответ" : "Изменение"}
                    </p>
                    <p className="truncate text-xs opacity-70 font-medium">
                      {replyingTo ? (replyingTo.body || "Вложение") : editingTo?.body}
                    </p>
                 </div>
              </div>
              <button onClick={onCancelAction} className="touch-target text-current opacity-40 hover:opacity-100 transition-smooth p-1 active:scale-90">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {isRecording ? (
            <div className="flex h-[48px] items-center justify-between rounded-xl bg-danger/10 px-4 border border-danger/20 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-danger animate-ping" />
                <span className="text-xs font-black uppercase tracking-widest text-danger">Запись {formatDuration(recordingDuration)}</span>
              </div>
              <button onClick={onVoiceCancel} className="touch-target text-[10px] font-black uppercase text-danger/60 hover:text-danger active:scale-95 transition-smooth">Отмена</button>
            </div>
          ) : (
            <div 
              className="relative flex items-end rounded-xl border transition-smooth focus-within:ring-2 focus-within:ring-primary/10"
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
                onClick={() => fileInputRef.current?.click()}
                className="touch-target h-[48px] w-12 flex shrink-0 items-center justify-center opacity-40 hover:opacity-100 hover:text-primary transition-smooth active:scale-90"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className={`touch-target h-[48px] w-10 flex shrink-0 items-center justify-center transition-smooth active:scale-90 ${showEmoji ? "text-primary opacity-100" : "opacity-40 hover:opacity-100 hover:text-primary"}`}
                title="Эмодзи"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>

              {showEmoji && (
                <div
                  className="absolute bottom-[calc(100%+8px)] left-0 z-30 grid w-[min(20rem,calc(100vw-2rem))] grid-cols-8 gap-1 rounded-2xl border border-border-subtle/50 bg-surface-elevated p-3 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150"
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
                className="w-full max-h-32 min-h-[48px] resize-none bg-transparent py-3.5 pr-4 text-[15px] outline-none transition-smooth placeholder:text-[var(--chat-input-placeholder)]"
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
            onClick={() => setShowVideoRecorder(true)}
            disabled={pending}
            className="touch-target h-[48px] w-12 flex shrink-0 items-center justify-center rounded-xl opacity-40 hover:opacity-100 hover:text-primary transition-smooth active:scale-90"
            title="Видеосообщение"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
            </svg>
          </button>
        )}

        <button
          onClick={isRecording ? onVoiceStop : (text.trim()) ? handleSend : onVoiceStart}
          disabled={pending}
          className={`touch-target h-[48px] w-12 flex shrink-0 items-center justify-center rounded-xl transition-smooth active:scale-90 ${
            isRecording ? "shadow-lg shadow-danger/20" : (text.trim()) ? "shadow-lg shadow-primary/20" : "opacity-40"
          }`}
          style={{
            backgroundColor: isRecording
              ? "var(--danger)"
              : (text.trim())
                ? "var(--bubble-outgoing-bg)"
                : "var(--chat-focus-ring)",
            color: (text.trim()) || isRecording ? "var(--bubble-outgoing-fg)" : "var(--chat-header-fg)",
          }}
        >
          {pending ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
          ) : isRecording ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (text.trim()) ? (
            <svg className="h-5 w-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
      </div>

      {showVideoRecorder && (
        <VideoMessageRecorder
          onClose={() => setShowVideoRecorder(false)}
          onCapture={(file) => {
            setShowVideoRecorder(false);
            onFilesSelected?.([file]);
          }}
        />
      )}
    </div>
  );
}
