"use client";

import { AppearanceSettings } from "./ChatAppearance";
import { VoicePlayer } from "./VoicePlayer";

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
};

export function MessageBubble({
  message,
  mine,
  settings,
  onLongPress,
  onReaction,
  isGroupStart,
  isGroupEnd,
  showDisplayName,
}: {
  message: Message;
  mine: boolean;
  settings: AppearanceSettings;
  onLongPress: (id: string) => void;
  onReaction: (id: string, emoji: string) => void;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  showDisplayName: boolean;
}) {
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));

  const radiusClass = settings.bubbleRadius === "round" 
    ? (mine 
        ? (isGroupStart ? "rounded-3xl rounded-tr-sm" : isGroupEnd ? "rounded-3xl rounded-tr-3xl" : "rounded-3xl rounded-tr-sm rounded-br-sm")
        : (isGroupStart ? "rounded-3xl rounded-tl-sm" : isGroupEnd ? "rounded-3xl rounded-tl-3xl" : "rounded-3xl rounded-tl-sm rounded-bl-sm")
      )
    : "rounded-2xl";

  const bubbleStyle = mine 
    ? { backgroundColor: settings.outgoingColor, color: "#fff" }
    : {};

  const incomingClass = settings.incomingStyle === "glass" 
    ? "bg-white/10 backdrop-blur-lg border border-white/10" 
    : settings.incomingStyle === "minimal" 
      ? "bg-neutral-900/40 border border-neutral-800"
      : "bg-neutral-900 border border-neutral-800";

  // Group reactions
  const groupedReactions = message.reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, me: false };
    acc[r.emoji].count++;
    return acc;
  }, {} as Record<string, { count: number; me: boolean }>);

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} mb-1.5 px-4 transition-smooth`}>
      {showDisplayName && !mine && (
        <span className="mb-1.5 ml-3 text-[10px] font-black uppercase tracking-widest text-muted/60">
          {message.sender.profile?.displayName ?? message.sender.username}
        </span>
      )}

      <div
        className={`group relative max-w-[82%] px-4 py-3 transition-smooth select-none touch-none cursor-default message-shadow active:scale-[0.99] ${radiusClass} ${
          mine ? "text-white" : incomingClass
        }`}
        style={bubbleStyle}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(message.id); }}
      >
        {/* Reply Preview */}
        {message.replyToMessage && (
          <div className={`mb-2.5 border-l-2 pl-2.5 py-0.5 text-xs opacity-80 ${mine ? "border-white/40" : "border-primary/50"}`}>
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
            {message.body && <p className="whitespace-pre-wrap text-sm leading-relaxed font-medium">{message.body}</p>}
            {message.attachments?.map((att) => (
              <div key={att.id} className="mt-2.5 first:mt-0 overflow-hidden rounded-xl">
                {message.type === "VOICE" ? (
                  <VoicePlayer src={`/api/attachments/${att.id}/download`} />
                ) : att.mimeType?.startsWith("image/") ? (
                  <div className="relative overflow-hidden rounded-xl border border-white/5 shadow-inner">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={`/api/attachments/${att.id}/download`} 
                      alt="" 
                      className="max-h-96 w-full object-cover transition-smooth hover:scale-105" 
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl bg-black/30 p-4 border border-white/5 backdrop-blur-md transition-smooth active:bg-black/40">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold tracking-tight">{att.fileName}</p>
                      <p className="text-[10px] font-black opacity-50 uppercase tracking-widest mt-0.5">
                        {(att.sizeBytes / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <a 
                      href={`/api/attachments/${att.id}/download`} 
                      className="touch-target text-xs font-black text-white hover:underline uppercase tracking-widest bg-white/10 px-3 py-2 rounded-lg"
                    >
                      OK
                    </a>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        <div className={`mt-1.5 flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
          <span className={`text-[9px] font-black uppercase tracking-tighter opacity-60 ${mine ? "text-white" : "text-muted"}`}>
            {message.editedAt && "изм. "}{time}
          </span>
          {mine && !message.deletedAt && (
            <svg className="h-3.5 w-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Reactions Bar */}
      {Object.keys(groupedReactions).length > 0 && (
        <div className={`mt-1.5 flex flex-wrap gap-1 ${mine ? "mr-1" : "ml-1"} animate-in fade-in zoom-in-95 duration-200`}>
          {Object.entries(groupedReactions).map(([emoji, info]) => (
            <button
              key={emoji}
              onClick={() => onReaction(message.id, emoji)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-900/80 border border-white/10 text-xs font-black text-white/70 transition-smooth hover:bg-neutral-800 active:scale-90 backdrop-blur-sm shadow-sm"
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
