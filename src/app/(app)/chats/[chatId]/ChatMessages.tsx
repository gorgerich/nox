"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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

function AttachmentContent({ attachment }: { attachment: Attachment }) {
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const memberLocked = isLocked && currentRole === "MEMBER";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const markAsRead = async () => {
      try {
        await fetch(`/api/chats/${chatId}/read`, { method: "POST" });
      } catch (err) {
        console.error("Failed to mark chat as read:", err);
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
        await uploadAttachment();
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

  async function uploadAttachment() {
    if (!selectedFile) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", selectedFile);

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
    router.refresh();
  }

  async function toggleReaction(messageId: string, emoji: string) {
    try {
      await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
    } catch (err) {
      console.error("Failed to toggle reaction", err);
    }
  }

  function startEditing(message: Message) {
    if (message.deletedAt || message.senderUserId !== currentUserId) return;
    setReplyingToMessage(null);
    setEditingMessage(message);
    setBody(message.body || "");
    inputRef.current?.focus();
  }

  function startReplying(message: Message) {
    if (message.deletedAt) return;
    setEditingMessage(null);
    setReplyingToMessage(message);
    inputRef.current?.focus();
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
                
                <div className={`group relative max-w-[85%] rounded-2xl px-4 py-2.5 transition-all ${
                  mine 
                    ? "bg-primary text-neutral-950 rounded-tr-none" 
                    : "bg-surface border border-border-subtle text-foreground rounded-tl-none"
                }`}>
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
                        <AttachmentContent attachment={attachment} key={attachment.id} />
                      ))}
                    </>
                  )}
                  
                  <div className={`mt-1 flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                    <span className={`text-[9px] font-bold ${mine ? "text-neutral-950/60" : "text-muted"}`}>
                      {message.editedAt && "изм. "}{formatTime(message.createdAt)}
                    </span>
                    {!message.deletedAt && (
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                        <button 
                          className={`text-[9px] font-bold uppercase ${mine ? "text-neutral-950/60 hover:text-neutral-950" : "text-muted hover:text-primary"}`}
                          onClick={() => startReplying(message)}
                        >
                          Ответить
                        </button>
                        {mine && message.type === "TEXT" && (
                          <button 
                            className="text-[9px] font-bold uppercase text-neutral-950/60 hover:text-neutral-950"
                            onClick={() => startEditing(message)}
                          >
                            Изменить
                          </button>
                        )}
                        {canDeleteMessage(message, currentUserId, currentRole) && (
                          <button
                            className={`text-[9px] font-bold uppercase ${mine ? "text-neutral-950/60 hover:text-neutral-950" : "text-muted hover:text-red-400"}`}
                            onClick={() => deleteMessage(message.id)}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Reaction Selector (on hover/click) */}
                  {!message.deletedAt && (
                    <div className={`absolute bottom-0 ${mine ? "right-full mr-2" : "left-full ml-2"} hidden group-hover:flex items-center gap-1 bg-surface border border-border-subtle p-1 rounded-full shadow-lg z-10 animate-in fade-in zoom-in-95`}>
                      {ALLOWED_REACTIONS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => toggleReaction(message.id, emoji)}
                          className={`hover:scale-125 transition text-sm px-1`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
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
            
            {selectedFile && (
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

            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
              <div className="relative flex-1">
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
              </div>
              
              <button
                className="btn-primary h-11 w-11 p-0 flex items-center justify-center shrink-0 rounded-full"
                type="button"
                disabled={pending || uploading || (body.trim().length === 0 && !selectedFile)}
                onClick={() => handleSubmit()}
              >
                {uploading || pending ? (
                  <div className="h-4 w-4 border-2 border-neutral-950 border-t-transparent animate-spin rounded-full" />
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
