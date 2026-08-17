"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_STORAGE_KEY,
  applyUiScale,
  parseUiScaleLevel,
  type UiScaleLevel,
} from "@/lib/ui-scale";

type ThemePreference = "dark" | "light" | "system";
type EffectiveTheme = "dark" | "light";
export type AccentPreference = "blue" | "graphite" | "gray" | "purple" | "cyan" | "green";
const THEME_STORAGE_KEY = "nox:theme";
const ACCENT_STORAGE_KEY = "nox:accent";

export const ACCENT_OPTIONS: { value: AccentPreference; label: string; swatch: string }[] = [
  { value: "graphite", label: "Графит", swatch: "#334155" },
  { value: "blue", label: "Синий", swatch: "#2563eb" },
  { value: "gray", label: "Серый", swatch: "#6b7280" },
  { value: "purple", label: "Фиолетовый", swatch: "#7c3aed" },
  { value: "cyan", label: "Голубой", swatch: "#0891b2" },
  { value: "green", label: "Мягкий зелёный", swatch: "#059669" },
];

interface ThemeContextType {
  theme: ThemePreference;
  effectiveTheme: EffectiveTheme;
  accent: AccentPreference;
  /** Global interface scale, 1-7. See src/lib/ui-scale.ts. */
  uiScale: UiScaleLevel;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentPreference) => void;
  setUiScale: (level: UiScaleLevel) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return preference;
}

function isAccentPreference(value: string | null): value is AccentPreference {
  return value === "blue" || value === "graphite" || value === "gray" || value === "purple" || value === "cyan" || value === "green";
}

// Status bar / browser chrome colour per theme. Kept in sync with the
// --background token of each theme in globals.css.
const THEME_COLOR: Record<EffectiveTheme, string> = {
  light: "#f2f2f7",
  dark: "#000000",
};

function applyRootTheme(preference: ThemePreference, accent: AccentPreference) {
  const effectiveTheme = resolveEffectiveTheme(preference);
  const root = document.documentElement;

  root.dataset.theme = effectiveTheme;
  root.dataset.themeMode = preference;
  root.dataset.accent = accent;
  root.classList.toggle("dark", effectiveTheme === "dark");
  root.classList.remove("light");
  root.style.colorScheme = effectiveTheme;

  // The static <meta> tags are media-query based, so they track the *system*
  // scheme. When the user overrides the theme manually we have to drive the
  // status bar ourselves, otherwise picking Light on a dark phone leaves the
  // system chrome black.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    ?? (() => {
      const created = document.createElement("meta");
      created.name = "theme-color";
      document.head.appendChild(created);
      return created;
    })();
  meta.content = THEME_COLOR[effectiveTheme];

  return effectiveTheme;
}

function subscribeToSystemTheme(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", callback);
  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

function getSystemThemeSnapshot() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof document === "undefined") {
      return "system";
    }

    const rootThemeMode = document.documentElement.dataset.themeMode;
    if (rootThemeMode === "light" || rootThemeMode === "dark" || rootThemeMode === "system") {
      return rootThemeMode;
    }

    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";
  });
  const [accent, setAccentState] = useState<AccentPreference>(() => {
    if (typeof document === "undefined") {
      return "blue";
    }

    const rootAccent = document.documentElement.dataset.accent ?? null;
    if (isAccentPreference(rootAccent)) {
      return rootAccent;
    }

    const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentPreference(storedAccent) ? storedAccent : "blue";
  });
  // Seeded from the root element, which the boot script has already written
  // from storage — the same order the theme uses, and the reason neither one
  // flashes its default before hydration catches up.
  const [uiScale, setUiScaleState] = useState<UiScaleLevel>(() => {
    if (typeof document === "undefined") {
      return UI_SCALE_DEFAULT;
    }

    const fromRoot = Number(document.documentElement.dataset.uiScale);
    if (Number.isInteger(fromRoot) && fromRoot >= 1 && fromRoot <= 7) {
      return fromRoot as UiScaleLevel;
    }

    return parseUiScaleLevel(localStorage.getItem(UI_SCALE_STORAGE_KEY));
  });
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    () => false,
  );
  const effectiveTheme: EffectiveTheme = theme === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : theme;

  useEffect(() => {
    applyRootTheme(theme, accent);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  }, [theme, effectiveTheme, accent]);

  // Applies to the DOM only. Storage is written where the choice is made, not
  // on every mount: the boot script has already read the value by the time
  // this runs, so a write here says nothing new — and it lands *after* the
  // page has settled, which is late enough to overwrite a value someone else
  // put there in between.
  useEffect(() => {
    applyUiScale(uiScale, document.documentElement);
  }, [uiScale]);

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
  };

  const setAccent = (newAccent: AccentPreference) => {
    setAccentState(newAccent);
  };

  const setUiScale = (level: UiScaleLevel) => {
    // The root property is written here as well as in the effect above: a drag
    // should land on the same frame as the finger, and waiting for React to
    // commit before touching the DOM is what makes a live preview feel late.
    applyUiScale(level, document.documentElement);
    localStorage.setItem(UI_SCALE_STORAGE_KEY, String(level));
    setUiScaleState(level);
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, accent, uiScale, setTheme, setAccent, setUiScale }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
