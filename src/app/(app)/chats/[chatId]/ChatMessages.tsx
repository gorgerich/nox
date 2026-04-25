"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSocket } from "@/hooks/useSocket";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble, Message } from "./MessageBubble";
import { useChatAppearance, ChatAppearanceSheet } from "./ChatAppearance";
import { MediaViewer, MediaItem } from "./MediaViewer";

type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

interface GroupedDate {
  type: "date";
  date: Date;
}

interface GroupedMessage {
  type: "message";
  message: Message;
  mine: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  showDisplayName: boolean;
}

type GroupedItem = GroupedDate | GroupedMessage;

function normalizeMessage(message: unknown): Message | null {
  const m = message as Message;
  if (!m?.id || !m.senderUserId || !m.sender?.id || !m.createdAt) {
    return null;
  }
  // Ensure receipts exist as an array
  if (!m.receipts) m.receipts = [];
  return m;
}

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "👎"];

// Mapping for theme presets to real CSS values
const THEME_MAP = {
  midnight: { bg: "#000000", header: "rgba(0,0,0,0.6)", composer: "rgba(0,0,0,0.6)", border: "#1a1a1a", incoming: "#171717", text: "#ffffff" },
  graphite: { bg: "#1a1b1e", header: "rgba(26,27,30,0.7)", composer: "rgba(26,27,30,0.7)", border: "#2c2e33", incoming: "#2c2e33", text: "#ffffff" },
  ocean: { bg: "#0f172a", header: "rgba(15,23,42,0.7)", composer: "rgba(15,23,42,0.7)", border: "#1e293b", incoming: "rgba(30,41,59,0.5)", text: "#f8fafc" },
  ice: { bg: "#f1f3f5", header: "rgba(241,243,245,0.8)", composer: "rgba(241,243,245,0.8)", border: "#dee2e6", incoming: "#ffffff", text: "#1a1c1e" },
  emerald: { bg: "#064e3b", header: "rgba(6,78,59,0.7)", composer: "rgba(6,78,59,0.7)", border: "#065f46", incoming: "rgba(6,95,70,0.5)", text: "#ecfdf5" },
  milk: { bg: "#fdfdfd", header: "rgba(253,253,253,0.8)", composer: "rgba(253,253,253,0.8)", border: "#f1f3f5", incoming: "#f1f3f5", text: "#1a1c1e" },
};

export function ChatMessages({
  chatId,
  currentUserId,
  currentRole,
  isLocked,
  initialMessages,
  chatInfo,
}: {
  chatId: string;
  currentUserId: string;
  currentRole: ChatRole;
  isLocked: boolean;
  initialMessages: unknown[];
  chatInfo: {
    type: string;
    title: string | null;
    otherMember?: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      username: string;
    };
  };
}) {
  const { socket, connected } = useSocket();
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages
      .map(normalizeMessage)
      .filter((m): m is Message => !!m)
  );
  
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { displayName: string; timeoutId: ReturnType<typeof setTimeout> }>>({});
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  const { settings, updateSettings, resetSettings } = useChatAppearance(chatId);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingCancelledRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  const markAsRead = useCallback(async () => {
    try {
      await fetch(`/api/chats/${chatId}/read`, { method: "POST" });
    } catch {
      // silenced
    }
  }, [chatId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (typeof window === "undefined" || !messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
  }, []);

  const forceScrollBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    didInitialScrollRef.current = false;
    markAsRead();
    forceScrollBottom();
    const frame = requestAnimationFrame(forceScrollBottom);
    const t = setTimeout(() => {
      forceScrollBottom();
      didInitialScrollRef.current = true;
    }, 150);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(t);
    };
  }, [chatId, markAsRead, forceScrollBottom]);

  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const container = scrollContainerRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      const lastMsg = messages[messages.length - 1];
      const isMyMsg = lastMsg?.senderUserId === currentUserId;
      if (isNearBottom || isMyMsg) {
        scrollToBottom("smooth");
      }
    }
  }, [messages, currentUserId, scrollToBottom]);

  useEffect(() => {
    if (!socket) return;
    function handleNewMessage(payload: { chatId: string; message: unknown }) {
      if (payload.chatId !== chatId) return;
      const normalized = normalizeMessage(payload.message);
      if (!normalized) return;
      setMessages((current) => {
        if (current.some((m) => m.id === normalized.id)) return current;
        return [...current, normalized];
      });
      if (normalized.senderUserId !== currentUserId) {
        markAsRead();
        socket.emit("message:delivered", { messageId: normalized.id });
      }
    }
    function handleDeletedMessage(payload: { chatId: string; messageId: string }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) => current.map((m) => m.id === payload.messageId ? { ...m, deletedAt: new Date().toISOString() } : m));
    }
    function handleUpdatedMessage(payload: { chatId: string; message: unknown }) {
      if (payload.chatId !== chatId) return;
      const normalized = normalizeMessage(payload.message);
      if (!normalized) return;
      setMessages((current) => current.map((m) => (m.id === normalized.id ? normalized : m)));
    }
    function handleReactionsUpdated(payload: { chatId: string; messageId: string; reactions: Message["reactions"] }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) => current.map((m) => (m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m)));
    }
    function handleReceiptUpdated(payload: { messageId: string; userId: string; deliveredAt: string; readAt: string }) {
      setMessages((current) => current.map((m) => {
        if (m.id !== payload.messageId) return m;
        const receipts = m.receipts || [];
        const existingIdx = receipts.findIndex(r => r.userId === payload.userId);
        const newReceipts = [...receipts];
        if (existingIdx > -1) {
          newReceipts[existingIdx] = { ...newReceipts[existingIdx], deliveredAt: payload.deliveredAt, readAt: payload.readAt };
        } else {
          newReceipts.push({ userId: payload.userId, deliveredAt: payload.deliveredAt, readAt: payload.readAt });
        }
        return { ...m, receipts: newReceipts };
      }));
    }
    function handleReceiptsUpdated(payload: { chatId: string; userId: string; deliveredAt: string; readAt: string }) {
      if (payload.chatId !== chatId) return;
      setMessages((current) => current.map((m) => {
        if (m.senderUserId === payload.userId) return m;
        const receipts = m.receipts || [];
        const existingIdx = receipts.findIndex(r => r.userId === payload.userId);
        const newReceipts = [...receipts];
        if (existingIdx > -1) {
          newReceipts[existingIdx] = { ...newReceipts[existingIdx], deliveredAt: payload.deliveredAt, readAt: payload.readAt };
        } else {
          newReceipts.push({ userId: payload.userId, deliveredAt: payload.deliveredAt, readAt: payload.readAt });
        }
        return { ...m, receipts: newReceipts };
      }));
    }
    function handleTypingUpdate(payload: { chatId: string; userId: string; displayName: string; isTyping: boolean }) {
      if (payload.chatId !== chatId || payload.userId === currentUserId) return;
      setTypingUsers((current) => {
        const next = { ...current };
        if (payload.isTyping) {
          if (next[payload.userId]?.timeoutId) clearTimeout(next[payload.userId].timeoutId);
          const timeoutId = setTimeout(() => {
            setTypingUsers((prev) => {
              const cleaned = { ...prev };
              delete cleaned[payload.userId];
              return cleaned;
            });
          }, 5000);
          next[payload.userId] = { displayName: payload.displayName, timeoutId };
        } else {
          if (next[payload.userId]?.timeoutId) clearTimeout(next[payload.userId].timeoutId);
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
    socket.on("message:receipt-updated", handleReceiptUpdated);
    socket.on("message:receipts-updated", handleReceiptsUpdated);
    socket.on("typing:update", handleTypingUpdate);
    return () => {
      socket.emit("chat:leave", chatId);
      socket.off("message:new", handleNewMessage);
      socket.off("message:deleted", handleDeletedMessage);
      socket.off("message:updated", handleUpdatedMessage);
      socket.off("message:reactions-updated", handleReactionsUpdated);
      socket.off("message:receipt-updated", handleReceiptUpdated);
      socket.off("message:receipts-updated", handleReceiptsUpdated);
      socket.off("typing:update", handleTypingUpdate);
    };
  }, [chatId, socket, currentUserId, markAsRead]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    try {
      await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      setMenuMessageId(null);
    } catch { /* ignored */ }
  };

  const handleSend = async (body: string) => {
    if (!body.trim()) return;
    setPending(true);
    try {
      const url = editingMessage ? `/api/messages/${editingMessage.id}` : `/api/chats/${chatId}/messages`;
      const method = editingMessage ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, replyToMessageId: replyingToMessage?.id }),
      });
      if (!response.ok) throw new Error("Ошибка");
      const data = await response.json();
      const normalized = normalizeMessage(data.message);
      if (normalized) {
        setMessages(curr => curr.some(m => m.id === normalized.id) ? curr : [...curr, normalized]);
      }
      setEditingMessage(null);
      setReplyingToMessage(null);
    } catch (e) { console.error(e); } finally { setPending(false); }
  };

  const handleTyping = (text: string) => {
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
    } else if (isTypingLocal) {
      setIsTypingLocal(false);
      socket.emit("typing:stop", { chatId });
    }
  };

  const handleAttach = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(`/api/chats/${chatId}/attachments`, { method: "POST", body: formData });
      if (!response.ok) throw new Error("Ошибка");
      const data = await response.json();
      const normalized = normalizeMessage(data.message);
      if (normalized) {
        setMessages(curr => curr.some(m => m.id === normalized.id) ? curr : [...curr, normalized]);
      }
    } catch (e) { console.error(e); } finally { setUploading(false); }
  };

  const startRecording = async () => {
    try {
      isRecordingCancelledRef.current = false;
      if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
      const selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(stream, selectedMimeType ? { mimeType: selectedMimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        if (isRecordingCancelledRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: selectedMimeType || "audio/webm" });
        const extension = selectedMimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type });
        await handleAttach(file);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
    } catch (err) { console.error("Mic access denied", err); }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const cancelRecording = () => {
    isRecordingCancelledRef.current = true;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const getStatusSubtitle = () => {
    const users = Object.values(typingUsers);
    if (users.length > 0) return "печатает...";
    if (chatInfo.type === "DIRECT") return connected ? "в сети" : "подключение...";
    return "групповой чат";
  };

  const groupedMessages = useMemo(() => {
    const result: GroupedItem[] = [];
    messages.forEach((msg, idx) => {
      const prev = messages[idx - 1];
      const next = messages[idx + 1];
      const date = new Date(msg.createdAt).toDateString();
      const prevDate = prev ? new Date(prev.createdAt).toDateString() : null;
      if (date !== prevDate) result.push({ type: "date", date: new Date(msg.createdAt) });
      const isGroupStart = !prev || prev.senderUserId !== msg.senderUserId || (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > 300000);
      const isGroupEnd = !next || next.senderUserId !== msg.senderUserId || (new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() > 300000);
      result.push({ type: "message", message: msg, mine: msg.senderUserId === currentUserId, isGroupStart, isGroupEnd, showDisplayName: isGroupStart && chatInfo.type === "GROUP" });
    });
    return result;
  }, [messages, currentUserId, chatInfo.type]);

  const formatDateLabel = (date: Date) => {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "Сегодня";
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Вчера";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  };

  const themeVars = THEME_MAP[settings.preset] || THEME_MAP.midnight;

  return (
    <div 
      className="chat-screen transition-all duration-500" 
      style={{ 
        backgroundColor: themeVars.bg,
        "--chat-header": themeVars.header,
        "--chat-composer": themeVars.composer,
        "--chat-composer-border": themeVars.border,
        "--chat-input-bg": themeVars.border, // reuse border color for subtle input bg
        "--bubble-incoming": themeVars.incoming,
        "--bubble-incoming-text": themeVars.text,
      } as React.CSSProperties}
    >
      <ChatHeader
        chatId={chatId}
        chatType={chatInfo.type}
        title={chatInfo.otherMember?.displayName || chatInfo.title || "Чат"}
        subtitle={getStatusSubtitle()}
        avatarUrl={chatInfo.otherMember?.avatarUrl}
        onAppearanceClick={() => setIsAppearanceOpen(true)}
        isConnected={connected}
      />

      <div 
        ref={scrollContainerRef} 
        className="min-h-0 flex-1 overflow-y-auto px-1 py-4 scrollbar-hide overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className="mx-auto max-w-3xl">
          {groupedMessages.map((item, idx) => {
            if (item.type === "date") {
              return (
                <div key={`date-${idx}`} className="flex justify-center py-6 animate-in fade-in zoom-in-95 duration-300">
                  <span className="rounded-full bg-white/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 backdrop-blur-md border border-white/5 shadow-sm">
                    {formatDateLabel(item.date)}
                  </span>
                </div>
              );
            }
            return (
              <div key={item.message.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <MessageBubble
                  message={item.message}
                  mine={item.mine}
                  settings={settings}
                  onLongPress={setMenuMessageId}
                  onReaction={toggleReaction}
                  onMediaClick={setSelectedMedia}
                  isGroupStart={item.isGroupStart}
                  isGroupEnd={item.isGroupEnd}
                  showDisplayName={item.showDisplayName}
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-4" style={{ overflowAnchor: "auto" }} />
        </div>
      </div>

      <ChatComposer
        key={editingMessage?.id || replyingToMessage?.id || "composer"}
        onSend={handleSend}
        onTyping={handleTyping}
        onAttach={handleAttach}
        onVoiceStart={startRecording}
        onVoiceStop={stopRecording}
        onVoiceCancel={cancelRecording}
        isRecording={isRecording}
        recordingDuration={recordingDuration}
        isLocked={isLocked && currentRole === "MEMBER"}
        pending={pending || uploading}
        replyingTo={replyingToMessage}
        editingTo={editingMessage}
        onCancelAction={() => { setEditingMessage(null); setReplyingToMessage(null); }}
      />

      <ChatAppearanceSheet
        isOpen={isAppearanceOpen}
        onClose={() => setIsAppearanceOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
      />

      <MediaViewer 
        item={selectedMedia}
        onClose={() => setSelectedMedia(null)}
      />

      {/* Message Context Menu Overlay */}
      {menuMessageId && (
        <div 
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 safe-bottom animate-in fade-in duration-200"
          onClick={() => setMenuMessageId(null)}
        >
          <div 
            className="w-full max-w-sm rounded-[32px] bg-neutral-900 p-2 shadow-2xl animate-in slide-in-from-bottom-4 duration-300" 
            onClick={e => e.stopPropagation()}
          >
             <div className="flex justify-around p-3 border-b border-white/5 mb-2 overflow-x-auto scrollbar-hide">
                {ALLOWED_REACTIONS.map(emoji => (
                  <button key={emoji} className="touch-target text-2xl hover:scale-125 active:scale-95 transition-smooth" onClick={() => toggleReaction(menuMessageId, emoji)}>
                    {emoji}
                  </button>
                ))}
             </div>
             <div className="space-y-1">
               <button className="flex w-full items-center gap-3 px-6 py-4 rounded-2xl text-sm font-bold hover:bg-white/5 text-white active:scale-[0.98] transition-smooth" onClick={() => { const m = messages.find(msg => msg.id === menuMessageId); if (m) setReplyingToMessage(m); setMenuMessageId(null); }}>
                  <svg className="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  Ответить
               </button>
               {messages.find(msg => msg.id === menuMessageId)?.senderUserId === currentUserId && (
                 <button className="flex w-full items-center gap-3 px-6 py-4 rounded-2xl text-sm font-bold hover:bg-white/5 text-white active:scale-[0.98] transition-smooth" onClick={() => { const m = messages.find(msg => msg.id === menuMessageId); if (m) setEditingMessage(m); setMenuMessageId(null); }}>
                    <svg className="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Изменить
                 </button>
               )}
               <button className="flex w-full items-center gap-3 px-6 py-4 rounded-2xl text-sm font-bold hover:bg-red-500/10 text-red-500 active:scale-[0.98] transition-smooth" onClick={() => { if (confirm("Удалить сообщение?")) { fetch(`/api/messages/${menuMessageId}`, { method: "DELETE" }); } setMenuMessageId(null); }}>
                  <svg className="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Удалить
               </button>
             </div>
             <button className="mt-2 flex w-full items-center justify-center px-6 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest text-muted hover:text-white transition-smooth active:scale-95" onClick={() => setMenuMessageId(null)}>
                Отмена
             </button>
          </div>
        </div>
      )}
    </div>
  );
}
