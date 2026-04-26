"use client";

import { useRef, useState, useCallback, useEffect } from "react";

export function ChatComposer({
  onSend,
  onTyping,
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
  onSend: (text: string, file?: File) => void;
  onTyping: (text: string) => void;
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
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editingIdRef = useRef<string | null>(null);

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

  // Clean up preview URL when component unmounts or file changes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileSelect = (file: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
  };

  const handleRemoveFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = useCallback(async () => {
    if (text.trim() || selectedFile) {
      try {
        await onSend(text, selectedFile || undefined);
        // Clear only on success
        setText("");
        setSelectedFile(null);
        setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        editingIdRef.current = null;
        if (inputRef.current) inputRef.current.style.height = "auto";
      } catch (error) {
        // Keep text and file if it failed
        console.error("Failed to send message:", error);
      }
    }
  }, [text, selectedFile, onSend]);

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
      {(replyingTo || editingTo || selectedFile) && (
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

          {selectedFile && (
            <div className="flex items-center gap-3 rounded-xl bg-foreground/5 p-2 pr-3 border border-white/5 animate-in slide-in-from-bottom-2 duration-200">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-foreground/10">
                {previewUrl ? (
                  selectedFile.type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
                  ) : (
                    <video src={previewUrl} className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <svg className="h-6 w-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 002 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold">{selectedFile.name}</p>
                <p className="text-[10px] opacity-40 font-black uppercase tracking-widest">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <button onClick={handleRemoveFile} className="touch-target text-current opacity-40 hover:opacity-100 transition-smooth p-1 active:scale-90">
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
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileSelect(file);
                  }
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
              
              <textarea
                ref={inputRef}
                className="w-full max-h-32 min-h-[48px] resize-none bg-transparent py-3.5 pr-4 text-[15px] outline-none transition-smooth placeholder:text-[var(--chat-input-placeholder)]"
                style={{ color: "var(--chat-input-fg)" }}
                placeholder={selectedFile ? "Добавить подпись..." : "Сообщение..."}
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
          onClick={isRecording ? onVoiceStop : (text.trim() || selectedFile) ? handleSend : onVoiceStart}
          disabled={pending}
          className={`touch-target h-[48px] w-12 flex shrink-0 items-center justify-center rounded-xl transition-smooth active:scale-90 ${
            isRecording ? "shadow-lg shadow-danger/20" : (text.trim() || selectedFile) ? "shadow-lg shadow-primary/20" : "opacity-40"
          }`}
          style={{
            backgroundColor: isRecording
              ? "var(--danger)"
              : (text.trim() || selectedFile)
                ? "var(--bubble-outgoing-bg)"
                : "var(--chat-focus-ring)",
            color: (text.trim() || selectedFile) || isRecording ? "var(--bubble-outgoing-fg)" : "var(--chat-header-fg)",
          }}
        >
          {pending ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
          ) : isRecording ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (text.trim() || selectedFile) ? (
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
