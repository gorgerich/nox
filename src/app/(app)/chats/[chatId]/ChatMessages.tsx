"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

type Message = {
  id: string;
  body: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  deletedAt: string | null;
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
};

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function canDeleteMessage(message: Message, currentUserId: string, currentRole: ChatRole) {
  return message.senderUserId === currentUserId || currentRole === "OWNER" || currentRole === "ADMIN";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentContent({ attachment }: { attachment: Attachment }) {
  const href = `/api/attachments/${attachment.id}/download`;

  if (attachment.mimeType.startsWith("image/")) {
    return (
      <a className="mt-3 block" href={href} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={attachment.fileName}
          className="max-h-80 max-w-full rounded-md border border-neutral-800 object-contain"
          src={href}
        />
      </a>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
      <p className="break-words text-sm font-medium text-neutral-100">{attachment.fileName}</p>
      <p className="mt-1 text-xs text-neutral-500">
        {attachment.mimeType} · {formatFileSize(attachment.sizeBytes)}
      </p>
      <a
        className="mt-3 inline-flex min-h-10 items-center rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white"
        href={href}
      >
        Скачать
      </a>
    </div>
  );
}

function getUiErrorMessage(message?: string) {
  if (!message) {
    return "Не удалось выполнить действие.";
  }

  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("размер")) {
    return "Файл слишком большой.";
  }

  if (lowerMessage.includes("тип")) {
    return "Этот тип файла не поддерживается.";
  }

  if (lowerMessage.includes("доступ") || lowerMessage.includes("forbidden")) {
    return "Нет доступа.";
  }

  return message;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const memberLocked = isLocked && currentRole === "MEMBER";

  useEffect(() => {
    if (!socket) {
      return;
    }

    function handleNewMessage(payload: { chatId: string; message: Message }) {
      if (payload.chatId !== chatId) {
        return;
      }

      setMessages((current) => {
        if (current.some((message) => message.id === payload.message.id)) {
          return current;
        }

        return [...current, payload.message].slice(-50);
      });
    }

    socket.emit("chat:join", chatId);
    socket.on("message:new", handleNewMessage);

    return () => {
      socket.emit("chat:leave", chatId);
      socket.off("message:new", handleNewMessage);
    };
  }, [chatId, socket]);

  async function refreshMessages() {
    const response = await fetch(`/api/chats/${chatId}/messages`);

    if (!response.ok) {
      setError("Не удалось загрузить чаты.");
      return;
    }

    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBody = body.trim();

    if (!nextBody) {
      return;
    }

    setError("");
    setPending(true);

    const response = await fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: nextBody }),
    });

    setPending(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(getUiErrorMessage(data?.error) || "Не удалось отправить сообщение.");
      return;
    }

    const data = (await response.json()) as { message: Message };
    setMessages((current) => [...current, data.message].slice(-50));
    setBody("");
    router.refresh();
  }

  async function uploadAttachment() {
    if (!selectedFile) {
      setError("Выберите файл для отправки.");
      return;
    }

    setError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    const response = await fetch(`/api/chats/${chatId}/attachments`, {
      method: "POST",
      body: formData,
    });

    setUploading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(getUiErrorMessage(data?.error) || "Не удалось загрузить файл.");
      return;
    }

    const data = (await response.json()) as { message: Message };
    setMessages((current) => [...current, data.message].slice(-50));
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    router.refresh();
  }

  async function deleteMessage(messageId: string) {
    setError("");
    const response = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(getUiErrorMessage(data?.error) || "Не удалось удалить сообщение.");
      return;
    }

    const data = (await response.json()) as { message: { id: string; deletedAt: string | null } };
    setMessages((current) =>
      current.map((message) =>
        message.id === data.message.id ? { ...message, deletedAt: data.message.deletedAt } : message,
      ),
    );
    router.refresh();
  }

  return (
    <div className="flex min-h-[calc(100svh-180px)] flex-col rounded-lg border border-neutral-800 bg-neutral-900 sm:min-h-[calc(100svh-188px)] lg:min-h-[620px]">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div>
          <span className="text-sm text-neutral-400">Сообщений: {messages.length}</span>
          <p className="mt-1 text-xs text-neutral-500">{connected ? "В сети" : "Подключение..."}</p>
        </div>
        <button
          className="min-h-10 rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white"
          onClick={refreshMessages}
          type="button"
        >
          Обновить
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">
            Сообщений пока нет.
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderUserId === currentUserId;
            const displayName = message.sender.profile?.displayName ?? message.sender.username;

            return (
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`} key={message.id}>
                <div
                  className={`max-w-[78%] rounded-lg border px-4 py-3 ${
                    mine
                      ? "border-emerald-500/30 bg-emerald-500/15"
                      : "border-neutral-800 bg-neutral-950"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-neutral-100">{displayName}</span>
                    <span className="text-xs text-neutral-500">{formatTime(message.createdAt)}</span>
                  </div>
                  {message.deletedAt ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm italic leading-6 text-neutral-500">
                      Сообщение удалено
                    </p>
                  ) : (
                    <>
                      {message.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-200">
                          {message.body}
                        </p>
                      ) : null}
                      {message.attachments.map((attachment) => (
                        <AttachmentContent attachment={attachment} key={attachment.id} />
                      ))}
                    </>
                  )}
                  {!message.deletedAt && canDeleteMessage(message, currentUserId, currentRole) ? (
                    <button
                      className="mt-2 inline-flex min-h-10 items-center text-sm text-neutral-500 transition hover:text-red-300"
                      onClick={() => deleteMessage(message.id)}
                      type="button"
                    >
                      Удалить
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form className="sticky bottom-0 border-t border-neutral-800 bg-neutral-900 p-3 sm:p-4" onSubmit={handleSubmit}>
        {memberLocked ? (
          <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Этот чат закрыт для участников.
          </p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid gap-2">
            <input
              ref={fileInputRef}
              className="sr-only"
              disabled={memberLocked || uploading}
              id="chat-attachment-file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf,text/plain,application/zip"
            />
            <label
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white"
              htmlFor="chat-attachment-file"
            >
              Выбрать файл
            </label>
            {selectedFile ? <p className="truncate text-sm text-neutral-400">{selectedFile.name}</p> : null}
          </div>
          <button
            className="min-h-11 shrink-0 rounded-md border border-neutral-700 px-4 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={memberLocked || uploading || !selectedFile}
            onClick={uploadAttachment}
            type="button"
          >
            {uploading ? "Загрузка..." : "Прикрепить"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <textarea
            className="min-h-11 flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-3 text-sm text-neutral-100 outline-none transition focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={memberLocked || pending || uploading}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Написать сообщение"
            rows={1}
            value={body}
          />
          <button
            className="min-h-11 rounded-md bg-emerald-500 px-5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={memberLocked || pending || uploading || body.trim().length === 0}
            type="submit"
          >
            Отправить
          </button>
        </div>
      </form>
    </div>
  );
}
