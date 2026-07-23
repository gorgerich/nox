"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Phone,
  Search,
  UserRound,
  UsersRound,
  SquarePen,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { createStaticSource } from "@astryxdesign/core/Typeahead";

// Global ⌘K / Ctrl+K quick switcher, powered by Astryx's CommandPalette.
// Purely additive: an on-demand overlay, so it doesn't touch the existing
// chrome. Items are static navigation + actions — no data fetching.

type PaletteAux = {
  href: string;
  group: string;
  keywords: string[];
  icon: LucideIcon;
};

type PaletteItem = {
  id: string;
  label: string;
  auxiliaryData: PaletteAux;
};

const ITEMS: PaletteItem[] = [
  { id: "chats", label: "Чаты", auxiliaryData: { href: "/chats", group: "Разделы", keywords: ["chats", "messages", "сообщения", "диалоги"], icon: MessageCircle } },
  { id: "contacts", label: "Контакты", auxiliaryData: { href: "/contacts", group: "Разделы", keywords: ["contacts", "people", "люди", "друзья"], icon: UsersRound } },
  { id: "calls", label: "Звонки", auxiliaryData: { href: "/calls", group: "Разделы", keywords: ["calls", "звонки", "история"], icon: Phone } },
  { id: "profile", label: "Профиль", auxiliaryData: { href: "/profile", group: "Разделы", keywords: ["profile", "settings", "профиль", "настройки"], icon: UserRound } },
  { id: "search", label: "Поиск по чатам", auxiliaryData: { href: "/chats/search", group: "Действия", keywords: ["search", "find", "поиск", "найти"], icon: Search } },
  { id: "new-chat", label: "Новый чат", auxiliaryData: { href: "/chats/new", group: "Действия", keywords: ["new", "compose", "новый", "написать"], icon: SquarePen } },
  { id: "archive", label: "Архив", auxiliaryData: { href: "/chats/archive", group: "Действия", keywords: ["archive", "архив", "скрытые"], icon: Archive } },
];

export function GlobalCommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const source = useMemo(
    () => createStaticSource(ITEMS, { keywords: (item) => item.auxiliaryData.keywords }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleValueChange = useCallback(
    (id: string) => {
      const item = ITEMS.find((entry) => entry.id === id);
      setIsOpen(false);
      if (item) {
        router.push(item.auxiliaryData.href, { scroll: false });
      }
    },
    [router],
  );

  return (
    <CommandPalette<PaletteItem>
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      searchSource={source}
      onValueChange={handleValueChange}
      label="Быстрый переход"
      emptyBootstrapText="Начните вводить: чат, контакт, действие…"
      emptySearchText="Ничего не найдено"
      renderItem={(item, isSelected) => {
        const Icon = item.auxiliaryData.icon;
        return (
          <span className="flex w-full items-center gap-3 py-0.5">
            <Icon
              className={isSelected ? "h-[1.15rem] w-[1.15rem] text-primary" : "h-[1.15rem] w-[1.15rem] text-muted"}
              strokeWidth={2.1}
            />
            <span className="flex-1 truncate text-[15px] font-medium text-foreground">{item.label}</span>
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted/70">
              {item.auxiliaryData.group}
            </span>
          </span>
        );
      }}
    />
  );
}
