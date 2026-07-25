"use client";

import { Check, RotateCcw } from "lucide-react";
import { useState } from "react";

export type ChatWallpaperKey = "none" | "orbit-night" | "botanical-light" | "contour-color";

export type AppearanceSettings = {
  preset: "system" | "midnight" | "graphite" | "ocean" | "ice" | "emerald" | "milk";
  bubbleRadius: "soft" | "round";
  outgoingColor: string;
  incomingStyle: "filled" | "glass" | "minimal";
  background: string;
  density: "compact" | "comfortable";
  wallpaper: ChatWallpaperKey;
  wallpaperIntensity: number;
  wallpaperBlur: number;
  wallpaperScale: number;
  wallpaperTint: string;
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
  outgoingColor: "#3b82f6",
  incomingStyle: "filled",
  background: "system",
  density: "comfortable",
  wallpaper: "none",
  wallpaperIntensity: 32,
  wallpaperBlur: 0,
  wallpaperScale: 100,
  wallpaperTint: "transparent",
};

export const CHAT_WALLPAPERS: {
  id: ChatWallpaperKey;
  label: string;
  src: string | null;
  preferredPreset?: AppearanceSettings["preset"];
  scheme?: "light" | "dark";
}[] = [
  { id: "none", label: "Без фона", src: null },
  // `scheme` is the lightness the artwork is drawn for. A dark wallpaper under a
  // light app would otherwise darken only the history and leave the rest of the
  // chrome light.
  { id: "orbit-night", label: "Орбиты", src: "/wallpapers/nox-orbit-night.jpg", preferredPreset: "midnight", scheme: "dark" },
  { id: "botanical-light", label: "Ботаника", src: "/wallpapers/nox-botanical-light.jpg", preferredPreset: "ice", scheme: "light" },
  { id: "contour-color", label: "Контуры", src: "/wallpapers/nox-contour-color.jpg", preferredPreset: "graphite", scheme: "dark" },
];

const WALLPAPER_TINTS = [
  { label: "Без оттенка", value: "transparent", swatch: "linear-gradient(135deg,#fff 48%,#111 52%)" },
  { label: "Синий", value: "rgba(37, 99, 235, 0.24)", swatch: "#2563eb" },
  { label: "Голубой", value: "rgba(8, 145, 178, 0.22)", swatch: "#0891b2" },
  { label: "Зелёный", value: "rgba(5, 150, 105, 0.22)", swatch: "#059669" },
  { label: "Фиолетовый", value: "rgba(124, 58, 237, 0.22)", swatch: "#7c3aed" },
  { label: "Розовый", value: "rgba(225, 29, 72, 0.18)", swatch: "#e11d48" },
] as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizeAppearance(value: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const wallpaperIds = new Set(CHAT_WALLPAPERS.map((wallpaper) => wallpaper.id));
  const incomingStyle = (value as { incomingStyle?: string } | null | undefined)?.incomingStyle;
  const wallpaper = value?.wallpaper && wallpaperIds.has(value.wallpaper)
    ? value.wallpaper
    : DEFAULT_APPEARANCE.wallpaper;

  return {
    ...DEFAULT_APPEARANCE,
    ...value,
    incomingStyle:
      incomingStyle === "solid"
        ? "filled"
        : value?.incomingStyle ?? DEFAULT_APPEARANCE.incomingStyle,
    wallpaper,
    wallpaperIntensity: clampNumber(value?.wallpaperIntensity, 8, 70, DEFAULT_APPEARANCE.wallpaperIntensity),
    wallpaperBlur: clampNumber(value?.wallpaperBlur, 0, 10, DEFAULT_APPEARANCE.wallpaperBlur),
    wallpaperScale: clampNumber(value?.wallpaperScale, 72, 150, DEFAULT_APPEARANCE.wallpaperScale),
    wallpaperTint: typeof value?.wallpaperTint === "string" ? value.wallpaperTint : DEFAULT_APPEARANCE.wallpaperTint,
  };
}

function resolveOutgoingToken(color: string) {
  const key = OUTGOING_COLOR_ALIAS[color.toLowerCase()] ?? "graphite";
  return OUTGOING_BUBBLE_TOKENS[key] ?? OUTGOING_BUBBLE_TOKENS.graphite;
}

export type ColorScheme = "light" | "dark";

/**
 * The single source of truth for how dark the chat screen is.
 *
 * The "system" preset delegates to the app's resolved theme; every other preset
 * declares its own darkness. Everything inside the chat — including the
 * composer, notices and service pills, which are styled from the *app* tokens —
 * must derive from this one value, otherwise the screen splits into a dark
 * history with a light composer.
 */
export function resolveChatScheme(settings: AppearanceSettings, appScheme: ColorScheme): ColorScheme {
  if (settings.preset === "system") {
    // A wallpaper is a scheme decision too: picking dark artwork must darken the
    // whole chat, not just the area the image covers.
    const wallpaper = CHAT_WALLPAPERS.find((item) => item.id === settings.wallpaper);
    return wallpaper?.scheme ?? appScheme;
  }
  const preset = CHAT_PRESET_TOKENS[settings.preset] ?? CHAT_PRESET_TOKENS.midnight;
  return preset.isDark ? "dark" : "light";
}

/**
 * App-level semantic tokens re-pointed at the chat's own surfaces. Applied on
 * the chat root so components that legitimately use the app palette follow the
 * chat scheme inside this subtree, instead of each one being repainted by hand.
 */
function appTokenOverridesForChat(preset: ChatPresetTokens, scheme: ColorScheme): Record<string, string> {
  // The "system" preset already points at the app tokens, so overriding them
  // with themselves would be circular — leave the app palette alone.
  if (preset === CHAT_PRESET_TOKENS.system) return {};

  const isDark = scheme === "dark";
  return {
    "--background": preset.bg,
    "--surface": preset.surface,
    "--surface-primary": preset.surface,
    "--surface-secondary": preset.dateBg,
    "--surface-elevated": preset.menuBg,
    "--background-elevated": preset.menuBg,
    "--surface-muted": preset.dateBg,
    "--foreground": preset.headerFg,
    "--text-primary": preset.headerFg,
    "--muted": preset.incomingMuted,
    "--text-secondary": preset.incomingMuted,
    "--text-tertiary": preset.incomingMuted,
    "--border": preset.incomingBorder,
    "--border-subtle": preset.incomingBorder,
    "--separator": preset.incomingBorder,
    "--navigation-background": preset.composerBg,
    "--navigation-background-fallback": preset.composerBg,
    "--input-background": preset.inputBg,
    "--input": preset.inputBg,
    "--placeholder": preset.inputPlaceholder,
    "--surface-pressed": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    "--surface-hover": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
  };
}

export function getChatAppearanceVars(settings: AppearanceSettings, appScheme: ColorScheme = "light"): Record<string, string> {
  const preset = CHAT_PRESET_TOKENS[settings.preset] ?? CHAT_PRESET_TOKENS.midnight;
  const outgoing = resolveOutgoingToken(settings.outgoingColor);
  const wallpaper = CHAT_WALLPAPERS.find((item) => item.id === settings.wallpaper) ?? CHAT_WALLPAPERS[0];


  const scheme = resolveChatScheme(settings, appScheme);
  // With the system preset the app palette is already correct unless a
  // wallpaper pushed the chat to the other scheme. In that case adopt the
  // wallpaper's preferred preset wholesale — swapping only the surrounding
  // chrome left white incoming bubbles and a light header on dark artwork.
  const effectivePreset =
    settings.preset === "system" && scheme !== appScheme && wallpaper.preferredPreset
      ? CHAT_PRESET_TOKENS[wallpaper.preferredPreset] ?? preset
      : preset;

  let incomingBg = effectivePreset.incomingBg;
  if (settings.incomingStyle === "glass") {
    incomingBg = effectivePreset.isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.03)";
  }
  if (settings.incomingStyle === "minimal") {
    incomingBg = "transparent";
  }

  return {
    ...appTokenOverridesForChat(effectivePreset, scheme),
    "color-scheme": scheme,
    "--chat-bg": effectivePreset.bg,
    "--chat-surface": effectivePreset.surface,
    "--chat-header-bg": effectivePreset.headerBg,
    "--chat-header-fg": effectivePreset.headerFg,
    "--chat-composer-bg": effectivePreset.composerBg,
    "--chat-composer-border": effectivePreset.incomingBorder,
    "--chat-input-bg": effectivePreset.inputBg,
    "--chat-input-fg": effectivePreset.inputFg,
    "--chat-input-placeholder": effectivePreset.inputPlaceholder,
    "--bubble-incoming-bg": incomingBg,
    "--bubble-incoming-fg": effectivePreset.incomingFg,
    "--bubble-incoming-muted": effectivePreset.incomingMuted,
    "--bubble-incoming-border": effectivePreset.incomingBorder,
    "--bubble-outgoing-bg": outgoing.bg,
    "--bubble-outgoing-fg": outgoing.fg,
    "--bubble-outgoing-muted": outgoing.muted,
    "--message-tick": outgoing.tick,
    "--message-read": outgoing.read,
    "--chat-date-bg": effectivePreset.dateBg,
    "--chat-date-fg": effectivePreset.dateFg,
    "--message-menu-bg": effectivePreset.menuBg,
    "--message-menu-fg": effectivePreset.menuFg,
    "--message-menu-muted": effectivePreset.menuMuted,
    "--chat-menu-border": effectivePreset.incomingBorder,
    "--chat-focus-ring": effectivePreset.isDark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.18)",
    "--chat-wallpaper-image": wallpaper.src ? `url("${wallpaper.src}")` : "none",
    "--chat-wallpaper-opacity": wallpaper.src ? String(settings.wallpaperIntensity / 100) : "0",
    "--chat-wallpaper-blur": `${settings.wallpaperBlur}px`,
    "--chat-wallpaper-size": `${Math.round(settings.wallpaperScale * 4.4)}px`,
    "--chat-wallpaper-tint": settings.wallpaperTint,
    // Backward-compatible aliases used by some existing utility classes.
    "--chat-muted": effectivePreset.incomingMuted,
    "--chat-fg": effectivePreset.headerFg,
    "--chat-header": effectivePreset.headerBg,
    "--chat-composer": effectivePreset.composerBg,
    "--chat-background": effectivePreset.bg,
  };
}

export function useChatAppearance(chatId: string) {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_APPEARANCE;
    }

    let saved: string | null = null;
    try {
      saved =
        localStorage.getItem(`nox:chat-appearance:${chatId}:v2`) ??
        localStorage.getItem("nox:chat-appearance:global:v2");
    } catch {
      return DEFAULT_APPEARANCE;
    }

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
      return normalizeAppearance(parsed);
    } catch {
      return DEFAULT_APPEARANCE;
    }
  });

  const updateSettings = (newSettings: Partial<AppearanceSettings>, isGlobal = false) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(`nox:chat-appearance:${chatId}:v2`, JSON.stringify(updated));
        if (isGlobal) {
          localStorage.setItem("nox:chat-appearance:global:v2", JSON.stringify(updated));
        }
      } catch {
        // Appearance still applies for current session when storage is unavailable.
      }
      return updated;
    });
  };

  const resetSettings = () => {
    let global: string | null = null;
    try {
      localStorage.removeItem(`nox:chat-appearance:${chatId}:v2`);
      global = localStorage.getItem("nox:chat-appearance:global:v2");
    } catch {
      setSettings(DEFAULT_APPEARANCE);
      return;
    }
    if (!global) {
      setSettings(DEFAULT_APPEARANCE);
      return;
    }

    try {
      setSettings(normalizeAppearance(JSON.parse(global)));
    } catch {
      setSettings(DEFAULT_APPEARANCE);
    }
  };

  return { settings, updateSettings, resetSettings };
}

export function useGlobalChatAppearance() {
  const [settings, setSettings] = useState<AppearanceSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_APPEARANCE;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("nox:chat-appearance:global:v2");
    } catch {
      return DEFAULT_APPEARANCE;
    }
    if (!saved) return DEFAULT_APPEARANCE;

    try {
      return normalizeAppearance(JSON.parse(saved));
    } catch {
      return DEFAULT_APPEARANCE;
    }
  });

  const updateSettings = (patch: Partial<AppearanceSettings>) => {
    setSettings((current) => {
      const next = normalizeAppearance({ ...current, ...patch });
      try {
        localStorage.setItem("nox:chat-appearance:global:v2", JSON.stringify(next));
      } catch {
        // Keep session-only appearance when storage is unavailable.
      }
      return next;
    });
  };

  const resetSettings = () => {
    setSettings(DEFAULT_APPEARANCE);
    try {
      localStorage.removeItem("nox:chat-appearance:global:v2");
    } catch {
      // State reset still succeeds.
    }
  };

  return { settings, updateSettings, resetSettings };
}

export function ChatWallpaperControls({
  settings,
  onUpdate,
  onApplyGlobal,
}: {
  settings: AppearanceSettings;
  onUpdate: (settings: Partial<AppearanceSettings>) => void;
  onApplyGlobal?: () => void;
}) {
  const wallpaper = CHAT_WALLPAPERS.find((item) => item.id === settings.wallpaper) ?? CHAT_WALLPAPERS[0];

  return (
    <section className="space-y-4">
      <div className="chat-wallpaper-preview" style={getChatAppearanceVars(settings) as React.CSSProperties}>
        <div className="chat-wallpaper-layer" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col justify-end gap-2 p-4">
          <div className="max-w-[72%] self-start rounded-[18px] rounded-bl-md border border-white/15 bg-black/45 px-3 py-2 text-[12px] text-white backdrop-blur-xl">
            Новый фон выглядит так
          </div>
          <div
            className="max-w-[72%] self-end rounded-[18px] rounded-br-md px-3 py-2 text-[12px]"
            style={{ background: "var(--bubble-outgoing-bg)", color: "var(--bubble-outgoing-fg)" }}
          >
            Всё читается отлично
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-foreground">Фон чатов</h3>
          <span className="text-xs text-muted">{wallpaper.label}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {CHAT_WALLPAPERS.map((item) => {
            const active = settings.wallpaper === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-pressed={active}
                onClick={() => onUpdate({
                  wallpaper: item.id,
                  ...(item.preferredPreset ? { preset: item.preferredPreset } : {}),
                })}
                className={`wallpaper-swatch fluid-hit ${active ? "wallpaper-swatch-active" : ""}`}
                style={item.src ? { backgroundImage: `url("${item.src}")` } : undefined}
              >
                {item.src ? null : <span className="h-px w-8 rotate-[-35deg] bg-danger" />}
                {active ? (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-sm">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {settings.wallpaper !== "none" ? (
        <>
          <div>
            <h3 className="mb-2 px-1 text-sm font-semibold text-foreground">Оттенок</h3>
            <div className="flex items-center gap-2">
              {WALLPAPER_TINTS.map((tint) => (
                <button
                  key={tint.value}
                  type="button"
                  aria-label={tint.label}
                  aria-pressed={settings.wallpaperTint === tint.value}
                  onClick={() => onUpdate({ wallpaperTint: tint.value })}
                  className={`wallpaper-tint fluid-hit ${settings.wallpaperTint === tint.value ? "wallpaper-tint-active" : ""}`}
                  style={{ background: tint.swatch }}
                />
              ))}
            </div>
          </div>

          <WallpaperSlider label="Интенсивность" value={settings.wallpaperIntensity} min={8} max={70} suffix="%" onChange={(value) => onUpdate({ wallpaperIntensity: value })} />
          <WallpaperSlider label="Масштаб" value={settings.wallpaperScale} min={72} max={150} suffix="%" onChange={(value) => onUpdate({ wallpaperScale: value })} />
          <WallpaperSlider label="Размытие" value={settings.wallpaperBlur} min={0} max={10} suffix=" px" onChange={(value) => onUpdate({ wallpaperBlur: value })} />
        </>
      ) : null}

      {onApplyGlobal ? (
        <button
          type="button"
          onClick={onApplyGlobal}
          className="apple-glass-control fluid-hit flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-primary"
        >
          Применить ко всем чатам
        </button>
      ) : null}
    </section>
  );
}

function WallpaperSlider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-2xl border border-border-subtle bg-foreground/[0.035] px-4 py-3">
      <span className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted">{value}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="nox-range" />
    </label>
  );
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
  onUpdate: (s: Partial<AppearanceSettings>, isGlobal?: boolean) => void;
  onReset: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/35 backdrop-blur-[2px] transition-smooth animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-appearance-title"
      onClick={onClose}
    >
      <div
        className="apple-glass-sheet w-full max-w-lg rounded-t-[28px] p-5 animate-in slide-in-from-bottom-full duration-300 ease-out safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-foreground/15" />

        <div className="mb-5 flex items-center justify-between">
          <h2 id="chat-appearance-title" className="text-xl font-semibold tracking-tight text-foreground">Оформление</h2>
          <button type="button" onClick={onReset} className="fluid-hit flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary/10">
            <RotateCcw className="h-4 w-4" strokeWidth={2.1} />
            Сбросить
          </button>
        </div>

        <div className="max-h-[68dvh] space-y-7 overflow-y-auto pb-4 scrollbar-hide overscroll-contain">
          <ChatWallpaperControls
            settings={settings}
            onUpdate={onUpdate}
            onApplyGlobal={() => onUpdate({}, true)}
          />

          <section>
            <h3 className="mb-3 ml-1 text-sm font-semibold text-muted">Пресеты</h3>
            <div className="grid grid-cols-3 gap-3">
              {(Object.keys(PRESETS) as ChatPresetKey[]).map((id) => {
                const preset = CHAT_PRESET_TOKENS[id];
                return (
                  <button
                    key={id}
                    onClick={() => onUpdate({ preset: id, background: id })}
                    className={`relative group flex flex-col items-center gap-2 rounded-2xl border p-1.5 transition-smooth active:scale-[0.96] ${
                      settings.preset === id ? "border-primary bg-primary/5" : "border-border-subtle hover:border-muted"
                    }`}
                  >
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-black/5" style={{ backgroundColor: preset.bg }}>
                      <div className="absolute left-2 top-2 h-3 w-2/3 rounded-full" style={{ backgroundColor: preset.headerBg }} />
                      <div className="absolute right-2 top-7 h-3 w-2/3 rounded-full bg-primary/40" />
                      <div className="absolute left-2 top-12 h-3 w-1/2 rounded-full" style={{ backgroundColor: preset.incomingBg }} />
                    </div>
                    <span className="mb-1 text-xs font-medium text-foreground/80">
                      {id === "system" ? "Система" : id === "midnight" ? "Ночь" : id === "graphite" ? "Графит" : id === "ocean" ? "Океан" : id === "ice" ? "Лёд" : id === "emerald" ? "Изумруд" : "Молоко"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-3 ml-1 text-sm font-semibold text-muted">Цвет сообщений</h3>
            <div className="flex flex-wrap gap-3 px-1">
              {["#3f3f46", "#3b82f6", "#8b5cf6", "#0ea5e9", "#10b981", "#f97316"].map((color) => (
                <button
                  key={color}
                  onClick={() => onUpdate({ outgoingColor: color })}
                  className={`h-11 w-11 rounded-full border-2 transition-smooth active:scale-[0.96] ${
                    settings.outgoingColor.toLowerCase() === color ? "scale-105 border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 ml-1 text-sm font-semibold text-muted">Стиль входящих</h3>
            <div className="grid grid-cols-3 gap-3">
              {([
                { id: "filled", label: "Заливка" },
                { id: "glass", label: "Стекло" },
                { id: "minimal", label: "Минимал" },
              ] as const).map((style) => (
                <button
                  key={style.id}
                  onClick={() => onUpdate({ incomingStyle: style.id })}
                  className={`touch-target h-11 rounded-xl border text-sm font-semibold transition-smooth active:scale-[0.96] ${
                    settings.incomingStyle === style.id ? "border-primary bg-primary/5 text-primary" : "border-border-subtle text-muted"
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 ml-1 text-sm font-semibold text-muted">Радиус углов</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: "soft", label: "Мягкий" },
                { id: "round", label: "Круглый" },
              ] as const).map((r) => (
                <button
                  key={r.id}
                  onClick={() => onUpdate({ bubbleRadius: r.id })}
                  className={`touch-target h-11 rounded-xl border text-sm font-semibold transition-smooth active:scale-[0.96] ${
                    settings.bubbleRadius === r.id ? "border-primary bg-primary/5 text-primary" : "border-border-subtle text-muted"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <button onClick={onClose} className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.98]">
          Готово
        </button>
      </div>
    </div>
  );
}
