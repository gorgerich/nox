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
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose}>
      <div 
        className="w-full max-w-lg rounded-t-[32px] bg-neutral-950 p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300 ease-out"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-neutral-800" />
        
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Оформление</h2>
          <button onClick={onReset} className="text-xs font-bold uppercase tracking-widest text-primary hover:opacity-80">
            Сброс
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto space-y-8 pb-8 pr-2 scrollbar-hide">
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Пресеты</h3>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((id) => (
                <button
                  key={id}
                  onClick={() => onUpdate({ preset: id, background: id })}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-all ${
                    settings.preset === id ? "border-primary bg-primary/5" : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <div className={`h-8 w-full rounded-lg ${PRESETS[id].bg} border border-white/10`} />
                  <span className="text-[10px] font-bold">{PRESETS[id].name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Цвет ваших сообщений</h3>
            <div className="flex flex-wrap gap-3">
              {["#10b981", "#3b82f6", "#8b5cf6", "#f43f5e", "#737373", "#f97316"].map((color) => (
                <button
                  key={color}
                  onClick={() => onUpdate({ outgoingColor: color })}
                  className={`h-10 w-10 rounded-full border-2 transition-all active:scale-90 ${
                    settings.outgoingColor === color ? "border-white scale-110 shadow-lg" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Стиль входящих</h3>
            <div className="grid grid-cols-3 gap-3">
              {(["solid", "glass", "minimal"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => onUpdate({ incomingStyle: style })}
                  className={`rounded-xl border-2 py-2 text-xs font-bold transition-all ${
                    settings.incomingStyle === style ? "border-primary bg-primary/5 text-primary" : "border-neutral-800 text-muted"
                  }`}
                >
                  {style === "solid" ? "Заливка" : style === "glass" ? "Стекло" : "Минимал"}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Радиус углов</h3>
            <div className="grid grid-cols-2 gap-3">
              {(["soft", "round"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => onUpdate({ bubbleRadius: r })}
                  className={`rounded-xl border-2 py-2 text-xs font-bold transition-all ${
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
          className="mt-4 w-full rounded-2xl bg-white py-4 text-sm font-bold text-black transition-all active:scale-[0.98]"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
