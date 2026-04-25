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
  if (!m.receipts) m.receipts = [];
  return m;
}

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

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
  
  const [menuState, setMenuState] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  const { settings, updateSettings, resetSettings } = useChatAppearance(chatId);

  const handleLongPress = useCallback((id: string, rect: DOMRect) => {
    if (isSelectionMode) return;
    setMenuState({ id, rect });
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(40);
    }
  }, [isSelectionMode]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  const startSelection = useCallback((id: string) => {
    setIsSelectionMode(true);
    setSelectedIds(new Set([id]));
    setMenuState(null);
  }, []);

  const handleCopy = useCallback((text: string | null) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setMenuState(null);
  }, []);

  const handleDeleteQuietly = useCallback(async (id: string) => {
    try {
      setMessages(curr => curr.filter(m => m.id !== id));
      await fetch(`/api/messages/${id}`, { method: "DELETE" });
    } catch (e) {
      console.error("Delete failed", e);
    }
    setMenuState(null);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setMessages(curr => curr.filter(m => !selectedIds.has(m.id)));
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    for (const id of ids) {
       fetch(`/api/messages/${id}`, { method: "DELETE" }).catch(() => {});
    }
  }, [selectedIds]);

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
    } catch { /* silenced */ }
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
      setMessages((current) => current.filter((m) => m.id !== payload.messageId));
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
      setMenuState(null);
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
        setMessages(curr => curr.map(m => m.id === normalized.id ? normalized : m));
        if (!editingMessage) {
           setMessages(curr => curr.some(m => m.id === normalized.id) ? curr : [...curr, normalized]);
        }
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
  const focusedMessage = useMemo(() => menuState ? messages.find(m => m.id === menuState.id) : null, [menuState, messages]);

  return (
    <div 
      className={`chat-screen transition-all duration-500 ${menuState ? "overflow-hidden" : ""}`} 
      style={{ 
        backgroundColor: themeVars.bg,
        "--chat-header": themeVars.header,
        "--chat-composer": themeVars.composer,
        "--chat-composer-border": themeVars.border,
        "--chat-input-bg": themeVars.border,
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
                  onLongPress={handleLongPress}
                  onReaction={toggleReaction}
                  onMediaClick={setSelectedMedia}
                  isGroupStart={item.isGroupStart}
                  isGroupEnd={item.isGroupEnd}
                  showDisplayName={item.showDisplayName}
                  selectionMode={isSelectionMode}
                  isSelected={selectedIds.has(item.message.id)}
                  onSelect={toggleSelection}
                  isFocused={menuState?.id === item.message.id}
                />
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-4" style={{ overflowAnchor: "auto" }} />
        </div>
      </div>

      {isSelectionMode ? (
        <div className="glass-composer px-6 py-4 flex items-center justify-between animate-in slide-in-from-bottom-full duration-300">
           <button 
             onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }}
             className="text-sm font-black uppercase tracking-widest text-primary active:scale-95 transition-smooth"
           >
             Отмена
           </button>
           <div className="flex gap-6">
              <button 
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                className="touch-target h-12 w-12 flex items-center justify-center rounded-2xl bg-danger/10 text-danger disabled:opacity-30 active:scale-90 transition-smooth shadow-lg shadow-danger/5"
              >
                 <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
              <button 
                disabled={selectedIds.size === 0}
                className="touch-target h-12 w-12 flex items-center justify-center rounded-2xl bg-primary/10 text-primary disabled:opacity-30 active:scale-90 transition-smooth shadow-lg shadow-primary/5"
              >
                 <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              </button>
           </div>
        </div>
      ) : (
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
      )}

      {/* --- Context Menu Overlay --- */}
      {menuState && focusedMessage && (
        <>
          <div className="menu-overlay" onClick={() => setMenuState(null)} />
          <div 
            className="menu-content"
            style={{
              top: Math.max(20, Math.min(window.innerHeight - 380, menuState.rect.top - 70)),
              left: focusedMessage.senderUserId === currentUserId ? 'auto' : Math.min(window.innerWidth - 280, Math.max(20, menuState.rect.left)),
              right: focusedMessage.senderUserId === currentUserId ? Math.min(window.innerWidth - 280, Math.max(20, window.innerWidth - menuState.rect.right)) : 'auto',
            }}
          >
            {/* Reactions Bar */}
            <div className="reaction-bar self-center mb-2 px-3">
               {ALLOWED_REACTIONS.map(emoji => (
                 <button 
                   key={emoji} 
                   className={`reaction-btn ${focusedMessage.reactions.some(r => r.emoji === emoji && r.userId === currentUserId) ? "bg-primary/20 scale-125" : ""}`}
                   onClick={() => toggleReaction(menuState.id, emoji)}
                 >
                   {emoji}
                 </button>
               ))}
            </div>

            {/* Actions Menu */}
            <div className={`action-menu ${focusedMessage.senderUserId === currentUserId ? "self-end" : "self-start"}`}>
              <button className="action-item" onClick={() => { setReplyingToMessage(focusedMessage); setMenuState(null); }}>
                <span>Ответить</span>
                <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
              </button>

              {focusedMessage.body && (
                <button className="action-item" onClick={() => handleCopy(focusedMessage.body)}>
                  <span>Копировать</span>
                  <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                </button>
              )}

              <button className="action-item">
                <span>Закрепить</span>
                <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
              </button>

              {focusedMessage.senderUserId === currentUserId && focusedMessage.type === "TEXT" && (
                <button className="action-item" onClick={() => { setEditingMessage(focusedMessage); setMenuState(null); }}>
                  <span>Изменить</span>
                  <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
              )}

              <button className="action-item">
                <span>Переслать</span>
                <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              </button>

              <button className="action-item" onClick={() => startSelection(focusedMessage.id)}>
                <span>Выбрать</span>
                <svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>

              <button className="action-item action-item-destructive" onClick={() => handleDeleteQuietly(focusedMessage.id)}>
                <span>Удалить</span>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        </>
      )}

      <ChatAppearanceSheet
        isOpen={isAppearanceOpen}
        onClose={() => setIsAppearanceOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
      />

      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />
    </div>
  );
}
