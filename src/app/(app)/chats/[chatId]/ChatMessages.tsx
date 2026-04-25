"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSocket } from "@/hooks/useSocket";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble, Message } from "./MessageBubble";
import { useChatAppearance, ChatAppearanceSheet, PRESETS } from "./ChatAppearance";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { useSearchParams } from "next/navigation";

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

interface RecentChat {
  id: string;
  title: string;
}

interface ChatMember {
  userId: string;
  user: {
    profile?: {
      displayName: string;
    } | null;
  };
}

interface ChatApiResponse {
  chats: {
    id: string;
    type: string;
    title: string | null;
    members: ChatMember[];
  }[];
}

interface SearchResultMessage {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
}

function normalizeMessage(message: unknown): Message | null {
  const m = message as Message;
  if (!m?.id || !m.senderUserId || !m.sender?.id || !m.createdAt) return null;
  if (m.deletedAt) return null; 
  if (!m.receipts) m.receipts = [];
  return m;
}

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];

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
  const searchParams = useSearchParams();
  
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages.map(normalizeMessage).filter((m): m is Message => !!m)
  );
  
  const [pending, setPending] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [menuState, setMenuState] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [forwardingMessages, setForwardingMessages] = useState<Message[] | null>(null);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [showForwardPicker, setShowForwardPicker] = useState(false);

  // Message Search State
  const [isSearchOpen, setIsSearchOpen] = useState(() => searchParams.get("search") === "true");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const { settings, updateSettings, resetSettings } = useChatAppearance(chatId);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const forceScrollBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  const jumpToMessage = useCallback((id: string) => {
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 2500);
      setIsSearchOpen(false);
    }
  }, []);

  useEffect(() => {
    const isSearchParam = searchParams.get("search") === "true";
    if (isSearchParam && !isSearchOpen) {
      setTimeout(() => setIsSearchOpen(true), 0);
    }
  }, [searchParams, isSearchOpen]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      if (searchResults.length > 0) {
        setTimeout(() => setSearchResults([]), 0);
      }
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/chats/${chatId}/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data.messages || []);
      } catch {} finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery, chatId, searchResults.length]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    let frameId: number;
    const stabilize = () => {
       forceScrollBottom("auto");
       if (!initialScrollDoneRef.current) frameId = requestAnimationFrame(stabilize);
    };
    stabilize();
    const t1 = setTimeout(() => forceScrollBottom("auto"), 100);
    const t2 = setTimeout(() => {
      forceScrollBottom("auto");
      initialScrollDoneRef.current = true;
    }, 600);
    fetch(`/api/chats/${chatId}/read`, { method: "POST" }).catch(() => {});
    return () => { cancelAnimationFrame(frameId); clearTimeout(t1); clearTimeout(t2); };
  }, [chatId, forceScrollBottom]);

  useEffect(() => {
    const saved = localStorage.getItem(`nox:pinned:${chatId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      setTimeout(() => setPinnedIds(parsed), 0);
    }
    let active = true;
    fetch("/api/chats").then(res => res.json()).then((data: ChatApiResponse) => {
      if (active && Array.isArray(data.chats)) {
        setRecentChats(data.chats.map((c) => ({
          id: c.id,
          title: c.type === "DIRECT" ? (c.members.find((m) => m.userId !== currentUserId)?.user.profile?.displayName || "Чат") : (c.title || "Группа")
        })));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [chatId, currentUserId]);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) forceScrollBottom("smooth");
  }, [messages, forceScrollBottom]);

  const handleLongPress = useCallback((id: string, rect: DOMRect) => {
    if (isSelectionMode) return;
    setMenuState({ id, rect });
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(40);
  }, [isSelectionMode]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
    setMessages(curr => curr.filter(m => m.id !== id));
    setMenuState(null);
    try { await fetch(`/api/messages/${id}`, { method: "DELETE" }); } catch {}
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setMessages(curr => curr.filter(m => !selectedIds.has(m.id)));
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    for (const id of ids) fetch(`/api/messages/${id}`, { method: "DELETE" }).catch(() => {});
  }, [selectedIds]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      localStorage.setItem(`nox:pinned:${chatId}`, JSON.stringify(next));
      return next;
    });
    setMenuState(null);
  }, [chatId]);

  const initiateForward = useCallback((msg: Message | Message[]) => {
    setForwardingMessages(Array.isArray(msg) ? msg : [msg]);
    setShowForwardPicker(true);
    setMenuState(null);
  }, []);

  const confirmForward = useCallback(async (targetChatId: string) => {
    if (!forwardingMessages) return;
    setShowForwardPicker(false);
    for (const msg of forwardingMessages) {
      if (msg.body) {
        await fetch(`/api/chats/${targetChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: `[Переслано] ${msg.body}` })
        });
      }
    }
    setForwardingMessages(null);
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, [forwardingMessages]);

  useEffect(() => {
    if (!socket) return;
    const handleNewMessage = (p: { chatId: string; message: unknown }) => {
      if (p.chatId !== chatId) return;
      const m = normalizeMessage(p.message);
      if (m) setMessages(c => c.some(x => x.id === m.id) ? c : [...c, m]);
    };
    const handleDeletedMessage = (p: { chatId: string; messageId: string }) => {
      if (p.chatId === chatId) setMessages(c => c.filter(x => x.id !== p.messageId));
    };
    socket.emit("chat:join", chatId);
    socket.on("message:new", handleNewMessage);
    socket.on("message:deleted", handleDeletedMessage);
    return () => {
      socket.emit("chat:leave", chatId);
      socket.off("message:new", handleNewMessage);
      socket.off("message:deleted", handleDeletedMessage);
    };
  }, [chatId, socket]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    try {
      await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      setMenuState(null);
    } catch {}
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
      if (response.ok) {
        const data = await response.json();
        const m = normalizeMessage(data.message);
        if (m) {
          setMessages(curr => {
            const exists = curr.find(x => x.id === m.id);
            if (exists) return curr.map(x => x.id === m.id ? m : x);
            return [...curr, m];
          });
        }
      }
      setEditingMessage(null);
      setReplyingToMessage(null);
    } catch {} finally { setPending(false); }
  };

  const themeVars = PRESETS[settings.preset]?.vars || PRESETS.midnight.vars;
  const focusedMessage = useMemo(() => menuState ? messages.find(m => m.id === menuState.id) : null, [menuState, messages]);

  const menuPosition = useMemo(() => {
    if (!menuState) return null;
    const spaceBelow = window.innerHeight - menuState.rect.bottom;
    const spaceAbove = menuState.rect.top;
    const menuHeight = 350;
    const showAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    
    return {
      top: showAbove ? 'auto' : Math.max(20, Math.min(window.innerHeight - menuHeight, menuState.rect.top - 70)),
      bottom: showAbove ? (window.innerHeight - menuState.rect.top + 10) : 'auto',
      left: focusedMessage?.senderUserId === currentUserId ? 'auto' : Math.min(window.innerWidth - 280, Math.max(20, menuState.rect.left)),
      right: focusedMessage?.senderUserId === currentUserId ? Math.min(window.innerWidth - 280, Math.max(20, window.innerWidth - menuState.rect.right)) : 'auto',
    };
  }, [menuState, focusedMessage, currentUserId]);

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

  const currentUserInfo = useMemo(() => { return { displayName: "Я", avatarUrl: null }; }, []);

  return (
    <div 
      className={`chat-screen transition-all duration-500 ${menuState ? "overflow-hidden" : ""}`} 
      style={themeVars as React.CSSProperties}
    >
      <ChatHeader
        chatId={chatId}
        chatType={chatInfo.type}
        title={chatInfo.otherMember?.displayName || chatInfo.title || "Чат"}
        subtitle={connected ? "в сети" : "подключение..."}
        avatarUrl={chatInfo.otherMember?.avatarUrl}
        onAppearanceClick={() => setIsAppearanceOpen(true)}
        isConnected={connected}
        currentUser={currentUserInfo}
        partnerId={chatInfo.otherMember?.id}
      />

      {isSearchOpen && (
        <div className="sticky top-0 z-[150] glass-header px-4 py-3 animate-in slide-in-from-top-full duration-300 shadow-xl">
           <div className="relative flex items-center gap-3">
              <div className="relative flex-1">
                 <input 
                   className="input-nox h-12 pl-12 pr-4 bg-foreground/5 border-none focus:ring-primary/20" 
                   placeholder="Поиск сообщений..." 
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   autoFocus
                 />
                 <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <button onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }} className="text-sm font-black uppercase text-primary">Отмена</button>
           </div>
           
           {searchResults.length > 0 && (
             <div className="mt-4 max-h-60 overflow-y-auto space-y-2 pb-2">
                {searchResults.map(m => (
                  <button key={m.id} onClick={() => jumpToMessage(m.id)} className="w-full text-left p-3 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-[0.98]">
                     <div className="flex justify-between mb-1">
                        <span className="text-[10px] font-black uppercase text-primary">{m.senderName}</span>
                        <span className="text-[9px] font-bold text-muted">{new Date(m.createdAt).toLocaleDateString()}</span>
                     </div>
                     <p className="text-xs truncate text-foreground/80">{m.body}</p>
                  </button>
                ))}
             </div>
           )}
           {searchQuery && !searching && searchResults.length === 0 && (
             <p className="mt-4 text-center text-[10px] font-black uppercase text-muted py-4">Ничего не найдено</p>
           )}
        </div>
      )}

      {pinnedIds.length > 0 && (
        <div className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-border-subtle/30 px-4 py-2 flex items-center justify-between animate-in slide-in-from-top-2">
           <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-1 bg-primary rounded-full" />
              <div className="min-w-0 cursor-pointer" onClick={() => jumpToMessage(pinnedIds[pinnedIds.length-1])}>
                 <p className="text-[10px] font-black uppercase text-primary">Закреплённое сообщение</p>
                 <p className="text-xs truncate text-foreground/60">{messages.find(m => m.id === pinnedIds[pinnedIds.length-1])?.body || "Вложение"}</p>
              </div>
           </div>
           <button onClick={() => setPinnedIds([])} className="text-muted p-2"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}

      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-1 py-4 scrollbar-hide overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className="mx-auto max-w-3xl">
          {groupedMessages.map((item, idx) => (
            item.type === "date" ? (
              <div key={`date-${idx}`} className="flex justify-center py-6">
                <span className="rounded-full bg-foreground/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-foreground/40 backdrop-blur-md border border-foreground/5">
                  {formatDateLabel(item.date)}
                </span>
              </div>
            ) : (
              <div 
                key={item.message.id} 
                ref={el => { messageRefs.current[item.message.id] = el; }}
                className={`animate-in fade-in slide-in-from-bottom-2 duration-300 ${highlightedId === item.message.id ? "ring-2 ring-primary rounded-3xl ring-offset-4 ring-offset-transparent bg-primary/5 scale-[1.02] transition-all duration-500" : ""}`}
              >
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
            )
          ))}
          <div ref={messagesEndRef} className="h-4" style={{ overflowAnchor: "auto" }} />
        </div>
      </div>

      {isSelectionMode ? (
        <div className="glass-composer px-6 py-4 flex items-center justify-between animate-in slide-in-from-bottom-full duration-300">
           <button onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }} className="text-sm font-black uppercase text-primary">Отмена</button>
           <div className="flex gap-6">
              <button onClick={handleDeleteSelected} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-2xl bg-danger/10 text-danger disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              <button onClick={() => initiateForward(messages.filter(m => selectedIds.has(m.id)))} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-2xl bg-primary/10 text-primary disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></button>
           </div>
        </div>
      ) : (
        <ChatComposer
          onSend={handleSend}
          onTyping={() => {}}
          onAttach={() => {}}
          onVoiceStart={() => {}}
          onVoiceStop={() => {}}
          onVoiceCancel={() => {}}
          isRecording={false}
          recordingDuration={0}
          isLocked={isLocked && currentRole === "MEMBER"}
          pending={pending}
          replyingTo={replyingToMessage}
          editingTo={editingMessage}
          onCancelAction={() => { setEditingMessage(null); setReplyingToMessage(null); }}
        />
      )}

      {menuState && focusedMessage && (
        <>
          <div className="menu-overlay" onClick={() => setMenuState(null)} />
          <div className="menu-content" style={menuPosition as React.CSSProperties}>
            <div className="reaction-bar self-center mb-2 px-3">
               {ALLOWED_REACTIONS.map(emoji => (
                 <button key={emoji} className={`reaction-btn ${focusedMessage.reactions.some(r => r.emoji === emoji && r.userId === currentUserId) ? "bg-primary/20 scale-125" : ""}`} onClick={() => toggleReaction(menuState.id, emoji)}>{emoji}</button>
               ))}
            </div>
            <div className={`action-menu ${focusedMessage.senderUserId === currentUserId ? "self-end" : "self-start"}`}>
              <button className="action-item" onClick={() => { setReplyingToMessage(focusedMessage); setMenuState(null); }}><span>Ответить</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg></button>
              {focusedMessage.body && <button className="action-item" onClick={() => handleCopy(focusedMessage.body)}><span>Копировать</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg></button>}
              <button className="action-item" onClick={() => togglePin(focusedMessage.id)}><span>{pinnedIds.includes(focusedMessage.id) ? "Открепить" : "Закрепить"}</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg></button>
              {focusedMessage.senderUserId === currentUserId && focusedMessage.type === "TEXT" && <button className="action-item" onClick={() => { setEditingMessage(focusedMessage); setMenuState(null); }}><span>Изменить</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>}
              <button className="action-item" onClick={() => initiateForward(focusedMessage)}><span>Переслать</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></button>
              <button className="action-item" onClick={() => startSelection(focusedMessage.id)}><span>Выбрать</span><svg className="h-5 w-5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
              <button className="action-item action-item-destructive" onClick={() => handleDeleteQuietly(focusedMessage.id)}><span>Удалить</span><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
            </div>
          </div>
        </>
      )}

      {showForwardPicker && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6 animate-in fade-in">
           <div className="w-full max-w-sm rounded-[2.5rem] bg-surface p-6 shadow-2xl">
              <h2 className="text-xl font-black mb-6 px-2">Переслать в...</h2>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                 {recentChats.map(c => (
                   <button key={c.id} onClick={() => confirmForward(c.id)} className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-95">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black">{c.title[0]}</div>
                      <span className="font-bold truncate">{c.title}</span>
                   </button>
                 ))}
              </div>
              <button onClick={() => setShowForwardPicker(false)} className="w-full mt-6 py-4 font-black uppercase text-muted hover:text-foreground">Отмена</button>
           </div>
        </div>
      )}

      <ChatAppearanceSheet isOpen={isAppearanceOpen} onClose={() => setIsAppearanceOpen(false)} settings={settings} onUpdate={updateSettings} onReset={resetSettings} />
      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />
    </div>
  );
}
