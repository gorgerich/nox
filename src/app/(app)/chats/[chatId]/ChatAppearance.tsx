"use client";

import { useState } from "react";

export type AppearanceSettings = {
  preset: "midnight" | "graphite" | "ocean" | "ice" | "emerald" | "milk";
  bubbleRadius: "soft" | "round";
  outgoingColor: string;
  incomingStyle: "filled" | "glass" | "minimal";
  background: string;
  density: "compact" | "comfortable";
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: "midnight",
  bubbleRadius: "round",
  outgoingColor: "#10b981",
  incomingStyle: "glass",
  background: "midnight",
  density: "comfortable",
};

export type ChatThemeDefinition = {
  id: string;
  name: string;
  isDark: boolean;
  bg: string;
  bubble: string;
  vars: Record<string, string>;
};

export const PRESETS: Record<string, ChatThemeDefinition> = {
  midnight: {
    id: "midnight",
    name: "Midnight",
    isDark: true,
    bg: "bg-black",
    bubble: "bg-neutral-900",
    vars: {
      "--chat-bg": "#000000",
      "--chat-fg": "#ffffff",
      "--chat-muted": "rgba(255,255,255,0.5)",
      "--chat-header-bg": "rgba(0,0,0,0.7)",
      "--chat-header-fg": "#ffffff",
      "--chat-composer-bg": "rgba(0,0,0,0.7)",
      "--chat-composer-fg": "#ffffff",
      "--chat-input-bg": "#171717",
      "--chat-input-placeholder": "rgba(255,255,255,0.3)",
      "--bubble-incoming": "#1a1b1e",
      "--bubble-incoming-text": "#f8f9fa",
      "--bubble-incoming-border": "rgba(255,255,255,0.05)",
      "--message-menu-bg": "#1a1b1e",
      "--message-menu-fg": "#ffffff",
      "--message-menu-border": "rgba(255,255,255,0.1)",
    }
  },
  graphite: {
    id: "graphite",
    name: "Graphite",
    isDark: true,
    bg: "bg-[#1a1b1e]",
    bubble: "bg-[#2c2e33]",
    vars: {
      "--chat-bg": "#1a1b1e",
      "--chat-fg": "#f8f9fa",
      "--chat-muted": "#909296",
      "--chat-header-bg": "rgba(26,27,30,0.7)",
      "--chat-header-fg": "#f8f9fa",
      "--chat-composer-bg": "rgba(26,27,30,0.7)",
      "--chat-composer-fg": "#f8f9fa",
      "--chat-input-bg": "#25262b",
      "--chat-input-placeholder": "#5c5f66",
      "--bubble-incoming": "#2c2e33",
      "--bubble-incoming-text": "#f8f9fa",
      "--bubble-incoming-border": "rgba(255,255,255,0.05)",
      "--message-menu-bg": "#25262b",
      "--message-menu-fg": "#f8f9fa",
      "--message-menu-border": "#373a40",
    }
  },
  ocean: {
    id: "ocean",
    name: "Ocean",
    isDark: true,
    bg: "bg-[#0f172a]",
    bubble: "bg-[#1e293b]/50",
    vars: {
      "--chat-bg": "#0f172a",
      "--chat-fg": "#f8fafc",
      "--chat-muted": "#94a3b8",
      "--chat-header-bg": "rgba(15,23,42,0.8)",
      "--chat-header-fg": "#f8fafc",
      "--chat-composer-bg": "rgba(15,23,42,0.8)",
      "--chat-composer-fg": "#f8fafc",
      "--chat-input-bg": "#1e293b",
      "--chat-input-placeholder": "#475569",
      "--bubble-incoming": "rgba(30,41,59,0.5)",
      "--bubble-incoming-text": "#f8fafc",
      "--bubble-incoming-border": "rgba(255,255,255,0.1)",
      "--message-menu-bg": "#1e293b",
      "--message-menu-fg": "#f8fafc",
      "--message-menu-border": "rgba(255,255,255,0.1)",
    }
  },
  ice: {
    id: "ice",
    name: "Ice",
    isDark: false,
    bg: "bg-[#f1f3f5]",
    bubble: "bg-white",
    vars: {
      "--chat-bg": "#f1f3f5",
      "--chat-fg": "#1a1c1e",
      "--chat-muted": "#6c757d",
      "--chat-header-bg": "rgba(241,243,245,0.8)",
      "--chat-header-fg": "#1a1c1e",
      "--chat-composer-bg": "rgba(241,243,245,0.8)",
      "--chat-composer-fg": "#1a1c1e",
      "--chat-input-bg": "#ffffff",
      "--chat-input-placeholder": "#adb5bd",
      "--bubble-incoming": "#ffffff",
      "--bubble-incoming-text": "#1a1c1e",
      "--bubble-incoming-border": "rgba(0,0,0,0.05)",
      "--message-menu-bg": "#ffffff",
      "--message-menu-fg": "#1a1c1e",
      "--message-menu-border": "#dee2e6",
    }
  },
  emerald: {
    id: "emerald",
    name: "Emerald",
    isDark: true,
    bg: "bg-[#064e3b]",
    bubble: "bg-[#065f46]/50",
    vars: {
      "--chat-bg": "#064e3b",
      "--chat-fg": "#ecfdf5",
      "--chat-muted": "#34d399",
      "--chat-header-bg": "rgba(6,78,59,0.8)",
      "--chat-header-fg": "#ecfdf5",
      "--chat-composer-bg": "rgba(6,78,59,0.8)",
      "--chat-composer-fg": "#ecfdf5",
      "--chat-input-bg": "#065f46",
      "--chat-input-placeholder": "rgba(255,255,255,0.3)",
      "--bubble-incoming": "rgba(6,95,70,0.5)",
      "--bubble-incoming-text": "#ecfdf5",
      "--bubble-incoming-border": "rgba(255,255,255,0.1)",
      "--message-menu-bg": "#065f46",
      "--message-menu-fg": "#ecfdf5",
      "--message-menu-border": "rgba(255,255,255,0.1)",
    }
  },
  milk: {
    id: "milk",
    name: "Milk",
    isDark: false,
    bg: "bg-[#fdfdfd]",
    bubble: "bg-[#f1f3f5]",
    vars: {
      "--chat-bg": "#fdfdfd",
      "--chat-fg": "#1a1c1e",
      "--chat-muted": "#adb5bd",
      "--chat-header-bg": "rgba(253,253,253,0.8)",
      "--chat-header-fg": "#1a1c1e",
      "--chat-composer-bg": "rgba(253,253,253,0.8)",
      "--chat-composer-fg": "#1a1c1e",
      "--chat-input-bg": "#f1f3f5",
      "--chat-input-placeholder": "#adb5bd",
      "--bubble-incoming": "#f1f3f5",
      "--bubble-incoming-text": "#1a1c1e",
      "--bubble-incoming-border": "rgba(0,0,0,0.05)",
      "--message-menu-bg": "#ffffff",
      "--message-menu-fg": "#1a1c1e",
      "--message-menu-border": "#f1f3f5",
    }
  },
};

export function useChatAppearance(chatId: string) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_APPEARANCE;
    const saved = localStorage.getItem(`nox:chat-appearance:${chatId}:v2`) || 
                  localStorage.getItem(`nox:chat-appearance:global:v2`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_APPEARANCE,
          ...parsed,
          incomingStyle: parsed.incomingStyle === "solid" ? "filled" : (parsed.incomingStyle || DEFAULT_APPEARANCE.incomingStyle)
        };
      } catch (e) {
        console.error("Failed to parse appearance settings", e);
      }
    }
    return DEFAULT_APPEARANCE;
  });

  const updateSettings = (newSettings: Partial<AppearanceSettings>, isGlobal = false) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem(`nox:chat-appearance:${chatId}:v2`, JSON.stringify(updated));
      if (isGlobal) {
        localStorage.setItem(`nox:chat-appearance:global:v2`, JSON.stringify(updated));
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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-smooth animate-in fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-lg rounded-t-[2.5rem] bg-surface p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-300 ease-out safe-bottom border-t border-border-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-8 h-1.5 w-12 rounded-full bg-border-subtle active:bg-muted transition-smooth" onClick={onClose} />
        
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black tracking-tight text-foreground">Оформление</h2>
          <button onClick={onReset} className="touch-target text-xs font-black uppercase tracking-widest text-primary hover:opacity-80 transition-smooth active:scale-90">
            Сброс
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-10 pb-8 pr-2 scrollbar-hide overscroll-contain">
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 mb-5 ml-1">Пресеты</h3>
            <div className="grid grid-cols-3 gap-4">
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => (
                <button
                  key={id}
                  onClick={() => onUpdate({ preset: id as AppearanceSettings["preset"], background: id })}
                  className={`relative group flex flex-col items-center gap-3 rounded-3xl border-2 p-1.5 transition-smooth active:scale-95 ${
                    settings.preset === id ? "border-primary bg-primary/5" : "border-border-subtle hover:border-muted"
                  }`}
                >
                  <div className={`aspect-[4/5] w-full rounded-2xl ${PRESETS[id].bg} relative overflow-hidden shadow-inner border border-black/5`}>
                    <div className={`absolute top-2 left-2 w-2/3 h-3 rounded-full ${PRESETS[id].isDark ? 'bg-white/10' : 'bg-black/10'}`} />
                    <div className="absolute top-7 right-2 w-2/3 h-3 rounded-full bg-primary/40" />
                    <div className={`absolute top-12 left-2 w-1/2 h-3 rounded-full ${PRESETS[id].isDark ? 'bg-white/10' : 'bg-black/10'}`} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-tighter text-foreground/80 mb-1">{PRESETS[id].name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 mb-5 ml-1">Цвет сообщений</h3>
            <div className="flex flex-wrap gap-4 px-1">
              {["#10b981", "#3b82f6", "#8b5cf6", "#f43f5e", "#2c2e33", "#f97316"].map((color) => (
                <button
                  key={color}
                  onClick={() => onUpdate({ outgoingColor: color })}
                  className={`h-11 w-11 rounded-full border-2 transition-smooth active:scale-75 ${
                    settings.outgoingColor === color ? "border-foreground scale-110 shadow-lg" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 mb-5 ml-1">Стиль входящих</h3>
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "filled", label: "Заливка" },
                { id: "glass", label: "Стекло" },
                { id: "minimal", label: "Минимал" }
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
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 mb-5 ml-1">Радиус углов</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "soft", label: "Мягкий" },
                { id: "round", label: "Круглый" }
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

        <button 
          onClick={onClose}
          className="btn-nox mt-6 w-full bg-foreground h-14 rounded-3xl text-sm font-black text-background transition-smooth active:scale-[0.98] shadow-xl uppercase tracking-widest"
        >
          Готово
        </button>
      </div>
    </div>
  );
}
