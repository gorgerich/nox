"use client";

import { AppearanceSettings } from "./ChatAppearance";
import { VoicePlayer } from "./VoicePlayer";
import { useRef } from "react";
import { MediaItem } from "./MediaViewer";

export type Message = {
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
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }[];
  reactions: {
    emoji: string;
    userId: string;
    user: {
      id: string;
      username: string;
      profile: { displayName: string } | null;
    };
  }[];
  replyToMessage: {
    id: string;
    body: string | null;
    deletedAt: string | null;
    type: string;
    sender: {
      username: string;
      profile: { displayName: string } | null;
    };
  } | null;
  receipts: {
    userId: string;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
};

export function MessageBubble({
  message,
  mine,
  settings,
  onLongPress,
  onReaction,
  onMediaClick,
  isGroupStart,
  isGroupEnd,
  showDisplayName,
}: {
  message: Message;
  mine: boolean;
  settings: AppearanceSettings;
  onLongPress: (id: string) => void;
  onReaction: (id: string, emoji: string) => void;
  onMediaClick: (item: MediaItem) => void;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  showDisplayName: boolean;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startPosRef.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
      onLongPress(message.id);
      timerRef.current = null;
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startPosRef.current || !timerRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startPosRef.current.x);
    const dy = Math.abs(touch.clientY - startPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));

  // --- Dynamic Radius Calculation ---
  const isRound = settings.bubbleRadius === "round";
  const rBase = isRound ? "var(--radius-2xl)" : "var(--radius-lg)";
  const rSmall = "var(--radius-xs)";
  
  const radiusStyle = mine 
    ? {
        borderTopLeftRadius: rBase,
        borderBottomLeftRadius: rBase,
        borderTopRightRadius: isGroupStart ? rSmall : rBase,
        borderBottomRightRadius: isGroupEnd ? rBase : rSmall,
      }
    : {
        borderTopRightRadius: rBase,
        borderBottomRightRadius: rBase,
        borderTopLeftRadius: isGroupStart ? rSmall : rBase,
        borderBottomLeftRadius: isGroupEnd ? rBase : rSmall,
      };

  // --- Dynamic Style Calculation ---
  const bubbleStyle: React.CSSProperties = mine 
    ? { backgroundColor: settings.outgoingColor, color: "var(--bubble-outgoing-text)", ...radiusStyle }
    : { ...radiusStyle };

  const incomingClass = settings.incomingStyle === "glass" 
    ? "bg-surface/40 backdrop-blur-lg border border-border-subtle/50" 
    : settings.incomingStyle === "minimal" 
      ? "bg-transparent border border-border-subtle/30"
      : "bg-[var(--bubble-incoming)] border border-border-subtle/50";

  const groupedReactions = message.reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, me: false };
    acc[r.emoji].count++;
    return acc;
  }, {} as Record<string, { count: number; me: boolean }>);

  const isRead = message.receipts?.some(r => r.readAt);
  const isDelivered = message.receipts?.some(r => r.deliveredAt);

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} mb-1 px-4 transition-smooth`}>
      {showDisplayName && !mine && (
        <span className="mb-1 ml-3 text-[10px] font-black uppercase tracking-widest text-muted/60">
          {message.sender.profile?.displayName ?? message.sender.username}
        </span>
      )}

      <div
        className={`group relative max-w-[85%] px-4 py-2.5 transition-smooth cursor-default active:scale-[0.99] touch-pan-y ${
          mine ? "text-white shadow-sm" : "text-[var(--bubble-incoming-text)] shadow-sm"
        } ${mine ? "" : incomingClass}`}
        style={bubbleStyle}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(message.id); }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {message.replyToMessage && (
          <div className={`mb-2 border-l-2 pl-2.5 py-0.5 text-[11px] leading-tight opacity-90 ${mine ? "border-white/40" : "border-primary/50"}`}>
            <p className="font-black truncate tracking-tight">{message.replyToMessage.sender.profile?.displayName || message.replyToMessage.sender.username}</p>
            <p className="truncate line-clamp-1 italic opacity-70">
              {message.replyToMessage.deletedAt ? "Сообщение удалено" : (message.replyToMessage.body || "Вложение")}
            </p>
          </div>
        )}

        {message.deletedAt ? (
          <p className="text-xs italic opacity-50 font-medium">Сообщение удалено</p>
        ) : (
          <>
            {message.body && <p className="whitespace-pre-wrap text-[15px] leading-snug font-medium break-words">{message.body}</p>}
            {message.attachments?.map((att) => {
              const downloadUrl = `/api/attachments/${att.id}/download`;
              const isImage = att.mimeType.startsWith("image/");
              const isVideo = att.mimeType.startsWith("video/");

              return (
                <div key={att.id} className="mt-2 first:mt-0 overflow-hidden rounded-lg">
                  {message.type === "VOICE" ? (
                    <VoicePlayer 
                      src={downloadUrl} 
                      themeColor={mine ? "var(--bubble-outgoing-text)" : "var(--voice-control)"}
                      isMine={mine}
                      cornerRadius={settings.bubbleRadius}
                    />
                  ) : isImage ? (
                    <div 
                      className="relative overflow-hidden rounded-lg border border-black/5 cursor-pointer active:opacity-90 transition-opacity"
                      onClick={() => onMediaClick({ id: att.id, type: "IMAGE", url: downloadUrl, fileName: att.fileName })}
                    >
                      <img 
                        src={downloadUrl} 
                        alt="" 
                        className="max-h-96 w-full object-cover transition-smooth hover:scale-105" 
                        loading="lazy"
                      />
                    </div>
                  ) : isVideo ? (
                    <div 
                      className="relative overflow-hidden rounded-lg border border-black/5 cursor-pointer active:opacity-90 transition-opacity flex items-center justify-center bg-black/10"
                      onClick={() => onMediaClick({ id: att.id, type: "VIDEO", url: downloadUrl, fileName: att.fileName })}
                    >
                      <video src={downloadUrl} className="max-h-96 w-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                          <svg className="h-6 w-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="flex items-center gap-3 rounded-xl bg-black/10 p-4 border border-black/5 backdrop-blur-md transition-smooth active:bg-black/40 cursor-pointer"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = downloadUrl;
                        link.target = "_self";
                        link.click();
                      }}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white/90 shadow-inner">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black tracking-tight">{att.fileName}</p>
                        <p className="text-[9px] font-black opacity-50 uppercase tracking-widest mt-0.5">
                          {(att.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        <div className={`mt-1 flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
          <span className={`text-[9px] font-black uppercase tracking-tighter ${mine ? "text-white/70" : "text-muted/60"}`}>
            {message.editedAt && "изм. "}{time}
          </span>
          {mine && !message.deletedAt && (
            <div className="flex items-center ml-0.5">
              {isRead ? (
                <div className="flex -space-x-1.5">
                  <svg className="h-3 w-3 text-[var(--bubble-read)] animate-in fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <svg className="h-3 w-3 text-[var(--bubble-read)] animate-in fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : isDelivered ? (
                <div className="flex -space-x-1.5">
                  <svg className="h-3 w-3 text-[var(--bubble-delivered)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <svg className="h-3 w-3 text-[var(--bubble-delivered)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <svg className="h-3 w-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          )}
        </div>
      </div>

      {Object.keys(groupedReactions).length > 0 && (
        <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "mr-1" : "ml-1"} animate-in fade-in zoom-in-95 duration-200`}>
          {Object.entries(groupedReactions).map(([emoji, info]) => (
            <button
              key={emoji}
              onClick={() => onReaction(message.id, emoji)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-muted border border-border-subtle text-xs font-black text-foreground/70 transition-smooth hover:bg-surface-hover active:scale-90 shadow-sm"
            >
              <span>{emoji}</span>
              <span className="text-[10px]">{info.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
