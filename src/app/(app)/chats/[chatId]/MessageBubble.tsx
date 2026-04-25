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
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} mb-1 px-4`}>
      {showDisplayName && !mine && (
        <span className="mb-1 ml-3 text-[10px] font-bold uppercase tracking-tighter text-muted">
          {message.sender.profile?.displayName ?? message.sender.username}
        </span>
      )}

      <div
        className={`group relative max-w-[78%] px-4 py-2.5 transition-all select-none touch-none cursor-default message-shadow ${radiusClass} ${
          mine ? "text-white" : incomingClass
        }`}
        style={bubbleStyle}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(message.id); }}
      >
        {/* Reply Preview */}
        {message.replyToMessage && (
          <div className={`mb-2 border-l-2 pl-2 py-0.5 text-xs opacity-80 ${mine ? "border-white/40" : "border-primary/50"}`}>
            <p className="font-bold truncate">{message.replyToMessage.sender.profile?.displayName || message.replyToMessage.sender.username}</p>
            <p className="truncate line-clamp-1 italic">
              {message.replyToMessage.deletedAt ? "Сообщение удалено" : (message.replyToMessage.body || "Вложение")}
            </p>
          </div>
        )}

        {message.deletedAt ? (
          <p className="text-xs italic opacity-60">Сообщение удалено</p>
        ) : (
          <>
            {message.body && <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>}
            {message.attachments?.map((att) => (
              <div key={att.id} className="mt-2 first:mt-0">
                {message.type === "VOICE" ? (
                  <VoicePlayer src={`/api/attachments/${att.id}/download`} />
                ) : att.mimeType?.startsWith("image/") ? (
                  <div className="relative overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={`/api/attachments/${att.id}/download`} 
                      alt="" 
                      className="max-h-80 w-full object-cover transition-transform hover:scale-105" 
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-black/20 p-3 border border-white/5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                      <svg className="h-5 w-5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{att.fileName}</p>
                      <p className="text-[10px] font-medium opacity-60 uppercase tracking-tighter">
                        {(att.sizeBytes / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <a 
                      href={`/api/attachments/${att.id}/download`} 
                      className="text-xs font-bold text-white hover:underline"
                    >
                      Скачать
                    </a>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        <div className={`mt-1 flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
          <span className={`text-[9px] font-bold ${mine ? "text-white/60" : "text-muted"}`}>
            {message.editedAt && "изм. "}{time}
          </span>
          {mine && !message.deletedAt && (
            <svg className="h-3 w-3 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Reactions Bar */}
      {Object.keys(groupedReactions).length > 0 && (
        <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "mr-1" : "ml-1"}`}>
          {Object.entries(groupedReactions).map(([emoji, info]) => (
            <button
              key={emoji}
              onClick={() => onReaction(message.id, emoji)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neutral-900 border border-white/10 text-[10px] font-bold text-white/60 transition-all hover:bg-neutral-800"
            >
              <span>{emoji}</span>
              <span>{info.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
