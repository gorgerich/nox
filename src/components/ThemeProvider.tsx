"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

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
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentPreference) => void;
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

function applyRootTheme(preference: ThemePreference, accent: AccentPreference) {
  const effectiveTheme = resolveEffectiveTheme(preference);
  const root = document.documentElement;

  root.dataset.theme = effectiveTheme;
  root.dataset.themeMode = preference;
  root.dataset.accent = accent;
  root.classList.toggle("dark", effectiveTheme === "dark");
  root.classList.remove("light");
  root.style.colorScheme = effectiveTheme;

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

  const setTheme = (newTheme: ThemePreference) => {
    setThemeState(newTheme);
  };

  const setAccent = (newAccent: AccentPreference) => {
    setAccentState(newAccent);
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, accent, setTheme, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
