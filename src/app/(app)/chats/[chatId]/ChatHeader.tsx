"use client";

import Image from "next/image";
import { ChatThemePortal } from "./ChatThemePortal";
import { Check, ChevronLeft, Clock3, MoreVertical, Palette, Phone, Search, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useClientValue } from "@/lib/use-client-value";
import { useAudioCall } from "../../calls/CallProvider";
import { normalizeAvatarUrl } from "@/lib/media-url";
import { useMenuKeyboard } from "@/lib/use-menu-keyboard";

export function ChatHeader({
  chatId,
  chatType,
  title,
  subtitle,
  avatarUrl,
  isConnected,
  partnerId,
  disappearingSeconds = null,
  onSetDisappearing,
  onSearchClick,
  onAppearanceClick,
  themeVars,
  chatScheme = "light",
}: {
  chatId: string;
  chatType: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onAppearanceClick?: () => void;
  isConnected: boolean;
  currentUser: { displayName: string; avatarUrl: string | null };
  partnerId?: string;
  onSearchClick?: () => void;
  disappearingSeconds?: number | null;
  onSetDisappearing?: (seconds: number | null) => void;
  /** The chat's variables, so the portalled menu keeps the chat's palette. */
  themeVars?: React.CSSProperties;
  chatScheme?: "light" | "dark";
}) {
  const router = useRouter();
  const { startCall, status } = useAudioCall();
  const [timerMenuOpen, setTimerMenuOpen] = useState(false);
  // The dropdown renders via a body portal: nesting a backdrop-filter menu
  // inside the header (itself backdrop-filtered + pseudo-layered glass pills)
  // broke iOS WebView compositing — the header exploded into a giant circle
  // with scattered icons whenever the menu opened. Portaled + anchored to the
  // trigger's rect, the menu lives outside that subtree entirely.
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number }>({ top: 64, right: 12 });
  const menuRef = useMenuKeyboard<HTMLDivElement>(timerMenuOpen, () => setTimerMenuOpen(false), moreButtonRef);

  const anchorToButton = () => {
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      setMenuAnchor({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
    }
  };

  const openMenu = () => {
    anchorToButton();
    setTimerMenuOpen((v) => !v);
  };

  // Re-measure once the menu is open (layout may shift between tap and paint,
  // e.g. sticky header settling on iOS) so the anchor is always correct.
  useEffect(() => {
    if (timerMenuOpen) anchorToButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerMenuOpen]);
  const DISAPPEARING_OPTIONS: { label: string; seconds: number | null }[] = [
    { label: "Выключить", seconds: null },
    { label: "1 час", seconds: 3600 },
    { label: "1 день", seconds: 86400 },
    { label: "1 неделя", seconds: 604800 },
  ];
  // Capability detection is client-only: the server has no `navigator`, so it
  // rendered no call buttons while the client rendered them, and the markups
  // disagreed. The hydration render uses the server's answer on both sides and
  // the real capability is applied in the re-render right after.
  const canUseMedia = useClientValue(() => typeof navigator !== "undefined" && !!navigator.mediaDevices, false);
  const canCall = chatType === "DIRECT" && canUseMedia;
  const handleBackToChats = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/chats");
  };

  const isGroup = chatType === "GROUP";

  const handleHeaderClick = () => {
    if (isGroup) {
      router.push(`/chats/${chatId}/group-profile`);
    } else if (chatType === "DIRECT" && partnerId) {
      router.push(`/chats/${chatId}/profile`);
    }
  };

  useEffect(() => {
    router.prefetch("/chats");
    if (chatType === "DIRECT" && partnerId) {
      router.prefetch(`/chats/${chatId}/profile`);
    }
    if (isGroup) {
      router.prefetch(`/chats/${chatId}/group-profile`);
    }
  }, [chatId, chatType, isGroup, partnerId, router]);

  const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);

  const displaySubtitle = isGroup ? subtitle : (subtitle || "Был(а) давно");

  return (
    <header
      className="nox-chat-topbar sticky top-0 z-50 flex items-center px-1 transition-smooth"
      style={{
        color: "var(--chat-header-fg)",
        minHeight: "calc(3.25rem + env(safe-area-inset-top, 0px))",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <button
        type="button"
        aria-label="Назад к чатам"
        onClick={handleBackToChats}
        className="fast-tap -ml-0.5 flex h-11 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-[17px] text-primary transition-smooth"
      >
        <ChevronLeft className="h-[26px] w-[26px]" strokeWidth={2.2} />
        Чаты
      </button>

      {/* Centred against the header, not against the row: the back label and
          the trailing controls have different widths, so a flex-centred title
          would sit off-centre and shift as the subtitle changes. */}
      <button
        type="button"
        aria-label="Открыть профиль чата"
        className="pointer-events-auto absolute inset-x-0 mx-auto flex max-w-[52%] flex-col items-center justify-center"
        style={{ top: "env(safe-area-inset-top, 0px)", height: "3.25rem" }}
        onClick={handleHeaderClick}
      >
        <span className="max-w-full truncate text-[17px] font-semibold leading-tight text-[var(--chat-header-fg)]">{title}</span>
        <span
          className="max-w-full truncate text-[13px] leading-tight"
          style={{ color: !isGroup && displaySubtitle === "в сети" ? "var(--message-read)" : "var(--bubble-incoming-muted)" }}
        >
          {displaySubtitle}
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">

        {canCall && (
          <>
            <button
              type="button"
              aria-label="Аудиозвонок"
              onClick={() => startCall(chatId, { displayName: title, avatarUrl: avatarUrl ?? null })}
              disabled={status !== "idle"}
              className="fast-tap flex h-10 w-10 items-center justify-center rounded-full text-primary transition-smooth disabled:opacity-30 disabled:grayscale"
              title="Аудиозвонок"
            >
              <Phone className="h-[22px] w-[22px]" strokeWidth={2.1} fill="currentColor" stroke="none" />
            </button>
          </>
        )}
        {(onSetDisappearing || onSearchClick || onAppearanceClick) && (
          <div className="relative">
            <button
              ref={moreButtonRef}
              type="button"
              aria-label="Ещё"
              aria-haspopup="menu"
              aria-expanded={timerMenuOpen}
              onClick={openMenu}
              className="fast-tap flex h-10 w-9 items-center justify-center rounded-full text-primary transition-smooth"
              title="Ещё"
            >
              <MoreVertical className="h-5 w-5" strokeWidth={2.2} />
            </button>
            {timerMenuOpen && (
              <ChatThemePortal themeVars={themeVars ?? {}} scheme={chatScheme}>
                <div className="fixed inset-0 z-[200]" aria-hidden="true" onClick={() => setTimerMenuOpen(false)} />
                <div
                  ref={menuRef}
                  className="nox-chat-menu fixed z-[201] w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl origin-top-right animate-in fade-in zoom-in-95 duration-150"
                  style={{ top: menuAnchor.top, right: menuAnchor.right }}
                  role="menu"
                  aria-label="Действия чата"
                >
                  {onSearchClick && (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { onSearchClick(); setTimerMenuOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground transition-smooth hover:bg-foreground/5"
                    >
                      <Search className="h-4 w-4 text-muted" strokeWidth={2.2} />
                      Поиск по чату
                    </button>
                  )}
                  {onAppearanceClick && (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => { onAppearanceClick(); setTimerMenuOpen(false); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground transition-smooth hover:bg-foreground/5"
                    >
                      <Palette className="h-4 w-4 text-muted" strokeWidth={2.1} />
                      Оформление чата
                    </button>
                  )}
                  {onSetDisappearing && (onSearchClick || onAppearanceClick) && <div className="mx-4 h-px bg-border-subtle" />}
                  {onSetDisappearing && (
                  <>
                  <div role="group" aria-labelledby="chat-menu-disappearing">
                  <p id="chat-menu-disappearing" className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-medium text-muted">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    Исчезающие сообщения
                  </p>
                  {DISAPPEARING_OPTIONS.map((opt) => {
                    const active = (disappearingSeconds ?? null) === opt.seconds;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        role="menuitemradio"
                        tabIndex={-1}
                        aria-checked={active}
                        onClick={() => { onSetDisappearing(opt.seconds); setTimerMenuOpen(false); }}
                        className={`flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-smooth hover:bg-foreground/5 ${active ? "text-primary" : "text-foreground"}`}
                      >
                        {opt.label}
                        {active ? <Check className="h-4 w-4 text-primary" strokeWidth={2.4} /> : null}
                      </button>
                    );
                  })}
                  </div>
                  </>
                  )}
                </div>
              </ChatThemePortal>
            )}
          </div>
        )}

        {/* The partner's avatar, on the trailing edge and opening the same
            profile the title does. */}
        <button
          type="button"
          aria-label="Открыть профиль чата"
          onClick={handleHeaderClick}
          className="fast-tap ml-0.5 mr-1 shrink-0 transition-smooth"
        >
          {fullAvatarUrl ? (
            <span className="relative block h-[34px] w-[34px] overflow-hidden rounded-full bg-surface-muted">
              <Image src={fullAvatarUrl} alt={title} fill sizes="34px" className="object-cover" />
            </span>
          ) : (
            <span
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full text-[15px] font-semibold"
              style={{ backgroundColor: "var(--bubble-outgoing-bg)", color: "var(--bubble-outgoing-fg)" }}
            >
              {title.substring(0, 1).toUpperCase()}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
