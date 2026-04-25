"use client";

import { useState } from "react";

export type AppearanceSettings = {
  preset: "midnight" | "graphite" | "ocean" | "ice" | "emerald" | "milk";
  bubbleRadius: "soft" | "round";
  outgoingColor: string;
  incomingStyle: "solid" | "glass" | "minimal";
  background: string;
  density: "compact" | "comfortable";
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: "midnight",
  bubbleRadius: "soft",
  outgoingColor: "#10b981", // default emerald
  incomingStyle: "solid",
  background: "midnight",
  density: "comfortable",
};

export const PRESETS = {
  midnight: {
    name: "Midnight",
    bg: "chat-bg-midnight",
    bubble: "bg-neutral-900",
    text: "text-white",
  },
  graphite: {
    name: "Graphite",
    bg: "chat-bg-graphite",
    bubble: "bg-neutral-800",
    text: "text-white",
  },
  ocean: {
    name: "Ocean",
    bg: "chat-bg-ocean",
    bubble: "bg-blue-900/50",
    text: "text-blue-50",
  },
  ice: {
    name: "Ice",
    bg: "chat-bg-ice",
    bubble: "bg-slate-800/50",
    text: "text-slate-50",
  },
  emerald: {
    name: "Emerald",
    bg: "chat-bg-emerald",
    bubble: "bg-emerald-900/50",
    text: "text-emerald-50",
  },
  milk: {
    name: "Milk",
    bg: "chat-bg-milk",
    bubble: "bg-white",
    text: "text-neutral-900",
  },
};

export function useChatAppearance(chatId: string) {
  // Use a initializer function for state to avoid useEffect setState
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_APPEARANCE;
    const saved = localStorage.getItem(`nox:chat-appearance:${chatId}:v1`) || 
                  localStorage.getItem(`nox:chat-appearance:global:v1`);
    if (saved) {
      try {
        return { ...DEFAULT_APPEARANCE, ...JSON.parse(saved) };
      } catch (e) {
        console.error("Failed to parse appearance settings", e);
      }
    }
    return DEFAULT_APPEARANCE;
  });

  const updateSettings = (newSettings: Partial<AppearanceSettings>, isGlobal = false) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem(`nox:chat-appearance:${chatId}:v1`, JSON.stringify(updated));
      if (isGlobal) {
        localStorage.setItem(`nox:chat-appearance:global:v1`, JSON.stringify(updated));
      }
      return updated;
    });
  };

  const resetSettings = () => {
    setSettings(DEFAULT_APPEARANCE);
    localStorage.removeItem(`nox:chat-appearance:${chatId}:v1`);
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
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-smooth animate-in fade-in duration-300" onClick={onClose}>
      <div 
        className="w-full max-w-lg rounded-t-[2.5rem] bg-neutral-950 p-8 shadow-2xl animate-in slide-in-from-bottom-full duration-400 ease-out safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-8 h-1.5 w-12 rounded-full bg-neutral-800 active:bg-neutral-700 transition-smooth" onClick={onClose} />
        
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black tracking-tight">Оформление</h2>
          <button onClick={onReset} className="touch-target text-xs font-black uppercase tracking-widest text-primary hover:opacity-80 transition-smooth active:scale-90">
            Сброс
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-10 pb-8 pr-2 scrollbar-hide overscroll-contain">
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-4 ml-1">Пресеты</h3>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => (
                <button
                  key={id}
                  onClick={() => onUpdate({ preset: id, background: id })}
                  className={`relative flex flex-col items-center gap-3 rounded-2xl border-2 p-3 transition-smooth active:scale-95 ${
                    settings.preset === id ? "border-primary bg-primary/5" : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <div className={`h-10 w-full rounded-xl ${PRESETS[id].bg} border border-white/10 shadow-sm`} />
                  <span className="text-[10px] font-black uppercase tracking-tighter">{PRESETS[id].name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-4 ml-1">Цвет ваших сообщений</h3>
            <div className="flex flex-wrap gap-4 px-1">
              {["#10b981", "#3b82f6", "#8b5cf6", "#f43f5e", "#737373", "#f97316"].map((color) => (
                <button
                  key={color}
                  onClick={() => onUpdate({ outgoingColor: color })}
                  className={`h-11 w-11 rounded-full border-2 transition-smooth active:scale-75 ${
                    settings.outgoingColor === color ? "border-white scale-110 shadow-lg shadow-white/10" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-4 ml-1">Стиль входящих</h3>
            <div className="grid grid-cols-3 gap-3">
              {(["solid", "glass", "minimal"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => onUpdate({ incomingStyle: style })}
                  className={`touch-target h-12 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${
                    settings.incomingStyle === style ? "border-primary bg-primary/5 text-primary" : "border-neutral-800 text-muted"
                  }`}
                >
                  {style === "solid" ? "Заливка" : style === "glass" ? "Стекло" : "Минимал"}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-4 ml-1">Радиус углов</h3>
            <div className="grid grid-cols-2 gap-3">
              {(["soft", "round"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => onUpdate({ bubbleRadius: r })}
                  className={`touch-target h-12 rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${
                    settings.bubbleRadius === r ? "border-primary bg-primary/5 text-primary" : "border-neutral-800 text-muted"
                  }`}
                >
                  {r === "soft" ? "Мягкий" : "Круглый"}
                </button>
              ))}
            </div>
          </section>
        </div>

        <button 
          onClick={onClose}
          className="btn-nox mt-6 w-full bg-white h-14 rounded-[1.25rem] text-sm font-black text-black transition-smooth active:scale-[0.98] shadow-2xl shadow-white/5"
        >
          ГОТОВО
        </button>
      </div>
    </div>
  );
}
