"use client";

import { FormEvent, useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import Link from "next/link";

type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

type Message = {
  id: string;
  body: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  deletedAt: string | null;
  editedAt: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  attachments: Attachment[];
  reactions: MessageReaction[];
  replyToMessage: ParentMessage | null;
};

type ParentMessage = {
  id: string;
  body: string | null;
  deletedAt: string | null;
  type: string;
  sender: {
    username: string;
    profile: { displayName: string } | null;
  };
};

type MessageReaction = {
  emoji: string;
  userId: string;
  user: {
    id: string;
    username: string;
    profile: { displayName: string } | null;
  };
};

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "👎"];

function canDeleteMessage(message: Message, currentUserId: string, currentRole: ChatRole) {
  return message.senderUserId === currentUserId || currentRole === "OWNER" || currentRole === "ADMIN";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function AttachmentContent({ attachment, messageType }: { attachment: Attachment, messageType?: string }) {
  const href = `/api/attachments/${attachment.id}/download`;

  if (attachment.mimeType.startsWith("image/")) {
    return (
      <a className="mt-2 block overflow-hidden rounded-lg border border-border-subtle" href={href} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={attachment.fileName}
          className="max-h-80 w-full object-cover transition hover:scale-105"
          src={href}
        />
      </a>
    );
  }

  if (messageType === "VOICE" || attachment.mimeType.startsWith("audio/")) {
    return (
      <div className="mt-2 min-w-[200px]">
        <audio controls className="h-10 w-full accent-primary">
          <source src={href} type={attachment.mimeType} />
          Ваш браузер не поддерживает аудио.
        </audio>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-background/40 p-3 border border-border-subtle">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{attachment.fileName}</p>
        <p className="text-[10px] text-muted uppercase font-bold tracking-tighter">
          {formatFileSize(attachment.sizeBytes)}
        </p>
      </div>
      <a
        className="shrink-0 text-xs font-bold text-primary hover:underline"
        href={href}
      >
        Скачать
      </a>
    </div>
  );
}

function getUiErrorMessage(message?: string) {
  if (!message) return "Ошибка действия.";
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes("размер")) return "Файл слишком большой.";
  if (lowerMessage.includes("тип")) return "Формат не поддерживается.";
  if (lowerMessage.includes("доступ")) return "Нет доступа.";
  return message;
}

function getParentPreview(parent: ParentMessage) {
  if (parent.deletedAt) return "Сообщение удалено";
  if (parent.body) return parent.body;
  if (parent.type === "IMAGE") return "Фото";
  if (parent.type === "VIDEO") return "Видео";
  if (parent.type === "VOICE") return "Голосовое сообщение";
  return "Файл";
}

export function ChatMessages({
  chatId,
  currentUserId,
  currentRole,
  isLocked,
  initialMessages,
}: {
  chatId: string;
  currentUserId: string;
  currentRole: ChatRole;
  isLocked: boolean;
  initialMessages: Message[];
}) {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; displayName: string; timeoutId: ReturnType<typeof setTimeout> }>>({});
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Actions state
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  
  // New interaction state
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isClient, setIsClient] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberLocked = isLocked && currentRole === "MEMBER";

  useEffect(() => {
    const t = setTimeout(() => setIsClient(true), 0);
    return () => clearTimeout(t);
  }, []);

  const recorderSupported = isClient && typeof window !== "undefined" && !!window.MediaRecorder;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const markAsRead = async () => {
      try {
        await fetch(`/api/chats/${chatId}/read`, { method: "POST" });
      } catch {
        // Silenced
      }
    };

    markAsRead();
  }, [chatId]);

  useEffect(() => {
    if (!socket) return;

    function handleNewMessage(payload: { chatId: string; message: Message }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) => {
        if (current.some((m) => m.id === payload.message.id)) return current;
        return [...current, payload.message].slice(-100);
      });

      if (payload.message.senderUserId !== currentUserId) {
        fetch(`/api/chats/${chatId}/read`, { method: "POST" }).catch(() => null);
      }
    }

    function handleDeletedMessage(payload: { chatId: string; messageId: string }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) =>
        current.map((m) =>
          m.id === payload.messageId
            ? { ...m, deletedAt: new Date().toISOString() }
            : m,
        ),
      );
    }

    function handleUpdatedMessage(payload: { chatId: string; message: Message }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) =>
        current.map((m) => (m.id === payload.message.id ? payload.message : m)),
      );
    }

    function handleReactionsUpdated(payload: { chatId: string; messageId: string; reactions: MessageReaction[] }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) =>
        current.map((m) =>
          m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
        ),
      );
    }

    function handleTypingUpdate(payload: { chatId: string; userId: string; username: string; displayName: string; isTyping: boolean }) {
      if (payload.chatId !== chatId || payload.userId === currentUserId) return;

      setTypingUsers((current) => {
        const next = { ...current };
        if (payload.isTyping) {
          if (next[payload.userId]?.timeoutId) {
            clearTimeout(next[payload.userId].timeoutId);
          }
          const timeoutId = setTimeout(() => {
            setTypingUsers((prev) => {
              const cleaned = { ...prev };
              delete cleaned[payload.userId];
              return cleaned;
            });
          }, 5000);
          next[payload.userId] = { username: payload.username, displayName: payload.displayName, timeoutId };
        } else {
          if (next[payload.userId]?.timeoutId) {
            clearTimeout(next[payload.userId].timeoutId);
          }
          delete next[payload.userId];
        }
        return next;
      });
    }

    socket.emit("chat:join", chatId);
    socket.on("message:new", handleNewMessage);
    socket.on("message:deleted", handleDeletedMessage);
    socket.on("message:updated", handleUpdatedMessage);
    socket.on("message:reactions-updated", handleReactionsUpdated);
    socket.on("typing:update", handleTypingUpdate);

    return () => {
      socket.emit("chat:leave", chatId);
      socket.off("message:new", handleNewMessage);
      socket.off("message:deleted", handleDeletedMessage);
      socket.off("message:updated", handleUpdatedMessage);
      socket.off("message:reactions-updated", handleReactionsUpdated);
      socket.off("typing:update", handleTypingUpdate);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socket.emit("typing:stop", { chatId });
    };
  }, [chatId, socket, currentUserId]);

  // Recording cleanup
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  async function refreshMessages() {
    const response = await fetch(`/api/chats/${chatId}/messages`);
    if (!response.ok) return;
    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
    router.refresh();
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const nextBody = body.trim();
    if (!nextBody && !selectedFile) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setIsTypingLocal(false);
    socket?.emit("typing:stop", { chatId });

    setError("");
    setPending(true);

    try {
      if (editingMessage) {
        const response = await fetch(`/api/messages/${editingMessage.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: nextBody }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Не удалось изменить сообщение");
        }
        setEditingMessage(null);
        setBody("");
      } else if (selectedFile) {
        await uploadAttachment(selectedFile);
      } else {
        const response = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: nextBody,
            replyToMessageId: replyingToMessage?.id,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Не удалось отправить сообщение");
        }
        setReplyingToMessage(null);
        setBody("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  const handleTyping = (text: string) => {
    setBody(text);
    if (!socket) return;

    if (text.length > 0) {
      if (!isTypingLocal) {
        setIsTypingLocal(true);
        socket.emit("typing:start", { chatId });
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTypingLocal(false);
        socket.emit("typing:stop", { chatId });
      }, 3000);
    } else {
      if (isTypingLocal) {
        setIsTypingLocal(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        socket.emit("typing:stop", { chatId });
      }
    }
  };

  const getTypingText = () => {
    const users = Object.values(typingUsers);
    if (users.length === 0) return null;
    if (users.length > 2) return "Несколько участников печатают...";
    if (users.length === 2) return `${users[0].displayName} и ${users[1].displayName} печатают...`;
    return `${users[0].displayName} печатает...`;
  };

  async function uploadAttachment(file: File) {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/chats/${chatId}/attachments`, {
      method: "POST",
      body: formData,
    });
    setUploading(false);

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(getUiErrorMessage(data?.error));
    }

    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function deleteMessage(messageId: string) {
    await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
    setPendingDeleteMessage(null);
    router.refresh();
  }

  async function toggleReaction(messageId: string, emoji: string) {
    try {
      await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      setMenuMessageId(null);
    } catch (err) {
      console.error("Failed to toggle reaction", err);
    }
  }

  function startEditing(message: Message) {
    if (message.deletedAt || message.senderUserId !== currentUserId) return;
    setReplyingToMessage(null);
    setEditingMessage(message);
    setBody(message.body || "");
    setMenuMessageId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function startReplying(message: Message) {
    if (message.deletedAt) return;
    setEditingMessage(null);
    setReplyingToMessage(message);
    setMenuMessageId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const handlePointerDown = (messageId: string) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setMenuMessageId(messageId);
      if (window.navigator.vibrate) window.navigator.vibrate(50);
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, messageId: string) => {
    e.preventDefault();
    setMenuMessageId(messageId);
  };

  // Recording Logic
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (audioChunksRef.current.length > 0) {
          const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: recorder.mimeType });
          await uploadAttachment(file);
          router.refresh();
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied", err);
      setError("Не удалось получить доступ к микрофону");
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function cancelRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      audioChunksRef.current = [];
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  return (
    <div className="flex h-[calc(100svh-80px)] flex-col lg:h-[750px] lg:max-h-[85vh]">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-background/50 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/chats" className="text-muted hover:text-foreground">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold">Чат</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-primary animate-pulse" : "bg-muted"}`} />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                {connected ? "В сети" : "Подключение"}
              </p>
            </div>
          </div>
        </div>
        <button
          className="text-xs font-bold uppercase tracking-widest text-muted hover:text-foreground"
          onClick={refreshMessages}
          type="button"
        >
          Обновить
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 scrollbar-hide">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Сообщений нет</p>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderUserId === currentUserId;
            const displayName = message.sender.profile?.displayName ?? message.sender.username;

            // Group reactions
            const groupedReactions = message.reactions.reduce((acc, r) => {
              if (!acc[r.emoji]) acc[r.emoji] = { count: 0, me: false };
              acc[r.emoji].count++;
              if (r.userId === currentUserId) acc[r.emoji].me = true;
              return acc;
            }, {} as Record<string, { count: number; me: boolean }>);

            return (
              <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`} key={message.id}>
                {!mine && (
                  <span className="mb-1 ml-2 text-[10px] font-bold uppercase tracking-tighter text-muted">
                    {displayName}
                  </span>
                )}
                
                <div 
                  className={`group relative max-w-[85%] rounded-2xl px-4 py-2.5 transition-all select-none touch-none cursor-default ${
                    mine 
                      ? "bg-primary text-neutral-950 rounded-tr-none" 
                      : "bg-surface border border-border-subtle text-foreground rounded-tl-none"
                  } ${menuMessageId === message.id ? "ring-2 ring-primary/50 scale-[1.02]" : ""}`}
                  onPointerDown={() => handlePointerDown(message.id)}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerMove={handlePointerMove}
                  onContextMenu={(e) => handleContextMenu(e, message.id)}
                >
                  {/* Desktop "..." button */}
                  {!message.deletedAt && (
                    <button
                      className={`absolute top-0 ${mine ? "right-full mr-1" : "left-full ml-1"} hidden lg:flex h-6 w-6 items-center justify-center rounded-full bg-surface/50 text-muted opacity-0 group-hover:opacity-100 transition-all hover:bg-surface hover:text-foreground`}
                      onClick={(e) => { e.stopPropagation(); setMenuMessageId(message.id); }}
                      title="Действия"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                      </svg>
                    </button>
                  )}

                  {/* Reply Preview inside bubble */}
                  {message.replyToMessage && (
                    <div className={`mb-2 border-l-2 pl-2 py-0.5 text-xs opacity-80 ${mine ? "border-neutral-950/30" : "border-primary/50"}`}>
                      <p className="font-bold truncate">{message.replyToMessage.sender.profile?.displayName || message.replyToMessage.sender.username}</p>
                      <p className="truncate line-clamp-1 italic">{getParentPreview(message.replyToMessage)}</p>
                    </div>
                  )}

                  {message.deletedAt ? (
                    <p className="text-xs italic opacity-60">Сообщение удалено</p>
                  ) : (
                    <>
                      {message.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>}
                      {message.attachments.map((attachment) => (
                        <AttachmentContent attachment={attachment} messageType={message.type} key={attachment.id} />
                      ))}
                    </>
                  )}
                  
                  <div className={`mt-1 flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                    <span className={`text-[9px] font-bold ${mine ? "text-neutral-950/60" : "text-muted"}`}>
                      {message.editedAt && "изм. "}{formatTime(message.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Grouped Reactions Bar */}
                {Object.keys(groupedReactions).length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end mr-1" : "justify-start ml-1"}`}>
                    {Object.entries(groupedReactions).map(([emoji, info]) => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(message.id, emoji)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-all border ${
                          info.me 
                            ? "bg-primary/20 border-primary/40 text-primary" 
                            : "bg-surface border-border-subtle text-muted hover:border-muted"
                        }`}
                      >
                        <span>{emoji}</span>
                        <span>{info.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Action Menu (Overlay) */}
      {menuMessageId && (
        <div 
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] lg:items-center"
          onClick={() => setMenuMessageId(null)}
          onKeyDown={(e) => e.key === "Escape" && setMenuMessageId(null)}
        >
          <div 
            className="w-full max-w-sm animate-in slide-in-from-bottom-4 duration-200 lg:slide-in-from-top-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-clean shadow-2xl bg-surface p-2">
              {/* Reactions row */}
              <div className="flex items-center justify-around border-b border-border-subtle pb-2 mb-2 pt-1 px-2">
                {ALLOWED_REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(menuMessageId, emoji)}
                    className="h-10 w-10 flex items-center justify-center rounded-xl hover:bg-surface-hover active:scale-125 transition-all text-xl"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Actions list */}
              <div className="space-y-1">
                {(() => {
                  const m = messages.find(msg => msg.id === menuMessageId);
                  if (!m || m.deletedAt) return null;
                  const isMine = m.senderUserId === currentUserId;
                  
                  return (
                    <>
                      <MenuButton 
                        label="Ответить" 
                        onClick={() => startReplying(m)} 
                        icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>}
                      />
                      {isMine && m.type === "TEXT" && (
                        <MenuButton 
                          label="Изменить" 
                          onClick={() => startEditing(m)} 
                          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
                        />
                      )}
                      {canDeleteMessage(m, currentUserId, currentRole) && (
                        <MenuButton 
                          label="Удалить" 
                          onClick={() => { setPendingDeleteMessage(m); setMenuMessageId(null); }} 
                          variant="danger"
                          icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                        />
                      )}
                    </>
                  );
                })()}
                <MenuButton 
                  label="Отмена" 
                  onClick={() => setMenuMessageId(null)} 
                  icon={<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDeleteMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card-clean w-full max-w-xs p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-center mb-2">Удалить сообщение?</h3>
            <p className="text-sm text-muted text-center mb-6">Это действие нельзя отменить.</p>
            <div className="flex gap-3">
              <button 
                className="btn-secondary flex-1 py-2 text-sm"
                onClick={() => setPendingDeleteMessage(null)}
              >
                Отмена
              </button>
              <button 
                className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all active:scale-95 py-2"
                onClick={() => deleteMessage(pendingDeleteMessage.id)}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Typing Indicator */}
      {getTypingText() && (
        <div className="px-4 py-1 animate-in fade-in slide-in-from-bottom-1">
          <p className="text-[10px] font-bold text-primary italic uppercase tracking-widest">
            {getTypingText()}
          </p>
        </div>
      )}

      {/* Action Plate (Edit/Reply) */}
      {(editingMessage || replyingToMessage) && (
        <div className="mx-4 mb-2 p-3 bg-surface border border-border-subtle rounded-xl flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase text-primary tracking-widest">
              {editingMessage ? "Редактирование" : "Ответ на сообщение"}
            </p>
            <p className="text-xs text-muted truncate">
              {editingMessage ? editingMessage.body : getParentPreview(replyingToMessage!)}
            </p>
          </div>
          <button 
            className="text-muted hover:text-red-400 p-1"
            onClick={() => { setEditingMessage(null); setReplyingToMessage(null); if (editingMessage) setBody(""); }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="p-4 bg-background">
        {memberLocked ? (
          <div className="rounded-xl bg-surface p-3 text-center border border-border-subtle">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Чат закрыт для участников</p>
          </div>
        ) : (
          <div className="space-y-3">
            {error && <p className="text-center text-[10px] font-bold uppercase text-red-400">{error}</p>}
            
            {selectedFile && !isRecording && (
              <div className="flex items-center justify-between rounded-xl bg-surface-hover px-3 py-2 border border-primary/20 animate-in fade-in slide-in-from-bottom-2">
                <p className="truncate text-xs font-medium text-primary">{selectedFile.name}</p>
                <button 
                  className="text-muted hover:text-foreground p-1"
                  onClick={() => setSelectedFile(null)}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                {isRecording ? (
                  <div className="input-nox h-11 flex items-center justify-between px-4 bg-primary/10 border-primary/30 animate-pulse">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                      <p className="text-xs font-bold text-primary uppercase tracking-widest">Идёт запись {formatDuration(recordingDuration)}</p>
                    </div>
                    <button onClick={cancelRecording} className="text-[10px] font-bold uppercase text-muted hover:text-red-400">Отмена</button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      id="file-upload"
                      type="file"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      disabled={uploading || !!editingMessage}
                    />
                    {!editingMessage && (
                      <label
                        htmlFor="file-upload"
                        className="absolute left-2 bottom-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground active:scale-95"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </label>
                    )}
                    <textarea
                      ref={inputRef}
                      className={`input-nox max-h-32 min-h-[44px] py-3 pr-4 resize-none leading-tight transition-all ${editingMessage ? "pl-4" : "pl-12"}`}
                      rows={1}
                      placeholder={editingMessage ? "Изменить..." : "Написать..."}
                      value={body}
                      disabled={pending || uploading}
                      onChange={(e) => {
                        handleTyping(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                    />
                  </>
                )}
              </div>
              
              {!body.trim() && !selectedFile && !editingMessage && !isRecording && recorderSupported ? (
                <button
                  className="btn-primary h-11 w-11 p-0 flex items-center justify-center shrink-0 rounded-full"
                  type="button"
                  onClick={startRecording}
                  disabled={uploading || pending}
                  title="Записать голос"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
              ) : (
                <button
                  className={`h-11 w-11 p-0 flex items-center justify-center shrink-0 rounded-full transition-all ${isRecording ? "bg-red-500 hover:bg-red-600 text-white" : "btn-primary"}`}
                  type="button"
                  disabled={pending || uploading || (!body.trim() && !selectedFile && !isRecording)}
                  onClick={() => isRecording ? stopRecording() : handleSubmit()}
                >
                  {uploading || pending ? (
                    <div className="h-4 w-4 border-2 border-neutral-950 border-t-transparent animate-spin rounded-full" />
                  ) : isRecording ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({ label, onClick, icon, variant = "default" }: { 
  label: string, 
  onClick: () => void, 
  icon?: React.ReactNode,
  variant?: "default" | "danger" 
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
        variant === "danger" 
          ? "text-red-400 hover:bg-red-500/10" 
          : "text-foreground hover:bg-surface-hover"
      }`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      {label}
    </button>
  );
}
