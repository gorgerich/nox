"use client";

import { useState } from "react";

export type AppearanceSettings = {
  preset: "system" | "midnight" | "graphite" | "ocean" | "ice" | "emerald" | "milk";
  bubbleRadius: "soft" | "round";
  outgoingColor: string;
  incomingStyle: "filled" | "glass" | "minimal";
  background: string;
  density: "compact" | "comfortable";
};

export type ChatPresetKey = AppearanceSettings["preset"];

export type ChatPresetTokens = {
  isDark: boolean;
  bg: string;
  surface: string;
  headerBg: string;
  headerFg: string;
  composerBg: string;
  inputBg: string;
  inputFg: string;
  inputPlaceholder: string;
  incomingBg: string;
  incomingFg: string;
  incomingMuted: string;
  incomingBorder: string;
  dateBg: string;
  dateFg: string;
  menuBg: string;
  menuFg: string;
  menuMuted: string;
};

export type OutgoingBubbleTokens = {
  bg: string;
  fg: string;
  muted: string;
  tick: string;
  read: string;
};

export const CHAT_PRESET_TOKENS: Record<ChatPresetKey, ChatPresetTokens> = {
  system: {
    isDark: false,
    bg: "var(--background)",
    surface: "var(--surface)",
    headerBg: "var(--chat-header)",
    headerFg: "var(--foreground)",
    composerBg: "var(--chat-composer)",
    inputBg: "var(--chat-input-bg)",
    inputFg: "var(--foreground)",
    inputPlaceholder: "var(--placeholder)",
    incomingBg: "var(--bubble-incoming)",
    incomingFg: "var(--bubble-incoming-text)",
    incomingMuted: "var(--muted)",
    incomingBorder: "var(--border-subtle)",
    dateBg: "var(--surface-muted)",
    dateFg: "var(--muted)",
    menuBg: "var(--surface-elevated)",
    menuFg: "var(--foreground)",
    menuMuted: "var(--muted)",
  },
  midnight: {
    isDark: true,
    bg: "#05070A",
    surface: "#0B0F14",
    headerBg: "rgba(5, 7, 10, 0.88)",
    headerFg: "#F8FAFC",
    composerBg: "rgba(11, 15, 20, 0.96)",
    inputBg: "#111827",
    inputFg: "#F8FAFC",
    inputPlaceholder: "#94A3B8",
    incomingBg: "#151B23",
    incomingFg: "#F8FAFC",
    incomingMuted: "#A8B3C4",
    incomingBorder: "rgba(255,255,255,0.10)",
    dateBg: "rgba(255,255,255,0.08)",
    dateFg: "#CBD5E1",
    menuBg: "#10151D",
    menuFg: "#F8FAFC",
    menuMuted: "#94A3B8",
  },
  graphite: {
    isDark: true,
    bg: "#0D0D0F",
    surface: "#171719",
    headerBg: "rgba(13, 13, 15, 0.88)",
    headerFg: "#FAFAFA",
    composerBg: "rgba(18, 18, 20, 0.96)",
    inputBg: "#1F1F23",
    inputFg: "#FAFAFA",
    inputPlaceholder: "#A1A1AA",
    incomingBg: "#242428",
    incomingFg: "#FAFAFA",
    incomingMuted: "#B4B4BE",
    incomingBorder: "rgba(255,255,255,0.10)",
    dateBg: "rgba(255,255,255,0.08)",
    dateFg: "#D4D4D8",
    menuBg: "#1A1A1E",
    menuFg: "#FAFAFA",
    menuMuted: "#A1A1AA",
  },
  ocean: {
    isDark: true,
    bg: "#06111F",
    surface: "#0B1B2E",
    headerBg: "rgba(6, 17, 31, 0.90)",
    headerFg: "#F0F9FF",
    composerBg: "rgba(8, 24, 42, 0.96)",
    inputBg: "#102A44",
    inputFg: "#F0F9FF",
    inputPlaceholder: "#93C5FD",
    incomingBg: "#12304F",
    incomingFg: "#F8FBFF",
    incomingMuted: "#B7D4F4",
    incomingBorder: "rgba(147,197,253,0.16)",
    dateBg: "rgba(147,197,253,0.12)",
    dateFg: "#BFDBFE",
    menuBg: "#0D2238",
    menuFg: "#F0F9FF",
    menuMuted: "#93C5FD",
  },
  emerald: {
    isDark: true,
    bg: "#04130F",
    surface: "#08211A",
    headerBg: "rgba(4, 19, 15, 0.90)",
    headerFg: "#ECFDF5",
    composerBg: "rgba(6, 26, 21, 0.96)",
    inputBg: "#0E2D25",
    inputFg: "#ECFDF5",
    inputPlaceholder: "#8EDBC1",
    incomingBg: "#12382E",
    incomingFg: "#F0FDF7",
    incomingMuted: "#A7E3CF",
    incomingBorder: "rgba(52,211,153,0.16)",
    dateBg: "rgba(52,211,153,0.12)",
    dateFg: "#A7F3D0",
    menuBg: "#0A271F",
    menuFg: "#ECFDF5",
    menuMuted: "#8EDBC1",
  },
  ice: {
    isDark: false,
    bg: "#F6F9FC",
    surface: "#FFFFFF",
    headerBg: "rgba(246, 249, 252, 0.90)",
    headerFg: "#0F172A",
    composerBg: "rgba(246, 249, 252, 0.96)",
    inputBg: "#FFFFFF",
    inputFg: "#0F172A",
    inputPlaceholder: "#94A3B8",
    incomingBg: "#FFFFFF",
    incomingFg: "#0F172A",
    incomingMuted: "#64748B",
    incomingBorder: "rgba(15, 23, 42, 0.08)",
    dateBg: "rgba(15, 23, 42, 0.06)",
    dateFg: "#64748B",
    menuBg: "#FFFFFF",
    menuFg: "#0F172A",
    menuMuted: "#64748B",
  },
  milk: {
    isDark: false,
    bg: "#FAF8F3",
    surface: "#FFFFFF",
    headerBg: "rgba(250, 248, 243, 0.90)",
    headerFg: "#171717",
    composerBg: "rgba(250, 248, 243, 0.96)",
    inputBg: "#FFFFFF",
    inputFg: "#171717",
    inputPlaceholder: "#8A8A8A",
    incomingBg: "#FFFFFF",
    incomingFg: "#171717",
    incomingMuted: "#737373",
    incomingBorder: "rgba(23, 23, 23, 0.08)",
    dateBg: "rgba(23, 23, 23, 0.06)",
    dateFg: "#737373",
    menuBg: "#FFFFFF",
    menuFg: "#171717",
    menuMuted: "#737373",
  },
};

export const OUTGOING_BUBBLE_TOKENS: Record<string, OutgoingBubbleTokens> = {
  blue: {
    bg: "#3B82F6",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#34D399",
  },
  emerald: {
    bg: "#10B981",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#D1FAE5",
  },
  violet: {
    bg: "#8B5CF6",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#DDD6FE",
  },
  rose: {
    bg: "#F43F5E",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#FFE4E6",
  },
  graphite: {
    bg: "#3F3F46",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#E5E7EB",
  },
  cyan: {
    bg: "#0EA5E9",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.76)",
    tick: "rgba(255,255,255,0.84)",
    read: "#BAE6FD",
  },
  orange: {
    bg: "#F97316",
    fg: "#FFFFFF",
    muted: "rgba(255,255,255,0.78)",
    tick: "rgba(255,255,255,0.86)",
    read: "#FFEDD5",
  },
};

const OUTGOING_COLOR_ALIAS: Record<string, string> = {
  "#10b981": "emerald",
  "#3b82f6": "blue",
  "#8b5cf6": "violet",
  "#f43f5e": "rose",
  "#0ea5e9": "cyan",
  "#2c2e33": "graphite",
  "#3f3f46": "graphite",
  "#f97316": "orange",
  blue: "blue",
  emerald: "emerald",
  violet: "violet",
  rose: "rose",
  graphite: "graphite",
  cyan: "cyan",
  orange: "orange",
};

export const PRESETS = {
  system: { id: "system", name: "System", isDark: false },
  midnight: { id: "midnight", name: "Midnight", isDark: true },
  graphite: { id: "graphite", name: "Graphite", isDark: true },
  ocean: { id: "ocean", name: "Ocean", isDark: true },
  ice: { id: "ice", name: "Ice", isDark: false },
  emerald: { id: "emerald", name: "Emerald", isDark: true },
  milk: { id: "milk", name: "Milk", isDark: false },
} as const;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: "system",
  bubbleRadius: "round",
  outgoingColor: "#3f3f46",
  incomingStyle: "filled",
  background: "midnight",
  density: "comfortable",
};

function resolveOutgoingToken(color: string) {
  const key = OUTGOING_COLOR_ALIAS[color.toLowerCase()] ?? "graphite";
  return OUTGOING_BUBBLE_TOKENS[key] ?? OUTGOING_BUBBLE_TOKENS.graphite;
}

export function getChatAppearanceVars(settings: AppearanceSettings): Record<string, string> {
  const preset = CHAT_PRESET_TOKENS[settings.preset] ?? CHAT_PRESET_TOKENS.midnight;
  const outgoing = resolveOutgoingToken(settings.outgoingColor);

  let incomingBg = preset.incomingBg;
  if (settings.incomingStyle === "glass") {
    incomingBg = preset.isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.03)";
  }
  if (settings.incomingStyle === "minimal") {
    incomingBg = "transparent";
  }

  return {
    "--chat-bg": preset.bg,
    "--chat-surface": preset.surface,
    "--chat-header-bg": preset.headerBg,
    "--chat-header-fg": preset.headerFg,
    "--chat-composer-bg": preset.composerBg,
    "--chat-composer-border": preset.incomingBorder,
    "--chat-input-bg": preset.inputBg,
    "--chat-input-fg": preset.inputFg,
    "--chat-input-placeholder": preset.inputPlaceholder,
    "--bubble-incoming-bg": incomingBg,
    "--bubble-incoming-fg": preset.incomingFg,
    "--bubble-incoming-muted": preset.incomingMuted,
    "--bubble-incoming-border": preset.incomingBorder,
    "--bubble-outgoing-bg": outgoing.bg,
    "--bubble-outgoing-fg": outgoing.fg,
    "--bubble-outgoing-muted": outgoing.muted,
    "--message-tick": outgoing.tick,
    "--message-read": outgoing.read,
    "--chat-date-bg": preset.dateBg,
    "--chat-date-fg": preset.dateFg,
    "--message-menu-bg": preset.menuBg,
    "--message-menu-fg": preset.menuFg,
    "--message-menu-muted": preset.menuMuted,
    "--chat-menu-border": preset.incomingBorder,
    "--chat-focus-ring": preset.isDark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.18)",
    // Backward-compatible aliases used by some existing utility classes.
    "--chat-muted": preset.incomingMuted,
    "--chat-fg": preset.headerFg,
    "--chat-header": preset.headerBg,
    "--chat-composer": preset.composerBg,
    "--chat-background": preset.bg,
  };
}

export function useChatAppearance(chatId: string) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_APPEARANCE;
    }

    const saved =
      localStorage.getItem(`nox:chat-appearance:${chatId}:v2`) ??
      localStorage.getItem("nox:chat-appearance:global:v2");

    if (!saved) {
      return DEFAULT_APPEARANCE;
    }

    try {
      const parsed = JSON.parse(saved);
      const isOldGreenDefault =
        parsed.preset === "midnight" &&
        parsed.outgoingColor === "#10b981" &&
        (parsed.background === "midnight" || !parsed.background) &&
        (parsed.incomingStyle === "filled" || parsed.incomingStyle === "solid" || !parsed.incomingStyle);
      if (isOldGreenDefault) {
        return DEFAULT_APPEARANCE;
      }
      return {
        ...DEFAULT_APPEARANCE,
        ...parsed,
        incomingStyle:
          parsed.incomingStyle === "solid"
            ? "filled"
            : parsed.incomingStyle ?? DEFAULT_APPEARANCE.incomingStyle,
      };
    } catch {
      return DEFAULT_APPEARANCE;
    }
  });

  const updateSettings = (newSettings: Partial<AppearanceSettings>, isGlobal = false) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem(`nox:chat-appearance:${chatId}:v2`, JSON.stringify(updated));
      if (isGlobal) {
        localStorage.setItem("nox:chat-appearance:global:v2", JSON.stringify(updated));
      }
      return updated;
    });
  };

  const resetSettings = () => {
    setSettings(DEFAULT_APPEARANCE);
    localStorage.removeItem(`nox:chat-appearance:${chatId}:v2`);
  };

  return { settings, updateSettings, resetSettings };
}

export function ChatAppearanceSheet({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onReset,
}: {
  isOpen: boolean;
  onClose: () => void;
  settings: AppearanceSettings;
  onUpdate: (s: Partial<AppearanceSettings>) => void;
  onReset: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-smooth animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-[2.5rem] bg-surface p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 ease-out safe-bottom border-t border-border-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-8 h-1.5 w-12 rounded-full bg-border-subtle active:bg-muted transition-smooth" onClick={onClose} />

        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-2xl font-black tracking-tight text-foreground">Оформление</h2>
          <button onClick={onReset} className="touch-target text-xs font-black uppercase tracking-widest text-primary hover:opacity-80 transition-smooth active:scale-90">
            Сброс
          </button>
        </div>

        <div className="max-h-[60vh] space-y-10 overflow-y-auto pb-8 pr-2 scrollbar-hide overscroll-contain">
          <section>
            <h3 className="mb-5 ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Пресеты</h3>
            <div className="grid grid-cols-3 gap-4">
              {(Object.keys(PRESETS) as ChatPresetKey[]).map((id) => {
                const preset = CHAT_PRESET_TOKENS[id];
                return (
                  <button
                    key={id}
                    onClick={() => onUpdate({ preset: id, background: id })}
                    className={`relative group flex flex-col items-center gap-3 rounded-3xl border-2 p-1.5 transition-smooth active:scale-95 ${
                      settings.preset === id ? "border-primary bg-primary/5" : "border-border-subtle hover:border-muted"
                    }`}
                  >
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-black/5 shadow-inner" style={{ backgroundColor: preset.bg }}>
                      <div className="absolute left-2 top-2 h-3 w-2/3 rounded-full" style={{ backgroundColor: preset.headerBg }} />
                      <div className="absolute right-2 top-7 h-3 w-2/3 rounded-full bg-primary/40" />
                      <div className="absolute left-2 top-12 h-3 w-1/2 rounded-full" style={{ backgroundColor: preset.incomingBg }} />
                    </div>
                    <span className="mb-1 text-[10px] font-black uppercase tracking-tighter text-foreground/80">{PRESETS[id].name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-5 ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Цвет сообщений</h3>
            <div className="flex flex-wrap gap-4 px-1">
              {["#3f3f46", "#3b82f6", "#8b5cf6", "#0ea5e9", "#10b981", "#f97316"].map((color) => (
                <button
                  key={color}
                  onClick={() => onUpdate({ outgoingColor: color })}
                  className={`h-11 w-11 rounded-full border-2 transition-smooth active:scale-75 ${
                    settings.outgoingColor.toLowerCase() === color ? "border-foreground scale-110 shadow-lg" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-5 ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Стиль входящих</h3>
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "filled", label: "Заливка" },
                { id: "glass", label: "Стекло" },
                { id: "minimal", label: "Минимал" },
              ] as const).map((style) => (
                <button
                  key={style.id}
                  onClick={() => onUpdate({ incomingStyle: style.id })}
                  className={`touch-target h-12 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${
                    settings.incomingStyle === style.id ? "border-primary bg-primary/5 text-primary" : "border-border-subtle text-muted"
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-5 ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Радиус углов</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "soft", label: "Мягкий" },
                { id: "round", label: "Круглый" },
              ] as const).map((r) => (
                <button
                  key={r.id}
                  onClick={() => onUpdate({ bubbleRadius: r.id })}
                  className={`touch-target h-12 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${
                    settings.bubbleRadius === r.id ? "border-primary bg-primary/5 text-primary" : "border-border-subtle text-muted"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <button onClick={onClose} className="btn-nox mt-6 h-14 w-full rounded-3xl bg-foreground text-sm font-black uppercase tracking-widest text-background transition-smooth active:scale-[0.98] shadow-xl">
          Готово
        </button>
      </div>
    </div>
  );
}
