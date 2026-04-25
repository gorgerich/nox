"use client";

import { useRef, useState, useCallback } from "react";

export function ChatComposer({
  onSend,
  onTyping,
  onAttach,
  onVoiceStart,
  onVoiceStop,
  onVoiceCancel,
  isRecording,
  recordingDuration,
  isLocked,
  pending,
  replyingTo,
  editingTo,
  onCancelAction,
}: {
  onSend: (text: string) => void;
  onTyping: (text: string) => void;
  onAttach: (file: File) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onVoiceCancel: () => void;
  isRecording: boolean;
  recordingDuration: number;
  isLocked: boolean;
  pending: boolean;
  replyingTo?: { id: string; body: string | null; sender: { profile: { displayName: string } | null; username: string } } | null;
  editingTo?: { id: string; body: string | null } | null;
  onCancelAction: () => void;
}) {
  const [text, setText] = useState(editingTo?.body || "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    if (text.trim()) {
      onSend(text);
      setText("");
      if (inputRef.current) inputRef.current.style.height = 'auto';
    }
  }, [text, onSend]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (isLocked) {
    return (
      <div className="p-4 glass-composer">
        <div className="rounded-xl bg-surface-muted/50 p-4 text-center border border-border-subtle/30">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Чат закрыт для участников</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-composer px-4 py-3 transition-smooth">
      {/* Action Plate (Edit/Reply) */}
      {(replyingTo || editingTo) && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-surface-muted/50 p-3 border border-border-subtle/30 animate-in slide-in-from-bottom-2 duration-200">
          <div className="min-w-0 flex items-center gap-3">
             <div className="h-8 w-1 bg-primary rounded-full shrink-0" />
             <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                  {replyingTo ? "Ответ" : "Изменение"}
                </p>
                <p className="truncate text-xs text-foreground/70 font-medium">
                  {replyingTo ? (replyingTo.body || "Вложение") : editingTo?.body}
                </p>
             </div>
          </div>
          <button onClick={onCancelAction} className="touch-target text-muted hover:text-foreground transition-smooth p-1 active:scale-90">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
              <button onClick={onVoiceCancel} className="touch-target text-[10px] font-black uppercase text-muted hover:text-danger active:scale-95 transition-smooth">Отмена</button>
            </div>
          ) : (
            <div className="relative flex items-end bg-[var(--chat-input-bg)] rounded-xl border border-border-subtle/50 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-smooth">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onAttach(file);
                    e.target.value = "";
                  }
                }}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="touch-target h-[48px] w-12 flex shrink-0 items-center justify-center text-icon-muted hover:text-primary transition-smooth active:scale-90"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              
              <textarea
                ref={inputRef}
                className="w-full bg-transparent py-3.5 pr-4 text-[15px] outline-none resize-none max-h-32 min-h-[48px] placeholder:text-muted transition-smooth"
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

        <button
          onClick={isRecording ? onVoiceStop : text.trim() ? handleSend : onVoiceStart}
          disabled={pending}
          className={`touch-target h-[48px] w-12 flex shrink-0 items-center justify-center rounded-xl transition-smooth active:scale-90 ${
            isRecording ? "bg-danger text-white shadow-lg shadow-danger/20" : text.trim() ? "bg-primary text-primary-foreground" : "bg-surface-muted text-icon"
          }`}
        >
          {pending ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
          ) : isRecording ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : text.trim() ? (
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
    </div>
  );
}
